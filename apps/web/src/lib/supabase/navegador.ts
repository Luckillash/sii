import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/server/supabase/tipos';

// Cliente de Supabase para componentes cliente ('use client'): solo claves públicas
// (URL y clave publicable `sb_publishable_…`), la sesión vive en cookies que comparte con el servidor. Para Auth en
// el navegador (signIn, signUp con captchaToken, resetPasswordForEmail) y Realtime.
// Las lecturas de datos van por RSC con `clienteServidor()`.
//
// `Database` se importa solo como tipo: `tipos.ts` no tiene código ni `server-only`,
// y `import type` se borra al compilar, así que nada del servidor llega al bundle.

let cliente: SupabaseClient<Database> | undefined;

/** Devuelve el cliente del navegador (uno solo por pestaña). */
export function clienteNavegador(): SupabaseClient<Database> {
  if (cliente) return cliente;

  // Acceso literal a process.env.NEXT_PUBLIC_*: Next solo reemplaza así en el bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !clave?.startsWith('sb_publishable_')) {
    throw new Error(
      'Configuración incompleta (Supabase público): revisa NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  cliente = createBrowserClient<Database>(url, clave);
  return cliente;
}
