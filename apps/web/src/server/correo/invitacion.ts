import 'server-only';
import { createHash } from 'node:crypto';
import { correoInvitacion } from '@sii/correos';
import { enviarCorreo, type OpcionesEnvio, type ResultadoEnvio } from './resend';

// Envío del correo de invitación. El token llega una sola vez desde
// `crear_invitacion()`: se usa para armar el enlace y nada más (ni logs ni Sentry).

export interface DatosEnvioInvitacion {
  token: string;
  /** Origen público de la app, sin barra final (`NEXT_PUBLIC_APP_URL`). */
  urlApp: string;
  correo: string;
  organizacion: string;
  /** Rol como se muestra («Emisor»). */
  rol: string;
  invitadoPor: string | null;
  expiraEn: Date;
}

export function enlaceInvitacion(urlApp: string, token: string): string {
  return `${urlApp.replace(/\/+$/, '')}/invitacion/${encodeURIComponent(token)}`;
}

/**
 * `Idempotency-Key` de una invitación: derivada del token con sha256 (la misma
 * invitación no sale dos veces; un reenvío crea un token nuevo y sí sale). Es el mismo
 * hash que guarda la base, que no permite recuperar el token.
 */
export function claveIdempotenciaInvitacion(token: string): string {
  return `invitacion/${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

export async function enviarInvitacion(
  datos: DatosEnvioInvitacion,
  opciones?: OpcionesEnvio,
): Promise<{ enlace: string; envio: ResultadoEnvio }> {
  const enlace = enlaceInvitacion(datos.urlApp, datos.token);
  const correo = correoInvitacion({
    organizacion: datos.organizacion,
    rol: datos.rol,
    invitadoPor: datos.invitadoPor,
    correo: datos.correo,
    enlace,
    expiraEn: datos.expiraEn,
  });
  const envio = await enviarCorreo(
    {
      para: datos.correo,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: claveIdempotenciaInvitacion(datos.token),
    },
    opciones,
  );
  return { enlace, envio };
}
