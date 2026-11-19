import { ESPECIFICACION_V1 } from '@/lib/openapi-v1';

// Especificación OpenAPI 3.1 de la API pública (PLAN-SAAS Fase 11). Pública, sin API key.
// La carpeta se llama `openapi.json` a propósito: Next acepta segmentos con punto
// (`app/rss.xml/route.ts` en la guía de Route Handlers).

export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json(ESPECIFICACION_V1, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
