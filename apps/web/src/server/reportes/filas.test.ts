import { describe, expect, it } from 'vitest';
import { leerFiltros } from '../documentos/filtros';
import {
  agruparPorDia,
  type DiaResumen,
  type DocumentoExportado,
  hrefExportar,
  leerPedido,
  nombreArchivo,
  tablaDocumentos,
  tablaResumen,
  totalesResumen,
} from './filas';

const EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const AHORA = new Date('2026-11-17T15:00:00Z');

describe('leerPedido', () => {
  it('acepta documentos y resumen en csv o xlsx', () => {
    expect(leerPedido({ reporte: 'documentos', formato: 'csv' }, 'todos')).toEqual({
      ok: true,
      reporte: 'documentos',
      formato: 'csv',
    });
    expect(leerPedido({ reporte: ['resumen', 'x'], formato: ' xlsx ' }, '2026-11')).toEqual({
      ok: true,
      reporte: 'resumen',
      formato: 'xlsx',
    });
  });

  it('rechaza reporte o formato desconocidos con un mensaje claro', () => {
    const r1 = leerPedido({ reporte: 'libro', formato: 'csv' }, '2026-11');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.mensaje).toContain('«documentos»');
    const r2 = leerPedido({ reporte: 'documentos', formato: 'pdf' }, '2026-11');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.mensaje).toContain('«csv» o «xlsx»');
    expect(leerPedido({}, '2026-11').ok).toBe(false);
  });

  it('el resumen exige un mes', () => {
    const r = leerPedido({ reporte: 'resumen', formato: 'csv' }, 'todos');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain('Elige un mes');
  });
});

describe('hrefExportar', () => {
  const filtros = leerFiltros(
    {
      empresa: EMPRESA,
      ambiente: 'certificacion',
      periodo: '2026-11',
      tipo: '39',
      estado: 'aceptado',
      q: 'Roble',
      pagina: '3',
      doc: EMPRESA,
    },
    AHORA,
  );

  it('documentos: lleva todos los filtros, sin página ni documento abierto', () => {
    const url = new URL(hrefExportar('mi org', filtros, 'documentos', 'xlsx'), 'https://x');
    expect(url.pathname).toBe('/mi%20org/reportes/exportar');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      empresa: EMPRESA,
      ambiente: 'certificacion',
      periodo: '2026-11',
      tipo: '39',
      estado: 'aceptado',
      q: 'Roble',
      reporte: 'documentos',
      formato: 'xlsx',
    });
  });

  it('resumen: sin tipo, estado ni búsqueda', () => {
    const url = new URL(hrefExportar('org', filtros, 'resumen', 'csv'), 'https://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      empresa: EMPRESA,
      ambiente: 'certificacion',
      periodo: '2026-11',
      reporte: 'resumen',
      formato: 'csv',
    });
  });
});

describe('nombreArchivo', () => {
  it('RUT sin puntos con guion, ambiente y período', () => {
    expect(nombreArchivo('documentos', '20630500-2', 'certificacion', '2026-11', 'csv')).toBe(
      'boletas-20630500-2-certificacion-2026-11.csv',
    );
    expect(nombreArchivo('resumen', '76.354.771-k', 'produccion', '2026-10', 'xlsx')).toBe(
      'resumen-diario-76354771-K-produccion-2026-10.xlsx',
    );
    expect(nombreArchivo('documentos', '20630500-2', 'produccion', 'todos', 'csv')).toBe(
      'boletas-20630500-2-produccion-todos.csv',
    );
  });
});

const doc = (d: Partial<DocumentoExportado>): DocumentoExportado => ({
  tipo_dte: 39,
  folio: 41,
  fecha_emision: '2026-11-16',
  receptor_rut: '66666666-6',
  receptor_razon_social: null,
  mnt_neto: 1000,
  mnt_exe: 0,
  iva: 190,
  mnt_total: 1190,
  estado: 'aceptado',
  track_id: '34015200',
  ...d,
});

