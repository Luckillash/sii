import * as Sentry from '@sentry/nextjs';
import { HORARIO_SEGUIMIENTO, MONITOR_SEGUIMIENTO } from '@/lib/seguimiento';
import { autorizarCron, conMonitorCron, rechazoCron } from '@/server/cron/autorizacion';
import { ejecutarSeguimiento } from '@/server/seguimiento';

// Seguimiento de envíos (PLAN-SAAS Fase 8). Lo llama pg_cron cada 5 minutos con
// `net.http_post` y `Authorization: Bearer <cron_token>` (= CRON_SECRET). GET queda para
// probarlo a mano con el mismo Bearer. `/api/*` es público para el proxy (`lib/rutas.ts`):
// la autorización es solo el Bearer.
//
// La respuesta es el `ResumenSeguimiento` (conteos): nunca tokens, RUT, Track ID ni
// mensajes de error. El detalle queda en `operaciones_sii` y `consultas_envio`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Ver LIMITE_MS en server/seguimiento/cron.ts: no empieza un paso cuyo peor caso pase de 280 s.
export const maxDuration = 300;

async function manejar(request: Request): Promise<Response> {
  const rechazo = rechazoCron(autorizarCron(request.headers));
  if (rechazo) return rechazo;
  try {
    const resumen = await conMonitorCron(MONITOR_SEGUIMIENTO, HORARIO_SEGUIMIENTO, () =>
      ejecutarSeguimiento(),
    );
    return Response.json(resumen, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // El *cron monitor* ya quedó en error; la excepción va a Sentry (que depura en
    // beforeSend). Al que llama, nada del detalle.
    Sentry.captureException(error);
    return Response.json({ error: 'seguimiento_fallido' }, { status: 500 });
  }
}

export const POST = manejar;
export const GET = manejar;
