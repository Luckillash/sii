import * as Sentry from '@sentry/nextjs';
import { dependenciasPagos, procesarAvisoPago } from '@/server/pagos';
import { leerTokenFlow } from '../token';

// Callback de los planes de Flow (`urlCallback`, PLAN-SAAS Fase 10): Flow avisa cada
// pago de una suscripción con un POST servidor a servidor que trae solo `token`. No viene
// firmado: la autenticidad la da consultar el pago con ese token por la API firmada
// (`payment/getStatus`). Hay que responder 200 en menos de 15 s; si no, Flow manda un
// correo de «problema de integración» (el estado del pago no cambia). El cron
// `/api/cron/suscripciones` reconcilia igual lo que se pierda aquí.
//
// Responde solo `{ ok }`: nada del pago ni de la organización.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  const token = await leerTokenFlow(request);
  if (!token) return Response.json({ ok: false }, { status: 400 });
  const deps = dependenciasPagos();
  if (!deps) return Response.json({ ok: false }, { status: 503 });
  try {
    const resultado = await procesarAvisoPago(deps, token);
    if (resultado.estado === 'fallido') {
      Sentry.captureMessage('pagos: aviso de pago no procesado', {
        level: 'warning',
        tags: { pasarela: 'flow' },
      });
    }
  } catch (error) {
    Sentry.captureException(error);
  }
  // 200 siempre que el token sea válido: el aviso queda en `eventos_pasarela` y el cron
  // vuelve a sincronizar. Un 5xx solo haría que Flow alerte, sin reintentar el estado.
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
