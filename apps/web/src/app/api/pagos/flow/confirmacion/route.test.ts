import { beforeEach, describe, expect, it, vi } from 'vitest';

// Callback de pagos de los planes de Flow: 200 con token válido pase lo que pase (Flow
// solo alerta, no reintenta el estado), 400 sin token, 503 sin Flow.

const { procesarAvisoPago, dependenciasPagos, captureException, captureMessage } = vi.hoisted(
  () => ({
    procesarAvisoPago: vi.fn(),
    dependenciasPagos: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  }),
);

vi.mock('@/server/pagos', () => ({ procesarAvisoPago, dependenciasPagos }));
vi.mock('@sentry/nextjs', () => ({ captureException, captureMessage }));

const { POST, runtime, maxDuration } = await import('./route');

const DEPS = { marca: 'deps' };

function post(cuerpo: string) {
  return new Request('https://app.boleteame.dev/api/pagos/flow/confirmacion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo,
  });
}

beforeEach(() => {
  dependenciasPagos.mockReset().mockReturnValue(DEPS);
  procesarAvisoPago.mockReset().mockResolvedValue({ estado: 'procesado', sincronizadas: [] });
  captureException.mockClear();
  captureMessage.mockClear();
});

describe('/api/pagos/flow/confirmacion', () => {
  it('Node.js y maxDuration de 15 s (lo que espera Flow)', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(15);
  });

  it('200 con token válido; solo { ok }', async () => {
    const r = await POST(post('token=tok-pago'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true });
    expect(procesarAvisoPago).toHaveBeenCalledWith(DEPS, 'tok-pago');
  });

  it('200 aunque el proceso falle (fallido o excepción), con aviso a Sentry', async () => {
    procesarAvisoPago.mockResolvedValueOnce({ estado: 'fallido', sincronizadas: [] });
    expect((await POST(post('token=a'))).status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(
      'pagos: aviso de pago no procesado',
      expect.objectContaining({ level: 'warning' }),
    );

    procesarAvisoPago.mockRejectedValueOnce(new Error('base caída'));
    const r = await POST(post('token=b'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('400 sin token o con token inválido', async () => {
    for (const cuerpo of ['', 'token=', 'token=%3Cx%3E']) {
      const r = await POST(post(cuerpo));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ ok: false });
    }
    expect(procesarAvisoPago).not.toHaveBeenCalled();
  });

  it('503 sin Flow configurado', async () => {
    dependenciasPagos.mockReturnValue(null);
    const r = await POST(post('token=tok'));
    expect(r.status).toBe(503);
    expect(procesarAvisoPago).not.toHaveBeenCalled();
  });
});
