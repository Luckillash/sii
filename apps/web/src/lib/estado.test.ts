import { describe, expect, it } from 'vitest';
import {
  ETIQUETA_NIVEL,
  estadoBaseDatos,
  estadoSeguimiento,
  estadoSii,
  LATENCIA_DEMORAS_MS,
  MINUTOS_CORRIDA_VIGENTE,
  type NivelEstado,
  nivelGeneral,
  nivelResumen,
  nivelSeguimiento,
  nivelSii,
  RESUMEN_GENERAL,
  SIN_MEDICIONES,
  TONO_NIVEL,
} from './estado';

const AHORA = new Date('2026-11-19T15:00:00Z');
const haceMin = (min: number) => new Date(AHORA.getTime() - min * 60_000);

describe('etiquetas', () => {
  it('usa los cuatro textos de la página y un tono por nivel', () => {
    expect(ETIQUETA_NIVEL).toEqual({
      operativo: 'Operativo',
      demoras: 'Con demoras',
      problemas: 'Con problemas',
      sin_datos: 'Sin datos',
    });
    expect(Object.keys(TONO_NIVEL).sort()).toEqual(Object.keys(ETIQUETA_NIVEL).sort());
    expect(Object.keys(RESUMEN_GENERAL).sort()).toEqual(Object.keys(ETIQUETA_NIVEL).sort());
  });
});

describe('estadoBaseDatos', () => {
  it('sin medición: sin datos', () => {
    expect(estadoBaseDatos(null).nivel).toBe('sin_datos');
  });

  it('una lectura fallida es un problema', () => {
    expect(estadoBaseDatos({ ok: false, ms: 20 }).nivel).toBe('problemas');
  });

  it('lenta: con demoras desde el umbral', () => {
    expect(estadoBaseDatos({ ok: true, ms: LATENCIA_DEMORAS_MS - 1 }).nivel).toBe('operativo');
    expect(estadoBaseDatos({ ok: true, ms: LATENCIA_DEMORAS_MS }).nivel).toBe('demoras');
  });
});

describe('nivelSii', () => {
  it('sin lectura o sin operaciones: sin datos', () => {
    expect(nivelSii(null)).toBe('sin_datos');
    expect(nivelSii({ respondidas: 0, fallas: 0 })).toBe('sin_datos');
  });

  it('sin fallas: operativo', () => {
    expect(nivelSii({ respondidas: 1, fallas: 0 })).toBe('operativo');
    expect(nivelSii({ respondidas: 500, fallas: 0 })).toBe('operativo');
  });

  it('fallas aisladas (menos del 10 %): operativo', () => {
    expect(nivelSii({ respondidas: 19, fallas: 1 })).toBe('operativo');
  });

  it('desde el 10 % de fallas: con demoras', () => {
    expect(nivelSii({ respondidas: 9, fallas: 1 })).toBe('demoras');
    expect(nivelSii({ respondidas: 10, fallas: 3 })).toBe('demoras');
  });

  it('una o dos fallas sin respuestas no alcanzan para «Con problemas»', () => {
    expect(nivelSii({ respondidas: 0, fallas: 1 })).toBe('demoras');
    expect(nivelSii({ respondidas: 0, fallas: 2 })).toBe('demoras');
  });

  it('al menos 3 fallas y la mitad o más: con problemas', () => {
    expect(nivelSii({ respondidas: 0, fallas: 3 })).toBe('problemas');
    expect(nivelSii({ respondidas: 3, fallas: 3 })).toBe('problemas');
    expect(nivelSii({ respondidas: 4, fallas: 3 })).toBe('demoras');
  });

  it('ignora conteos negativos', () => {
    expect(nivelSii({ respondidas: -5, fallas: 0 })).toBe('sin_datos');
  });
});

describe('estadoSii', () => {
  it('«Sin datos» usa una frase neutra: no distingue una lectura fallida de una hora sin actividad', () => {
    expect(estadoSii(null)).toEqual({ nivel: 'sin_datos', detalle: SIN_MEDICIONES });
    expect(estadoSii({ respondidas: 0, fallas: 0 })).toEqual({
      nivel: 'sin_datos',
      detalle: SIN_MEDICIONES,
    });
    expect(SIN_MEDICIONES).toBe('Sin mediciones recientes.');
  });

  it('la frase depende solo del nivel: no revela conteos, fallas sueltas ni actividad', () => {
    expect(estadoSii({ respondidas: 30, fallas: 1 }).detalle).toBe(
      estadoSii({ respondidas: 500, fallas: 0 }).detalle,
    );
    const frases = [
      estadoSii({ respondidas: 30, fallas: 0 }),
      estadoSii({ respondidas: 9, fallas: 1 }),
      estadoSii({ respondidas: 0, fallas: 3 }),
      estadoSii(null),
    ];
    expect(frases.map((f) => f.nivel)).toEqual(['operativo', 'demoras', 'problemas', 'sin_datos']);
    for (const { detalle } of frases) {
      expect(detalle).not.toMatch(/\d/);
      expect(detalle).not.toMatch(/última hora|No hubo operaciones|aisladas/);
    }
  });
});

