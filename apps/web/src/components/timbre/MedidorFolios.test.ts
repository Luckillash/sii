import { describe, expect, it } from 'vitest';
import { calcularFolios } from './folios';

describe('calcularFolios', () => {
  it('rango recién cargado: nada usado, estado sello y nota con el rango', () => {
    expect(calcularFolios({ desde: 1001, hasta: 2000, siguiente: 1001 })).toEqual({
      total: 1000,
      usados: 0,
      quedan: 1000,
      estado: 'sello',
      pct: 0,
      nota: 'Rango vigente 1.001 – 2.000.',
    });
  });

  it('porcentaje con un decimal', () => {
    const r = calcularFolios({ desde: 1, hasta: 3, siguiente: 2 });
    expect(r.usados).toBe(1);
    expect(r.quedan).toBe(2);
    expect(r.pct).toBe(33.3);
    expect(r.estado).toBe('sello');
  });

  it('avisa cuando lo que queda es igual o menor al umbral (0.15 por defecto)', () => {
    const justo = calcularFolios({ desde: 1, hasta: 100, siguiente: 86 });
    expect(justo.quedan).toBe(15);
    expect(justo.estado).toBe('aviso');
    expect(justo.nota).toBe('Quedan pocos folios: solicita un nuevo CAF.');

    expect(calcularFolios({ desde: 1, hasta: 100, siguiente: 85 }).estado).toBe('sello');
  });

  it('respeta un umbral propio', () => {
    expect(calcularFolios({ desde: 1, hasta: 100, siguiente: 71, umbralAviso: 0.3 }).estado).toBe(
      'aviso',
    );
    expect(calcularFolios({ desde: 1, hasta: 100, siguiente: 50, umbralAviso: 0.3 }).estado).toBe(
      'sello',
    );
  });

  it('CAF agotado: error y nota que pide un nuevo rango', () => {
    const r = calcularFolios({ desde: 1, hasta: 50, siguiente: 51 });
    expect(r).toMatchObject({ total: 50, usados: 50, quedan: 0, estado: 'error', pct: 100 });
    expect(r.nota).toBe('CAF agotado: solicita un nuevo rango de folios al SII antes de emitir.');
  });

  it('acota siguiente fuera del rango', () => {
    expect(calcularFolios({ desde: 100, hasta: 199, siguiente: 500 }).usados).toBe(100);
    expect(calcularFolios({ desde: 100, hasta: 199, siguiente: 10 }).usados).toBe(0);
  });

  it('rango inválido (hasta < desde): total 0, agotado, sin dividir por cero', () => {
    expect(calcularFolios({ desde: 10, hasta: 5, siguiente: 10 })).toMatchObject({
      total: 0,
      usados: 0,
      quedan: 0,
      estado: 'error',
      pct: 0,
    });
  });
});
