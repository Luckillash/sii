import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipCliente, MOTIVOS_TURNSTILE, verificarTurnstile } from './turnstile';

const SECRETO = 'secreto-de-prueba-0000';

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('verificarTurnstile', () => {
  const fetchSimulado = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSimulado);
    vi.stubEnv('TURNSTILE_SECRET_KEY', SECRETO);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSimulado.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sin clave secreta está desactivado: ok sin llamar a Cloudflare', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(await verificarTurnstile(null)).toEqual({ ok: true });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('sin token rechaza sin llamar a Cloudflare', async () => {
    for (const token of [null, undefined, '', '   ']) {
      expect(await verificarTurnstile(token)).toEqual({
        ok: false,
        motivo: MOTIVOS_TURNSTILE.falta,
      });
    }
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('rechaza un token de más de 2048 caracteres', async () => {
    const r = await verificarTurnstile('x'.repeat(2049));
    expect(r).toEqual({ ok: false, motivo: MOTIVOS_TURNSTILE.invalido });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('acepta cuando siteverify responde success y envía secreto, token e IP', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ success: true }));
    expect(await verificarTurnstile('tok', '200.1.2.3')).toEqual({ ok: true });

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSimulado.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const cuerpo = init?.body as URLSearchParams;
    expect(cuerpo.get('secret')).toBe(SECRETO);
    expect(cuerpo.get('response')).toBe('tok');
    expect(cuerpo.get('remoteip')).toBe('200.1.2.3');
  });

  it('no manda remoteip si no hay IP', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ success: true }));
    await verificarTurnstile('tok', null);
    const cuerpo = fetchSimulado.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(cuerpo.has('remoteip')).toBe(false);
  });

  it('token vencido o repetido', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.vencido,
    });
  });

  it('token inválido', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.invalido,
    });
  });

  it('clave secreta mal configurada: no disponible, y lo registra sin el secreto', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ success: false, 'error-codes': ['invalid-input-secret'] }),
    );
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.noDisponible,
    });
    const registrado = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(registrado).not.toContain(SECRETO);
  });

  it('red caída o timeout: sin conexión, sin lanzar', async () => {
    fetchSimulado.mockRejectedValue(new DOMException('tiempo agotado', 'TimeoutError'));
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.sinConexion,
    });
  });

  it('respuesta HTTP de error o cuerpo no JSON: sin conexión', async () => {
    fetchSimulado.mockResolvedValueOnce(new Response('caído', { status: 503 }));
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.sinConexion,
    });
    fetchSimulado.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await verificarTurnstile('tok')).toEqual({
      ok: false,
      motivo: MOTIVOS_TURNSTILE.sinConexion,
    });
  });
});

describe('ipCliente', () => {
  it('toma el primer valor de x-forwarded-for', () => {
    expect(ipCliente(new Headers({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }))).toBe('200.1.2.3');
  });

  it('usa x-real-ip si no hay x-forwarded-for, y null si no hay nada', () => {
    expect(ipCliente(new Headers({ 'x-real-ip': '200.9.9.9' }))).toBe('200.9.9.9');
    expect(ipCliente(new Headers())).toBeNull();
  });
});
