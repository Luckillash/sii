import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { leerResumenFolios } from '../folios/lectura';
import type { Database } from '../supabase/tipos';
import { leerCifras } from './lectura';

// Cliente falso que filtra en memoria con lo que usan las lecturas del Tablero (`eq`,
// `neq`, `in`, `gte`, `lt`, `not … is null`, `limit` y `count/head`). La vista
// `v_ventas_diarias` se arma aquí desde los documentos, con su misma regla (aceptados y
// con reparos, sin mirar el origen), para probar que el set se resta.

type Fila = Record<string, unknown>;

const ORG = '11111111-1111-4111-8111-111111111111';
const OTRA_ORG = '22222222-2222-4222-8222-222222222222';
const EMPRESA = '33333333-3333-4333-8333-333333333333';

function vistaVentas(docs: Fila[]): Fila[] {
  const grupos = new Map<string, Fila>();
  for (const d of docs) {
    if (d.estado !== 'aceptado' && d.estado !== 'aceptado_con_reparos') continue;
    const k = [d.organizacion_id, d.empresa_id, d.ambiente, d.fecha_emision, d.tipo_dte].join('|');
    const g = grupos.get(k) ?? {
      organizacion_id: d.organizacion_id,
      empresa_id: d.empresa_id,
      ambiente: d.ambiente,
      fecha_emision: d.fecha_emision,
      tipo_dte: d.tipo_dte,
      documentos: 0,
      mnt_neto: 0,
      iva: 0,
      mnt_exe: 0,
      mnt_total: 0,
    };
    g.documentos = (g.documentos as number) + 1;
    for (const c of ['mnt_neto', 'iva', 'mnt_exe', 'mnt_total']) {
      g[c] = (g[c] as number) + (d[c] as number);
    }
    grupos.set(k, g);
  }
  // PostgREST puede devolver `numeric` como texto: la lectura tiene que aguantarlo.
  return [...grupos.values()].map((g) => ({ ...g, mnt_neto: String(g.mnt_neto) }));
}

