// Port de tests/Certificacion/SetPruebasParserTest.php (winex/certificacion v1.9.1,
// Apache-2.0), más los casos propios del port (contenido en bytes o string,
// codificación, blancos de PCRE, errores tipados).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsearSetPruebas } from '../../../src/certificacion/set-pruebas.ts';
import { aIso88591 } from '../../../src/comun/codificacion.ts';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import { RAIZ_PARIDAD } from '../../soporte/paridad.ts';

const SET = `SII SET DE PRUEBA DE BOLETA ELECTRONICA DE VENTAS Y SERVICIOS

CASO-1
==========

Item\t\t\t\t\tCantidad\tPrecio Unitario con IVA
Cambio de aceite\t\t\t1\t\t\t19900
Alineacion y balanceo \t\t\t1\t\t\t9900


CASO-2
=========

Item\t\t\t\t\tCantidad\tPrecio Unitario con IVA
Papel de regalo\t\t\t\t17\t\t\t120


CASO-4
=========

Item\t\t\t\t\tCantidad\tPrecio Unitario con IVA
item afecto 1\t\t\t\t8\t\t\t1590
item exento 2\t\t\t\t2\t\t\t1000


OBSERVACION: "El item 1 es un servicio afecto. El item 2 es un servicio exento."


CASO-5
=========

Item\t\t\t\t\tCantidad\tPrecio Unitario con IVA
Arroz\t\t\t\t\t5\t\t\t700


OBSERVACION: "Se debe informar en el XML Unidad de medida en Kg."

==========================================================================

OBSERVACIONES GENERALES`;

/** Un caso con las líneas de ítems y la observación indicadas. */
function caso(lineas: string, numero = 1): string {
  return `CASO-${numero}\n=====\n\nItem\t\tCantidad\tPrecio\n${lineas}\n`;
}

describe('parsearSetPruebas (port de SetPruebasParserTest)', () => {
  it('lee todos los casos en orden', () => {
    const casos = parsearSetPruebas(SET);

    expect(casos).toHaveLength(4);
    expect(casos.map((c) => c.referencia.razon)).toEqual(['CASO-1', 'CASO-2', 'CASO-4', 'CASO-5']);
    expect(casos[0]?.referencia.codigo).toBe('SET');
    expect(casos[0]?.tipo).toBe('39');
  });

  it('lee ítems, cantidades y precios', () => {
    const casos = parsearSetPruebas(SET);

    expect(casos[0]?.detalles).toStrictEqual([
      { nombre: 'Cambio de aceite', cantidad: 1, precio: 19900 },
      { nombre: 'Alineacion y balanceo', cantidad: 1, precio: 9900 },
    ]);
    expect(casos[1]?.detalles[0]?.cantidad).toBe(17);
  });

  it('marca como exento solo el ítem indicado', () => {
    const det = parsearSetPruebas(SET)[2]?.detalles;

    expect(det?.[0]).not.toHaveProperty('exento');
    expect(det?.[1]?.exento).toBe(true);
  });

  it('aplica la unidad de medida de la observación', () => {
    expect(parsearSetPruebas(SET)[3]?.detalles[0]?.unidad).toBe('Kg');
  });

  it('acepta saltos de línea de Windows', () => {
    const casos = parsearSetPruebas(SET.replaceAll('\n', '\r\n'));

    expect(casos).toHaveLength(4);
    expect(casos[0]?.detalles[0]?.precio).toBe(19900);
  });

  it('separador de miles en precios', () => {
    const casos = parsearSetPruebas(
      'CASO-1\n=====\n\nItem\t\tCantidad\tPrecio\nComputador\t\t2\t\t1.250.000\n',
    );

    expect(casos[0]?.detalles[0]?.precio).toBe(1250000);
  });

  it('el tipo de documento se propaga', () => {
    expect(parsearSetPruebas(SET, '41')[0]?.tipo).toBe('41');
  });

  it('archivo sin casos', () => {
    expect(() => parsearSetPruebas('texto cualquiera\nsin casos\n')).toThrow(ErrorValidacion);
    expect(() => parsearSetPruebas('texto cualquiera\nsin casos\n')).toThrow(
      'No se encontraron casos',
    );
  });

  it('caso sin ítems legibles', () => {
    const contenido = 'CASO-1\n=====\n\nItem\t\tCantidad\tPrecio\n(nada)\n';
    expect(() => parsearSetPruebas(contenido)).toThrow(ErrorValidacion);
    expect(() => parsearSetPruebas(contenido)).toThrow(
      'CASO-1: no se pudo extraer ningun item (nombre/cantidad/precio).',
    );
  });

  it('parsea el set de ejemplo que trae el repositorio', () => {
    const contenido = readFileSync(resolve(RAIZ_PARIDAD, '../data/set_pruebas/Set Prueba BE.txt'));
    const casos = parsearSetPruebas(contenido);

    expect(casos).toHaveLength(5);
    expect(casos.map((c) => c.detalles.length)).toEqual([2, 1, 2, 2, 1]);
    expect(casos[3]?.detalles[1]).toStrictEqual({
      nombre: 'item exento 2',
      cantidad: 2,
      precio: 1000,
      exento: true,
    });
    expect(casos[4]?.detalles[0]).toStrictEqual({
      nombre: 'Arroz',
      cantidad: 5,
      precio: 700,
      unidad: 'Kg',
    });
  });
});

