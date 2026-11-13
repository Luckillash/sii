// Glifos de estado del design system (16×16, trazo 1,5 en currentColor). Los usan
// EstadoDTE, Alerta, CampoRut y MedidorFolios; no se duplican al lado con Lucide.

import type { ReactElement, SVGProps } from 'react';

type Parte = ['circle', SVGProps<SVGCircleElement>] | ['path', SVGProps<SVGPathElement>];

const GLIFOS = {
  borrador: [['circle', { cx: 8, cy: 8, r: 5.5, strokeDasharray: '2.2 2' }]],
  firmado: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['circle', { cx: 8, cy: 8, r: 2, fill: 'currentColor', stroke: 'none' }],
  ],
  enviado: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M8 5v3.2l2 1.3' }],
  ],
  aceptado: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M5.6 8.2l1.7 1.7 3.2-3.4' }],
  ],
  reparos: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M8 5v3.6' }],
    ['circle', { cx: 8, cy: 10.8, r: 0.6, fill: 'currentColor' }],
  ],
  rechazado: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M6 6l4 4M10 6l-4 4' }],
  ],
  anulado: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M4.2 11.8l7.6-7.6' }],
  ],
  // D3: envío sin Track ID («Por verificar»). Signo de interrogación.
  incierto: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M6.4 6.4a1.7 1.7 0 0 1 3.3.5c0 1.1-1.7 1.4-1.7 2.3' }],
    ['circle', { cx: 8, cy: 11, r: 0.6, fill: 'currentColor' }],
  ],
  info: [
    ['circle', { cx: 8, cy: 8, r: 5.5 }],
    ['path', { d: 'M8 7.2v3.8' }],
    ['circle', { cx: 8, cy: 5.2, r: 0.6, fill: 'currentColor' }],
  ],
} satisfies Record<string, Parte[]>;

export type NombreGlifo = keyof typeof GLIFOS;

export interface GlifoProps {
  nombre: NombreGlifo;
  /** Por defecto 14 px. */
  size?: number;
  className?: string;
}

export function Glifo({ nombre, size = 14, className }: GlifoProps): ReactElement {
  const partes: Parte[] = GLIFOS[nombre] ?? GLIFOS.info;
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}
    >
      {partes.map(([etiqueta, atributos], i) =>
        etiqueta === 'circle' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: lista fija, nunca se reordena
          <circle key={i} {...atributos} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: lista fija, nunca se reordena
          <path key={i} {...atributos} />
        ),
      )}
    </svg>
  );
}
