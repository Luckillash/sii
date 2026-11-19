import { manejarApi, manejarDocumento } from '@/server/api-publica';

// `GET /api/v1/documentos/{id}`: la boleta con sus líneas y su envío (alcance
// `documentos:leer`). PLAN-SAAS Fase 11. Una boleta de otro ambiente, otra empresa u otra
// organización que la de la clave es 404.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return manejarApi(request, { ruta: 'GET /documentos/{id}', alcance: 'documentos:leer' }, (ctx) =>
    manejarDocumento(ctx, id),
  );
}
