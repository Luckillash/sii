// Deriva de winex/certificacion v1.9.1 (src/Certificacion/SetPruebasParser.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// función en lugar de clase, recibe el contenido (no una ruta), errores tipados
// y datos con nombres en español.
//
// El PHP trabaja sobre los bytes del archivo con PCRE sin `/u` (locale C). Aquí
// se trabaja sobre texto Unicode con expresiones que reconocen exactamente lo
// mismo (verificado contra PHP 8.3 en paridad/casos/set-pruebas-*):
//
// - `\s` de PCRE solo es espacio, \t, \n, VT, FF y \r. El `\s` de JS también
//   incluye NBSP (U+00A0), U+2000…U+200A, U+FEFF, etc.: por eso se usa la clase
//   explícita `B`. Un NBSP (C2 A0 en UTF-8, A0 en ISO-8859-1) no es blanco para
//   el PHP y tampoco lo es aquí.
// - `trim()` de PHP quita espacio, \t, \n, \r, NUL y VT (no FF ni NBSP).
// - `stripos` y `/i` pliegan solo ASCII. En JS, `/i` sin `/u` tampoco pliega
//   un carácter no ASCII hacia uno ASCII, y todos los patrones son ASCII.
// - `\d` y `\b` son ASCII en ambos (sin `/u`, los bytes ≥ 0x80 no son "palabra").
//
// Todos los cortes que hace el PHP caen en caracteres ASCII (blancos, comillas,
// dígitos, puntos), así que nunca parten un carácter UTF-8: el texto que
// devuelve esta función es exactamente el que el PHP entregaría a
// GeneradorBoleta, decodificado.
//
// Divergencias con el PHP (decisión del usuario, 2026-11-06), solo en el camino
// de error: donde el PHP perdía un caso o leía mal un número sin avisar, aquí se
// lanza ErrorValidacion. Una entrada que el PHP lee bien da exactamente lo mismo.
// Ver `validarEncabezados` y `validarNumeros`.

import { decodificarUtf8OIso } from '../comun/codificacion.ts';
import { ErrorValidacion } from '../comun/errores.ts';

/**
 * Ítem de un caso del set. Es compatible con el detalle que recibe el generador
 * de boletas (`{ nombre, cantidad, precio, exento?, unidad? }`).
 */
export interface DetalleSetPruebas {
  nombre: string;
  cantidad: number;
  /** Precio unitario con IVA, tal como lo trae el set. */
  precio: number;
  /** Solo presente (y `true`) si la observación del caso marca el ítem como exento. */
  exento?: boolean;
  /** Unidad de medida pedida en la observación del caso (p. ej. `Kg`). */
  unidad?: string;
}

/** Un `CASO-N` del set, listo para generar su boleta. */
export interface CasoSetPruebas {
  /** Tipo de DTE (el que se pasó a {@link parsearSetPruebas}). */
  tipo: string;
  detalles: DetalleSetPruebas[];
  /** Referencia que exige el SII: `CodRef` `SET` y `RazonRef` `CASO-N`. */
  referencia: { codigo: string; razon: string };
}

/** Blancos de `\s` en PCRE sin `/u`: espacio, \t, \n, VT, FF y \r. */
const B = '[ \\t\\n\\v\\f\\r]';
/** Lo que quita `trim()` de PHP: espacio, \t, \n, \r, NUL y VT. */
const TRIM_PHP = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/** Cada `CASO-N` con su línea de `===`, hasta el siguiente o hasta el final (`\z`). */
const BLOQUE = new RegExp(`CASO-(\\d+)${B}*\\n=+\\n([\\s\\S]*?)(?=\\nCASO-\\d+${B}*\\n=+|$)`, 'g');
/**
 * Una línea que es un encabezado de caso: solo `CASO-<n>`, con blancos (los de
 * `B`, sin `\n`) alrededor. Distingue mayúsculas, como `BLOQUE`. Se aplica
 * línea por línea y sin la bandera `m`: con ella `$` también calzaría antes de
 * un `\r` suelto, que para el PHP no es fin de línea.
 */
