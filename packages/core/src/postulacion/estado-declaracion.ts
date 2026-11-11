// Deriva de winex/certificacion v1.9.1 (src/Postulacion/EstadoDeclaracion.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.

import type { Rut } from '../comun/rut.ts';

/**
 * Estado de la certificación de boletas de una empresa en www4 (tabla de
 * seguimiento del SII). Códigos vistos: P90 = falta declarar cumplimiento,
 * P91 = declaración efectuada (autorizada en producción).
 */
export class EstadoDeclaracion {
  readonly empresa: Rut;
  /** `null` si el SII no tiene la empresa en el proceso de boletas. */
  readonly codigo: string | null;
  readonly glosa: string;
  /** Código numérico del paso (90), el que se reenvía al declarar. */
  readonly paso: number | null;

  constructor(empresa: Rut, codigo: string | null, glosa: string, paso: number | null) {
    this.empresa = empresa;
    this.codigo = codigo;
    this.glosa = glosa;
    this.paso = paso;
  }

  /** Se puede declarar cumplimiento (P90). */
  porDeclarar(): boolean {
    return this.codigo === 'P90';
  }

  /** Declaración efectuada: autorizada en producción (P91). */
  autorizada(): boolean {
    return this.codigo === 'P91';
  }
}
