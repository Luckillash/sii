import { describe, expect, it } from 'vitest';
import type { Tabla } from './tabla';
import { escaparXml, generarXlsx, letraColumna, nombreHoja, serieExcel } from './xlsx';
import { leerZip } from './zip-lector.test-util';

const TABLA: Tabla = {
  hoja: 'Boletas',
  columnas: [
    { titulo: 'Folio', tipo: 'entero' },
    { titulo: 'Fecha', tipo: 'fecha' },
    { titulo: 'Razón social', tipo: 'texto' },
    { titulo: 'Total', tipo: 'monto' },
  ],
  filas: [
    { celdas: [41, '2026-11-16', 'Ferretería <El Roble> & "Cía"', 1190] },
    { celdas: [42, '2026-11-17', '=SUMA(A1)\u0001 ', null] },
    { celdas: ['Total', null, null, 2380], destacada: true },
  ],
};

const xml = (zip: Map<string, { datos: Buffer }>, nombre: string) => {
  const e = zip.get(nombre);
  if (!e) throw new Error(`Falta ${nombre}`);
  return e.datos.toString('utf8');
};

describe('generarXlsx', () => {
  const zip = leerZip(generarXlsx(TABLA, new Date(2026, 10, 17, 12, 0, 0)));

  it('trae las partes mínimas de OOXML, con CRC y tamaños correctos, en DEFLATE y UTF-8', () => {
    expect([...zip.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const e of zip.values()) {
      expect(e.metodo).toBe(8);
      expect(e.banderas & 0x0800).toBe(0x0800);
      expect(e.datos.toString('utf8')).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"/);
    }
    expect(xml(zip, '[Content_Types].xml')).toContain('/xl/worksheets/sheet1.xml');
    expect(xml(zip, 'xl/workbook.xml')).toContain(
      '<sheet name="Boletas" sheetId="1" r:id="rId1"/>',
    );
  });

  it('encabezado en negrita y fijo; texto inline, números como números', () => {
    const hoja = xml(zip, 'xl/worksheets/sheet1.xml');
    expect(hoja).toContain('<dimension ref="A1:D4"/>');
    expect(hoja).toContain('state="frozen"');
    expect(hoja).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Folio</t></is></c>');
    expect(hoja).toContain('<c r="A2"><v>41</v></c>');
    // Fecha real de Excel con el estilo dd-mm-yyyy (16-11-2026 = 46342).
    expect(hoja).toContain('<c r="B2" s="3"><v>46342</v></c>');
    // Monto con `#,##0`.
    expect(hoja).toContain('<c r="D2" s="2"><v>1190</v></c>');
  });

  it('escapa el XML y quita controles inválidos; un inlineStr no se neutraliza', () => {
    const hoja = xml(zip, 'xl/worksheets/sheet1.xml');
    expect(hoja).toContain('<t>Ferretería &lt;El Roble&gt; &amp; &quot;Cía&quot;</t>');
    expect(hoja).toContain('<t xml:space="preserve">=SUMA(A1) </t>');
    expect(hoja).not.toContain('\u0001');
    // Celda vacía: no se escribe.
    expect(hoja).not.toContain('r="D3"');
  });

  it('la fila destacada va en negrita (texto y monto)', () => {
    const hoja = xml(zip, 'xl/worksheets/sheet1.xml');
    expect(hoja).toContain('<c r="A4" t="inlineStr" s="1"><is><t>Total</t></is></c>');
    expect(hoja).toContain('<c r="D4" s="4"><v>2380</v></c>');
  });

  it('estilos: 5 formatos de celda, miles (3) y fecha (164)', () => {
    const estilos = xml(zip, 'xl/styles.xml');
    expect(estilos).toContain('<cellXfs count="5">');
    expect(estilos).toContain('numFmtId="164" formatCode="dd-mm-yyyy"');
    expect(estilos.match(/<xf numFmtId="3"/g)).toHaveLength(2);
  });

  it('una tabla sin filas sigue siendo válida', () => {
    const vacio = leerZip(generarXlsx({ ...TABLA, filas: [] }));
    expect(xml(vacio, 'xl/worksheets/sheet1.xml')).toContain('<dimension ref="A1:D1"/>');
  });
});

describe('utilidades', () => {
  it('letraColumna', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letraColumna)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  it('serieExcel: sistema 1900 y fechas inexistentes como null', () => {
    expect(serieExcel('1900-03-01')).toBe(61);
    expect(serieExcel('2026-11-17')).toBe(46343);
    expect(serieExcel('2026-02-31')).toBeNull();
    expect(serieExcel('Total')).toBeNull();
  });

  it('nombreHoja: sin caracteres prohibidos y hasta 31', () => {
    expect(nombreHoja('Resumen [diario]: 11/2026')).toBe('Resumen  diario   11 2026');
    expect(nombreHoja('x'.repeat(40))).toHaveLength(31);
    expect(nombreHoja("''")).toBe('Hoja1');
  });

  it('escaparXml quita sustitutos sueltos y conserva los pares', () => {
    expect(escaparXml('a\uD800b')).toBe('ab');
    expect(escaparXml('😀')).toBe('😀');
    expect(escaparXml('\t\n\r')).toBe('\t\n\r');
  });
});
