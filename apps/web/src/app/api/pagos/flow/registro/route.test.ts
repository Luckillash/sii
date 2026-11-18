import { beforeEach, describe, expect, it, vi } from 'vitest';

// Retorno del registro de tarjeta: lectura del token, redirección 303 y Sentry. El
// dominio (`activarDespuesDeRegistro`) se prueba en server/pagos; aquí es un doble.

const { activarDespuesDeRegistro, dependenciasPagos, captureException, captureMessage } =
  vi.hoisted(() => ({
    activarDespuesDeRegistro: vi.fn(),
    dependenciasPagos: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  }));

vi.mock('@/server/pagos', () => ({ activarDespuesDeRegistro, dependenciasPagos }));
vi.mock('@sentry/nextjs', () => ({ captureException, captureMessage }));

const { GET, POST, runtime, dynamic } = await import('./route');

const URL_RUTA = 'https://app.boleteame.dev/api/pagos/flow/registro';
const DEPS = { marca: 'deps' };

function post(token?: string) {
  return new Request(URL_RUTA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: token === undefined ? '' : `token=${token}`,
  });
}

beforeEach(() => {
  dependenciasPagos.mockReset().mockReturnValue(DEPS);
  activarDespuesDeRegistro.mockReset();
  captureException.mockClear();
  captureMessage.mockClear();
});

describe('/api/pagos/flow/registro', () => {
  it('Node.js y dinámica', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('303 a la página de plan con el resultado', async () => {
    activarDespuesDeRegistro.mockResolvedValue({ slug: 'andinos', resultado: 'suscrita' });
    const r = await POST(post('tok-1'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(
      'https://app.boleteame.dev/andinos/configuracion/plan?pago=suscrita',
    );
    expect(activarDespuesDeRegistro).toHaveBeenCalledWith(DEPS, 'tok-1', expect.any(Function));
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('GET con el token en la query también', async () => {
    activarDespuesDeRegistro.mockResolvedValue({ slug: 'andinos', resultado: 'tarjeta_rechazada' });
    const r = await GET(new Request(`${URL_RUTA}?token=tok-2`));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(
      /\/andinos\/configuracion\/plan\?pago=tarjeta_rechazada$/,
    );
  });

  it('sin slug: a /bienvenida; resultado error deja un aviso en Sentry', async () => {
    activarDespuesDeRegistro.mockResolvedValue({ slug: null, resultado: 'error' });
    const r = await POST(post('tok-3'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('https://app.boleteame.dev/bienvenida');
    expect(captureMessage).toHaveBeenCalledWith(
      'pagos: retorno de registro con error',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('sin token o token inválido: a /bienvenida sin consultar nada', async () => {
    for (const peticion of [post(), post('a%20b')]) {
      const r = await POST(peticion);
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('https://app.boleteame.dev/bienvenida');
    }
    expect(activarDespuesDeRegistro).not.toHaveBeenCalled();
  });

  it('el alertar del dominio va a Sentry como error', async () => {
    activarDespuesDeRegistro.mockImplementation(async (_d, _t, alertar) => {
      alertar('pagos: algo', { organizacion: 'org-1' });
      return { slug: 'andinos', resultado: 'error' };
    });
    await POST(post('tok-4'));
    expect(captureMessage).toHaveBeenCalledWith(
      'pagos: algo',
      expect.objectContaining({ level: 'error', extra: { organizacion: 'org-1' } }),
    );
  });

  it('si el dominio lanza: Sentry y /bienvenida', async () => {
    activarDespuesDeRegistro.mockRejectedValue(new Error('eventos_pasarela: caída'));
    const r = await POST(post('tok-5'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('https://app.boleteame.dev/bienvenida');
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('sin Flow configurado: 503', async () => {
    dependenciasPagos.mockReturnValue(null);
    const r = await POST(post('tok-6'));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'pasarela_sin_configurar' });
  });

  it('el slug va codificado en la URL', async () => {
    activarDespuesDeRegistro.mockResolvedValue({ slug: 'a/b', resultado: 'suscrita' });
    const r = await POST(post('tok-7'));
    expect(r.headers.get('location')).toBe(
      'https://app.boleteame.dev/a%2Fb/configuracion/plan?pago=suscrita',
    );
  });
});
