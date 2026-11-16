import 'server-only';
import PDFDocument from 'pdfkit';
import { formatearFecha, formatearMonto, formatearRut } from '@/lib/formatos';
import {
  AVISO_CERTIFICACION,
  FUENTE,
  FUENTE_NEGRITA,
  filasTotales,
  infoDocumento,
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

// Representación impresa en carta (Letter, 612 × 792 pt), blanco y negro. Encabezado con
// el emisor a la izquierda y el recuadro del SII (R.U.T., tipo y folio) a la derecha;
// fecha y receptor; detalle en tabla que pasa de página repitiendo su encabezado; al
// final, el timbre abajo a la izquierda (como pide el SII) y los totales a la derecha.

const ANCHO = 612;
const ALTO = 792;
const MARGEN = 40;
const ANCHO_UTIL = ANCHO - 2 * MARGEN;
/** Espacio reservado al pie de cada página (aviso de certificación, número de página). */
const PIE = 28;
const LIMITE_INFERIOR = ALTO - MARGEN - PIE;

const ANCHO_RECUADRO = 190;
const SEPARACION = 18;
const ANCHO_EMISOR = ANCHO_UTIL - ANCHO_RECUADRO - SEPARACION;
const ANCHO_TOTALES = 210;
const RELLENO_CELDA = 4;

interface Columna {
  titulo: string;
  ancho: number;
  alinear: 'left' | 'right';
}

const COLUMNAS: readonly Columna[] = [
  { titulo: 'Descripción', ancho: 226, alinear: 'left' },
  { titulo: 'Cantidad', ancho: 76, alinear: 'right' },
  { titulo: 'Precio unitario', ancho: 80, alinear: 'right' },
  { titulo: 'Descuento', ancho: 70, alinear: 'right' },
  { titulo: 'Monto', ancho: 80, alinear: 'right' },
];

type Doc = PDFKit.PDFDocument;

function linea(doc: Doc, y: number, grosor = 0.6, x1 = MARGEN, x2 = MARGEN + ANCHO_UTIL) {
  doc.save().lineWidth(grosor).moveTo(x1, y).lineTo(x2, y).stroke('#000000').restore();
}

/** Emisor y recuadro del SII. Devuelve la `y` donde termina el encabezado. */
function encabezado(doc: Doc, datos: DatosRepresentacion): number {
  const e = datos.emisor;
  let y = MARGEN;
  doc.font(FUENTE_NEGRITA).fontSize(13);
  doc.text(texto(e.razonSocial), MARGEN, y, { width: ANCHO_EMISOR });
  y = doc.y + 3;
  doc.font(FUENTE).fontSize(9);
  for (const valor of [e.giro, e.direccion, e.comuna]) {
    if (!valor.trim()) continue;
    doc.text(texto(valor), MARGEN, y, { width: ANCHO_EMISOR });
    y = doc.y + 1;
  }
  const finEmisor = y;

  // Recuadro: R.U.T., tipo de documento y folio, centrados.
  const xRecuadro = MARGEN + ANCHO_UTIL - ANCHO_RECUADRO;
  const anchoTexto = ANCHO_RECUADRO - 16;
  const lineas = [
    `R.U.T.: ${formatearRut(e.rut)}`,
    tituloDocumento(datos),
    textoFolio(datos.folio),
  ];
  let yTexto = MARGEN + 10;
  for (const valor of lineas) {
    // Cada línea en una sola línea: «BOLETA EXENTA ELECTRÓNICA» baja de 12 a 11 pt.
    let tamano = 12;
    doc.font(FUENTE_NEGRITA).fontSize(tamano);
    while (tamano > 8 && doc.widthOfString(texto(valor)) > anchoTexto) {
      tamano -= 0.5;
      doc.fontSize(tamano);
    }
    doc.text(texto(valor), xRecuadro + 8, yTexto, { width: anchoTexto, align: 'center' });
    yTexto = doc.y + 4;
  }
  const altoRecuadro = yTexto - MARGEN + 6;
  doc
    .save()
    .lineWidth(1.6)
    .rect(xRecuadro, MARGEN, ANCHO_RECUADRO, altoRecuadro)
    .stroke()
    .restore();

  return Math.max(finEmisor, MARGEN + altoRecuadro) + 14;
}

/** Fecha de emisión y, si está identificado, el receptor. */
function datosDocumento(doc: Doc, datos: DatosRepresentacion, y0: number): number {
  let y = y0;
  const campo = (etiqueta: string, valor: string) => {
    doc
      .font(FUENTE_NEGRITA)
      .fontSize(9)
      .text(etiqueta, MARGEN, y, { width: 110, lineBreak: false });
    doc
      .font(FUENTE)
      .fontSize(9)
      .text(texto(valor), MARGEN + 110, y, { width: ANCHO_UTIL - 110 });
    y = doc.y + 3;
  };
  campo('Fecha de emisión:', formatearFecha(datos.fechaEmision));
  if (receptorIdentificado(datos)) {
    if (datos.receptor.razonSocial?.trim()) campo('Receptor:', datos.receptor.razonSocial);
    campo('R.U.T. receptor:', formatearRut(datos.receptor.rut));
  }
  return y + 8;
}

function encabezadoTabla(doc: Doc, y: number): number {
  doc.font(FUENTE_NEGRITA).fontSize(8.5);
  let x = MARGEN;
  for (const c of COLUMNAS) {
    doc.text(c.titulo, x + RELLENO_CELDA, y + 4, {
      width: c.ancho - 2 * RELLENO_CELDA,
      align: c.alinear,
      lineBreak: false,
    });
    x += c.ancho;
  }
  const fin = y + 17;
  linea(doc, y, 1);
  linea(doc, fin, 0.8);
  return fin + 3;
}

function celdasLinea(datos: DatosRepresentacion, l: DatosRepresentacion['lineas'][number]) {
  const nombre = l.exento && datos.tipoDte === 39 ? `${l.nombre} (exento)` : l.nombre;
  return [
    texto(nombre),
    texto(textoCantidad(l)),
    formatearMonto(l.precio),
    l.descuento > 0 ? texto(formatearMonto(-l.descuento)) : '',
    formatearMonto(l.montoItem),
  ];
}

function nuevaPagina(doc: Doc, datos: DatosRepresentacion): number {
  doc.addPage({ size: 'LETTER', margin: 0 });
  doc.font(FUENTE).fontSize(8.5);
  doc.text(
    texto(`${tituloDocumento(datos)} ${textoFolio(datos.folio)} · ${datos.emisor.razonSocial}`),
    MARGEN,
    MARGEN,
    { width: ANCHO_UTIL, lineBreak: false, ellipsis: true },
  );
  return MARGEN + 18;
}

function detalle(doc: Doc, datos: DatosRepresentacion, y0: number): number {
  let y = encabezadoTabla(doc, y0);
  doc.fontSize(9);
  for (const l of datos.lineas) {
    const celdas = celdasLinea(datos, l);
    doc.font(FUENTE).fontSize(9);
    const altoNombre = doc.heightOfString(celdas[0] ?? '', {
      width: (COLUMNAS[0]?.ancho ?? 0) - 2 * RELLENO_CELDA,
    });
    const alto = Math.max(altoNombre, 11) + 6;
    if (y + alto > LIMITE_INFERIOR) {
      y = encabezadoTabla(doc, nuevaPagina(doc, datos));
      doc.font(FUENTE).fontSize(9);
    }
    let x = MARGEN;
    COLUMNAS.forEach((c, i) => {
      doc.text(celdas[i] ?? '', x + RELLENO_CELDA, y + 3, {
        width: c.ancho - 2 * RELLENO_CELDA,
        align: c.alinear,
        ...(i === 0 ? {} : { lineBreak: false }),
      });
      x += c.ancho;
    });
    y += alto;
    linea(doc, y, 0.3);
  }
  return y + 14;
}

/** Alto de la columna de totales. */
function altoTotales(datos: DatosRepresentacion): number {
  return filasTotales(datos).length * 15 + 8;
}

function totales(doc: Doc, datos: DatosRepresentacion, y0: number): void {
  const x = MARGEN + ANCHO_UTIL - ANCHO_TOTALES;
  let y = y0;
  for (const fila of filasTotales(datos)) {
    if (fila.destacada) {
      linea(doc, y, 1, x, x + ANCHO_TOTALES);
      y += 5;
    }
    doc.font(fila.destacada ? FUENTE_NEGRITA : FUENTE).fontSize(fila.destacada ? 11 : 9.5);
    doc.text(fila.etiqueta, x, y, { width: ANCHO_TOTALES / 2, lineBreak: false });
    doc.text(texto(fila.valor), x + ANCHO_TOTALES / 2, y, {
      width: ANCHO_TOTALES / 2,
      align: 'right',
      lineBreak: false,
    });
    y += 15;
  }
}

const LEYENDAS_TIMBRE = 3;
const ALTO_LEYENDA = 11;

function timbre(doc: Doc, datos: DatosRepresentacion, t: TimbreImpreso, y0: number): void {
  doc.image(t.png, MARGEN, y0, { width: t.anchoPt, height: t.altoPt });
  let y = y0 + t.altoPt + 4;
  const leyendas = [
    'Timbre Electrónico SII',
    textoResolucion(datos),
    'Verifique documento: www.sii.cl',
  ];
  leyendas.forEach((valor, i) => {
    doc.font(i === 0 ? FUENTE_NEGRITA : FUENTE).fontSize(8);
    doc.text(texto(valor), MARGEN, y, { width: t.anchoPt, align: 'center', lineBreak: false });
    y += ALTO_LEYENDA;
  });
}

function pies(doc: Doc, datos: DatosRepresentacion): void {
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    const y = ALTO - MARGEN - 10;
    doc.font(FUENTE).fontSize(7.5);
    if (datos.ambiente === 'certificacion') {
      doc.text(texto(AVISO_CERTIFICACION), MARGEN, y, { width: ANCHO_UTIL - 80, lineBreak: false });
    }
    if (rango.count > 1) {
      doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, MARGEN, y, {
        width: ANCHO_UTIL,
        align: 'right',
        lineBreak: false,
      });
    }
  }
}

export async function pdfCarta(datos: DatosRepresentacion, t: TimbreImpreso): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 0,
    bufferPages: true,
    autoFirstPage: true,
    lang: 'es-CL',
    displayTitle: true,
    info: infoDocumento(datos),
  });
  const salida = recogerPdf(doc);
  doc.fillColor('#000000').strokeColor('#000000');

  let y = encabezado(doc, datos);
  y = datosDocumento(doc, datos, y);
  y = detalle(doc, datos, y);

  const altoBloque = Math.max(t.altoPt + 4 + LEYENDAS_TIMBRE * ALTO_LEYENDA, altoTotales(datos));
  if (y + altoBloque > LIMITE_INFERIOR) y = nuevaPagina(doc, datos);
  totales(doc, datos, y);
  timbre(doc, datos, t, y);

  pies(doc, datos);
  doc.end();
  return salida;
}
