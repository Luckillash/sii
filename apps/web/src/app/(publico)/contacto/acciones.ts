'use server';

import * as Sentry from '@sentry/nextjs';
import { headers } from 'next/headers';
import { urlSitio } from '@/lib/sitio';
import { enviarMensajeContacto } from '@/server/correo/contacto';
import { envContacto, envCorreo, envTurnstile } from '@/server/env';
import {
  type EsperadoTurnstile,
  ipCliente,
  MOTIVOS_TURNSTILE,
  verificarTurnstile,
} from '@/server/turnstile';
import {
  ACCION_TURNSTILE_CONTACTO,
  ASUNTO_MOTIVO,
  CAMPO_TRAMPA,
  type ErroresContacto,
  ETIQUETA_MOTIVO,
  leerCamposContacto,
  validarContacto,
} from './esquema';

// Formulario de contacto del sitio público (PLAN-SAAS Fase 12, punto 4; §4.6 y §4.7).
// Público, sin sesión. Orden: campo trampa (un bot recibe «enviado» y no pasa nada),
// validación con zod, Turnstile en el servidor con la IP, la `action` y (en producción)
// el hostname, configuración y envío por Resend a CORREO_CONTACTO con `reply_to` de la
// persona. Un solo correo: no hay acuse a la persona (ver `server/correo/contacto.ts`).
//
// Turnstile falla cerrado en producción: sin TURNSTILE_SECRET_KEY el formulario responde
// «no disponible» en vez de quedar abierto a bots. En local y desarrollo sigue abierto
// (`verificarTurnstile` deja pasar sin clave), como en las invitaciones.
//
// Logs y Sentry: solo el motivo de la falla y el estado HTTP. Nunca el nombre, el
// correo, la empresa, el RUT ni el mensaje (tampoco el detalle de Resend, que podría
// citar una dirección). Los campos del formulario ya los filtra `lib/sentry/depurar.ts`
// (`server_action_form_data.*`).
//
// Pendiente fuera del código: una regla de *rate limit* del Firewall de Vercel por IP,
// además de Turnstile. Ojo: Next reenvía una Server Action desde cualquier ruta (basta la
// cabecera `Next-Action`), así que la regla no puede ser «POST a /contacto»: tiene que
// cubrir los POST con `Next-Action` (o todos los POST de páginas).

export interface MensajeError {
  titulo: string;
  detalle: string;
}

export type EstadoContacto =
  | { ok: true }
  | {
      ok: false;
      error: MensajeError;
      errores?: ErroresContacto;
    };

const REVISA_CAMPOS: MensajeError = {
  titulo: 'Revisa los datos del formulario',
  detalle: 'Corrige los campos marcados y vuelve a enviarlo.',
};

const NO_DISPONIBLE: MensajeError = {
  titulo: 'No pudimos enviar tu mensaje',
  detalle:
    'El formulario de contacto no está disponible en este momento. Escríbenos más tarde; lo que escribiste sigue en el formulario.',
};

const FALLA_ENVIO: MensajeError = {
  titulo: 'No pudimos enviar tu mensaje',
  detalle:
    'Hubo un problema al enviarlo. Espera unos minutos y vuelve a intentarlo; lo que escribiste sigue en el formulario.',
};

const TURNSTILE_NO_DISPONIBLE: MensajeError = {
  titulo: 'No pudimos enviar tu mensaje',
  detalle: MOTIVOS_TURNSTILE.noDisponible,
};

const ETIQUETA_SENTRY = { formulario: 'contacto' } as const;

function enProduccion(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

/** Qué debe traer la respuesta de Turnstile: la `action` siempre; el hostname, en producción. */
function esperadoTurnstile(): EsperadoTurnstile {
  if (!enProduccion()) return { accion: ACCION_TURNSTILE_CONTACTO };
  return { accion: ACCION_TURNSTILE_CONTACTO, hostname: new URL(urlSitio()).hostname };
}

export async function enviarContacto(
  _anterior: EstadoContacto | null,
  formulario: FormData,
): Promise<EstadoContacto> {
  // Campo trampa lleno: se responde como si hubiera salido, sin verificar ni enviar.
  const trampa = formulario.get(CAMPO_TRAMPA);
  if (typeof trampa === 'string' && trampa.trim() !== '') return { ok: true };

  const valores = leerCamposContacto(formulario);
  const validacion = validarContacto(valores);
  if (!validacion.ok) {
    return { ok: false, error: REVISA_CAMPOS, errores: validacion.errores };
  }
  const datos = validacion.datos;

  if (!envTurnstile() && enProduccion()) {
    // Falla cerrado: sin clave en producción el formulario quedaría abierto a bots.
    console.error('contacto: Turnstile sin configurar en producción');
    Sentry.captureMessage('contacto: Turnstile sin configurar en producción', {
      level: 'error',
      tags: ETIQUETA_SENTRY,
      extra: { faltan: ['TURNSTILE_SECRET_KEY'] },
    });
    return { ok: false, error: TURNSTILE_NO_DISPONIBLE };
  }

  const captcha = formulario.get('captcha');
  const verificacion = await verificarTurnstile(
    typeof captcha === 'string' ? captcha : null,
    ipCliente(await headers()),
    esperadoTurnstile(),
  );
  if (!verificacion.ok) {
    return {
      ok: false,
      error: { titulo: 'Falta la verificación de seguridad', detalle: verificacion.motivo },
    };
  }

  const correo = envCorreo();
  const contacto = envContacto();
  if (!correo || !contacto) {
    // Solo los nombres de las variables que faltan, nunca sus valores.
    const faltan = [
      ...(correo ? [] : ['RESEND_API_KEY o CORREO_REMITENTE']),
      ...(contacto ? [] : ['CORREO_CONTACTO']),
    ];
    console.error('contacto: formulario sin configuración', { faltan });
    Sentry.captureMessage('contacto: formulario sin configuración', {
      level: 'error',
      tags: ETIQUETA_SENTRY,
      extra: { faltan },
    });
    return { ok: false, error: NO_DISPONIBLE };
  }

  const principal = await enviarMensajeContacto(
    {
      motivo: ETIQUETA_MOTIVO[datos.motivo],
      motivoAsunto: ASUNTO_MOTIVO[datos.motivo],
      nombre: datos.nombre,
      correo: datos.correo,
      empresa: datos.empresa,
      rut: datos.rut,
      mensaje: datos.mensaje,
    },
    contacto.CORREO_CONTACTO,
    { configuracion: correo },
  );

  if (!principal.ok) {
    const registro = { motivo: principal.motivo, estado: principal.estado ?? null };
    console.error('contacto: no se pudo enviar el mensaje', registro);
    Sentry.captureMessage('contacto: no se pudo enviar el mensaje', {
      level: 'error',
      tags: { ...ETIQUETA_SENTRY, motivo_falla: principal.motivo },
      extra: registro,
    });
    return {
      ok: false,
      error: principal.motivo === 'sin_configuracion' ? NO_DISPONIBLE : FALLA_ENVIO,
    };
  }

  return { ok: true };
}
