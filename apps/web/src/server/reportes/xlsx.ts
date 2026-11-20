import 'server-only';
import { FECHA_ISO, type Tabla, type TipoColumna, type Valor } from './tabla';
import { armarZip } from './zip';

// Escritor mínimo de .xlsx (Office Open XML, ECMA-376) para las exportaciones (PLAN-SAAS
// Fase 9), sin dependencias: un libro con una hoja, texto como `inlineStr` (sin tabla de
// cadenas compartidas, que solo ahorra espacio), números como números, fechas como fechas
// reales de Excel y estilos fijos: encabezado en negrita, montos con `#,##0` (Excel lo
// muestra con el separador de miles de la configuración regional: `1.190` en es-CL) y la
// fila de totales en negrita. El encabezado queda fijo al desplazarse.
//
// A diferencia del CSV, un `inlineStr` nunca se evalúa como fórmula: no hace falta
// neutralizar. Sí hay que escapar el XML y quitar los caracteres que XML 1.0 no admite
// (controles C0 salvo tabulación y saltos de línea, sustitutos sueltos, U+FFFE y U+FFFF):
// una razón social con uno de ellos dejaría el archivo ilegible para Excel. Puro.

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Índices de `cellXfs` en `styles.xml`. */
const ESTILO = {
  normal: 0,
  negrita: 1,
  monto: 2,
  fecha: 3,
  montoNegrita: 4,
} as const;

// biome-ignore lint/suspicious/noControlCharactersInRegex: justamente quita los controles que XML 1.0 no admite.
const INVALIDOS_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const SUSTITUTO_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Quita lo que XML 1.0 no admite y escapa `& < > "`. */
export function escaparXml(texto: string): string {
  return texto
    .replace(INVALIDOS_XML, '')
    .replace(SUSTITUTO_SUELTO, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `0 → A`, `25 → Z`, `26 → AA`. */
export function letraColumna(indice: number): string {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/** Número de serie de Excel (sistema 1900) de una fecha `AAAA-MM-DD`, o `null`. */
export function serieExcel(fecha: string): number | null {
  const m = FECHA_ISO.exec(fecha);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  // `Date.UTC` acepta el 31-02 y lo corre al 03-03: una fecha inexistente va como texto.
  if (d.getUTCDate() !== Number(m[3]) || d.getUTCMonth() !== Number(m[2]) - 1) return null;
  // El día 0 de Excel es el 30-12-1899 (incluye su 29-02-1900 inexistente).
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Nombre de hoja válido: sin `[]:*?/\`, sin comillas simples en los bordes, ≤ 31. */
export function nombreHoja(nombre: string): string {
  const limpio = nombre
    .replace(INVALIDOS_XML, '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31);
  return limpio || 'Hoja1';
}

function celdaTexto(ref: string, texto: string, estilo: number): string {
  const limpio = escaparXml(texto);
  const preservar = limpio !== limpio.trim() || /\n/.test(limpio) ? ' xml:space="preserve"' : '';
  const s = estilo ? ` s="${estilo}"` : '';
  return `<c r="${ref}" t="inlineStr"${s}><is><t${preservar}>${limpio}</t></is></c>`;
}

function celdaNumero(ref: string, n: number, estilo: number): string {
  const s = estilo ? ` s="${estilo}"` : '';
  return `<c r="${ref}"${s}><v>${n}</v></c>`;
}

function celda(ref: string, valor: Valor, tipo: TipoColumna, destacada: boolean): string {
  const textoEstilo = destacada ? ESTILO.negrita : ESTILO.normal;
  if (valor === null || valor === '') return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    const estilo =
      tipo === 'monto' ? (destacada ? ESTILO.montoNegrita : ESTILO.monto) : textoEstilo;
    return celdaNumero(ref, valor, estilo);
  }
  if (tipo === 'fecha') {
    const serie = serieExcel(valor);
    if (serie !== null) return celdaNumero(ref, serie, ESTILO.fecha);
  }
  return celdaTexto(ref, valor, textoEstilo);
}

function hoja(tabla: Tabla): string {
  const ancho = tabla.columnas.length;
  const ultima = letraColumna(Math.max(0, ancho - 1));
  const filas: string[] = [];
  filas.push(
    `<row r="1">${tabla.columnas
      .map((c, i) => celdaTexto(`${letraColumna(i)}1`, c.titulo, ESTILO.negrita))
      .join('')}</row>`,
  );
  tabla.filas.forEach((f, j) => {
    const r = j + 2;
    const celdas = tabla.columnas
      .map((c, i) => celda(`${letraColumna(i)}${r}`, f.celdas[i] ?? null, c.tipo, !!f.destacada))
      .join('');
    filas.push(`<row r="${r}">${celdas}</row>`);
  });
  const columnas = tabla.columnas
    .map((c, i) => {
      const w = c.ancho ?? Math.max(10, Math.min(60, c.titulo.length + 2));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join('');
  return (
    `${DECLARACION}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${ultima}${tabla.filas.length + 1}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<cols>${columnas}</cols>` +
    `<sheetData>${filas.join('')}</sheetData>` +
    '</worksheet>'
  );
}

const ESTILOS =
  `${DECLARACION}<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

const TIPOS_CONTENIDO =
  `${DECLARACION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const RELACIONES_PAQUETE =
  `${DECLARACION}<Relationships xmlns="${NS_PKG_REL}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const RELACIONES_LIBRO =
  `${DECLARACION}<Relationships xmlns="${NS_PKG_REL}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

function libro(nombre: string): string {
  return (
    `${DECLARACION}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheets><sheet name="${escaparXml(nombreHoja(nombre))}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  );
}

/** El .xlsx completo listo para responder. */
export function generarXlsx(tabla: Tabla, fecha: Date = new Date()): Buffer {
  const utf8 = (texto: string) => Buffer.from(texto, 'utf8');
  return armarZip(
    [
      { nombre: '[Content_Types].xml', datos: utf8(TIPOS_CONTENIDO) },
      { nombre: '_rels/.rels', datos: utf8(RELACIONES_PAQUETE) },
      { nombre: 'xl/workbook.xml', datos: utf8(libro(tabla.hoja)) },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: utf8(RELACIONES_LIBRO) },
      { nombre: 'xl/styles.xml', datos: utf8(ESTILOS) },
      { nombre: 'xl/worksheets/sheet1.xml', datos: utf8(hoja(tabla)) },
    ],
    fecha,
  );
}
