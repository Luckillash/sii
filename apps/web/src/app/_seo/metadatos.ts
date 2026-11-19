import type { MetadataRoute } from 'next';
import { DESCRIPCION_SITIO, NOMBRE_SITIO, TITULO_SITIO, urlAbsoluta } from '@/lib/sitio';
import { COLORES_CLARO } from './marca';

// Contenido de /sitemap.xml, /robots.txt y /manifest.webmanifest (PLAN-SAAS Fase 12).
// Funciones puras con la URL base como parámetro, para probarlas sin depender del
// entorno; `app/sitemap.ts`, `app/robots.ts` y `app/manifest.ts` solo las llaman (las
// rutas de metadatos se dejan con su único `export default`).

// ── sitemap ──────────────────────────────────────────────────────────────────────────
//
// Solo el sitio público y las pantallas de acceso que se indexan: la app de cada
// organización (`/<slug>/…`), el onboarding y las invitaciones llevan `noindex` y no
// van aquí.
//
// `modificada` es una fecha fija por página (no `new Date()`): cámbiala cuando cambie el
// contenido de esa página, para que los buscadores no vuelvan a rastrear todo en cada
// deploy.

export interface PaginaSitemap {
  ruta: string;
  /** Fecha (AAAA-MM-DD) del último cambio de contenido. */
  modificada: string;
  frecuencia: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  prioridad: number;
}

export const PAGINAS_SITEMAP: readonly PaginaSitemap[] = [
  { ruta: '/', modificada: '2026-11-19', frecuencia: 'weekly', prioridad: 1 },
  { ruta: '/docs/api', modificada: '2026-11-19', frecuencia: 'monthly', prioridad: 0.8 },
  { ruta: '/ayuda', modificada: '2026-11-19', frecuencia: 'monthly', prioridad: 0.7 },
  { ruta: '/crear-cuenta', modificada: '2026-11-12', frecuencia: 'yearly', prioridad: 0.6 },
  { ruta: '/contacto', modificada: '2026-11-19', frecuencia: 'yearly', prioridad: 0.6 },
  { ruta: '/estado', modificada: '2026-11-19', frecuencia: 'daily', prioridad: 0.5 },
  { ruta: '/ingresar', modificada: '2026-11-12', frecuencia: 'yearly', prioridad: 0.4 },
  { ruta: '/legal/terminos', modificada: '2026-11-19', frecuencia: 'yearly', prioridad: 0.3 },
  { ruta: '/legal/privacidad', modificada: '2026-11-19', frecuencia: 'yearly', prioridad: 0.3 },
];

export function construirSitemap(base: string): MetadataRoute.Sitemap {
  return PAGINAS_SITEMAP.map((p) => ({
    url: urlAbsoluta(p.ruta, base),
    lastModified: p.modificada,
    changeFrequency: p.frecuencia,
    priority: p.prioridad,
  }));
}

// ── robots ───────────────────────────────────────────────────────────────────────────
//
// Se rastrea el sitio público; se excluye lo que no es contenido: la API y el túnel de
// Sentry, los callbacks de Auth, el onboarding, las invitaciones (llevan un token en la
// URL) y el catálogo del design system.
//
// Las páginas de organizaciones (`/<slug>/…`) no se listan: los slugs son de cada
// cliente (enumerarlos aquí los publicaría) y no comparten un prefijo. Sin sesión el
// proxy las redirige a /ingresar, así que un buscador nunca ve su contenido, y además
// llevan `noindex` desde `[org]/layout.tsx`.

export const RUTAS_EXCLUIDAS: readonly string[] = [
  '/api/',
  '/auth/',
  '/bienvenida',
  '/invitacion/',
  '/_ds',
  '/monitoring',
];

export function construirRobots(base: string): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...RUTAS_EXCLUIDAS] },
    sitemap: urlAbsoluta('/sitemap.xml', base),
  };
}

// ── manifest ─────────────────────────────────────────────────────────────────────────
//
// Simple: nombre, colores del tema claro (`surface` de fondo y `sello` de tema, de
// tokens.json vía marca.ts) y los mismos íconos que el `<head>`: la estampilla en SVG y
// el PNG de 180 px de `apple-icon.tsx`.

export function construirManifest(): MetadataRoute.Manifest {
  return {
    name: TITULO_SITIO,
    short_name: NOMBRE_SITIO,
    description: DESCRIPCION_SITIO,
    lang: 'es-CL',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: COLORES_CLARO.surface,
    theme_color: COLORES_CLARO.sello,
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
