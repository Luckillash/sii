import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTIVOS_TURNSTILE } from '@/server/turnstile';

// Server Action de /contacto con dobles: Turnstile (`verificarTurnstile`), Resend (el
// `fetch` global que usa `enviarCorreo`), Sentry y `headers()`. Sin red ni correos reales.

const { verificarTurnstile, captureMessage, captureException } = vi.hoisted(() => ({
  verificarTurnstile: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/server/turnstile', async (original) => ({
  ...(await original<typeof import('@/server/turnstile')>()),
  verificarTurnstile,
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }),
}));

const { enviarContacto } = await import('./acciones');

const fetchSimulado = vi.fn<typeof fetch>();

const EQUIPO = 'hola@boleteame.dev';
const REMITENTE = 'Boletéame <no-responder@mail.boleteame.dev>';

const PERSONA = {
  nombre: 'Camila Rojas',
  correo: 'camila@andinos.cl',
  empresa: 'Servicios Andinos SpA',
  rut: '76354771k',
  motivo: 'ventas',
  mensaje: 'Queremos cotizar el plan Empresa para 4 empresas. Track ID 34120364.',
};

/** Datos personales que nunca pueden aparecer en logs ni en Sentry. */
const PRIVADOS = [
  'Camila',
  'camila@andinos.cl',
  'Servicios Andinos',
  '76354771',
  '76.354.771',
  'cotizar el plan Empresa',
  '34120364',
];

function formulario(campos: Record<string, string> = {}, captcha = 'token-turnstile'): FormData {
  const datos = new FormData();
  for (const [clave, valor] of Object.entries({ ...PERSONA, captcha, sitio_web: '', ...campos })) {
    datos.set(clave, valor);
  }
  return datos;
}

