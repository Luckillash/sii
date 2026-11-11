// Port de tests/Core/GeneradorBoletaTest.php (winex/certificacion v1.9.1, Apache-2.0),
// más los casos propios del port (hora inyectada, Buffer ISO-8859-1, números
// como en PHP y validación de las entradas).

import { describe, expect, it } from 'vitest';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import { fechaSii, instanteSii, relojFijo } from '../../../src/comun/reloj.ts';
import { parsearDocumento } from '../../../src/comun/xml.ts';
import {
  type DatosBoleta,
  type DescuentoGlobal,
  type DetalleBoleta,
  GeneradorBoleta,
} from '../../../src/core/generador-boleta.ts';

const EMISOR = {
  rut: '76123456-0',
  razonSocial: 'EMPRESA DE PRUEBA SPA',
  giro: 'ACTIVIDADES DE CONSULTORIA DE INFORMATICA',
  direccion: 'CALLE 123',
  comuna: 'SANTIAGO',
};
const RECEPTOR = { rut: '66666666-6', razonSocial: 'Cliente General' };
const reloj = relojFijo(instanteSii('2026-09-05T10:30:00'));

function datos(detalles: DetalleBoleta[], cambios: Partial<DatosBoleta> = {}): DatosBoleta {
  return { emisor: EMISOR, receptor: RECEPTOR, folio: '56', detalles, ...cambios };
}

function bytes(detalles: DetalleBoleta[], cambios: Partial<DatosBoleta> = {}): Buffer {
  return new GeneradorBoleta({ reloj }).generarBoleta(datos(detalles, cambios));
}

function generar(
  detalles: DetalleBoleta[],
  referencia?: DatosBoleta['referencia'],
  descuento?: DescuentoGlobal,
  tipoDte = '39',
): Document {
  const cambios: Partial<DatosBoleta> = { tipoDte };
  if (referencia) cambios.referencia = referencia;
  if (descuento) cambios.descuento = descuento;
  return parsearDocumento(bytes(detalles, cambios));
}

function nodos(doc: Document, etiqueta: string): Element[] {
  return Array.from(doc.getElementsByTagName(etiqueta));
}

function valor(doc: Document, etiqueta: string): string | null {
  return nodos(doc, etiqueta)[0]?.textContent ?? null;
}

function totales(doc: Document): Record<string, string | null> {
  const totales = nodos(doc, 'Totales')[0];
  const t: Record<string, string | null> = {};
  for (const campo of ['MntNeto', 'MntExe', 'IVA', 'MntTotal']) {
    t[campo] = totales?.getElementsByTagName(campo)[0]?.textContent ?? null;
  }
  return t;
}

/** Suma de los MontoItem de las líneas (lo que el SII contrasta contra MntTotal). */
function sumaDeLineas(doc: Document): number {
  return nodos(doc, 'MontoItem').reduce((suma, n) => suma + Number(n.textContent), 0);
}

const item = (precio: number, cambios: Partial<DetalleBoleta> = {}): DetalleBoleta => ({
  nombre: 'X',
  cantidad: 1,
  precio,
  ...cambios,
});

