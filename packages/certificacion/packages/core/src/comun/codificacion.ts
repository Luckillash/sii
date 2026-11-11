// Deriva de winex/certificacion v1.9.1 (src/Core/Timbre.php, src/Core/GeneradorBoleta.php,
// src/Certificacion/SiiSoapClient.php, src/Folios/SolicitudFolios.php), © 2026 Meniaz
// (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Equivalentes exactos de las funciones de texto de PHP que usa el core:
// mb_convert_encoding, mb_check_encoding, mb_substr, mb_strlen y las tres
// variantes de htmlspecialchars. Verificado contra PHP 8.3 (golden tests en
// paridad/casos/codificacion-* y xml-escapar-*).
//
// Modelo: en PHP los strings son bytes (UTF-8 por convención del core); aquí son
// Unicode. Un string JS bien formado equivale a su UTF-8. Un surrogate suelto (que
// no tiene UTF-8 válido) se trata como un code point inválido más: PHP lo vería
// como bytes inválidos y los reemplaza igual que aquí (se indica en cada función).

import { isUtf8 } from 'node:buffer';

/** Surrogates sueltos (sin su pareja). */
const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * `mb_convert_encoding($texto, 'ISO-8859-1', 'UTF-8')`: cada code point hasta
 * U+00FF pasa a su byte; cualquier otro (€, emoji, CJK, surrogate suelto) se
 * vuelve UN `?` (0x3F) por code point.
 *
 * No equivale a `Buffer.from(texto, 'latin1')`, que toma el byte bajo de cada
 * unidad UTF-16 (`€` → 0xAC) y parte los emoji en dos bytes.
 */
export function aIso88591(texto: string): Buffer {
  const bytes: number[] = [];
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0x3f;
    bytes.push(codigo <= 0xff ? codigo : 0x3f);
  }
  return Buffer.from(bytes);
}

/** `mb_convert_encoding($bytes, 'UTF-8', 'ISO-8859-1')`: cada byte es el code point U+00XX. */
export function desdeIso88591(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/**
 * `mb_check_encoding($bytes, 'UTF-8')`: UTF-8 estricto. Rechaza secuencias
 * truncadas, formas sobrelargas, surrogates (ED A0 80…) y valores mayores que
 * U+10FFFF; acepta los no-caracteres (U+FFFE) y el buffer vacío.
 */
export function esUtf8Valido(bytes: Uint8Array): boolean {
  return isUtf8(bytes);
}

/**
 * Decodifica bytes que pueden venir en UTF-8 o en ISO-8859-1, como hacen
 * `Timbre::__construct` (CAF con tildes sin declarar) y `SolicitudFolios`:
 *
 * ```php
 * if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1');
 * ```
 *
 * El BOM UTF-8, si viene, se conserva (PHP tampoco lo quita).
 */
export function decodificarUtf8OIso(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return esUtf8Valido(buffer) ? buffer.toString('utf8') : buffer.toString('latin1');
}

/**
 * `mb_substr($texto, 0, $largo)`: los primeros `largo` code points (no unidades
 * UTF-16: un emoji cuenta como uno y nunca queda partido).
 */
export function truncarCodePoints(texto: string, largo: number): string {
  if (largo <= 0) return '';
  let resultado = '';
  let n = 0;
  for (const caracter of texto) {
    if (n === largo) break;
    resultado += caracter;
    n++;
  }
  return resultado;
}

/** `mb_strlen($texto)`: cantidad de code points. */
export function largoCodePoints(texto: string): number {
  let n = 0;
  for (const _ of texto) n++;
  return n;
}

/**
 * Variante de `htmlspecialchars` que replica {@link escaparXml}:
 *
 * | Modo | PHP | Escapa |
 * |---|---|---|
 * | `'xml1-iso-8859-1'` | `htmlspecialchars($s, ENT_XML1, 'ISO-8859-1')` (GeneradorBoleta) | `&` `<` `>` |
 * | `'xml1-sustituir'` | `htmlspecialchars($s, ENT_XML1 \| ENT_SUBSTITUTE, 'UTF-8')` (Timbre) | `&` `<` `>`; surrogates sueltos → U+FFFD |
 * | `'defecto'` | `htmlspecialchars($s)` (SiiSoapClient) | `&` `<` `>` `"`→`&quot;` `'`→`&#039;`; surrogates sueltos → U+FFFD |
 *
 * Pasar solo `ENT_XML1` deja en cero los bits de comillas (equivale a
 * `ENT_NOQUOTES`): por eso los dos primeros modos no tocan `"` ni `'`. Ninguno
 * toca `\t`, `\r`, `\n`, caracteres de control ni caracteres fuera de
 * ISO-8859-1, y todos escapan de nuevo las entidades ya escritas (`&amp;` →
 * `&amp;amp;`, `&#233;` → `&amp;#233;`), porque `double_encode` es `true` por
 * defecto.
 */
export type ModoEscape = 'xml1-iso-8859-1' | 'xml1-sustituir' | 'defecto';

/**
 * Escapa texto para XML exactamente como la variante de `htmlspecialchars`
 * indicada en `modo` (ver {@link ModoEscape}).
 *
 * En `'xml1-sustituir'` y `'defecto'` (charset UTF-8 con `ENT_SUBSTITUTE`) PHP
 * reemplaza cada secuencia UTF-8 inválida por U+FFFD; el equivalente en un string
 * JS es un surrogate suelto. En `'xml1-iso-8859-1'` todo byte es válido y nada
 * se reemplaza.
 */
export function escaparXml(texto: string, modo: ModoEscape): string {
  let resultado = texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (modo === 'defecto') {
    resultado = resultado.replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  if (modo !== 'xml1-iso-8859-1') {
    resultado = resultado.replace(SURROGATE_SUELTO, '\u{FFFD}');
  }
  return resultado;
}

/** Minúsculas solo en ASCII, como libxml y `strtolower()` de PHP 8 (`toLowerCase` toca también Unicode). */
export function minusculasAscii(texto: string): string {
  return texto.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** `trim()` de PHP: quita solo espacio, \t, \n, \r, \0 y \v (no los blancos Unicode que quita `String#trim`). */
export function trimPhp(texto: string): string {
  return texto.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
}
