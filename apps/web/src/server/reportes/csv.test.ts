import { describe, expect, it } from 'vitest';
import { generarCsv, neutralizarFormula } from './csv';
import type { Tabla } from './tabla';

const tabla = (filas: Tabla['filas'], columnas?: Tabla['columnas']): Tabla => ({
  hoja: 'Prueba',
  columnas: columnas ?? [
    { titulo: 'Texto', tipo: 'texto' },
    { titulo: 'Monto', tipo: 'monto' },
    { titulo: 'Fecha', tipo: 'fecha' },
  ],
  filas,
});

const lineas = (b: Buffer) => b.toString('utf8').replace(/^﻿/, '').split('\r\n');

describe('generarCsv', () => {
  it('lleva BOM UTF-8, separador «;» y CRLF, con una línea final', () => {
    const b = generarCsv(tabla([{ celdas: ['Ñuñoa', 1190, '2026-11-17'] }]));
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texto = b.toString('utf8');
    expect(texto).toBe('﻿Texto;Monto;Fecha\r\nÑuñoa;1190;17-11-2026\r\n');
  });

  it('montos como enteros sin formato y negativos intactos', () => {
    const [, fila] = lineas(generarCsv(tabla([{ celdas: ['x', -220150, null] }])));
    expect(fila).toBe('x;-220150;');
  });

  it('cita según RFC 4180: separador, comillas, saltos de línea y espacios en los bordes', () => {
    const l = lineas(
      generarCsv(
        tabla(
          [
            { celdas: ['A;B'] },
            { celdas: ['Dice "hola"'] },
            { celdas: ['línea 1\nlínea 2'] },
            { celdas: [' con espacio'] },
          ],
          [{ titulo: 'T', tipo: 'texto' }],
        ),
      ),
    );
    expect(l[1]).toBe('"A;B"');
    expect(l[2]).toBe('"Dice ""hola"""');
    // El salto de línea va dentro de las comillas: el split por CRLF no lo corta.
    expect(l[3]).toBe('"línea 1\nlínea 2"');
    expect(l[4]).toBe('" con espacio"');
  });

  it('neutraliza fórmulas solo en celdas de texto', () => {
    const l = lineas(
      generarCsv(
        tabla(
          [
            { celdas: ['=HYPERLINK("http://x")', -5] },
            { celdas: ['+56 9', 0] },
            { celdas: ['-1+1', 1] },
            { celdas: ['@SUM(A1)', 2] },
            { celdas: ['\tTab', 3] },
            { celdas: ['Ferretería = Roble', 4] },
          ],
          [
            { titulo: 'T', tipo: 'texto' },
            { titulo: 'N', tipo: 'monto' },
          ],
        ),
      ),
    );
    expect(l[1]).toBe(`"'=HYPERLINK(""http://x"")";-5`);
    expect(l[2]).toBe("'+56 9;0");
    expect(l[3]).toBe("'-1+1;1");
    expect(l[4]).toBe("'@SUM(A1);2");
    expect(l[5]).toBe("'\tTab;3");
    expect(l[6]).toBe('Ferretería = Roble;4');
  });

  it('una fecha que no es AAAA-MM-DD va como texto (p. ej. «Total»)', () => {
    const [, fila] = lineas(generarCsv(tabla([{ celdas: ['', 10, 'Total'] }])));
    expect(fila).toBe(';10;Total');
  });

  it('valores no finitos y celdas faltantes quedan vacíos', () => {
    const [, fila] = lineas(generarCsv(tabla([{ celdas: ['a', Number.NaN] }])));
    expect(fila).toBe('a;;');
  });
});

describe('neutralizarFormula', () => {
  it('antepone apóstrofo a =, +, -, @, tab y CR', () => {
    for (const c of ['=', '+', '-', '@', '\t', '\r'])
      expect(neutralizarFormula(`${c}x`)).toBe(`'${c}x`);
    expect(neutralizarFormula('Comercial')).toBe('Comercial');
    expect(neutralizarFormula('')).toBe('');
  });
});
