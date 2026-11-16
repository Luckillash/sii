import { describe, expect, it, vi } from 'vitest';
import { type DatosCorreoBoleta, enviarBoletaPorCorreo, nombreAdjuntoBoleta } from './boleta';
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

  it('sin adjuntos no manda `attachments` (los que ya lo usan no cambian)', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_1' }));
    await enviarCorreo({ ...MENSAJE, adjuntos: [] }, { fetch: f, configuracion: CONFIG });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).not.toHaveProperty('attachments');
  });

  it('manda los adjuntos en base64 con su nombre y tipo', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_3' }));
    const pdf = Buffer.from('%PDF-1.3 contenido de prueba');
    const r = await enviarCorreo(
      {
        ...MENSAJE,
        adjuntos: [
          { nombre: 'boleta-39-F41.pdf', contenido: pdf, tipo: 'application/pdf' },
          { nombre: 'nota.txt', contenido: Buffer.from('hola') },
        ],
      },
      { fetch: f, configuracion: CONFIG },
    );
    expect(r).toEqual({ ok: true, id: 'msg_3' });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).attachments).toEqual([
      {
        filename: 'boleta-39-F41.pdf',
        content: pdf.toString('base64'),
        content_type: 'application/pdf',
      },
      { filename: 'nota.txt', content: Buffer.from('hola').toString('base64') },
    ]);
  });

  it('un adjunto inválido se rechaza sin red y sin su contenido en el detalle', async () => {
    const f = vi.fn<typeof fetch>();
    const secreto = Buffer.from('CONTENIDO-PRIVADO-DEL-PDF');
    for (const adjunto of [
      { nombre: '../boleta.pdf', contenido: secreto },
      { nombre: '', contenido: secreto },
      { nombre: 'vacio.pdf', contenido: Buffer.alloc(0) },
    ]) {
      const r = await enviarCorreo(
        { ...MENSAJE, adjuntos: [adjunto] },
        { fetch: f, configuracion: CONFIG },
      );
      expect(r).toMatchObject({ ok: false, motivo: 'rechazado' });
      expect(JSON.stringify(r)).not.toContain('CONTENIDO-PRIVADO');
      expect(JSON.stringify(r)).not.toContain(secreto.toString('base64'));
    }
    const grande = await enviarCorreo(
      {
        ...MENSAJE,
        adjuntos: [{ nombre: 'grande.pdf', contenido: Buffer.alloc(31 * 1024 * 1024, 1) }],
      },
      { fetch: f, configuracion: CONFIG },
    );
    expect(grande).toMatchObject({
      ok: false,
      motivo: 'rechazado',
      detalle: expect.stringContaining('40 MB'),
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('un error de Resend con adjuntos no trae el contenido en el detalle', async () => {
    const pdf = Buffer.from('%PDF-1.3 CONTENIDO-PRIVADO');
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        respuestaJson(422, { name: 'validation_error', message: 'Invalid attachment' }),
      );
    const r = await enviarCorreo(
      { ...MENSAJE, adjuntos: [{ nombre: 'boleta-39-F41.pdf', contenido: pdf }] },
      { fetch: f, configuracion: CONFIG },
    );
    expect(r).toEqual({
      ok: false,
      motivo: 'rechazado',
      detalle: 'validation_error: Invalid attachment',
      estado: 422,
    });
    expect(JSON.stringify(r)).not.toContain(pdf.toString('base64'));
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

describe('enviarBoletaPorCorreo', () => {
  const PDF = Buffer.from('%PDF-1.3 boleta de prueba');
  const DATOS: DatosCorreoBoleta = {
    para: 'cliente@correo.cl',
    emisor: { rut: '76354771-K', razonSocial: 'Comercial Ñuñoa SpA' },
    tipoDte: 39,
    folio: 41,
    fechaEmision: '2026-11-13',
    total: 14865,
    pdf: PDF,
    claveIdempotencia: 'boleta/9a1c',
  };

  it('nombre del adjunto: boleta-<tipo>-F<folio>.pdf', () => {
    expect(nombreAdjuntoBoleta(39, 41)).toBe('boleta-39-F41.pdf');
    expect(nombreAdjuntoBoleta(41, 1200)).toBe('boleta-41-F1200.pdf');
  });

  it('envía la plantilla con el PDF adjunto y la clave de idempotencia del documento', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_4' }));
    const r = await enviarBoletaPorCorreo(DATOS, { fetch: f, configuracion: CONFIG });
    expect(r).toEqual({ ok: true, id: 'msg_4' });
    const init = f.mock.calls[0]?.[1];
    const cabeceras = (init?.headers ?? {}) as Record<string, string>;
    expect(cabeceras['Idempotency-Key']).toBe('boleta/9a1c');
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo.to).toEqual(['cliente@correo.cl']);
    expect(cuerpo.subject).toBe('Tu boleta electrónica N.º 41 de Comercial Ñuñoa SpA');
    expect(cuerpo.text).toContain(
      'Comercial Ñuñoa SpA (RUT 76.354.771-K) te envía tu boleta electrónica N.º 41 por $ 14.865, emitida el 13-11-2026.',
    );
    expect(cuerpo.attachments).toEqual([
      {
        filename: 'boleta-39-F41.pdf',
        content: PDF.toString('base64'),
        content_type: 'application/pdf',
      },
    ]);
  });

  it('boleta exenta: nombre oficial en el asunto y en el adjunto', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respuestaJson(200, { id: 'msg_5' }));
    await enviarBoletaPorCorreo(
      { ...DATOS, tipoDte: 41, folio: 7 },
      { fetch: f, configuracion: CONFIG },
    );
    const cuerpo = JSON.parse(String(f.mock.calls[0]?.[1]?.body));
    expect(cuerpo.subject).toBe('Tu boleta exenta electrónica N.º 7 de Comercial Ñuñoa SpA');
    expect(cuerpo.attachments[0].filename).toBe('boleta-41-F7.pdf');
  });

  it('nunca lanza: sin Resend, correo inválido, sin PDF o error de red', async () => {
    const f = vi.fn<typeof fetch>();
    expect(await enviarBoletaPorCorreo(DATOS, { fetch: f, configuracion: null })).toMatchObject({
      ok: false,
      motivo: 'sin_configuracion',
    });
    for (const para of ['', 'sin-arroba', 'a b@c.cl']) {
      expect(
        await enviarBoletaPorCorreo({ ...DATOS, para }, { fetch: f, configuracion: CONFIG }),
      ).toMatchObject({ ok: false, motivo: 'rechazado' });
    }
    expect(
      await enviarBoletaPorCorreo(
        { ...DATOS, pdf: Buffer.alloc(0) },
        { fetch: f, configuracion: CONFIG },
      ),
    ).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(f).not.toHaveBeenCalled();

    const caido = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const r = await enviarBoletaPorCorreo(DATOS, { fetch: caido, configuracion: CONFIG });
    expect(r).toMatchObject({ ok: false, motivo: 'red' });
    expect(JSON.stringify(r)).not.toContain(PDF.toString('base64'));
  });
});