const ENCABEZADO = /^[ \t\v\f\r]*(CASO-\d+)[ \t\v\f\r]*$/;
const COLUMNAS = new RegExp(`${B}{2,}`);
const NUMERO = /^\d{1,3}([.,]\d{3})*([.,]\d+)?$|^\d+([.,]\d+)?$/;
const MILES = /^\d{1,3}([.,]\d{3})+$/;
/** Solo dígitos, puntos y comas, con al menos un dígito: algo que "parece" número. */
const PARECE_NUMERO = /^[0-9.,]*[0-9][0-9.,]*$/;
/**
 * Las formas de número que se aceptan (ver `validarNumeros`): entero, miles con
 * un solo tipo de separador en grupos de tres, o decimal con un solo separador.
 */
const NUMERO_ACEPTADO =
  /^[0-9]+$|^[0-9]{1,3}(\.[0-9]{3})+$|^[0-9]{1,3}(,[0-9]{3})+$|^[0-9]+[.,][0-9]+$/;
const OBSERVACION = new RegExp(`OBSERVACION${B}*:${B}*"([^"]+)"`, 'i');
const ITEM_EXENTO = new RegExp(`item${B}*(\\d+)[^.]*?\\bexento\\b`, 'gi');
const ITEM = new RegExp(`item${B}*(\\d+)`, 'i');
const UNIDAD = new RegExp(`unidad de medida en${B}+([A-Za-z]+)`, 'i');

/**
 * Lee el `.txt` del Set de Pruebas de Boletas que entrega el SII y arma un caso
 * por cada `CASO-N`, en el orden del archivo.
 *
 * ```ts
 * const casos = parsearSetPruebas(readFileSync('Set Prueba BE.txt'));
 * ```
 *
 * De cada caso toma las líneas de la tabla con exactamente tres columnas
 * (nombre, cantidad, precio) separadas por dos o más blancos, y aplica la
 * primera línea `OBSERVACION: "..."`: "item N ... exento" marca ese ítem como
 * exento (sin número de ítem, solo si el caso tiene un único ítem) y
 * "unidad de medida en X" pone la unidad X al ítem que se nombre o a todos.
 *
 * Cada caso empieza con una línea `CASO-N` y, debajo, una línea solo de `=`
 * (puede haber líneas en blanco entre ambas, pero no blancos después de los
 * `=`). Un encabezado `CASO-N` (una línea que, sin blancos alrededor, es solo
 * eso) que no cumple ese formato es un error: el PHP perdía ese caso sin
 * avisar. Una mención a `CASO-N` dentro de otra línea no cuenta.
 *
 * Los números aceptan separador de miles (`1.250.000` o `1,250,000`) y
 * decimales con punto o coma; se convierten como el PHP (ver `limpiarNumero`).
 * En una línea de tres columnas cuya cantidad y precio tienen solo dígitos,
 * puntos y comas, un número de otra forma (`1.000,50`, `1.5.0`, `1,`) es un
 * error: el PHP lo leía truncado o ignoraba la línea (ver `validarNumeros`).
 *
 * @param contenido el archivo. Como bytes se acepta en UTF-8 o en ISO-8859-1
 *   (si no es UTF-8 válido); un `string` ya es texto. El set del SII es ASCII.
 * @param tipoDte tipo de documento de todas las boletas (`'39'` o `'41'`).
 * @throws {ErrorValidacion} si no hay ningún `CASO-N`, si un encabezado
 *   `CASO-N` no va seguido de su línea de `=`, si un caso no trae ningún ítem
 *   legible o si la cantidad o el precio de un ítem es un número ambiguo.
 */
export function parsearSetPruebas(
  contenido: string | Uint8Array,
  tipoDte = '39',
): CasoSetPruebas[] {
  const texto = typeof contenido === 'string' ? contenido : decodificarUtf8OIso(contenido);
  const normalizado = texto.replaceAll('\r\n', '\n');

  const bloques = [...normalizado.matchAll(BLOQUE)];
  validarEncabezados(normalizado, bloques);
  if (bloques.length === 0) {
    throw new ErrorValidacion('No se encontraron casos (CASO-N) en el archivo.');
  }

  return bloques.map(([, numCaso = '', cuerpo = '']) => {
    const detalles = parsearDetalles(cuerpo, numCaso);
    if (detalles.length === 0) {
      throw new ErrorValidacion(
        `CASO-${numCaso}: no se pudo extraer ningun item (nombre/cantidad/precio).`,
      );
    }
    aplicarObservaciones(cuerpo, detalles);
    return { tipo: tipoDte, detalles, referencia: { codigo: 'SET', razon: `CASO-${numCaso}` } };
  });
}

