import { GeneradorBoleta, relojFijo } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  type Borrador,
  calcularTotales,
  esquemaBorrador,
  type LineaBorrador,
  RECEPTOR_GENERICO,
} from './emision';

// Paridad de `calcularTotales` con el XML que escribe `GeneradorBoleta` de la librería
// (la misma regla que usará el servidor al armar la boleta).

const EMISOR = {
  rut: '76354771-K',
  razonSocial: 'EMPRESA DE PRUEBA SPA',
  giro: 'VENTAS',
  direccion: 'CALLE 1',
  comuna: 'SANTIAGO',
};

function totalesDeLaLibreria(
  lineas: Pick<LineaBorrador, 'cantidad' | 'precio' | 'exento'>[],
  descuento?: { tipo: 'monto' | 'porcentaje'; valor: number },
) {
  const xml = new GeneradorBoleta({ reloj: relojFijo(new Date('2026-11-15T12:00:00Z')) })
    .generarBoleta({
      emisor: EMISOR,
      receptor: { rut: RECEPTOR_GENERICO.rut },
      folio: 1,
      detalles: lineas.map((l, i) => ({
        nombre: `Item ${i + 1}`,
        cantidad: l.cantidad,
        precio: l.precio,
        exento: l.exento,
      })),
      ...(descuento ? { descuento } : {}),
    })
    .toString('latin1');
  const n = (etiqueta: string) => Number(new RegExp(`<${etiqueta}>([^<]*)</`).exec(xml)?.[1] ?? 0);
  const items = [...xml.matchAll(/<MontoItem>([^<]*)</g)].map((m) => Number(m[1]));
  const descuentos = [...xml.matchAll(/<Detalle>[\s\S]*?<\/Detalle>/g)].map((m) =>
    Number(/<DescuentoMonto>([^<]*)</.exec(m[0])?.[1] ?? 0),
  );
  return {
    neto: n('MntNeto'),
    exento: n('MntExe'),
    iva: n('IVA'),
    total: n('MntTotal'),
    items,
    descuentos,
  };
}

const CASOS: {
  nombre: string;
  lineas: Pick<LineaBorrador, 'cantidad' | 'precio' | 'exento'>[];
  descuento?: { tipo: 'monto' | 'porcentaje'; valor: number };
}[] = [
  { nombre: 'una línea afecta', lineas: [{ cantidad: 1, precio: 1190, exento: false }] },
  { nombre: 'neto con redondeo', lineas: [{ cantidad: 3, precio: 999, exento: false }] },
  {
    nombre: 'mixta afecta y exenta',
    lineas: [
      { cantidad: 2, precio: 1500, exento: false },
      { cantidad: 1, precio: 3000, exento: true },
    ],
  },
  { nombre: 'solo exenta (41)', lineas: [{ cantidad: 4, precio: 2500, exento: true }] },
  { nombre: 'cantidad decimal', lineas: [{ cantidad: 1.333, precio: 2990, exento: false }] },
  {
    nombre: 'mitad que redondea hacia arriba',
    lineas: [{ cantidad: 0.5, precio: 3, exento: false }],
  },
  {
    nombre: 'descuento en monto repartido',
    lineas: [
      { cantidad: 1, precio: 1000, exento: false },
      { cantidad: 1, precio: 2000, exento: false },
      { cantidad: 1, precio: 500, exento: true },
    ],
    descuento: { tipo: 'monto', valor: 701 },
  },
  {
    nombre: 'descuento en porcentaje',
    lineas: [
      { cantidad: 3, precio: 3333, exento: false },
      { cantidad: 7, precio: 1111, exento: false },
    ],
    descuento: { tipo: 'porcentaje', valor: 12.5 },
  },
  {
    nombre: 'descuento mayor que lo afecto se acota',
    lineas: [
      { cantidad: 1, precio: 1000, exento: false },
      { cantidad: 1, precio: 800, exento: true },
    ],
    descuento: { tipo: 'monto', valor: 5000 },
  },
  {
    nombre: 'descuento sobre boleta sin afecto no aplica',
    lineas: [{ cantidad: 1, precio: 800, exento: true }],
    descuento: { tipo: 'monto', valor: 100 },
  },
];

