import type { ReactElement } from 'react';
import { type CodigoDte, nombreTipoDte } from '@/lib/formatos';
import estilos from './TipoDTE.module.css';

export interface TipoDTEProps {
  codigo: CodigoDte | number;
  /** Nombre corto ("Factura") en vez del oficial ("Factura electrónica"). */
  corto?: boolean;
  /** Solo el código; el nombre queda para lectores de pantalla y tooltip. */
  soloCodigo?: boolean;
  className?: string;
}

export function TipoDTE({ codigo, corto, soloCodigo, className }: TipoDTEProps): ReactElement {
  const oficial = nombreTipoDte(codigo);
  return (
    <span className={[estilos.tipo, className].filter(Boolean).join(' ')} title={oficial}>
      <span className={estilos.codigo}>{String(codigo)}</span>
      {soloCodigo ? (
        <span className={estilos.sr}>{oficial}</span>
      ) : (
        <span>{corto ? nombreTipoDte(codigo, true) : oficial}</span>
      )}
    </span>
  );
}
