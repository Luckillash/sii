import type { ReactElement } from 'react';
import { Alerta } from './Alerta';

export interface BannerAmbienteProps {
  ambiente: 'certificacion' | 'produccion';
  className?: string;
}

/**
 * Franja fija arriba de la página mientras el ambiente sea certificación; en
 * producción no muestra nada.
 */
export function BannerAmbiente({ ambiente, className }: BannerAmbienteProps): ReactElement | null {
  if (ambiente !== 'certificacion') return null;
  return (
    <Alerta
      tono="info"
      titulo="Estás en el ambiente de certificación del SII"
      className={className}
    >
      Los documentos que emitas aquí no tienen validez tributaria.
    </Alerta>
  );
}
