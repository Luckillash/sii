// Navegación HTTP con la sesión AUT2000 contra UN host del SII (maullin para la
// postulación, www4 para la declaración de cumplimiento), más las dos lecturas de
// HTML propias de la postulación: `form()` y `texto()`.
//
// Deriva de winex/certificacion v1.9.1 (src/Postulacion/NavegadorSii.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Cambios respecto del PHP (ninguno cambia bytes enviados al SII):
// - pend. 2.2: el bucle de redirecciones, `resolverUrl` y `sesionVigente` son los
//   de `comun/navegacion-sii.ts`, compartidos con folios. `form()` NO se unifica
//   con el de folios: esta regla es otra (ver `formularioPostulacion`).
// - Candado del host más estricto, como folios: además de https y host exacto,
//   rechaza URLs con puerto o con usuario/contraseña (solo cambia el camino de error).
// - pend. 1.9: `pagina()` exige HTTP 200 (el PHP no miraba el código). `pedir()`
//   sigue devolviendo cualquier código: lo revisa quien llama.
// - Las fallas de red salen como `ErrorTransporte` (el PHP las envolvía en
//   `PostulacionException`): quien llama decide si son reintentables.
// - `texto()` replica `strip_tags`, `html_entity_decode(ENT_QUOTES | ENT_HTML5)`,
//   el `\s` de PCRE con `/u` y `mb_substr` de PHP 8.3, medidos contra el PHP (casos
//   `texto-html-*`): en la postulación ese texto decide si un paso fue rechazado y
//   si la postulación quedó aceptada.

import { decodificarUtf8OIso, minusculasAscii, trimPhp } from '../comun/codificacion.ts';
import { decodificarEntidadesHtml5 } from '../comun/entidades-html5.ts';
import { ErrorPostulacion } from '../comun/errores.ts';
import { atributo, elementosPorNombre, parsearHtml } from '../comun/html.ts';
import type { CamposFormulario } from '../comun/http/formulario.ts';
import { exigirStatus, type RespuestaHttp } from '../comun/http/respuesta.ts';
import type { CuerpoHttp, MetodoHttp, TransporteHttp } from '../comun/http/transporte.ts';
import {
  exigirSesionVigente,
  navegar,
  resolverUrl,
  type SesionNavegacion,
} from '../comun/navegacion-sii.ts';

/** Campos de un formulario, en orden (como un arreglo asociativo de PHP). */
export type CamposPostulacion = Map<string, string>;

/** El primer `<form>` de una página: `action` y lo que un navegador enviaría. */
export interface FormularioPostulacion {
  readonly action: string;
  readonly inputs: CamposPostulacion;
}

export interface PeticionNavegador {
  readonly metodo: MetodoHttp;
  /** Tiene que ser https del host del navegador (sin puerto ni usuario). */
  readonly url: string;
  /**
   * Formulario (`{ tipo: 'formulario', campos }`, urlencoded igual que
   * `http_build_query`) o cuerpo crudo con su Content-Type (`{ tipo: 'crudo',
   * datos, contentType }`, p. ej. GWT-RPC con `text/x-gwt-rpc; charset=UTF-8`).
   */
  readonly cuerpo?: CuerpoHttp | null;
  /** Cabeceras propias (Referer, Origin, X-GWT-*...). `User-Agent`, `Accept` y `Cookie` se agregan solos. */
  readonly cabeceras?: Readonly<Record<string, string>>;
  readonly msRespuesta: number;
  /**
   * Conexión propia para el POST (y para el mismo POST si una 307/308 lo repite):
   * para las órdenes que no se deben repetir a ciegas (grabar la postulación o la
   * declaración).
   */
  readonly conexionNueva?: boolean;
}

export interface PeticionPagina {
  readonly metodo: MetodoHttp;
  readonly url: string;
  /** Campos urlencoded, o `null` para un GET sin cuerpo. */
  readonly formulario: CamposFormulario | null;
  readonly referer: string;
  readonly msRespuesta: number;
  readonly conexionNueva?: boolean;
}

/**
 * HTTP con la sesión AUT2000 contra UN host del SII: sigue redirecciones a mano y
 * corta si alguna sale de ese host (o cae en el login) ANTES de enviarle nada.
 *
 * Lo usan `PostulacionSii` (maullin) y `DeclaracionBoletas` (www4).
 */
export class NavegadorSii {
  readonly host: string;
  readonly #transporte: TransporteHttp;

  /** @param host host exacto, en minúsculas (p. ej. `maullin.sii.cl`). */
  constructor(transporte: TransporteHttp, host: string) {
    this.#transporte = transporte;
    this.host = minusculasAscii(host);
  }

