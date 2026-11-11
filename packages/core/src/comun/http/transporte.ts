// Deriva de winex/certificacion v1.9.1 (src/Folios/TransporteHttp.php y src/Folios/TransporteCuerpoCrudo.php), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Una sola interfaz para todos los clientes del SII (SOAP DTEWS, API REST de
// boleta, folios y postulación; pend. 6.1). Una petición, sin seguir
// redirecciones ni manejar cookies: eso lo hace quien llama, para poder revisar
// cada salto (folios exige que no salga del ambiente).

import { ErrorTransporte } from '../errores.ts';
import { type CamposFormulario, codificarFormulario } from './formulario.ts';
import type { RespuestaHttp } from './respuesta.ts';

/** Tiempo máximo para abrir la conexión (TCP + TLS), en ms (pend. 6.4). */
export const MS_CONEXION_POR_DEFECTO = 10_000;
/** Tiempo máximo de la petición completa, en ms (pend. 6.4). */
export const MS_RESPUESTA_POR_DEFECTO = 45_000;

/**
 * `Accept-Encoding` que se envía cuando `descomprimir` está activo. cURL con
 * `CURLOPT_ENCODING => ''` anuncia todo lo que su build soporta (con el PHP 8.3
 * de Windows: `deflate, gzip, br, zstd`); aquí se anuncia solo gzip y deflate.
 */
export const ACCEPT_ENCODING = 'gzip, deflate';

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH' | 'OPTIONS';

/** Certificado de cliente para TLS mutuo, en PEM. */
export interface IdentidadTls {
  /** Certificado hoja seguido de los intermedios (cadena completa: el SII la exige). */
  readonly cert: string;
  readonly key: string;
}

/**
 * Cuerpo de la petición:
 * - `formulario`: `application/x-www-form-urlencoded`, byte a byte igual a
 *   `http_build_query()` (ver `formulario.ts`).
 * - `crudo`: se envía tal cual con su Content-Type (SOAP, GWT-RPC, XML, y el
 *   multipart armado a mano). Un string se envía en UTF-8; para otra codificación,
 *   entrega los bytes.
 */
export type CuerpoHttp =
  | { readonly tipo: 'formulario'; readonly campos: CamposFormulario }
  | { readonly tipo: 'crudo'; readonly datos: string | Uint8Array; readonly contentType: string };

export interface PeticionHttp {
  readonly metodo: MetodoHttp;
  readonly url: string | URL;
  /** Nombre → valor. Se envían en este orden y con esta capitalización (HTTP/1.1). */
  readonly cabeceras?: Readonly<Record<string, string>>;
  readonly cuerpo?: CuerpoHttp;
  /** Certificado de cliente (TLS mutuo). Solo vive en memoria: no se escribe a disco. */
  readonly tls?: IdentidadTls;
  /** Tope de la petición completa, en ms (conexión + envío + respuesta). Por defecto, el del transporte. */
  readonly msRespuesta?: number;
  readonly signal?: AbortSignal;
  /**
   * `true` (por defecto): envía `Accept-Encoding: gzip, deflate` y descomprime la
   * respuesta, como `CURLOPT_ENCODING => ''` de `TransporteCurl.php` (folios y
   * postulación). `false`: no envía `Accept-Encoding` ni descomprime, como
   * `file_get_contents` (SOAP) y el cURL de la API REST de boleta.
   * Si la petición ya trae su propia `Accept-Encoding`, se respeta.
   */
  readonly descomprimir?: boolean;
  /**
   * `true`: la petición abre una conexión propia y la cierra al terminar
   * (`Connection: close`), en vez de reutilizar una del pool. Para los POST que
   * no se pueden repetir sin consecuencias (timbrar folios, grabar la
   * declaración, subir DTE/RCOF): con una conexión reutilizada, el servidor puede
   * cerrarla justo al enviar y no se sabría si la orden llegó. Por defecto `false`.
   */
  readonly conexionNueva?: boolean;
}

/**
 * Transporte HTTP inyectable. Devuelve cualquier código HTTP (ver `exigirStatus`)
 * y no sigue redirecciones.
 */
export interface TransporteHttp {
  /** @throws ErrorTransporte si falla la red, el TLS o se agota el tiempo. */
  enviar(peticion: PeticionHttp): Promise<RespuestaHttp>;
}

/** Lo que se envía de verdad, ya armado (compartido por el transporte real y el falso). */
export interface PeticionPreparada {
  readonly metodo: MetodoHttp;
  readonly url: URL;
  /** Cabeceras finales, sin `Host` ni `Content-Length` (las pone el cliente HTTP). */
  readonly cabeceras: Readonly<Record<string, string>>;
  readonly cuerpo: Buffer | undefined;
}

/** Pone `valor` en `nombre` reemplazando, en su lugar, una cabecera con el mismo nombre en otra capitalización. */
function fijar(
  cabeceras: Record<string, string>,
  nombre: string,
  valor: string,
): Record<string, string> {
  const existente = Object.keys(cabeceras).find((k) => k.toLowerCase() === nombre.toLowerCase());
  if (existente === undefined) return { ...cabeceras, [nombre]: valor };

  // Se reconstruye para conservar la posición (como `$cabeceras['Content-Type'] = ...` en PHP).
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(cabeceras)) {
    if (k === existente) salida[nombre] = valor;
    else salida[k] = v;
  }
  return salida;
}

function tiene(cabeceras: Readonly<Record<string, string>>, nombre: string): boolean {
  return Object.keys(cabeceras).some((k) => k.toLowerCase() === nombre.toLowerCase());
}

export function leerUrl(url: string | URL): URL {
  if (url instanceof URL) return url;
  try {
    return new URL(url);
  } catch (error) {
    throw new ErrorTransporte('La URL de la petición no es válida.', '', undefined, {
      cause: error,
    });
  }
}

/**
 * Arma cabeceras y cuerpo igual que `TransporteCurl.php`: un formulario fija
 * `Content-Type: application/x-www-form-urlencoded` (reemplaza el que viniera); un
 * cuerpo crudo fija su Content-Type.
 */
export function prepararPeticion(peticion: PeticionHttp): PeticionPreparada {
  const url = leerUrl(peticion.url);
  let cabeceras: Record<string, string> = { ...peticion.cabeceras };
  let cuerpo: Buffer | undefined;

  if (peticion.cuerpo?.tipo === 'formulario') {
    cabeceras = fijar(cabeceras, 'Content-Type', 'application/x-www-form-urlencoded');
    cuerpo = Buffer.from(codificarFormulario(peticion.cuerpo.campos), 'latin1');
  } else if (peticion.cuerpo?.tipo === 'crudo') {
    const { datos, contentType } = peticion.cuerpo;
    cabeceras = fijar(cabeceras, 'Content-Type', contentType);
    cuerpo =
      typeof datos === 'string'
        ? Buffer.from(datos, 'utf8')
        : Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  }

  if ((peticion.descomprimir ?? true) && !tiene(cabeceras, 'Accept-Encoding')) {
    cabeceras['Accept-Encoding'] = ACCEPT_ENCODING;
  }

  return { metodo: peticion.metodo, url, cabeceras, cuerpo };
}
