import { describe, expect, it, vi } from 'vitest';
import type { ResultadoFolios } from '@/lib/folios';
import type { DependenciasApi } from './dependencias';
import { manejarFolios, manejarSolicitudFolios } from './folios';
import { manejarApi } from './manejar';
import {
  API_KEY,
  dependenciasPrueba,
  EMPRESA,
  ORG,
  peticion,
  RUT_EMPRESA,
  repositorioMemoria,
} from './repositorio-memoria.test-util';

const CAF_ID = '77777777-0000-4000-8000-000000000001';
const SOLICITUD = '77777777-0000-4000-8000-0000000000aa';

function caf(cambios: Record<string, unknown> = {}) {
  return {
    id: CAF_ID,
    ambiente: 'certificacion' as const,
    tipo_dte: 39,
    folio_desde: 41,
    folio_hasta: 45,
    siguiente_folio: 43,
    estado: 'activo' as const,
    fecha_autorizacion: '2026-11-15',
    ...cambios,
  };
}

describe('GET /folios', () => {
  function folios(deps: DependenciasApi, q = `?empresa=${RUT_EMPRESA}`) {
    return manejarApi(
      peticion(`/folios${q}`),
      { ruta: 'GET /folios', alcance: 'folios:leer' },
      manejarFolios,
      deps,
    );
  }

  it('disponibles por tipo en el ambiente de la clave, con sus CAF', async () => {
    const m = repositorioMemoria({
      cafs: [caf(), caf({ id: 'otro', ambiente: 'produccion', siguiente_folio: 41 })],
    });
    const r = await folios(dependenciasPrueba(m));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      objeto: 'folios',
      empresa: { id: EMPRESA, rut: RUT_EMPRESA, razon_social: 'EMPRESA DE PRUEBA SPA' },
      ambiente: 'certificacion',
      tipos: [
        {
          tipo_dte: 39,
          disponibles: 3,
          total: 5,
          siguiente_folio: 43,
          estado: 'ok',
          cafs: [
            {
              id: CAF_ID,
              folio_desde: 41,
              folio_hasta: 45,
              siguiente_folio: 43,
              disponibles: 3,
              estado: 'activo',
              fecha_autorizacion: '2026-11-15',
            },
          ],
        },
        {
          tipo_dte: 41,
          disponibles: 0,
          total: 0,
          siguiente_folio: null,
          estado: 'sin_folios',
          cafs: [],
        },
      ],
    });
  });

  it('agotado y por agotarse; filtro por tipo; empresa requerida', async () => {
    const agotado = repositorioMemoria({
      cafs: [caf({ siguiente_folio: 46, estado: 'agotado' })],
    });
    const c = await (
      await folios(dependenciasPrueba(agotado), `?empresa=${RUT_EMPRESA}&tipo_dte=39`)
    ).json();
    expect(c.tipos).toHaveLength(1);
    expect(c.tipos[0]).toMatchObject({ estado: 'agotado', disponibles: 0 });

    const poco = repositorioMemoria({
      cafs: [caf({ folio_desde: 1, folio_hasta: 100, siguiente_folio: 95 })],
    });
    expect((await (await folios(dependenciasPrueba(poco))).json()).tipos[0].estado).toBe(
      'por_agotarse',
    );
    expect((await folios(dependenciasPrueba(poco), '')).status).toBe(422);
    expect(
      (await folios(dependenciasPrueba(poco), `?empresa=${RUT_EMPRESA}&tipo_dte=33`)).status,
    ).toBe(400);
  });
});

