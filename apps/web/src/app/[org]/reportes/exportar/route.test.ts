import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de exportación con dobles: la sesión, las empresas, el ambiente por defecto y la
// generación del archivo se simulan. Sin red ni base.

const EMPRESA_A = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const EMPRESA_B = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';

const estado = vi.hoisted(() => ({
  usuario: true,
  membresias: [{ organizacionId: 'org-1', slug: 'mi-org', nombre: 'Mi org', rol: 'lector' }],
  ultimaEmpresa: null as string | null,
}));

const reportes = vi.hoisted(() => ({ generarExportacion: vi.fn() }));
const documentos = vi.hoisted(() => ({ ambientePorDefecto: vi.fn() }));
const empresas = vi.hoisted(() => ({ listarEmpresas: vi.fn() }));

vi.mock('@/server/sesion', () => ({
  obtenerUsuario: async () => (estado.usuario ? { id: 'u-1', correo: 'a@example.com' } : null),
  obtenerMembresias: async () => estado.membresias,
  obtenerPerfil: async () => ({ ultimaEmpresa: estado.ultimaEmpresa }),
}));
vi.mock('@/server/documentos', () => documentos);
vi.mock('@/server/empresas', () => empresas);
vi.mock('@/server/reportes', async () => {
  const filas = await import('@/server/reportes/filas');
  class ExportacionDemasiadoGrande extends Error {
    constructor(readonly total: number) {
      super('grande');
    }
  }
  return {
    ...reportes,
    leerPedido: filas.leerPedido,
    MAXIMO_FILAS: filas.MAXIMO_FILAS,
    ExportacionDemasiadoGrande,
  };
});

const { GET } = await import('./route');
const { ExportacionDemasiadoGrande } = await import('@/server/reportes');

function pedir(slug: string, query: string) {
  const req = new NextRequest(`https://boleteame.dev/${slug}/reportes/exportar?${query}`);
  return GET(req, { params: Promise.resolve({ org: slug }) });
}

beforeEach(() => {
  estado.usuario = true;
  estado.ultimaEmpresa = null;
  reportes.generarExportacion.mockReset();
  documentos.ambientePorDefecto.mockReset();
  empresas.listarEmpresas.mockReset();
  empresas.listarEmpresas.mockResolvedValue([
    { id: EMPRESA_A, rut: '20630500-2', activa: true, autorizadaProduccion: true },
    { id: EMPRESA_B, rut: '76354771-K', activa: true, autorizadaProduccion: false },
  ]);
  documentos.ambientePorDefecto.mockResolvedValue('produccion');
  reportes.generarExportacion.mockResolvedValue({
    cuerpo: Buffer.from('﻿a;b\r\n'),
    nombre: 'boletas-76354771-K-certificacion-2026-11.csv',
    tipoContenido: 'text/csv; charset=utf-8',
  });
});

