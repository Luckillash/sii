import 'server-only';
import { createHash } from 'node:crypto';
import { correoContacto } from '@sii/correos';
import { enviarCorreo, type OpcionesEnvio, type ResultadoEnvio } from './resend';

// Envío del formulario de contacto del sitio público (PLAN-SAAS Fase 12, punto 4): un
// solo correo, al buzón del equipo (`CORREO_CONTACTO`, con `reply_to` de la persona).
// No hay acuse a la persona: el correo de destino lo escribe cualquiera en un formulario
// público, y un acuse automático nos convertiría en *relay* de spam con el mismo
// remitente de Auth (y su reputación). Nada de lo que escribió la persona (ni su correo)
// va a logs ni a Sentry: quien llama registra solo el motivo de la falla.

export interface MensajeContacto {
  /** Etiqueta del motivo («Ventas / plan Empresa»). */
  motivo: string;
  /** Versión corta para el asunto («Ventas»). */
  motivoAsunto: string;
  nombre: string;
  /** Ya normalizado por el esquema (sin espacios y en minúsculas). */
  correo: string;
  empresa: string | null;
  /** RUT ya validado y formateado. */
  rut: string | null;
  mensaje: string;
}

/**
 * `Idempotency-Key` del mensaje: sha256 del destinatario y del contenido. Un doble clic,
 * o reenviar lo mismo tras un error de red con un token de Turnstile nuevo, no llega dos
 * veces al equipo (Resend guarda la clave 24 h y devuelve el mismo id). El destinatario
 * va en el hash porque Resend rechaza una clave repetida con otro cuerpo: si cambia
 * `CORREO_CONTACTO`, la clave cambia con él. El hash no permite recuperar el contenido, y
 * el cuerpo del correo no lleva la hora para que la misma clave lleve siempre el mismo
 * contenido. El correo de la persona llega ya normalizado: el mismo valor va en
 * `reply_to` y en el hash.
 */
export function claveIdempotenciaContacto(mensaje: MensajeContacto, destino: string): string {
  const contenido = JSON.stringify([
    destino.trim().toLowerCase(),
    mensaje.motivo,
    mensaje.nombre,
    mensaje.correo,
    mensaje.empresa ?? '',
    mensaje.rut ?? '',
    mensaje.mensaje,
  ]);
  return `contacto/${createHash('sha256').update(contenido, 'utf8').digest('hex')}`;
}

export async function enviarMensajeContacto(
  mensaje: MensajeContacto,
  destino: string,
  opciones?: OpcionesEnvio,
): Promise<ResultadoEnvio> {
  const correo = correoContacto({
    motivo: mensaje.motivo,
    motivoAsunto: mensaje.motivoAsunto,
    nombre: mensaje.nombre,
    correo: mensaje.correo,
    empresa: mensaje.empresa,
    rut: mensaje.rut,
    mensaje: mensaje.mensaje,
  });
  return enviarCorreo(
    {
      para: destino,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: claveIdempotenciaContacto(mensaje, destino),
      responderA: mensaje.correo,
    },
    opciones,
  );
}
