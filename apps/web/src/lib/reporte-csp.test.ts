import { describe, expect, it } from 'vitest';
import { sanearReporteCsp } from './reporte-csp';

const APP = 'https://boleteame.dev';

function cuerpo(r: Record<string, unknown>): string {
  return JSON.stringify({ 'csp-report': r });
}

const BASE = {
  'document-uri': 'https://boleteame.dev/servicio/folios',
  'violated-directive': 'img-src',
  'effective-directive': 'img-src',
  'original-policy': "default-src 'self'",
  disposition: 'enforce',
  'blocked-uri': 'https://example.com/a.png',
  'status-code': 200,
};

describe('sanearReporteCsp', () => {
  it('acepta un reporte de la app y conserva los campos conocidos', () => {
    expect(sanearReporteCsp(cuerpo(BASE), APP)).toEqual(BASE);
  });

  it('descarta campos desconocidos', () => {
    const r = sanearReporteCsp(cuerpo({ ...BASE, extra: 'x', cookie: 'sb=1' }), APP);
    expect(r).not.toHaveProperty('extra');
    expect(r).not.toHaveProperty('cookie');
  });

  it('quita query, fragmento y el token de una invitación del documento', () => {
    const r = sanearReporteCsp(
      cuerpo({ ...BASE, 'document-uri': 'https://boleteame.dev/invitacion/tok_secreto?x=1#y' }),
      APP,
    );
    expect(r?.['document-uri']).toBe('https://boleteame.dev/invitacion/[token]');
    const q = sanearReporteCsp(
      cuerpo({
        ...BASE,
        'document-uri': 'https://boleteame.dev/ingresar?siguiente=/a&correo=x@y.cl',
      }),
      APP,
    );
    expect(q?.['document-uri']).toBe('https://boleteame.dev/ingresar');
  });

  it('las URL bloqueadas y de origen pierden la query; el referrer queda en el origen', () => {
    const r = sanearReporteCsp(
      cuerpo({
        ...BASE,
        'blocked-uri': 'https://example.com/a.png?token=1',
        'source-file': 'https://boleteame.dev/_next/static/a.js?v=2',
        referrer: 'https://otro.cl/ruta?privado=1',
      }),
      APP,
    );
    expect(r?.['blocked-uri']).toBe('https://example.com/a.png');
    expect(r?.['source-file']).toBe('https://boleteame.dev/_next/static/a.js');
    expect(r?.referrer).toBe('https://otro.cl');
  });

  it('respeta las palabras clave del navegador en blocked-uri', () => {
    expect(
      sanearReporteCsp(cuerpo({ ...BASE, 'blocked-uri': 'inline' }), APP)?.['blocked-uri'],
    ).toBe('inline');
    expect(sanearReporteCsp(cuerpo({ ...BASE, 'blocked-uri': 'eval' }), APP)?.['blocked-uri']).toBe(
      'eval',
    );
    expect(
      sanearReporteCsp(cuerpo({ ...BASE, 'blocked-uri': 'data:image/png;base64,AAA' }), APP)?.[
        'blocked-uri'
      ],
    ).toBe('data:');
  });

  it('recorta campos largos', () => {
    const r = sanearReporteCsp(cuerpo({ ...BASE, 'original-policy': 'a'.repeat(10_000) }), APP);
    expect(String(r?.['original-policy']).length).toBe(2048);
  });

  it('rechaza reportes de otro origen, sin directiva o mal formados', () => {
    expect(
      sanearReporteCsp(cuerpo({ ...BASE, 'document-uri': 'https://malicioso.cl/x' }), APP),
    ).toBeNull();
    expect(
      sanearReporteCsp(cuerpo({ ...BASE, 'document-uri': 'http://boleteame.dev/x' }), APP),
    ).toBeNull();
    const { 'violated-directive': _v, 'effective-directive': _e, ...sinDirectiva } = BASE;
    expect(sanearReporteCsp(cuerpo(sinDirectiva), APP)).toBeNull();
    expect(sanearReporteCsp('no es json', APP)).toBeNull();
    expect(sanearReporteCsp('[]', APP)).toBeNull();
    expect(sanearReporteCsp(JSON.stringify({ 'csp-report': [] }), APP)).toBeNull();
    expect(sanearReporteCsp(JSON.stringify({ otro: BASE }), APP)).toBeNull();
  });
});
