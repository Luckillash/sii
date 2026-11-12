import { describe, expect, it } from 'vitest';
import { decidirRuta, esRutaPublica, SLUGS_RESERVADOS, urlIngresar } from './rutas';

describe('esRutaPublica', () => {
  it.each([
    '/',
    '/ingresar',
    '/crear-cuenta',
    '/recuperar',
    '/restablecer',
    '/restablecer/',
    '/auth/callback',
    '/invitacion/abc123',
    '/api/v1/documentos',
    '/api/cron/seguimiento',
    '/api/monitoring',
    '/monitoring',
    '/_ds',
    '/_ds/ingreso',
    '/%5Fds/app',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/manifest.webmanifest',
    '/logo.svg',
    '/.well-known/security.txt',
  ])('%s es pública', (ruta) => {
    expect(esRutaPublica(ruta)).toBe(true);
  });

  it.each([
    '/bienvenida',
    '/acme',
    '/acme/tablero',
    '/acme/documentos/123',
    '/acme/documentos/123.pdf',
    '/ingresar-falso',
    '/authx',
    '/invitaciones',
    '/apix/algo',
  ])('%s exige sesión', (ruta) => {
    expect(esRutaPublica(ruta)).toBe(false);
  });
});

describe('decidirRuta', () => {
  it('sin sesión, una ruta protegida va a ingresar con la ruta y su query', () => {
    expect(decidirRuta('/acme/documentos', '?estado=rechazado&pagina=2', false)).toEqual({
      tipo: 'redirigir',
      destino: '/ingresar?siguiente=%2Facme%2Fdocumentos%3Festado%3Drechazado%26pagina%3D2',
    });
    expect(decidirRuta('/bienvenida', '', false)).toEqual({
      tipo: 'redirigir',
      destino: '/ingresar',
    });
  });

  it('sin sesión, las públicas continúan', () => {
    expect(decidirRuta('/ingresar', '', false)).toEqual({ tipo: 'continuar' });
    expect(decidirRuta('/invitacion/xyz', '', false)).toEqual({ tipo: 'continuar' });
    expect(decidirRuta('/api/v1/documentos', '', false)).toEqual({ tipo: 'continuar' });
  });

  it('con sesión, ingresar y crear cuenta van a bienvenida', () => {
    expect(decidirRuta('/ingresar', '', true)).toEqual({
      tipo: 'redirigir',
      destino: '/bienvenida',
    });
    expect(decidirRuta('/crear-cuenta/', '', true)).toEqual({
      tipo: 'redirigir',
      destino: '/bienvenida',
    });
  });

  it('con sesión, ingresar respeta un siguiente interno y descarta uno externo', () => {
    expect(decidirRuta('/ingresar', '?siguiente=%2Facme%2Ftablero', true)).toEqual({
      tipo: 'redirigir',
      destino: '/acme/tablero',
    });
    expect(decidirRuta('/ingresar', '?siguiente=https%3A%2F%2Fmalo.example', true)).toEqual({
      tipo: 'redirigir',
      destino: '/bienvenida',
    });
  });

  it('con sesión, el resto continúa', () => {
    for (const ruta of ['/', '/bienvenida', '/acme/tablero', '/recuperar', '/restablecer']) {
      expect(decidirRuta(ruta, '', true)).toEqual({ tipo: 'continuar' });
    }
  });

  it('el siguiente que arma el proxy vuelve intacto por destinoSeguro', () => {
    const decision = decidirRuta('/acme/emitir', '?tipo=39', false);
    if (decision.tipo !== 'redirigir') throw new Error('debía redirigir');
    const siguiente = new URL(decision.destino, 'http://x').searchParams.get('siguiente');
    expect(
      decidirRuta('/ingresar', `?siguiente=${encodeURIComponent(siguiente ?? '')}`, true),
    ).toEqual({ tipo: 'redirigir', destino: '/acme/emitir?tipo=39' });
  });
});

describe('urlIngresar', () => {
  it('omite siguiente cuando es el destino por defecto', () => {
    expect(urlIngresar()).toBe('/ingresar');
    expect(urlIngresar('/')).toBe('/ingresar');
    expect(urlIngresar('/bienvenida')).toBe('/ingresar');
    expect(urlIngresar('/acme')).toBe('/ingresar?siguiente=%2Facme');
  });
});

describe('SLUGS_RESERVADOS', () => {
  it('cubre todas las rutas de primer nivel públicas', () => {
    for (const s of ['api', 'auth', 'ingresar', 'crear-cuenta', 'recuperar', 'restablecer']) {
      expect(SLUGS_RESERVADOS.has(s)).toBe(true);
    }
    for (const s of ['invitacion', 'bienvenida', 'monitoring']) {
      expect(SLUGS_RESERVADOS.has(s)).toBe(true);
    }
  });
});
