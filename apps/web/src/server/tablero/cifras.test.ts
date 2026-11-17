import { describe, expect, it } from 'vitest';
import type { ResumenTipo } from '../folios/tipos';
import {
  alertasFolios,
  type ConteoEstados,
  calcularVentas,
  cifrasDocumentos,
  conteoVacio,
  detalleExento,
  detalleVentas,
  leerFiltrosTablero,
  medidorFoliosTablero,
  opcionesPeriodoTablero,
} from './cifras';

const AHORA = new Date('2026-11-17T15:00:00Z');
const EMPRESA = '8a7c4efb-5829-4b11-b23d-632779a33837';

describe('leerFiltrosTablero', () => {
  it('lee empresa, ambiente y período de la URL', () => {
    expect(
      leerFiltrosTablero({ empresa: EMPRESA, ambiente: 'produccion', periodo: '2026-10' }, AHORA),
    ).toEqual({ empresa: EMPRESA, ambiente: 'produccion', periodo: '2026-10' });
  });

  it('sin parámetros: empresa y ambiente por resolver, mes actual en Chile', () => {
    expect(leerFiltrosTablero({}, AHORA)).toEqual({
      empresa: null,
      ambiente: null,
      periodo: '2026-11',
    });
  });

  it('«todos» y valores inválidos vuelven al mes actual', () => {
    expect(leerFiltrosTablero({ periodo: 'todos' }, AHORA).periodo).toBe('2026-11');
    expect(leerFiltrosTablero({ periodo: '2026-13', ambiente: 'x' }, AHORA)).toMatchObject({
      periodo: '2026-11',
      ambiente: null,
    });
  });

  it('el mes actual se toma en hora de Chile', () => {
    // 1 de diciembre 01:00 UTC = 30 de noviembre en Chile.
    expect(leerFiltrosTablero({}, new Date('2026-12-01T01:00:00Z')).periodo).toBe('2026-11');
  });
});

describe('opcionesPeriodoTablero', () => {
  it('12 meses, sin «Todos los períodos»', () => {
    const o = opcionesPeriodoTablero('2026-11', AHORA);
    expect(o).toHaveLength(12);
    expect(o[0]).toEqual({ valor: '2026-11', texto: 'Noviembre 2026' });
    expect(o.some((x) => x.valor === 'todos')).toBe(false);
  });

  it('agrega el pedido si es más antiguo', () => {
    expect(opcionesPeriodoTablero('2024-03', AHORA).at(-1)).toEqual({
      valor: '2024-03',
      texto: 'Marzo 2024',
    });
  });
});

describe('calcularVentas', () => {
  it('suma las filas diarias (números o texto) y cuenta los documentos', () => {
    expect(
      calcularVentas([
        { documentos: 1, mnt_neto: 1000, iva: 190, mnt_exe: 0, mnt_total: 1190 },
        { documentos: '1', mnt_neto: '1000', iva: '190', mnt_exe: '0', mnt_total: '1190' },
      ]),
    ).toEqual({ neto: 2000, iva: 380, exento: 0, total: 2380, documentos: 2 });
  });

  it('sin filas da cero; los nulos cuentan 0', () => {
    expect(calcularVentas([])).toEqual({ neto: 0, iva: 0, exento: 0, total: 0, documentos: 0 });
    expect(
      calcularVentas([
        { documentos: null, mnt_neto: null, iva: null, mnt_exe: 500, mnt_total: 500 },
      ]),
    ).toEqual({ neto: 0, iva: 0, exento: 500, total: 500, documentos: 0 });
  });

  it('resta los documentos del set de pruebas (uno por fila)', () => {
    expect(
      calcularVentas(
        [{ documentos: 12, mnt_neto: 12_000, iva: 2_280, mnt_exe: 3_000, mnt_total: 17_280 }],
        [
          { mnt_neto: 4_000, iva: 760, mnt_exe: 0, mnt_total: 4_760 },
          { mnt_neto: 0, iva: 0, mnt_exe: 3_000, mnt_total: 3_000 },
        ],
      ),
    ).toEqual({ neto: 8_000, iva: 1_520, exento: 0, total: 9_520, documentos: 10 });
  });
});

describe('textos de ventas', () => {
  it('cuenta las boletas aceptadas', () => {
    expect(detalleVentas({ documentos: 0 })).toBe('Aún no hay boletas aceptadas en el período');
    expect(detalleVentas({ documentos: 1 })).toBe('1 boleta aceptada por el SII');
    expect(detalleVentas({ documentos: 1240 })).toBe('1.240 boletas aceptadas por el SII');
  });

  it('el exento solo si hay', () => {
    expect(detalleExento({ exento: 0 })).toBeNull();
    expect(detalleExento({ exento: 12_500 })).toBe('Más $ 12.500 exentos');
  });
});

function conteo(c: Partial<ConteoEstados>): ConteoEstados {
  return { ...conteoVacio(), ...c };
}

