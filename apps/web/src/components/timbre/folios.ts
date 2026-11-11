// Cálculo puro del MedidorFolios: sin React, sirve también en el servidor
// (p. ej. para deshabilitar la emisión cuando el CAF está agotado).

import { formatearMiles } from '@/lib/formatos';

export type EstadoFolios = 'sello' | 'aviso' | 'error';

export interface EntradaFolios {
  /** Primer folio del rango autorizado en el CAF. */
  desde: number;
  /** Último folio del rango autorizado. */
  hasta: number;
  /** Próximo folio que se asignará. */
  siguiente: number;
  /** Fracción restante bajo la cual se avisa. Por defecto 0.15. */
  umbralAviso?: number;
}

export interface ResultadoFolios {
  total: number;
  usados: number;
  quedan: number;
  estado: EstadoFolios;
  /** Porcentaje usado, con un decimal (0–100). */
  pct: number;
  nota: string;
}

export const UMBRAL_AVISO_FOLIOS = 0.15;

export function calcularFolios({
  desde,
  hasta,
  siguiente,
  umbralAviso = UMBRAL_AVISO_FOLIOS,
}: EntradaFolios): ResultadoFolios {
  const total = Math.max(0, hasta - desde + 1);
  const usados = Math.min(total, Math.max(0, siguiente - desde));
  const quedan = total - usados;
  const estado: EstadoFolios =
    quedan === 0 ? 'error' : total && quedan / total <= umbralAviso ? 'aviso' : 'sello';
  const pct = total ? Math.round((usados / total) * 1000) / 10 : 0;
  const nota =
    estado === 'error'
      ? 'CAF agotado: solicita un nuevo rango de folios al SII antes de emitir.'
      : estado === 'aviso'
        ? 'Quedan pocos folios: solicita un nuevo CAF.'
        : `Rango vigente ${formatearMiles(desde)} – ${formatearMiles(hasta)}.`;
  return { total, usados, quedan, estado, pct, nota };
}
