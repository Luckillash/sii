import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { periodoUsoActual, type UsoOrganizacion } from '@/lib/planes';
import type { Database } from '../supabase/tipos';

// Uso actual de una organización, con el mismo conteo que los triggers de cupos:
// empresas y miembros (filas), y boletas de producción del mes en `uso_mensual`. Sirve
// con el cliente de sesión (RLS `es_miembro` en las tres tablas) o con el de servicio.

export async function leerUso(
  db: SupabaseClient<Database>,
  organizacionId: string,
  ahora: Date = new Date(),
): Promise<UsoOrganizacion> {
  const [empresas, miembros, uso] = await Promise.all([
    db
      .from('empresas')
      .select('id', { count: 'exact', head: true })
      .eq('organizacion_id', organizacionId),
    db
      .from('miembros_organizacion')
      .select('usuario_id', { count: 'exact', head: true })
      .eq('organizacion_id', organizacionId),
    db
      .from('uso_mensual')
      .select('boletas_produccion')
      .eq('organizacion_id', organizacionId)
      .eq('periodo', periodoUsoActual(ahora))
      .maybeSingle(),
  ]);
  const error = empresas.error ?? miembros.error ?? uso.error;
  if (error) throw new Error(`No se pudo leer el uso de la organización: ${error.message}`);
  return {
    empresas: empresas.count ?? 0,
    usuarios: miembros.count ?? 0,
    boletasProduccionMes: uso.data?.boletas_produccion ?? 0,
  };
}
