import type { ReactElement } from 'react';
import { formatearMonto } from '@/lib/formatos';
import estilos from './Monto.module.css';

export interface MontoProps {
  valor: number;
  /** Por defecto 'CLP' (sin decimales). USD, UF u otro código: dos decimales con coma. */
  moneda?: 'CLP' | 'USD' | 'UF' | (string & {});
  destacado?: boolean;
  tenue?: boolean;
  className?: string;
}

export function Monto({ valor, moneda, destacado, tenue, className }: MontoProps): ReactElement {
  const clases = [estilos.monto, destacado && estilos.destacado, tenue && estilos.tenue, className]
    .filter(Boolean)
    .join(' ');
  return <span className={clases}>{formatearMonto(valor, moneda)}</span>;
}
