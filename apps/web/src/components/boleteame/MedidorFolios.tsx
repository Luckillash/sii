import type { ReactElement } from 'react';
import { type CodigoDte, formatearMiles } from '@/lib/formatos';
import { calcularFolios } from './folios';
import { Glifo } from './Glifo';
import estilos from './MedidorFolios.module.css';
import { TipoDTE } from './TipoDTE';

export type { EntradaFolios, EstadoFolios, ResultadoFolios } from './folios';
export { calcularFolios, UMBRAL_AVISO_FOLIOS } from './folios';

export interface MedidorFoliosProps {
  /** Tipo de DTE del CAF. */
  codigo?: CodigoDte | number;
  /** Primer folio del rango autorizado en el CAF. */
  desde: number;
  /** Último folio del rango autorizado. */
  hasta: number;
  /** Próximo folio que se asignará. */
  siguiente: number;
  /** Fracción restante bajo la cual se avisa. Por defecto 0.15. */
  umbralAviso?: number;
  className?: string;
}

export function MedidorFolios({
  codigo,
  desde,
  hasta,
  siguiente,
  umbralAviso,
  className,
}: MedidorFoliosProps): ReactElement {
  const { total, usados, quedan, estado, pct, nota } = calcularFolios({
    desde: Number(desde),
    hasta: Number(hasta),
    siguiente: Number(siguiente),
    umbralAviso,
  });
  const clases = [
    estilos.folios,
    estado === 'aviso' && estilos.aviso,
    estado === 'error' && estilos.error,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={clases}>
      <div className={estilos.cabecera}>
        {codigo != null ? <TipoDTE codigo={codigo} corto /> : <span>Folios</span>}
        <span className={estilos.cifra}>
          <strong>{formatearMiles(quedan)}</strong> de {formatearMiles(total)} disponibles
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: <meter> no se estila igual en todos los navegadores; se replica el role="meter" del bundle */}
      <div
        className={estilos.barra}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={usados}
        aria-label={`Folios usados: ${usados} de ${total}`}
      >
        <div className={estilos.uso} style={{ width: `${pct}%` }} />
      </div>
      <p className={estilos.nota}>
        {estado !== 'sello' ? (
          <Glifo nombre={estado === 'error' ? 'rechazado' : 'reparos'} size={14} />
        ) : null}
        {nota}
      </p>
    </div>
  );
}