describe('GET /[org]/reportes/exportar', () => {
  it('sin sesión redirige a ingresar con la URL completa', async () => {
    estado.usuario = false;
    const r = await pedir('mi-org', 'reporte=documentos&formato=csv');
    expect(r.status).toBe(307);
    const destino = new URL(r.headers.get('location') ?? '');
    expect(destino.pathname).toBe('/ingresar');
    expect(destino.searchParams.get('siguiente')).toBe(
      '/mi-org/reportes/exportar?reporte=documentos&formato=csv',
    );
    expect(reportes.generarExportacion).not.toHaveBeenCalled();
  });

  it('sin membresía responde 404 sin leer nada', async () => {
    const r = await pedir('otra-org', 'reporte=documentos&formato=csv');
    expect(r.status).toBe(404);
    expect(empresas.listarEmpresas).not.toHaveBeenCalled();
    expect(reportes.generarExportacion).not.toHaveBeenCalled();
  });

  it.each([
    ['reporte=libro&formato=csv', '«documentos»'],
    ['reporte=documentos&formato=pdf', '«csv» o «xlsx»'],
    ['formato=csv', '«documentos»'],
    ['reporte=resumen&formato=xlsx&periodo=todos', 'Elige un mes'],
  ])('parámetros inválidos (%s) → 400', async (query, texto) => {
    const r = await pedir('mi-org', query);
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(await r.text()).toContain(texto);
    expect(reportes.generarExportacion).not.toHaveBeenCalled();
  });

  it('descarga el archivo de la empresa y ambiente pedidos, con los filtros', async () => {
    const r = await pedir(
      'mi-org',
      `empresa=${EMPRESA_B}&ambiente=certificacion&periodo=2026-11&tipo=39&estado=aceptado&q=Roble&reporte=documentos&formato=csv`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="boletas-76354771-K-certificacion-2026-11.csv"',
    );
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await r.arrayBuffer()).toString('utf8')).toBe('﻿a;b\r\n');
    expect(documentos.ambientePorDefecto).not.toHaveBeenCalled();
    const pedido = reportes.generarExportacion.mock.calls[0]?.[0];
    expect(pedido).toMatchObject({
      reporte: 'documentos',
      formato: 'csv',
      ctx: { organizacionId: 'org-1', empresaId: EMPRESA_B, ambiente: 'certificacion' },
      rutEmpresa: '76354771-K',
      filtros: { periodo: '2026-11', tipo: 39, estado: 'aceptado', q: 'Roble' },
    });
  });

  it('una empresa que no es de la organización → 404, sin exportar otra', async () => {
    estado.ultimaEmpresa = EMPRESA_B;
    const r = await pedir(
      'mi-org',
      'empresa=11111111-2222-4333-8444-555555555555&periodo=2026-11&reporte=resumen&formato=xlsx',
    );
    expect(r.status).toBe(404);
    expect(await r.text()).toContain('No encontramos esa empresa');
    expect(documentos.ambientePorDefecto).not.toHaveBeenCalled();
    expect(reportes.generarExportacion).not.toHaveBeenCalled();
  });

  it('sin empresa en la URL usa la última abierta y el ambiente por defecto', async () => {
    estado.ultimaEmpresa = EMPRESA_B;
    const r = await pedir('mi-org', 'periodo=2026-11&reporte=resumen&formato=xlsx');
    expect(r.status).toBe(200);
    expect(documentos.ambientePorDefecto).toHaveBeenCalledWith({
      organizacionId: 'org-1',
      empresaId: EMPRESA_B,
      autorizadaProduccion: false,
    });
    expect(reportes.generarExportacion.mock.calls[0]?.[0]).toMatchObject({
      reporte: 'resumen',
      formato: 'xlsx',
      ctx: { empresaId: EMPRESA_B, ambiente: 'produccion' },
    });
  });

  it('sin empresas responde 404 con un texto claro', async () => {
    empresas.listarEmpresas.mockResolvedValue([]);
    const r = await pedir('mi-org', 'reporte=documentos&formato=csv');
    expect(r.status).toBe(404);
    expect(await r.text()).toContain('Aún no hay empresas');
  });

  it('demasiadas filas en boletas → 413 con la guía para acotar o filtrar', async () => {
    reportes.generarExportacion.mockRejectedValue(new ExportacionDemasiadoGrande(61_234));
    const r = await pedir('mi-org', 'reporte=documentos&formato=csv&periodo=todos');
    expect(r.status).toBe(413);
    const cuerpo = await r.text();
    expect(cuerpo).toContain('máximo de 50.000 documentos');
    expect(cuerpo).toContain('filtra por tipo o estado');
  });

  it('demasiadas filas en el resumen → 413 sin aconsejar filtros que el resumen no tiene', async () => {
    reportes.generarExportacion.mockRejectedValue(new ExportacionDemasiadoGrande(50_001));
    const r = await pedir('mi-org', 'reporte=resumen&formato=csv&periodo=2026-11');
    expect(r.status).toBe(413);
    const cuerpo = await r.text();
    expect(cuerpo).toContain('resumen diario');
    expect(cuerpo).not.toContain('Acota el período');
  });

  it('un error inesperado → 500 sin detalles', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportes.generarExportacion.mockRejectedValue(new Error('código 42501 interno'));
    const r = await pedir('mi-org', 'reporte=documentos&formato=csv');
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).toContain('No pudimos generar el archivo');
    expect(cuerpo).not.toContain('42501');
    consola.mockRestore();
  });
});
