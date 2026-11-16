import 'server-only';
import { formatearMiles, formatearMonto, nombreTipoDte, rutSii } from '@/lib/formatos';
import type { DatosRepresentacion } from './index';

// Piezas comunes a la representación impresa en carta y en rollo: textos, cifras y la
// tipografía estándar de pdfkit (Helvetica con WinAnsi, que cubre las tildes y la ñ).

export const FUENTE = 'Helvetica';
export const FUENTE_NEGRITA = 'Helvetica-Bold';
export const PUNTOS_POR_MM = 72 / 25.4;

/** RUT genérico del receptor sin identificar («Cliente General»). */
export const RUT_GENERICO = '66666666-6';

/**
 * Caracteres de Windows-1252 por sobre U+00FF que tienen glifo en las fuentes estándar
 * (pdfkit los mapea a WinAnsi). Lo demás sobre U+00FF no se puede dibujar.
 */
const EXTRAS_WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * Texto apto para las fuentes estándar: el signo menos tipográfico de `formatearMonto`
 * pasa a guion, los controles se quitan y lo que no tiene glifo en WinAnsi sale como «?»
 * (los textos de la empresa ya vienen limitados a ISO-8859-1).
 */
export function texto(valor: string): string {
  let salida = '';
  for (const caracter of valor.replaceAll('−', '-')) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (codigo === 0x0a || codigo === 0x09) salida += ' ';
    else if (codigo < 0x20 || (codigo >= 0x7f && codigo < 0xa0)) continue;
    else if (codigo <= 0xff || EXTRAS_WINANSI.has(caracter)) salida += caracter;
    else salida += '?';
  }
  return salida;
}

/** «BOLETA ELECTRÓNICA» o «BOLETA EXENTA ELECTRÓNICA». */
export function tituloDocumento(datos: DatosRepresentacion): string {
  return nombreTipoDte(datos.tipoDte).toUpperCase();
}

/** `N.º 41`: el folio sin separador de miles (es un número de documento, no una cifra). */
export function textoFolio(folio: number): string {
  return `N.º ${folio}`;
}

/**
 * ¿Se imprime el receptor? Solo si está identificado: el genérico 66.666.666-6 «Cliente
 * General» no aporta nada al comprador y el SII no lo exige en la boleta.
 */
export function receptorIdentificado(datos: DatosRepresentacion): boolean {
  return rutSii(datos.receptor.rut) !== RUT_GENERICO;
}

/** «Res. N.º 80 de 2014» (en certificación, «Res. N.º 0 de <año>»). */
export function textoResolucion(datos: DatosRepresentacion): string {
  const anio = /^\d{4}/.exec(datos.resolucion.fecha)?.[0] ?? datos.resolucion.fecha;
  return `Res. N.º ${datos.resolucion.numero} de ${anio}`;
}

export const AVISO_CERTIFICACION =
  'Documento emitido en el ambiente de certificación del SII, sin validez tributaria.';

/** Cantidad con coma decimal y miles con punto: 1 → «1», 1.5 → «1,5», 1250 → «1.250». */
export function formatearCantidad(cantidad: number): string {
  if (Number.isInteger(cantidad)) return formatearMiles(cantidad);
  const [entero = '0', decimales = ''] = Math.abs(cantidad)
    .toFixed(6)
    .replace(/0+$/, '')
    .split('.');
  const signo = cantidad < 0 ? '-' : '';
  return `${signo}${formatearMiles(Number(entero))}${decimales ? `,${decimales}` : ''}`;
}

/** «2», «1,5 Kg». */
export function textoCantidad(linea: DatosRepresentacion['lineas'][number]): string {
  const unidad = linea.unidad?.trim();
  return unidad
    ? `${formatearCantidad(linea.cantidad)} ${unidad}`
    : formatearCantidad(linea.cantidad);
}

export interface FilaTotal {
  etiqueta: string;
  valor: string;
  destacada?: boolean;
}

/**
 * Totales en el orden en que se leen: descuento global (si hubo), neto, exento, IVA y
 * total. La boleta exenta (41) no lleva neto ni IVA.
 */
export function filasTotales(datos: DatosRepresentacion): FilaTotal[] {
  const t = datos.totales;
  const filas: FilaTotal[] = [];
  if (t.descuentoAplicado > 0) {
    filas.push({ etiqueta: 'Descuento global', valor: formatearMonto(-t.descuentoAplicado) });
  }
  if (datos.tipoDte === 39) {
    filas.push({ etiqueta: 'Monto neto', valor: formatearMonto(t.neto) });
    if (t.exento > 0) filas.push({ etiqueta: 'Monto exento', valor: formatearMonto(t.exento) });
    filas.push({ etiqueta: 'IVA (19 %)', valor: formatearMonto(t.iva) });
  } else {
    filas.push({ etiqueta: 'Monto exento', valor: formatearMonto(t.exento) });
  }
  filas.push({ etiqueta: 'Total', valor: formatearMonto(t.total), destacada: true });
  return filas;
}

/** Recoge la salida de un documento de pdfkit en un `Buffer`. */
export function recogerPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on('data', (parte: Buffer) => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });
}

export function infoDocumento(datos: DatosRepresentacion): PDFKit.DocumentInfo {
  return {
    Title: texto(`${nombreTipoDte(datos.tipoDte)} ${textoFolio(datos.folio)}`),
    Author: texto(datos.emisor.razonSocial),
    Subject: texto(`Representación impresa: RUT ${datos.emisor.rut}`),
    Creator: 'Boletéame',
  };
}