describe('GeneradorBoleta (port de GeneradorBoletaTest.php)', () => {
  it('identificación, emisor y receptor', () => {
    const doc = generar([item(1190, { nombre: 'Producto' })]);

    expect(nodos(doc, 'Documento')[0]?.getAttribute('ID')).toBe('F56T39');
    expect(valor(doc, 'TipoDTE')).toBe('39');
    expect(valor(doc, 'Folio')).toBe('56');
    expect(valor(doc, 'FchEmis')).toBe('2026-09-05');
    expect(valor(doc, 'RUTEmisor')).toBe('76123456-0');
    expect(valor(doc, 'CmnaOrigen')).toBe('SANTIAGO');
    expect(valor(doc, 'RUTRecep')).toBe('66666666-6');
  });

  it('el precio con IVA incluido se desglosa en neto e IVA', () => {
    // Regresión: la boleta tipo 39 debe llevar MntNeto + IVA, no solo el total.
    const t = totales(generar([item(1190, { nombre: 'Producto' })]));

    expect(t.MntNeto).toBe('1000');
    expect(t.IVA).toBe('190');
    expect(t.MntTotal).toBe('1190');
    expect(t.MntExe).toBeNull();
  });

  it.each([1, 7, 100, 999, 1590, 12720, 29800, 123457])(
    'neto + IVA siempre cuadra con el bruto (%i)',
    (bruto) => {
      const t = totales(generar([item(bruto)]));

      expect(Number(t.MntNeto ?? 0) + Number(t.IVA ?? 0)).toBe(bruto);
      expect(t.MntTotal).toBe(String(bruto));
    },
  );

  it('la cantidad multiplica el precio', () => {
    const t = totales(generar([{ nombre: 'Papel', cantidad: 17, precio: 120 }]));

    expect(t.MntTotal).toBe('2040');
  });

  it('un ítem exento va en MntExe y sin IVA', () => {
    const doc = generar([{ nombre: 'Libro', cantidad: 1, precio: 5000, exento: true }]);
    const t = totales(doc);

    expect(t.MntExe).toBe('5000');
    expect(t.MntTotal).toBe('5000');
    expect(t.MntNeto).toBeNull();
    expect(t.IVA).toBeNull();
    expect(valor(doc, 'IndExe')).toBe('1');
  });

  it('afecto y exento juntos (caso 4 del set)', () => {
    const t = totales(
      generar([
        { nombre: 'item afecto 1', cantidad: 8, precio: 1590 },
        { nombre: 'item exento 2', cantidad: 2, precio: 1000, exento: true },
      ]),
    );

    expect(t.MntNeto).toBe('10689');
    expect(t.IVA).toBe('2031');
    expect(t.MntExe).toBe('2000');
    expect(t.MntTotal).toBe('14720');
  });

  it('el orden de los totales respeta el esquema', () => {
    const doc = generar([
      { nombre: 'A', cantidad: 1, precio: 1190 },
      { nombre: 'B', cantidad: 1, precio: 500, exento: true },
    ]);
    const orden = Array.from(nodos(doc, 'Totales')[0]?.childNodes ?? [])
      .filter((n) => n.nodeType === 1)
      .map((n) => (n as Element).localName);

    expect(orden).toEqual(['MntNeto', 'MntExe', 'IVA', 'MntTotal']);
  });

  it('unidad de medida', () => {
    const doc = generar([{ nombre: 'Arroz', cantidad: 5, precio: 700, unidad: 'Kg' }]);

    expect(valor(doc, 'UnmdItem')).toBe('Kg');
  });

  it('referencia al caso del set de pruebas', () => {
    const doc = generar([item(1000)], { codigo: 'SET', razon: 'CASO-1' });

    expect(valor(doc, 'CodRef')).toBe('SET');
    expect(valor(doc, 'RazonRef')).toBe('CASO-1');
  });

  it('sin referencia no hay nodo', () => {
    expect(nodos(generar([item(1000)]), 'Referencia')).toHaveLength(0);
  });

  it('los caracteres especiales quedan bien escapados', () => {
    const doc = generar([item(1000, { nombre: 'Pan & <Queso> "Extra"' })]);

    expect(valor(doc, 'NmbItem')).toBe('Pan & <Queso> "Extra"');
  });

  it('el XML declara ISO-8859-1', () => {
    const xml = bytes([item(100)], { folio: '1' });

    expect(xml.toString('latin1')).toContain('encoding="ISO-8859-1"');
  });

  describe('descuento global', () => {
    it('en porcentaje', () => {
      const doc = generar([item(10000)], undefined, { tipo: 'porcentaje', valor: 10 });

      expect(valor(doc, 'MntTotal')).toBe('9000');
      expect(valor(doc, 'DescuentoMonto')).toBe('1000');
    });

    it('en monto', () => {
      const doc = generar([item(10000)], undefined, { tipo: 'monto', valor: 2500 });

      expect(valor(doc, 'MntTotal')).toBe('7500');
    });

    it.each([
      ['porcentaje', 7],
      ['porcentaje', 33.3],
      ['monto', 1],
      ['monto', 999],
      ['monto', 4775],
    ] as const)('el total siempre iguala la suma de las líneas (%s %d)', (tipo, valorDescuento) => {
      // Regresión del reparo 260 "Monto Total No Cuadra con Parciales": el
      // descuento debe bajar las líneas, no declararse aparte.
      const doc = generar(
        [
          { nombre: 'A', cantidad: 3, precio: 1333 },
          { nombre: 'B', cantidad: 1, precio: 777 },
          { nombre: 'C', cantidad: 2, precio: 951, exento: true },
        ],
        undefined,
        { tipo, valor: valorDescuento },
      );

      expect(sumaDeLineas(doc)).toBe(Number(valor(doc, 'MntTotal')));
    });

    it('no toca los ítems exentos', () => {
      const doc = generar(
        [
          { nombre: 'Afecto', cantidad: 1, precio: 1000 },
          { nombre: 'Exento', cantidad: 1, precio: 500, exento: true },
        ],
        undefined,
        { tipo: 'porcentaje', valor: 50 },
      );

      expect(valor(doc, 'MntExe')).toBe('500');
      expect(valor(doc, 'MntTotal')).toBe('1000');
    });

    it('nunca deja el afecto en negativo', () => {
      const doc = generar([item(1000)], undefined, { tipo: 'monto', valor: 999999 });

      expect(valor(doc, 'MntTotal')).toBe('0');
    });

    it('un porcentaje mayor a 100 se acota', () => {
      const doc = generar([item(1000)], undefined, { tipo: 'porcentaje', valor: 250 });

      expect(valor(doc, 'MntTotal')).toBe('0');
    });

    it.each([0, -5])('un descuento cero o negativo se ignora (%d)', (valorDescuento) => {
      const doc = generar([item(1000)], undefined, { tipo: 'monto', valor: valorDescuento });

      expect(valor(doc, 'MntTotal')).toBe('1000');
      expect(nodos(doc, 'DescuentoMonto')).toHaveLength(0);
    });
  });
});

