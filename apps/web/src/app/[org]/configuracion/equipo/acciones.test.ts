import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESION_VENCIDA } from '@/lib/equipo-errores';

// Server Actions de Configuración → Equipo sin red ni base. Lo que da o quita acceso a otra
// persona confirma la sesión con Auth (`getUser()`) antes de escribir (PLAN-SAAS Fase 13,
// punto 1): con la sesión revocada no se llama a la base.

interface Llamada {
  tabla?: string;
  rpc?: string;
  args?: unknown;
  cadena: [string, ...unknown[]][];
}

const estado = vi.hoisted(() => ({
  sesionValida: true,
  confirmaciones: 0,
  llamadas: [] as Llamada[],
}));

function consulta(llamada: Llamada, resultado: Record<string, unknown>) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null, ...resultado }).then(ok);
        }
        return (...args: unknown[]) => {
          llamada.cadena.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const ORG = 'org-de-la-membresia';
const OTRO = '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
const INVITACION = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

vi.mock('@/server/sesion', () => ({
  exigirMembresia: async (slug: string) => ({
    usuario: { id: 'usuario-1', correo: 'duena@example.com' },
    organizacion: { id: ORG, slug, nombre: 'Org de prueba' },
    rol: 'propietario',
  }),
  obtenerPerfil: async () => ({ nombre: 'Dueña' }),
}));
vi.mock('@/server/certificados/acceso', () => ({
  confirmarSesion: async (id: string) => {
    estado.confirmaciones++;
    return estado.sesionValida && id === 'usuario-1';
  },
}));
vi.mock('@/server/equipo', () => ({
  listarMiembros: async () => [
    { usuarioId: 'usuario-1', rol: 'propietario', correo: 'duena@example.com' },
    { usuarioId: OTRO, rol: 'emisor', correo: 'emisor@example.com' },
  ],
  cupoUsuarios: async () => ({ maximo: null, usados: 2, plan: 'Pro' }),
  urlBaseApp: async () => 'https://app.example',
}));
vi.mock('@/server/correo/invitacion', () => ({
  enviarInvitacion: async () => ({
    enlace: 'https://app.example/invitacion/x',
    envio: { ok: true },
  }),
}));
vi.mock('@/server/supabase/servidor', () => ({
  clienteServidor: async () => ({
    from(tabla: string) {
      const llamada: Llamada = { tabla, cadena: [] };
      estado.llamadas.push(llamada);
      return consulta(llamada, {
        count: 1,
        data: tabla === 'invitaciones' ? { correo: 'nuevo@example.com', rol: 'lector' } : null,
      });
    },
    async rpc(nombre: string, args: unknown) {
      estado.llamadas.push({ rpc: nombre, args, cadena: [] });
      return { data: 'token-de-prueba', error: null };
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect');
  },
}));

const { cambiarRol, invitar, quitarMiembro, reenviarInvitacion } = await import('./acciones');

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

beforeEach(() => {
  estado.sesionValida = true;
  estado.confirmaciones = 0;
  estado.llamadas = [];
});

describe('equipo: getUser() antes de dar o quitar acceso', () => {
  const casos: [string, () => Promise<{ ok: boolean; error?: unknown }>][] = [
    [
      'invitar',
      () => invitar('org', null, formulario({ correo: 'nuevo@example.com', rol: 'lector' })),
    ],
    ['reenviarInvitacion', () => reenviarInvitacion('org', INVITACION)],
    ['cambiarRol', () => cambiarRol('org', OTRO, 'lector')],
    ['quitarMiembro', () => quitarMiembro('org', OTRO)],
  ];

  for (const [nombre, llamar] of casos) {
    it(`${nombre}: con la sesión revocada no escribe nada`, async () => {
      estado.sesionValida = false;
      const r = await llamar();
      expect(r.ok).toBe(false);
      expect(r.error).toEqual(SESION_VENCIDA);
      expect(estado.confirmaciones).toBe(1);
      const escrituras = estado.llamadas.filter(
        (l) => l.rpc || l.cadena.some(([m]) => m === 'update' || m === 'delete' || m === 'insert'),
      );
      expect(escrituras).toEqual([]);
    });

    it(`${nombre}: con la sesión viva sigue y confirma una vez`, async () => {
      const r = await llamar();
      expect(r.ok).toBe(true);
      expect(estado.confirmaciones).toBe(1);
    });
  }

  it('cambiarRol escribe filtrando por la organización de la membresía', async () => {
    await cambiarRol('org', OTRO, 'lector');
    const update = estado.llamadas.find((l) => l.cadena.some(([m]) => m === 'update'));
    expect(update?.tabla).toBe('miembros_organizacion');
    expect(update?.cadena).toContainEqual(['eq', 'organizacion_id', ORG]);
  });
});
