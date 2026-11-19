import { manejarApi, manejarLote } from '@/server/api-publica';

// `POST /api/v1/documentos/lote`: hasta 25 boletas como emisiones independientes (alcance
// `documentos:emitir`, `Idempotency-Key` obligatoria; cada boleta usa `<clave>#<n>`).
// PLAN-SAAS Fase 11. Ver `server/api-publica/lote.ts` para el presupuesto de tiempo.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export function POST(request: Request): Promise<Response> {
  return manejarApi(
    request,
    { ruta: 'POST /documentos/lote', alcance: 'documentos:emitir' },
    manejarLote,
  );
}
