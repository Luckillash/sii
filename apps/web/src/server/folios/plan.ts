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
