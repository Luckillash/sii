import type { MensajeError } from '@/server/equipo-errores';
import type { Database } from '@/server/supabase/tipos';

// Contrato de la Fase 8 (seguimiento de envíos) entre `server/seguimiento/` y la UI de
// `/[org]/documentos` y `/[org]/envios/[id]`. Sin `server-only`: lo importan ambos lados.

export type ClasificacionEnvio = Database['public']['Enums']['clasificacion_envio'];

/** Cada cuánto corre `/api/cron/seguimiento` (pg_cron, UTC). */
export const HORARIO_SEGUIMIENTO = '*/5 * * * *';
/** Slug del *cron monitor* de Sentry del seguimiento. */
export const MONITOR_SEGUIMIENTO = 'cron-seguimiento';

/**
 * Resultado de «Consultar estado en el SII» desde el panel (un envío, a pedido).
 * `consultado` = el SII respondió y se guardó la consulta (aunque el estado no cambie).
 * `sin_track_id` = el envío es incierto o nunca llegó: no hay nada que consultar.
 * `final` = el envío ya tiene estado final (EPR o rechazo): no se vuelve a consultar.
 * `error` = falla de red/HTTP o configuración; se registra en `consultas_envio.error`.
 */
export type ResultadoConsultaEnvio =
  | {
      tipo: 'consultado';
      estadoSii: string | null;
      glosaSii: string | null;
      clasificacion: ClasificacionEnvio;
      cambio: boolean;
    }
  | { tipo: 'sin_track_id'; mensaje: MensajeError }
  | { tipo: 'final'; clasificacion: ClasificacionEnvio }
  | { tipo: 'error'; mensaje: MensajeError };

/** Resumen de una corrida del cron (lo devuelve la ruta y lo audita Sentry). */
export interface ResumenSeguimiento {
  envios: number;
  consultados: number;
  cambiados: number;
  errores: number;
  /** Grupos (empresa+ambiente+canal) sin token o sin certificado; se reintentan en la próxima corrida. */
  gruposOmitidos: number;
  /**
   * Envíos elegidos que no se alcanzaron a consultar (se acabó el tiempo de la corrida o
   * el SII siguió rechazando el token renovado); quedan para la próxima corrida.
   */
  postergados?: number;
}
