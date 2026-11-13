import 'server-only';
import { z } from 'zod';

// Variables de entorno del servidor (PLAN-SAAS §5). Se validan al usarlas, no al
// importar el módulo, para que `next build` funcione sin secretos.

// Solo claves API nuevas de Supabase: las legadas (JWT `anon` / `service_role`) se
// retiran en 2027. Se exige el prefijo para que una clave legada no pase por error.
//   sb_publishable_…  rol `anon` sin sesión, `authenticated` con la sesión del usuario
//   sb_secret_…       rol `service_role` (salta RLS); solo en el servidor
const clavePublicable = z.string().startsWith('sb_publishable_').min(20);
const claveSecreta = z.string().startsWith('sb_secret_').min(20);

const esquemaSupabaseSecreta = z.object({
  SUPABASE_SECRET_KEY: claveSecreta,
});

const esquemaSupabase = esquemaSupabaseSecreta.extend({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
});

// Lo mínimo para hablar con Supabase con la sesión del usuario (clave publicable).
const esquemaSupabasePublico = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: clavePublicable,
});

const esquemaAuth = esquemaSupabasePublico.extend({
  NEXT_PUBLIC_APP_URL: z.url(),
});

const esquemaCorreo = z.object({
  RESEND_API_KEY: z.string().min(10),
  // «Boletéame <no-responder@dominio>» o solo la dirección.
  CORREO_REMITENTE: z.string().min(3),
});

const esquemaTurnstile = z.object({
  TURNSTILE_SECRET_KEY: z.string().min(10),
});

function validar<T extends z.ZodType>(esquema: T, nombre: string): z.infer<T> {
  const resultado = esquema.safeParse(process.env);
  if (!resultado.success) {
    // Solo los nombres de las variables, nunca sus valores.
    const faltan = resultado.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración incompleta (${nombre}): revisa ${faltan}.`);
  }
  return resultado.data;
}

/** Variables opcionales: `null` si falta alguna (la función que las usa decide qué hacer). */
function opcional<T extends z.ZodType>(esquema: T): z.infer<T> | null {
  const resultado = esquema.safeParse(process.env);
  return resultado.success ? resultado.data : null;
}

/** URL y clave secreta: solo `server/supabase/service.ts`. */
export const envSupabase = () => validar(esquemaSupabase, 'Supabase');

/**
 * URL y clave publicable de Supabase. La usan el proxy y `clienteServidor()`: no exigen
 * NEXT_PUBLIC_APP_URL para que una variable de enlaces que falte no tumbe todas las
 * páginas.
 */
export const envSupabasePublico = () => validar(esquemaSupabasePublico, 'Supabase público');

/**
 * La misma clave secreta, para las llamadas a Auth que reenvían la IP real
 * (`server/supabase/clave-auth.ts`). `null` si falta: Auth se llama con la clave
 * publicable y ve la IP de Vercel, pero las páginas de acceso no se caen.
 */
export const envSupabaseSecreta = (): z.infer<typeof esquemaSupabaseSecreta> | null =>
  opcional(esquemaSupabaseSecreta);

/**
 * Supabase Auth más la URL pública de la app, que arma los enlaces de los correos de
 * Auth (`emailRedirectTo`, `redirectTo` → `${NEXT_PUBLIC_APP_URL}/auth/callback`).
 */
export const envAuth = () => validar(esquemaAuth, 'Auth');

/**
 * Resend (PLAN-SAAS §4.6). Devuelve `null` si falta alguna variable: todavía no hay
 * cuenta de Resend, así que quien envía correos debe tolerar que no esté configurado
 * (p. ej. mostrar el enlace de invitación para copiarlo a mano).
 */
export const envCorreo = (): z.infer<typeof esquemaCorreo> | null => opcional(esquemaCorreo);

/**
 * Turnstile en el servidor (`siteverify`, PLAN-SAAS §4.7), solo para formularios que no
 * pasan por Supabase Auth. Devuelve `null` si no está configurado: quien verifica decide
 * si lo omite (desarrollo) o rechaza.
 */
export const envTurnstile = (): z.infer<typeof esquemaTurnstile> | null =>
  opcional(esquemaTurnstile);
