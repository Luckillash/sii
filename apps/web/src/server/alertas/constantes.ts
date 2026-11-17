import 'server-only';

// Constantes de las alertas por correo de la Fase 8 (PLAN-SAAS §4.6). Las que también
// están en SQL van sincronizadas a mano: HORARIO_ALERTAS con el job `alertas` de la
// migración 0014, MAX_INTENTOS y MINUTOS_ABANDONADA con `reclamar_notificacion` (0013).

/** Cada cuánto llama pg_cron a `/api/cron/alertas` (UTC). Igual al job de la 0014. */
export const HORARIO_ALERTAS = '*/10 * * * *';
/** Slug del *cron monitor* de Sentry. */
export const MONITOR_ALERTAS = 'cron-alertas';

/** Tipos de aviso; con el formato de los eventos de webhook (`encolar_evento`). */
export const TIPO_RECHAZO = 'documento.rechazado';
export const TIPO_INCIERTO = 'envio.incierto';
export const TIPO_CERTIFICADO = 'certificado.por_vencer';

/**
 * Solo se avisan rechazos e inciertos de las últimas 48 h (por `actualizado_en`): al
 * estrenar las alertas no llegan correos por documentos de hace semanas, y 48 h cubren
 * de sobra una caída del cron o de Resend (la deduplicación la hace `notificaciones`,
 * no la ventana).
 */
export const VENTANA_HORAS = 48;

/** Días antes del vencimiento en que se avisa por un certificado, de mayor a menor. */
export const UMBRALES_CERTIFICADO = [30, 15, 7, 1] as const;
export type UmbralCertificado = (typeof UMBRALES_CERTIFICADO)[number];

/** Igual que en `reclamar_notificacion`: después de 5 intentos fallidos no se reintenta. */
export const MAX_INTENTOS = 5;
/** Igual que en `reclamar_notificacion`: una `pendiente` más vieja se da por abandonada. */
export const MINUTOS_ABANDONADA = 15;

/** Tope de filas por lectura y corrida: lo que quede, lo toma la siguiente. */
export const LIMITE_POR_LECTURA = 200;
/** Largo máximo del motivo del SII que se copia al correo. */
export const LARGO_MAXIMO_MOTIVO = 200;
/** Largo máximo de `notificaciones.error` (check de la 0013). */
export const LARGO_MAXIMO_ERROR = 500;

/**
 * Tope de correos por corrida. Con la pausa de abajo, 40 correos son ~24 s más lo que
 * tarde Resend: cabe en el `maxDuration` de 60 s. Lo que no alcanza queda sin reclamar y
 * sale en la corrida siguiente (las funciones de candidatos lo devuelven primero).
 */
export const MAX_CORREOS_POR_CORRIDA = 40;
/** Pausa entre correos: el límite por defecto de Resend es 2 peticiones por segundo. */
export const PAUSA_ENTRE_CORREOS_MS = 600;
/** Después de esto no se empieza otro correo (cada envío puede tardar hasta 10 s). */
export const PRESUPUESTO_MS = 40_000;
