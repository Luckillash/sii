// Navegación HTTP con la sesión AUT2000 por los asistentes web del SII: sigue
// redirecciones a mano revisando cada destino ANTES de enviarle nada, y detecta
// cuándo el SII devolvió el login. La comparten la solicitud de folios (fase 5) y
// la postulación (fase 6) (pend. 2.2: en el PHP estaba duplicada).
//
// Deriva de winex/certificacion v1.9.1 (src/Folios/SolicitudFolios.php: pedir,
// resolverUrl, sesionVigente; src/Postulacion/NavegadorSii.php: pedir,
// resolverUrl, sesionVigente), © 2026 Meniaz (William Menares), Apache-2.0.
// Modificado: port a TypeScript y unificación. Las dos reglas de `form()` NO se
// unifican: cada asistente tiene la suya.

import { trimPhp } from './codificacion.ts';
import { SesionCaducaError } from './errores.ts';
import type { RespuestaHttp } from './http/respuesta.ts';
import type { CuerpoHttp, IdentidadTls, MetodoHttp, TransporteHttp } from './http/transporte.ts';

/** User-Agent de navegador que el PHP envía a los asistentes (folios y postulación), tal cual. */
export const USER_AGENT_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Redirecciones que se siguen como máximo (después de la petición inicial). */
export const MAX_REDIRECCIONES = 10;

/** Textos que delatan que el SII devolvió (o redirigió a) el login. */
export const MARCADORES_LOGIN: readonly string[] = [
  'autInicioDTE',
  'IngresoCertificado',
  'InicioAutenticacion',
  'CAutInicio.cgi',
  'CAutValida',
];

/** Interfaz mínima de la sesión que necesita la navegación (la implementa `SesionSii`). */
export interface SesionNavegacion {
  cabeceraPara(url: string): string | null;
  recibir(url: string, respuesta: RespuestaHttp): void;
}

/**
 * @throws SesionCaducaError si `texto` (una URL o una página) trae un marcador del
 *   login: la sesión ya no sirve y hay que volver a autenticar.
 */
export function exigirSesionVigente(texto: string): void {
  for (const marcador of MARCADORES_LOGIN) {
    if (texto.includes(marcador)) {
      throw new SesionCaducaError('La sesión del SII caducó; hay que volver a autenticar.');
    }
  }
}

/**
 * `parse_url()` de PHP, solo lo que usa `resolverUrl`: esquema, host (sin
 * usuario ni puerto) y ruta.
 */
function partesUrl(url: string): { esquema?: string; host?: string; ruta?: string } {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(url);
  if (m === null) return {};
  let autoridad = m[2] as string;
  const arroba = autoridad.lastIndexOf('@');
  if (arroba >= 0) autoridad = autoridad.slice(arroba + 1);
  const host = autoridad.startsWith('[')
    ? autoridad.slice(0, autoridad.indexOf(']') + 1)
    : autoridad.replace(/:\d*$/, '');
  const ruta = m[3] as string;
  return {
    esquema: m[1] as string,
    ...(host !== '' ? { host } : {}),
    ...(ruta !== '' ? { ruta } : {}),
  };
}

/**
 * Resuelve `ref` (absoluta, `//host`, `/ruta` o relativa) contra `desde`, igual
 * que el PHP: sin quitar `.`/`..` (lo hace el cliente HTTP al enviar, igual que
 * cURL), sin conservar el puerto de `desde` y con `?q` relativo al directorio.
 */
export function resolverUrl(desde: string, ref: string): string {
  const r = trimPhp(ref);
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return r;

  const partes = partesUrl(desde);
  const esquema = partes.esquema ?? 'https';
  if (r.startsWith('//')) return `${esquema}:${r}`;

  const raiz = `${esquema}://${partes.host ?? ''}`;
  if (r.startsWith('/')) return raiz + r;

  const ruta = partes.ruta ?? '/';
  return raiz + ruta.slice(0, ruta.lastIndexOf('/') + 1) + r;
}

export interface PeticionNavegacion {
  readonly metodo: MetodoHttp;
  readonly url: string;
  readonly cuerpo?: CuerpoHttp;
  /** Cabeceras propias (Referer, Origin...). Se conservan en cada salto; `Referer` se actualiza. */
  readonly cabeceras: Readonly<Record<string, string>>;
  /** Certificado de cliente: se envía en la petición inicial y en cada redirección. */
  readonly tls?: IdentidadTls;
  readonly msRespuesta: number;
  /**
   * Conexión propia para las peticiones que llevan cuerpo (el POST inicial, y el
   * mismo POST si una 307/308 lo repite). Para las órdenes que no se pueden
   * repetir: timbrar folios, grabar la declaración.
   */
  readonly conexionNueva?: boolean;
  /** Se llama con la URL inicial y con cada destino ANTES de enviarle nada; lanza para detener. */
  readonly revisar: (url: string) => void;
  /** Error para "demasiadas redirecciones" (cada asistente lanza el suyo). */
  readonly errorRedirecciones: (mensaje: string) => Error;
}

function tieneCabecera(cabeceras: Readonly<Record<string, string>>, nombre: string): boolean {
  return Object.keys(cabeceras).some((k) => k.toLowerCase() === nombre.toLowerCase());
}

/**
 * Envía y sigue redirecciones a mano (`pedir()` del PHP). Como los navegadores:
 * 301/302/303 tras un POST siguen con GET sin cuerpo; 307/308 repiten el método
 * y el cuerpo.
 *
 * En cada petición agrega `User-Agent` (si no viene), `Accept: *\/*` (si no
 * viene: cURL lo agrega siempre) y la `Cookie` de la sesión para esa URL. Guarda
 * las `Set-Cookie` de cada respuesta, también de las redirecciones.
 *
 * Devuelve la respuesta final con cualquier código HTTP: revisarlo es tarea de
 * quien llama.
 */
export async function navegar(
  transporte: TransporteHttp,
  sesion: SesionNavegacion,
  peticion: PeticionNavegacion,
): Promise<RespuestaHttp> {
  let { metodo, url, cuerpo } = peticion;
  let cabeceras: Record<string, string> = { ...peticion.cabeceras };

  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    peticion.revisar(url);

    const enviar: Record<string, string> = { ...cabeceras };
    if (!tieneCabecera(enviar, 'User-Agent')) enviar['User-Agent'] = USER_AGENT_NAVEGADOR;
    if (!tieneCabecera(enviar, 'Accept')) enviar.Accept = '*/*';
    const cookie = sesion.cabeceraPara(url);
    if (cookie !== null) enviar.Cookie = cookie;

    const respuesta = await transporte.enviar({
      metodo,
      url,
      cabeceras: enviar,
      ...(cuerpo !== undefined ? { cuerpo } : {}),
      ...(peticion.tls !== undefined ? { tls: peticion.tls } : {}),
      msRespuesta: peticion.msRespuesta,
      conexionNueva: peticion.conexionNueva === true && cuerpo !== undefined,
    });
    sesion.recibir(url, respuesta);

    if (!respuesta.esRedireccion()) return respuesta;

    const anterior = url;
    url = resolverUrl(anterior, respuesta.cabecera('location')[0] as string);
    cabeceras = { ...cabeceras, Referer: anterior };

    if (respuesta.status !== 307 && respuesta.status !== 308) {
      metodo = 'GET';
      cuerpo = undefined;
    }
  }

  throw peticion.errorRedirecciones('El SII redirigió demasiadas veces.');
}
