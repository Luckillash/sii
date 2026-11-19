import { ALT_IMAGEN_SOCIAL, imagenSocial, TAMANO_IMAGEN_SOCIAL } from './_seo/ImagenSocial';

// og:image de todo el sitio (PLAN-SAAS Fase 12). Estática: se genera en el build.
export const alt = ALT_IMAGEN_SOCIAL;
export const size = TAMANO_IMAGEN_SOCIAL;
export const contentType = 'image/png';

export default function Image() {
  return imagenSocial();
}