describe('POST /folios/solicitudes', () => {
  function solicitar(deps: DependenciasApi, cuerpo: unknown, idempotencia?: string) {
    return manejarApi(
      peticion('/folios/solicitudes', { cuerpo, ...(idempotencia ? { idempotencia } : {}) }),
      { ruta: 'POST /folios/solicitudes', alcance: 'folios:solicitar' },
      manejarSolicitudFolios,
      deps,
    );
  }
  const base = { empresa: RUT_EMPRESA, tipo_dte: 39, cantidad: 5 };

  it('ensayo y revisión: con el contexto de la API (usuarioId null) y sin Idempotency-Key', async () => {
    const m = repositorioMemoria();
    const solicitarFolios = vi
      .fn()
      .mockResolvedValueOnce({
        tipo: 'ensayo',
        resumen: { titulo: 'Pedir folios de certificación', avisos: ['Uno.', 'Dos.'] },
      })
      .mockResolvedValueOnce({
        tipo: 'revision',
        mensaje: { titulo: 'x', detalle: 'x' },
        revision: { revisionId: SOLICITUD, desde: 46, hasta: 50 },
        operacionId: 'op-rev',
      });
    const deps = dependenciasPrueba(m, { solicitarFolios });
    const ensayo = await (await solicitar(deps, { ...base, nivel: 'ensayo' })).json();
    expect(ensayo).toMatchObject({
      objeto: 'solicitud_folios',
      nivel: 'ensayo',
      ambiente: 'certificacion',
      desde: null,
      aviso: { titulo: 'Pedir folios de certificación', detalle: 'Uno. Dos.' },
    });
    const revision = await (await solicitar(deps, { ...base, nivel: 'revision' })).json();
    expect(revision).toMatchObject({
      nivel: 'revision',
      desde: 46,
      hasta: 50,
      revision_id: SOLICITUD,
      operacion_id: 'op-rev',
    });
    expect(solicitarFolios).toHaveBeenCalledWith(
      { organizacionId: ORG, empresaId: EMPRESA, usuarioId: null, apiKeyId: API_KEY },
      { nivel: 'revision', tipoDte: 39, ambiente: 'certificacion', cantidad: 5 },
    );
    expect(m.idempotencia.size).toBe(0);
  });

  it('timbrar exige Idempotency-Key; 201 con el CAF y repetir no vuelve a pedir folios', async () => {
    const m = repositorioMemoria({
      cafs: [caf({ id: CAF_ID, siguiente_folio: 41, solicitud_id: SOLICITUD })],
      operaciones: [{ id: 'op-t', solicitud_id: SOLICITUD }],
    });
    const solicitarFolios = vi.fn(
      async (): Promise<ResultadoFolios> => ({
        tipo: 'ok',
        mensaje: { titulo: 'El SII timbró los folios', detalle: 'x' },
        operacionId: 'op-t',
      }),
    );
    const deps = dependenciasPrueba(m, { solicitarFolios });
    const sinClave = await solicitar(deps, { ...base, nivel: 'timbrar' });
    expect((await sinClave.json()).error.codigo).toBe('idempotencia_requerida');

    const r = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'folios-1');
    expect(r.status).toBe(201);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({
      nivel: 'timbrar',
      desde: 41,
      hasta: 45,
      caf: { id: CAF_ID, disponibles: 5 },
      operacion_id: 'op-t',
    });
    const otra = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'folios-1');
    expect(otra.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await otra.json()).toEqual(cuerpo);
    expect(solicitarFolios).toHaveBeenCalledTimes(1);
  });

  it('timbraje ok sin poder guardar la respuesta: al retomar responde el CAF sin timbrar otra vez', async () => {
    const m = repositorioMemoria({
      cafs: [caf({ id: CAF_ID, siguiente_folio: 41, solicitud_id: SOLICITUD })],
      operaciones: [{ id: 'op-t', solicitud_id: SOLICITUD }],
    });
    const solicitarFolios = vi.fn(
      async (): Promise<ResultadoFolios> => ({
        tipo: 'ok',
        mensaje: { titulo: 'El SII timbró los folios', detalle: 'x' },
        operacionId: 'op-t',
      }),
    );
    vi.spyOn(m.repo, 'terminarIdempotencia').mockRejectedValueOnce(new Error('base caída'));
    const deps = dependenciasPrueba(m, { solicitarFolios });
    const caida = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'folios-1');
    expect(caida.status).toBe(500);
    expect(m.idempotencia.get(`${ORG}:folios-1`)?.recursoId).toBe('op-t');

    const r = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'folios-1');
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({
      desde: 41,
      hasta: 45,
      caf: { id: CAF_ID },
      operacion_id: 'op-t',
    });
    expect(solicitarFolios).toHaveBeenCalledTimes(1);
    expect(m.idempotencia.get(`${ORG}:folios-1`)?.estado).toBe('terminada');
  });

  it('incierto: 202 guardado; revisión requerida y en curso: 422 y 409', async () => {
    const m = repositorioMemoria();
    const solicitarFolios = vi
      .fn()
      .mockResolvedValueOnce({
        tipo: 'error',
        resultado: 'incierto',
        mensaje: { titulo: 'No sabemos si el SII timbró', detalle: 'Revisa en el SII.' },
        operacionId: 'op-i',
      })
      .mockResolvedValueOnce({
        tipo: 'error',
        motivo: 'revision_requerida',
        mensaje: { titulo: 'Revisa primero', detalle: 'Revisa con el SII antes de timbrar.' },
        operacionId: null,
      })
      .mockResolvedValueOnce({
        tipo: 'error',
        motivo: 'incierto_sin_revisar',
        mensaje: { titulo: 'x', detalle: 'x' },
        operacionId: null,
        operacionPendienteId: 'op-i',
      });
    const deps = dependenciasPrueba(m, { solicitarFolios });
    const incierto = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'f-1');
    expect(incierto.status).toBe(202);
    expect(await incierto.json()).toMatchObject({
      operacion_id: 'op-i',
      aviso: { titulo: 'No sabemos si el SII timbró' },
    });
    expect(m.idempotencia.get(`${ORG}:f-1`)?.estado).toBe('terminada');

    const revision = await solicitar(deps, { ...base, nivel: 'timbrar' }, 'f-2');
    expect(revision.status).toBe(422);
    expect((await revision.json()).error).toMatchObject({
      codigo: 'revision_requerida',
      mensaje: 'Revisa con el SII antes de timbrar.',
    });
    expect(m.llamadas).toContain('soltar:f-2');

    const bloqueada = await solicitar(deps, { ...base, nivel: 'revision' });
    expect(bloqueada.status).toBe(409);
    expect((await bloqueada.json()).error).toMatchObject({
      codigo: 'incierto_sin_revisar',
      operacion_pendiente_id: 'op-i',
    });
  });

  it('el folio inicial que pide el SII vuelve en campos; ambiente distinto: 422', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, {
      solicitarFolios: vi.fn(async () => ({
        tipo: 'error' as const,
        resultado: 'uso' as const,
        mensaje: { titulo: 'Falta el folio inicial', detalle: 'El SII pide el folio inicial.' },
        operacionId: 'op',
        requiere: { folioInicial: { sugerido: '1' } },
      })),
    });
    const r = await solicitar(deps, { ...base, nivel: 'revision' });
    expect((await r.json()).error).toMatchObject({
      codigo: 'datos_invalidos',
      campos: { folio_inicial: expect.stringContaining('sugiere 1') },
    });
    const otro = await solicitar(deps, { ...base, nivel: 'ensayo', ambiente: 'produccion' });
    expect((await otro.json()).error.codigo).toBe('ambiente_no_coincide');
  });
});
