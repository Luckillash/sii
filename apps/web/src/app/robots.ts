import type { MetadataRoute } from 'next';
import { urlSitio } from '@/lib/sitio';
import { construirRobots } from './_seo/metadatos';

// /robots.txt (PLAN-SAAS Fase 12): reglas y por qué en `_seo/metadatos.ts`.
export default function robots(): MetadataRoute.Robots {
  return construirRobots(urlSitio());
}
