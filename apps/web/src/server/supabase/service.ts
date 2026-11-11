import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envSupabase } from '../env';

// Cliente con service_role: salta RLS. Solo para la capa SII, los cron y la API
// pública, y siempre filtrando por organizacion_id (PLAN-SAAS §2). Jamás se importa
// desde un componente cliente: `server-only` rompe el build si pasa.

export function clienteServicio(): SupabaseClient {
  const env = envSupabase();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
