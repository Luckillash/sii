import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import estilos from './Boton.module.css';

export type VarianteBoton = 'primario' | 'secundario' | 'discreto' | 'peligro';
export type TamanoBoton = 'md' | 'sm';

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primario: una sola acción principal por pantalla. Por defecto 'secundario'. */
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  /** Ícono Lucide de 16px antes del texto. */
  icono?: ReactNode;
  children?: ReactNode;
}

/** Clases del botón, para dar su aspecto a un `<a>` o a un `Link` de Next. */
export function clasesBoton(
  variante: VarianteBoton = 'secundario',
  tamano: TamanoBoton = 'md',
  extra?: string,
): string {
  return [estilos.boton, estilos[variante], estilos[tamano], extra].filter(Boolean).join(' ');
}

export function Boton({
  variante = 'secundario',
  tamano = 'md',
  icono,
  className,
  children,
  type = 'button',
  ...resto
}: BotonProps): ReactElement {
  return (
    <button type={type} {...resto} className={clasesBoton(variante, tamano, className)}>
      {icono ? (
        <span className={estilos.icono} aria-hidden="true">
          {icono}
        </span>
      ) : null}
      {children}
    </button>
  );
}
