import { formatoPdf, manejarApi, manejarArchivo } from '@/server/api-publica';

// `GET /api/v1/documentos/{id}/pdf?formato=carta|rollo`: la representación impresa con el
// PDF417 del timbre, como adjunto (alcance `documentos:leer`; carta por defecto). Si el PDF
// falta, se regenera. PLAN-SAAS Fase 11.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Regenerar un PDF que falta (pdfkit + bwip-js) y subirlo a Storage.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return manejarApi(
    request,
    { ruta: 'GET /documentos/{id}/pdf', alcance: 'documentos:leer' },
    (ctx) => manejarArchivo(ctx, id, formatoPdf(new URL(request.url).searchParams.get('formato'))),
  );
}
