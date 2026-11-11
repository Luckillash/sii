// Deriva de winex/certificacion v1.9.1 (src/Core/GeneradorBoleta.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// hora inyectable, datos tipados (`exento: boolean`, pend. 1.5) y validación de
// las entradas (RUT, números, descuento) sin cambiar los bytes de las válidas.

import { escaparXml } from '../comun/codificacion.ts';
import { ErrorValidacion } from '../comun/errores.ts';
import { fechaSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import { crearDocumento, crearElemento, fijarAtributo, serializarXml } from '../comun/xml.ts';

/** Emisor de la boleta. Los textos se escapan para XML (como el PHP). */
export interface EmisorBoleta {
  /** `<RUTEmisor>`, con guion y DV (`76123456-0`). */
  rut: string;
  /** `<RznSocEmisor>`. */
  razonSocial: string;
  /** `<GiroEmisor>`. */
  giro: string;
  /** `<DirOrigen>`. */
  direccion: string;
  /** `<CmnaOrigen>`. */
  comuna: string;
}

/** Receptor. En boletas suele ser el genérico `66666666-6`. */
export interface ReceptorBoleta {
  /** `<RUTRecep>`, con guion y DV. */
  rut: string;
  /** `<RznSocRecep>`. Si se omite, el nodo no se escribe (un string vacío sí: `<RznSocRecep/>`). */
  razonSocial?: string;
}

/** Línea de detalle. El precio va BRUTO (IVA incluido), como exige la boleta. */
export interface DetalleBoleta {
  /** `<NmbItem>`. */
  nombre: string;
  /**
   * `<QtyItem>`. Un número entero se escribe como entero; uno con decimales,
   * como el `(string)` de un float de PHP (14 cifras significativas: `1/3` →
   * `0.33333333333333`).
   */
  cantidad: number;
  /** `<PrcItem>`: precio unitario bruto. Mismo formato que `cantidad`. */
  precio: number;
  /** Ítem exento: va en `<MntExe>`, con `<IndExe>1</IndExe>`, y no recibe descuento. */
  exento?: boolean;
  /** `<UnmdItem>`: unidad de medida (`Kg`, `Lt`...). */
  unidad?: string;
}

/** Referencia del documento (el set de pruebas exige `SET` / `CASO-N`). */
export interface ReferenciaBoleta {
  /** `<CodRef>`. */
  codigo: string;
  /** `<RazonRef>`. */
  razon: string;
}

/**
 * Descuento global. Se aplica SOLO sobre el monto afecto (los ítems exentos no
 * se tocan) y se reparte entre las líneas afectas como `<DescuentoMonto>`.
 */
export interface DescuentoGlobal {
  /** `'monto'` (por defecto) en pesos, o `'porcentaje'` (se acota a 100). */
  tipo?: 'porcentaje' | 'monto';
  /** Cero o negativo: no hay descuento. Un monto mayor que el afecto se acota al afecto. */
  valor: number;
  /** No se escribe en el XML (tampoco en el PHP); se acepta por compatibilidad. */
  glosa?: string;
}

export interface DatosBoleta {
  emisor: EmisorBoleta;
  receptor: ReceptorBoleta;
  /** `<Folio>` y parte del `ID` (`F{folio}T{tipoDte}`). */
  folio: string | number;
  /** Al menos una línea. */
  detalles: DetalleBoleta[];
  /** `<TipoDTE>`: 39 boleta afecta (por defecto), 41 boleta exenta. */
  tipoDte?: string | number;
  referencia?: ReferenciaBoleta;
  descuento?: DescuentoGlobal;
}

export interface OpcionesGeneradorBoleta {
  /** Reloj para `<FchEmis>` (fecha de Chile). Por defecto, el del sistema. */
  reloj?: Reloj;
}

/** Tasa de IVA (%). */
const TASA_IVA = 19;

/**
 * Límite de cantidades, precios y montos. Desde 1e15 el `round()` de PHP deja
 * el valor sin redondear y los enteros dejan de ser exactos en un `double`: el
 * PHP produce montos sin sentido, así que aquí se rechazan.
 */
const LIMITE_MONTO = 1e15;

/** `RUTType` del esquema del SII: hasta 8 dígitos, guion y DV (K mayúscula). */
const FORMATO_RUT = /^\d{1,8}-[\dK]$/;

/** Número tal como lo tendría el PHP: `int` o `float` (cambia cómo se escribe). */
interface NumeroPhp {
  valor: number;
  float: boolean;
}

interface LineaProcesada {
  detalle: DetalleBoleta;
  exento: boolean;
  /** `round($cantidad * $precio)`: siempre float en PHP. */
  montoFinal: number;
}

/**
 * Genera el XML del DTE de una boleta electrónica (sin TED ni firma), con los
 * mismos bytes que `GeneradorBoleta::generarBoleta()` del PHP.
 *
 * ```ts
 * const xml = new GeneradorBoleta().generarBoleta({
 *   emisor: { rut: '76123456-0', razonSocial: 'EMPRESA SPA', giro: '...', direccion: '...', comuna: 'SANTIAGO' },
 *   receptor: { rut: '66666666-6' },
 *   folio: 56,
 *   detalles: [{ nombre: 'Producto', cantidad: 1, precio: 1190 }],
 * });
 * ```
 */
export class GeneradorBoleta {
  readonly #reloj: Reloj;

  constructor(opciones: OpcionesGeneradorBoleta = {}) {
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * Bytes ISO-8859-1 del DTE (`saveXML()` con `formatOutput`). Los caracteres
   * fuera de ISO-8859-1 salen como referencias `&#N;`.
   *
   * Totales: en la boleta 39 el precio va bruto, pero el XML desglosa
   * `<MntNeto>` + `<IVA>` sobre la parte afecta (neto = bruto / 1,19 redondeado
   * e IVA = bruto − neto, para que cuadren exacto); si no, el SII registra la
   * venta con neto e IVA en cero.
   *
   * @throws {ErrorValidacion} si un RUT no tiene el formato del SII o su DV no
   *   calza, no hay líneas, una cantidad o un precio no es un número finito no
   *   negativo menor que 1e15 (o su producto, o la suma de las líneas, llega a
   *   1e15), `exento` no es booleano, el folio o el tipo no es un entero, o el
   *   descuento es inválido.
   */
  generarBoleta(datos: DatosBoleta): Buffer {
    validarRut(datos.emisor.rut, 'RUT del emisor');
    validarRut(datos.receptor.rut, 'RUT del receptor');
    const folio = textoEntero(datos.folio, 'folio');
    const tipoDte = textoEntero(datos.tipoDte ?? '39', 'tipoDte');
    const lineas = procesarLineas(datos.detalles);
    validarDescuento(datos.descuento);

    const doc = crearDocumento('1.0', 'ISO-8859-1');
    const agregar = (padre: Element, nombre: string, valor = ''): Element =>
      padre.appendChild(crearElemento(doc, nombre, valor)) as Element;

    const dte = crearElemento(doc, 'DTE');
    fijarAtributo(dte, 'version', '1.0');
    fijarAtributo(dte, 'xmlns', 'http://www.sii.cl/SiiDte');
    fijarAtributo(dte, 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    doc.appendChild(dte);

    const documento = agregar(dte, 'Documento');
    fijarAtributo(documento, 'ID', `F${folio}T${tipoDte}`);
    const encabezado = agregar(documento, 'Encabezado');

    // 1. Identificación. El folio y el tipo van sin escapar (como el PHP).
    const idDoc = agregar(encabezado, 'IdDoc');
    agregar(idDoc, 'TipoDTE', tipoDte);
    agregar(idDoc, 'Folio', folio);
    agregar(idDoc, 'FchEmis', fechaSii(this.#reloj.ahora()));
    agregar(idDoc, 'IndServicio', '3'); // Boleta de ventas y servicios

    // 2. Emisor. Los RUT van sin escapar; ya se validó que solo traen dígitos, guion y K.
    const emisor = agregar(encabezado, 'Emisor');
    agregar(emisor, 'RUTEmisor', datos.emisor.rut);
    agregar(emisor, 'RznSocEmisor', escapar(datos.emisor.razonSocial));
    agregar(emisor, 'GiroEmisor', escapar(datos.emisor.giro));
    agregar(emisor, 'DirOrigen', escapar(datos.emisor.direccion));
    agregar(emisor, 'CmnaOrigen', escapar(datos.emisor.comuna));

    // 3. Receptor.
    const receptor = agregar(encabezado, 'Receptor');
    agregar(receptor, 'RUTRecep', datos.receptor.rut);
    if (datos.receptor.razonSocial != null) {
      agregar(receptor, 'RznSocRecep', escapar(datos.receptor.razonSocial));
    }

    // Totales. Se replican los tipos del PHP: round() devuelve float, así que
    // las sumas de líneas, el IVA y el total son float (solo importa al
    // escribirlos desde 1e14, donde PHP usa notación exponencial).
    let mntExe = 0;
    let hayExentos = false;
    let mntAfectoBruto = 0;
    for (const linea of lineas) {
      if (linea.exento) {
        mntExe += linea.montoFinal;
        hayExentos = true;
      } else {
        mntAfectoBruto += linea.montoFinal;
      }
    }
    if (mntExe + mntAfectoBruto >= LIMITE_MONTO) {
      throw new ErrorValidacion(`La suma de las líneas debe ser menor que ${LIMITE_MONTO}.`);
    }

    // Descuento global: se reparte entre las líneas afectas como
    // <DescuentoMonto> y no como <DscRcgGlobal>, porque el SII valida
    // <MntTotal> contra la suma de los <MontoItem> sin restar el descuento
    // global (reparo 260 "Monto Total No Cuadra con Parciales").
    const descuentoBruto = calcularDescuentoBruto(datos.descuento, mntAfectoBruto);
    const reparto = repartirDescuento(lineas, descuentoBruto, mntAfectoBruto);
    mntAfectoBruto -= descuentoBruto;

    let mntNeto = 0; // int en PHP
    let iva: NumeroPhp = { valor: 0, float: false };
    if (mntAfectoBruto > 0) {
      mntNeto = Math.trunc(redondearPhp(mntAfectoBruto / (1 + TASA_IVA / 100)));
      iva = { valor: mntAfectoBruto - mntNeto, float: true };
    }
    const mntTotal: NumeroPhp = {
      valor: mntNeto + iva.valor + mntExe,
      float: iva.float || hayExentos,
    };

    // 4. Totales, en el orden del esquema: MntNeto, MntExe, IVA, MntTotal.
    const totales = agregar(encabezado, 'Totales');
    if (mntNeto > 0) agregar(totales, 'MntNeto', String(mntNeto));
    if (mntExe > 0) agregar(totales, 'MntExe', textoFloatPhp(mntExe));
    if (iva.valor > 0) agregar(totales, 'IVA', textoNumeroPhp(iva));
    agregar(totales, 'MntTotal', textoNumeroPhp(mntTotal));

    // 5. Detalles.
    lineas.forEach((linea, indice) => {
      const { detalle } = linea;
      const nodo = agregar(documento, 'Detalle');
      agregar(nodo, 'NroLinDet', String(indice + 1));
      if (linea.exento) agregar(nodo, 'IndExe', '1');
      agregar(nodo, 'NmbItem', escapar(detalle.nombre));
      agregar(nodo, 'QtyItem', textoEntradaPhp(detalle.cantidad));
      if (detalle.unidad != null) agregar(nodo, 'UnmdItem', escapar(detalle.unidad));
      agregar(nodo, 'PrcItem', textoEntradaPhp(detalle.precio));

      // El esquema exige <DescuentoMonto> entre <PrcItem> y <MontoItem>, y
      // MontoItem va neto del descuento: es lo que el SII suma contra <MntTotal>.
      const descuentoLinea = reparto.get(indice) ?? 0;
      if (descuentoLinea > 0) agregar(nodo, 'DescuentoMonto', String(descuentoLinea));
      agregar(nodo, 'MontoItem', textoFloatPhp(linea.montoFinal - descuentoLinea));
    });

    // 6. Referencia (la exige el set de pruebas).
    if (datos.referencia) {
      const referencia = agregar(documento, 'Referencia');
      agregar(referencia, 'NroLinRef', '1');
      agregar(referencia, 'CodRef', escapar(datos.referencia.codigo));
      agregar(referencia, 'RazonRef', escapar(datos.referencia.razon));
    }

    return serializarXml(doc, { formatear: true });
  }
}

// ---------------------------------------------------------------------------
// Validación y preparación de las entradas
// ---------------------------------------------------------------------------

function escapar(texto: string): string {
  return escaparXml(texto, 'xml1-iso-8859-1');
}

function validarRut(rut: string, campo: string): void {
  if (typeof rut !== 'string' || !FORMATO_RUT.test(rut)) {
    throw new ErrorValidacion(`${campo} debe tener el formato 12345678-9 (se recibió ${rut}).`);
  }
  Rut.de(rut, campo); // dígito verificador
}

/** El PHP recibe `string $folio`: un número se convierte con `(string)`. Un string va tal cual. */
function textoEntero(valor: string | number, campo: string): string {
  if (typeof valor === 'string') return valor;
  if (!Number.isSafeInteger(valor)) {
    throw new ErrorValidacion(`${campo} debe ser un número entero (se recibió ${valor}).`);
  }
  return String(valor);
}

function procesarLineas(detalles: DetalleBoleta[]): LineaProcesada[] {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    throw new ErrorValidacion('La boleta debe tener al menos una línea de detalle.');
  }
  return detalles.map((detalle, i) => {
    const linea = `Línea ${i + 1}`;
    validarCantidad(detalle.cantidad, `${linea}: cantidad`);
    validarCantidad(detalle.precio, `${linea}: precio`);
    // Pend. 1.5: el PHP usa `=== true` en los totales y en <IndExe>, pero
    // `empty()` al repartir el descuento; con `1` o `'S'` el ítem se sumaba como
    // afecto y además quedaba fuera del reparto. Con un booleano ambas reglas
    // coinciden, así que se exige un booleano (o nada).
    if (detalle.exento !== undefined && typeof detalle.exento !== 'boolean') {
      throw new ErrorValidacion(`${linea}: exento debe ser true o false.`);
    }
    // Si los dos son enteros, PHP multiplica enteros y round() solo convierte a
    // float; con números menores que 1e15 da lo mismo que redondear el double.
    const montoFinal = redondearPhp(detalle.cantidad * detalle.precio);
    if (montoFinal >= LIMITE_MONTO) {
      throw new ErrorValidacion(`${linea}: cantidad × precio debe ser menor que ${LIMITE_MONTO}.`);
    }
    return { detalle, exento: detalle.exento === true, montoFinal };
  });
}

function validarCantidad(valor: number, campo: string): void {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor >= LIMITE_MONTO) {
    throw new ErrorValidacion(
      `${campo} debe ser un número finito, no negativo y menor que ${LIMITE_MONTO} (se recibió ${valor}).`,
    );
  }
}

function validarDescuento(descuento: DescuentoGlobal | undefined): void {
  if (descuento == null) return;
  const { tipo, valor } = descuento;
  if (tipo !== undefined && tipo !== 'porcentaje' && tipo !== 'monto') {
    throw new ErrorValidacion(`Tipo de descuento desconocido: ${String(tipo)}.`);
  }
  // Un valor desde 2^63 haría que el `(int)` del PHP diera cualquier cosa; se
  // rechaza desde el mismo límite que los montos.
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor >= LIMITE_MONTO) {
    throw new ErrorValidacion(
      `El valor del descuento debe ser un número finito menor que ${LIMITE_MONTO} (se recibió ${valor}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Descuento (mismas cuentas que el PHP)
// ---------------------------------------------------------------------------

/**
 * Monto bruto a descontar, acotado al afecto disponible: el descuento nunca
 * deja el afecto en negativo (el SII rechaza montos negativos).
 */
function calcularDescuentoBruto(
  descuento: DescuentoGlobal | undefined,
  mntAfectoBruto: number,
): number {
  if (descuento == null || mntAfectoBruto <= 0) return 0;

  const valor = descuento.valor;
  if (valor <= 0) return 0;

  let bruto: number;
  if ((descuento.tipo ?? 'monto') !== 'porcentaje') {
    bruto = Math.trunc(redondearPhp(valor));
  } else if (valor > 100) {
    // PHP: `min($valor, 100)` devuelve el int 100 y `$afecto * 100 / 100` es
    // una cuenta entera exacta: el afecto completo.
    bruto = mntAfectoBruto;
  } else {
    // `$valor` es float (`(float)` en el PHP; con 100.0, `min()` devuelve el
    // primero): la cuenta va en double.
    bruto = Math.trunc(redondearPhp((mntAfectoBruto * valor) / 100));
  }

  return Math.max(0, Math.min(bruto, mntAfectoBruto));
}

/**
 * Reparte el descuento entre las líneas afectas, a prorrata de su monto, y
 * devuelve el descuento por índice de línea. Suma EXACTAMENTE el descuento: se
 * usa floor por línea y el resto (a lo sumo un peso por línea) se reparte de a
 * uno entre las que todavía tienen margen.
 */
function repartirDescuento(
  lineas: LineaProcesada[],
  descuentoBruto: number,
  mntAfectoBruto: number,
): Map<number, number> {
  const reparto = new Map<number, number>();
  if (descuentoBruto <= 0 || mntAfectoBruto <= 0) return reparto;

  // El PHP filtra con `empty($d['exento'])`; con `exento` booleano es lo mismo
  // que el `=== true` de los totales (ver procesarLineas).
  const afectas: [number, number][] = [];
  lineas.forEach((linea, i) => {
    if (!linea.exento && linea.montoFinal > 0) afectas.push([i, Math.trunc(linea.montoFinal)]);
  });

  let asignado = 0;
  for (const [i, monto] of afectas) {
    const cuota = cuotaDescuento(descuentoBruto, monto, mntAfectoBruto);
    reparto.set(i, cuota);
    asignado += cuota;
  }

  let resto = descuentoBruto - asignado;
  while (resto > 0) {
    let movio = false;
    for (const [i, monto] of afectas) {
      if (resto <= 0) break;
      const actual = reparto.get(i) ?? 0;
      if (actual < monto) {
        reparto.set(i, actual + 1);
        resto--;
        movio = true;
      }
    }
    if (!movio) break; // ya no queda margen (el descuento consumió todo el afecto)
  }

  return reparto;
}

const MAXIMO_INT64 = 2n ** 63n - 1n;

/**
 * `(int) floor($descuento * $monto / $afecto)` con la aritmética de PHP: el
 * producto de enteros es exacto mientras quepa en 64 bits (si no, pasa a
 * double), y la división de enteros es exacta si es divisible (si no, double).
 */
function cuotaDescuento(descuento: number, monto: number, afecto: number): number {
  const producto = BigInt(descuento) * BigInt(monto);
  if (producto > MAXIMO_INT64) return Math.trunc(Math.floor((descuento * monto) / afecto));
  const divisor = BigInt(afecto);
  if (producto % divisor === 0n) return Number(producto / divisor);
  return Math.trunc(Math.floor(Number(producto) / afecto));
}

// ---------------------------------------------------------------------------
// Números como en PHP 8.3
// ---------------------------------------------------------------------------

const POTENCIAS_10 = [
  1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17,
  1e18, 1e19, 1e20, 1e21, 1e22,
];
const TABLA_LOG10 = [
  1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9,
  1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

/** `php_intlog10abs` (ext/standard/math.c de PHP 8.3): floor(log10(|v|)) por búsqueda binaria. */
function log10EnteroAbs(valor: number): number {
  const v = Math.abs(valor);
  if (v < 1e-8 || v > 1e22) return Math.floor(Math.log10(v));
  let r = 15;
  r += v < (TABLA_LOG10[r] as number) ? -8 : 8;
  r += v < (TABLA_LOG10[r] as number) ? -4 : 4;
  r += v < (TABLA_LOG10[r] as number) ? -2 : 2;
  r += v < (TABLA_LOG10[r] as number) ? -1 : 1;
  if (v < (TABLA_LOG10[r] as number)) r -= 1;
  return r - 8;
}

/** `php_intpow10`. */
function potencia10(exponente: number): number {
  return POTENCIAS_10[exponente] ?? 10 ** exponente;
}

/** `php_round_helper` en modo `PHP_ROUND_HALF_UP`. */
function mitadHaciaAfuera(valor: number): number {
  return valor >= 0 ? Math.floor(valor + 0.5) : Math.ceil(valor - 0.5);
}

/**
 * `round($valor)` de PHP 8.3 (`_php_math_round` con 0 decimales). A diferencia
 * de `Math.round`, redondea la mitad lejos del cero y antes "pre-redondea" a 15
 * cifras significativas: `round(5.055 * 100)` da 506 aunque el double sea
 * 505.49999999999994.
 */
function redondearPhp(valor: number): number {
  if (!Number.isFinite(valor) || valor === 0) return valor;
  const precision = 14 - log10EnteroAbs(valor);
  let tmp: number;
  if (precision > 0 && precision < 15) {
    tmp = mitadHaciaAfuera(valor * potencia10(precision));
    tmp = tmp / potencia10(precision);
  } else {
    tmp = valor;
    if (Math.abs(tmp) >= 1e15) return valor;
  }
  return mitadHaciaAfuera(tmp);
}

function textoNumeroPhp(numero: NumeroPhp): string {
  return numero.float ? textoFloatPhp(numero.valor) : String(numero.valor);
}

/**
 * `(string)` de una cantidad o un precio de entrada: un número entero es un
 * `int` de PHP (lo que dan `json_decode` y el parser del set de pruebas) y se
 * escribe en decimal; uno con decimales es un float.
 */
function textoEntradaPhp(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : textoFloatPhp(valor);
}

/**
 * `(string)` de un float en PHP 8.3: `zend_gcvt` con `precision` = 14, sobre
 * `zend_dtoa` en modo 2.
 *
 * - 14 cifras significativas, redondeo exacto con empate al par
 *   (`12345678901234.5` → `12345678901234`), sin ceros finales.
 * - Exponencial si el exponente decimal es < -4 o ≥ 14: `1.0E+14`, `1.0E-5`
 *   (mantisa con al menos un decimal, exponente con signo y sin relleno).
 * - Peculiaridad de dtoa: un entero entre 1e14 y 1e15 cuya cifra 15 es 5 y que
 *   no sube al redondear conserva los ceros finales (`100000000000005` →
 *   `1.0000000000000E+14`).
 */
function textoFloatPhp(valor: number): string {
  if (Number.isNaN(valor)) return 'NAN';
  if (!Number.isFinite(valor)) return valor < 0 ? '-INF' : 'INF';
  if (valor === 0) return Object.is(valor, -0) ? '-0' : '0';

  const signo = valor < 0 ? '-' : '';
  const abs = Math.abs(valor);

  // Expansión decimal exacta (hasta 101 cifras alcanza para los montos de una boleta).
  const [mantisa = '', exponente = '0'] = abs.toExponential(100).split('e');
  const cifras = mantisa.replace('.', '');
  let decpt = Number(exponente) + 1;

  let digitos = cifras.slice(0, 14);
  const resto = cifras.slice(14);
  const primera = resto[0] ?? '0';
  const empate = /^50*$/.test(resto);
  const sube = primera > '5' || (primera === '5' && (!empate || Number(digitos.at(-1)) % 2 === 1));
  if (sube) {
    const incrementado = (BigInt(digitos) + 1n).toString();
    if (incrementado.length > digitos.length) decpt++;
    digitos = incrementado.slice(0, 14);
  }
  const conservaCeros = empate && !sube && Number.isInteger(abs) && abs >= 1e14 && abs < 1e15;
  if (!conservaCeros) digitos = digitos.replace(/0+$/, '') || '0';

  let texto: string;
  if (decpt < 0 ? decpt < -3 : decpt > 14) {
    const e = decpt - 1;
    texto = `${digitos[0]}.${digitos.slice(1) || '0'}E${e < 0 ? '-' : '+'}${Math.abs(e)}`;
  } else if (decpt < 0) {
    texto = `0.${'0'.repeat(-decpt)}${digitos}`;
  } else {
    const entera = digitos.slice(0, decpt).padEnd(decpt, '0');
    const decimales = digitos.slice(decpt);
    texto = decimales === '' ? entera : `${entera || '0'}.${decimales}`;
  }
  return signo + texto;
}
