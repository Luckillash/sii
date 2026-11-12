import type { CampoAuth } from './esquemas';

// Traducción de los errores de Supabase Auth a mensajes con el tono del design system
// (PLAN-SAAS §2, principio 7): español de Chile, tú, sin exclamaciones; qué pasó y qué
// hacer. Puro, para probarlo con Vitest.
//
// No revela si un correo tiene cuenta, salvo donde Supabase ya lo hace inevitable
// (correo sin confirmar tras una contraseña correcta; «ya registrado» cuando la
// confirmación de correo está desactivada).

/** Lo que importa de un `AuthError` (o de cualquier error lanzado). */
export interface ErrorAuth {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
  /** `AuthWeakPasswordError`: 'length' | 'characters' | 'pwned'. */
  reasons?: readonly string[];
}

export type ContextoAuth = 'ingresar' | 'enlace' | 'crear-cuenta' | 'recuperar' | 'restablecer';

export interface ErrorTraducido {
  mensaje: string;
  /** Si el error es de un campo, se muestra junto a él. */
  campo?: CampoAuth;
}

export const MENSAJES_AUTH = {
  credenciales:
    'El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo, o recupera tu contraseña.',
  correoSinConfirmar:
    'Aún no confirmas tu correo. Abre el enlace que te enviamos al crear la cuenta; si no lo ves, revisa la carpeta de spam.',
  yaRegistrado:
    'Ya hay una cuenta con ese correo. Ingresa con tu contraseña o recupérala si no la recuerdas.',
  claveDebil:
    'La contraseña es muy fácil de adivinar. Usa al menos 8 caracteres y combina letras, números y símbolos.',
  claveCorta: 'La contraseña es muy corta. Usa al menos 8 caracteres.',
  claveCaracteres:
    'A la contraseña le faltan tipos de caracteres. Combina mayúsculas, minúsculas, números y símbolos.',
  claveFiltrada:
    'Esa contraseña aparece en filtraciones conocidas. Elige otra que no uses en otros sitios.',
  claveIgual: 'La contraseña nueva es igual a la anterior. Elige una distinta.',
  limiteIntentos:
    'Hiciste demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.',
  limiteCorreos: 'Ya enviamos varios correos hace poco. Espera unos minutos antes de pedir otro.',
  captcha:
    'No pudimos completar la verificación de seguridad. Vuelve a hacerla y envía el formulario otra vez.',
  correoInvalido: 'Revisa el correo: no parece una dirección válida.',
  correoNoAutorizado:
    'Por ahora no podemos enviar correos a esa dirección. Inténtalo más tarde o avísanos para revisarlo.',
  registroCerrado: 'Por ahora no se pueden crear cuentas nuevas. Inténtalo más tarde.',
  proveedorCerrado: 'El acceso con correo está desactivado por ahora. Inténtalo más tarde.',
  cuentaSuspendida: 'Esta cuenta está suspendida. Avísanos si crees que es un error.',
  sinSesionRecuperacion:
    'Tu enlace de recuperación venció o ya se usó. Pide uno nuevo para cambiar la contraseña.',
  reautenticar:
    'Por seguridad necesitas un enlace de recuperación reciente. Pide uno nuevo y vuelve a intentarlo.',
  enlaceVencido: 'El enlace venció o ya se usó. Pide uno nuevo.',
  sinConexion:
    'No pudimos conectar con el servicio de cuentas. Revisa tu conexión e inténtalo de nuevo en unos minutos.',
  datosInvalidos: 'Revisa los datos del formulario e inténtalo de nuevo.',
} as const;

const GENERICO: Readonly<Record<ContextoAuth, string>> = {
  ingresar: 'No pudimos ingresar. Inténtalo de nuevo en unos minutos; si sigue fallando, avísanos.',
  enlace:
    'No pudimos enviar el enlace. Inténtalo de nuevo en unos minutos; si sigue fallando, avísanos.',
  'crear-cuenta':
    'No pudimos crear la cuenta. Inténtalo de nuevo en unos minutos; si sigue fallando, avísanos.',
  recuperar:
    'No pudimos enviar el correo de recuperación. Inténtalo de nuevo en unos minutos; si sigue fallando, avísanos.',
  restablecer:
    'No pudimos cambiar la contraseña. Inténtalo de nuevo en unos minutos; si sigue fallando, avísanos.',
};

/** Código del error: el de Supabase o, en versiones viejas del servidor, deducido del texto. */
export function codigoErrorAuth(error: ErrorAuth): string | undefined {
  if (error.code) return error.code;
  if (error.name === 'AuthSessionMissingError') return 'session_not_found';
  if (error.name === 'AuthWeakPasswordError') return 'weak_password';
  const texto = error.message ?? '';
  if (/invalid login credentials/i.test(texto)) return 'invalid_credentials';
  if (/email not confirmed/i.test(texto)) return 'email_not_confirmed';
  if (/user already registered/i.test(texto)) return 'user_already_exists';
  if (/password should|weak password/i.test(texto)) return 'weak_password';
  if (/email rate limit/i.test(texto)) return 'over_email_send_rate_limit';
  if (/rate limit|too many requests/i.test(texto) || error.status === 429) {
    return 'over_request_rate_limit';
  }
  if (/captcha/i.test(texto)) return 'captcha_failed';
  if (/signups not allowed/i.test(texto)) return 'otp_disabled';
  if (/auth session missing/i.test(texto)) return 'session_not_found';
  return undefined;
}

