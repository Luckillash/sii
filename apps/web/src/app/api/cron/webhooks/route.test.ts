import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenWebhooks } from '@/server/webhooks';

// La ruta del cron de webhooks: autorización (Bearer = CRON_SECRET), *cron monitor* y
// respuesta. La corrida (`ejecutarEntregas`) se prueba en server/webhooks; aquí es un doble.

const { ejecutarEntregas, withMonitor, captureException, captureMessage } = vi.hoisted(() => ({
  ejecutarEntregas: vi.fn(),
  withMonitor: vi.fn((_slug: string, trabajo: () => unknown) => trabajo()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/server/webhooks', () => ({ ejecutarEntregas }));
vi.mock('@sentry/nextjs', () => ({ withMonitor, captureException, captureMessage }));

const { GET, POST, maxDuration, runtime, dynamic } = await import('./route');

const SECRETO = 'secreto-del-cron-de-prueba-123456';
const RESUMEN: ResumenWebhooks = {
  reclamadas: 3,
  entregadas: 2,
  fallidas: 1,
  descartadas: 0,
  postergadas: 0,
  errores: 0,
};

function peticion(metodo: 'GET' | 'POST', autorizacion?: string) {
  return new Request('https://boleteame.dev/api/cron/webhooks', {
    method: metodo,
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRETO);
  ejecutarEntregas.mockReset().mockResolvedValue(RESUMEN);
  withMonitor.mockClear();
  captureException.mockClear();
  captureMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/cron/webhooks', () => {
  it('configuración de la ruta: Node.js, dinámica y maxDuration de 60 s (el timeout del job)', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(60);
  });

  it('401 sin Bearer, con otro esquema o con otro secreto (y no entrega nada)', async () => {
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
    expect(ejecutarEntregas).not.toHaveBeenCalled();
    expect(withMonitor).not.toHaveBeenCalled();
  });

  it('503 si falta CRON_SECRET (nunca queda abierta)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'cron_sin_configurar' });
    expect(ejecutarEntregas).not.toHaveBeenCalled();
  });

  it('200 con el Bearer correcto (POST y GET): solo conteos, dentro del monitor cada minuto', async () => {
    for (const manejar of [POST, GET]) {
      const r = await manejar(peticion(manejar === POST ? 'POST' : 'GET', `Bearer ${SECRETO}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual(RESUMEN);
    }
    expect(ejecutarEntregas).toHaveBeenCalledTimes(2);
    expect(withMonitor).toHaveBeenCalledWith(
      'cron-webhooks',
      expect.any(Function),
      expect.objectContaining({ schedule: { type: 'crontab', value: '* * * * *' }, maxRuntime: 2 }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('una corrida con errores propios responde 200 y deja un aviso con conteos', async () => {
    ejecutarEntregas.mockResolvedValueOnce({ ...RESUMEN, errores: 2 });
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(
      'webhooks: corrida con errores',
      expect.objectContaining({ extra: { errores: 2, reclamadas: 3 } }),
    );
  });

  it('500 genérico si falla armar la corrida: sin detalle ni secretos', async () => {
    ejecutarEntregas.mockRejectedValueOnce(new Error(`Configuración incompleta ${SECRETO}`));
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).toBe(JSON.stringify({ error: 'webhooks_fallidos' }));
    expect(cuerpo).not.toContain(SECRETO);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