describe('cifrasDocumentos', () => {
  it('como la plantilla: aceptados, con reparos y rechazados', () => {
    expect(
      cifrasDocumentos(
        conteo({ aceptado: 124, aceptado_con_reparos: 1, rechazado: 1, enviado: 2 }),
      ),
    ).toEqual({
      emitidos: 128,
      esperando: 2,
      detalle: '124 aceptados · 1 con reparos · 1 rechazado · 2 enviados',
      anulados: null,
    });
  });

  it('singulares y los demás estados solo si hay', () => {
    expect(cifrasDocumentos(conteo({ aceptado: 1 })).detalle).toBe(
      '1 aceptado · 0 con reparos · 0 rechazados',
    );
    expect(
      cifrasDocumentos(conteo({ aceptado: 2, incierto: 1, firmado: 3, enviado: 1 })).detalle,
    ).toBe('2 aceptados · 0 con reparos · 0 rechazados · 1 enviado · 1 por verificar · 3 firmados');
  });

  it('los anulados no cuentan como emitidos y se dicen aparte', () => {
    const c = cifrasDocumentos(conteo({ aceptado: 2, anulado: 1 }));
    expect(c.emitidos).toBe(2);
    expect(c.anulados).toBe('Sin contar 1 anulado');
    expect(cifrasDocumentos(conteo({ anulado: 3 })).anulados).toBe('Sin contar 3 anulados');
  });

  it('todo en cero', () => {
    expect(cifrasDocumentos(conteoVacio())).toEqual({
      emitidos: 0,
      esperando: 0,
      detalle: '0 aceptados · 0 con reparos · 0 rechazados',
      anulados: null,
    });
  });
});

function resumen(r: Partial<ResumenTipo> & Pick<ResumenTipo, 'tipoDte'>): ResumenTipo {
  return {
    ambiente: 'produccion',
    enUso: null,
    disponibles: 0,
    total: 0,
    estado: 'error',
    tuvoCaf: false,
    puedeEmitir: false,
    ...r,
  };
}

describe('medidorFoliosTablero', () => {
  it('con un solo CAF usa su rango real', () => {
    expect(
      medidorFoliosTablero(
        resumen({
          tipoDte: 39,
          enUso: { id: 'c1', desde: 41, hasta: 45, siguiente: 43 },
          disponibles: 3,
          total: 5,
          estado: 'sello',
          tuvoCaf: true,
        }),
      ),
    ).toEqual({ desde: 41, hasta: 45, siguiente: 43, varios: false });
  });

  it('con dos CAF muestra el total, como la alerta (sin «3 de 100» en aviso)', () => {
    const r = resumen({
      tipoDte: 39,
      enUso: { id: 'a', desde: 1, hasta: 100, siguiente: 98 },
      disponibles: 1_003,
      total: 1_100,
      estado: 'sello',
      tuvoCaf: true,
    });
    const m = medidorFoliosTablero(r);
    expect(m).toEqual({ desde: 1, hasta: 1_100, siguiente: 98, varios: true });
    // Mismos números que la alerta: 1.003 de 1.100 y sin alerta.
    expect(m ? m.hasta - m.siguiente + 1 : null).toBe(1_003);
    expect(alertasFolios([r], 'produccion')).toEqual([]);
  });

  it('con varios CAF bajo el umbral, el medidor también queda en aviso', () => {
    const m = medidorFoliosTablero(
      resumen({
        tipoDte: 39,
        enUso: { id: 'a', desde: 1, hasta: 100, siguiente: 95 },
        disponibles: 16,
        total: 110,
        estado: 'aviso',
        tuvoCaf: true,
      }),
    );
    expect(m).toEqual({ desde: 1, hasta: 110, siguiente: 95, varios: true });
  });

  it('sin CAF en uso no hay medidor', () => {
    expect(medidorFoliosTablero(resumen({ tipoDte: 41, tuvoCaf: true }))).toBeNull();
  });
});

describe('alertasFolios', () => {
  it('sin alertas con folios de sobra o sin CAF nunca', () => {
    expect(
      alertasFolios(
        [
          resumen({ tipoDte: 39, estado: 'sello', disponibles: 90, total: 100, tuvoCaf: true }),
          resumen({ tipoDte: 41 }),
        ],
        'produccion',
      ),
    ).toEqual([]);
  });

  it('agotado (error) y por agotarse (aviso), solo del ambiente elegido', () => {
    const a = alertasFolios(
      [
        resumen({ tipoDte: 39, estado: 'aviso', disponibles: 10, total: 100, tuvoCaf: true }),
        resumen({ tipoDte: 41, estado: 'error', tuvoCaf: true }),
        resumen({ tipoDte: 39, ambiente: 'certificacion', estado: 'error', tuvoCaf: true }),
      ],
      'produccion',
    );
    expect(a).toEqual([
      {
        tono: 'error',
        titulo: 'Se acabaron los folios de boleta exenta',
        detalle:
          'No puedes emitir documentos de ese tipo hasta que pidas o subas un CAF nuevo en Folios.',
      },
      {
        tono: 'aviso',
        titulo: 'Quedan pocos folios de boleta',
        detalle:
          'Quedan 10 folios de boleta. Pide un CAF nuevo antes de que se acaben para no interrumpir la emisión.',
      },
    ]);
  });

  it('junta los dos tipos en una alerta y usa el singular', () => {
    const a = alertasFolios(
      [
        resumen({ tipoDte: 39, estado: 'aviso', disponibles: 1, total: 50, tuvoCaf: true }),
        resumen({ tipoDte: 41, estado: 'aviso', disponibles: 3, total: 50, tuvoCaf: true }),
      ],
      'produccion',
    );
    expect(a).toHaveLength(1);
    expect(a[0]?.titulo).toBe('Quedan pocos folios de boleta y boleta exenta');
    expect(a[0]?.detalle).toMatch(/^Quedan 1 folio de boleta y 3 folios de boleta exenta\./);
    const uno = alertasFolios(
      [resumen({ tipoDte: 39, estado: 'aviso', disponibles: 1, total: 50, tuvoCaf: true })],
      'produccion',
    );
    expect(uno[0]?.detalle).toMatch(/^Queda 1 folio de boleta\./);
  });
});
