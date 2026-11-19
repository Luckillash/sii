import type { MetadataRoute } from 'next';
import { urlSitio } from '@/lib/sitio';
import { construirSitemap } from './_seo/metadatos';

// /sitemap.xml (PLAN-SAAS Fase 12): páginas y fechas en `_seo/metadatos.ts`. Estático:
// se genera en el build con NEXT_PUBLIC_APP_URL (en *Production*, https://boleteame.dev).
export default function sitemap(): MetadataRoute.Sitemap {
  return construirSitemap(urlSitio());
}
