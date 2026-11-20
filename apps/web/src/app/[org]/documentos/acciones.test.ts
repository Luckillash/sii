import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MENSAJE_GENERICO } from '@/lib/equipo-errores';

// Server Actions de `/[org]/documentos` con dobles: la sesión, `server/documentos`,
// `server/emision` y `server/seguimiento` se simulan. No hay red, base ni SII.

const ENVIO = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const DOC = '4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f';
const EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

const estado = vi.hoisted(() => ({
  rol: 'emisor' as string,
  miembro: true,
  revalidadas: [] as string[],
}));

const documentos = vi.hoisted(() => ({
  leerEnvioMinimo: vi.fn(),
  reenviarAlReceptor: vi.fn(),
  empresaDelDocumento: vi.fn(),
  marcarEnvioRevisado: vi.fn(),
}));
const seguimiento = vi.hoisted(() => ({ consultarEnvio: vi.fn() }));
const emision = vi.hoisted(() => ({ enlaceDocumento: vi.fn() }));

vi.mock('@/server/documentos', () => documentos);
vi.mock('@/server/seguimiento', () => seguimiento);
vi.mock('@/server/emision', () => emision);
vi.mock('@/server/sesion', () => ({
  exigirMembresia: async (slug: string) => {
    // Como `notFound()`: lanza y la acción no sigue.
    if (!estado.miembro) throw new Error('NEXT_NOT_FOUND');
    return {
      usuario: { id: 'usuario-1', correo: 'emisor@example.com' },
      organizacion: { id: 'org-1', slug, nombre: 'Org de prueba' },
      rol: estado.rol,
    };
  },
}));
vi.mock('next/cache', () => ({
  revalidatePath: (ruta: string) => {
    estado.revalidadas.push(ruta);
  },
}));

const acciones = await import('./acciones');

beforeEach(() => {
  estado.rol = 'emisor';
  estado.miembro = true;
  estado.revalidadas = [];
  for (const f of [
    ...Object.values(documentos),
    ...Object.values(seguimiento),
    ...Object.values(emision),
  ]) {
    f.mockReset();
  }
  documentos.leerEnvioMinimo.mockResolvedValue({ id: ENVIO, incierto: false, trackId: '34015200' });
  documentos.empresaDelDocumento.mockResolvedValue(EMPRESA);
});

