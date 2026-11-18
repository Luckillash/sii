'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formatearFecha } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import type { MensajeError } from '@/server/equipo-errores';
import {
  cambiarDePlan,
  cancelarSuscripcion,
  dependenciasPagos,
  type FallaPagos,
  iniciarContratacion,
  previsualizarCambio,
} from '@/server/pagos';
import { mensajeFallaPagos } from '@/server/pagos/errores';
import { type ContextoOrganizacion, exigirMembresia } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';

// Acciones de Configuración → Plan (PLAN-SAAS Fase 10). Solo propietarios y
// administradores (como el resto de la configuración de la organización). La sesión se
// confirma con `getUser()` antes de tocar la pasarela (operación con cobro). Lo demás
// (cliente de servicio, Flow) está en `server/pagos/`.

const esquemaPlan = z.string().regex(/^[a-z0-9_-]{2,40}$/);

const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para cambiar el plan',
  detalle: 'Solo un propietario o un administrador puede contratar, cambiar o cancelar el plan.',
};

const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Los datos no son válidos',
  detalle: 'Recarga la página y vuelve a intentarlo.',
};

type Falla = { ok: false; error: MensajeError };

async function contextoAdmin(slug: string): Promise<ContextoOrganizacion | Falla> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  // getClaims verifica la firma localmente; antes de una operación con cobro se confirma
  // con Auth que la sesión no fue revocada (PLAN-SAAS Fase 13, punto 1).
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== ctx.usuario.id) {
    return {
      ok: false,
      error: {
        titulo: 'Tu sesión ya no es válida',
        detalle: 'Vuelve a ingresar y repite la operación.',
      },
    };
  }
  return ctx;
}

function falla(f: FallaPagos, operacion: string): Falla {
  if (f.codigo === 'pasarela' || f.codigo === 'pasarela_red' || f.codigo === 'base') {
    // Solo el código y el detalle técnico (servicio de Flow y su mensaje): sin tokens.
    console.error(`Plan: ${operacion} falló`, { codigo: f.codigo, detalle: f.detalle });
  }
  return { ok: false, error: mensajeFallaPagos(f) };
}

function rutaPlan(slug: string): string {
  return `/${slug}/configuracion/plan`;
}

export type ResultadoContratar = { ok: true; url: string } | { ok: true; cambio: true } | Falla;

/** Desde el plan gratis: devuelve la URL de Flow para registrar la tarjeta. */
export async function contratar(slug: string, planCodigo: string): Promise<ResultadoContratar> {
  const ctx = await contextoAdmin(slug);
  if ('ok' in ctx) return ctx;
  const plan = esquemaPlan.safeParse(planCodigo);
  if (!plan.success) return { ok: false, error: DATOS_INVALIDOS };
  const d = dependenciasPagos();
  if (!d) return falla({ ok: false, codigo: 'sin_configuracion' }, 'contratar');
  const r = await iniciarContratacion(d, {
    organizacion: { id: ctx.organizacion.id, nombre: ctx.organizacion.nombre },
    usuario: { id: ctx.usuario.id, correo: ctx.usuario.correo },
    planCodigo: plan.data,
  });
  if (!r.ok) return falla(r, 'contratar');
  return r.tipo === 'redirigir' ? { ok: true, url: r.url } : { ok: true, cambio: true };
}

export type ResultadoVistaPrevia =
  | {
      ok: true;
      plan: string;
      precio: number;
      saldo: number;
      proximoCobro: string | null;
    }
  | Falla;

/** Prorrateo de Flow para un cambio de plan (no cambia nada). */
export async function vistaPreviaCambio(
  slug: string,
  planCodigo: string,
): Promise<ResultadoVistaPrevia> {
  const ctx = await contextoAdmin(slug);
  if ('ok' in ctx) return ctx;
  const plan = esquemaPlan.safeParse(planCodigo);
  if (!plan.success) return { ok: false, error: DATOS_INVALIDOS };
  const d = dependenciasPagos();
  if (!d) return falla({ ok: false, codigo: 'sin_configuracion' }, 'vista previa');
  const r = await previsualizarCambio(d, ctx.organizacion.id, plan.data);
  if (!r.ok) return falla(r, 'vista previa');
  return {
    ok: true,
    plan: r.plan.nombre,
    precio: r.plan.precio,
    saldo: r.saldo,
    proximoCobro: r.proximoCobro,
  };
}

export type ResultadoCambiar = { ok: true; mensaje: string } | Falla;

export async function cambiarPlan(slug: string, planCodigo: string): Promise<ResultadoCambiar> {
  const ctx = await contextoAdmin(slug);
  if ('ok' in ctx) return ctx;
  const plan = esquemaPlan.safeParse(planCodigo);
  if (!plan.success) return { ok: false, error: DATOS_INVALIDOS };
  const d = dependenciasPagos();
  if (!d) return falla({ ok: false, codigo: 'sin_configuracion' }, 'cambiar');
  const r = await cambiarDePlan(d, ctx.organizacion.id, plan.data);
  if (!r.ok) return falla(r, 'cambiar');
  revalidatePath(`/${slug}`, 'layout');
  return {
    ok: true,
    mensaje: !r.sincronizado
      ? `Flow aceptó el cambio al plan ${r.plan}. Lo verás reflejado aquí en unos minutos; no lo repitas.`
      : r.aplicado
        ? `Cambiaste al plan ${r.plan}. Los nuevos límites se aplican desde la próxima emisión.`
        : `Flow programó el cambio al plan ${r.plan}${r.desde ? ` para el ${formatearFecha(r.desde)}` : ''}. Hasta entonces rige tu plan actual.`,
  };
}

export type ResultadoCancelar = { ok: true; mensaje: string } | Falla;

export async function cancelarPlan(slug: string): Promise<ResultadoCancelar> {
  const ctx = await contextoAdmin(slug);
  if ('ok' in ctx) return ctx;
  const d = dependenciasPagos();
  if (!d) return falla({ ok: false, codigo: 'sin_configuracion' }, 'cancelar');
  const r = await cancelarSuscripcion(d, ctx.organizacion.id);
  if (!r.ok) return falla(r, 'cancelar');
  revalidatePath(rutaPlan(slug));
  return {
    ok: true,
    mensaje:
      'Cancelaste la suscripción. Tu plan sigue vigente hasta el fin del período pagado; después vuelves al plan Certificación, sin cobros.',
  };
}
