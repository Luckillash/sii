import type { MetadataRoute } from 'next';
import { construirManifest } from './_seo/metadatos';

// /manifest.webmanifest (PLAN-SAAS Fase 12): contenido en `_seo/metadatos.ts`.
export default function manifest(): MetadataRoute.Manifest {
  return construirManifest();
}