function base(tablas: Record<string, Fila[]>, fallar?: string): SupabaseClient<Database> {
  const todas: Record<string, Fila[]> = {
    ...tablas,
    v_ventas_diarias: vistaVentas(tablas.documentos ?? []),
  };
  return {
    from(tabla: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      let tope = Number.POSITIVE_INFINITY;
      let soloConteo = false;
      const filtrar = (p: (f: Fila) => boolean) => {
        filtros.push(p);
        return b;
      };
      const b = {
        select: (_c: string, o?: { count?: string; head?: boolean }) => {
          soloConteo = Boolean(o?.head);
          return b;
        },
        eq: (c: string, v: unknown) => filtrar((f) => f[c] === v),
        neq: (c: string, v: unknown) => filtrar((f) => f[c] !== v),
        in: (c: string, vs: unknown[]) => filtrar((f) => vs.includes(f[c])),
        gte: (c: string, v: string) => filtrar((f) => String(f[c]) >= v),
        lt: (c: string, v: string) => filtrar((f) => String(f[c]) < v),
        not: (c: string, op: string, v: unknown) => {
          if (op !== 'is' || v !== null) throw new Error('no soportado');
          return filtrar((f) => f[c] !== null && f[c] !== undefined);
        },
        limit: (cuantas: number) => {
          tope = cuantas;
          return b;
        },
        // biome-ignore lint/suspicious/noThenProperty: imita el builder «thenable» de supabase-js.
        then: (ok: (r: unknown) => void) => {
          if (tabla === fallar) {
            ok({ data: null, count: null, error: { code: '57014' } });
            return;
          }
          const filas = (todas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
          ok(
            soloConteo
              ? { data: null, count: filas.length, error: null }
              : { data: filas.slice(0, tope), count: null, error: null },
          );
        },
      };
      return b;
    },
  } as unknown as SupabaseClient<Database>;
}

let n = 0;
function doc(d: Partial<Fila>): Fila {
  n += 1;
  return {
    id: `d${n}`,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    origen: 'panel',
    tipo_dte: 39,
    folio: n,
    estado: 'aceptado',
    fecha_emision: '2026-11-16',
    mnt_neto: 1000,
    iva: 190,
    mnt_exe: 0,
    mnt_total: 1190,
    ...d,
  };
}

const CTX = {
  organizacionId: ORG,
  empresaId: EMPRESA,
  ambiente: 'certificacion' as const,
  periodo: '2026-11',
};

describe('leerCifras', () => {
  it('suma las ventas del período y cuenta por estado, sin el set ni lo ajeno', async () => {
    const documentos = [
      doc({ folio: 41 }),
      doc({ folio: 42, fecha_emision: '2026-11-17' }),
      doc({
        estado: 'aceptado_con_reparos',
        mnt_neto: 0,
        iva: 0,
        mnt_exe: 500,
        mnt_total: 500,
        tipo_dte: 41,
      }),
      doc({ estado: 'enviado' }),
      doc({ estado: 'rechazado' }),
      doc({ estado: 'anulado' }),
      doc({ estado: 'borrador', folio: null }),
      // Del set de pruebas: la vista los suma, el Tablero los resta y no los cuenta.
      doc({ origen: 'set_pruebas', mnt_neto: 5000, iva: 950, mnt_total: 5950 }),
      doc({ origen: 'set_pruebas', estado: 'rechazado' }),
      // Otro mes, otro ambiente y otra organización: fuera.
      doc({ fecha_emision: '2026-10-31' }),
      doc({ fecha_emision: '2026-12-01' }),
      doc({ ambiente: 'produccion' }),
      doc({ organizacion_id: OTRA_ORG }),
    ];
    const r = await leerCifras(CTX, { sesion: async () => base({ documentos }) });
    expect(r.ventas).toEqual({ neto: 2000, iva: 380, exento: 500, total: 2880, documentos: 3 });
    expect(r.conteo).toEqual({
      aceptado: 2,
      aceptado_con_reparos: 1,
      rechazado: 1,
      enviado: 1,
      incierto: 0,
      firmado: 0,
      anulado: 1,
    });
  });

  it('en producción no resta nada (no hay set)', async () => {
    const documentos = [doc({ ambiente: 'produccion' }), doc({ ambiente: 'produccion' })];
    const r = await leerCifras(
      { ...CTX, ambiente: 'produccion' },
      { sesion: async () => base({ documentos }) },
    );
    expect(r.ventas).toMatchObject({ neto: 2000, documentos: 2 });
    expect(r.conteo.aceptado).toBe(2);
  });

  it('una consulta que falla lanza un error sin datos', async () => {
    await expect(
      leerCifras(CTX, { sesion: async () => base({ documentos: [doc({})] }, 'v_ventas_diarias') }),
    ).rejects.toThrow(/leer las ventas del período en Supabase \(código 57014\)/);
    await expect(
      leerCifras(CTX, { sesion: async () => base({ documentos: [doc({})] }, 'documentos') }),
    ).rejects.toThrow(/código 57014/);
  });

  it('rechaza un período inválido', async () => {
    await expect(
      leerCifras({ ...CTX, periodo: 'todos' }, { sesion: async () => base({}) }),
    ).rejects.toThrow(/Período inválido/);
  });
});

describe('leerResumenFolios', () => {
  let m = 0;
  const caf = (c: Partial<Fila>): Fila => ({
    id: `c${++m}`,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    tipo_dte: 39,
    folio_desde: 41,
    folio_hasta: 45,
    siguiente_folio: 43,
    estado: 'activo',
    ...c,
  });

  it('arma las cuatro tarjetas con la regla de Folios (agotado ≠ sin CAF)', async () => {
    const cafs = [
      caf({}),
      caf({
        tipo_dte: 41,
        folio_desde: 1,
        folio_hasta: 10,
        siguiente_folio: 11,
        estado: 'agotado',
      }),
      caf({ organizacion_id: OTRA_ORG, ambiente: 'produccion' }),
    ];
    const r = await leerResumenFolios(ORG, EMPRESA, { sesion: async () => base({ cafs }) });
    const de = (amb: string, tipo: number) =>
      r?.find((x) => x.ambiente === amb && x.tipoDte === tipo);
    expect(r).toHaveLength(4);
    expect(de('certificacion', 39)).toMatchObject({
      disponibles: 3,
      total: 5,
      estado: 'sello',
      enUso: { desde: 41, hasta: 45, siguiente: 43 },
    });
    expect(de('certificacion', 41)).toMatchObject({ estado: 'error', tuvoCaf: true });
    expect(de('produccion', 39)).toMatchObject({ estado: 'error', tuvoCaf: false });
  });

  it('null si los ids no son UUID', async () => {
    expect(await leerResumenFolios('x', EMPRESA, { sesion: async () => base({}) })).toBeNull();
  });
});
