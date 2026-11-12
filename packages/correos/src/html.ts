// Utilidades para armar HTML de correo a mano, sin dependencias.

const ENTIDADES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto para contenido o atributos HTML. Todo dato variable pasa por aquí. */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ENTIDADES[c] ?? c);
}

/** `estilo({ color: '#000', fontSize: '15px' })` → `color:#000;font-size:15px`. */
export function estilo(propiedades: Record<string, string | number>): string {
  return Object.entries(propiedades)
    .map(([clave, valor]) => `${clave.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${valor}`)
    .join(';');
}

/**
 * Valida que un enlace sea http(s) absoluto antes de ponerlo en un `href`. Lanza si no:
 * un enlace mal armado es un error de programación, no un dato del usuario.
 */
export function enlaceSeguro(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('El enlace del correo no es una URL absoluta.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('El enlace del correo debe ser http o https.');
  }
  return u.toString();
}

/** dd-mm-aaaa en hora de Chile (formato del design system). */
export function formatearFecha(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('day')}-${valor('month')}-${valor('year')}`;
}
