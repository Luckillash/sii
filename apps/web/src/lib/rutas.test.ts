import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    '/docs',
    '/docs/api',
    '/api/v1/openapi.json',
    '/_ds',
    '/_ds/ingreso',
    '/%5Fds/app',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/manifest.webmanifest',
    '/logo.svg',
    '/.well-known/security.txt',
    // Sitio público (Fase 12).
    '/contacto',
    '/ayuda',
    '/ayuda/certificado-digital',
    '/estado',
    '/legal',
    '/legal/terminos',
    '/legal/privacidad',
    '/legal/privacidad/',
    // Rutas de metadatos (Fase 12).
    '/icon.svg',
    '/opengraph-image',
    '/twitter-image',
    '/apple-icon',
    '/icon',
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
    '/docsx',
    '/acme/docs',
    '/acme/legal',
    '/acme/legal/terminos',
    '/acme/contacto',
    '/acme/ayuda',
    '/acme/estado',
    '/legales',
    '/contactos',
    '/estados',
    '/acme/opengraph-image',
    '/opengraph-image-falsa',
    '/acme/apple-icon',
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

  it.each([
    '/contacto',
    '/ayuda',
    '/estado',
    '/legal/terminos',
    '/legal/privacidad',
    '/sitemap.xml',
    '/robots.txt',
    '/manifest.webmanifest',
    '/icon.svg',
    '/opengraph-image',
    '/twitter-image',
    '/apple-icon',
  ])('sin sesión, %s (sitio público y metadatos) continúa', (ruta) => {
    expect(decidirRuta(ruta, '', false)).toEqual({ tipo: 'continuar' });
  });

  it('las imágenes generadas continúan con el hash de caché en la query', () => {
    expect(decidirRuta('/opengraph-image', '?a1b2c3d4e5f6', false)).toEqual({
      tipo: 'continuar',
    });
    expect(decidirRuta('/apple-icon', '?a1b2c3d4e5f6', false)).toEqual({ tipo: 'continuar' });
  });

  it('sin sesión, /acme/legal sigue protegida', () => {
    expect(decidirRuta('/acme/legal', '', false)).toEqual({
      tipo: 'redirigir',
      destino: '/ingresar?siguiente=%2Facme%2Flegal',
    });
    expect(decidirRuta('/acme/opengraph-image', '', false)).toEqual({
      tipo: 'redirigir',
      destino: '/ingresar?siguiente=%2Facme%2Fopengraph-image',
    });
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

  it('cubre el sitio público y las rutas de metadatos (Fase 12)', () => {
    for (const s of ['contacto', 'ayuda', 'estado', 'legal', 'terminos', 'privacidad', 'soporte']) {
      expect(SLUGS_RESERVADOS.has(s), s).toBe(true);
    }
    for (const s of ['opengraph-image', 'twitter-image', 'icon', 'apple-icon']) {
      expect(SLUGS_RESERVADOS.has(s), s).toBe(true);
    }
  });

  it('cada ruta pública de primer nivel sin punto está reservada', () => {
    // Si se agrega una ruta pública nueva sin reservar su slug, una organización podría
    // quedar con la raíz pública.
    for (const ruta of [
      '/contacto',
      '/ayuda',
      '/estado',
      '/legal',
      '/docs',
      '/opengraph-image',
      '/twitter-image',
      '/icon',
      '/apple-icon',
    ]) {
      expect(esRutaPublica(ruta), ruta).toBe(true);
      expect(SLUGS_RESERVADOS.has(ruta.slice(1)), ruta).toBe(true);
    }
  });

  it('cada carpeta de primer nivel real de src/app está reservada', () => {
    // Lee las carpetas de verdad: una ruta nueva sin su slug reservado rompe esta prueba.
    // Se ignoran los archivos, las carpetas privadas (`_…`), `[org]` (y cualquier segmento
    // dinámico) y `%5Fds` (la URL `/_ds`, que ya no admite `PATRON_SLUG`). Los grupos
    // `(…)` no son parte de la URL, así que se miran sus carpetas hijas: `(auth)/ingresar`
    // y `(publico)/contacto` son rutas de primer nivel.
    const raiz = fileURLToPath(new URL('../app', import.meta.url));
    const carpetas = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => {
          if (/^\(.+\)$/.test(e.name)) return carpetas(join(dir, e.name));
          if (e.name.startsWith('_') || e.name.startsWith('[') || e.name === '%5Fds') return [];
          return [e.name];
        });
    const primerNivel = carpetas(raiz);

    // Las que hoy existen, para que la prueba no pase vacía si cambia la ruta de `src/app`.
    expect(primerNivel).toEqual(
      expect.arrayContaining(['api', 'auth', 'ingresar', 'contacto', 'ayuda', 'estado', 'legal']),
    );
    const sinReservar = primerNivel.filter((nombre) => !SLUGS_RESERVADOS.has(nombre));
    expect(sinReservar).toEqual([]);
  });
});