describe('tablaDocumentos', () => {
  it('columnas pedidas y valores con formato del design system', () => {
    const t = tablaDocumentos([
      doc({}),
      doc({
        tipo_dte: 41,
        folio: 7,
        receptor_rut: '76354771-K',
        receptor_razon_social: '  Comercial Los Aromos SpA ',
        mnt_neto: 0,
        mnt_exe: 5000,
        iva: 0,
        mnt_total: 5000,
        estado: 'aceptado_con_reparos',
        track_id: null,
      }),
      doc({ receptor_rut: '11111111-1', estado: 'incierto' }),
    ]);
    expect(t.hoja).toBe('Boletas');
    expect(t.columnas.map((c) => c.titulo)).toEqual([
      'Tipo (código)',
      'Tipo',
      'Folio',
      'Fecha de emisión',
      'RUT receptor',
      'Razón social receptor',
      'Neto',
      'Exento',
      'IVA',
      'Total',
      'Estado',
      'Track ID',
    ]);
    expect(t.filas[0]?.celdas).toEqual([
      39,
      'Boleta electrónica',
      41,
      '2026-11-16',
      '66.666.666-6',
      'Cliente General',
      1000,
      0,
      190,
      1190,
      'Aceptado',
      '34015200',
    ]);
    expect(t.filas[1]?.celdas.slice(1, 2)).toEqual(['Boleta exenta electrónica']);
    expect(t.filas[1]?.celdas.slice(4, 6)).toEqual(['76.354.771-K', 'Comercial Los Aromos SpA']);
    expect(t.filas[1]?.celdas.slice(10)).toEqual(['Aceptado con reparos', null]);
    expect(t.filas[2]?.celdas[5]).toBe('Sin razón social');
    expect(t.filas[2]?.celdas[10]).toBe('Por verificar');
  });
});

const dia = (d: Partial<DiaResumen>): DiaResumen => ({
  fecha_emision: '2026-11-16',
  tipo_dte: 39,
  documentos: 1,
  folio_min: 41,
  folio_max: 41,
  mnt_neto: 1000,
  mnt_exe: 0,
  iva: 190,
  mnt_total: 1190,
  ...d,
});

describe('tablaResumen', () => {
  it('ordena por fecha y tipo y cierra con una fila de totales destacada', () => {
    const dias = [
      dia({ fecha_emision: '2026-11-17', folio_min: 42, folio_max: 43, documentos: 2 }),
      dia({
        tipo_dte: 41,
        folio_min: 1,
        folio_max: 1,
        mnt_neto: 0,
        mnt_exe: 3000,
        iva: 0,
        mnt_total: 3000,
      }),
      dia({}),
    ];
    const t = tablaResumen(dias);
    expect(t.hoja).toBe('Resumen diario');
    expect(t.filas.map((f) => f.celdas.slice(0, 2))).toEqual([
      ['2026-11-16', 39],
      ['2026-11-16', 41],
      ['2026-11-17', 39],
      ['Total', null],
    ]);
    expect(t.filas.at(-1)).toEqual({
      celdas: ['Total', null, 4, null, null, 2000, 3000, 380, 5380],
      destacada: true,
    });
    expect(totalesResumen(dias)).toEqual({
      documentos: 4,
      mnt_neto: 2000,
      mnt_exe: 3000,
      iva: 380,
      mnt_total: 5380,
    });
  });

  it('sin días: solo la fila de totales en cero', () => {
    expect(tablaResumen([]).filas).toEqual([
      { celdas: ['Total', null, 0, null, null, 0, 0, 0, 0], destacada: true },
    ]);
  });
});

describe('agruparPorDia', () => {
  it('cuenta, suma y toma el rango de folios por fecha y tipo, ordenado', () => {
    const dias = agruparPorDia([
      doc({ fecha_emision: '2026-11-17', folio: 45 }),
      doc({ fecha_emision: '2026-11-16', folio: 43 }),
      doc({ fecha_emision: '2026-11-16', folio: 41, estado: 'aceptado_con_reparos' }),
      doc({
        fecha_emision: '2026-11-16',
        tipo_dte: 41,
        folio: 3,
        mnt_neto: 0,
        iva: 0,
        mnt_exe: 500,
        mnt_total: 500,
      }),
    ]);
    expect(dias).toEqual([
      dia({
        documentos: 2,
        folio_min: 41,
        folio_max: 43,
        mnt_neto: 2000,
        iva: 380,
        mnt_total: 2380,
      }),
      dia({
        tipo_dte: 41,
        folio_min: 3,
        folio_max: 3,
        mnt_neto: 0,
        iva: 0,
        mnt_exe: 500,
        mnt_total: 500,
      }),
      dia({ fecha_emision: '2026-11-17', folio_min: 45, folio_max: 45 }),
    ]);
    expect(agruparPorDia([])).toEqual([]);
  });
});
