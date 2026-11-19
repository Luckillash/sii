import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server Actions de Configuración → Webhooks sin red ni base: la sesión y el cliente de
// Supabase con sesión son dobles que registran lo que reciben.

type Resultado = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number;
};

interface Llamada {
  tabla?: string;
  rpc?: string;
  args?: unknown;
  cadena: [string, ...unknown[]][];
}

function consulta(llamada: Llamada, resultado: Resultado) {
  const q: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(q, {
    get(_, prop: string) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null, ...resultado }).then(ok, ko);
      }
      return (...args: unknown[]) => {
        llamada.cadena.push([prop, ...args]);
        return proxy;
      };
    },
  });
  return proxy;
}

const estado = vi.hoisted(() => ({
  rol: 'administrador' as string,
  sesionValida: true,
  llamadas: [] as Llamada[],
  respuestas: new Map<string, Resultado>(),
  logs: [] as unknown[][],
}));

function cliente() {
  return {
    from(tabla: string) {
      const llamada: Llamada = { tabla, cadena: [] };
      estado.llamadas.push(llamada);
      return consulta(llamada, estado.respuestas.get(`from:${tabla}`) ?? {});
    },
    async rpc(nombre: string, args: unknown) {
      estado.llamadas.push({ rpc: nombre, args, cadena: [] });
      return { data: null, error: null, ...(estado.respuestas.get(`rpc:${nombre}`) ?? {}) };
    },
  };
}

vi.mock('@/server/sesion', () => ({
  exigirMembresia: async (slug: string) => ({
    usuario: { id: 'usuario-1', correo: 'admin@example.com' },
    organizacion: { id: 'org-de-la-membresia', slug, nombre: 'Org de prueba' },
    rol: estado.rol,
  }),
}));
vi.mock('@/server/certificados/acceso', () => ({
  confirmarSesion: async () => estado.sesionValida,
}));
vi.mock('@/server/supabase/servidor', () => ({ clienteServidor: async () => cliente() }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const {
  actualizarWebhook,
  borrarWebhook,
  cambiarEstadoWebhook,
  crearWebhook,
  probarWebhook,
  reenviarEntrega,
  rotarSecretoWebhook,
} = await import('./acciones');

const ID = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const SECRETO = `whsec_${'b2'.repeat(32)}`;
const URL_OK = 'https://erp.tienda.cl/webhooks/boleteame';

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

beforeEach(() => {
  estado.rol = 'administrador';
  estado.sesionValida = true;
  estado.llamadas = [];
  estado.respuestas = new Map();
  estado.logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    estado.logs.push(a);
  });
});

describe('crearWebhook', () => {
  it('crea con la organización de la membresía, sin duplicar eventos, y devuelve el secreto', async () => {
    estado.respuestas.set('rpc:crear_webhook', { data: [{ webhook_id: ID, secreto: SECRETO }] });
    const r = await crearWebhook(
      'mi-org',
      null,
      formulario({
        url: `  ${URL_OK} `,
        eventos: ['documento.aceptado', 'documento.aceptado', 'documento.rechazado'],
      }),
    );
    expect(r).toMatchObject({ ok: true, secreto: SECRETO, webhookId: ID });
    expect(estado.llamadas).toEqual([
      {
        rpc: 'crear_webhook',
        args: {
          p_organizacion: 'org-de-la-membresia',
          p_url: URL_OK,
          p_eventos: ['documento.aceptado', 'documento.rechazado'],
        },
        cadena: [],
      },
    ]);
  });

  it('rechaza URL local, http y sin eventos antes de llamar a la base', async () => {
    for (const url of ['http://erp.cl/x', 'https://localhost/x', 'https://10.0.0.1/x', '']) {
      const r = await crearWebhook(
        'mi-org',
        null,
        formulario({ url, eventos: ['documento.aceptado'] }),
      );
      expect(r.ok === false && r.errores?.url).toBeTruthy();
    }
    const r = await crearWebhook(
      'mi-org',
      null,
      formulario({ url: URL_OK, eventos: ['webhook.prueba', 'inventado'] }),
    );
    expect(r.ok === false && r.errores?.eventos).toBeTruthy();
    expect(estado.llamadas).toEqual([]);
  });

  it('traduce el plan sin webhooks', async () => {
    estado.respuestas.set('rpc:crear_webhook', {
      error: { code: 'P0001', message: 'El plan vigente no incluye webhooks' },
    });
    const r = await crearWebhook(
      'mi-org',
      null,
      formulario({ url: URL_OK, eventos: ['documento.aceptado'] }),
    );
    expect(r.ok === false && r.error.titulo).toMatch(/no incluye webhooks/);
    expect(r.ok === false && r.valores?.url).toBe(URL_OK);
  });

  it('un lector o una sesión vencida no crean', async () => {
    estado.rol = 'lector';
    expect(
      (
        await crearWebhook(
          'mi-org',
          null,
          formulario({ url: URL_OK, eventos: ['documento.aceptado'] }),
        )
      ).ok,
    ).toBe(false);
    estado.rol = 'propietario';
    estado.sesionValida = false;
    expect(
      (
        await crearWebhook(
          'mi-org',
          null,
          formulario({ url: URL_OK, eventos: ['documento.aceptado'] }),
        )
      ).ok,
    ).toBe(false);
    expect(estado.llamadas).toEqual([]);
  });
});