/**
 * Decisión del usuario (2026-11-06): un encabezado de caso que no se pudo leer
 * como bloque es un error. En el PHP, un `CASO-N` sin línea de `=` debajo, o
 * con blancos después de los `=`, no abre bloque: sus ítems se pierden (o
 * quedan dentro del caso anterior, si el encabezado tiene blancos delante) y
 * el set sale con menos casos, sin avisar.
 *
 * Encabezado: una línea que, sin blancos alrededor, es exactamente `CASO-<n>`
 * (`<n>` dígitos ASCII; `CASO` en mayúsculas, porque el PHP distingue). En esa
 * misma posición debe empezar un bloque de `BLOQUE`. Una mención dentro de
 * otra línea (`<RazonRef> CASO-1`, "ver el CASO-2") no es encabezado y no se
 * revisa. Los encabezados que el PHP sí lee (con blancos después de `CASO-N`
 * o líneas en blanco antes de los `=`) siguen valiendo.
 */
function validarEncabezados(texto: string, bloques: readonly RegExpMatchArray[]): void {
  const inicios = new Set(bloques.map((bloque) => bloque.index));
  let desplazamiento = 0;

  for (const linea of texto.split('\n')) {
    const encabezado = ENCABEZADO.exec(linea)?.[1];
    if (encabezado !== undefined && !inicios.has(desplazamiento + linea.indexOf('CASO-'))) {
      throw new ErrorValidacion(
        `${encabezado}: no se pudo leer el encabezado del caso. Se esperaba una línea ` +
          `"${encabezado}" y debajo una línea solo de "=" (sin blancos después de los "=").`,
      );
    }
    desplazamiento += linea.length + 1;
  }
}

function parsearDetalles(cuerpo: string, numCaso: string): DetalleSetPruebas[] {
  const detalles: DetalleSetPruebas[] = [];

  for (const original of cuerpo.split('\n')) {
    const linea = trimPhp(original);
    const minusculas = minusculasAscii(linea);

    if (linea === '' || minusculas.startsWith('observacion')) continue;

    // Encabezado de la tabla ("Item ... Cantidad ... Precio Unitario con IVA").
    if (minusculas.startsWith('item') && minusculas.includes('cantidad')) continue;

    // Nombre + cantidad + precio, separados por 2 o más blancos.
    const columnas = linea.split(COLUMNAS).filter((c) => c !== '');
    if (columnas.length !== 3) continue;

    const [nombre = '', cantidad = '', precio = ''] = columnas;
    validarNumeros(numCaso, trimPhp(nombre), cantidad, precio);
    if (!esNumero(cantidad) || !esNumero(precio)) continue;

    detalles.push({
      nombre: trimPhp(nombre),
      cantidad: limpiarNumero(cantidad),
      precio: limpiarNumero(precio),
    });
  }

  return detalles;
}

/**
 * Decisión del usuario (2026-11-06): un número ambiguo en la cantidad o el
 * precio de un ítem es un error, no se lee truncado ni se ignora la línea.
 *
 * Solo se revisan las líneas de tres columnas cuya cantidad y precio (sin
 * blancos alrededor, como `trim()`) tienen solo dígitos ASCII, puntos y comas,
 * con al menos un dígito: esas son filas de ítem. Cada uno debe tener una de
 * estas formas, que el PHP lee bien y aquí dan lo mismo:
 *
 * - entero: `19900`, `007` (7);
 * - miles con un solo tipo de separador, en grupos de tres: `1.000`, `1,000`,
 *   `1.250.000`, `12,345` (enteros, sin separadores);
 * - decimal con un solo punto o coma: `1.5`, `1,5`, `2.0`, `1234,567`, `1.2345`.
 *   Si además calza como miles (`1.000`), es miles, como en el PHP.
 *
 * Cualquier otra es un error: mezcla de `.` y `,` (`1.000,50` y `1,000.50`,
 * que el PHP leía como 1; `1.000,000`), varios separadores que no son miles
 * (`1.5.0`, `1.000.5`) o un separador al inicio, al final o repetido (`1,`,
 * `.5`, `1..5`), que el PHP leía truncados o ignoraba. Las líneas con otros
 * caracteres en esas columnas (`uno`, `-100`, `1 000`, un NBSP) no son filas de
 * ítem y se ignoran como en el PHP.
 */
