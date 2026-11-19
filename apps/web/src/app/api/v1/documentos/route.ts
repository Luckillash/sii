import { manejarApi, manejarEmision, manejarListado } from '@/server/api-publica';

// `POST /api/v1/documentos` emite una boleta (alcance `documentos:emitir`, cabecera
// `Idempotency-Key` obligatoria; `?ensayo=1` valida y resume sin emitir) y
// `GET /api/v1/documentos` las lista (alcance `documentos:leer`). PLAN-SAAS Fase 11.
// `/api/*` es público para el proxy (`lib/rutas.ts`): la autorización es la API key.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una emisión: token, folio, firma, Storage y el envío REST al SII (hasta 45 s).
export const maxDuration = 60;

export function POST(request: Request): Promise<Response> {
  return manejarApi(
    request,
    { ruta: 'POST /documentos', alcance: 'documentos:emitir' },
    manejarEmision,
  );
}

export function GET(request: Request): Promise<Response> {
  return manejarApi(
    request,
    { ruta: 'GET /documentos', alcance: 'documentos:leer' },
    manejarListado,
  );
}
