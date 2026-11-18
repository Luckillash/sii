// Constantes de pagos compartidas con SQL (sincronizadas a mano):
// HORARIO_SUSCRIPCIONES = horario del job `sincronizar-suscripciones` de la migración
// 0017_cron_suscripciones (UTC) y del *cron monitor* de Sentry.

/** Cada hora, en el minuto 41 (no coincide con los demás jobs). */
export const HORARIO_SUSCRIPCIONES = '41 * * * *';
export const MONITOR_SUSCRIPCIONES = 'cron-suscripciones';
/** Suscripciones por corrida y tiempo máximo (el job espera 120 s). */
export const LIMITE_POR_CORRIDA = 200;
export const PRESUPUESTO_MS = 90_000;
