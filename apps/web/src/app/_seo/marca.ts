// Colores y monograma de Boletéame para lo que no puede usar las custom properties de
// `tokens.css`: `ImageResponse` (Satori no resuelve `var(--…)`), `viewport.themeColor`
// y `manifest.ts`.
//
// Origen: `design-system/boleteame/tokens.json` (`color.tokens`, mismos valores que el
// generado `apps/web/src/styles/tokens.css`). `marca.test.ts` los compara con el JSON:
// si cambia un token, la prueba falla y hay que actualizar aquí.

export const COLORES_CLARO = {
  surface: '#f6f5f0',
  'surface-raised': '#ffffff',
  line: '#dcd9cf',
  ink: '#16201f',
  'ink-muted': '#565e5b',
  sello: '#0b5f5a',
  'sello-soft': '#dcefec',
  'on-sello': '#ffffff',
  ocre: '#d99a1e',
  exito: '#1c6b3a',
  'exito-soft': '#e0f0e4',
} as const;

export const COLORES_OSCURO = {
  surface: '#111615',
  sello: '#5ec8bd',
  'on-sello': '#0a1413',
} as const;

/**
 * Monograma «B» en un cuadro de 32 × 32 (relleno `evenodd`: los dos huecos son
 * subtrazos). El mismo trazo está en `app/icon.svg`; `marca.test.ts` verifica que
 * coincidan.
 */
export const TRAZO_B =
  'M10 8H17C19.8 8 21.5 9.5 21.5 11.8C21.5 13.3 20.7 14.4 19.4 14.9C21.1 15.3 22.2 16.6 22.2 18.5C22.2 21.6 20.2 24 17.4 24H10Z' +
  'M13 10.6V14H16.6C17.8 14 18.5 13.3 18.5 12.3C18.5 11.3 17.8 10.6 16.6 10.6Z' +
  'M13 16.4V21.4H17C18.4 21.4 19.2 20.5 19.2 18.9C19.2 17.3 18.4 16.4 17 16.4Z';

/**
 * Centros de las perforaciones de la estampilla en un cuadro de 32 × 32: una cada 4
 * unidades por lado, sobre el borde, como el bloque `sello` del hero de la plantilla
 * «Landing» (`Main.dc.html`). Radio `RADIO_PERFORACION`.
 */
export const RADIO_PERFORACION = 1.5;

export function perforaciones(lado = 32, paso = 4): [number, number][] {
  const puntos: [number, number][] = [];
  for (let p = paso; p < lado; p += paso) {
    puntos.push([p, 0], [p, lado], [0, p], [lado, p]);
  }
  return puntos;
}

export interface OpcionesEstampilla {
  /** Agrega los colores del tema oscuro con `prefers-color-scheme` (favicon SVG). */
  temaOscuro?: boolean;
}

/**
 * Estampilla de Boletéame en SVG (32 × 32): bloque `sello` con el borde perforado (huecos transparentes), un
 * cuadro `ocre` en la esquina y la «B» en `on-sello`. `app/icon.svg` es exactamente
 * `svgEstampilla({ temaOscuro: true })` (lo verifica `marca.test.ts`).
 *
 * No es un logotipo: el design system todavía no tiene marca gráfica (README, «Logotipo»).
 * Es un monograma con los recursos del hero de la landing.
 */
export function svgEstampilla({ temaOscuro = false }: OpcionesEstampilla = {}): string {
  const huecos = perforaciones()
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${RADIO_PERFORACION}"/>`)
    .join('');
  const estilo = temaOscuro
    ? `<style>.s{fill:${COLORES_CLARO.sello}}.b{fill:${COLORES_CLARO['on-sello']}}` +
      `@media (prefers-color-scheme:dark){.s{fill:${COLORES_OSCURO.sello}}.b{fill:${COLORES_OSCURO['on-sello']}}}</style>`
    : '';
  const sello = temaOscuro ? 'class="s"' : `fill="${COLORES_CLARO.sello}"`;
  const letra = temaOscuro ? 'class="b"' : `fill="${COLORES_CLARO['on-sello']}"`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<title>Boletéame</title>',
    estilo,
    `<mask id="m"><rect width="32" height="32" fill="#fff"/><g fill="#000">${huecos}</g></mask>`,
    `<rect width="32" height="32" ${sello} mask="url(#m)"/>`,
    `<rect x="23" y="4" width="5" height="5" rx="0.5" fill="${COLORES_CLARO.ocre}"/>`,
    `<path ${letra} fill-rule="evenodd" d="${TRAZO_B}"/>`,
    '</svg>',
  ].join('');
}

/** `data:` URI de un SVG, para `<img src>` dentro de `ImageResponse`. */
export function dataUriSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
