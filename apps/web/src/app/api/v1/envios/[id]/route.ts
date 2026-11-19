import { manejarApi, manejarEnvio } from '@/server/api-publica';

// `GET /api/v1/envios/{id}`: estado del envío al SII, con sus documentos y los rechazos o
// reparos (alcance `envios:leer`). PLAN-SAAS Fase 11.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return manejarApi(request, { ruta: 'GET /envios/{id}', alcance: 'envios:leer' }, (ctx) =>
    manejarEnvio(ctx, id),
  );
}
