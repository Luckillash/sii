// Deriva de winex/certificacion v1.9.1 (src/Postulacion/Rut.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript;
// pasa a `comun` para que lo usen todos los módulos (pend. 2.3).

import { ErrorValidacion } from './errores.ts';

/**
 * RUT chileno validado (dígito verificador incluido). Acepta "76123456-0",
 * "76.123.456-0" o "761234560". El DV `k` se normaliza a `K`.
 */
export class Rut {
  /** Número sin puntos ni ceros a la izquierda. */
  readonly numero: string;
  /** Dígito verificador: `0`–`9` o `K`. */
  readonly dv: string;

  private constructor(numero: string, dv: string) {
    this.numero = numero;
    this.dv = dv;
  }

  /**
   * @param campo nombre del campo para el mensaje de error (p. ej. "RUT de la empresa")
   * @throws ErrorValidacion si el formato o el dígito verificador no son válidos
   */
  static de(rut: string, campo = 'RUT'): Rut {
    const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
    const cuerpo = limpio.slice(0, -1);

    if (limpio.length < 2 || limpio.length > 9 || !/^\d+$/.test(cuerpo)) {
      throw new ErrorValidacion(`${campo} inválido: ${rut}.`);
    }

    const numero = cuerpo.replace(/^0+/, '');
    const dv = limpio.slice(-1);

    if (numero === '' || calcularDv(numero) !== dv) {
      throw new ErrorValidacion(`${campo} inválido (dígito verificador): ${rut}.`);
    }

    return new Rut(numero, dv);
  }

  /** `true` si `rut` es un RUT válido (mismas reglas que `Rut.de`). */
  static esValido(rut: string): boolean {
    try {
      Rut.de(rut);
      return true;
    } catch {
      return false;
    }
  }

  /** Formato que usa el SII en los XML: `76123456-0`. */
  toString(): string {
    return `${this.numero}-${this.dv}`;
  }

  equals(otro: Rut): boolean {
    return this.numero === otro.numero && this.dv === otro.dv;
  }
}

/** Dígito verificador por módulo 11. */
export function calcularDv(numero: string): string {
  let suma = 0;
  let factor = 2;

  for (let i = numero.length - 1; i >= 0; i--) {
    suma += Number(numero[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}
