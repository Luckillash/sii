import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envSupabasePublico } from '../env';
import type { Database } from './tipos';

// Cliente anónimo (clave publicable, rol `anon`) SIN cookies, para el sitio público
// (PLAN-SAAS Fase 12). No lee ni escribe la sesión: así la página que lo usa puede ser
// estática y revalidarse cada cierto tiempo (`export const revalidate`), en vez de
// renderizarse en cada petición como pasaría con `clienteServidor()`.
//
// Solo ve lo que RLS deja ver a `anon` (hoy, los planes activos: política `lectura` de
// `planes`). Para leer con la sesión del usuario se usa `clienteServidor()`.

export type ClientePublico = SupabaseClient<Database>;

export function clientePublico(): ClientePublico {
  const env = envSupabasePublico();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
