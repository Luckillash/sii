import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Borrador, ResultadoEmision } from '@/lib/emision';
import { MENSAJE_GENERICO } from '@/lib/equipo-errores';

// Server Actions de `/[org]/emitir` con dobles: la sesión, la empresa y `server/emision`
// (que hoy es un esqueleto) se simulan. No hay red, base ni SII.

const ID_EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const ID_BORRADOR = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const ID_DOCUMENTO = '4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f';

const estado = vi.hoisted(() => ({
  rol: 'emisor' as string,
  empresaExiste: true,
  revalidadas: [] as string[],
}));

const emision = vi.hoisted(() => ({
  emitirDocumento: vi.fn(),
  guardarBorrador: vi.fn(),
  borrarBorrador: vi.fn(),
  buscarReceptores: vi.fn(),
  buscarProductos: vi.fn(),
  enlaceDocumento: vi.fn(),
  leerVistaEmision: vi.fn(),
}));

vi.mock('@/server/emision', () => emision);
vi.mock('@/server/sesion', () => ({
  exigirMembresia: async (slug: string) => ({
    usuario: { id: 'usuario-1', correo: 'emisor@example.com' },
    organizacion: { id: 'org-1', slug, nombre: 'Org de prueba' },
    rol: estado.rol,
  }),
}));
vi.mock('@/server/empresas', () => ({
  obtenerEmpresa: async (organizacionId: string, empresaId: string) =>
    estado.empresaExiste ? { id: empresaId, organizacionId } : null,
}));
vi.mock('next/cache', () => ({
  revalidatePath: (ruta: string) => {
    estado.revalidadas.push(ruta);
  },
}));

const acciones = await import('./acciones');

const CTX = { organizacionId: 'org-1', empresaId: ID_EMPRESA, usuarioId: 'usuario-1' };

function borrador(parcial: Partial<Borrador> = {}): Borrador {
  return {
    tipoDte: 39,
    ambiente: 'certificacion',
    receptor: { rut: '' },
    lineas: [{ nombre: 'Mantención', cantidad: 1, precio: 11_900, exento: false }],
    ...parcial,
  };
}

const OK: ResultadoEmision = {
  tipo: 'ok',
  mensaje: { titulo: 'Boleta emitida', detalle: 'El SII la recibió.' },
  operacionId: 'op-1',
  documento: {
    id: ID_DOCUMENTO,
    tipoDte: 39,
    ambiente: 'certificacion',
    folio: 41,
    estado: 'enviado',
    total: 11_900,
    trackId: '123456',
    conPdf: true,
    correoEnviado: false,
  },
};

beforeEach(() => {
  estado.rol = 'emisor';
  estado.empresaExiste = true;
  estado.revalidadas = [];
  for (const f of Object.values(emision)) f.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('permisos y empresa', () => {
  it('un lector no puede emitir ni guardar, y no se llama al backend', async () => {
    estado.rol = 'lector';
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'ensayo', borrador: borrador() });
    expect(r).toMatchObject({
      tipo: 'error',
      mensaje: { titulo: 'No tienes permiso para emitir' },
    });
    const g = await acciones.guardarBorrador('acme', ID_EMPRESA, { borrador: borrador() });
    expect(g.tipo).toBe('error');
    const b = await acciones.borrarBorrador('acme', ID_EMPRESA, ID_BORRADOR);
    expect(b.ok).toBe(false);
    const e = await acciones.enlaceDocumento('acme', ID_EMPRESA, ID_DOCUMENTO, 'xml');
    expect(e.ok).toBe(false);
    expect(await acciones.buscarReceptores('acme', ID_EMPRESA, 'Aromos')).toEqual([]);
    expect(await acciones.buscarProductos('acme', ID_EMPRESA, 'Mant')).toEqual([]);
    for (const f of Object.values(emision)) expect(f).not.toHaveBeenCalled();
  });

  it.each(['propietario', 'administrador', 'emisor'])('%s sí puede', async (rol) => {
    estado.rol = rol;
    emision.emitirDocumento.mockResolvedValue({ tipo: 'ensayo', resumen: {} });
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'ensayo', borrador: borrador() });
    expect(r.tipo).toBe('ensayo');
  });

  it('una empresa de otra organización o un id inválido: no encontrada', async () => {
    estado.empresaExiste = false;
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'ensayo', borrador: borrador() });
    expect(r).toMatchObject({ tipo: 'error', mensaje: { titulo: 'No encontramos la empresa' } });
    estado.empresaExiste = true;
    const r2 = await acciones.emitir('acme', 'no-es-uuid', {
      nivel: 'ensayo',
      borrador: borrador(),
    });
    expect(r2).toMatchObject({ tipo: 'error', mensaje: { titulo: 'No encontramos la empresa' } });
    expect(emision.emitirDocumento).not.toHaveBeenCalled();
  });
});

