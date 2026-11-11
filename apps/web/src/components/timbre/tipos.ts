// Tipos compartidos de los componentes «Timbre».

import type { CodigoDte } from '@/lib/formatos';

export type { CodigoDte };

/** Estado de vida de un DTE. `incierto` (D3): envío sin Track ID, no se sabe si llegó al SII. */
export type EstadoDte =
  | 'borrador'
  | 'firmado'
  | 'enviado'
  | 'aceptado'
  | 'reparos'
  | 'rechazado'
  | 'anulado'
  | 'incierto';

/** Tonos semánticos de Alerta. */
export type Tono = 'info' | 'exito' | 'aviso' | 'error';

/** Tonos visuales internos (EstadoDTE agrega `neutro` y `sello`). */
export type TonoVisual = Tono | 'neutro' | 'sello';

export interface DocumentoFila {
  id: string;
  tipo: CodigoDte | number;
  folio: number;
  receptor: string;
  /** En cualquier formato; la tabla lo normaliza. */
  rut: string;
  /** Ya formateada: '10-11-2026'. */
  fecha: string;
  total: number;
  moneda?: string;
  estado: EstadoDte;
}