/** Fallo de red, timeout o error del servidor de Auth (vale la pena reintentar). */
export function esErrorDeConexion(error: ErrorAuth): boolean {
  const codigo = error.code;
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.name === 'TypeError' || // fetch failed
    error.status === 0 ||
    (typeof error.status === 'number' && error.status >= 500) ||
    codigo === 'request_timeout' ||
    codigo === 'hook_timeout' ||
    codigo === 'hook_timeout_after_retry' ||
    codigo === 'unexpected_failure'
  );
}

function mensajeClaveDebil(reasons: readonly string[] | undefined): string {
  if (reasons?.includes('pwned')) return MENSAJES_AUTH.claveFiltrada;
  if (reasons?.includes('length')) return MENSAJES_AUTH.claveCorta;
  if (reasons?.includes('characters')) return MENSAJES_AUTH.claveCaracteres;
  return MENSAJES_AUTH.claveDebil;
}

/** Traduce un error de Supabase Auth al mensaje que ve la persona. */
export function traducirErrorAuth(error: ErrorAuth, contexto: ContextoAuth): ErrorTraducido {
  switch (codigoErrorAuth(error)) {
    case 'invalid_credentials':
      // Sin campo: no se dice si falló el correo o la contraseña.
      return { mensaje: MENSAJES_AUTH.credenciales };
    case 'email_not_confirmed':
      return { mensaje: MENSAJES_AUTH.correoSinConfirmar };
    case 'user_already_exists':
    case 'email_exists':
      return { mensaje: MENSAJES_AUTH.yaRegistrado, campo: 'correo' };
    case 'weak_password':
      return { mensaje: mensajeClaveDebil(error.reasons), campo: 'clave' };
    case 'same_password':
      return { mensaje: MENSAJES_AUTH.claveIgual, campo: 'clave' };
    case 'over_request_rate_limit':
      return { mensaje: MENSAJES_AUTH.limiteIntentos };
    case 'over_email_send_rate_limit':
      return { mensaje: MENSAJES_AUTH.limiteCorreos };
    case 'captcha_failed':
      return { mensaje: MENSAJES_AUTH.captcha };
    case 'email_address_invalid':
      return { mensaje: MENSAJES_AUTH.correoInvalido, campo: 'correo' };
    case 'email_address_not_authorized':
      return { mensaje: MENSAJES_AUTH.correoNoAutorizado };
    case 'signup_disabled':
      return {
        mensaje: contexto === 'crear-cuenta' ? MENSAJES_AUTH.registroCerrado : GENERICO[contexto],
      };
    case 'email_provider_disabled':
      return { mensaje: MENSAJES_AUTH.proveedorCerrado };
    case 'user_banned':
      return { mensaje: MENSAJES_AUTH.cuentaSuspendida };
    case 'session_not_found':
    case 'session_expired':
      return {
        mensaje:
          contexto === 'restablecer' ? MENSAJES_AUTH.sinSesionRecuperacion : GENERICO[contexto],
      };
    case 'reauthentication_needed':
    case 'reauth_nonce_missing':
      return { mensaje: MENSAJES_AUTH.reautenticar };
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return { mensaje: MENSAJES_AUTH.enlaceVencido };
    case 'validation_failed':
      return { mensaje: MENSAJES_AUTH.datosInvalidos };
  }
  if (esErrorDeConexion(error)) return { mensaje: MENSAJES_AUTH.sinConexion };
  return { mensaje: GENERICO[contexto] };
}

// Errores que, al pedir un correo (enlace mágico o recuperación), solo delatarían que
// la cuenta no existe: se responde como si se hubiera enviado.
const OCULTOS_AL_ENVIAR_CORREO = new Set([
  'otp_disabled', // «Signups not allowed for otp»: shouldCreateUser: false y no hay cuenta
  'user_not_found',
  'signup_disabled',
  'email_not_confirmed',
  'user_banned',
]);

/**
 * Para `signInWithOtp` y `resetPasswordForEmail`: el error que hay que mostrar, o
 * `null` si se debe responder igual que cuando el correo salió («si hay una cuenta con
 * ese correo, te enviamos…»), para no revelar qué correos tienen cuenta.
 */
export function errorVisibleAlEnviarCorreo(
  error: ErrorAuth,
  contexto: 'enlace' | 'recuperar',
): ErrorTraducido | null {
  const codigo = codigoErrorAuth(error);
  if (codigo && OCULTOS_AL_ENVIAR_CORREO.has(codigo)) return null;
  return traducirErrorAuth(error, contexto);
}
