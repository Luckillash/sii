import { manejarApi, manejarArchivo } from '@/server/api-publica';

// `GET /api/v1/documentos/{id}/xml`: el DTE firmado (ISO-8859-1), como adjunto (alcance
// `documentos:leer`). PLAN-SAAS Fase 11.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return manejarApi(
    request,
    { ruta: 'GET /documentos/{id}/xml', alcance: 'documentos:leer' },
    (ctx) => manejarArchivo(ctx, id, 'xml'),
  );
}
