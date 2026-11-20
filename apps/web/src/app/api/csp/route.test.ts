import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUTA_REPORTE_CSP } from '@/lib/cabeceras-seguridad';
import { POST } from './route';

const DSN = 'https://abc123@o4500000000000000.ingest.us.sentry.io/4500000000000001';

function peticion(
  cuerpo: string,
  tipo = 'application/csp-report',
  extra: Record<string, string> = {},
) {
  return new Request('https://boleteame.dev/api/csp', {
    method: 'POST',
    headers: {
      'content-type': tipo,
      'user-agent': 'Chrome/140',
      cookie: 'sb-sesion=secreta',
      ...extra,
    },
    body: cuerpo,
  });
}

const REPORTE = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://boleteame.dev/servicio/tablero?x=1',
    'violated-directive': 'script-src-elem',
    'blocked-uri': 'https://malo.example/x.js',
    disposition: 'enforce',
  },
});

describe('POST /api/csp', () => {
  const fetchFalso = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN);
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://boleteame.dev');
    vi.stubGlobal('fetch', fetchFalso);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchFalso.mockClear();
  });

  it('la carpeta de la ruta coincide con RUTA_REPORTE_CSP', () => {
    expect(RUTA_REPORTE_CSP).toBe('/api/csp');
    expect(existsSync(join(__dirname, 'route.ts'))).toBe(true);
    expect(__dirname.replace(/\\/g, '/').endsWith('/app/api/csp')).toBe(true);
  });

  it('reenvía a Sentry el reporte saneado, sin cookies, y responde 204', async () => {
    const r = await POST(peticion(REPORTE));
    expect(r.status).toBe(204);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://o4500000000000000.ingest.us.sentry.io/api/4500000000000001/security/?sentry_key=abc123&sentry_environment=production',
    );
    const cabeceras = init.headers as Record<string, string>;
    expect(cabeceras['content-type']).toBe('application/csp-report');
    expect(cabeceras['user-agent']).toBe('Chrome/140');
    expect(JSON.stringify(cabeceras)).not.toContain('secreta');
    const enviado = JSON.parse(String(init.body))['csp-report'];
    expect(enviado['document-uri']).toBe('https://boleteame.dev/servicio/tablero');
    expect(enviado['violated-directive']).toBe('script-src-elem');
  });

  it('descarta sin reenviar un reporte de otro origen (204)', async () => {
    const ajeno = REPORTE.replace('https://boleteame.dev', 'https://otro.cl');
    const r = await POST(peticion(ajeno));
    expect(r.status).toBe(204);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin DSN no reenvía (204)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    expect((await POST(peticion(REPORTE))).status).toBe(204);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('415 si no es un reporte de CSP; 413 si es demasiado grande', async () => {
    expect((await POST(peticion(REPORTE, 'text/plain'))).status).toBe(415);
    expect((await POST(peticion('x'.repeat(20_000)))).status).toBe(413);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('si Sentry falla, igual responde 204', async () => {
    fetchFalso.mockRejectedValueOnce(new Error('red'));
    expect((await POST(peticion(REPORTE))).status).toBe(204);
  });
});
