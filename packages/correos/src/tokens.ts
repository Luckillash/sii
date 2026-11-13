// Colores y medidas del design system para correos (PLAN-SAAS §4.2, §4.6).
//
// Los clientes de correo no leen custom properties ni hojas de estilo externas: los
// valores van en línea. Son los del tema claro de `design-system/boleteame/tokens.json`
// (los mismos que `apps/web/src/styles/tokens.css` genera en `:root`); la mayoría de
// los clientes no respeta un tema oscuro propio. `tokens.test.ts` comprueba que no se
// desalineen de tokens.css.

export const COLOR = {
  surface: '#f6f5f0',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#ecebe3',
  line: '#dcd9cf',
  ink: '#16201f',
  inkMuted: '#565e5b',
  sello: '#0b5f5a',
  onSello: '#ffffff',
} as const;

/** Nombre del token CSS de cada color (para la prueba de alineación). */
export const TOKEN_CSS: Record<keyof typeof COLOR, string> = {
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  surfaceSunken: '--surface-sunken',
  line: '--line',
  ink: '--ink',
  inkMuted: '--ink-muted',
  sello: '--sello',
  onSello: '--on-sello',
};

/** IBM Plex Sans si está instalada; si no, la del sistema (los correos no cargan fuentes web). */
export const FUENTE =
  "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FUENTE_MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

export const RADIO = { sm: '3px', md: '6px' } as const;