function respuestaJson(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

function llamadaResend(indice: number) {
  const init = fetchSimulado.mock.calls[indice]?.[1];
  return {
    url: fetchSimulado.mock.calls[indice]?.[0],
    cabeceras: (init?.headers ?? {}) as Record<string, string>,
    cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

/** Todo lo que salió a la consola y a Sentry, en un solo texto. */
function registrado(): string {
  return JSON.stringify([
    captureMessage.mock.calls,
    captureException.mock.calls,
    vi.mocked(console.error).mock.calls,
    vi.mocked(console.warn).mock.calls,
    vi.mocked(console.log).mock.calls,
  ]);
}

function sinDatosPersonales(): void {
  const texto = registrado();
  for (const privado of PRIVADOS) expect(texto).not.toContain(privado);
}

beforeEach(() => {
  // Fuera de producción y sin clave de Turnstile, como en local (la verificación es un doble).
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://boleteame.dev');
  vi.stubEnv('RESEND_API_KEY', 're_clave_de_prueba_123');
  vi.stubEnv('CORREO_REMITENTE', REMITENTE);
  vi.stubEnv('CORREO_CONTACTO', EQUIPO);
  vi.stubGlobal('fetch', fetchSimulado);
  fetchSimulado
    .mockReset()
    .mockImplementation(async () => respuestaJson(200, { id: `msg_${Math.random()}` }));
  verificarTurnstile.mockReset().mockResolvedValue({ ok: true });
  captureMessage.mockReset();
  captureException.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validación', () => {
  it('formulario vacío: un error por campo obligatorio, sin Turnstile ni Resend', async () => {
    const r = await enviarContacto(null, new FormData());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.titulo).toBe('Revisa los datos del formulario');
    expect(Object.keys(r.errores ?? {}).sort()).toEqual(['correo', 'mensaje', 'motivo', 'nombre']);
    expect(r.errores?.correo).toBe('Escribe tu correo electrónico para que podamos responderte.');
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('correo mal escrito, motivo fuera de la lista y mensaje muy corto', async () => {
    const r = await enviarContacto(
      null,
      formulario({ correo: 'camila@', motivo: 'spam', mensaje: 'hola' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual({
      correo: 'Revisa el correo: debe tener la forma nombre@empresa.cl.',
      motivo: 'Elige el motivo de tu mensaje.',
      mensaje: 'Cuéntanos un poco más: el mensaje necesita al menos 10 caracteres.',
    });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('mensaje o nombre demasiado largos', async () => {
    const r = await enviarContacto(
      null,
      formulario({ nombre: 'x'.repeat(101), mensaje: 'x'.repeat(5001) }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores?.nombre).toContain('hasta 100 caracteres');
    expect(r.errores?.mensaje).toContain('hasta 5000 caracteres');
  });

  it('RUT con dígito verificador malo o con letras', async () => {
    const malo = await enviarContacto(null, formulario({ rut: '76.354.771-1' }));
    expect(malo.ok ? null : malo.errores?.rut).toBe(
      'El dígito verificador no corresponde a este RUT. Revisa que esté bien escrito.',
    );
    const letras = await enviarContacto(null, formulario({ rut: 'abc' }));
    expect(letras.ok ? null : letras.errores?.rut).toContain('escríbelo como 76.354.771-K');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('empresa y RUT son opcionales', async () => {
    const r = await enviarContacto(null, formulario({ empresa: '', rut: '' }));
    expect(r).toEqual({ ok: true });
    const { cuerpo } = llamadaResend(0);
    expect(cuerpo.text).not.toContain('Empresa:');
    expect(cuerpo.text).not.toContain('RUT de la empresa');
  });
});

describe('campo trampa', () => {
  it('lleno: responde éxito sin verificar Turnstile, sin enviar y sin registrar nada', async () => {
    const r = await enviarContacto(null, formulario({ sitio_web: 'https://spam.example' }));
    expect(r).toEqual({ ok: true });
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(fetchSimulado).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('lleno aunque el resto venga vacío: igual éxito silencioso', async () => {
    const datos = new FormData();
    datos.set('sitio_web', 'x');
    expect(await enviarContacto(null, datos)).toEqual({ ok: true });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });
});

describe('Turnstile', () => {
  it('se verifica en el servidor con el token, la IP y la action (sin hostname fuera de producción)', async () => {
    await enviarContacto(null, formulario());
    expect(verificarTurnstile).toHaveBeenCalledWith('token-turnstile', '200.1.2.3', {
      accion: 'contacto',
    });
  });

  it('en producción exige además el hostname del sitio', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secreto-de-prueba-0000');
    const r = await enviarContacto(null, formulario());
    expect(r).toEqual({ ok: true });
    expect(verificarTurnstile).toHaveBeenCalledWith('token-turnstile', '200.1.2.3', {
      accion: 'contacto',
      hostname: 'boleteame.dev',
    });
  });

  it('sin clave en producción falla cerrado: «no disponible», aviso a Sentry y nada a Resend', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const r = await enviarContacto(null, formulario());
    expect(r).toEqual({
      ok: false,
      error: { titulo: 'No pudimos enviar tu mensaje', detalle: MOTIVOS_TURNSTILE.noDisponible },
    });
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(fetchSimulado).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith(
      'contacto: Turnstile sin configurar en producción',
      expect.objectContaining({
        level: 'error',
        tags: { formulario: 'contacto' },
        extra: { faltan: ['TURNSTILE_SECRET_KEY'] },
      }),
    );
    sinDatosPersonales();
  });

  it('sin clave fuera de producción sigue abierto (local y desarrollo)', async () => {
    for (const ambiente of ['', 'preview', 'development']) {
      vi.stubEnv('VERCEL_ENV', ambiente);
      expect(await enviarContacto(null, formulario())).toEqual({ ok: true });
    }
    expect(verificarTurnstile).toHaveBeenCalledTimes(3);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('si falla no se envía nada y se muestra el motivo', async () => {
    verificarTurnstile.mockResolvedValue({ ok: false, motivo: MOTIVOS_TURNSTILE.vencido });
    const r = await enviarContacto(null, formulario());
    expect(r).toEqual({
      ok: false,
      error: { titulo: 'Falta la verificación de seguridad', detalle: MOTIVOS_TURNSTILE.vencido },
    });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('sin token llega `null` a la verificación', async () => {
    const datos = formulario();
    datos.delete('captcha');
    verificarTurnstile.mockResolvedValue({ ok: false, motivo: MOTIVOS_TURNSTILE.falta });
    const r = await enviarContacto(null, datos);
    expect(verificarTurnstile).toHaveBeenCalledWith(null, '200.1.2.3', { accion: 'contacto' });
    expect(r.ok).toBe(false);
  });
});

describe('sin configuración', () => {
  it.each([
    ['CORREO_CONTACTO', 'CORREO_CONTACTO'],
    ['RESEND_API_KEY', 'RESEND_API_KEY o CORREO_REMITENTE'],
    ['CORREO_REMITENTE', 'RESEND_API_KEY o CORREO_REMITENTE'],
  ])('sin %s: error claro, aviso a Sentry y nada a Resend', async (variable, faltan) => {
    vi.stubEnv(variable, '');
    const r = await enviarContacto(null, formulario());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.titulo).toBe('No pudimos enviar tu mensaje');
    expect(r.error.detalle).toContain('Escríbenos más tarde');
    expect(fetchSimulado).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith(
      'contacto: formulario sin configuración',
      expect.objectContaining({
        level: 'error',
        tags: { formulario: 'contacto' },
        extra: { faltan: [faltan] },
      }),
    );
    sinDatosPersonales();
  });

  it('CORREO_CONTACTO que no es un correo cuenta como falta', async () => {
    vi.stubEnv('CORREO_CONTACTO', 'no-es-un-correo');
    const r = await enviarContacto(null, formulario());
    expect(r.ok).toBe(false);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });
});

describe('envío', () => {
  it('manda un solo correo, al equipo, con reply_to de la persona y el asunto del motivo', async () => {
    const r = await enviarContacto(null, formulario());
    expect(r).toEqual({ ok: true });
    // Sin acuse a la persona: el único correo va a CORREO_CONTACTO.
    expect(fetchSimulado).toHaveBeenCalledTimes(1);

    const principal = llamadaResend(0);
    expect(principal.url).toBe('https://api.resend.com/emails');
    expect(principal.cuerpo).toMatchObject({
      from: REMITENTE,
      to: [EQUIPO],
      reply_to: 'camila@andinos.cl',
      subject: '[Contacto · Ventas] Camila Rojas',
    });
    expect(principal.cuerpo.text).toContain('Motivo: Ventas / plan Empresa');
    expect(principal.cuerpo.text).toContain('RUT de la empresa: 76.354.771-K');
    expect(principal.cuerpo.text).toContain(PERSONA.mensaje);
    expect(principal.cabeceras['Idempotency-Key']).toMatch(/^contacto\/[0-9a-f]{64}$/);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('el mismo contenido dos veces lleva la misma Idempotency-Key (doble clic)', async () => {
    await enviarContacto(null, formulario({}, 'token-1'));
    await enviarContacto(null, formulario({}, 'token-2'));
    const primera = llamadaResend(0).cabeceras['Idempotency-Key'];
    const segunda = llamadaResend(1).cabeceras['Idempotency-Key'];
    expect(primera).toBe(segunda);
    // Otro mensaje, otra clave.
    await enviarContacto(null, formulario({ mensaje: 'Otra consulta distinta, por favor.' }));
    expect(llamadaResend(2).cabeceras['Idempotency-Key']).not.toBe(primera);
    // La clave no contiene datos en claro.
    expect(primera).not.toContain('camila');
  });

  it('el correo se normaliza una vez: el mismo valor va en reply_to y en la clave', async () => {
    await enviarContacto(null, formulario());
    await enviarContacto(null, formulario({ correo: '  Camila@Andinos.CL ' }));
    const normal = llamadaResend(0);
    const mayusculas = llamadaResend(1);
    expect(mayusculas.cuerpo.reply_to).toBe('camila@andinos.cl');
    expect(String(mayusculas.cuerpo.text)).toContain('Correo: camila@andinos.cl');
    expect(mayusculas.cabeceras['Idempotency-Key']).toBe(normal.cabeceras['Idempotency-Key']);
  });

  it('el destinatario entra en la clave: otro CORREO_CONTACTO, otra Idempotency-Key', async () => {
    await enviarContacto(null, formulario());
    vi.stubEnv('CORREO_CONTACTO', 'ventas@boleteame.dev');
    await enviarContacto(null, formulario());
    expect(llamadaResend(1).cuerpo.to).toEqual(['ventas@boleteame.dev']);
    expect(llamadaResend(1).cabeceras['Idempotency-Key']).not.toBe(
      llamadaResend(0).cabeceras['Idempotency-Key'],
    );
  });

  it('el motivo de ?motivo= de la lista llega con su etiqueta', async () => {
    await enviarContacto(null, formulario({ motivo: 'privacidad' }));
    expect(llamadaResend(0).cuerpo.subject).toBe('[Contacto · Privacidad] Camila Rojas');
    expect(llamadaResend(0).cuerpo.text).toContain('Motivo: Privacidad y datos personales');
  });
});

describe('fallas de Resend', () => {
  it('rechazo (4xx): error para la persona y aviso a Sentry sin datos', async () => {
    fetchSimulado.mockResolvedValueOnce(
      respuestaJson(422, {
        name: 'validation_error',
        message: 'Invalid `reply_to` field: camila@andinos.cl',
      }),
    );
    const r = await enviarContacto(null, formulario());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.titulo).toBe('No pudimos enviar tu mensaje');
    expect(r.error.detalle).toContain('vuelve a intentarlo');
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      'contacto: no se pudo enviar el mensaje',
      expect.objectContaining({
        level: 'error',
        tags: { formulario: 'contacto', motivo_falla: 'rechazado' },
        extra: { motivo: 'rechazado', estado: 422 },
      }),
    );
    sinDatosPersonales();
  });

  it('caída de red o 5xx: mismo error, motivo «red»', async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError('fetch failed'));
    const r = await enviarContacto(null, formulario());
    expect(r.ok).toBe(false);
    expect(captureMessage).toHaveBeenCalledWith(
      'contacto: no se pudo enviar el mensaje',
      expect.objectContaining({ tags: { formulario: 'contacto', motivo_falla: 'red' } }),
    );
    sinDatosPersonales();
  });
});
