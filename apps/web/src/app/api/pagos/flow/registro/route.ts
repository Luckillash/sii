import * as Sentry from '@sentry/nextjs';
import { activarDespuesDeRegistro, dependenciasPagos } from '@/server/pagos';
import { leerTokenFlow } from '../token';

// Retorno del registro de tarjeta en Flow (PLAN-SAAS Fase 10). Flow devuelve el
// navegador con un POST desde flow.cl que trae solo `token`. Ese POST cruzado NO lleva
// las cookies de sesión (SameSite=Lax), así que esta ruta no depende de la sesión: el
// token se confirma con Flow (firmado), la organización sale del `customerId` y el plan
// de `clientes_pago.plan_pendiente_id`, que dejó un administrador con su sesión
// (`server/pagos/suscripciones.ts`). Después redirige con 303 (GET, con cookies) a la
// página de plan con el resultado en la query.
//
// `/api/*` es público para el proxy (`lib/rutas.ts`).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Varias llamadas a Flow (12 s de tope cada una): registro, plan, suscripción.
export const maxDuration = 60;

function volver(request: Request, slug: string | null, resultado: string): Response {
  const destino = slug
    ? `/${encodeURIComponent(slug)}/configuracion/plan?pago=${encodeURIComponent(resultado)}`
    : '/bienvenida';
  return Response.redirect(new URL(destino, request.url), 303);
}

async function manejar(request: Request): Promise<Response> {
  const token = await leerTokenFlow(request);
  if (!token) return volver(request, null, 'error');
  const deps = dependenciasPagos();
  if (!deps) return Response.json({ error: 'pasarela_sin_configurar' }, { status: 503 });
  try {
    const { slug, resultado } = await activarDespuesDeRegistro(deps, token, (mensaje, extra) =>
      Sentry.captureMessage(mensaje, { level: 'error', tags: { pasarela: 'flow' }, extra }),
    );
    if (resultado === 'error') {
      Sentry.captureMessage('pagos: retorno de registro con error', {
        level: 'warning',
        tags: { pasarela: 'flow' },
      });
    }
    return volver(request, slug, resultado);
  } catch (error) {
    Sentry.captureException(error);
    return volver(request, null, 'error');
  }
}

export const POST = manejar;
export const GET = manejar;
