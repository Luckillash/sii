import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESION_VENCIDA } from '@/lib/equipo-errores';

// Configuración → Plan: contratar, cambiar, cancelar y la vista previa tocan la pasarela
// (cobros), así que confirman la sesión con Auth (`getUser()`) antes de armar sus
// dependencias (PLAN-SAAS Fase 13, punto 1). Sin red: la pasarela es un doble.

const estado = vi.hoisted(() => ({
  rol: 'administrador' as string,
  sesionValida: true,
  confirmaciones: [] as string[],
  dependencias: 0,
  llamadas: [] as [string, unknown[]][],
}));

vi.mock('@/server/sesion', () => ({
  exigirMembresia: async (slug: string) => ({
    usuario: { id: 'usuario-1', correo: 'admin@example.com' },
    organizacion: { id: 'org-de-la-membresia', slug, nombre: 'Org de prueba' },
    rol: estado.rol,
  }),
}));
vi.mock('@/server/certificados/acceso', () => ({
  confirmarSesion: async (id: string) => {
    estado.confirmaciones.push(id);
    return estado.sesionValida;
  },
}));
vi.mock('@/server/pagos', () => {
  const registrar =
    (nombre: string, valor: unknown) =>
    async (...args: unknown[]) => {
      estado.llamadas.push([nombre, args]);
      return valor;
    };
  return {
    dependenciasPagos: () => {
      estado.dependencias++;
      return {};
    },
    iniciarContratacion: registrar('iniciarContratacion', {
      ok: true,
      tipo: 'redirigir',
      url: 'https://sandbox.flow.cl/registro',
    }),
    previsualizarCambio: registrar('previsualizarCambio', {
      ok: true,
      plan: { nombre: 'Pro', precio: 1000 },
      saldo: 0,
      proximoCobro: null,
    }),
    cambiarDePlan: registrar('cambiarDePlan', {
      ok: true,
      plan: 'Pro',
      sincronizado: true,
      aplicado: true,
    }),
    cancelarSuscripcion: registrar('cancelarSuscripcion', { ok: true }),
  };
});
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { cambiarPlan, cancelarPlan, contratar, vistaPreviaCambio } = await import('./acciones');

beforeEach(() => {
  estado.rol = 'administrador';
  estado.sesionValida = true;
  estado.confirmaciones = [];
  estado.dependencias = 0;
  estado.llamadas = [];
});

const ACCIONES: [string, () => Promise<{ ok: boolean; error?: unknown }>][] = [
  ['contratar', () => contratar('org', 'pro')],
  ['vistaPreviaCambio', () => vistaPreviaCambio('org', 'pro')],
  ['cambiarPlan', () => cambiarPlan('org', 'pro')],
  ['cancelarPlan', () => cancelarPlan('org')],
];

describe('plan: getUser() antes de tocar la pasarela', () => {
  for (const [nombre, llamar] of ACCIONES) {
    it(`${nombre}: con la sesión revocada no llega a Flow`, async () => {
      estado.sesionValida = false;
      const r = await llamar();
      expect(r).toEqual({ ok: false, error: SESION_VENCIDA });
      expect(estado.confirmaciones).toEqual(['usuario-1']);
      expect(estado.dependencias).toBe(0);
      expect(estado.llamadas).toEqual([]);
    });

    it(`${nombre}: con la sesión viva llama a la pasarela con la organización de la membresía`, async () => {
      const r = await llamar();
      expect(r.ok).toBe(true);
      expect(estado.confirmaciones).toEqual(['usuario-1']);
      expect(estado.llamadas).toHaveLength(1);
      expect(JSON.stringify(estado.llamadas[0]?.[1])).toContain('org-de-la-membresia');
    });
  }

  it('un lector no llega ni a confirmar la sesión', async () => {
    estado.rol = 'lector';
    const r = await contratar('org', 'pro');
    expect(r.ok).toBe(false);
    expect(estado.confirmaciones).toEqual([]);
    expect(estado.llamadas).toEqual([]);
  });
});