describe('actualizarWebhook', () => {
  it('actualiza solo url y eventos, filtrando por organización', async () => {
    estado.respuestas.set('from:webhooks', { count: 1 });
    const r = await actualizarWebhook(
      'mi-org',
      ID,
      null,
      formulario({ url: URL_OK, eventos: ['envio.actualizado'] }),
    );
    expect(r.ok).toBe(true);
    expect(estado.llamadas[0]?.cadena).toEqual([
      ['update', { url: URL_OK, eventos: ['envio.actualizado'] }, { count: 'exact' }],
      ['eq', 'organizacion_id', 'org-de-la-membresia'],
      ['eq', 'id', ID],
    ]);
  });

  it('traduce el check de URL de la base', async () => {
    estado.respuestas.set('from:webhooks', {
      error: { code: '23514', message: 'violates check constraint "webhooks_url_permitida"' },
    });
    const r = await actualizarWebhook(
      'mi-org',
      ID,
      null,
      formulario({ url: URL_OK, eventos: ['envio.actualizado'] }),
    );
    expect(r.ok === false && r.error.titulo).toMatch(/URL/);
  });
});

describe('estado, borrar, probar, rotar y reenviar', () => {
  it('pausar solo cambia un webhook activo', async () => {
    estado.respuestas.set('from:webhooks', { count: 1 });
    const r = await cambiarEstadoWebhook('mi-org', ID, false);
    expect(r.ok).toBe(true);
    expect(estado.llamadas[0]?.cadena).toEqual([
      ['update', { activo: false }, { count: 'exact' }],
      ['eq', 'organizacion_id', 'org-de-la-membresia'],
      ['eq', 'id', ID],
      ['eq', 'activo', true],
    ]);
  });

  it('borrar filtra por organización', async () => {
    estado.respuestas.set('from:webhooks', { count: 1 });
    expect((await borrarWebhook('mi-org', ID)).ok).toBe(true);
    expect(estado.llamadas[0]?.cadena).toEqual([
      ['delete', { count: 'exact' }],
      ['eq', 'organizacion_id', 'org-de-la-membresia'],
      ['eq', 'id', ID],
    ]);
  });

  it('probar traduce el webhook pausado', async () => {
    estado.respuestas.set('rpc:probar_webhook', {
      error: { code: '22023', message: 'El webhook está desactivado' },
    });
    const r = await probarWebhook('mi-org', ID);
    expect(r.ok === false && r.error.titulo).toMatch(/pausado/);
  });

  it('rotar devuelve el secreto nuevo una vez', async () => {
    estado.respuestas.set('rpc:rotar_secreto_webhook', { data: SECRETO });
    expect(await rotarSecretoWebhook('mi-org', ID)).toEqual({ ok: true, secreto: SECRETO });
    expect(estado.llamadas[0]).toMatchObject({
      rpc: 'rotar_secreto_webhook',
      args: { p_webhook: ID },
    });
  });

  it('reenviar exige un id de entrega entero positivo', async () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect((await reenviarEntrega('mi-org', ID, id)).ok).toBe(false);
    }
    expect(estado.llamadas).toEqual([]);
    const r = await reenviarEntrega('mi-org', ID, 42);
    expect(r.ok).toBe(true);
    expect(estado.llamadas[0]).toMatchObject({
      rpc: 'reenviar_entrega_webhook',
      args: { p_entrega: 42 },
    });
  });

  it('reenviar traduce la entrega ya en cola', async () => {
    estado.respuestas.set('rpc:reenviar_entrega_webhook', {
      error: { code: '22023', message: 'La entrega ya está en cola' },
    });
    const r = await reenviarEntrega('mi-org', ID, 42);
    expect(r.ok === false && r.error.titulo).toMatch(/en cola/);
  });

  it('un emisor no puede ninguna', async () => {
    estado.rol = 'emisor';
    const resultados = await Promise.all([
      cambiarEstadoWebhook('mi-org', ID, true),
      borrarWebhook('mi-org', ID),
      probarWebhook('mi-org', ID),
      rotarSecretoWebhook('mi-org', ID),
      reenviarEntrega('mi-org', ID, 1),
    ]);
    expect(resultados.every((r) => !r.ok)).toBe(true);
    expect(estado.llamadas).toEqual([]);
  });
});