  /**
   * Envía a `url` (tiene que ser del host) y devuelve la respuesta final, con
   * cualquier código HTTP (revisarlo es tarea de quien llama).
   *
   * @throws SesionCaducaError si la URL o una redirección apunta al login
   * @throws ErrorPostulacion si apunta fuera del host o hay más de 10 redirecciones
   * @throws ErrorTransporte si falla la red, el TLS o se agota el tiempo
   */
  pedir(sesion: SesionNavegacion, peticion: PeticionNavegador): Promise<RespuestaHttp> {
    return navegar(this.#transporte, sesion, {
      metodo: peticion.metodo,
      url: peticion.url,
      ...(peticion.cuerpo !== undefined && peticion.cuerpo !== null
        ? { cuerpo: peticion.cuerpo }
        : {}),
      cabeceras: peticion.cabeceras ?? {},
      msRespuesta: peticion.msRespuesta,
      ...(peticion.conexionNueva === true ? { conexionNueva: true } : {}),
      revisar: (destino) => this.#soloHost(destino),
      errorRedirecciones: (mensaje) => new ErrorPostulacion(mensaje),
    });
  }

  /**
   * Página HTML del asistente, en texto: UTF-8, o ISO-8859-1 si no es UTF-8
   * válido (`mb_check_encoding` + `mb_convert_encoding` del PHP).
   *
   * @throws SesionCaducaError si la página es (o manda a) el login
   * @throws ErrorTransporte si la respuesta final no es HTTP 200, o falla la red
   * @throws ErrorPostulacion si una redirección sale del host
   */
  async pagina(sesion: SesionNavegacion, peticion: PeticionPagina): Promise<string> {
    const respuesta = await this.pedir(sesion, {
      metodo: peticion.metodo,
      url: peticion.url,
      cuerpo:
        peticion.formulario === null ? null : { tipo: 'formulario', campos: peticion.formulario },
      cabeceras: { Referer: peticion.referer },
      msRespuesta: peticion.msRespuesta,
      ...(peticion.conexionNueva === true ? { conexionNueva: true } : {}),
    });
    const html = decodificarUtf8OIso(respuesta.cuerpo);
    this.sesionVigente(html);
    exigirStatus(respuesta, peticion.url, 200);
    return html;
  }

  /** @throws SesionCaducaError si `texto` (una URL o una página) delata el login. */
  sesionVigente(texto: string): void {
    exigirSesionVigente(texto);
  }

  /** Primer `<form>` de la página con la regla de la postulación (ver {@link formularioPostulacion}). */
  static form(html: string): FormularioPostulacion | null {
    return formularioPostulacion(html);
  }

  /** Texto visible de la página, recortado (ver {@link textoPostulacion}). */
  static texto(html: string, max = 300): string {
    return textoPostulacion(html, max);
  }

  /** Resuelve `ref` contra `desde`, igual que el PHP (compartido con folios). */
  static resolverUrl(desde: string, ref: string): string {
    return resolverUrl(desde, ref);
  }

  /** Solo el host del navegador, por https, sin puerto ni usuario (y sin el login en la URL). */
  #soloHost(url: string): void {
    exigirSesionVigente(url);
    const u = leerUrl(url);
    if (
      u === null ||
      u.protocol !== 'https:' ||
      u.hostname !== this.host ||
      u.port !== '' ||
      u.username !== '' ||
      u.password !== ''
    ) {
      throw new ErrorPostulacion(`Operación detenida: el SII apuntó fuera de ${this.host}.`);
    }
  }
}

function leerUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// --- form() -------------------------------------------------------------------------

const TIPOS_SIN_VALOR: ReadonlySet<string> = new Set(['button', 'reset', 'submit', 'image']);

/**
 * Primer `<form>` de la página con la regla de `NavegadorSii::form()` (lo que un
 * navegador enviaría):
 * - solo `<input>` con `name`, sin `disabled`, y que no sean button, reset,
 *   submit ni image;
 * - checkbox y radio solo si vienen marcados (`checked`);
 * - el valor con `trim()` de PHP;
 * - NO lee `<select>` (la regla de folios sí: no se unifican).
 * Un nombre repetido se queda en su primera posición con el último valor.
 *
 * Devuelve null si la página no tiene `<form>`.
 */