describe('emitir', () => {
  it('valida con esquemaBorrador y devuelve los errores por campo', async () => {
    const r = await acciones.emitir('acme', ID_EMPRESA, {
      nivel: 'emitir',
      borrador: borrador({
        receptor: { rut: '76.354.771-0' },
        lineas: [{ nombre: '', cantidad: 0, precio: 1.5, exento: false }],
      }),
    });
    expect(r.tipo).toBe('error');
    if (r.tipo !== 'error') return;
    expect(r.mensaje.titulo).toBe('Revisa la boleta');
    expect(r.errores).toMatchObject({
      'receptor.rut': 'Revisa el RUT.',
      'lineas.0.nombre': 'Escribe el nombre del producto o servicio.',
      'lineas.0.cantidad': 'La cantidad tiene que ser mayor que 0.',
      'lineas.0.precio': 'El precio va en pesos, sin decimales.',
    });
    expect(emision.emitirDocumento).not.toHaveBeenCalled();
  });

  it('un nivel o borradorId inválido no llega al backend', async () => {
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'timbrar', borrador: borrador() });
    expect(r.tipo).toBe('error');
    const r2 = await acciones.emitir('acme', ID_EMPRESA, {
      nivel: 'emitir',
      borrador: borrador(),
      borradorId: 'x',
    });
    expect(r2.tipo).toBe('error');
    expect(emision.emitirDocumento).not.toHaveBeenCalled();
  });

  it('pasa el borrador ya validado (receptor genérico normalizado) y el borradorId', async () => {
    emision.emitirDocumento.mockResolvedValue(OK);
    const r = await acciones.emitir('acme', ID_EMPRESA, {
      nivel: 'emitir',
      borrador: borrador(),
      borradorId: ID_BORRADOR,
    });
    expect(r).toEqual(OK);
    expect(emision.emitirDocumento).toHaveBeenCalledWith(CTX, {
      nivel: 'emitir',
      borradorId: ID_BORRADOR,
      borrador: expect.objectContaining({
        receptor: {
          rut: '66666666-6',
          razonSocial: 'Cliente General',
          correo: null,
          receptorId: null,
        },
      }),
    });
    expect(estado.revalidadas).toEqual(['/acme/emitir', '/acme/folios']);
  });

  it('el ensayo no revalida (no cambia nada)', async () => {
    emision.emitirDocumento.mockResolvedValue({ tipo: 'ensayo', resumen: {} });
    await acciones.emitir('acme', ID_EMPRESA, { nivel: 'ensayo', borrador: borrador() });
    expect(estado.revalidadas).toEqual([]);
    expect(emision.emitirDocumento.mock.calls[0]?.[1]).not.toHaveProperty('borradorId');
  });

  it('una excepción en el ensayo vuelve como mensaje genérico, sin detalles técnicos', async () => {
    emision.emitirDocumento.mockRejectedValue(new Error('detalle interno 23514 con datos'));
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'ensayo', borrador: borrador() });
    expect(r).toMatchObject({ tipo: 'error', mensaje: MENSAJE_GENERICO });
    expect(JSON.stringify(r)).not.toContain('23514');
    // Solo el tipo de error en el registro, nunca el mensaje.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('detalle interno');
  });

  it('una excepción al emitir queda por verificar: no se sabe si salió al SII', async () => {
    emision.emitirDocumento.mockRejectedValue(new Error('socket hang up'));
    const r = await acciones.emitir('acme', ID_EMPRESA, { nivel: 'emitir', borrador: borrador() });
    expect(r.tipo).toBe('error');
    if (r.tipo !== 'error') return;
    expect(r.resultado).toBe('incierto');
    expect(r.mensaje.detalle).toMatch(/No la vuelvas a emitir hasta revisarlo/);
    expect(JSON.stringify(r)).not.toContain('socket');
    expect(estado.revalidadas).toContain('/acme/emitir');
  });
});

