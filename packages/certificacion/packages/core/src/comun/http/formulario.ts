// Cuerpo application/x-www-form-urlencoded idéntico, byte a byte, al de
// `http_build_query()` de PHP con sus opciones por defecto, que es lo que usa
// winex/certificacion v1.9.1 (src/Folios/TransporteCurl.php y
// src/Postulacion/DeclaracionBoletas.php), © 2026 Meniaz (William Menares),
// Apache-2.0. Modificado: port a TypeScript.
//
// Reglas de `http_build_query($datos)` (PHP_QUERY_RFC1738, separador `&`):
// - Cada byte se codifica como `urlencode()`: quedan tal cual `A-Z a-z 0-9 - _ .`;
//   el espacio pasa a `+`; todo lo demás (incluidos `~` y `*`) a `%XX` en
//   mayúsculas. Se codifican bytes, no caracteres: una `á` en UTF-8 sale `%C3%A1`
//   y en ISO-8859-1 sale `%E1`.
// - Los pares salen en el orden en que se entregan.
//
// Diferencias deliberadas con PHP (no cambian bytes en los usos del core):
// - Solo acepta valores `string` (se codifican en UTF-8) o bytes (`Uint8Array` /
//   `Buffer`, tal cual). PHP además convierte `true`→`1`, `false`→`0`, omite
//   `null` y expande arreglos anidados (`a%5B0%5D=...`); nada de eso se usa al
//   hablar con el SII.
// - Una lista de pares admite claves repetidas (un arreglo de PHP no puede tenerlas).
//
// Ojo con los objetos de JS: ponen primero las claves con forma de entero
// (`{ b: 1, '2': 2 }` se recorre como `2, b`), a diferencia de los arreglos de
// PHP, que conservan el orden de inserción. Si el orden importa y hay claves
// numéricas, entrega una lista de pares o un `Map`.

/** Clave o valor de un formulario: texto (se envía en UTF-8) o bytes tal cual. */
export type ValorFormulario = string | Uint8Array;

/**
 * Campos de un formulario: lista de pares, `Map` u objeto. Para enviar valores en
 * ISO-8859-1 (como hace la postulación del SII), conviértelos antes a bytes.
 */
export type CamposFormulario =
  | Iterable<readonly [ValorFormulario, ValorFormulario]>
  | Readonly<Record<string, ValorFormulario>>;

const HEX = '0123456789ABCDEF';

function sinCodificar(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    byte === 0x2d || // -
    byte === 0x2e || // .
    byte === 0x5f // _
  );
}

/** Igual que `urlencode()` de PHP, sobre los bytes del valor. */
export function codificarUrl(valor: ValorFormulario): string {
  const bytes = typeof valor === 'string' ? Buffer.from(valor, 'utf8') : valor;
  let salida = '';
  for (const byte of bytes) {
    if (sinCodificar(byte)) {
      salida += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      salida += '+';
    } else {
      salida += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`;
    }
  }
  return salida;
}

function esIterable(
  campos: CamposFormulario,
): campos is Iterable<readonly [ValorFormulario, ValorFormulario]> {
  return typeof (campos as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function';
}

/**
 * Igual que `http_build_query()` de PHP. Devuelve texto ASCII, que sirve tanto de
 * cuerpo `application/x-www-form-urlencoded` como de query string.
 */
export function codificarFormulario(campos: CamposFormulario): string {
  const pares = esIterable(campos) ? campos : Object.entries(campos);
  const partes: string[] = [];
  for (const [clave, valor] of pares) {
    partes.push(`${codificarUrl(clave)}=${codificarUrl(valor)}`);
  }
  return partes.join('&');
}
