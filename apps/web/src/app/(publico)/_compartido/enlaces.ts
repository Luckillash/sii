// Enlaces de la cabecera y el pie del sitio público (PLAN-SAAS Fase 12). Algunas rutas
// (ayuda, estado, contacto, legal) las crean otras páginas de `(publico)`.

export { RUTA_INGRESAR } from '@/lib/rutas';

export interface EnlacePublico {
  href: string;
  texto: string;
}

export const ID_CONTENIDO = 'contenido';

export const NAV_PRINCIPAL: readonly EnlacePublico[] = [
  { href: '/#producto', texto: 'Producto' },
  { href: '/#certificacion', texto: 'Certificación' },
  { href: '/docs/api', texto: 'Desarrolladores' },
  { href: '/#precios', texto: 'Precios' },
];

export const RUTA_CREAR_CUENTA = '/crear-cuenta';

export const GRUPOS_PIE: readonly { titulo: string; enlaces: readonly EnlacePublico[] }[] = [
  {
    titulo: 'Producto',
    enlaces: [
      { href: '/#producto', texto: 'Producto' },
      { href: '/#certificacion', texto: 'Certificación' },
      { href: '/docs/api', texto: 'Documentación de la API' },
      { href: '/#precios', texto: 'Precios' },
    ],
  },
  {
    titulo: 'Soporte',
    enlaces: [
      { href: '/ayuda', texto: 'Ayuda' },
      { href: '/estado', texto: 'Estado del servicio' },
      { href: '/contacto', texto: 'Contacto' },
    ],
  },
  {
    titulo: 'Legal',
    enlaces: [
      { href: '/legal/terminos', texto: 'Términos' },
      { href: '/legal/privacidad', texto: 'Privacidad' },
    ],
  },
];
