import { SLUGS_RESERVADOS } from '@/lib/rutas';

// Dirección (slug) de una organización: `/[slug]/tablero`. Puro: lo usan el
// formulario (cliente) y la Server Action (servidor), y se prueba con Vitest.

/** Mismo check que `organizaciones.slug` en 0001_esquema_inicial.sql (§4). */
export const PATRON_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const LARGO_MAXIMO_SLUG = 63;
export const LARGO_MAXIMO_NOMBRE = 100;

/**
 * Sugiere un slug desde el nombre: minúsculas, sin tildes (ñ → n), cualquier otro
 * carácter → guion, sin guiones repetidos ni en los extremos, hasta 63 caracteres.
 * Puede devolver algo inválido (vacío, de un carácter o reservado): validarlo después.
 */
export function sugerirSlug(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, LARGO_MAXIMO_SLUG)
    .replace(/-+$/, '');
}

/** `null` si el slug sirve; si no, el mensaje (qué pasó y qué hacer). */
export function validarSlug(slug: string): string | null {
  if (slug.length === 0) return 'Escribe la dirección de tu organización.';
  if (slug.length < 2) return 'La dirección debe tener al menos 2 caracteres.';
  if (slug.length > LARGO_MAXIMO_SLUG) {
    return `La dirección puede tener hasta ${LARGO_MAXIMO_SLUG} caracteres. Acórtala.`;
  }
  if (!PATRON_SLUG.test(slug)) {
    return 'Usa solo minúsculas sin tilde, números y guiones, y empieza con una letra o un número.';
  }
  if (SLUGS_RESERVADOS.has(slug)) {
    return 'Esa dirección está reservada para Timbre. Elige otra, por ejemplo agregando el nombre de tu empresa.';
  }
  return null;
}

/** `null` si el nombre sirve; si no, el mensaje. */
export function validarNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length === 0) return 'Escribe el nombre de tu organización.';
  if (limpio.length > LARGO_MAXIMO_NOMBRE) {
    return `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres. Acórtalo.`;
  }
  return null;
}

export interface ErrorOrganizacion {
  campo: 'slug' | null;
  mensaje: string;
}

/**
 * Error de `crear_organizacion()` → mensaje. 23505 es el `unique` de
 * `organizaciones.slug`; 23514, sus checks (slug o nombre vacío); 42501, sin sesión.
 */
export function traducirErrorOrganizacion(error: {
  code?: string | null;
  message?: string | null;
}): ErrorOrganizacion {
  switch (error.code) {
    case '23505':
      return {
        campo: 'slug',
        mensaje: 'Esa dirección ya la usa otra organización. Prueba con otra.',
      };
    case '23514':
      return {
        campo: 'slug',
        mensaje: 'La dirección no es válida. Usa solo minúsculas sin tilde, números y guiones.',
      };
    case '42501':
      return {
        campo: null,
        mensaje: 'Tu sesión expiró. Vuelve a ingresar y crea la organización de nuevo.',
      };
    default:
      return {
        campo: null,
        mensaje:
          'No pudimos crear la organización. Inténtalo de nuevo en unos minutos; si sigue fallando, escríbenos a soporte.',
      };
  }
}
