// Deriva de winex/certificacion v1.9.1 (src/Folios/TransporteCurl.php), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript con undici.
//
// Transporte real. Mismas reglas que el cURL del PHP: verificación TLS siempre
// encendida (certificado y nombre del servidor), sin seguir redirecciones, solo
// https, descompresión de gzip/deflate. Diferencias con el PHP:
// - El certificado de cliente se pasa en memoria (el PHP lo escribía en
//   temporales 0600 para cURL).
// - Timeouts unificados para todos los canales (pend. 6.4): conexión 10 s y
//   petición completa 45 s, configurables. Antes eran 15 s de conexión en folios y
//   `default_socket_timeout` (60 s) en SOAP.
// - Siempre HTTP/1.1. El cURL del PHP puede negociar HTTP/2 por ALPN si su build lo
//   trae (el PHP 8.3 de Windows sí); `file_get_contents` usa HTTP/1.1 con
//   `Connection: close`.
// - Solo agrega `Host`, `Connection: keep-alive` y `Content-Length`. cURL agrega
//   siempre `Accept: */*`: los clientes portados de cURL que quieran el mismo
//   request la ponen ellos. `Accept-Encoding`: ver `ACCEPT_ENCODING` en transporte.ts.
// - Reutiliza conexiones (keep-alive) con un `Agent` por identidad TLS. El PHP
//   abría una conexión por petición. Con `conexionNueva` (POST críticos) la
//   petición usa un `Agent` de un solo uso: conexión propia y `Connection: close`.

import { createHash } from 'node:crypto';
import { createSecureContext, getCACertificates } from 'node:tls';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip, inflate, inflateRaw } from 'node:zlib';
import { Agent } from 'undici';
import { ErrorTransporte } from '../errores.ts';
import { RespuestaHttp, urlSinQuery } from './respuesta.ts';
import {
  type IdentidadTls,
  MS_CONEXION_POR_DEFECTO,
  MS_RESPUESTA_POR_DEFECTO,
  type PeticionHttp,
  prepararPeticion,
  type TransporteHttp,
} from './transporte.ts';

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const inflateRawAsync = promisify(inflateRaw);
const brotliAsync = promisify(brotliDecompress);

export interface OpcionesTransporteUndici {
  /** Tope para abrir la conexión (TCP + TLS), en ms. Por defecto 10 000. */
  readonly msConexion?: number;
  /** Tope de cada petición completa, en ms; cada petición puede cambiarlo. Por defecto 45 000. */
  readonly msRespuesta?: number;
  /**
   * CA adicionales en PEM (para tests con un servidor local). Se suman a las CA
   * por defecto de Node; nunca reemplazan la verificación.
   */
  readonly ca?: string | readonly string[];
  /** Permite `http:` además de `https:`. Solo para tests (p. ej. un servidor de captura). */
  readonly permitirHttp?: boolean;
  /**
   * Cuántas identidades TLS de cliente distintas se mantienen con conexiones
   * abiertas a la vez (una por certificado). Al pasarse, se cierra la menos usada.
   * Por defecto 16.
   */
  readonly maxIdentidadesTls?: number;
}

