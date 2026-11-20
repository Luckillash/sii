// Forma común de una exportación (PLAN-SAAS Fase 9): columnas con su tipo y filas de
// valores crudos. Cada formato (`csv.ts`, `xlsx.ts`) decide cómo escribir cada tipo, así
// las filas se arman una sola vez (`filas.ts`). Puro.

import 'server-only';

/**
 * - `texto`: tal cual (en CSV, neutralizado contra fórmulas).
 * - `entero`: número sin separador de miles (folio, código, cantidad).
 * - `monto`: pesos enteros; en Excel con formato de miles.
 * - `fecha`: `AAAA-MM-DD` (columna `date`); en CSV `DD-MM-AAAA`, en Excel una fecha real.
 *   Un texto que no tenga esa forma (p. ej. «Total») se escribe como texto.
 */
export type TipoColumna = 'texto' | 'entero' | 'monto' | 'fecha';

export interface Columna {
  titulo: string;
  tipo: TipoColumna;
  /** Ancho aproximado en caracteres (solo Excel). */
  ancho?: number;
}

export type Valor = string | number | null;

export interface Fila {
  celdas: readonly Valor[];
  /** Fila de totales: en Excel va en negrita. */
  destacada?: boolean;
}

export interface Tabla {
  /** Nombre de la hoja en Excel (máximo 31 caracteres). */
  hoja: string;
  columnas: readonly Columna[];
  filas: readonly Fila[];
}

/** `AAAA-MM-DD` válido como fecha de columna `date`. */
export const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
