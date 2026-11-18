import 'server-only';
import { fallaBase } from '../certificacion/comun';
import type { ClienteServicio } from '../supabase/service';

// El plan vigente permite producción (PLAN-SAAS Fase 6): UNA sola fuente para el servidor
// (que bloquea pedir folios de producción) y para la vista (que lo explica antes): la
// función `plan_vigente()` de la base (0001). Solo la ejecuta service_role (no está en los
// grants de `authenticated`), así que siempre se llama con el cliente de servicio y la
// organización de la membresía, nunca una del navegador.

/** `true` si el plan vigente de la organización permite producción. Lanza si falla la base. */
export async function planPermiteProduccion(
  cliente: ClienteServicio,
  organizacionId: string,
): Promise<boolean> {
  const { data, error } = await cliente.rpc('plan_vigente', { p_organizacion: organizacionId });
  if (error) throw fallaBase('leer el plan vigente', error);
  // Sin suscripción vigente la función devuelve un registro nulo (o todo en null).
  const plan = (Array.isArray(data) ? data[0] : data) as { permite_produccion?: unknown } | null;
  return plan?.permite_produccion === true;
}

export interface CuotaProduccion {
  plan: string | null;
  /** Boletas de producción con folio en el mes en curso (`uso_mensual`, hora de Chile). */
  usadas: number;
  /** `max_boletas_mes` del plan vigente; null = sin límite. 0 si el plan no tiene producción o no hay plan. */
  maximo: number | null;
}

/**
 * Cupo de boletas de producción del mes (PLAN-SAAS Fase 10): el mismo conteo que
 * `tg_contar_uso_documento`, que rechaza la boleta que pasa `max_boletas_mes`. Solo para
 * avisar antes en Emitir; la autoridad es el trigger. Lanza si falla la base.
 */
export async function cuotaProduccion(
  cliente: ClienteServicio,
  organizacionId: string,
  ahora: Date = new Date(),
): Promise<CuotaProduccion> {
  const periodo = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(ahora).slice(0, 7)}-01`;
  const [plan, uso] = await Promise.all([
    cliente.rpc('plan_vigente', { p_organizacion: organizacionId }),
    cliente
      .from('uso_mensual')
      .select('boletas_produccion')
      .eq('organizacion_id', organizacionId)
      .eq('periodo', periodo)
      .maybeSingle(),
  ]);
  if (plan.error) throw fallaBase('leer el plan vigente', plan.error);
  if (uso.error) throw fallaBase('leer el uso del mes', uso.error);
  const p = (Array.isArray(plan.data) ? plan.data[0] : plan.data) as {
    id?: string | null;
    nombre?: string | null;
    permite_produccion?: boolean | null;
    max_boletas_mes?: number | null;
  } | null;
  const vigente = Boolean(p?.id);
  return {
    plan: vigente ? (p?.nombre ?? null) : null,
    usadas: uso.data?.boletas_produccion ?? 0,
    maximo: vigente && p?.permite_produccion ? (p.max_boletas_mes ?? null) : 0,
  };
}