describe('nivelSeguimiento', () => {
  it('sin lectura: sin datos', () => {
    expect(nivelSeguimiento(null, AHORA)).toBe('sin_datos');
  });

  it('sin envíos atrasados: operativo, aunque no haya corridas recientes', () => {
    expect(nivelSeguimiento({ atrasados: 0, ultimaCorridaOk: null }, AHORA)).toBe('operativo');
    expect(nivelSeguimiento({ atrasados: 0, ultimaCorridaOk: haceMin(600) }, AHORA)).toBe(
      'operativo',
    );
  });

  it('con atrasados y una corrida ok reciente: operativo (atrasados de clientes puntuales)', () => {
    expect(nivelSeguimiento({ atrasados: 2, ultimaCorridaOk: haceMin(4) }, AHORA)).toBe(
      'operativo',
    );
    expect(
      nivelSeguimiento({ atrasados: 40, ultimaCorridaOk: haceMin(MINUTOS_CORRIDA_VIGENTE) }, AHORA),
    ).toBe('operativo');
  });

  it('con atrasados y ninguna corrida ok en la última hora: con problemas', () => {
    expect(
      nivelSeguimiento(
        { atrasados: 1, ultimaCorridaOk: haceMin(MINUTOS_CORRIDA_VIGENTE + 1) },
        AHORA,
      ),
    ).toBe('problemas');
    expect(nivelSeguimiento({ atrasados: 1, ultimaCorridaOk: null }, AHORA)).toBe('problemas');
    expect(nivelSeguimiento({ atrasados: 1, ultimaCorridaOk: new Date('x') }, AHORA)).toBe(
      'problemas',
    );
  });

  it('nunca marca demoras: un cliente puntual no es una demora global', () => {
    for (const minutos of [0, 5, 30, 60, 61, 600]) {
      expect(nivelSeguimiento({ atrasados: 3, ultimaCorridaOk: haceMin(minutos) }, AHORA)).not.toBe(
        'demoras',
      );
    }
  });

  it('cada nivel trae su frase', () => {
    const niveles: NivelEstado[] = ['operativo', 'operativo', 'problemas', 'sin_datos'];
    const frases = [
      estadoSeguimiento({ atrasados: 0, ultimaCorridaOk: null }, AHORA),
      estadoSeguimiento({ atrasados: 1, ultimaCorridaOk: haceMin(1) }, AHORA),
      estadoSeguimiento({ atrasados: 1, ultimaCorridaOk: null }, AHORA),
      estadoSeguimiento(null, AHORA),
    ];
    expect(frases.map((f) => f.nivel)).toEqual(niveles);
    expect(frases[0]?.detalle).toBe(frases[1]?.detalle);
    expect(new Set(frases.map((f) => f.detalle)).size).toBe(3);
    expect(frases[3]?.detalle).toBe(SIN_MEDICIONES);
  });
});

describe('nivelGeneral', () => {
  it('toma el peor nivel medido', () => {
    expect(nivelGeneral(['operativo', 'demoras', 'operativo'])).toBe('demoras');
    expect(nivelGeneral(['demoras', 'problemas', 'operativo'])).toBe('problemas');
  });

  it('«Sin datos» no empeora el resumen', () => {
    expect(nivelGeneral(['operativo', 'sin_datos'])).toBe('operativo');
    expect(nivelGeneral(['sin_datos', 'sin_datos'])).toBe('sin_datos');
    expect(nivelGeneral([])).toBe('sin_datos');
  });
});

describe('nivelResumen', () => {
  it('toma el peor nivel entre la base y las demás filas', () => {
    expect(nivelResumen('operativo', ['operativo', 'sin_datos'])).toBe('operativo');
    expect(nivelResumen('operativo', ['demoras', 'operativo'])).toBe('demoras');
    expect(nivelResumen('problemas', ['operativo'])).toBe('problemas');
  });

  it('sin medir la base nunca dice «Todo funciona con normalidad»', () => {
    expect(nivelResumen('sin_datos', ['operativo', 'operativo'])).toBe('sin_datos');
    expect(nivelResumen('sin_datos', ['sin_datos', 'sin_datos'])).toBe('sin_datos');
    // Una demora o un problema medido igual se muestra.
    expect(nivelResumen('sin_datos', ['problemas'])).toBe('problemas');
  });

  it('el resumen «Sin datos» lo dice, sin afirmar que todo funciona', () => {
    expect(RESUMEN_GENERAL.sin_datos).toMatch(/^Sin datos/);
    expect(RESUMEN_GENERAL.sin_datos).not.toMatch(/normalidad/);
  });
});
