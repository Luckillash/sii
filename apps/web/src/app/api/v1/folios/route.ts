import { manejarApi, manejarFolios } from '@/server/api-publica';

// `GET /api/v1/folios?empresa=&tipo_dte=`: folios disponibles por tipo en el ambiente de
// la clave, con sus CAF (alcance `folios:leer`). PLAN-SAAS Fase 11.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(request: Request): Promise<Response> {
  return manejarApi(request, { ruta: 'GET /folios', alcance: 'folios:leer' }, manejarFolios);
}
