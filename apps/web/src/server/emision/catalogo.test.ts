import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG } from '../../../test/certificacion-prueba';
import { escenarioEmision } from '../../../test/emision-prueba';
import { buscarProductos, buscarReceptores, patronBusqueda } from './catalogo';

const OTRA_EMPRESA = '12121212-1212-4212-8212-121212121212';

function escenarioCatalogo() {
  const receptores = [
    ['11111111-1', 'Comercial Pérez, Juan'],
    ['22222222-2', 'Ferretería 100% Sur'],
    ['33333333-3', 'Distribuidora (Norte)'],
    ...Array.from({ length: 10 }, (_, i) => [`4000000${i}-K`, `Cliente Masivo ${i}`]),
  ].map(([rut, razon], i) => ({
    id: `r-${i}`,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    rut,
    razon_social: razon,
    correo: null,
  }));
  receptores.push({
    id: 'r-otra',
    organizacion_id: ORG,
    empresa_id: OTRA_EMPRESA,
    rut: '55555555-5',
    razon_social: 'Comercial de otra empresa',
    correo: null,
  });
  return escenarioEmision({
    tablas: {
      receptores,
      productos: [
        {
          id: 'p-1',
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          codigo: 'CAF-01',
          nombre: 'Café grano',
          precio_bruto: 11990.4,
          exento: false,
          unidad: 'Kg',
          activo: true,
        },
        {
          id: 'p-2',
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          codigo: 'CAF-02',
          nombre: 'Café molido',
          precio_bruto: 9990,
          exento: false,
          unidad: null,
          activo: false,
        },
        {
          id: 'p-3',
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          codigo: null,
          nombre: 'Asesoría',
          precio_bruto: 50000,
          exento: true,
          unidad: null,
          activo: true,
        },
      ],
    },
  });
}

describe('patronBusqueda', () => {
  it('escapa los comodines de LIKE y neutraliza la sintaxis del or de PostgREST', () => {
    expect(patronBusqueda('  100%_sur\\x ')).toBe('100\\%\\_sur\\\\x');
    expect(patronBusqueda('Pérez, Juan (hijo) "x" *')).toBe('Pérez_ Juan _hijo_ _x_ _');
    expect(patronBusqueda('a'.repeat(200))).toHaveLength(60);
  });
});

describe('buscarReceptores', () => {
  const ctx = { organizacionId: ORG, empresaId: EMPRESA };

  it('por razón social, con caracteres especiales, solo de la empresa', async () => {
    const e = escenarioCatalogo();
    expect((await buscarReceptores(ctx, 'pérez, juan', e.deps)).map((r) => r.id)).toEqual(['r-0']);
    expect((await buscarReceptores(ctx, '100%', e.deps)).map((r) => r.id)).toEqual(['r-1']);
    expect((await buscarReceptores(ctx, '(norte)', e.deps)).map((r) => r.id)).toEqual(['r-2']);
    expect((await buscarReceptores(ctx, 'comercial', e.deps)).map((r) => r.id)).toEqual(['r-0']);
  });

  it('por RUT con o sin puntos, hasta 8', async () => {
    const e = escenarioCatalogo();
    expect(await buscarReceptores(ctx, '22.222.222', e.deps)).toEqual([
      { id: 'r-1', rut: '22222222-2', razonSocial: 'Ferretería 100% Sur', correo: null },
    ]);
    expect(await buscarReceptores(ctx, 'cliente masivo', e.deps)).toHaveLength(8);
    expect(await buscarReceptores(ctx, '   ', e.deps)).toEqual([]);
  });

  it('un % suelto no lista todo', async () => {
    const e = escenarioCatalogo();
    expect((await buscarReceptores(ctx, '%', e.deps)).map((r) => r.id)).toEqual(['r-1']);
    expect(await buscarReceptores(ctx, '_', e.deps)).toEqual([]);
  });
});

describe('buscarProductos', () => {
  const ctx = { organizacionId: ORG, empresaId: EMPRESA };

  it('solo activos, por código o nombre, con el precio en pesos enteros', async () => {
    const e = escenarioCatalogo();
    expect(await buscarProductos(ctx, 'caf', e.deps)).toEqual([
      {
        id: 'p-1',
        codigo: 'CAF-01',
        nombre: 'Café grano',
        precio: 11990,
        exento: false,
        unidad: 'Kg',
      },
    ]);
    expect((await buscarProductos(ctx, 'asesor', e.deps)).map((p) => p.id)).toEqual(['p-3']);
  });
});
