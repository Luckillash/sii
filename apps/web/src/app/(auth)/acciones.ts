'use server';

import { redirect } from 'next/navigation';
import { destinoSeguro } from '@/lib/redireccion';
import { RUTA_BIENVENIDA } from '@/lib/rutas';
import { envAuth } from '@/server/env';
import { clienteServidor } from '@/server/supabase/servidor';
import {
  type ContextoAuth,
  type ErrorAuth,
  errorVisibleAlEnviarCorreo,
  traducirErrorAuth,
} from './_compartido/errores-auth';
import {
  esquemaCrearCuenta,
  esquemaEnlace,
  esquemaIngresar,
  esquemaRecuperar,
  esquemaRestablecer,
  leerCampos,
  validar,
} from './_compartido/esquemas';
import type { EstadoAuth } from './_compartido/estado';

// Server Actions de las pantallas de acceso (PLAN-SAAS Fase 2). Corren con el cliente
// de sesión (`clienteServidor()`), que escribe las cookies de la sesión y del
// verificador PKCE. Cada una valida con zod aunque el formulario ya lo haya hecho.
//
// El token de Turnstile llega en `captchaToken` y va en `options.captchaToken`: lo
// verifica Supabase Auth (captcha nativo, PLAN-SAAS §4.7). Si el captcha no está
// activado en Supabase, Auth lo ignora.
//
// Nunca se registran correos, contraseñas ni tokens: solo el código del error.

function texto(datos: FormData, campo: string): string {
  const valor = datos.get(campo);
  return typeof valor === 'string' ? valor : '';
}

function captcha(datos: FormData): string | undefined {
  return texto(datos, 'captchaToken') || undefined;
}

/** `${NEXT_PUBLIC_APP_URL}/auth/callback?siguiente=…` para los enlaces de los correos. */
function urlCallback(siguiente: string): string {
  const base = envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  return `${base}/auth/callback?${new URLSearchParams({ siguiente }).toString()}`;
}

function registrar(contexto: ContextoAuth, error: unknown): void {
  const e = (error ?? {}) as ErrorAuth;
  const detalle = e.code ?? e.name ?? 'error desconocido';
  console.error(`auth/${contexto}: ${detalle}${e.status ? ` (${e.status})` : ''}`);
}

/** Error de Auth → estado del formulario (campo o mensaje general). */
function estadoDeError(error: ErrorAuth, contexto: ContextoAuth): EstadoAuth {
  const { mensaje, campo } = traducirErrorAuth(error, contexto);
  return campo ? { errores: { [campo]: mensaje } } : { mensaje };
}

/** Algo lanzó (configuración incompleta, red): mensaje según el contexto. */
function estadoDeExcepcion(error: unknown, contexto: ContextoAuth): EstadoAuth {
  registrar(contexto, error instanceof Error ? { name: error.name } : error);
  return { mensaje: traducirErrorAuth({ status: 0 }, contexto).mensaje };
}

/**
 * `/ingresar`. Con `modo=enlace` (botón «Recibir un enlace por correo») manda un enlace
 * mágico sin crear cuentas; si no, correo y contraseña.
 */
export async function ingresar(_previo: EstadoAuth, datos: FormData): Promise<EstadoAuth> {
  const siguiente = destinoSeguro(texto(datos, 'siguiente'));
  const captchaToken = captcha(datos);

  if (texto(datos, 'modo') === 'enlace') {
    const v = validar(esquemaEnlace, leerCampos(datos, ['correo']));
    if (!v.ok) return { errores: v.errores };
    try {
      const supabase = await clienteServidor();
      const { error } = await supabase.auth.signInWithOtp({
        email: v.datos.correo,
        options: { shouldCreateUser: false, emailRedirectTo: urlCallback(siguiente), captchaToken },
      });
      if (error) {
        const visible = errorVisibleAlEnviarCorreo(error, 'enlace');
        if (visible) {
          registrar('enlace', error);
          return { mensaje: visible.mensaje };
        }
      }
    } catch (error) {
      return estadoDeExcepcion(error, 'enlace');
    }
    return { enviado: { tipo: 'enlace', correo: v.datos.correo } };
  }

  const v = validar(esquemaIngresar, leerCampos(datos, ['correo', 'clave']));
  if (!v.ok) return { errores: v.errores };
  try {
    const supabase = await clienteServidor();
    const { error } = await supabase.auth.signInWithPassword({
      email: v.datos.correo,
      password: v.datos.clave,
      options: { captchaToken },
    });
    if (error) {
      if (error.code !== 'invalid_credentials') registrar('ingresar', error);
      return estadoDeError(error, 'ingresar');
    }
  } catch (error) {
    return estadoDeExcepcion(error, 'ingresar');
  }
  // Fuera del try: redirect() lanza a propósito.
  redirect(siguiente);
}

