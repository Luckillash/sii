import { describe, expect, it, vi } from 'vitest';
import { claveIdempotenciaInvitacion, enlaceInvitacion, enviarInvitacion } from './invitacion';
import { type ConfiguracionCorreo, enviarCorreo, type MensajeCorreo } from './resend';

const CONFIG: ConfiguracionCorreo = {
  RESEND_API_KEY: 're_clave_de_prueba_123',
  CORREO_REMITENTE: 'Boletéame <no-responder@mail.boleteame.dev>',
};

const MENSAJE: MensajeCorreo = {
  para: 'pedro@andinos.cl',
  asunto: 'Asunto',
  html: '<p>Hola</p>',
  texto: 'Hola',
  claveIdempotencia: 'evento/123',
};

function respuestaJson(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('enviarCorreo', () => {
  it('sin configuración no llama a la red', async () => {
    const f = vi.fn<typeof fetch>();
    const r = await enviarCorreo(MENSAJE, { fetch: f, configuracion: null });
    expect(r).toMatchObject({ ok: false, motivo: 'sin_configuracion' });
    expect(f).not.toHaveBeenCalled();
  });

  it('envía con Authorization, Idempotency-Key y el cuerpo que espera Resend', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_1' }));
    const r = await enviarCorreo(MENSAJE, { fetch: f, configuracion: CONFIG });
    expect(r).toEqual({ ok: true, id: 'msg_1' });

    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    const cabeceras = init?.headers as Record<string, string>;
    expect(cabeceras.Authorization).toBe('Bearer re_clave_de_prueba_123');
    expect(cabeceras['Idempotency-Key']).toBe('evento/123');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Boletéame <no-responder@mail.boleteame.dev>',
      to: ['pedro@andinos.cl'],
      subject: 'Asunto',
      html: '<p>Hola</p>',
      text: 'Hola',
    });
  });

  it('un 4xx es «rechazado» con el mensaje de Resend y sin la API key', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        respuestaJson(403, { name: 'validation_error', message: 'Domain not verified' }),
      );
    const r = await enviarCorreo(MENSAJE, { fetch: f, configuracion: CONFIG });
    expect(r).toEqual({
      ok: false,
      motivo: 'rechazado',
      detalle: 'validation_error: Domain not verified',
      estado: 403,
    });
    expect(JSON.stringify(r)).not.toContain(CONFIG.RESEND_API_KEY);
  });

  it('429 es «limite» y 5xx es «red»', async () => {
    const limite = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(429, {}));
    expect(await enviarCorreo(MENSAJE, { fetch: limite, configuracion: CONFIG })).toMatchObject({
      ok: false,
      motivo: 'limite',
    });
    const caido = vi.fn<typeof fetch>().mockResolvedValue(new Response('oops', { status: 502 }));
    expect(await enviarCorreo(MENSAJE, { fetch: caido, configuracion: CONFIG })).toMatchObject({
      ok: false,
      motivo: 'red',
      detalle: 'HTTP 502',
    });
  });

  it('un error de red o tiempo agotado no lanza', async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await enviarCorreo(MENSAJE, { fetch: f, configuracion: CONFIG })).toMatchObject({
      ok: false,
      motivo: 'red',
    });
    const t = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await enviarCorreo(MENSAJE, { fetch: t, configuracion: CONFIG })).toMatchObject({
      ok: false,
      motivo: 'red',
      detalle: 'Resend no respondió a tiempo.',
    });
  });

  it('rechaza una clave de idempotencia vacía sin llamar a la red', async () => {
    const f = vi.fn<typeof fetch>();
    const r = await enviarCorreo(
      { ...MENSAJE, claveIdempotencia: ' ' },
      { fetch: f, configuracion: CONFIG },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('enviarInvitacion', () => {
  const TOKEN = 'b'.repeat(64);
  const DATOS = {
    token: TOKEN,
    urlApp: 'https://boleteame.dev/',
    correo: 'pedro@andinos.cl',
    organizacion: 'Servicios Andinos',
    rol: 'Emisor',
    invitadoPor: 'Camila Rojas',
    expiraEn: new Date('2026-11-19T03:00:00Z'),
  };

  it('arma el enlace sin doble barra', () => {
    expect(enlaceInvitacion('https://boleteame.dev/', TOKEN)).toBe(
      `https://boleteame.dev/invitacion/${TOKEN}`,
    );
  });

  it('la clave de idempotencia es el sha256 del token, no el token', () => {
    const clave = claveIdempotenciaInvitacion(TOKEN);
    expect(clave).toMatch(/^invitacion\/[0-9a-f]{64}$/);
    expect(clave).not.toContain(TOKEN);
  });

  it('sin Resend devuelve el enlace para copiarlo', async () => {
    const r = await enviarInvitacion(DATOS, { configuracion: null });
    expect(r.enlace).toBe(`https://boleteame.dev/invitacion/${TOKEN}`);
    expect(r.envio).toMatchObject({ ok: false, motivo: 'sin_configuracion' });
  });

  it('con Resend envía la plantilla de invitación al correo invitado', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_2' }));
    const r = await enviarInvitacion(DATOS, { fetch: f, configuracion: CONFIG });
    expect(r.envio).toEqual({ ok: true, id: 'msg_2' });
    const cuerpo = JSON.parse(String(f.mock.calls[0]?.[1]?.body));
    expect(cuerpo.to).toEqual(['pedro@andinos.cl']);
    expect(cuerpo.subject).toBe('Invitación a Servicios Andinos en Boletéame');
    expect(cuerpo.html).toContain(`/invitacion/${TOKEN}`);
  });
});
