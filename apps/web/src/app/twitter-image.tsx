import { ALT_IMAGEN_SOCIAL, imagenSocial, TAMANO_IMAGEN_SOCIAL } from './_seo/ImagenSocial';

// twitter:image (tarjeta `summary_large_image`): la misma imagen que opengraph-image.
export const alt = ALT_IMAGEN_SOCIAL;
export const size = TAMANO_IMAGEN_SOCIAL;
export const contentType = 'image/png';

export default function Image() {
  return imagenSocial();
}
