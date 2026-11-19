import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server Actions de Configuración → API sin red ni base: la sesión y el cliente de
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

const { crearClaveApi, revocarClaveApi } = await import('./acciones');

const CLAVE = `sk_test_${'a1'.repeat(32)}`;
const ID = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const ID_EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

const valido = {
  nombre: '  ERP de la tienda ',
  ambiente: 'certificacion',
  empresa: '',
  alcances: ['documentos:leer', 'documentos:emitir'],
  expiracion: '',
};

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

describe('crearClaveApi', () => {
  it('crea con la organización de la membresía y devuelve la clave una vez', async () => {
    estado.respuestas.set('rpc:crear_api_key', { data: CLAVE });
    const r = await crearClaveApi('mi-org', null, formulario(valido));
    expect(r).toEqual({ ok: true, clave: CLAVE, nombre: 'ERP de la tienda' });
    expect(estado.llamadas).toEqual([
      {
        rpc: 'crear_api_key',
        args: {
          p_organizacion: 'org-de-la-membresia',
          p_nombre: 'ERP de la tienda',
          p_alcances: ['documentos:leer', 'documentos:emitir'],
          p_ambiente: 'certificacion',
        },
        cadena: [],
      },
    ]);
  });

  it('pasa empresa y vencimiento cuando vienen', async () => {
    estado.respuestas.set('rpc:crear_api_key', { data: CLAVE });
    await crearClaveApi(
      'mi-org',
      null,
      formulario({ ...valido, empresa: ID_EMPRESA, expiracion: '30' }),
    );
    const args = estado.llamadas[0]?.args as Record<string, string>;
    expect(args.p_empresa).toBe(ID_EMPRESA);
    const dias = (new Date(args.p_expira_en ?? '').getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThan(30.1);
  });

  it('un emisor no puede crear y no se llama a la base', async () => {
    estado.rol = 'emisor';
    const r = await crearClaveApi('mi-org', null, formulario(valido));
    expect(r.ok).toBe(false);
    expect(estado.llamadas).toEqual([]);
  });

  it('sin sesión confirmada en Auth no crea', async () => {
    estado.sesionValida = false;
    const r = await crearClaveApi('mi-org', null, formulario(valido));
    expect(r.ok === false && r.error.titulo).toMatch(/sesión/);
    expect(estado.llamadas).toEqual([]);
  });

  it('valida campos: nombre vacío, sin permisos, alcance reservado y ambiente inventado', async () => {
    const r = await crearClaveApi(
      'mi-org',
      null,
      formulario({
        nombre: '  ',
        ambiente: 'staging',
        empresa: 'no-es-uuid',
        alcances: ['certificacion:gestionar'],
        expiracion: '7',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errores ?? {}).sort()).toEqual([
      'alcances',
      'ambiente',
      'empresa',
      'expiracion',
      'nombre',
    ]);
    expect(r.valores?.nombre).toBe('  ');
    expect(estado.llamadas).toEqual([]);
  });

  it('traduce el plan sin API y no registra nada', async () => {
    estado.respuestas.set('rpc:crear_api_key', {
      error: { code: 'P0001', message: 'El plan vigente no incluye acceso por API' },
    });
    const r = await crearClaveApi('mi-org', null, formulario(valido));
    expect(r.ok === false && r.error.titulo).toMatch(/no incluye acceso por API/);
    expect(estado.logs).toEqual([]);
  });

  it('un error desconocido se registra con código y mensaje, sin la clave', async () => {
    estado.respuestas.set('rpc:crear_api_key', { error: { code: '08006', message: 'conexión' } });
    const r = await crearClaveApi('mi-org', null, formulario(valido));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(estado.logs)).toContain('08006');
    expect(JSON.stringify(estado.logs)).not.toContain('sk_');
  });
});

describe('revocarClaveApi', () => {
  it('revoca filtrando por organización y solo si no estaba revocada', async () => {
    estado.respuestas.set('from:api_keys', { count: 1 });
    const r = await revocarClaveApi('mi-org', ID);
    expect(r.ok).toBe(true);
    const cadena = estado.llamadas[0]?.cadena ?? [];
    expect(cadena[0]?.[0]).toBe('update');
    expect(Object.keys(cadena[0]?.[1] as object)).toEqual(['revocada_en']);
    expect(cadena.slice(1)).toEqual([
      ['eq', 'organizacion_id', 'org-de-la-membresia'],
      ['eq', 'id', ID],
      ['is', 'revocada_en', null],
    ]);
  });

  it('sin filas afectadas avisa que no se aplicó', async () => {
    estado.respuestas.set('from:api_keys', { count: 0 });
    const r = await revocarClaveApi('mi-org', ID);
    expect(r.ok === false && r.error.titulo).toMatch(/No se aplicó/);
  });

  it('id inválido o rol sin permiso: no toca la base', async () => {
    expect((await revocarClaveApi('mi-org', 'x')).ok).toBe(false);
    estado.rol = 'lector';
    expect((await revocarClaveApi('mi-org', ID)).ok).toBe(false);
    expect(estado.llamadas).toEqual([]);
  });
});