/** Códigos de OpenSSL/Node que significan "no se pudo verificar el certificado del servidor". */
const CODIGOS_VERIFICACION = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class TransporteUndici implements TransporteHttp, AsyncDisposable {
  private readonly msConexion: number;
  private readonly msRespuesta: number;
  private readonly ca: string[] | undefined;
  private readonly permitirHttp: boolean;
  private readonly maxIdentidadesTls: number;
  /** Sin certificado de cliente. */
  private agenteBase: Agent | undefined;
  /** Por huella de la identidad TLS, en orden de uso (el primero es el menos reciente). */
  private readonly agentesTls = new Map<string, Agent>();
  private readonly cierres = new Set<Promise<void>>();
  private cerrado = false;

  constructor(opciones: OpcionesTransporteUndici = {}) {
    this.msConexion = opciones.msConexion ?? MS_CONEXION_POR_DEFECTO;
    this.msRespuesta = opciones.msRespuesta ?? MS_RESPUESTA_POR_DEFECTO;
    this.permitirHttp = opciones.permitirHttp ?? false;
    this.maxIdentidadesTls = Math.max(1, opciones.maxIdentidadesTls ?? 16);
    const extra = opciones.ca === undefined ? [] : [opciones.ca].flat();
    this.ca = extra.length > 0 ? [...getCACertificates('default'), ...extra] : undefined;
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const preparada = prepararPeticion(peticion);
    const { url } = preparada;
    const host = url.host;
    const urlError = urlSinQuery(url);

    if (this.cerrado) {
      throw new ErrorTransporte(`El transporte HTTP ya se cerró (petición a ${host}).`, urlError);
    }
    if (url.protocol !== 'https:' && !(this.permitirHttp && url.protocol === 'http:')) {
      throw new ErrorTransporte(
        `Solo se permiten conexiones https (petición a ${url.protocol}//${host}).`,
        urlError,
      );
    }

    const ms = peticion.msRespuesta ?? this.msRespuesta;
    const tope = AbortSignal.timeout(ms);
    const signal = peticion.signal === undefined ? tope : AbortSignal.any([peticion.signal, tope]);
    // `reset` solo evita reutilizar el socket DESPUÉS de la respuesta; para que la
    // petición no salga por una conexión ya abierta hace falta un Agent propio.
    const conexionNueva = peticion.conexionNueva ?? false;
    const agente = conexionNueva
      ? this.agenteDeUnUso(peticion.tls, urlError, host)
      : this.agente(peticion.tls, urlError, host);

    let status: number;
    let cabeceras: [string, string][];
    let cuerpo: Buffer;
    try {
      const respuesta = await agente.request({
        origin: url.origin,
        path: `${url.pathname}${url.search}`,
        method: preparada.metodo,
        headers: preparada.cabeceras,
        body: preparada.cuerpo ?? null,
        signal,
        headersTimeout: ms,
        bodyTimeout: ms,
        responseHeaders: 'raw',
        reset: conexionNueva,
      });
      status = respuesta.statusCode;
      cabeceras = paresDeCabeceras(respuesta.headers);
      cuerpo = Buffer.from(await respuesta.body.arrayBuffer());
    } catch (error) {
      const mensaje = describirFalla(error, {
        host,
        ms,
        msConexion: this.msConexion,
        porTimeout: tope.aborted,
        cancelada: peticion.signal?.aborted ?? false,
        conTls: peticion.tls !== undefined,
      });
      throw new ErrorTransporte(mensaje, urlError, undefined, { cause: error });
    } finally {
      // El cuerpo ya se leyó completo (o la petición falló): se puede destruir.
      if (conexionNueva) await agente.destroy().catch(() => {});
    }

    if ((peticion.descomprimir ?? true) && cuerpo.length > 0) {
      const codificaciones = cabeceras
        .filter(([nombre]) => nombre === 'content-encoding')
        .flatMap(([, valor]) => valor.split(','))
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c !== '' && c !== 'identity');
      try {
        cuerpo = await descomprimir(cuerpo, codificaciones);
      } catch (error) {
        throw new ErrorTransporte(
          `La respuesta de ${host} venía comprimida y no se pudo descomprimir.`,
          urlError,
          status,
          { cause: error },
        );
      }
    }

    return new RespuestaHttp(status, cabeceras, cuerpo);
  }

  /** Cierra todas las conexiones (espera a que terminen las peticiones en curso). */
  async close(): Promise<void> {
    this.cerrado = true;
    const agentes = [...this.agentesTls.values()];
    if (this.agenteBase !== undefined) agentes.push(this.agenteBase);
    this.agentesTls.clear();
    this.agenteBase = undefined;
    await Promise.all([...agentes.map((a) => a.close()), ...this.cierres]);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private crearAgente(tls?: IdentidadTls): Agent {
    return new Agent({
      // Solo HTTP/1.1: undici 8 negocia HTTP/2 por defecto.
      allowH2: false,
      connect: {
        timeout: this.msConexion,
        // Explícito: así ni NODE_TLS_REJECT_UNAUTHORIZED=0 apaga la verificación.
        rejectUnauthorized: true,
        ...(this.ca === undefined ? {} : { ca: this.ca }),
        ...(tls === undefined ? {} : { cert: tls.cert, key: tls.key }),
      },
    });
  }

  private agente(tls: IdentidadTls | undefined, urlError: string, host: string): Agent {
    if (tls === undefined) {
      this.agenteBase ??= this.crearAgente();
      return this.agenteBase;
    }

    const huella = createHash('sha256').update(tls.cert).update('\0').update(tls.key).digest('hex');
    const existente = this.agentesTls.get(huella);
    if (existente !== undefined) {
      // Al final del Map = el más reciente.
      this.agentesTls.delete(huella);
      this.agentesTls.set(huella, existente);
      return existente;
    }

    validarIdentidad(tls, urlError, host);
    const nuevo = this.crearAgente(tls);
    this.agentesTls.set(huella, nuevo);
    while (this.agentesTls.size > this.maxIdentidadesTls) {
      const [masAntigua, agente] = this.agentesTls.entries().next().value as [string, Agent];
      this.agentesTls.delete(masAntigua);
      const cierre = agente.close().finally(() => this.cierres.delete(cierre));
      this.cierres.add(cierre);
    }
    return nuevo;
  }

  /** Agent fuera del pool, para una sola petición (`conexionNueva`). Quien lo pide lo destruye. */
  private agenteDeUnUso(tls: IdentidadTls | undefined, urlError: string, host: string): Agent {
    if (tls !== undefined) validarIdentidad(tls, urlError, host);
    return this.crearAgente(tls);
  }
}

