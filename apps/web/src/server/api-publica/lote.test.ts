import { describe, expect, it, vi } from 'vitest';
import type { DependenciasApi } from './dependencias';
import { manejarLote, PRESUPUESTO_LOTE_MS } from './lote';
import { manejarApi } from './manejar';
import {
  BOLETA,
  dependenciasPrueba,
  emisorFalso,
  ORG,
  peticion,
  repositorioMemoria,
} from './repositorio-memoria.test-util';

const TE = { ...BOLETA, lineas: [{ nombre: 'Té', cantidad: 1, precio: 990 }] };

function lote(deps: DependenciasApi, documentos: unknown[], idempotencia = 'lote-1') {
  return manejarApi(
    peticion('/documentos/lote', { cuerpo: { documentos }, idempotencia }),
    { ruta: 'POST /documentos/lote', alcance: 'documentos:emitir' },
    manejarLote,
    deps,
  );
}

describe('POST /documentos/lote', () => {
  it('emite cada boleta con su clave <clave>#<n>, en orden, y guarda el lote', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const r = await lote(deps, [BOLETA, TE]);
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({ objeto: 'lote', procesados: 2, pendientes: 0 });
    expect(cuerpo.resultados).toMatchObject([
      {
        indice: 0,
        clave_idempotencia: 'lote-1#1',
        status: 201,
        repetida: false,
        documento: { folio: 43 },
      },
      {
        indice: 1,
        clave_idempotencia: 'lote-1#2',
        status: 201,
        repetida: false,
        documento: { folio: 44 },
      },
    ]);
    expect(deps.emitir).toHaveBeenCalledTimes(2);
    expect(m.idempotencia.get(`${ORG}:lote-1`)?.estado).toBe('terminada');

    const otra = await lote(deps, [BOLETA, TE]);
    expect(otra.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await otra.json()).toEqual(cuerpo);
    expect(deps.emitir).toHaveBeenCalledTimes(2);
  });

  it('valida todas antes de emitir: 422 con los campos de cada boleta y nada emitido', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const r = await lote(deps, [
      BOLETA,
      { ...BOLETA, lineas: [] },
      { ...BOLETA, empresa: undefined },
    ]);
    expect(r.status).toBe(422);
    const { error } = await r.json();
    expect(error.codigo).toBe('datos_invalidos');
    expect(error.campos).toMatchObject({
      'documentos.1.lineas': 'Agrega al menos una línea.',
      'documentos.2': expect.stringContaining('empresa'),
    });
    expect(deps.emitir).not.toHaveBeenCalled();
    expect(m.idempotencia.size).toBe(0);
  });

  it('más de 25 boletas o una lista vacía: 422', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    expect(
      (
        await lote(
          deps,
          Array.from({ length: 26 }, () => BOLETA),
        )
      ).status,
    ).toBe(422);
    expect((await lote(deps, [])).status).toBe(422);
  });

  it('una boleta que falla no frena a las demás; el lote no se guarda y se puede repetir', async () => {
    const m = repositorioMemoria();
    const emisor = emisorFalso(m);
    const emitir = vi
      .fn()
      .mockImplementationOnce(emisor)
      .mockResolvedValueOnce({
        tipo: 'error',
        mensaje: { titulo: 'x', detalle: 'x' },
        motivo: 'sin_folios',
        operacionId: null,
      })
      .mockImplementation(emisor);
    const deps = dependenciasPrueba(m, { emitir });
    const cuerpo = await (await lote(deps, [BOLETA, TE])).json();
    expect(cuerpo.resultados).toMatchObject([
      { status: 201 },
      { status: 422, error: { codigo: 'sin_folios' } },
    ]);
    expect(m.idempotencia.get(`${ORG}:lote-1`)?.estado).toBe('en_curso');

    const repetido = await (await lote(deps, [BOLETA, TE])).json();
    expect(repetido.resultados).toMatchObject([
      { status: 201, repetida: true },
      { status: 201, repetida: false },
    ]);
    expect(emitir).toHaveBeenCalledTimes(3);
  });

  it('presupuesto de tiempo: lo que no alcanza queda pendiente (status null)', async () => {
    const m = repositorioMemoria();
    let ahora = Date.parse('2026-11-18T12:00:00Z');
    const emisor = emisorFalso(m);
    const deps = dependenciasPrueba(m, {
      reloj: () => new Date(ahora),
      emitir: vi.fn(async (ctx, entrada) => {
        ahora += PRESUPUESTO_LOTE_MS / 2 + 1;
        return emisor(ctx, entrada);
      }),
    });
    const cuerpo = await (await lote(deps, [BOLETA, TE, { ...BOLETA, receptor: null }])).json();
    expect(cuerpo).toMatchObject({ procesados: 2, pendientes: 1 });
    expect(cuerpo.resultados[2]).toEqual({
      indice: 2,
      clave_idempotencia: 'lote-1#3',
      status: null,
      repetida: false,
    });
    expect(m.idempotencia.get(`${ORG}:lote-1`)?.estado).toBe('en_curso');
  });

  it('la misma clave con otro lote: 422 idempotencia_conflicto', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    await lote(deps, [BOLETA]);
    const r = await lote(deps, [TE]);
    expect((await r.json()).error.codigo).toBe('idempotencia_conflicto');
  });
});