describe('parsearSetPruebas: casos propios del port', () => {
  it('el archivo vacío no tiene casos', () => {
    expect(() => parsearSetPruebas(new Uint8Array())).toThrow(
      'No se encontraron casos (CASO-N) en el archivo.',
    );
  });

  it('acepta bytes UTF-8 e ISO-8859-1 y entrega el mismo texto', () => {
    const texto = caso('Café con leche\t\t2\t\t1.500\nÑandú\t\t1\t\t990');
    const utf8 = parsearSetPruebas(Buffer.from(texto, 'utf8'));
    const iso = parsearSetPruebas(aIso88591(texto));

    expect(utf8[0]?.detalles.map((d) => d.nombre)).toEqual(['Café con leche', 'Ñandú']);
    expect(iso).toStrictEqual(utf8);
    expect(parsearSetPruebas(texto)).toStrictEqual(utf8);
  });

  it('acepta un Uint8Array que es vista de un buffer mayor', () => {
    const bytes = Buffer.from(`xx${caso('Pan\t\t1\t\t100')}yy`, 'utf8');
    const vista = new Uint8Array(bytes.buffer, bytes.byteOffset + 2, bytes.length - 4);
    expect(parsearSetPruebas(vista)[0]?.detalles).toStrictEqual([
      { nombre: 'Pan', cantidad: 1, precio: 100 },
    ]);
  });

  it('el NBSP no es un blanco (como \\s y trim() del PHP)', () => {
    const casos = parsearSetPruebas(caso('Pan \t\t2\t\t300\nArroz\t\t5 \t\t700\nLeche  3  900'));
    expect(casos[0]?.detalles).toStrictEqual([{ nombre: 'Pan ', cantidad: 2, precio: 300 }]);
  });

  it('el FF final no lo quita trim() y el número deja de serlo', () => {
    const casos = parsearSetPruebas(caso('Pan\t\t2\t\t300\nLeche\t\t1\t\t900\f'));
    expect(casos[0]?.detalles.map((d) => d.nombre)).toEqual(['Pan']);
  });

  it('VT y FF sí separan columnas (son \\s de PCRE)', () => {
    const casos = parsearSetPruebas(caso('Pan\v\f2\f\v300'));
    expect(casos[0]?.detalles).toStrictEqual([{ nombre: 'Pan', cantidad: 2, precio: 300 }]);
  });

  it('ignora encabezados en mayúsculas y líneas que no tienen 3 columnas', () => {
    const casos = parsearSetPruebas(
      caso('ITEM    CANTIDAD    PRECIO\nDos\t\t3\nCuatro\t\tcol\t\t1\t\t2\nPan  1  100'),
    );
    expect(casos[0]?.detalles).toStrictEqual([{ nombre: 'Pan', cantidad: 1, precio: 100 }]);
  });

  it('una línea que empieza con "Item" sin "Cantidad" es un ítem', () => {
    const casos = parsearSetPruebas(caso('Item especial\t\t2\t\t300'));
    expect(casos[0]?.detalles[0]?.nombre).toBe('Item especial');
  });

  it.each([
    ['19900', 19900],
    ['1000', 1000],
    ['1.000', 1000],
    ['1,000', 1000],
    ['1.250.000', 1250000],
    ['1,250,000', 1250000],
    ['1.234', 1234],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['2,5', 2.5],
    ['2.0', 2],
    ['0.5', 0.5],
    ['007', 7],
    ['1234,567', 1234.567],
    ['1.2345', 1.2345],
  ])('el precio %s se lee como %d (igual que el PHP)', (precio, numero) => {
    expect(parsearSetPruebas(caso(`Pan\t\t1\t\t${precio}`))[0]?.detalles[0]?.precio).toBe(numero);
  });

  it.each([
    ['1.000', 1000],
    ['12,345', 12345],
    ['1,5', 1.5],
    ['2.0', 2],
  ])('la cantidad %s se lee como %d (igual que el PHP)', (cantidad, numero) => {
    expect(parsearSetPruebas(caso(`Pan\t\t${cantidad}\t\t100`))[0]?.detalles[0]?.cantidad).toBe(
      numero,
    );
  });

  it.each(['-100', '1 000', '١٢', 'uno', '100 CLP', '5000\f'])(
    '"%s" no es una fila de ítem: la línea se ignora (como el PHP)',
    (precio) => {
      const casos = parsearSetPruebas(caso(`Pan\t\t1\t\t100\nOtro\t\t1\t\t${precio}`));
      expect(casos[0]?.detalles).toHaveLength(1);
    },
  );

  it('una línea con cantidad no numérica no se revisa, aunque el precio sea ambiguo', () => {
    const casos = parsearSetPruebas(caso('Pan\t\t1\t\t100\nOtro\t\tuno\t\t1.000,50'));
    expect(casos[0]?.detalles).toStrictEqual([{ nombre: 'Pan', cantidad: 1, precio: 100 }]);
  });

  it('exento sin número de ítem: solo con un único ítem', () => {
    const uno = parsearSetPruebas(`${caso('Pan\t\t1\t\t100')}\nOBSERVACION: "Producto exento"`);
    const dos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100\nTe\t\t1\t\t200')}\nOBSERVACION: "Productos exentos"`,
    );
    expect(uno[0]?.detalles[0]?.exento).toBe(true);
    expect(dos[0]?.detalles.some((d) => d.exento !== undefined)).toBe(false);
  });

  it('"item N ... exento" con un ítem que no existe no marca nada', () => {
    const casos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100\nTe\t\t1\t\t200')}\nOBSERVACION: "El item 3 es exento"`,
    );
    expect(casos[0]?.detalles.some((d) => d.exento !== undefined)).toBe(false);
  });

  it('"exentos" no calza con \\bexento\\b', () => {
    const casos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100\nTe\t\t1\t\t200')}\nOBSERVACION: "El item 1 y el item 2 son exentos"`,
    );
    expect(casos[0]?.detalles.some((d) => d.exento !== undefined)).toBe(false);
  });

  it('unidad para el ítem nombrado (si hay varios) o para todos', () => {
    const uno = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100\nTe\t\t1\t\t200')}\nOBSERVACION: "El item 2 con unidad de medida en Lt."`,
    );
    const todos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100\nTe\t\t1\t\t200')}\nOBSERVACION: "Unidad de medida en kg, todos"`,
    );
    expect(uno[0]?.detalles.map((d) => d.unidad)).toEqual([undefined, 'Lt']);
    expect(todos[0]?.detalles.map((d) => d.unidad)).toEqual(['kg', 'kg']);
  });

  it('la unidad toma solo letras ASCII', () => {
    const casos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100')}\nOBSERVACION: "Unidad de medida en Kilógramos"`,
    );
    expect(casos[0]?.detalles[0]?.unidad).toBe('Kil');
  });

  it('el número del caso se conserva tal cual (CASO-01)', () => {
    expect(
      parsearSetPruebas(caso('Pan\t\t1\t\t100', 1).replace('CASO-1', 'CASO-01'))[0]?.referencia,
    ).toStrictEqual({ codigo: 'SET', razon: 'CASO-01' });
  });

  it('el error de un caso sin ítems nombra ese caso', () => {
    expect(() => parsearSetPruebas(caso('Pan\t\t1\t\t100') + caso('(nada)', 2))).toThrow(
      'CASO-2: no se pudo extraer',
    );
  });

  it('las llamadas no comparten estado (regex globales)', () => {
    expect(parsearSetPruebas(SET)).toStrictEqual(parsearSetPruebas(SET));
  });
});

