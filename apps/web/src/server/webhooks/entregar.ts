import 'server-only';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { TIMEOUT_ENTREGA_MS, validarUrlWebhook } from '@/lib/api-publica';
import { MAXIMO_BYTES_RESPUESTA } from './constantes';
import { ErrorDireccionBloqueada, lookupSeguro, MENSAJE_DIRECCION_BLOQUEADA } from './ssrf';

// Un POST de webhook (PLAN-SAAS Fase 11). Con `node:https` y no con `fetch`, porque
// `fetch` no deja fijar el `lookup`: aquí la IP que valida `lookupSeguro` es la misma a la
// que se conecta el socket (sin *DNS rebinding*). Sin agente compartido (`agent: false`):
// cada entrega abre su conexión, así que una IP validada no se reutiliza para otro host.
// No sigue redirecciones (un 3xx es una respuesta más) y lee como máximo 64 KB.

export interface PeticionWebhook {
  url: string;
  /** Texto exacto que se firmó. */
  cuerpo: string;
  cabeceras: Readonly<Record<string, string>>;
}

export type ResultadoHttp =
  /** El receptor respondió (cualquier status). `cuerpo` viene truncado a 64 KB. */
  | { tipo: 'respuesta'; status: number; cuerpo: string }
  /** La URL o lo que resuelve no se contacta: se descarta sin reintentos. */
  | { tipo: 'bloqueada'; mensaje: string }
  /** No hubo respuesta (DNS, conexión, TLS, timeout): se reintenta. */
  | { tipo: 'falla'; mensaje: string };

export type EnviarHttp = (peticion: PeticionWebhook) => Promise<ResultadoHttp>;

type Solicitar = (
  opciones: RequestOptions,
  alResponder: (r: IncomingMessage) => void,
) => ClientRequest;

export interface OpcionesEnviarHttp {
  /** `https.request` (inyectable en las pruebas). */
  solicitar?: Solicitar;
  lookup?: LookupFunction;
  timeoutMs?: number;
  maximoBytes?: number;
}

/** Texto para `ultima_respuesta` cuando no hubo respuesta. Sin detalles internos. */
export function mensajeFalla(error: unknown): string {
  const codigo = (error as NodeJS.ErrnoException | undefined)?.code;
  const nombre = (error as Error | undefined)?.name;
  if (nombre === 'TimeoutError' || nombre === 'AbortError' || codigo === 'ETIMEDOUT') {
    return `El receptor no respondió en ${TIMEOUT_ENTREGA_MS / 1000} s. Responde con un 2xx antes de procesar el evento.`;
  }
  switch (codigo) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'No pudimos resolver el dominio de la URL. Revisa que exista y tenga registros DNS públicos.';
    case 'ECONNREFUSED':
      return 'El servidor rechazó la conexión en el puerto 443. Revisa que la URL esté recibiendo peticiones https.';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'El servidor cortó la conexión antes de responder. Revisa los registros de tu receptor.';
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'El certificado TLS del receptor no es válido para ese dominio. Usa un certificado vigente emitido por una autoridad reconocida.';
    default:
      return 'No pudimos conectarnos con la URL del webhook. Lo intentaremos de nuevo.';
  }
}

export function crearEnviarHttp(opciones: OpcionesEnviarHttp = {}): EnviarHttp {
  const solicitar: Solicitar = opciones.solicitar ?? httpsRequest;
  const lookup = opciones.lookup ?? lookupSeguro;
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_ENTREGA_MS;
  const maximoBytes = opciones.maximoBytes ?? MAXIMO_BYTES_RESPUESTA;

  return (peticion) =>
    new Promise<ResultadoHttp>((resolver) => {
      const valida = validarUrlWebhook(peticion.url);
      if (!valida.ok) {
        resolver({ tipo: 'bloqueada', mensaje: valida.mensaje });
        return;
      }
      let url: URL;
      try {
        url = new URL(valida.url);
      } catch {
        resolver({ tipo: 'bloqueada', mensaje: 'La URL del webhook no es válida. Actualízala.' });
        return;
      }
      // Node no llama a `lookup` con una IP literal: el check ya las excluye, pero se
      // vuelve a revisar aquí por si una URL vieja se saltó la validación.
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') || isIP(host)) {
        resolver({ tipo: 'bloqueada', mensaje: MENSAJE_DIRECCION_BLOQUEADA });
        return;
      }

      let terminado = false;
      const terminar = (resultado: ResultadoHttp) => {
        if (terminado) return;
        terminado = true;
        resolver(resultado);
      };

      const cuerpo = Buffer.from(peticion.cuerpo, 'utf8');
      let req: ClientRequest;
      try {
        req = solicitar(
          {
            protocol: 'https:',
            hostname: host,
            port: 443,
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: { ...peticion.cabeceras, 'Content-Length': String(cuerpo.length) },
            lookup,
            servername: host,
            agent: false,
            timeout: timeoutMs,
            signal: AbortSignal.timeout(timeoutMs),
          },
          (respuesta) => {
            const status = respuesta.statusCode ?? 0;
            const trozos: Buffer[] = [];
            let leidos = 0;
            const cerrar = () =>
              terminar({
                tipo: 'respuesta',
                status,
                cuerpo: Buffer.concat(trozos).toString('utf8'),
              });
            respuesta.on('data', (trozo: Buffer) => {
              if (leidos >= maximoBytes) return;
              const resto = maximoBytes - leidos;
              const parte = trozo.length > resto ? trozo.subarray(0, resto) : trozo;
              trozos.push(parte);
              leidos += parte.length;
              if (leidos >= maximoBytes) {
                // Lo que pasa de 64 KB no interesa: se corta la conexión y se responde.
                cerrar();
                respuesta.destroy();
              }
            });
            respuesta.on('end', cerrar);
            // Status ya recibido: un corte o el timeout en medio del cuerpo no anula la
            // respuesta (2xx sigue siendo entregado; lo leído alcanza para la bitácora).
            respuesta.on('error', cerrar);
            respuesta.on('aborted', cerrar);
          },
        );
      } catch (error) {
        terminar({ tipo: 'falla', mensaje: mensajeFalla(error) });
        return;
      }

      req.on('timeout', () => {
        const error = new Error('timeout');
        error.name = 'TimeoutError';
        req.destroy(error);
      });
      req.on('error', (error) => {
        if (
          error instanceof ErrorDireccionBloqueada ||
          (error as NodeJS.ErrnoException).code === 'EDIRECCIONBLOQUEADA'
        ) {
          terminar({ tipo: 'bloqueada', mensaje: MENSAJE_DIRECCION_BLOQUEADA });
          return;
        }
        terminar({ tipo: 'falla', mensaje: mensajeFalla(error) });
      });
      req.end(cuerpo);
    });
}