/**
 * `/crear-cuenta`. `options.data.nombre` lo copia el trigger `tg_nuevo_usuario` a
 * `perfiles.nombre`. Con confirmación de correo activa no hay sesión: «Revisa tu correo».
 */
export async function crearCuenta(_previo: EstadoAuth, datos: FormData): Promise<EstadoAuth> {
  const siguiente = destinoSeguro(texto(datos, 'siguiente'));
  const v = validar(esquemaCrearCuenta, leerCampos(datos, ['nombre', 'correo', 'clave']));
  if (!v.ok) return { errores: v.errores };

  let conSesion = false;
  try {
    const supabase = await clienteServidor();
    const { data, error } = await supabase.auth.signUp({
      email: v.datos.correo,
      password: v.datos.clave,
      options: {
        data: { nombre: v.datos.nombre },
        emailRedirectTo: urlCallback(siguiente),
        captchaToken: captcha(datos),
      },
    });
    if (error) {
      registrar('crear-cuenta', error);
      return estadoDeError(error, 'crear-cuenta');
    }
    // Si el correo ya tenía cuenta y la confirmación está activa, Supabase responde
    // igual que con uno nuevo (sin sesión ni correo): se muestra lo mismo.
    conSesion = data.session !== null;
  } catch (error) {
    return estadoDeExcepcion(error, 'crear-cuenta');
  }

  if (conSesion) redirect(siguiente);
  return { enviado: { tipo: 'confirmacion', correo: v.datos.correo } };
}

/** `/recuperar`. Siempre la misma respuesta, exista o no la cuenta. */
export async function recuperar(_previo: EstadoAuth, datos: FormData): Promise<EstadoAuth> {
  const v = validar(esquemaRecuperar, leerCampos(datos, ['correo']));
  if (!v.ok) return { errores: v.errores };
  try {
    const supabase = await clienteServidor();
    const { error } = await supabase.auth.resetPasswordForEmail(v.datos.correo, {
      // En el flujo PKCE el tipo no viaja en el enlace: el callback necesita `siguiente`.
      redirectTo: urlCallback('/restablecer'),
      captchaToken: captcha(datos),
    });
    if (error) {
      const visible = errorVisibleAlEnviarCorreo(error, 'recuperar');
      if (visible) {
        registrar('recuperar', error);
        return { mensaje: visible.mensaje };
      }
    }
  } catch (error) {
    return estadoDeExcepcion(error, 'recuperar');
  }
  return { enviado: { tipo: 'recuperacion', correo: v.datos.correo } };
}

/** `/restablecer`. Requiere la sesión que abre el enlace de recuperación. */
export async function restablecer(_previo: EstadoAuth, datos: FormData): Promise<EstadoAuth> {
  const v = validar(esquemaRestablecer, leerCampos(datos, ['clave']));
  if (!v.ok) return { errores: v.errores };
  try {
    const supabase = await clienteServidor();
    const { data: sesion } = await supabase.auth.getClaims();
    if (!sesion?.claims.sub) return { sinSesion: true };

    const { error } = await supabase.auth.updateUser({ password: v.datos.clave });
    if (error) {
      registrar('restablecer', error);
      if (error.name === 'AuthSessionMissingError') return { sinSesion: true };
      return estadoDeError(error, 'restablecer');
    }
  } catch (error) {
    return estadoDeExcepcion(error, 'restablecer');
  }
  redirect(RUTA_BIENVENIDA);
}
