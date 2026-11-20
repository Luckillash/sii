import { urlReporteSentry } from '@/lib/cabeceras-seguridad';
// RUTA_REPORTE_CSP (lib/cabeceras-seguridad.ts) debe coincidir con esta carpeta: lo
// comprueba route.test.ts.
import { sanearReporteCsp, TAMANO_MAXIMO_REPORTE } from '@/lib/reporte-csp';
import { urlSitio } from '@/lib/sitio';

// Reportes de CSP (`report-uri` = `RUTA_REPORTE_CSP` de `lib/cabeceras-seguridad.ts`,
// PLAN-SAAS Fase 13). El
// navegador los manda aquí (mismo origen, sin que los frene un bloqueador) y la ruta los
// reenvía al endpoint de seguridad de Sentry desde el servidor, saneados
// (`lib/reporte-csp.ts`). Sin cookies ni IP de la persona: Sentry ve la IP del servidor.
// `/api/*` es público para el proxy (`lib/rutas.ts`).
//
// Siempre responde sin cuerpo: 204 si se aceptó (o si se descartó por ajeno o porque falta
// el DSN), 413 si es demasiado grande y 415 si no es `application/csp-report`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPOS = new Set(['application/csp-report', 'application/json']);

export async function POST(request: Request): Promise<Response> {
  const tipo = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (!tipo || !TIPOS.has(tipo)) return new Response(null, { status: 415 });

  const largo = Number(request.headers.get('content-length') ?? '0');
  if (largo > TAMANO_MAXIMO_REPORTE) return new Response(null, { status: 413 });
  const texto = await request.text();
  if (texto.length > TAMANO_MAXIMO_REPORTE) return new Response(null, { status: 413 });

  const reporte = sanearReporteCsp(texto, urlSitio());
  const destino = urlReporteSentry(
    process.env.NEXT_PUBLIC_SENTRY_DSN,
    process.env.NEXT_PUBLIC_VERCEL_ENV,
  );
  if (!reporte || !destino) return new Response(null, { status: 204 });

  const agente = request.headers.get('user-agent');
  try {
    await fetch(destino, {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        // Sentry deduce el navegador del User-Agent (etiqueta `browser`).
        ...(agente ? { 'user-agent': agente.slice(0, 512) } : {}),
      },
      body: JSON.stringify({ 'csp-report': reporte }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Un reporte perdido no es un error de la app: no se registra (sería ruido en bucle).
  }
  return new Response(null, { status: 204 });
}