describe('GeneradorBoleta (port)', () => {
  it('devuelve los bytes ISO-8859-1 de saveXML()', () => {
    const xml = bytes([item(1000, { nombre: 'Café' })]);

    expect(Buffer.isBuffer(xml)).toBe(true);
    expect(xml.subarray(0, 44).toString('latin1')).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n',
    );
    expect(xml.includes(Buffer.from('Caf\xe9', 'latin1'))).toBe(true);
    expect(xml.at(-1)).toBe(0x0a);
  });

  it('FchEmis es la fecha de Chile aunque en UTC ya sea el día siguiente', () => {
    const instante = new Date('2026-07-16T00:30:00Z'); // 20:30 del 15 en Chile (UTC-4)
    const xml = new GeneradorBoleta({ reloj: relojFijo(instante) }).generarBoleta(
      datos([item(1190)]),
    );

    expect(valor(parsearDocumento(xml), 'FchEmis')).toBe('2026-07-15');
  });

  it('sin reloj usa la hora del sistema', () => {
    const antes = fechaSii(new Date());
    const fecha = valor(
      parsearDocumento(new GeneradorBoleta().generarBoleta(datos([item(1)]))),
      'FchEmis',
    );
    const despues = fechaSii(new Date());

    expect([antes, despues]).toContain(fecha);
  });

  it('el tipo por defecto es 39 y el folio y el tipo aceptan números', () => {
    const porDefecto = parsearDocumento(bytes([item(100)]));
    expect(valor(porDefecto, 'TipoDTE')).toBe('39');

    const doc = parsearDocumento(bytes([item(100, { exento: true })], { folio: 7, tipoDte: 41 }));
    expect(nodos(doc, 'Documento')[0]?.getAttribute('ID')).toBe('F7T41');
    expect(valor(doc, 'TipoDTE')).toBe('41');
    expect(valor(doc, 'Folio')).toBe('7');
  });

  it('el receptor sin razón social no lleva RznSocRecep; vacía sí', () => {
    const sin = parsearDocumento(bytes([item(100)], { receptor: { rut: '66666666-6' } }));
    expect(nodos(sin, 'RznSocRecep')).toHaveLength(0);

    const vacia = bytes([item(100)], { receptor: { rut: '66666666-6', razonSocial: '' } });
    expect(vacia.toString('latin1')).toContain('<RznSocRecep/>');
  });

  it('la glosa del descuento no va en el XML', () => {
    const xml = bytes([item(1000)], {
      descuento: { tipo: 'monto', valor: 100, glosa: 'GLOSA-DEL-DESCUENTO' },
    });

    expect(xml.toString('latin1')).not.toContain('GLOSA');
  });

  it('los ítems exentos no reciben descuento (pend. 1.5: exento booleano)', () => {
    const doc = generar(
      [
        { nombre: 'Exento', cantidad: 1, precio: 500, exento: true },
        { nombre: 'Afecto', cantidad: 1, precio: 1000, exento: false },
      ],
      undefined,
      { tipo: 'monto', valor: 300 },
    );
    const [exento, afecto] = nodos(doc, 'Detalle');

    expect(exento?.getElementsByTagName('DescuentoMonto')).toHaveLength(0);
    expect(afecto?.getElementsByTagName('DescuentoMonto')[0]?.textContent).toBe('300');
    expect(valor(doc, 'MntTotal')).toBe('1200');
  });

  it('el resto del reparto se asigna de a un peso a las primeras líneas con margen', () => {
    const doc = generar(
      [
        { nombre: 'A', cantidad: 3, precio: 1333 },
        { nombre: 'B', cantidad: 1, precio: 777 },
        { nombre: 'C', cantidad: 1, precio: 1 },
      ],
      undefined,
      { valor: 1000 },
    );

    expect(nodos(doc, 'DescuentoMonto').map((n) => n.textContent)).toEqual(['838', '162']);
    expect(valor(doc, 'MntTotal')).toBe('3777');
  });

  describe('números como en PHP', () => {
    const linea = (cantidad: number, precio: number) => {
      const doc = generar([{ nombre: 'X', cantidad, precio }]);
      return [valor(doc, 'QtyItem'), valor(doc, 'PrcItem'), valor(doc, 'MontoItem')];
    };

    it('round() redondea la mitad lejos del cero y pre-redondea (no es Math.round)', () => {
      expect(linea(5.055, 100)[2]).toBe('506'); // el double es 505.49999999999994
      expect(linea(2.5, 1)[2]).toBe('3');
      expect(linea(1000, 0.285)[2]).toBe('285');
    });

    it('los decimales se escriben como el (string) de un float (14 cifras)', () => {
      expect(linea(1.5, 8990)).toEqual(['1.5', '8990', '13485']);
      expect(linea(1 / 3, 1000)).toEqual(['0.33333333333333', '1000', '333']);
      expect(linea(2, 0.1 + 0.2)).toEqual(['2', '0.3', '1']);
      expect(linea(0.00001, 49999)).toEqual(['1.0E-5', '49999', '0']);
      expect(linea(0.0001, 1)[0]).toBe('0.0001');
    });

    it('desde 1e14 los montos (float en PHP) van en notación exponencial', () => {
      expect(linea(1, 100000000000005)).toEqual(['1', '100000000000005', '1.0000000000000E+14']);
      expect(linea(2, 60000000000000)[2]).toBe('1.2E+14');
      expect(linea(1, 12345678901234.5)).toEqual(['1', '12345678901234', '12345678901235']);
    });
  });

  describe('validación de las entradas', () => {
    const lanza = (cambios: Partial<DatosBoleta>, detalles: DetalleBoleta[] = [item(1000)]) =>
      expect(() => bytes(detalles, cambios)).toThrow(ErrorValidacion);

    it.each(['76.123.456-0', '761234560', '76123456-1', '7612345-k', '', '76123456-0 '])(
      'rechaza el RUT del emisor %j',
      (rut) => lanza({ emisor: { ...EMISOR, rut } }),
    );

    it('rechaza el RUT del receptor con DV incorrecto', () => {
      lanza({ receptor: { rut: '66666666-5' } });
    });

    it('acepta un RUT con DV K', () => {
      // 10000013-K: DV calculado por módulo 11.
      expect(() => bytes([item(1)], { receptor: { rut: '10000013-K' } })).not.toThrow();
    });

    it('rechaza una boleta sin líneas', () => {
      lanza({}, []);
    });

    it.each([
      ['cantidad negativa', { cantidad: -1 }],
      ['precio negativo', { precio: -1 }],
      ['cantidad NaN', { cantidad: Number.NaN }],
      ['precio infinito', { precio: Number.POSITIVE_INFINITY }],
      ['precio desde 1e15', { precio: 1e15 }],
      ['producto desde 1e15', { cantidad: 10, precio: 1e14 }],
      ['exento numérico', { exento: 1 as unknown as boolean }],
      ['exento "S"', { exento: 'S' as unknown as boolean }],
      ['cantidad como texto', { cantidad: '1' as unknown as number }],
    ])('rechaza una línea con %s', (_, cambios) => {
      lanza({}, [item(1000, cambios)]);
    });

    it('rechaza que la suma de las líneas llegue a 1e15', () => {
      lanza({}, [item(6e14), item(4e14, { exento: true })]);
    });

    it.each([1.5, Number.NaN, 2 ** 60])('rechaza un folio numérico no entero (%d)', (folio) => {
      lanza({ folio });
    });

    it('rechaza un tipo numérico no entero', () => {
      lanza({ tipoDte: 39.5 });
    });

    it.each([
      ['tipo desconocido', { tipo: 'pesos' as 'monto', valor: 10 }],
      ['valor NaN', { valor: Number.NaN }],
      ['valor infinito', { valor: Number.POSITIVE_INFINITY }],
      ['valor desde 1e15', { valor: 1e15 }],
    ])('rechaza un descuento con %s', (_, descuento) => {
      lanza({ descuento });
    });

    it('acepta cantidad 0 y precio 0 (el PHP también)', () => {
      const doc = generar([item(0), item(1000, { cantidad: 0 })]);
      expect(valor(doc, 'MntTotal')).toBe('0');
    });
  });
});
