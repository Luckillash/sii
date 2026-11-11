// Tests de resumirParaRcof (nuevo en el port: el bin enviar-consumo-folios.php
// trae los montos escritos a mano, pend. 5). La paridad con la fórmula del bin
// está en test/paridad/set-completo.test.ts (rcof-set-completo).

import { describe, expect, it } from 'vitest';
import { rangosConsecutivos, resumirParaRcof } from '../../../src/certificacion/resumen-rcof.ts';
import { desdeIso88591 } from '../../../src/comun/codificacion.ts';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import { instanteSii, relojFijo } from '../../../src/comun/reloj.ts';
import { type DetalleBoleta, GeneradorBoleta } from '../../../src/core/generador-boleta.ts';

function dte(
  folio: number,
  detalles: DetalleBoleta[],
  tipoDte = '39',
  ahora = '2026-09-05T10:30:00',
): Buffer {
  return new GeneradorBoleta({ reloj: relojFijo(instanteSii(ahora)) }).generarBoleta({
    emisor: {
      rut: '76123456-0',
      razonSocial: 'EMPRESA DE PRUEBA SPA',
      giro: 'VENTA AL POR MENOR',
      direccion: 'CALLE 1',
      comuna: 'SANTIAGO',
    },
    receptor: { rut: '66666666-6' },
    folio,
    tipoDte,
    detalles,
  });
}

const afecta = (precio: number): DetalleBoleta[] => [{ nombre: 'X', cantidad: 1, precio }];
const exenta = (precio: number): DetalleBoleta[] => [
  { nombre: 'E', cantidad: 1, precio, exento: true },
];

describe('resumirParaRcof', () => {
  it('suma los montos de cada DTE tal como los escribió el generador', () => {
    const r = resumirParaRcof([
      dte(56, afecta(29800)),
      dte(57, [...afecta(12720), ...exenta(2000)]),
    ]);
    // 29800 → 25042 + 4758; 12720 → 10689 + 2031.
    expect(r.resumenes).toEqual([
      {
        tipo: '39',
        neto: 25042 + 10689,
        iva: 4758 + 2031,
        exento: 2000,
        total: 29800 + 12720 + 2000,
        foliosEmitidos: 2,
        foliosAnulados: 0,
        foliosUtilizados: 2,
        rangosUtilizados: [{ inicial: 56, final: 57 }],
        rangosAnulados: [],
      },
    ]);
    expect(r.fchInicio).toBe('2026-09-05');
    expect(r.fchFinal).toBe('2026-09-05');
  });

  it('un resumen por tipo, en orden numérico, aunque el 41 aparezca primero', () => {
    const r = resumirParaRcof([
      dte(3, exenta(5000), '41'),
      dte(10, afecta(1190)),
      dte(4, exenta(100), '41'),
    ]);
    expect(r.resumenes.map((x) => x.tipo)).toEqual(['39', '41']);
    const exentas = r.resumenes[1];
    expect(exentas).toMatchObject({
      neto: 0,
      iva: 0,
      exento: 5100,
      total: 5100,
      foliosEmitidos: 2,
    });
    expect(exentas?.rangosUtilizados).toEqual([{ inicial: 3, final: 4 }]);
  });

  it('folios no consecutivos o desordenados dan varios rangos ordenados', () => {
    const r = resumirParaRcof([60, 56, 58, 57, 62].map((f) => dte(f, afecta(1000))));
    expect(r.resumenes[0]?.rangosUtilizados).toEqual([
      { inicial: 56, final: 58 },
      { inicial: 60, final: 60 },
      { inicial: 62, final: 62 },
    ]);
  });

  it('fchInicio y fchFinal son la menor y la mayor FchEmis', () => {
    const r = resumirParaRcof([
      dte(2, afecta(1000), '39', '2026-09-06T09:00:00'),
      dte(1, afecta(1000), '39', '2026-09-05T23:59:59'),
    ]);
    expect([r.fchInicio, r.fchFinal]).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('lee todos los <Documento> de cada entrada (sirve un sobre) y acepta texto', () => {
    const uno = desdeIso88591(dte(1, afecta(1000)));
    const dos = desdeIso88591(dte(2, afecta(2000))).replace(/^<\?xml[^\n]*\?>\n/, '');
    const sobre = `<EnvioBOLETA xmlns="http://www.sii.cl/SiiDte"><SetDTE>${uno.replace(/^<\?xml[^\n]*\?>\n/, '')}${dos}</SetDTE></EnvioBOLETA>`;
    const r = resumirParaRcof([sobre]);
    expect(r.resumenes[0]).toMatchObject({ total: 3000, foliosEmitidos: 2 });
  });

  it('un folio repetido dentro del mismo tipo es un ErrorValidacion; en otro tipo no', () => {
    expect(() => resumirParaRcof([dte(5, afecta(1)), dte(5, afecta(2))])).toThrow(
      /folio 5 del tipo 39 está repetido/,
    );
    expect(() => resumirParaRcof([dte(5, afecta(1)), dte(5, exenta(2), '41')])).not.toThrow();
  });

  it('sin documentos es un ErrorValidacion', () => {
    expect(() => resumirParaRcof([])).toThrow(ErrorValidacion);
    expect(() => resumirParaRcof(['<Vacio/>'])).toThrow(/No hay documentos/);
  });

  it('montos o folios que no son enteros, o datos que faltan, son un ErrorValidacion', () => {
    const base = desdeIso88591(dte(1, afecta(1000)));
    expect(() => resumirParaRcof([base.replace('<MntTotal>1000<', '<MntTotal>1.0E+14<')])).toThrow(
      /<MntTotal> debe ser un entero/,
    );
    expect(() => resumirParaRcof([base.replace('<Folio>1<', '<Folio>-1<')])).toThrow(
      ErrorValidacion,
    );
    expect(() => resumirParaRcof([base.replace(/<TipoDTE>.*<\/TipoDTE>/, '')])).toThrow(
      /no trae <TipoDTE>/,
    );
    expect(() => resumirParaRcof([base.replace(/<FchEmis>.*<\/FchEmis>/, '')])).toThrow(/FchEmis/);
  });
});

describe('rangosConsecutivos', () => {
  it('agrupa folios consecutivos', () => {
    expect(rangosConsecutivos([])).toEqual([]);
    expect(rangosConsecutivos([7])).toEqual([{ inicial: 7, final: 7 }]);
    expect(rangosConsecutivos([3, 1, 2, 5, 5, 6])).toEqual([
      { inicial: 1, final: 3 },
      { inicial: 5, final: 6 },
    ]);
  });
});
