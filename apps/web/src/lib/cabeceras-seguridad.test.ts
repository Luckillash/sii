import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cabecerasSeguridad,
  HSTS,
  MODO_CSP,
  ORIGEN_TURNSTILE,
  origenesSupabase,
  politicaCsp,
  urlReporteSentry,
} from './cabeceras-seguridad';

const SUPABASE = 'https://rbrntkztzijaxsnpgpqn.supabase.co';
const DSN = 'https://abc123@o4500000000000000.ingest.us.sentry.io/4500000000000001';
const PRODUCCION = {
  supabaseUrl: SUPABASE,
  appUrl: 'https://boleteame.dev',
  sentryDsn: DSN,
  ambiente: 'production',
};

function directivas(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((d) => {
      const [nombre, ...valores] = d.trim().split(/\s+/);
      return [nombre as string, valores];
    }),
  );
}

function valor(nombre: string, o = PRODUCCION) {
  return cabecerasSeguridad(o).find((c) => c.key === nombre)?.value;
}

describe('cabeceras de seguridad', () => {
  it('trae todas las cabeceras pedidas', () => {
    const claves = cabecerasSeguridad(PRODUCCION).map((c) => c.key);
    expect(claves).toEqual([
      MODO_CSP === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
    expect(valor('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(HSTS).not.toContain('preload');
    expect(valor('X-Content-Type-Options')).toBe('nosniff');
    expect(valor('X-Frame-Options')).toBe('DENY');
    expect(valor('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valor('Permissions-Policy')).toContain('camera=()');
    expect(valor('Permissions-Policy')).toContain('geolocation=()');
  });

  it('el modo elige el nombre de la cabecera CSP', () => {
    expect(cabecerasSeguridad({ modo: 'enforce' })[0]?.key).toBe('Content-Security-Policy');
    expect(cabecerasSeguridad({ modo: 'report-only' })[0]?.key).toBe(
      'Content-Security-Policy-Report-Only',
    );
  });

  it('CSP: Turnstile, Supabase (https y wss), túnel de Sentry y nada de frames', () => {
    const d = directivas(politicaCsp({ ...PRODUCCION, modo: 'enforce' }));
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'", ORIGEN_TURNSTILE]);
    expect(d.get('frame-src')).toEqual([ORIGEN_TURNSTILE]);
    expect(d.get('connect-src')).toEqual([
      "'self'",
      SUPABASE,
      'wss://rbrntkztzijaxsnpgpqn.supabase.co',
    ]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(d.get('report-uri')?.[0]).toBe(
      'https://o4500000000000000.ingest.us.sentry.io/api/4500000000000001/security/?sentry_key=abc123&sentry_environment=production',
    );
  });

  it("sin 'unsafe-eval' en producción; con él solo en next dev", () => {
    expect(politicaCsp(PRODUCCION)).not.toContain('unsafe-eval');
    expect(
      directivas(politicaCsp({ ...PRODUCCION, desarrollo: true })).get('script-src'),
    ).toContain("'unsafe-eval'");
  });

  it('report-only no lleva upgrade-insecure-requests (el navegador lo ignora y avisa)', () => {
    expect(politicaCsp({ ...PRODUCCION, modo: 'report-only' })).not.toContain('upgrade-insecure');
  });

  it('en local (http) no fuerza https', () => {
    const csp = politicaCsp({ appUrl: 'http://localhost:3000', modo: 'enforce' });
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('report-uri');
  });

  it('URL de Supabase o DSN inválidos no agregan orígenes', () => {
    expect(origenesSupabase(undefined)).toEqual([]);
    expect(origenesSupabase('no es url')).toEqual([]);
    expect(origenesSupabase('javascript:alert(1)')).toEqual([]);
    expect(origenesSupabase('http://127.0.0.1:54321')).toEqual([
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
    expect(urlReporteSentry('nada')).toBeNull();
    expect(urlReporteSentry('http://k@sentry.io/1')).toBeNull();
    expect(urlReporteSentry('https://sentry.io/1')).toBeNull();
    expect(urlReporteSentry(DSN, 'x; script-src *')).not.toContain('script-src');
  });

  it('ningún valor rompe la cabecera (sin saltos de línea ni ; sueltos)', () => {
    for (const c of cabecerasSeguridad(PRODUCCION)) {
      expect(c.value).not.toMatch(/[\r\n]/);
      expect(c.value).not.toMatch(/;\s*;/);
    }
  });

  it('next.config.ts las aplica a todas las rutas con las variables públicas del build', () => {
    const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("from './src/lib/cabeceras-seguridad.ts'");
    expect(config).toContain("source: '/:path*'");
    for (const v of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SENTRY_DSN']) {
      expect(config).toContain(`process.env.${v}`);
    }
  });
});