// Decisión del usuario (2026-11-06): donde el PHP leía truncado (1.000,50 → 1) o
// ignoraba la línea (1.5.0, 1,), aquí es un ErrorValidacion.
describe('parsearSetPruebas: números ambiguos', () => {
  it.each([
    '1.000,50', // el PHP lo leía como 1
    '1,000.50', // el PHP lo leía como 1
    '1.000,000', // mezcla, aunque el PHP diera 1000000
    '1.000.5', // el PHP lo leía como 1
    '1,000,5',
    '1.5.0', // el PHP ignoraba la línea
    '12.34.567',
    '1,',
    '1.',
    '.5',
    '1..5',
  ])('el precio "%s" es un error', (precio) => {
    const contenido = caso(`Pan\t\t1\t\t100\nVino\t\t1\t\t${precio}`);
    expect(() => parsearSetPruebas(contenido)).toThrow(ErrorValidacion);
    expect(() => parsearSetPruebas(contenido)).toThrow(
      `CASO-1, ítem "Vino": el precio "${precio}" no es un número válido.`,
    );
  });

  it.each(['1.000,50', '1.5.0', '2,'])('la cantidad "%s" es un error', (cantidad) => {
    const contenido = caso(`Vino\t\t${cantidad}\t\t1000`, 3);
    expect(() => parsearSetPruebas(contenido)).toThrow(
      `CASO-3, ítem "Vino": la cantidad "${cantidad}" no es un número válido.`,
    );
  });

  it('el mensaje explica qué formas se aceptan', () => {
    expect(() => parsearSetPruebas(caso('Vino\t\t1\t\t1.000,50'))).toThrow(
      /Se acepta un entero \(19900\), miles con un solo tipo de separador \(1\.000 o 1,000\) o un decimal con un solo punto o coma \(1\.5 o 1,5\), sin mezclar "\." y ","\.$/,
    );
  });
});