/** Se valida antes de conectar para dar un error claro; undici solo lo cargaría al conectar. */
function validarIdentidad(tls: IdentidadTls, urlError: string, host: string): void {
  try {
    createSecureContext({ cert: tls.cert, key: tls.key });
  } catch (error) {
    throw new ErrorTransporte(
      `No se pudo cargar el certificado de cliente para conectar con ${host}: revisa que el certificado y la llave PEM correspondan.`,
      urlError,
      undefined,
      { cause: error },
    );
  }
}

/** Con `responseHeaders: 'raw'` undici entrega `[nombre, valor, nombre, valor, ...]` (valores en latin1). */
function paresDeCabeceras(crudas: unknown): [string, string][] {
  const pares: [string, string][] = [];
  if (Array.isArray(crudas)) {
    for (let i = 0; i + 1 < crudas.length; i += 2) {
      pares.push([String(crudas[i]).trim().toLowerCase(), String(crudas[i + 1]).trim()]);
    }
  } else if (crudas !== null && typeof crudas === 'object') {
    for (const [nombre, valor] of Object.entries(crudas)) {
      for (const v of [valor].flat()) pares.push([nombre.toLowerCase(), String(v)]);
    }
  }
  return pares;
}

/** Deshace `Content-Encoding` (en orden inverso). Una codificación desconocida deja el cuerpo como vino. */
async function descomprimir(cuerpo: Buffer, codificaciones: readonly string[]): Promise<Buffer> {
  let salida = cuerpo;
  for (const codificacion of [...codificaciones].reverse()) {
    if (codificacion === 'gzip' || codificacion === 'x-gzip') {
      salida = await gunzipAsync(salida);
    } else if (codificacion === 'deflate') {
      // Como cURL: zlib (RFC 1950) y, si no calza, deflate crudo (algunos servidores lo mandan así).
      try {
        salida = await inflateAsync(salida);
      } catch {
        salida = await inflateRawAsync(salida);
      }
    } else if (codificacion === 'br') {
      salida = await brotliAsync(salida);
    } else {
      return salida;
    }
  }
  return salida;
}

interface ContextoFalla {
  host: string;
  ms: number;
  msConexion: number;
  porTimeout: boolean;
  cancelada: boolean;
  conTls: boolean;
}

/** Códigos de error de toda la cadena de causas. */
function codigos(error: unknown): string[] {
  const salida: string[] = [];
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual !== null && typeof actual === 'object'; i++) {
    const { code, cause } = actual as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') salida.push(code);
    actual = cause;
  }
  return salida;
}

function segundos(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

/** Mensaje mostrable: nombra el host y nunca incluye cabeceras, cuerpo ni material TLS. */
function describirFalla(error: unknown, c: ContextoFalla): string {
  if (c.cancelada) return `Se canceló la petición a ${c.host}.`;
  const lista = codigos(error);
  if (
    c.porTimeout ||
    lista.includes('UND_ERR_HEADERS_TIMEOUT') ||
    lista.includes('UND_ERR_BODY_TIMEOUT')
  ) {
    return `${c.host} no respondió dentro de ${segundos(c.ms)}.`;
  }
  if (lista.includes('UND_ERR_CONNECT_TIMEOUT')) {
    return `No se pudo conectar con ${c.host}: se agotó el tiempo de conexión (${segundos(c.msConexion)}).`;
  }
  if (lista.some((codigo) => CODIGOS_VERIFICACION.has(codigo))) {
    return `No se pudo verificar el certificado TLS de ${c.host}; se cortó la conexión por seguridad.`;
  }
  if (lista.some((codigo) => codigo.startsWith('ERR_SSL_') && codigo.includes('ALERT'))) {
    return c.conTls
      ? `${c.host} rechazó la conexión TLS. Revisa que el certificado digital esté vigente y que se envíe su cadena completa.`
      : `${c.host} rechazó la conexión TLS.`;
  }
  if (lista.includes('ENOTFOUND') || lista.includes('EAI_AGAIN')) {
    return `No se pudo conectar con ${c.host}: no se encontró el servidor.`;
  }
  if (lista.includes('ECONNREFUSED')) {
    return `No se pudo conectar con ${c.host}: la conexión fue rechazada.`;
  }
  if (lista.includes('UND_ERR_SOCKET') || lista.includes('ECONNRESET')) {
    // Con TLS 1.3 el rechazo del certificado de cliente llega así: el servidor
    // corta la conexión después del handshake, sin una alerta que Node informe.
    return c.conTls
      ? `La conexión con ${c.host} se cortó antes de recibir la respuesta. Si el servidor rechazó el certificado digital, revisa que esté vigente y que se envíe su cadena completa.`
      : `La conexión con ${c.host} se cortó antes de recibir la respuesta completa.`;
  }
  return `No se pudo conectar con ${c.host}.`;
}
