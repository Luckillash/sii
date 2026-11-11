import { describe, expect, it } from 'vitest';
import {
  fechaHoraSii,
  fechaSii,
  instanteSii,
  relojFijo,
  relojSistema,
} from '../../../src/comun/reloj.ts';

describe('Reloj', () => {
  it('el reloj fijo siempre devuelve el mismo instante, en copias independientes', () => {
    const reloj = relojFijo('2026-11-05T15:30:00Z');
    const a = reloj.ahora();
    a.setFullYear(2000);
    expect(reloj.ahora().toISOString()).toBe('2026-11-05T15:30:00.000Z');
  });

  it('rechaza un instante inválido', () => {
    expect(() => relojFijo('no es fecha')).toThrow(TypeError);
  });

  it('el reloj del sistema avanza con el tiempo real', () => {
    const antes = Date.now();
    const ahora = relojSistema.ahora().getTime();
    expect(ahora).toBeGreaterThanOrEqual(antes);
    expect(ahora - antes).toBeLessThan(5_000);
  });
});

describe('formato en hora de Chile', () => {
  it('horario de verano (UTC-3)', () => {
    const instante = new Date('2026-11-05T15:30:07Z');
    expect(fechaSii(instante)).toBe('2026-11-05');
    expect(fechaHoraSii(instante)).toBe('2026-11-05T12:30:07');
  });

  it('horario de invierno (UTC-4)', () => {
    expect(fechaHoraSii(new Date('2026-07-01T03:05:00Z'))).toBe('2026-06-30T23:05:00');
    expect(fechaSii(new Date('2026-07-01T03:05:00Z'))).toBe('2026-06-30');
  });

  it('medianoche se escribe 00, no 24', () => {
    expect(fechaHoraSii(new Date('2026-11-05T03:00:00Z'))).toBe('2026-11-05T00:00:00');
  });

  it('no depende de la zona horaria del proceso', () => {
    // 23:30 en Chile ya es el día siguiente en UTC: la fecha de emisión es la de Chile.
    expect(fechaSii(new Date('2026-11-06T02:30:00Z'))).toBe('2026-11-05');
  });
});

describe('instanteSii (inverso de fechaHoraSii)', () => {
  it.each([
    '2026-11-05T12:30:07',
    '2026-06-30T23:05:00',
    '2026-01-01T00:00:00',
    '2026-12-31T23:59:59',
  ])('ida y vuelta: %s', (marca) => {
    expect(fechaHoraSii(instanteSii(marca))).toBe(marca);
  });

  it('acepta solo fecha y devuelve un instante de ese día', () => {
    expect(fechaSii(instanteSii('2026-11-05'))).toBe('2026-11-05');
  });

  it('en el cambio de hora de otoño devuelve la primera ocurrencia', () => {
    // 2026-04-04 24:00 (UTC-3) se atrasa a 23:00 (UTC-4): las 23:30 ocurren dos veces.
    const instante = instanteSii('2026-04-04T23:30:00');
    expect(instante.toISOString()).toBe('2026-04-05T02:30:00.000Z');
  });

  it('rechaza una hora que no existe (salto de primavera)', () => {
    // 2026-09-05 24:00 (UTC-4) se adelanta a 01:00 (UTC-3).
    expect(() => instanteSii('2026-09-06T00:30:00')).toThrow(RangeError);
  });

  it('rechaza formatos inválidos', () => {
    expect(() => instanteSii('05-11-2026')).toThrow(TypeError);
    expect(() => instanteSii('2026-11-05 12:30:07')).toThrow(TypeError);
  });
});
