import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caPrueba, certificado, pfx } from '../../../../../test/pfx-prueba';

// Pruebas de las Server Actions de certificados sin red ni base: la sesión, el
// cliente de Supabase con sesión y el de service_role son dobles que registran lo
// que reciben.

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

/** Consulta encadenable de PostgREST: registra cada método y al final resuelve `resultado`. */
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
  usuarioAuth: { id: 'usuario-1' } as { id: string } | null,
  llamadas: [] as Llamada[],
  respuestas: new Map<string, Resultado>(),
}));

function responder(clave: string): Resultado {
  return estado.respuestas.get(clave) ?? {};
}

function cliente() {
  return {
    auth: {
      getUser: async () =>
        estado.usuarioAuth
          ? { data: { user: estado.usuarioAuth }, error: null }
          : { data: { user: null }, error: { message: 'Auth session missing' } },
    },
    from(tabla: string) {
      const llamada: Llamada = { tabla, cadena: [] };
      estado.llamadas.push(llamada);
      return consulta(llamada, responder(`from:${tabla}`));
    },
    async rpc(nombre: string, args: unknown) {
      estado.llamadas.push({ rpc: nombre, args, cadena: [] });
      return { data: null, error: null, ...responder(`rpc:${nombre}`) };
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
vi.mock('@/server/supabase/servidor', () => ({ clienteServidor: async () => cliente() }));
vi.mock('@/server/supabase/service', () => ({ clienteServicio: () => cliente() }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { subirCertificado, revocarCertificado, eliminarCertificado } = await import('./acciones');

const CLAVE = 'clave-correcta-1';
const CENTINELA = 'CENTINELA-9b2e4d77-clave-ÑÑ';
const ID_CERT = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const ID_EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function formulario(
  bytes: Uint8Array | null,
  campos: Record<string, string> = {},
  nombre = '12345678-5 Juan Perez.pfx',
): FormData {
  const f = new FormData();
  if (bytes) f.set('pfx', new File([new Uint8Array(bytes)], nombre));
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

function rpcs(nombre: string) {
  return estado.llamadas.filter((l) => l.rpc === nombre);
}

const espias: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  estado.rol = 'administrador';
  estado.usuarioAuth = { id: 'usuario-1' };
  estado.llamadas = [];
  estado.respuestas = new Map([['rpc:registrar_certificado', { data: ID_CERT }]]);
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    espias.push(vi.spyOn(console, metodo).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const espia of espias.splice(0)) espia.mockRestore();
});

/** Todo lo que salió por consola, como texto. */
function consola(): string {
  return espias.map((e) => JSON.stringify(e.mock.calls)).join('\n');
}

describe('subirCertificado', () => {
  it('registra con service_role, la organización de la membresía y quien sube', async () => {
    const titular = certificado({ cn: 'Juan Pérez', rutSan: '12345678-5' });
    const bytes = pfx(titular, CLAVE);
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(bytes, {
        clave: CLAVE,
        organizacion_id: 'org-ajena',
        p_organizacion: 'org-ajena',
      }),
    );

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mensaje).toMatch(/^Cargaste el certificado de Juan Pérez\. Vence el /);
    const [llamada] = rpcs('registrar_certificado');
    const args = llamada?.args as Record<string, unknown>;
    expect(args.p_organizacion).toBe('org-de-la-membresia');
    expect(args.p_subido_por).toBe('usuario-1');
    expect(args.p_rut_titular).toBe('12345678-5');
    expect(args.p_cn).toBe('Juan Pérez');
    expect(args.p_nombre_titular).toBe('Juan Pérez');
    expect(args.p_clave).toBe(CLAVE);
    expect(args.p_pfx_base64).toBe(Buffer.from(bytes).toString('base64'));
    expect(args.p_huella_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_pfx_legacy).toBe(false);
    expect(new Date(String(args.p_vigente_hasta)).getTime()).toBeGreaterThan(Date.now());

    // La respuesta no trae ni la clave ni el archivo ni su nombre.
    const json = JSON.stringify(r);
    expect(json).not.toContain(CLAVE);
    expect(json).not.toContain(Buffer.from(bytes).toString('base64').slice(0, 40));
    expect(json).not.toContain('Juan Perez.pfx');
  });

  it('un emisor o un lector no puede subir', async () => {
    for (const rol of ['emisor', 'lector']) {
      estado.rol = rol;
      const r = await subirCertificado(
        'mi-org',
        null,
        formulario(pfx(certificado(), CLAVE), { clave: CLAVE }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.titulo).toBe('No tienes permiso para hacer esto');
    }
    expect(rpcs('registrar_certificado')).toHaveLength(0);
  });

  it('valida archivo, tamaño, extensión y clave antes de abrir nada', async () => {
    const sinArchivo = await subirCertificado('mi-org', null, formulario(null, { clave: CLAVE }));
    expect(!sinArchivo.ok && sinArchivo.errores?.pfx).toBeTruthy();

    const grande = await subirCertificado(
      'mi-org',
      null,
      formulario(new Uint8Array(100 * 1024 + 1), { clave: CLAVE }),
    );
    expect(!grande.ok && grande.errores?.pfx).toMatch(/100 KB/);

    const extension = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(certificado(), CLAVE), { clave: CLAVE }, 'certificado.pem'),
    );
    expect(!extension.ok && extension.errores?.pfx).toMatch(/\.pfx o \.p12/);

    const sinClave = await subirCertificado('mi-org', null, formulario(pfx(certificado(), CLAVE)));
    expect(!sinClave.ok && sinClave.errores?.clave).toBeTruthy();

    expect(rpcs('registrar_certificado')).toHaveLength(0);
  });

  it('acepta .p12 y extensión en mayúsculas', async () => {
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE }, 'FIRMA.P12'),
    );
    expect(r.ok).toBe(true);
  });

  it('contraseña incorrecta: error en el campo clave', async () => {
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(certificado(), CLAVE), { clave: 'otra' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.titulo).toBe('La contraseña del certificado no es correcta');
      expect(r.errores?.clave).toBeTruthy();
    }
  });

  it('rechaza un certificado vencido', async () => {
    const titular = certificado({
      rutSan: '12345678-5',
      desde: new Date(Date.now() - 400 * 86_400_000),
      hasta: new Date(Date.now() - 86_400_000),
    });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.titulo).toBe('El certificado está vencido');
    expect(rpcs('registrar_certificado')).toHaveLength(0);
  });

  it('sin RUT en el certificado pide el campo y después usa el escrito', async () => {
    const bytes = pfx(certificado(), CLAVE);
    const primero = await subirCertificado('mi-org', null, formulario(bytes, { clave: CLAVE }));
    expect(primero.ok).toBe(false);
    if (!primero.ok) {
      expect(primero.pedirRut).toBe(true);
      expect(primero.errores?.rut_titular).toBeTruthy();
    }
    expect(rpcs('registrar_certificado')).toHaveLength(0);

    const segundo = await subirCertificado(
      'mi-org',
      primero,
      formulario(bytes, { clave: CLAVE, rut_titular: '12.345.678-5' }),
    );
    expect(segundo.ok).toBe(true);
    expect(rpcs('registrar_certificado')[0]?.args).toMatchObject({
      p_rut_titular: '12345678-5',
    });
  });

  it('RUT escrito con DV inválido', async () => {
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(certificado(), CLAVE), { clave: CLAVE, rut_titular: '12.345.678-9' }),
    );
    expect(!r.ok && r.errores?.rut_titular).toMatch(/dígito verificador/);
  });

  it('si el certificado trae RUT y el escrito es otro, rechaza', async () => {
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE, rut_titular: '76.354.771-K' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.titulo).toBe('El RUT no coincide con el del certificado');
    expect(rpcs('registrar_certificado')).toHaveLength(0);

    // El mismo RUT con otro formato sí sirve.
    const igual = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE, rut_titular: '12.345.678-5' }),
    );
    expect(igual.ok).toBe(true);
  });

  it('confirma la sesión con getUser() antes de escribir', async () => {
    estado.usuarioAuth = null;
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.titulo).toBe('Tu sesión ya no es válida');
    expect(rpcs('registrar_certificado')).toHaveLength(0);

    // Sesión viva pero de otro usuario (cookie cambiada a medio camino).
    estado.usuarioAuth = { id: 'otro-usuario' };
    const otro = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE }),
    );
    expect(otro.ok).toBe(false);
    expect(rpcs('registrar_certificado')).toHaveLength(0);
  });

  it('23505 → ya está cargado en la organización', async () => {
    estado.respuestas.set('rpc:registrar_certificado', {
      error: { code: '23505', message: 'El certificado ya está registrado en la organización' },
    });
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.titulo).toBe('Ese certificado ya está cargado en la organización');
  });

  it('asocia a una empresa de la organización con RLS y fija el predeterminado', async () => {
    estado.respuestas.set('from:empresas', {
      data: { id: ID_EMPRESA, rut: '76354771-K', razon_social: 'Empresa' },
    });
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), {
        clave: CLAVE,
        empresa_id: ID_EMPRESA,
        representante: 'on',
        predeterminado: 'on',
      }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.aviso).toBeFalsy();

    const empresa = estado.llamadas.find((l) => l.tabla === 'empresas');
    expect(empresa?.cadena).toContainEqual(['eq', 'organizacion_id', 'org-de-la-membresia']);
    const insercion = estado.llamadas.find((l) => l.tabla === 'empresa_certificados');
    expect(insercion?.cadena[0]).toEqual([
      'insert',
      {
        organizacion_id: 'org-de-la-membresia',
        empresa_id: ID_EMPRESA,
        certificado_id: ID_CERT,
        es_representante_electronico: true,
        predeterminado: false,
      },
    ]);
    expect(rpcs('fijar_certificado_predeterminado')[0]?.args).toEqual({
      p_empresa: ID_EMPRESA,
      p_certificado: ID_CERT,
    });
  });

  it('empresa de otra organización: no registra nada', async () => {
    estado.respuestas.set('from:empresas', { data: null });
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE, empresa_id: ID_EMPRESA }),
    );
    expect(!r.ok && r.errores?.empresa_id).toBeTruthy();
    expect(rpcs('registrar_certificado')).toHaveLength(0);
  });

  it('si la asociación falla, el certificado queda cargado con un aviso', async () => {
    estado.respuestas.set('from:empresas', {
      data: { id: ID_EMPRESA, rut: '76354771-K', razon_social: 'Empresa' },
    });
    estado.respuestas.set('from:empresa_certificados', {
      error: { code: '42501', message: 'rls' },
    });
    const titular = certificado({ rutSan: '12345678-5' });
    const r = await subirCertificado(
      'mi-org',
      null,
      formulario(pfx(titular, CLAVE), { clave: CLAVE, empresa_id: ID_EMPRESA }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.aviso?.titulo).toMatch(/no pudimos asociarlo/);
  });
});

