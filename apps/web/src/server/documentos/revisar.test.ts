import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseFalsa, type Escritura, type Fila } from './base-falsa.test-util';
import { enviosInciertos } from './lectura';
import {
  marcarEnvioRevisado,
  REVISION_NO_ENCONTRADO,
  REVISION_NO_INCIERTO,
  REVISION_SESION_VENCIDA,
  REVISION_SIN_OPERACION,
} from './revisar';

// «Ya lo revisé» de un envío incierto y su efecto en la alerta del Tablero, con dobles:
// sin red, base ni SII. Reutiliza `marcarInciertaRevisada` (aquí, un doble).

const ORG = '82c456c2-5937-4d35-a178-9128cd7a1cb0';
const OTRA_ORG = '11111111-2222-4333-8444-555555555555';
const EMPRESA = '8a7c4efb-5829-4b11-b23d-632779a33837';
const E1 = 'bff5ea8c-1712-4714-851d-79935e8c1819';
const E2 = 'c0ffee00-1712-4714-851d-79935e8c1819';
const E3 = 'decaf000-1712-4714-851d-79935e8c1819';
const AHORA = new Date('2026-11-17T13:05:00Z');

let envios: Fila[];
let operaciones: Fila[];
let documentos: Fila[];
let escrituras: Escritura[];
const marcar = vi.fn();

function envio(id: string, parcial: Fila = {}): Fila {
  return {
    id,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    proposito: 'emision',
    incierto: true,
    creado_en: '2026-11-17T12:00:00Z',
    ...parcial,
  };
}

function operacion(id: string, envioId: string, parcial: Fila = {}): Fila {
  return {
    id,
    organizacion_id: ORG,
    envio_id: envioId,
    operacion: 'emitir',
    resultado: 'incierto',
    detalle: {},
    ...parcial,
  };
}

let confirmadas: string[] = [];
let sesionValida = true;

function deps() {
  const base = () => baseFalsa({ envios, operaciones_sii: operaciones, documentos }, escrituras);
  return {
    sesion: async () => base(),
    servicio: base,
    marcar,
    ahora: () => AHORA,
    confirmarSesion: async (id: string) => {
      confirmadas.push(id);
      return sesionValida;
    },
  };
}

beforeEach(() => {
  envios = [envio(E1)];
  operaciones = [operacion('op-1', E1)];
  documentos = [
    { organizacion_id: ORG, envio_id: E1, tipo_dte: 39, folio: 42 },
    { organizacion_id: ORG, envio_id: E2, tipo_dte: 39, folio: 43 },
  ];
  escrituras = [];
  confirmadas = [];
  sesionValida = true;
  marcar.mockReset().mockImplementation(async (_c, datos: { operacionId: string }) => {
    // Como `marcarInciertaRevisada`: deja `detalle.revisada_en`.
    const o = operaciones.find((x) => x.id === datos.operacionId);
    if (o) o.detalle = { revisada_en: AHORA.toISOString(), revisada_por: 'usuario-1' };
    return { ok: true };
  });
});

describe('marcarEnvioRevisado', () => {
  it('marca revisada la operación incierta enlazada al envío', async () => {
    const r = await marcarEnvioRevisado(
      { organizacionId: ORG, usuarioId: 'usuario-1' },
      E1,
      deps(),
    );
    expect(r.ok).toBe(true);
    expect(r.mensaje.titulo).toBe('Marcamos el envío como revisado');
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(marcar.mock.calls[0]?.[1]).toEqual({
      organizacionId: ORG,
      operacionId: 'op-1',
      usuarioId: 'usuario-1',
    });
    expect(confirmadas).toEqual(['usuario-1']);
  });

  it('confirma la sesión con getUser() antes de marcar: revocada, no desbloquea nada', async () => {
    sesionValida = false;
    const r = await marcarEnvioRevisado(
      { organizacionId: ORG, usuarioId: 'usuario-1' },
      E1,
      deps(),
    );
    expect(r).toEqual({ ok: false, mensaje: REVISION_SESION_VENCIDA });
    expect(confirmadas).toEqual(['usuario-1']);
    expect(marcar).not.toHaveBeenCalled();
    expect(operaciones[0]?.detalle).toEqual({});
  });

  it('ya revisado: no vuelve a marcar (idempotente)', async () => {
    operaciones = [operacion('op-1', E1, { detalle: { revisada_en: '2026-11-17T11:00:00Z' } })];
    const r = await marcarEnvioRevisado({ organizacionId: ORG, usuarioId: 'u' }, E1, deps());
    expect(r.ok).toBe(true);
    expect(marcar).not.toHaveBeenCalled();
  });

  it('un envío de otra organización no existe', async () => {
    const r = await marcarEnvioRevisado({ organizacionId: OTRA_ORG, usuarioId: 'u' }, E1, deps());
    expect(r).toEqual({ ok: false, mensaje: REVISION_NO_ENCONTRADO });
    expect(marcar).not.toHaveBeenCalled();
  });

  it('un envío que no es incierto no se marca', async () => {
    envios = [envio(E1, { incierto: false })];
    const r = await marcarEnvioRevisado({ organizacionId: ORG, usuarioId: 'u' }, E1, deps());
    expect(r).toEqual({ ok: false, mensaje: REVISION_NO_INCIERTO });
  });

  it('sin operación enlazada lo explica (no inventa una marca)', async () => {
    operaciones = [];
    const r = await marcarEnvioRevisado({ organizacionId: ORG, usuarioId: 'u' }, E1, deps());
    expect(r).toEqual({ ok: false, mensaje: REVISION_SIN_OPERACION });
  });

  it('si la capa SII rechaza la marca, devuelve su mensaje', async () => {
    const mensaje = { titulo: 'No pudimos marcar la operación', detalle: 'Inténtalo de nuevo.' };
    marcar.mockResolvedValue({ ok: false, mensaje });
    expect(await marcarEnvioRevisado({ organizacionId: ORG, usuarioId: 'u' }, E1, deps())).toEqual({
      ok: false,
      mensaje,
    });
  });
});

describe('enviosInciertos (alerta del Tablero)', () => {
  it('excluye los revisados y los del set de pruebas, y trae empresa y ambiente', async () => {
    envios = [
      envio(E1),
      envio(E2, { ambiente: 'produccion' }),
      envio(E3, { proposito: 'set_pruebas' }),
    ];
    operaciones = [operacion('op-1', E1), operacion('op-2', E2), operacion('op-3', E3)];
    const ctx = { organizacionId: ORG, empresaId: EMPRESA };

    const antes = await enviosInciertos(ctx, { sesion: deps().sesion });
    expect(antes.total).toBe(2);
    expect(antes.envios.map((e) => e.id)).toEqual([E1, E2]);
    expect(antes.envios[1]).toMatchObject({ empresaId: EMPRESA, ambiente: 'produccion' });
    expect(antes.envios[0]?.folios).toEqual([{ tipoDte: 39, folio: 42 }]);

    await marcarEnvioRevisado({ organizacionId: ORG, usuarioId: 'u' }, E1, deps());
    const despues = await enviosInciertos(ctx, { sesion: deps().sesion });
    expect(despues.total).toBe(1);
    expect(despues.envios.map((e) => e.id)).toEqual([E2]);
  });

  it('sin inciertos pendientes, la alerta no aparece', async () => {
    operaciones = [operacion('op-1', E1, { detalle: { revisada_en: AHORA.toISOString() } })];
    expect(
      await enviosInciertos({ organizacionId: ORG, empresaId: EMPRESA }, { sesion: deps().sesion }),
    ).toEqual({ envios: [], total: 0 });
  });
});
