import type { HTMLAttributes, ReactElement } from 'react';
import estilos from './Tarjeta.module.css';

export type ElementoTarjeta = 'section' | 'div' | 'article' | 'aside' | 'ol' | 'ul';

export interface TarjetaProps extends HTMLAttributes<HTMLElement> {
  /** Por defecto `section`; una lista de pasos va como `ol`. */
  as?: ElementoTarjeta;
  /** ninguno: 0 · md: 20px (por defecto) · lg: 24px. */
  relleno?: 'ninguno' | 'md' | 'lg';
  /** elevada: con sombra (por defecto) · plana: sin sombra · tenue: sin sombra, fondo `surface`. */
  variante?: 'elevada' | 'plana' | 'tenue';
}

/** Superficie elevada con borde (`.tb-tarjeta`). La disposición interna la pone quien la usa. */
export function Tarjeta({
  as: Elemento = 'section',
  relleno = 'md',
  variante = 'elevada',
  className,
  ...resto
}: TarjetaProps): ReactElement {
  return (
    <Elemento
      {...resto}
      className={[estilos.tarjeta, estilos[relleno], estilos[variante], className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