function validarNumeros(numCaso: string, nombre: string, cantidad: string, precio: string): void {
  const valores = { cantidad: trimPhp(cantidad), precio: trimPhp(precio) };
  if (!PARECE_NUMERO.test(valores.cantidad) || !PARECE_NUMERO.test(valores.precio)) return;

  for (const campo of ['cantidad', 'precio'] as const) {
    const valor = valores[campo];
    if (NUMERO_ACEPTADO.test(valor)) continue;
    throw new ErrorValidacion(
      `CASO-${numCaso}, ítem "${nombre}": ${campo === 'cantidad' ? 'la cantidad' : 'el precio'} ` +
        `"${valor}" no es un número válido. Se acepta un entero (19900), miles con un solo ` +
        'tipo de separador (1.000 o 1,000) o un decimal con un solo punto o coma (1.5 o 1,5), ' +
        'sin mezclar "." y ",".',
    );
  }
}

function esNumero(valor: string): boolean {
  // El `$` del PHP también aceptaría un "\n" final, pero trim() ya lo quitó.
  return NUMERO.test(trimPhp(valor));
}

/**
 * Convierte `1.000` o `1,000` (miles) en 1000 y conserva los decimales. Es el
 * `(int)` / `(float)` del PHP: `2.0` y `2` dan el mismo número (en PHP uno es
 * float y otro int, pero `(string)` de ambos es `"2"` y el generador solo los
 * multiplica y los escribe). Las formas que el PHP truncaba (`1.000,50` daba 1,
 * como `(float) "1.000.50"`) ya no llegan aquí: las rechaza `validarNumeros`.
 */
function limpiarNumero(valor: string): number {
  const limpio = trimPhp(valor);

  if (MILES.test(limpio)) return Number(limpio.replace(/[.,]/g, ''));

  const normalizado = limpio.replaceAll(',', '.');
  // parseFloat toma el prefijo numérico, como (float) de PHP; aquí solo hay
  // dígitos y puntos, y empieza con un dígito.
  return normalizado.includes('.') ? Number.parseFloat(normalizado) : Number(normalizado);
}

/**
 * Aplica la línea `OBSERVACION: "..."` del caso (exento, unidad de medida).
 * Heurística del PHP: si menciona "item N", se aplica solo a ese ítem.
 */
function aplicarObservaciones(cuerpo: string, detalles: DetalleSetPruebas[]): void {
  const observacion = OBSERVACION.exec(cuerpo)?.[1];
  if (observacion === undefined) return;

  // Exento: "El item 1 es ... afecto. El item 2 es ... exento."
  const exentos = [...observacion.matchAll(ITEM_EXENTO)];
  if (exentos.length > 0) {
    for (const [, indice = ''] of exentos) {
      const detalle = detalles[Number.parseInt(indice, 10) - 1];
      if (detalle !== undefined) detalle.exento = true;
    }
  } else if (minusculasAscii(observacion).includes('exento') && detalles.length === 1) {
    const unico = detalles[0];
    if (unico !== undefined) unico.exento = true;
  }

  // Unidad de medida: "Se debe informar en el XML Unidad de medida en Kg."
  // (El PHP le hace rtrim('.,;') a la captura, que solo tiene letras: no cambia nada.)
  const unidad = UNIDAD.exec(observacion)?.[1];
  if (unidad === undefined) return;

  const item = ITEM.exec(observacion)?.[1];
  if (item !== undefined && detalles.length > 1) {
    const detalle = detalles[Number.parseInt(item, 10) - 1];
    if (detalle !== undefined) detalle.unidad = unidad;
  } else {
    for (const detalle of detalles) detalle.unidad = unidad;
  }
}

function trimPhp(texto: string): string {
  return texto.replace(TRIM_PHP, '');
}

/** Minúsculas solo en A-Z, como `stripos` (PHP ≥ 8.2). */
function minusculasAscii(texto: string): string {
  return texto.replace(/[A-Z]+/g, (letras) => letras.toLowerCase());
}