describe('borradores', () => {
  it('guardarBorrador valida y llama al backend con el id', async () => {
    emision.guardarBorrador.mockResolvedValue({
      tipo: 'borrador',
      documentoId: ID_BORRADOR,
      mensaje: { titulo: 'Borrador guardado', detalle: '' },
    });
    const r = await acciones.guardarBorrador('acme', ID_EMPRESA, {
      borrador: borrador(),
      borradorId: ID_BORRADOR,
    });
    expect(r.tipo).toBe('borrador');
    expect(emision.guardarBorrador).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ tipoDte: 39 }),
      ID_BORRADOR,
    );
    expect(estado.revalidadas).toEqual(['/acme/emitir']);
  });

  it('guardarBorrador inválido o con excepción', async () => {
    const r = await acciones.guardarBorrador('acme', ID_EMPRESA, {
      borrador: borrador({ lineas: [] }),
    });
    expect(r).toMatchObject({ tipo: 'error', errores: { lineas: 'Agrega al menos una línea.' } });
    emision.guardarBorrador.mockRejectedValue(new Error('x'));
    const r2 = await acciones.guardarBorrador('acme', ID_EMPRESA, { borrador: borrador() });
    expect(r2).toMatchObject({ tipo: 'error', mensaje: MENSAJE_GENERICO });
  });

  it('borrarBorrador valida el id y traduce una excepción', async () => {
    expect(await acciones.borrarBorrador('acme', ID_EMPRESA, 'x')).toMatchObject({ ok: false });
    emision.borrarBorrador.mockResolvedValue({ ok: true });
    expect(await acciones.borrarBorrador('acme', ID_EMPRESA, ID_BORRADOR)).toEqual({ ok: true });
    expect(emision.borrarBorrador).toHaveBeenCalledWith(CTX, ID_BORRADOR);
    emision.borrarBorrador.mockRejectedValue(new Error('x'));
    expect(await acciones.borrarBorrador('acme', ID_EMPRESA, ID_BORRADOR)).toEqual({
      ok: false,
      mensaje: MENSAJE_GENERICO,
    });
  });
});

describe('autocompletado y descargas', () => {
  it('búsquedas: menos de 2 letras ni consulta; texto recortado; excepción = sin sugerencias', async () => {
    expect(await acciones.buscarReceptores('acme', ID_EMPRESA, ' a ')).toEqual([]);
    expect(emision.buscarReceptores).not.toHaveBeenCalled();
    emision.buscarReceptores.mockResolvedValue([{ id: '1' }]);
    expect(await acciones.buscarReceptores('acme', ID_EMPRESA, '  Aromos ')).toEqual([{ id: '1' }]);
    expect(emision.buscarReceptores).toHaveBeenCalledWith(
      { organizacionId: 'org-1', empresaId: ID_EMPRESA },
      'Aromos',
    );
    emision.buscarProductos.mockRejectedValue(new Error('x'));
    expect(await acciones.buscarProductos('acme', ID_EMPRESA, 'Mant')).toEqual([]);
    const largo = 'x'.repeat(500);
    emision.buscarProductos.mockResolvedValue([]);
    await acciones.buscarProductos('acme', ID_EMPRESA, largo);
    expect(emision.buscarProductos.mock.calls.at(-1)?.[1]).toHaveLength(100);
  });

  it('enlaceDocumento valida el archivo y el id', async () => {
    const malo = await acciones.enlaceDocumento(
      'acme',
      ID_EMPRESA,
      ID_DOCUMENTO,
      'pdf_a4' as unknown as 'xml',
    );
    expect(malo.ok).toBe(false);
    expect((await acciones.enlaceDocumento('acme', ID_EMPRESA, 'x', 'xml')).ok).toBe(false);
    emision.enlaceDocumento.mockResolvedValue({ ok: true, url: 'https://firmada' });
    expect(await acciones.enlaceDocumento('acme', ID_EMPRESA, ID_DOCUMENTO, 'pdf_rollo')).toEqual({
      ok: true,
      url: 'https://firmada',
    });
    expect(emision.enlaceDocumento).toHaveBeenCalledWith(
      { organizacionId: 'org-1', empresaId: ID_EMPRESA },
      ID_DOCUMENTO,
      'pdf_rollo',
    );
    emision.enlaceDocumento.mockRejectedValue(new Error('x'));
    expect(await acciones.enlaceDocumento('acme', ID_EMPRESA, ID_DOCUMENTO, 'xml')).toEqual({
      ok: false,
      mensaje: MENSAJE_GENERICO,
    });
  });
});
