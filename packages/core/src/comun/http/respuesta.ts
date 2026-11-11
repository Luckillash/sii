// Deriva de winex/certificacion v1.9.1 (src/Folios/RespuestaHttp.php), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Además agrega `exigirStatus()` (pend. 1.9: el PHP no revisaba los códigos HTTP
// en los canales SOAP y REST).

import { ErrorTransporte } from '../errores.ts';

/** Cabeceras de respuesta tal como se entregan al construir una `RespuestaHttp`. */
export type CabecerasEntrada =
  | Iterable<readonly [string, string | readonly string[]]>
  | Readonly<Record<string, string | readonly string[]>>;

const REDIRECCIONES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Respuesta HTTP completa. El cuerpo va en bytes: el SII responde a veces en
 * ISO-8859-1 y decodificarlo es tarea de quien llama.
 */
export class RespuestaHttp {
  readonly status: number;
  /** Nombres en minúsculas; cada cabecera con todos sus valores, en orden de llegada. */
  readonly cabeceras: ReadonlyMap<string, readonly string[]>;
  readonly cuerpo: Buffer;

  /**
   * @param cabeceras nombres en cualquier capitalización (se pasan a minúsculas y se
   *   juntan los repetidos); un valor suelto equivale a una lista de uno.
   * @param cuerpo un string se guarda en UTF-8.
   */
  constructor(status: number, cabeceras: CabecerasEntrada = {}, cuerpo: string | Uint8Array = '') {
    this.status = status;

    const mapa = new Map<string, string[]>();
    const entradas =
      typeof (cabeceras as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function'
        ? (cabeceras as Iterable<readonly [string, string | readonly string[]]>)
        : Object.entries(cabeceras as Readonly<Record<string, string | readonly string[]>>);
    for (const [nombre, valor] of entradas) {
      const clave = nombre.toLowerCase();
      const lista = mapa.get(clave) ?? [];
      if (typeof valor === 'string') lista.push(valor);
      else lista.push(...valor);
      mapa.set(clave, lista);
    }
    this.cabeceras = mapa;

    this.cuerpo =
      typeof cuerpo === 'string'
        ? Buffer.from(cuerpo, 'utf8')
        : Buffer.isBuffer(cuerpo)
          ? cuerpo
          : Buffer.from(cuerpo.buffer, cuerpo.byteOffset, cuerpo.byteLength);
  }

  /** Todos los valores de la cabecera (vacío si no vino), p. ej. cada `set-cookie`. */
  cabecera(nombre: string): readonly string[] {
    return this.cabeceras.get(nombre.toLowerCase()) ?? [];
  }

  /** 301/302/303/307/308 con `Location`. Nadie sigue redirecciones solo: lo decide quien llama. */
  esRedireccion(): boolean {
    return REDIRECCIONES.has(this.status) && this.cabecera('location').length > 0;
  }
}

/** Host de una URL para los mensajes, o la URL entera si no se puede leer. */
export function hostDe(url: string | URL): string {
  try {
    return (typeof url === 'string' ? new URL(url) : url).host;
  } catch {
    return String(url);
  }
}

/**
 * URL para `ErrorTransporte.url`: origen y ruta, sin query, fragmento ni
 * credenciales (la query de algunas URLs del SII lleva RUTs).
 */
export function urlSinQuery(url: string | URL): string {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Exige que el código HTTP sea uno de los esperados (pend. 1.9). El transporte
 * entrega cualquier código (folios necesita ver los 302); los clientes llaman a
 * esto donde corresponde.
 *
 * @throws ErrorTransporte con `status` = el código recibido.
 */
export function exigirStatus(
  respuesta: RespuestaHttp,
  url: string | URL,
  esperados: number | readonly number[] = 200,
): RespuestaHttp {
  const lista = typeof esperados === 'number' ? [esperados] : esperados;
  if (lista.includes(respuesta.status)) return respuesta;

  const esperado =
    lista.length === 1 ? String(lista[0]) : `${lista.slice(0, -1).join(', ')} o ${lista.at(-1)}`;
  throw new ErrorTransporte(
    `${hostDe(url)} respondió HTTP ${respuesta.status} (se esperaba ${esperado}).`,
    urlSinQuery(url),
    respuesta.status,
  );
}
