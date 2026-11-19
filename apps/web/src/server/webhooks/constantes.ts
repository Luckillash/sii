import 'server-only';

// Constantes de la entrega de webhooks (PLAN-SAAS Fase 11). Las que también están en SQL
// van sincronizadas a mano: HORARIO_WEBHOOKS con el job `entregar-webhooks` (0019) y
// ARRIENDO_SEGUNDOS con el acotado de `reclamar_entregas_webhook` (0018, 30–900 s). Los
// intentos y las esperas entre ellos están en `lib/api-publica.ts` (MAX_INTENTOS_WEBHOOK,
// ESPERAS_WEBHOOK_MIN), espejo de `cerrar_entrega_webhook`.

/** Cada cuánto llama pg_cron a `/api/cron/webhooks` (UTC). Igual al job de la 0019. */
export const HORARIO_WEBHOOKS = '* * * * *';
/** Slug del *cron monitor* de Sentry. */
export const MONITOR_WEBHOOKS = 'cron-webhooks';

/** Entregas que se reclaman por corrida (la RPC acota a 1–100). */
export const LIMITE_RECLAMO = 32;
/**
 * Mientras una entrega está reclamada, su `siguiente_intento_en` queda en ahora + esto:
 * si la función muere, otra corrida la retoma pasado el arriendo (con un intento ya
 * contado). Tiene que superar el `maxDuration` de la ruta (60 s).
 */
export const ARRIENDO_SEGUNDOS = 120;
/** Entregas en paralelo. Con 32 reclamadas y 10 s de tope cada una, el peor caso es 40 s. */
export const CONCURRENCIA = 8;
/**
 * Después de esto no se empieza otra entrega (cada una puede tardar hasta 10 s y el
 * `maxDuration` es 60 s). Lo que queda sin empezar vuelve a salir al vencer el arriendo.
 */
export const PRESUPUESTO_MS = 45_000;
/** Bytes de la respuesta del receptor que se leen como máximo (el resto se descarta). */
export const MAXIMO_BYTES_RESPUESTA = 65_536;
/** Caracteres de la respuesta que se guardan en `webhook_entregas.ultima_respuesta`. */
export const LARGO_MAXIMO_RESPUESTA = 1000;

export const USER_AGENT = 'Boleteame-Webhooks/1.0 (+https://boleteame.dev/docs/api#webhooks)';
