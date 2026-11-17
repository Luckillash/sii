import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenSeguimiento } from '@/lib/seguimiento';

// La ruta del cron: autorización (Bearer = CRON_SECRET), *cron monitor* y respuesta. El
// trabajo (`ejecutarSeguimiento`) se prueba en server/seguimiento; aquí es un doble.

const { ejecutarSeguimiento, withMonitor, captureException } = vi.hoisted(() => ({
  ejecutarSeguimiento: vi.fn(),
  withMonitor: vi.fn((_slug: string, trabajo: () => unknown) => trabajo()),
  captureException: vi.fn(),
}));

vi.mock('@/server/seguimiento', () => ({ ejecutarSeguimiento }));
vi.mock('@sentry/nextjs', () => ({ withMonitor, captureException }));

const { GET, POST, maxDuration, runtime, dynamic } = await import('./route');

const SECRETO = 'secreto-del-cron-de-prueba-123456';
const RESUMEN: ResumenSeguimiento = {
  envios: 3,
  consultados: 2,
  cambiados: 1,
  errores: 1,
  gruposOmitidos: 0,
  postergados: 0,
};

function peticion(metodo: 'GET' | 'POST', autorizacion?: string) {
  return new Request('https://boleteame.dev/api/cron/seguimiento', {
    method: metodo,
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRETO);
  ejecutarSeguimiento.mockReset().mockResolvedValue(RESUMEN);
  withMonitor.mockClear();
  captureException.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/cron/seguimiento', () => {
  it('configuración de la ruta: Node.js, dinámica y maxDuration ≤ 300', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBeLessThanOrEqual(300);
  });

  it('401 sin Bearer, con otro esquema o con otro secreto (y no ejecuta nada)', async () => {
    for (const auth of [
      undefined,
      `Basic ${SECRETO}`,
      'Bearer otro-secreto-cualquiera-0000',
      'Bearer',
    ]) {
      const r = await POST(peticion('POST', auth));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'no_autorizado' });
    }
    expect(ejecutarSeguimiento).not.toHaveBeenCalled();
    expect(withMonitor).not.toHaveBeenCalled();
  });

  it('503 si falta CRON_SECRET (nunca queda abierta)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'cron_sin_configurar' });
    expect(ejecutarSeguimiento).not.toHaveBeenCalled();
  });

  it('200 con el Bearer correcto (POST de pg_net y GET): el resumen, dentro del cron monitor', async () => {
    for (const manejar of [POST, GET]) {
      const r = await manejar(peticion(manejar === POST ? 'POST' : 'GET', `Bearer ${SECRETO}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual(RESUMEN);
    }
    expect(ejecutarSeguimiento).toHaveBeenCalledTimes(2);
    expect(withMonitor).toHaveBeenCalledWith(
      'cron-seguimiento',
      expect.any(Function),
      expect.objectContaining({ schedule: { type: 'crontab', value: '*/5 * * * *' } }),
    );
  });

  it('500 genérico si la corrida falla: sin detalle ni secretos en la respuesta', async () => {
    ejecutarSeguimiento.mockRejectedValueOnce(new Error(`relation secreta ${SECRETO}`));
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).toBe(JSON.stringify({ error: 'seguimiento_fallido' }));
    expect(cuerpo).not.toContain(SECRETO);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
