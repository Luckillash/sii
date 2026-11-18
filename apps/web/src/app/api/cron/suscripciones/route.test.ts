import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenSincronizacion } from '@/server/pagos';

// La ruta del cron de suscripciones: Bearer = CRON_SECRET, *cron monitor*, avisos de
// morosas y respuesta solo con conteos. El trabajo se prueba en server/pagos.

const {
  sincronizarTodas,
  dependenciasPagos,
  avisarMorosas,
  withMonitor,
  captureException,
  captureMessage,
} = vi.hoisted(() => ({
  sincronizarTodas: vi.fn(),
  dependenciasPagos: vi.fn(),
  avisarMorosas: vi.fn(),
  withMonitor: vi.fn((_slug: string, trabajo: () => unknown) => trabajo()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/server/pagos', () => ({ sincronizarTodas, dependenciasPagos }));
vi.mock('@/server/pagos/avisos', () => ({ avisarMorosas }));
vi.mock('@sentry/nextjs', () => ({ withMonitor, captureException, captureMessage }));

const { GET, POST, maxDuration } = await import('./route');

const SECRETO = 'secreto-del-cron-de-prueba-123456';
const DEPS = { db: { marca: 'db' } };
const RESUMEN: ResumenSincronizacion = {
  revisadas: 2,
  cambiadas: 1,
  morosas: 1,
  canceladas: 0,
  errores: 0,
  resultados: [
    {
      ok: true,
      organizacionId: 'org-1',
      suscripcionId: 'sus-1',
      estadoAnterior: 'activa',
      estadoNuevo: 'morosa',
      vencido: null,
    },
  ],
};

function peticion(metodo: 'GET' | 'POST', autorizacion?: string) {
  return new Request('https://app.boleteame.dev/api/cron/suscripciones', {
    method: metodo,
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRETO);
  dependenciasPagos.mockReset().mockReturnValue(DEPS);
  sincronizarTodas.mockReset().mockResolvedValue(RESUMEN);
  avisarMorosas.mockReset().mockResolvedValue({ enviados: 1 });
  withMonitor.mockClear();
  captureException.mockClear();
  captureMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/cron/suscripciones', () => {
  it('maxDuration de 120 s (el timeout del job)', () => {
    expect(maxDuration).toBe(120);
  });

  it('401 sin Bearer o con otro secreto, sin sincronizar', async () => {
    for (const auth of [undefined, `Basic ${SECRETO}`, 'Bearer otro-secreto-cualquiera-0000']) {
      const r = await POST(peticion('POST', auth));
      expect(r.status).toBe(401);
    }
    expect(sincronizarTodas).not.toHaveBeenCalled();
    expect(dependenciasPagos).not.toHaveBeenCalled();
  });

  it('503 si falta CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(sincronizarTodas).not.toHaveBeenCalled();
  });

  it('503 sin Flow configurado', async () => {
    dependenciasPagos.mockReturnValue(null);
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'pasarela_sin_configurar' });
  });

  it('200 con el Bearer: conteos sin resultados por organización, avisa morosas, dentro del monitor', async () => {
    for (const manejar of [POST, GET]) {
      const r = await manejar(peticion(manejar === POST ? 'POST' : 'GET', `Bearer ${SECRETO}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const cuerpo = await r.json();
      expect(cuerpo).toEqual({
        revisadas: 2,
        cambiadas: 1,
        morosas: 1,
        canceladas: 0,
        errores: 0,
        avisos: { enviados: 1 },
      });
      expect(JSON.stringify(cuerpo)).not.toContain('org-1');
    }
    expect(sincronizarTodas).toHaveBeenCalledWith(DEPS, { limite: 200, presupuestoMs: 90_000 });
    expect(avisarMorosas).toHaveBeenCalledWith(DEPS.db, RESUMEN.resultados);
    expect(withMonitor).toHaveBeenCalledWith(
      'cron-suscripciones',
      expect.any(Function),
      expect.objectContaining({ schedule: { type: 'crontab', value: '41 * * * *' } }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('con errores: 200 y aviso a Sentry', async () => {
    sincronizarTodas.mockResolvedValueOnce({ ...RESUMEN, errores: 2 });
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(
      'suscripciones: corrida con errores',
      expect.objectContaining({ extra: { errores: 2 } }),
    );
  });

  it('500 genérico si la corrida lanza', async () => {
    sincronizarTodas.mockRejectedValueOnce(new Error(`base caída ${SECRETO}`));
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).toBe(JSON.stringify({ error: 'suscripciones_fallidas' }));
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
