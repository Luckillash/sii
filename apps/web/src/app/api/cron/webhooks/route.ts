import * as Sentry from '@sentry/nextjs';
import { autorizarCron, conMonitorCron, rechazoCron } from '@/server/cron/autorizacion';
import { ejecutarEntregas } from '@/server/webhooks';
import { HORARIO_WEBHOOKS, MONITOR_WEBHOOKS } from '@/server/webhooks/constantes';

// Entrega de webhooks (PLAN-SAAS Fase 11): manda las filas pendientes de
// `webhook_entregas`, firmadas con HMAC-SHA256. La llama pg_cron cada minuto (job
// `entregar-webhooks`, migración 0019) con `net.http_post` y `Authorization: Bearer
// <cron_token>` (= CRON_SECRET). GET queda para probarla a mano con el mismo Bearer.
// `/api/*` es público para el proxy (`lib/rutas.ts`): la autorización es solo el Bearer.
//
// Responde solo conteos: nunca URL, secretos, cuerpos ni respuestas de los receptores.
// El detalle queda en `webhook_entregas`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hasta 32 entregas, 8 en paralelo y 10 s de tope cada una (ninguna nueva después de
// 45 s); el job de la 0019 espera la respuesta 60 s (`timeout_milliseconds`).
export const maxDuration = 60;

async function manejar(request: Request): Promise<Response> {
  const rechazo = rechazoCron(autorizarCron(request.headers));
  if (rechazo) return rechazo;
  try {
    const resumen = await conMonitorCron(
      MONITOR_WEBHOOKS,
      HORARIO_WEBHOOKS,
      () => ejecutarEntregas(),
      { maxMinutos: 2 },
    );
    // Los receptores que fallan son normales (se reintentan); `errores` son fallas
    // nuestras (Vault, cierre, reclamo). Cada una ya dejó su aviso; este resume la corrida
    // para que un error que se repite no pase inadvertido con el monitor en verde.
    if (resumen.errores > 0) {
      Sentry.captureMessage('webhooks: corrida con errores', {
        level: 'warning',
        tags: { cron: MONITOR_WEBHOOKS },
        extra: { errores: resumen.errores, reclamadas: resumen.reclamadas },
      });
    }
    return Response.json(resumen, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Solo llega aquí si falla armar las dependencias (p. ej. falta SUPABASE_SECRET_KEY):
    // `ejecutarEntregas` no lanza. El *cron monitor* ya quedó en error.
    Sentry.captureException(error);
    return Response.json({ error: 'webhooks_fallidos' }, { status: 500 });
  }
}

export const POST = manejar;
export const GET = manejar;
