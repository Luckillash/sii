import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { envSupabasePublico } from '../env';
import { configClienteAuth } from './clave-auth';
import type { Database } from './tipos';

// Cliente con la sesión del usuario (clave publicable + cookies): todo pasa por RLS
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
  return crearConCookies(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {},
  );
}

/**
 * Cliente SOLO para `supabase.auth.*` en nombre de la persona (ingresar, crear cuenta,
 * recuperar, callback): con `SUPABASE_SECRET_KEY` reenvía su IP a Auth en
 * `sb-forwarded-for`. Comparte las cookies de sesión con `clienteServidor()`.
 *
 * - Nunca lo uses para `.from()`, `.rpc()` ni Storage: sin sesión correría como
 *   service_role (ver `clave-auth.ts`).
 * - Si `conClaveSecreta`, Auth omite el captcha: verifica Turnstile antes con
 *   `verificarTurnstile()`.
 */
export async function clienteAuth(opciones: { exigeCaptcha?: boolean } = {}): Promise<{
  supabase: SupabaseClient<Database>;
  conClaveSecreta: boolean;
}> {
  const config = configClienteAuth(await headers(), opciones);
  const supabase = await crearConCookies(config.url, config.clave, config.cabeceras);
  return { supabase, conClaveSecreta: config.conClaveSecreta };
}

async function crearConCookies(
  url: string,
  clave: string,
  cabeceras: Record<string, string>,
): Promise<SupabaseClient<Database>> {
  const almacen = await cookies();

  return createServerClient<Database>(url, clave, {
    global: { headers: cabeceras },
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
  });
}