export function formularioPostulacion(html: string): FormularioPostulacion | null {
  const raiz = parsearHtml(html);
  const form = elementosPorNombre(raiz, 'form')[0];
  if (form === undefined) return null;

  const inputs: CamposPostulacion = new Map();
  for (const el of elementosPorNombre(form, 'input')) {
    const nombre = atributo(el, 'name');
    const tipo = minusculasAscii(atributo(el, 'type'));
    if (nombre === '' || el.atributos.has('disabled') || TIPOS_SIN_VALOR.has(tipo)) continue;
    if ((tipo === 'checkbox' || tipo === 'radio') && !el.atributos.has('checked')) continue;
    inputs.set(nombre, trimPhp(atributo(el, 'value')));
  }

  return { action: atributo(form, 'action'), inputs };
}

// --- texto() ------------------------------------------------------------------------

/**
 * Lo que `\s` reconoce en una expresión de PHP con `/u` (PCRE2 10.42 con UCP, la
 * del PHP 8.3 que generó los esperados): los blancos ASCII, U+0085, U+00A0,
 * U+1680, U+180E, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F y U+3000.
 */
export const ESPACIO_PCRE_UNICODE =
  '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';

const BLANCOS = new RegExp(`${ESPACIO_PCRE_UNICODE}+`, 'gu');
const SCRIPTS = /<(script|style)\b[\s\S]*?<\/\1>/gi;
const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Texto visible de una página (`NavegadorSii::texto()`), en este orden:
 * 1. quita `<script>…</script>` y `<style>…</style>` con su contenido (sin
 *    distinguir mayúsculas; uno sin cierre queda);
 * 2. `strip_tags()` de PHP (ver {@link stripTagsPhp});
 * 3. `html_entity_decode(ENT_QUOTES | ENT_HTML5)` (tabla completa de HTML5);
 * 4. colapsa a un espacio cada tramo de blancos de `\s` con `/u` (incluye el
 *    `&nbsp;` ya decodificado; ver {@link ESPACIO_PCRE_UNICODE}) y aplica `trim()`;
 * 5. `mb_substr($texto, 0, $max)` (por code points).
 *
 * Si queda algún surrogate suelto (UTF-8 inválido para PHP), el `preg_replace`
 * del PHP falla y el texto queda vacío: aquí también.
 *
 * @param max caracteres; `Infinity` equivale al `PHP_INT_MAX` del PHP.
 */
export function textoPostulacion(html: string, max = 300): string {
  const sinScripts = html.replace(SCRIPTS, ' ');
  const decodificado = decodificarEntidadesHtml5(stripTagsPhp(sinScripts));
  if (SURROGATE_SUELTO.test(decodificado)) return '';
  const texto = trimPhp(decodificado.replace(BLANCOS, ' '));
  if (max <= 0) return '';
  let salida = '';
  let n = 0;
  for (const caracter of texto) {
    if (n >= max) break;
    salida += caracter;
    n++;
  }
  return salida;
}

/** `isspace()` de C en la configuración regional "C". */
function esEspacioC(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';
}

/**
 * `strip_tags($html)` de PHP 8.3 (sin etiquetas permitidas), con su máquina de
 * estados (`php_strip_tags_ex`): no es un "quitar `<...>`" simple. Lo que importa
 * para el texto del SII:
 * - un `<` seguido de un blanco no abre etiqueta y queda en el texto;
 * - dentro de una etiqueta, las comillas protegen los `>` y un `<` suelto anida;
 * - `<!-- ... -->` es comentario (termina solo en `-->`), `<!...>` y `<!DOCTYPE>`
 *   se quitan, `<? ... ?>` es código (con paréntesis y comillas);
 * - un `>` suelto fuera de etiqueta queda, y los NUL se quitan;
 * - lo que quede abierto al final se pierde.
 *
 * Trabaja sobre unidades UTF-16: todos los caracteres que mira son ASCII, y en
 * UTF-8 ningún byte de un carácter multibyte es ASCII, así que equivale a los bytes
 * del PHP. Verificado contra PHP con entradas al azar y en los casos `texto-html-*`.
 */
