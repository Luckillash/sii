// Port de tests/Postulacion/RutTest.php (winex/certificacion v1.9.1).

import { describe, expect, it } from 'vitest';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import { calcularDv, Rut } from '../../../src/comun/rut.ts';

describe('Rut', () => {
  it.each([
    ['con guion', '76123456-0', '76123456-0'],
    ['con puntos', '76.123.456-0', '76123456-0'],
    ['sin separadores', '761234560', '76123456-0'],
    ['DV numérico', '12345678-5', '12345678-5'],
    ['DV K en mayúscula', '60803000-K', '60803000-K'],
    ['DV k en minúscula', '60803000-k', '60803000-K'],
    ['RUT genérico de boletas', '66666666-6', '66666666-6'],
    ['ceros a la izquierda', '01.234.567-4', '1234567-4'],
  ])('acepta el formato %s', (_nombre, entrada, esperado) => {
    expect(String(Rut.de(entrada))).toBe(esperado);
  });

  it.each([
    ['DV equivocado', '76123456-9'],
    ['vacío', ''],
    ['solo un carácter', '7'],
    ['letras en el número', '7A123456-0'],
    ['demasiado largo', '7612345678-0'],
    ['solo el DV', 'K'],
    ['K en el número', '7K123456-0'],
    ['solo ceros', '0-0'],
    ['más de 9 caracteres aunque sean ceros (igual que el PHP)', '076.123.456-0'],
  ])('rechaza RUT inválido: %s', (_nombre, entrada) => {
    expect(() => Rut.de(entrada)).toThrow(ErrorValidacion);
    expect(Rut.esValido(entrada)).toBe(false);
  });

  it('el mensaje incluye el nombre del campo', () => {
    expect(() => Rut.de('76123456-9', 'RUT de la empresa')).toThrow(/RUT de la empresa/);
  });

  it('separa número y DV', () => {
    const rut = Rut.de('76.123.456-0');
    expect(rut.numero).toBe('76123456');
    expect(rut.dv).toBe('0');
    expect(rut.equals(Rut.de('761234560'))).toBe(true);
  });

  it('calcula el DV por módulo 11, incluidos 0 y K', () => {
    expect(calcularDv('76123456')).toBe('0');
    expect(calcularDv('60803000')).toBe('K');
    expect(calcularDv('12345678')).toBe('5');
  });
});
