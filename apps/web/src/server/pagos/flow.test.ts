import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConfiguracionFlow } from '../env';
import { firmarFlow, llamarFlow } from './flow';

// Cliente firmado de Flow sin red: `fetch` falso y configuración inyectada.

const CONFIG: ConfiguracionFlow = {
  FLOW_API_KEY: 'CLAVE-API-DE-PRUEBA-1234',
  FLOW_SECRET_KEY: 'secreto-de-prueba-abcdef-0123',
  FLOW_API_URL: 'https://sandbox.flow.cl/api',
};

function hmac(texto: string, secreto: string): string {
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

function respuestaJson(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('firmarFlow', () => {
  it('el ejemplo de la documentación de Flow: orden por nombre y «nombrevalor»', () => {
    const parametros = { apiKey: 'XXXX-XXXX-XXXX', currency: 'CLP', amount: '5000' };
    const esperado = hmac('amount5000apiKeyXXXX-XXXX-XXXXcurrencyCLP', 'llave-secreta');
    expect(firmarFlow(parametros, 'llave-secreta')).toBe(esperado);
    // El orden de inserción no importa.
    expect(
      firmarFlow({ currency: 'CLP', amount: '5000', apiKey: 'XXXX-XXXX-XXXX' }, 'llave-secreta'),
    ).toBe(esperado);
  });

  it('ordena por bytes (como sort() de PHP): las mayúsculas antes que las minúsculas', () => {
    const firma = firmarFlow({ urlCallback: 'b', urlCallBack: 'a', Zeta: 'z' }, 's');
    // 'Z' (0x5A) < 'u'; 'urlCallB' (0x42) < 'urlCallb' (0x62).
    expect(firma).toBe(hmac('ZetazurlCallBackaurlCallbackb', 's'));
    expect(firma).not.toBe(hmac('urlCallbackburlCallBackaZetaz', 's'));
  });

  it('firma en hexadecimal de 64 caracteres', () => {
    expect(firmarFlow({ a: '1' }, 's')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('llamarFlow', () => {
  it('sin configuración: sin_configuracion, sin llamar a fetch', async () => {
    const f = vi.fn<typeof fetch>();
    const r = await llamarFlow(
      'GET',
      'plans/get',
      { planId: 'x' },
      { fetch: f, configuracion: null },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'sin_configuracion' });
    expect(f).not.toHaveBeenCalled();
  });

  it('GET: parámetros, apiKey y s en la query; sin cuerpo; omite undefined y null', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { planId: 'p' }));
    const r = await llamarFlow(
      'GET',
      'plans/get',
      { planId: 'boleteame-emprende', vacio: undefined, nulo: null, numero: 7 },
      { fetch: f, configuracion: CONFIG },
    );
    expect(r).toEqual({ ok: true, datos: { planId: 'p' } });

    const [url, init] = f.mock.calls[0] ?? [];
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe('https://sandbox.flow.cl/api/plans/get');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
    const q = Object.fromEntries(u.searchParams);
    expect(Object.keys(q).sort()).toEqual(['apiKey', 'numero', 'planId', 's']);
    expect(q.apiKey).toBe(CONFIG.FLOW_API_KEY);
    expect(q.numero).toBe('7');
    expect(q.s).toBe(
      hmac(`apiKey${CONFIG.FLOW_API_KEY}numero7planIdboleteame-emprende`, CONFIG.FLOW_SECRET_KEY),
    );
  });

  it('POST: application/x-www-form-urlencoded con s, a la URL sin query', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { customerId: 'cus_1' }));
    await llamarFlow(
      'POST',
      'customer/create',
      { name: 'Café & Té', email: 'a+b@c.cl', externalId: 'org-1' },
      { fetch: f, configuracion: CONFIG },
    );
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://sandbox.flow.cl/api/customer/create');
    expect(init?.method).toBe('POST');
    expect((init?.headers ?? {}) as Record<string, string>).toHaveProperty(
      'Content-Type',
      'application/x-www-form-urlencoded',
    );
    const cuerpo = Object.fromEntries(new URLSearchParams(String(init?.body)));
    expect(cuerpo.name).toBe('Café & Té');
    expect(cuerpo.email).toBe('a+b@c.cl');
    const { s, ...resto } = cuerpo;
    // La firma usa los valores crudos (sin codificar), no el cuerpo URL-encoded.
    expect(s).toBe(firmarFlow(resto, CONFIG.FLOW_SECRET_KEY));
    expect(s).toBe(
      hmac(
        `apiKey${CONFIG.FLOW_API_KEY}emaila+b@c.clexternalIdorg-1nameCafé & Té`,
        CONFIG.FLOW_SECRET_KEY,
      ),
    );
  });

  it.each([400, 401])('%i: rechazado con el código y el mensaje de Flow', async (estado) => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respuestaJson(estado, { code: 105, message: 'No services available' }));
    const r = await llamarFlow(
      'POST',
      'plans/create',
      { planId: 'x' },
      { fetch: f, configuracion: CONFIG },
    );
    expect(r).toEqual({
      ok: false,
      motivo: 'rechazado',
      codigo: 105,
      detalle: 'plans/create: No services available',
      estado,
    });
  });

  it('código como texto se convierte; mensaje largo se acota', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respuestaJson(400, { code: '501', message: 'x'.repeat(1000) }));
    const r = await llamarFlow('GET', 'plans/get', {}, { fetch: f, configuracion: CONFIG });
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado', codigo: 501 });
    if (r.ok) return;
    expect(r.detalle.length).toBeLessThanOrEqual('plans/get: '.length + 200);
  });

  it('500, cuerpo no JSON y 200 sin objeto: red, con el estado HTTP', async () => {
    const caido = vi.fn<typeof fetch>().mockResolvedValue(new Response('oops', { status: 500 }));
    expect(
      await llamarFlow('GET', 'plans/get', {}, { fetch: caido, configuracion: CONFIG }),
    ).toEqual({ ok: false, motivo: 'red', detalle: 'plans/get: HTTP 500', estado: 500 });
    const raro = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
    expect(
      await llamarFlow('GET', 'plans/get', {}, { fetch: raro, configuracion: CONFIG }),
    ).toMatchObject({ ok: false, motivo: 'red', estado: 200 });
  });

  it('tiempo agotado y falla de red: red, sin lanzar', async () => {
    const lento = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(
      await llamarFlow('GET', 'plans/get', {}, { fetch: lento, configuracion: CONFIG }),
    ).toEqual({
      ok: false,
      motivo: 'red',
      detalle: 'Flow no respondió a tiempo (plans/get).',
    });
    const sinRed = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(
      await llamarFlow('GET', 'plans/get', {}, { fetch: sinRed, configuracion: CONFIG }),
    ).toEqual({
      ok: false,
      motivo: 'red',
      detalle: 'No se pudo conectar con Flow (plans/get).',
    });
  });

  it('pasa una señal de corte y no usa caché', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, {}));
    await llamarFlow('GET', 'plans/get', {}, { fetch: f, configuracion: CONFIG });
    const init = f.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.cache).toBe('no-store');
  });

  it('el detalle de un error nunca trae la apiKey, la llave secreta, la firma ni los parámetros', async () => {
    const parametros = { email: 'persona@empresa.cl', token: 'tok_secreto_123' };
    const firma = firmarFlow(
      { ...parametros, apiKey: CONFIG.FLOW_API_KEY },
      CONFIG.FLOW_SECRET_KEY,
    );
    const respuestas: (() => Promise<Response>)[] = [
      async () => respuestaJson(400, { code: 108, message: 'Invalid signature' }),
      async () => respuestaJson(401, { code: 1, message: 'apiKey not found' }),
      async () => new Response('Internal', { status: 503 }),
      async () => {
        throw new TypeError(`fetch failed ${CONFIG.FLOW_API_KEY}`);
      },
    ];
    for (const responder of respuestas) {
      const f = vi.fn<typeof fetch>().mockImplementation(responder);
      const r = await llamarFlow('POST', 'customer/create', parametros, {
        fetch: f,
        configuracion: CONFIG,
      });
      expect(r.ok).toBe(false);
      const texto = JSON.stringify(r);
      for (const secreto of [
        CONFIG.FLOW_API_KEY,
        CONFIG.FLOW_SECRET_KEY,
        firma,
        parametros.email,
        parametros.token,
      ]) {
        expect(texto).not.toContain(secreto);
      }
    }
  });
});