export function stripTagsPhp(html: string): string {
  let salida = '';
  let estado = 0;
  let profundidad = 0;
  let comilla = ''; // in_q: '' o la comilla abierta
  let lc = '';
  let parentesis = 0; // br
  let esXml = false;
  const n = html.length;
  const en = (i: number): string => (i >= 0 && i < n ? (html[i] as string) : '\0');
  const alternarComilla = (c: string): void => {
    comilla = comilla !== '' ? '' : c;
  };

  for (let p = 0; p < n; p++) {
    const c = html[p] as string;
    switch (estado) {
      case 0:
        if (c === '\0') break;
        if (c === '<') {
          if (comilla !== '') break;
          if (esEspacioC(en(p + 1))) {
            salida += c;
            break;
          }
          lc = '<';
          estado = 1;
          break;
        }
        if (c === '>') {
          if (profundidad > 0) {
            profundidad--;
            break;
          }
          if (comilla !== '') break;
        }
        salida += c;
        break;

      case 1:
        if (c === '<') {
          if (comilla !== '') break;
          if (esEspacioC(en(p + 1))) break;
          profundidad++;
        } else if (c === '>') {
          if (profundidad > 0) {
            profundidad--;
            break;
          }
          if (comilla !== '') break;
          lc = '>';
          if (esXml && en(p - 1) === '-') break;
          comilla = '';
          estado = 0;
          esXml = false;
        } else if (c === '"' || c === "'") {
          if (p !== 0 && (comilla === '' || c === comilla)) alternarComilla(c);
        } else if (c === '!') {
          if (en(p - 1) === '<') {
            estado = 3;
            lc = c;
          }
        } else if (c === '?') {
          if (en(p - 1) === '<') {
            parentesis = 0;
            estado = 2;
          }
        }
        break;

      case 2:
        if (c === '(') {
          if (lc !== '"' && lc !== "'") {
            lc = '(';
            parentesis++;
          }
        } else if (c === ')') {
          if (lc !== '"' && lc !== "'") {
            lc = ')';
            parentesis--;
          }
        } else if (c === '>') {
          if (profundidad > 0) {
            profundidad--;
            break;
          }
          if (comilla !== '') break;
          if (parentesis === 0 && p >= 1 && lc !== '"' && en(p - 1) === '?') {
            comilla = '';
            estado = 0;
          }
        } else if (c === '"' || c === "'") {
          if (p >= 1 && en(p - 1) !== '\\') {
            if (lc === c) lc = '\0';
            else if (lc !== '\\') lc = c;
            if (p !== 0 && (comilla === '' || c === comilla)) alternarComilla(c);
          }
        } else if (c === 'l' || c === 'L') {
          // `<?xml` (no al comienzo exacto del texto: el PHP exige p > buf + 4).
          if (
            p > 4 &&
            (en(p - 1) === 'm' || en(p - 1) === 'M') &&
            (en(p - 2) === 'x' || en(p - 2) === 'X') &&
            en(p - 3) === '?' &&
            en(p - 4) === '<'
          ) {
            estado = 1;
            esXml = true;
          }
        }
        break;

      case 3:
        if (c === '>') {
          if (profundidad > 0) {
            profundidad--;
            break;
          }
          if (comilla !== '') break;
          comilla = '';
          estado = 0;
        } else if (c === '"' || c === "'") {
          if (p !== 0 && en(p - 1) !== '\\' && (comilla === '' || c === comilla)) {
            alternarComilla(c);
          }
        } else if (c === '-') {
          if (p >= 2 && en(p - 1) === '-' && en(p - 2) === '!') estado = 4;
        } else if (c === 'E' || c === 'e') {
          // `<!DOCTYPE`: se trata como una etiqueta común.
          if (p > 6 && minusculasAscii(html.slice(p - 6, p)) === 'doctyp') estado = 1;
        }
        break;

      default:
        // 4: comentario, hasta `-->` fuera de comillas.
        if (c === '>' && comilla === '' && p >= 2 && en(p - 1) === '-' && en(p - 2) === '-') {
          comilla = '';
          estado = 0;
        }
        break;
    }
  }
  return salida;
}

// --- comparación sin mayúsculas -------------------------------------------------------

/**
 * Plegado simple de mayúsculas de `mb_stripos` (PHP 8.3), por code point. Calza
 * con el del PHP en todos los caracteres salvo los agregados a Unicode después de
 * sus tablas (ninguno se pliega a una letra latina). `ı` (U+0131) no se pliega a
 * `i`, igual que en el PHP.
 */
function plegar(texto: string): string {
  let salida = '';
  for (const c of texto) {
    if (c === 'ı') {
      salida += c;
      continue;
    }
    const mayuscula = c.toUpperCase();
    let minuscula = [...mayuscula].length === 1 ? mayuscula.toLowerCase() : c.toLowerCase();
    if ([...minuscula].length !== 1) minuscula = c;
    salida += minuscula;
  }
  return salida;
}

/** `mb_stripos($texto, $buscado) !== false`. */
export function contieneSinMayusculas(texto: string, buscado: string): boolean {
  return plegar(texto).includes(plegar(buscado));
}
