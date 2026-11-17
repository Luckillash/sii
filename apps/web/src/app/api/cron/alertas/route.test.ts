import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenAlertas, ResumenCategoria } from '@/server/alertas';

// La ruta del cron de alertas: autorización (Bearer = CRON_SECRET), *cron monitor* y
// respuesta. El trabajo (`ejecutarAlertas`) se prueba en server/alertas; aquí es un doble.

const { ejecutarAlertas, withMonitor, captureException, captureMessage } = vi.hoisted(() => ({
  ejecutarAlertas: vi.fn(),
  withMonitor: vi.fn((_slug: string, trabajo: () => unknown) => trabajo()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/server/alertas', () => ({ ejecutarAlertas }));
vi.mock('@sentry/nextjs', () => ({ withMonitor, captureException, captureMessage }));

const { GET, POST, maxDuration, runtime, dynamic } = await import('./route');

const SECRETO = 'secreto-del-cron-de-prueba-123456';
const categoria = (c: Partial<ResumenCategoria> = {}): ResumenCategoria => ({
  detectados: 0,
  enviados: 0,
  yaAvisados: 0,
  fallidos: 0,
  sinDestinatarios: 0,
  postergados: 0,
  error: false,
  ...c,
});
const RESUMEN: ResumenAlertas = {
  correo: 'configurado',
  correosEnviados: 2,
  limiteAlcanzado: false,
  rechazos: categoria({ detectados: 3, enviados: 3 }),
  inciertos: categoria({ detectados: 1, yaAvisados: 1 }),
  certificados: categoria(),
};

function peticion(metodo: 'GET' | 'POST', autorizacion?: string) {
  return new Request('https://boleteame.dev/api/cron/alertas', {
    method: metodo,
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRETO);
  ejecutarAlertas.mockReset().mockResolvedValue(RESUMEN);
  withMonitor.mockClear();
  captureException.mockClear();
  captureMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/cron/alertas', () => {
  it('configuración de la ruta: Node.js, dinámica y maxDuration de 60 s (el timeout del job)', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(60);
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
    expect(ejecutarAlertas).not.toHaveBeenCalled();
    expect(withMonitor).not.toHaveBeenCalled();
  });

  it('503 si falta CRON_SECRET (nunca queda abierta)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'cron_sin_configurar' });
    expect(ejecutarAlertas).not.toHaveBeenCalled();
  });

  it('200 con el Bearer correcto (POST de pg_net y GET): el resumen, dentro del cron monitor cada 10 min', async () => {
    for (const manejar of [POST, GET]) {
      const r = await manejar(peticion(manejar === POST ? 'POST' : 'GET', `Bearer ${SECRETO}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual(RESUMEN);
    }
    expect(ejecutarAlertas).toHaveBeenCalledTimes(2);
    expect(withMonitor).toHaveBeenCalledWith(
      'cron-alertas',
      expect.any(Function),
      expect.objectContaining({ schedule: { type: 'crontab', value: '*/10 * * * *' } }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('una categoría con error responde 200 igual y deja un aviso en Sentry, sin datos', async () => {
    ejecutarAlertas.mockResolvedValueOnce({ ...RESUMEN, certificados: categoria({ error: true }) });
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(
      'alertas: corrida con errores',
      expect.objectContaining({ extra: { categorias: ['certificados'] } }),
    );
  });

  it('500 genérico si falla armar la corrida: sin detalle ni secretos en la respuesta', async () => {
    ejecutarAlertas.mockRejectedValueOnce(new Error(`Configuración incompleta ${SECRETO}`));
    const r = await POST(peticion('POST', `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).toBe(JSON.stringify({ error: 'alertas_fallidas' }));
    expect(cuerpo).not.toContain(SECRETO);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
