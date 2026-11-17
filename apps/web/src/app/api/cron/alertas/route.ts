import * as Sentry from '@sentry/nextjs';
import { ejecutarAlertas } from '@/server/alertas';
import { HORARIO_ALERTAS, MONITOR_ALERTAS } from '@/server/alertas/constantes';
import { autorizarCron, conMonitorCron, rechazoCron } from '@/server/cron/autorizacion';

// Alertas por correo (PLAN-SAAS Fase 8, §4.6): documento rechazado, envío incierto y
// certificado por vencer. La llama pg_cron cada 10 minutos (job `alertas`, migración
// 0014) con `net.http_post` y `Authorization: Bearer <cron_token>` (= CRON_SECRET). GET
// queda para probarla a mano con el mismo Bearer. `/api/*` es público para el proxy
// (`lib/rutas.ts`): la autorización es solo el Bearer.
//
// Responde el `ResumenAlertas` (conteos y si el correo está configurado): nunca correos,
// RUT, ids ni mensajes de error. El detalle queda en `notificaciones`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Pocas lecturas y unos cuantos POST a Resend (10 s de tope cada uno); el job de la 0014
// espera la respuesta 60 s (`timeout_milliseconds`).
export const maxDuration = 60;

async function manejar(request: Request): Promise<Response> {
  const rechazo = rechazoCron(autorizarCron(request.headers));
  if (rechazo) return rechazo;
  try {
    const resumen = await conMonitorCron(
      MONITOR_ALERTAS,
      HORARIO_ALERTAS,
      () => ejecutarAlertas(),
      {
        maxMinutos: 2,
      },
    );
    // Una categoría con error no tumba la corrida (las demás siguen), pero se avisa: si
    // la base falla en cada corrida, el monitor seguiría en verde sin esto.
    const conError = (['rechazos', 'inciertos', 'certificados'] as const).filter(
      (c) => resumen[c].error,
    );
    if (conError.length > 0) {
      Sentry.captureMessage('alertas: corrida con errores', {
        level: 'warning',
        tags: { cron: MONITOR_ALERTAS },
        extra: { categorias: conError },
      });
    }
    return Response.json(resumen, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Solo llega aquí si falla armar las dependencias (p. ej. falta SUPABASE_SECRET_KEY):
    // `ejecutarAlertas` no lanza. El *cron monitor* ya quedó en error y la excepción va a
    // Sentry (que depura en beforeSend); al que llama, nada del detalle.
    Sentry.captureException(error);
    return Response.json({ error: 'alertas_fallidas' }, { status: 500 });
  }
}

export const POST = manejar;
export const GET = manejar;
