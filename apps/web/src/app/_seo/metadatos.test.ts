import { afterEach, describe, expect, it, vi } from 'vitest';
import { decidirRuta } from '@/lib/rutas';
import manifest from '../manifest';
import robots from '../robots';
import sitemap from '../sitemap';
import { COLORES_CLARO } from './marca';
import {
  construirManifest,
  construirRobots,
  construirSitemap,
  PAGINAS_SITEMAP,
  RUTAS_EXCLUIDAS,
} from './metadatos';

const BASE = 'https://boleteame.dev';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sitemap', () => {
  it('lista el sitio público y las pantallas de acceso con URL absoluta', () => {
    expect(construirSitemap(BASE).map((e) => e.url)).toEqual([
      'https://boleteame.dev',
      'https://boleteame.dev/docs/api',
      'https://boleteame.dev/ayuda',
      'https://boleteame.dev/crear-cuenta',
      'https://boleteame.dev/contacto',
      'https://boleteame.dev/estado',
      'https://boleteame.dev/ingresar',
      'https://boleteame.dev/legal/terminos',
      'https://boleteame.dev/legal/privacidad',
    ]);
  });

  it('cada entrada tiene fecha fija, frecuencia y prioridad entre 0 y 1', () => {
    for (const e of construirSitemap(BASE)) {
      expect(e.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.changeFrequency).toBeDefined();
      expect(e.priority).toBeGreaterThan(0);
      expect(e.priority).toBeLessThanOrEqual(1);
    }
    expect(construirSitemap(BASE)[0]?.priority).toBe(1);
  });

  it('es estable entre llamadas (sin new Date())', () => {
    expect(construirSitemap(BASE)).toEqual(construirSitemap(BASE));
  });

  it('solo tiene rutas que no exigen sesión y ninguna excluida en robots.txt', () => {
    for (const { ruta } of PAGINAS_SITEMAP) {
      expect(decidirRuta(ruta, '', false), ruta).toEqual({ tipo: 'continuar' });
      expect(
        RUTAS_EXCLUIDAS.some((x) => ruta.startsWith(x)),
        ruta,
      ).toBe(false);
    }
  });

  it('la ruta usa NEXT_PUBLIC_APP_URL y, si falta, el dominio de producción', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000/');
    expect(sitemap()[1]?.url).toBe('http://localhost:3000/docs/api');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(sitemap()[0]?.url).toBe(BASE);
  });
});

describe('robots', () => {
  it('permite el sitio, excluye lo que no es contenido y apunta al sitemap', () => {
    expect(construirRobots(BASE)).toEqual({
      rules: {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/bienvenida', '/invitacion/', '/_ds', '/monitoring'],
      },
      sitemap: 'https://boleteame.dev/sitemap.xml',
    });
  });

  it('no bloquea las páginas de organizaciones (llevan noindex) ni el sitio público', () => {
    const { disallow } = construirRobots(BASE).rules as { disallow: string[] };
    for (const ruta of ['/', '/acme/tablero', '/docs/api', '/legal/terminos', '/opengraph-image']) {
      expect(
        disallow.some((x) => ruta.startsWith(x)),
        ruta,
      ).toBe(false);
    }
  });

  it('la ruta arma el sitemap absoluto desde el entorno', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://boleteame.dev');
    expect(robots().sitemap).toBe('https://boleteame.dev/sitemap.xml');
  });
});

describe('manifest', () => {
  it('nombre, idioma, colores de tokens e íconos', () => {
    const m = construirManifest();
    expect(m).toMatchObject({
      name: 'Boletéame · Boletas electrónicas ante el SII',
      short_name: 'Boletéame',
      lang: 'es-CL',
      start_url: '/',
      display: 'standalone',
      background_color: COLORES_CLARO.surface,
      theme_color: COLORES_CLARO.sello,
    });
    expect(m.icons?.map((i) => i.src)).toEqual(['/icon.svg', '/apple-icon']);
    expect(manifest()).toEqual(m);
  });

  it('los íconos se sirven sin sesión', () => {
    for (const icono of construirManifest().icons ?? []) {
      expect(decidirRuta(icono.src, '', false), icono.src).toEqual({ tipo: 'continuar' });
    }
  });
});
