import 'server-only';
import PDFDocument from 'pdfkit';
import { formatearFecha, formatearMonto, formatearRut } from '@/lib/formatos';
import {
  AVISO_CERTIFICACION,
  FUENTE,
  FUENTE_NEGRITA,
  filasTotales,
  infoDocumento,
  PUNTOS_POR_MM,
  receptorIdentificado,
  recogerPdf,
  texto,
  textoCantidad,
  textoFolio,
  textoResolucion,
  tituloDocumento,
} from './comun';
import type { DatosRepresentacion } from './index';
import type { TimbreImpreso } from './timbre';

// Representación impresa en rollo de 80 mm (impresoras térmicas), una sola página con el
// alto justo para el contenido. pdfkit fija el tamaño de la página al crearla, así que se
// compone dos veces: la primera en una página muy alta solo para medir, la segunda con el
// alto medido. La composición es determinista, así que las dos coinciden.

export const ANCHO_ROLLO_PT = 80 * PUNTOS_POR_MM;
const MARGEN = 4 * PUNTOS_POR_MM;
const ANCHO_UTIL = ANCHO_ROLLO_PT - 2 * MARGEN;
/** Ancho disponible para el timbre en el rollo. */
export const ANCHO_TIMBRE_ROLLO_PT = ANCHO_UTIL;
/** Alto de la página de medición (no se publica): sobra para cualquier boleta. */
const ALTO_MEDICION = 1_000_000;

type Doc = PDFKit.PDFDocument;

function separador(doc: Doc, y: number): number {
  doc
    .save()
    .lineWidth(0.5)
    .dash(1.5, { space: 1.5 })
    .moveTo(MARGEN, y + 4)
    .lineTo(MARGEN + ANCHO_UTIL, y + 4)
    .stroke()
    .undash()
    .restore();
  return y + 9;
}

function centrado(doc: Doc, valor: string, y: number, fuente = FUENTE, tamano = 8): number {
  doc
    .font(fuente)
    .fontSize(tamano)
    .text(texto(valor), MARGEN, y, { width: ANCHO_UTIL, align: 'center' });
  return doc.y;
}

/** Etiqueta a la izquierda y valor a la derecha en la misma línea. */
function parIzqDer(
  doc: Doc,
  izquierda: string,
  derecha: string,
  y: number,
  negrita = false,
  tamano = 8,
) {
  doc.font(negrita ? FUENTE_NEGRITA : FUENTE).fontSize(tamano);
  const anchoDerecha = Math.min(doc.widthOfString(texto(derecha)) + 2, ANCHO_UTIL / 2);
  doc.text(texto(izquierda), MARGEN, y, { width: ANCHO_UTIL - anchoDerecha - 4 });
  const fin = doc.y;
  doc.text(texto(derecha), MARGEN + ANCHO_UTIL - anchoDerecha, y, {
    width: anchoDerecha,
    align: 'right',
    lineBreak: false,
  });
  return Math.max(fin, y + doc.currentLineHeight());
}

function componer(doc: Doc, datos: DatosRepresentacion, t: TimbreImpreso): number {
  const e = datos.emisor;
  let y = MARGEN + 2;
  y = centrado(doc, e.razonSocial, y, FUENTE_NEGRITA, 10) + 2;
  for (const valor of [e.giro, e.direccion, e.comuna]) {
    if (valor.trim()) y = centrado(doc, valor, y, FUENTE, 7.5) + 1;
  }
  y += 5;

  // Recuadro del SII.
  const inicio = y;
  y += 5;
  for (const valor of [
    `R.U.T.: ${formatearRut(e.rut)}`,
    tituloDocumento(datos),
    textoFolio(datos.folio),
  ]) {
    y = centrado(doc, valor, y, FUENTE_NEGRITA, 9.5) + 2;
  }
  y += 3;
  doc
    .save()
    .lineWidth(1.2)
    .rect(MARGEN, inicio, ANCHO_UTIL, y - inicio)
    .stroke()
    .restore();
  y += 6;

  y = parIzqDer(doc, 'Fecha de emisión', formatearFecha(datos.fechaEmision), y) + 1;
  if (receptorIdentificado(datos)) {
    y = parIzqDer(doc, 'R.U.T. receptor', formatearRut(datos.receptor.rut), y) + 1;
    const razon = datos.receptor.razonSocial?.trim();
    if (razon) {
      doc.font(FUENTE).fontSize(8).text(texto(razon), MARGEN, y, { width: ANCHO_UTIL });
      y = doc.y + 1;
    }
  }
  y = separador(doc, y);

  for (const l of datos.lineas) {
    const nombre = l.exento && datos.tipoDte === 39 ? `${l.nombre} (exento)` : l.nombre;
    doc.font(FUENTE).fontSize(8).text(texto(nombre), MARGEN, y, { width: ANCHO_UTIL });
    y = doc.y;
    y = parIzqDer(
      doc,
      `${textoCantidad(l)} x ${formatearMonto(l.precio)}`,
      formatearMonto(l.montoItem),
      y,
    );
    if (l.descuento > 0) {
      y = parIzqDer(doc, 'Descuento', formatearMonto(-l.descuento), y);
    }
    y += 3;
  }
  y = separador(doc, y);

  for (const fila of filasTotales(datos)) {
    y = parIzqDer(doc, fila.etiqueta, fila.valor, y, fila.destacada, fila.destacada ? 10 : 8) + 1;
  }
  y += 8;

  const xTimbre = MARGEN + (ANCHO_UTIL - t.anchoPt) / 2;
  doc.image(t.png, xTimbre, y, { width: t.anchoPt, height: t.altoPt });
  y += t.altoPt + 3;
  y = centrado(doc, 'Timbre Electrónico SII', y, FUENTE_NEGRITA, 7.5);
  y = centrado(doc, textoResolucion(datos), y, FUENTE, 7.5);
  y = centrado(doc, 'Verifique documento: www.sii.cl', y, FUENTE, 7.5);
  if (datos.ambiente === 'certificacion') {
    y = centrado(doc, AVISO_CERTIFICACION, y + 4, FUENTE, 6.5);
  }
  return y + MARGEN;
}

function nuevoDocumento(datos: DatosRepresentacion, alto: number): Doc {
  return new PDFDocument({
    size: [ANCHO_ROLLO_PT, alto],
    margin: 0,
    lang: 'es-CL',
    displayTitle: true,
    info: infoDocumento(datos),
  });
}

export async function pdfRollo(datos: DatosRepresentacion, t: TimbreImpreso): Promise<Buffer> {
  const medicion = nuevoDocumento(datos, ALTO_MEDICION);
  const descarte = recogerPdf(medicion);
  const alto = Math.ceil(componer(medicion, datos, t));
  medicion.end();
  await descarte;

  const doc = nuevoDocumento(datos, alto);
  const salida = recogerPdf(doc);
  doc.fillColor('#000000').strokeColor('#000000');
  componer(doc, datos, t);
  doc.end();
  return salida;
}