describe('subirCertificado no filtra la clave ni el archivo (criterio de la Fase 3)', () => {
  it('ni en la respuesta ni en la consola, en ningún camino de error', async () => {
    const ca = caPrueba();
    const conRut = certificado({ emisor: ca, rutSan: '12345678-5' });
    const sinRut = certificado({ emisor: ca });
    const vencido = certificado({
      rutSan: '12345678-5',
      desde: new Date(Date.now() - 400 * 86_400_000),
      hasta: new Date(Date.now() - 86_400_000),
    });
    const NOMBRE = `${CENTINELA}.pfx`;

    const casos: { bytes: Uint8Array; campos: Record<string, string>; preparar?: () => void }[] = [
      // Clave incorrecta (la centinela va en la clave escrita).
      { bytes: pfx(conRut, CLAVE), campos: { clave: CENTINELA } },
      // Vencido, sin RUT, RUT distinto.
      { bytes: pfx(vencido, CENTINELA), campos: { clave: CENTINELA } },
      { bytes: pfx(sinRut, CENTINELA), campos: { clave: CENTINELA } },
      {
        bytes: pfx(conRut, CENTINELA),
        campos: { clave: CENTINELA, rut_titular: '76.354.771-K' },
      },
      // No es un .pfx (el contenido es la centinela).
      {
        bytes: new TextEncoder().encode(`xx${CENTINELA}${'A'.repeat(64)}`),
        campos: { clave: CENTINELA },
      },
      // Sesión revocada.
      {
        bytes: pfx(conRut, CENTINELA),
        campos: { clave: CENTINELA },
        preparar: () => {
          estado.usuarioAuth = null;
        },
      },
      // Error genérico de la base, con la centinela metida en el mensaje de Postgres.
      {
        bytes: pfx(conRut, CENTINELA),
        campos: { clave: CENTINELA },
        preparar: () => {
          estado.respuestas.set('rpc:registrar_certificado', {
            error: { code: 'XX000', message: `fallo con ${CENTINELA}` },
          });
        },
      },
      // Duplicado.
      {
        bytes: pfx(conRut, CENTINELA),
        campos: { clave: CENTINELA },
        preparar: () => {
          estado.respuestas.set('rpc:registrar_certificado', {
            error: { code: '23505', message: `duplicado ${CENTINELA}` },
          });
        },
      },
    ];

    for (const caso of casos) {
      estado.usuarioAuth = { id: 'usuario-1' };
      estado.respuestas = new Map([['rpc:registrar_certificado', { data: ID_CERT }]]);
      caso.preparar?.();
      const r = await subirCertificado('mi-org', null, formulario(caso.bytes, caso.campos, NOMBRE));
      expect(r.ok).toBe(false);
      const json = JSON.stringify(r);
      const base64 = Buffer.from(caso.bytes).toString('base64');
      // El nombre del archivo también lleva la centinela.
      expect(json).not.toContain(CENTINELA);
      expect(json).not.toContain(base64.slice(0, 40));
    }

    const salida = consola();
    expect(salida).not.toContain(CENTINELA);
    // Solo se registró el error genérico, con su código.
    expect(salida).toContain('XX000');
  });
});

