import 'server-only';
import { envSupabasePublico, envSupabaseSecreta, envTurnstile } from '../env';
import { ipCliente } from '../turnstile';

// Clave y cabeceras de los clientes que llaman a Supabase Auth EN NOMBRE DE UNA PERSONA
// (ingresar, crear cuenta, recuperar, el callback de los correos y el refresco de sesión
// del proxy).
//
// Problema: esas llamadas salen de Vercel, así que Auth ve la IP de Vercel y sus límites
// por IP (ingresos, verificación de enlaces, refresco de tokens) los comparten todas las
// personas. Solución de Supabase: mandar la IP real en `sb-forwarded-for`, y solo la
// acepta con una clave secreta `sb_secret_…` (SUPABASE_SECRET_KEY, la misma de
// `service.ts`) y con «IP Address Forwarding» activo en Authentication → Rate Limits.
// Si ese ajuste está apagado, Auth ignora la cabecera.
//
// Ojo, dos consecuencias de la clave secreta:
// 1. Auth recibe la llamada como service_role y OMITE EL CAPTCHA (`verifyCaptcha` en
//    supabase/auth salta la verificación con credenciales de administrador). Por eso,
//    con `conClaveSecreta`, quien llama verifica Turnstile por su cuenta (`siteverify`)
//    antes de llamar a Auth. El captcha de Supabase sigue protegiendo a quien llame a
//    `/auth/v1` directamente con la clave pública.
// 2. Sin sesión, la Data API (PostgREST, Storage) también correría como service_role,
//    saltando RLS. Por eso estos clientes SOLO se usan para `supabase.auth.*`: para leer
//    o escribir datos se usa `clienteServidor()` (clave publicable).
//
// Sin la clave secreta, o sin IP, devuelve la clave publicable y ninguna cabecera. Lo
// mismo con `exigeCaptcha` si la app no tiene TURNSTILE_SECRET_KEY: no podría verificar
// el captcha y la clave secreta lo apagaría.

export interface ConfigClienteAuth {
  url: string;
  clave: string;
  cabeceras: Record<string, string>;
  /** Auth omitirá el captcha: verificar Turnstile en la app antes de llamar. */
  conClaveSecreta: boolean;
}

/**
 * @param cabeceras las de la petición entrante (`await headers()` o `request.headers`).
 * @param opciones.exigeCaptcha la llamada lleva captcha (ingresar, crear cuenta, recuperar).
 */
export function configClienteAuth(
  cabeceras: Headers,
  opciones: { exigeCaptcha?: boolean } = {},
): ConfigClienteAuth {
  const publico = envSupabasePublico();
  const secreta = envSupabaseSecreta();
  const ip = ipCliente(cabeceras);
  const captchaVerificable = !opciones.exigeCaptcha || envTurnstile() !== null;

  if (!secreta || !ip || !captchaVerificable) {
    return {
      url: publico.NEXT_PUBLIC_SUPABASE_URL,
      clave: publico.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      cabeceras: {},
      conClaveSecreta: false,
    };
  }
  return {
    url: publico.NEXT_PUBLIC_SUPABASE_URL,
    clave: secreta.SUPABASE_SECRET_KEY,
    cabeceras: { 'sb-forwarded-for': ip },
    conClaveSecreta: true,
  };
}