describe('calcularTotales (paridad con GeneradorBoleta)', () => {
  for (const caso of CASOS) {
    it(caso.nombre, () => {
      const lib = totalesDeLaLibreria(caso.lineas, caso.descuento);
      const t = calcularTotales({ lineas: caso.lineas, descuento: caso.descuento ?? null });
      expect({ neto: t.neto, exento: t.exento, iva: t.iva, total: t.total }).toEqual({
        neto: lib.neto,
        exento: lib.exento,
        iva: lib.iva,
        total: lib.total,
      });
      expect(t.lineas.map((l) => l.montoItem)).toEqual(lib.items);
      expect(t.lineas.map((l) => l.descuento)).toEqual(lib.descuentos);
    });
  }

  it('cuadra con muchos casos al azar', () => {
    let semilla = 7;
    const azar = (n: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
      return semilla % n;
    };
    for (let k = 0; k < 300; k++) {
      const lineas = Array.from({ length: 1 + azar(5) }, () => ({
        cantidad: (1 + azar(5000)) / (azar(2) === 0 ? 1 : 1000),
        precio: azar(200_000),
        exento: azar(4) === 0,
      }));
      const descuento =
        azar(3) === 0
          ? undefined
          : azar(2) === 0
            ? { tipo: 'monto' as const, valor: azar(20_000) }
            : { tipo: 'porcentaje' as const, valor: azar(10_001) / 100 };
      const lib = totalesDeLaLibreria(lineas, descuento);
      const t = calcularTotales({ lineas, descuento: descuento ?? null });
      expect([t.neto, t.exento, t.iva, t.total]).toEqual([
        lib.neto,
        lib.exento,
        lib.iva,
        lib.total,
      ]);
      expect(t.lineas.map((l) => l.montoItem)).toEqual(lib.items);
    }
  });
});

describe('esquemaBorrador', () => {
  const base: Borrador = {
    tipoDte: 39,
    ambiente: 'certificacion',
    receptor: { rut: '' },
    lineas: [{ nombre: 'Café', cantidad: 1, precio: 1990, exento: false }],
  };

  it('sin RUT usa el receptor genérico', () => {
    const r = esquemaBorrador.parse(base);
    expect(r.receptor).toEqual({
      rut: '66666666-6',
      razonSocial: 'Cliente General',
      correo: null,
      receptorId: null,
    });
  });

  it('normaliza el RUT del receptor', () => {
    const r = esquemaBorrador.parse({
      ...base,
      receptor: { rut: '76.354.771-k', razonSocial: 'Cliente SpA', correo: 'a@b.cl' },
    });
    expect(r.receptor.rut).toBe('76354771-K');
    expect(r.receptor.correo).toBe('a@b.cl');
  });

  it('rechaza un RUT con dígito verificador malo', () => {
    const r = esquemaBorrador.safeParse({ ...base, receptor: { rut: '76.354.771-1' } });
    expect(r.success).toBe(false);
  });

  it('en la boleta exenta exige líneas exentas', () => {
    expect(esquemaBorrador.safeParse({ ...base, tipoDte: 41 }).success).toBe(false);
    expect(
      esquemaBorrador.safeParse({
        ...base,
        tipoDte: 41,
        lineas: [{ ...base.lineas[0], exento: true }],
      }).success,
    ).toBe(true);
  });

  it('rechaza total cero, precio con decimales y emoji', () => {
    expect(
      esquemaBorrador.safeParse({ ...base, lineas: [{ ...base.lineas[0], precio: 0 }] }).success,
    ).toBe(false);
    expect(
      esquemaBorrador.safeParse({ ...base, lineas: [{ ...base.lineas[0], precio: 10.5 }] }).success,
    ).toBe(false);
    expect(
      esquemaBorrador.safeParse({ ...base, lineas: [{ ...base.lineas[0], nombre: 'Café ☕' }] })
        .success,
    ).toBe(false);
  });
});
