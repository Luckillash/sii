import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { envSupabasePublico } from '../env';
import type { Database } from './tipos';

// Cliente con la sesión del usuario (clave anon + cookies): todo pasa por RLS
// (PLAN-SAAS §2, principio 2). Es el cliente por defecto para leer en Server
// Components y escribir en Server Actions y Route Handlers.

/**
 * Crea un cliente de Supabase con la sesión de la petición actual.
 *
 * - Crear uno nuevo por petición (nunca guardarlo en un módulo: mezclaría sesiones).
 * - Para saber quién es el usuario usa `obtenerUsuario()` de `@/server/sesion`
 *   (`getClaims()` verifica el JWT); nunca confíes en `auth.getSession()` en el servidor,
 *   que solo lee la cookie sin validarla.
 * - En Server Components las cookies son de solo lectura: si el token se refresca ahí,
 *   la escritura se ignora y la hace el proxy (`src/proxy.ts`) en la próxima petición.
 *   En Server Actions y Route Handlers sí se escriben.
 */
export async function clienteServidor(): Promise<SupabaseClient<Database>> {
  const env = envSupabasePublico();
  const almacen = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return almacen.getAll();
        },
        setAll(porEscribir) {
          try {
            for (const { name, value, options } of porEscribir) {
              almacen.set(name, value, options);
            }
          } catch {
            // Server Component: no se pueden escribir cookies. El proxy refresca la sesión.
          }
        },
      },
    },
  );
}
