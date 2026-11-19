import { manejarApi, manejarSolicitudFolios } from '@/server/api-publica';

// `POST /api/v1/folios/solicitudes`: pedir folios (CAF) al SII en tres niveles, `ensayo`,
// `revision` y `timbrar` (alcance `folios:solicitar`; `Idempotency-Key` obligatoria al
// timbrar; en producción la revisión es obligatoria antes de timbrar). PLAN-SAAS Fase 11.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Asistente `of_*` del SII: varias peticiones de hasta 45 s cada una (como `/[org]/folios`).
export const maxDuration = 300;

export function POST(request: Request): Promise<Response> {
  return manejarApi(
    request,
    { ruta: 'POST /folios/solicitudes', alcance: 'folios:solicitar' },
    manejarSolicitudFolios,
  );
}
