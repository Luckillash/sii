import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { COLUMNAS_PLAN, type Plan } from '@/lib/planes';
import { type GrillaPublica, grillaPublica } from '@/lib/planes-publicos';
import { clientePublico } from './supabase/publico';

// Precios de la landing (PLAN-SAAS Fase 12): los planes activos, leídos como `anon` con
// el cliente sin cookies para que la página siga siendo estática. Nunca rompe la página:
// si la lectura falla (o vuelve vacía) usa la grilla de respaldo y lo avisa a Sentry.

export async function leerGrillaPublica(): Promise<GrillaPublica> {
  let filas: Plan[] | null = null;
  let falla: unknown = null;
  try {
    const { data, error } = await clientePublico()
      .from('planes')
      .select(COLUMNAS_PLAN)
      .order('orden', { ascending: true });
    if (error) falla = error;
    else filas = data;
  } catch (error) {
    // Configuración incompleta o red: igual se muestran precios.
    falla = error;
  }

  const { grilla, respaldo } = grillaPublica(filas);
  if (respaldo) {
    const motivo = falla
      ? falla instanceof Error
        ? falla.message
        : String((falla as { message?: unknown }).message ?? 'error desconocido')
      : 'la tabla planes no devolvió planes con precio';
    console.error(`landing: precios de respaldo (${motivo})`);
    Sentry.captureMessage('landing: precios de respaldo', {
      level: 'warning',
      tags: { seccion: 'precios' },
      extra: { motivo },
    });
  }
  return grilla;
}