describe('revocar y eliminar', () => {
  it('revoca con service_role filtrando por la organización de la membresía', async () => {
    estado.respuestas.set('from:certificados', { count: 1 });
    const r = await revocarCertificado('mi-org', ID_CERT);
    expect(r.ok).toBe(true);
    const llamada = estado.llamadas.find((l) => l.tabla === 'certificados');
    expect(llamada?.cadena[0]?.[0]).toBe('update');
    expect(llamada?.cadena).toContainEqual(['eq', 'organizacion_id', 'org-de-la-membresia']);
    expect(llamada?.cadena).toContainEqual(['eq', 'id', ID_CERT]);
    expect(llamada?.cadena).toContainEqual(['is', 'revocado_en', null]);
  });

  it('elimina con service_role filtrando por la organización de la membresía', async () => {
    estado.respuestas.set('from:certificados', { count: 1 });
    const r = await eliminarCertificado('mi-org', ID_CERT);
    expect(r.ok).toBe(true);
    const llamada = estado.llamadas.find((l) => l.tabla === 'certificados');
    expect(llamada?.cadena[0]?.[0]).toBe('delete');
    expect(llamada?.cadena).toContainEqual(['eq', 'organizacion_id', 'org-de-la-membresia']);
    expect(llamada?.cadena).toContainEqual(['eq', 'id', ID_CERT]);
  });

  it('sin filas afectadas (otra organización o ya no existe) → sin efecto', async () => {
    estado.respuestas.set('from:certificados', { count: 0 });
    const r = await eliminarCertificado('mi-org', ID_CERT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.titulo).toBe('No se aplicó el cambio');
  });

  it('exigen admin, id válido y sesión confirmada', async () => {
    estado.rol = 'emisor';
    expect((await revocarCertificado('mi-org', ID_CERT)).ok).toBe(false);
    estado.rol = 'propietario';
    expect((await eliminarCertificado('mi-org', 'no-es-uuid')).ok).toBe(false);
    estado.usuarioAuth = null;
    expect((await eliminarCertificado('mi-org', ID_CERT)).ok).toBe(false);
    expect(estado.llamadas.filter((l) => l.tabla === 'certificados')).toHaveLength(0);
  });
});