// Decisión del usuario (2026-11-06): un encabezado CASO-N que el PHP no leía como
// bloque (sus ítems se perdían o quedaban en el caso anterior) es un ErrorValidacion.
describe('parsearSetPruebas: encabezados de caso', () => {
  const mensaje = (n: string) =>
    `${n}: no se pudo leer el encabezado del caso. Se esperaba una línea "${n}" y debajo una línea solo de "=" (sin blancos después de los "=").`;

  it('la línea de "=" con blancos al final es un error', () => {
    const contenido = `${caso('Pan\t\t1\t\t100')}\nCASO-2\n=====   \nTe\t\t2\t\t200\n`;
    expect(() => parsearSetPruebas(contenido)).toThrow(ErrorValidacion);
    expect(() => parsearSetPruebas(contenido)).toThrow(mensaje('CASO-2'));
  });

  it('un CASO-N sin línea de "=" es un error', () => {
    const contenido = `${caso('Pan\t\t1\t\t100')}\nCASO-2\n\nTe\t\t2\t\t200\n`;
    expect(() => parsearSetPruebas(contenido)).toThrow(mensaje('CASO-2'));
  });

  it('un CASO-N al final del archivo, o con los "=" sin salto final, es un error', () => {
    expect(() => parsearSetPruebas(`${caso('Pan\t\t1\t\t100')}CASO-2`)).toThrow(mensaje('CASO-2'));
    expect(() => parsearSetPruebas(`${caso('Pan\t\t1\t\t100')}CASO-2\n=====`)).toThrow(
      mensaje('CASO-2'),
    );
  });

  it('un CASO-N con blancos delante tras otro caso es un error (el PHP lo metía en el anterior)', () => {
    const contenido = `${caso('Pan\t\t1\t\t100')}  CASO-2\n=====\nTe\t\t2\t\t200\n`;
    expect(() => parsearSetPruebas(contenido)).toThrow(mensaje('CASO-2'));
  });

  it('si ningún encabezado se puede leer, el error nombra el primero', () => {
    expect(() => parsearSetPruebas('CASO-1\nPan\t\t1\t\t100\nCASO-2\n')).toThrow(mensaje('CASO-1'));
  });

  it('el número se nombra tal cual (CASO-01)', () => {
    expect(() => parsearSetPruebas(`${caso('Pan\t\t1\t\t100')}CASO-02\n`)).toThrow(
      mensaje('CASO-02'),
    );
  });

  it('siguen valiendo los encabezados que el PHP lee', () => {
    const contenido =
      '  CASO-1 \t\n\n\n=====\nPan\t\t1\t\t100\n' + // blancos y líneas en blanco antes de los "="
      'CASO-2\r\n=\r\nTe\t\t2\t\t200\r\n' + // un solo "=" y CRLF
      'CASO-3\n=====\nSal\t\t3\t\t300'; // al final sin salto
    expect(parsearSetPruebas(contenido).map((c) => c.referencia.razon)).toEqual([
      'CASO-1',
      'CASO-2',
      'CASO-3',
    ]);
  });

  it('una mención a CASO-N dentro de otra línea no es encabezado', () => {
    const casos = parsearSetPruebas(
      `${caso('Pan\t\t1\t\t100')}\n<RazonRef> CASO-1\nVer el CASO-2.\nOBSERVACION: "Igual que CASO-3"\n`,
    );
    expect(casos).toHaveLength(1);
    expect(casos[0]?.detalles).toHaveLength(1);
  });

  it('"caso-2" en minúsculas no es encabezado (el PHP distingue mayúsculas)', () => {
    const casos = parsearSetPruebas(`${caso('Pan\t\t1\t\t100')}caso-2\nTe\t\t2\t\t200\n`);
    expect(casos.map((c) => c.referencia.razon)).toEqual(['CASO-1']);
  });

  it('con saltos solo \\r no hay líneas: sigue siendo "No se encontraron casos"', () => {
    expect(() => parsearSetPruebas('CASO-1\r=====\rPan\t\t1\t\t100\r')).toThrow(
      'No se encontraron casos (CASO-N) en el archivo.',
    );
  });

  it('el set del SII trae "<RazonRef> CASO-1" en las observaciones finales y se lee entero', () => {
    const contenido = readFileSync(resolve(RAIZ_PARIDAD, '../data/set_pruebas/Set Prueba BE.txt'));
    expect(contenido.toString('latin1')).toContain('<RazonRef> CASO-1');
    expect(parsearSetPruebas(contenido)).toHaveLength(5);
  });
});
