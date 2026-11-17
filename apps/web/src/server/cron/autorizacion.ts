import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { envCron } from '@/server/env';

// Base común de las rutas /api/cron/* (PLAN-SAAS §4.4 y §4.8). pg_cron + pg_net las
// llaman con `Authorization: Bearer <cron_token de Vault>`, que es igual a CRON_SECRET.

export type ResultadoAutorizacion = 'ok' | 'sin_configurar' | 'no_autorizado';

/** Compara el Bearer con CRON_SECRET en tiempo constante (hash de ambos lados). */
export function autorizarCron(
  cabeceras: Headers,
  secreto: string | null = envCron()?.CRON_SECRET ?? null,
): ResultadoAutorizacion {
  if (!secreto) return 'sin_configurar';
  const cabecera = cabeceras.get('authorization') ?? '';
  const [esquema, valor] = cabecera.split(' ', 2);
  if (esquema !== 'Bearer' || !valor) return 'no_autorizado';
  const a = createHash('sha256').update(valor).digest();
  const b = createHash('sha256').update(secreto).digest();
  return timingSafeEqual(a, b) ? 'ok' : 'no_autorizado';
}

/** Respuesta para una autorización fallida; `null` si está autorizada. */
export function rechazoCron(resultado: ResultadoAutorizacion): Response | null {
  if (resultado === 'ok') return null;
  if (resultado === 'sin_configurar') {
    return Response.json({ error: 'cron_sin_configurar' }, { status: 503 });
  }
  return Response.json({ error: 'no_autorizado' }, { status: 401 });
}

/**
 * Ejecuta el trabajo de un cron dentro de un *cron monitor* de Sentry (check-in
 * `in_progress` → `ok`/`error`), que avisa si el cron deja de correr o falla.
 */
export function conMonitorCron<T>(
  slug: string,
  horario: string,
  trabajo: () => Promise<T>,
  opciones: { maxMinutos?: number } = {},
): Promise<T> {
  return Sentry.withMonitor(slug, trabajo, {
    schedule: { type: 'crontab', value: horario },
    checkinMargin: 2,
    maxRuntime: opciones.maxMinutos ?? 5,
    timezone: 'UTC',
  });
}