describe('consultarEstado', () => {
  it('sin membresía no consulta nada', async () => {
    estado.miembro = false;
    await expect(acciones.consultarEstado('otra', ENVIO)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(seguimiento.consultarEnvio).not.toHaveBeenCalled();
  });

  it('un envío de otra organización no existe', async () => {
    documentos.leerEnvioMinimo.mockResolvedValue(null);
    const r = await acciones.consultarEstado('mi-org', ENVIO);
    expect(r.tipo).toBe('error');
    expect(documentos.leerEnvioMinimo).toHaveBeenCalledWith('org-1', ENVIO);
    expect(seguimiento.consultarEnvio).not.toHaveBeenCalled();
  });

  it('un id inválido no llega al backend', async () => {
    const r = await acciones.consultarEstado('mi-org', 'x');
    expect(r.tipo).toBe('error');
    expect(documentos.leerEnvioMinimo).not.toHaveBeenCalled();
  });

  it('un envío incierto no se consulta: guía para revisar en el SII', async () => {
    documentos.leerEnvioMinimo.mockResolvedValue({ id: ENVIO, incierto: true, trackId: null });
    const r = await acciones.consultarEstado('mi-org', ENVIO);
    expect(r.tipo).toBe('sin_track_id');
    if (r.tipo === 'sin_track_id') expect(r.mensaje.detalle).toContain('sitio del SII');
    expect(seguimiento.consultarEnvio).not.toHaveBeenCalled();
  });

  it('llama a `consultarEnvio` con la organización de la membresía y revalida', async () => {
    seguimiento.consultarEnvio.mockResolvedValue({
      tipo: 'consultado',
      estadoSii: 'EPR',
      glosaSii: null,
      clasificacion: 'aceptado',
      cambio: true,
    });
    const r = await acciones.consultarEstado('mi-org', ENVIO);
    expect(r.tipo).toBe('consultado');
    expect(seguimiento.consultarEnvio).toHaveBeenCalledWith({
      organizacionId: 'org-1',
      envioId: ENVIO,
      usuarioId: 'usuario-1',
    });
    expect(estado.revalidadas).toEqual(['/mi-org/documentos', `/mi-org/envios/${ENVIO}`]);
  });

  it('un lector también puede consultar', async () => {
    estado.rol = 'lector';
    seguimiento.consultarEnvio.mockResolvedValue({ tipo: 'final', clasificacion: 'aceptado' });
    expect((await acciones.consultarEstado('mi-org', ENVIO)).tipo).toBe('final');
  });

  it('una excepción vuelve como mensaje genérico', async () => {
    seguimiento.consultarEnvio.mockRejectedValue(new Error('boom'));
    expect(await acciones.consultarEstado('mi-org', ENVIO)).toEqual({
      tipo: 'error',
      mensaje: MENSAJE_GENERICO,
    });
  });
});

describe('reenviarAlReceptor', () => {
  it('un lector no puede reenviar', async () => {
    estado.rol = 'lector';
    const r = await acciones.reenviarAlReceptor('mi-org', DOC);
    expect(r.ok).toBe(false);
    expect(r.mensaje.titulo).toBe('No tienes permiso para reenviar boletas');
    expect(documentos.reenviarAlReceptor).not.toHaveBeenCalled();
  });

  it('sin correo del receptor: el mensaje del backend llega tal cual', async () => {
    const mensaje = { titulo: 'La boleta no tiene correo del receptor', detalle: 'x' };
    documentos.reenviarAlReceptor.mockResolvedValue({ ok: false, mensaje });
    expect(await acciones.reenviarAlReceptor('mi-org', DOC)).toEqual({ ok: false, mensaje });
    expect(documentos.reenviarAlReceptor).toHaveBeenCalledWith({ organizacionId: 'org-1' }, DOC);
    expect(estado.revalidadas).toEqual([]);
  });

  it('un emisor reenvía y se revalida la lista', async () => {
    documentos.reenviarAlReceptor.mockResolvedValue({
      ok: true,
      mensaje: { titulo: 'Reenviamos la boleta', detalle: 'x' },
    });
    expect((await acciones.reenviarAlReceptor('mi-org', DOC)).ok).toBe(true);
    expect(estado.revalidadas).toEqual(['/mi-org/documentos']);
  });
});

describe('enlaceArchivo', () => {
  it('firma con la empresa del documento (no con una que mande el navegador)', async () => {
    emision.enlaceDocumento.mockResolvedValue({ ok: true, url: 'https://firmada' });
    estado.rol = 'lector';
    expect(await acciones.enlaceArchivo('mi-org', DOC, 'pdf_rollo')).toEqual({
      ok: true,
      url: 'https://firmada',
    });
    expect(emision.enlaceDocumento).toHaveBeenCalledWith(
      { organizacionId: 'org-1', empresaId: EMPRESA },
      DOC,
      'pdf_rollo',
    );
  });

  it('un documento de otra organización o un archivo inválido no se firma', async () => {
    documentos.empresaDelDocumento.mockResolvedValue(null);
    expect((await acciones.enlaceArchivo('mi-org', DOC, 'xml')).ok).toBe(false);
    expect((await acciones.enlaceArchivo('mi-org', DOC, 'exe' as unknown as 'xml')).ok).toBe(false);
    expect(emision.enlaceDocumento).not.toHaveBeenCalled();
  });
});

describe('marcarRevisado («Ya lo revisé»)', () => {
  it('un lector no puede marcar', async () => {
    estado.rol = 'lector';
    const r = await acciones.marcarRevisado('mi-org', ENVIO);
    expect(r.ok).toBe(false);
    expect(documentos.marcarEnvioRevisado).not.toHaveBeenCalled();
  });

  it('sin membresía no marca nada', async () => {
    estado.miembro = false;
    await expect(acciones.marcarRevisado('otra', ENVIO)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(documentos.marcarEnvioRevisado).not.toHaveBeenCalled();
  });

  it('un emisor marca con su usuario y se revalidan el envío, la lista y el Tablero', async () => {
    documentos.marcarEnvioRevisado.mockResolvedValue({
      ok: true,
      mensaje: { titulo: 'Marcamos el envío como revisado', detalle: 'x' },
    });
    expect((await acciones.marcarRevisado('mi-org', ENVIO)).ok).toBe(true);
    expect(documentos.marcarEnvioRevisado).toHaveBeenCalledWith(
      { organizacionId: 'org-1', usuarioId: 'usuario-1' },
      ENVIO,
    );
    expect(estado.revalidadas).toEqual([
      '/mi-org/documentos',
      `/mi-org/envios/${ENVIO}`,
      '/mi-org/tablero',
    ]);
  });

  it('un id inválido no llega al backend', async () => {
    expect((await acciones.marcarRevisado('mi-org', 'x')).ok).toBe(false);
    expect(documentos.marcarEnvioRevisado).not.toHaveBeenCalled();
  });
});
