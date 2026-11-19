// Identidad pública del sitio (PLAN-SAAS Fase 12, D6, D8). Puro: lo usan el layout raíz,
// `sitemap.ts`, `robots.ts`, `manifest.ts`, las imágenes OG y el JSON-LD.

/** Dominio de producción (§4.5): respaldo si falta o no sirve NEXT_PUBLIC_APP_URL. */
export const URL_PRODUCCION = 'https://boleteame.dev';

export const NOMBRE_SITIO = 'Boletéame';

/** Título por defecto: el mismo `title.absolute` de la landing. */
export const TITULO_SITIO = 'Boletéame · Boletas electrónicas ante el SII';

/** Plantilla para las páginas hijas: «Ingresar · Boletéame». */
export const PLANTILLA_TITULO = '%s · Boletéame';

export const DESCRIPCION_SITIO =
  'Emite boletas electrónicas y boletas exentas ante el SII: firma con tu certificado digital, folios (CAF), seguimiento de cada envío, certificación guiada y una API para tu sistema.';

/**
 * Origen público de la app, sin barra final. Lee `NEXT_PUBLIC_APP_URL` (en *Production*,
 * `https://boleteame.dev`; en local, `http://localhost:3000`) y, si falta o no es una URL
 * http(s), usa el dominio de producción para que el build no se caiga.
 */
export function urlSitio(valor: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  if (!valor) return URL_PRODUCCION;
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return URL_PRODUCCION;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return URL_PRODUCCION;
  }
}

/** URL absoluta de una ruta del sitio: `urlAbsoluta('/ayuda')` → `https://boleteame.dev/ayuda`. */
export function urlAbsoluta(ruta: string, base: string = urlSitio()): string {
  if (ruta === '/' || ruta === '') return base;
  return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}
