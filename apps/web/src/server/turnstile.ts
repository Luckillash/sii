import 'server-only';
import { envTurnstile } from './env';

// Verificación de Turnstile en el servidor (`siteverify`, PLAN-SAAS §4.7), solo para
// formularios que NO pasan por Supabase Auth (invitaciones, contacto). Los de Auth
// mandan el token en `options.captchaToken` y lo verifica Supabase.

const URL_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Corto: si Cloudflare no responde, la persona reintenta en vez de esperar. */
export const TIMEOUT_TURNSTILE_MS = 5000;
/** Largo máximo de un token según Cloudflare. */
const LARGO_MAXIMO_TOKEN = 2048;

// Los motivos se pueden mostrar tal cual a la persona: qué pasó y qué hacer.
export const MOTIVOS_TURNSTILE = {
  falta:
    'Falta la verificación de seguridad. Espera a que termine y vuelve a enviar el formulario.',
  invalido:
    'No pudimos validar la verificación de seguridad. Vuelve a hacerla y envía el formulario otra vez.',
  vencido:
    'La verificación de seguridad venció o ya se usó. Vuelve a hacerla y envía el formulario otra vez.',
  sinConexion:
    'No pudimos comprobar la verificación de seguridad. Inténtalo de nuevo en unos minutos.',
  noDisponible:
    'La verificación de seguridad no está disponible en este momento. Inténtalo de nuevo más tarde.',
} as const;

export type ResultadoTurnstile = { ok: true } | { ok: false; motivo: string };

interface RespuestaSiteverify {
  success?: boolean;
  'error-codes'?: string[];
  /** `action` con la que se renderizó el widget. */
  action?: string;
  /** Hostname de la página donde se resolvió el desafío. */
  hostname?: string;
}

/**
 * Lo que debe traer la respuesta de `siteverify` además de `success`. Cada campo que se
 * pida se compara; si no calza, el token se rechaza (un token sacado de otro formulario
 * o de otro sitio con la misma clave de sitio).
 */
export interface EsperadoTurnstile {
  /** `action` del widget (la prop `accion` de `<Turnstile>`). */
  accion?: string;
  /** Hostname de la página, sin puerto ni esquema (`boleteame.dev`). */
  hostname?: string;
}

const ERRORES_DE_CONFIGURACION = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'invalid-widget-id',
  'invalid-parsed-secret',
]);

/**
 * Verifica un token de Turnstile con `siteverify`.
 *
 * - Sin TURNSTILE_SECRET_KEY (`envTurnstile()` es `null`) devuelve `{ ok: true }`:
 *   Turnstile está desactivado (aún no hay cuenta; desarrollo). Quien quiera fallar
 *   cerrado en producción lo revisa antes (ver la acción de `/contacto`).
 * - `motivo` está redactado para mostrarlo a la persona.
 * - Nunca lanza: red caída, timeout (5 s) o respuesta rara → `{ ok: false }`.
 *
 * @param ip IP de quien envía (opcional; ver `ipCliente()`).
 * @param esperado `action` y `hostname` que debe traer la respuesta (opcional; lo que no
 *   se pide no se compara).
 */
export async function verificarTurnstile(
  token: string | null | undefined,
  ip?: string | null,
  esperado?: EsperadoTurnstile,
): Promise<ResultadoTurnstile> {
  const env = envTurnstile();
  if (!env) return { ok: true };

  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, motivo: MOTIVOS_TURNSTILE.falta };
  }
  if (token.length > LARGO_MAXIMO_TOKEN) {
    return { ok: false, motivo: MOTIVOS_TURNSTILE.invalido };
  }

  const cuerpo = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) cuerpo.set('remoteip', ip);

  let datos: RespuestaSiteverify;
  try {
    const respuesta = await fetch(URL_SITEVERIFY, {
      method: 'POST',
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_TURNSTILE_MS),
    });
    if (!respuesta.ok) {
      console.error(`turnstile: siteverify respondió ${respuesta.status}`);
      return { ok: false, motivo: MOTIVOS_TURNSTILE.sinConexion };
    }
    datos = (await respuesta.json()) as RespuestaSiteverify;
  } catch (error) {
    // Nunca el token ni la clave en el log.
    const nombre = error instanceof Error ? error.name : 'error desconocido';
    console.error(`turnstile: siteverify falló (${nombre})`);
    return { ok: false, motivo: MOTIVOS_TURNSTILE.sinConexion };
  }

  if (datos?.success === true) {
    // Solo qué campo no calzó: nunca el token ni los valores.
    if (esperado?.accion !== undefined && datos.action !== esperado.accion) {
      console.error('turnstile: la action de la respuesta no coincide');
      return { ok: false, motivo: MOTIVOS_TURNSTILE.invalido };
    }
    if (
      esperado?.hostname !== undefined &&
      (typeof datos.hostname !== 'string' ||
        datos.hostname.toLowerCase() !== esperado.hostname.toLowerCase())
    ) {
      console.error('turnstile: el hostname de la respuesta no coincide');
      return { ok: false, motivo: MOTIVOS_TURNSTILE.invalido };
    }
    return { ok: true };
  }

  const codigos = Array.isArray(datos?.['error-codes']) ? datos['error-codes'] : [];
  if (codigos.some((c) => ERRORES_DE_CONFIGURACION.has(c))) {
    console.error(`turnstile: configuración inválida (${codigos.join(', ')})`);
    return { ok: false, motivo: MOTIVOS_TURNSTILE.noDisponible };
  }
  if (codigos.includes('timeout-or-duplicate')) {
    return { ok: false, motivo: MOTIVOS_TURNSTILE.vencido };
  }
  return { ok: false, motivo: MOTIVOS_TURNSTILE.invalido };
}

/**
 * IP del cliente para `verificarTurnstile` (primer valor de `x-forwarded-for`, que en
 * Vercel pone la plataforma), o `null`. Uso: `ipCliente(await headers())`.
 */
export function ipCliente(cabeceras: Headers): string | null {
  const reenviada = cabeceras.get('x-forwarded-for')?.split(',')[0]?.trim();
  return reenviada || cabeceras.get('x-real-ip')?.trim() || null;
}
