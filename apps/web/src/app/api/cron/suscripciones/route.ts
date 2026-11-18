import * as Sentry from '@sentry/nextjs';
import { autorizarCron, conMonitorCron, rechazoCron } from '@/server/cron/autorizacion';
import { dependenciasPagos, sincronizarTodas } from '@/server/pagos';
import { avisarMorosas } from '@/server/pagos/avisos';
import {
  HORARIO_SUSCRIPCIONES,
  LIMITE_POR_CORRIDA,
  MONITOR_SUSCRIPCIONES,
  PRESUPUESTO_MS,
} from '@/server/pagos/constantes';

// Sincronización de suscripciones con Flow (PLAN-SAAS Fase 10). La llama pg_cron cada
// hora (job `sincronizar-suscripciones`, migración 0017) con el Bearer de `cron_token`.
// Flow no avisa los cobros fallidos ni el fin de una cancelación: esta corrida trae de
// Flow el estado de cada suscripción vigente (mora → `morosa`, al día → `activa`,
// cancelada → vuelve al plan Certificación), guarda los importes en `pagos` y avisa por
// correo las que quedaron morosas. También repara lo que se perdió en el callback.
//
// Responde solo conteos.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function manejar(request: Request): Promise<Response> {
  const rechazo = rechazoCron(autorizarCron(request.headers));
  if (rechazo) return rechazo;
  const deps = dependenciasPagos();
  if (!deps) return Response.json({ error: 'pasarela_sin_configurar' }, { status: 503 });
  try {
    const resumen = await conMonitorCron(
      MONITOR_SUSCRIPCIONES,
      HORARIO_SUSCRIPCIONES,
      async () => {
        const sync = await sincronizarTodas(deps, {
          limite: LIMITE_POR_CORRIDA,
          presupuestoMs: PRESUPUESTO_MS,
        });
        const avisos = await avisarMorosas(deps.db, sync.resultados);
        return { ...sync, resultados: undefined, avisos };
      },
      { maxMinutos: 3 },
    );
    if (resumen.errores > 0) {
      Sentry.captureMessage('suscripciones: corrida con errores', {
        level: 'warning',
        tags: { cron: MONITOR_SUSCRIPCIONES },
        extra: { errores: resumen.errores },
      });
    }
    return Response.json(resumen, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    Sentry.captureException(error);
    return Response.json({ error: 'suscripciones_fallidas' }, { status: 500 });
  }
}

export const POST = manejar;
export const GET = manejar;
