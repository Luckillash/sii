import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../supabase/tipos';
import { MAXIMO_FILAS } from './filas';
import {
  condicionCursor,
  ExportacionDemasiadoGrande,
  FILAS_POR_LOTE,
  leerDocumentosExportacion,
  leerResumenDiario,
} from './lectura';

// Lecturas de las exportaciones con un cliente falso: registra cada llamada del builder y
// devuelve filas sintéticas (misma fecha y tipo, folio = posición + 1) desde el cursor del
// `or()` (keyset) y hasta el `limit`. El conjunto es mutable entre lotes para simular
// cambios de estado durante la exportación. Sin red ni base.

type Llamada = [string, ...unknown[]];

function idDe(folio: number): string {
  return `00000000-0000-4000-8000-${String(folio).padStart(12, '0')}`;
}

function clienteFalso(opciones: {
  total: number;
  error?: { code: string };
  /** Lo que informa el `count` del primer lote (por defecto, las filas vigentes). */
  conteo?: number;
  /** Se llama después de cada lote con los folios vigentes (se pueden modificar). */
  trasLote?: (folios: number[], lote: number) => void;
  vista?: Record<string, unknown>[];
}) {
  const consultas: { tabla: string; llamadas: Llamada[] }[] = [];
  const folios = Array.from({ length: opciones.total }, (_, i) => i + 1);
  let lotes = 0;
  const cliente = {
    from(tabla: string) {
      const llamadas: Llamada[] = [];
      consultas.push({ tabla, llamadas });
      let limite = Number.POSITIVE_INFINITY;
      let contar = false;
      let condicion: string | null = null;
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'neq', 'not', 'gte', 'lt', 'order', 'range']) {
        b[m] = (...args: unknown[]) => {
          llamadas.push([m, ...args]);
          return b;
        };
      }
      b.or = (expr: string) => {
        llamadas.push(['or', expr]);
        condicion = expr;
        return b;
      };
      b.limit = (n: number) => {
        llamadas.push(['limit', n]);
        limite = n;
        return b;
      };
      b.select = (cols: string, opts?: { count?: string }) => {
        llamadas.push(['select', cols, opts]);
        contar = opts?.count === 'exact';
        return b;
      };
      // biome-ignore lint/suspicious/noThenProperty: imita el builder «thenable» de supabase-js.
      b.then = (ok: (r: unknown) => void) => {
        if (opciones.error) return ok({ data: null, error: opciones.error, count: null });
        if (tabla === 'v_ventas_diarias') {
          return ok({ data: opciones.vista ?? [], error: null, count: null });
        }
        const desde = Number(/folio\.gt\.(\d+)/.exec(condicion ?? '')?.[1] ?? 0);
        const filas = folios
          .filter((f) => f > desde)
          .slice(0, limite)
          .map((f) => ({
            id: idDe(f),
            tipo_dte: 39,
            folio: f,
            fecha_emision: '2026-11-16',
            receptor_rut: '66666666-6',
            receptor_razon_social: null,
            mnt_neto: 1000,
            mnt_exe: 0,
            iva: 190,
            mnt_total: 1190,
            estado: 'aceptado',
            envios: f % 2 === 1 ? { track_id: `T${f}` } : null,
          }));
        const count = contar ? (opciones.conteo ?? folios.length) : null;
        lotes += 1;
        opciones.trasLote?.(folios, lotes);
        ok({ data: filas, error: null, count });
      };
      return b;
    },
  } as unknown as SupabaseClient<Database>;
  return { cliente, consultas };
}

const CTX = { organizacionId: 'org-1', empresaId: 'emp-1', ambiente: 'certificacion' as const };
const CTX_PRODUCCION = { ...CTX, ambiente: 'produccion' as const };
const FILTROS = { periodo: '2026-11', tipo: null, estado: null, q: '' };

function llamada(consulta: { llamadas: Llamada[] } | undefined, metodo: string) {
  return consulta?.llamadas.find((l) => l[0] === metodo);
}

describe('condicionCursor', () => {
  it('expande el keyset (fecha, tipo, folio, id) con valores entre comillas', () => {
    expect(
      condicionCursor({ fecha_emision: '2026-11-16', tipo_dte: 39, folio: 1000, id: idDe(1000) }),
    ).toBe(
      [
        'fecha_emision.gt."2026-11-16"',
        'and(fecha_emision.eq."2026-11-16",tipo_dte.gt.39)',
        'and(fecha_emision.eq."2026-11-16",tipo_dte.eq.39,folio.gt.1000)',
        `and(fecha_emision.eq."2026-11-16",tipo_dte.eq.39,folio.eq.1000,id.gt."${idDe(1000)}")`,
      ].join(','),
    );
  });

  it.each([
    [{ fecha_emision: '2026-11-16),or(id.gt.0', tipo_dte: 39, folio: 1, id: idDe(1) }],
    [{ fecha_emision: '2026-11-16', tipo_dte: 39.5, folio: 1, id: idDe(1) }],
    [{ fecha_emision: '2026-11-16', tipo_dte: 39, folio: 1, id: 'x",id.gt."0' }],
  ])('rechaza valores que no son fecha, entero o uuid (%#)', (cursor) => {
    expect(() => condicionCursor(cursor)).toThrow('Cursor de exportación inválido.');
  });
});

describe('leerDocumentosExportacion', () => {
  it('pagina por keyset de a 1.000 hasta un lote incompleto, con filtros y orden estable', async () => {
    const { cliente, consultas } = clienteFalso({ total: 2_345 });
    const filas = await leerDocumentosExportacion(CTX, FILTROS, { sesion: async () => cliente });
    expect(filas).toHaveLength(2_345);
    expect(filas.map((f) => f.folio)).toEqual(Array.from({ length: 2_345 }, (_, i) => i + 1));
    expect(filas[0]?.track_id).toBe('T1');
    expect(filas[1]?.track_id).toBeNull();
    expect(filas[0]).not.toHaveProperty('envios');
    expect(filas[0]).not.toHaveProperty('id');

    expect(consultas).toHaveLength(3);
    expect(consultas.map((c) => llamada(c, 'limit'))).toEqual([
      ['limit', FILAS_POR_LOTE],
      ['limit', FILAS_POR_LOTE],
      ['limit', FILAS_POR_LOTE],
    ]);
    // Sin offset: el primer lote no lleva cursor; los siguientes, el de la última fila.
    expect(consultas.some((c) => llamada(c, 'range'))).toBe(false);
    expect(llamada(consultas[0], 'or')).toBeUndefined();
    expect(String(llamada(consultas[1], 'or')?.[1])).toContain('folio.gt.1000');
    expect(String(llamada(consultas[2], 'or')?.[1])).toContain('folio.gt.2000');

    const primera = consultas[0]?.llamadas ?? [];
    // Solo la primera cuenta (para el tope).
    expect(llamada(consultas[0], 'select')?.[2]).toEqual({ count: 'exact' });
    expect(llamada(consultas[1], 'select')?.[2]).toBeUndefined();
    expect(primera).toEqual(
      expect.arrayContaining([
        ['eq', 'organizacion_id', 'org-1'],
        ['eq', 'empresa_id', 'emp-1'],
        ['eq', 'ambiente', 'certificacion'],
        ['neq', 'origen', 'set_pruebas'],
        ['not', 'folio', 'is', null],
        ['gte', 'fecha_emision', '2026-11-01'],
        ['lt', 'fecha_emision', '2026-12-01'],
      ]),
    );
    const estados = llamada(consultas[0], 'in')?.[2] as string[];
    expect(estados).not.toContain('borrador');
    expect(estados).toContain('aceptado');
    expect(primera.filter((l) => l[0] === 'order').map((l) => l[1])).toEqual([
      'fecha_emision',
      'tipo_dte',
      'folio',
      'id',
    ]);
  });

  it('un múltiplo exacto de 1.000 pide un lote vacío al final', async () => {
    const { cliente, consultas } = clienteFalso({ total: 2_000 });
    const filas = await leerDocumentosExportacion(
      CTX,
      { ...FILTROS, periodo: 'todos' },
      { sesion: async () => cliente },
    );
    expect(filas).toHaveLength(2_000);
    expect(consultas).toHaveLength(3);
    // Todos los períodos: sin rango de fechas.
    expect(llamada(consultas[0], 'gte')).toBeUndefined();
  });

  it('una boleta ya leída que sale del filtro durante la lectura no corre las demás', async () => {
    // Con offset, quitar el folio 5 tras el primer lote haría que el segundo empezara en
    // el 1.002 y el 1.001 no saliera nunca.
    const { cliente } = clienteFalso({
      total: 2_345,
      trasLote: (folios, lote) => {
        if (lote === 1) folios.splice(folios.indexOf(5), 1);
      },
    });
    const filas = await leerDocumentosExportacion(CTX, FILTROS, { sesion: async () => cliente });
    const leidos = filas.map((f) => f.folio);
    expect(new Set(leidos).size).toBe(leidos.length);
    expect(leidos).toHaveLength(2_345);
    expect(leidos).toContain(1_001);
  });

  it('aplica tipo, estado y búsqueda como Documentos, y combina búsqueda y cursor en un solo or()', async () => {
    const { cliente, consultas } = clienteFalso({ total: 1_500 });
    await leerDocumentosExportacion(
      CTX,
      { periodo: '2026-11', tipo: 41, estado: 'reparos', q: '42' },
      { sesion: async () => cliente },
    );
    const l = consultas[0]?.llamadas ?? [];
    expect(l).toEqual(
      expect.arrayContaining([
        ['eq', 'tipo_dte', 41],
        ['in', 'estado', ['aceptado_con_reparos']],
      ]),
    );
    const busqueda = String(llamada(consultas[0], 'or')?.[1]);
    expect(busqueda).toContain('folio.eq.42');
    const segunda = consultas[1]?.llamadas.filter((x) => x[0] === 'or') ?? [];
    expect(segunda).toHaveLength(1);
    expect(String(segunda[0]?.[1])).toMatch(
      /^and\(or\(.*folio\.eq\.42.*\),or\(.*folio\.gt\.1000.*\)\)$/,
    );
  });

  it('más de 50.000 filas por el conteo: lanza antes de leer el resto', async () => {
    const { cliente, consultas } = clienteFalso({ total: MAXIMO_FILAS + 1 });
    await expect(
      leerDocumentosExportacion(CTX, FILTROS, { sesion: async () => cliente }),
    ).rejects.toBeInstanceOf(ExportacionDemasiadoGrande);
    expect(consultas).toHaveLength(1);
  });

  it('si llegan filas durante la lectura y se pasa del tope, falla en vez de cortar', async () => {
    // El conteo inicial cabe, pero la lectura encuentra una fila más.
    const { cliente } = clienteFalso({ total: MAXIMO_FILAS + 1, conteo: MAXIMO_FILAS });
    const error = await leerDocumentosExportacion(CTX, FILTROS, {
      sesion: async () => cliente,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportacionDemasiadoGrande);
    expect((error as ExportacionDemasiadoGrande).total).toBe(MAXIMO_FILAS + 1);
  });

  it('un error de la base se informa sin detalles', async () => {
    const { cliente } = clienteFalso({ total: 10, error: { code: '42501' } });
    await expect(
      leerDocumentosExportacion(CTX, FILTROS, { sesion: async () => cliente }),
    ).rejects.toThrow('No se pudo leer los documentos para exportar en Supabase (código 42501).');
  });
});

describe('leerResumenDiario', () => {
  it('certificación: agrupa los aceptados del mes sin el set de pruebas (no usa la vista)', async () => {
    const { cliente, consultas } = clienteFalso({ total: 1_500 });
    const dias = await leerResumenDiario(CTX, '2026-11', { sesion: async () => cliente });
    expect(dias).toEqual([
      {
        fecha_emision: '2026-11-16',
        tipo_dte: 39,
        documentos: 1_500,
        folio_min: 1,
        folio_max: 1_500,
        mnt_neto: 1_500_000,
        mnt_exe: 0,
        iva: 285_000,
        mnt_total: 1_785_000,
      },
    ]);
    expect(consultas.map((c) => c.tabla)).toEqual(['documentos', 'documentos']);
    expect(consultas[0]?.llamadas).toEqual(
      expect.arrayContaining([
        ['eq', 'organizacion_id', 'org-1'],
        ['eq', 'empresa_id', 'emp-1'],
        ['eq', 'ambiente', 'certificacion'],
        ['in', 'estado', ['aceptado', 'aceptado_con_reparos']],
        ['neq', 'origen', 'set_pruebas'],
        ['gte', 'fecha_emision', '2026-11-01'],
        ['lt', 'fecha_emision', '2026-12-01'],
      ]),
    );
    expect(
      consultas[0]?.llamadas.some((l) => l[0] === 'or' || (l[0] === 'eq' && l[1] === 'tipo_dte')),
    ).toBe(false);
  });

  it('producción: sale de v_ventas_diarias, sin leer boleta por boleta ni tope', async () => {
    const { cliente, consultas } = clienteFalso({
      total: 0,
      vista: [
        {
          fecha_emision: '2026-11-02',
          tipo_dte: 39,
          documentos: 60_000,
          folio_min: 1,
          folio_max: 60_000,
          mnt_neto: 60_000_000,
          mnt_exe: 0,
          iva: 11_400_000,
          mnt_total: 71_400_000,
        },
        {
          fecha_emision: '2026-11-02',
          tipo_dte: 41,
          documentos: 2,
          folio_min: 7,
          folio_max: 8,
          mnt_neto: 0,
          mnt_exe: 5_000,
          iva: 0,
          mnt_total: 5_000,
        },
      ],
    });
    const dias = await leerResumenDiario(CTX_PRODUCCION, '2026-11', {
      sesion: async () => cliente,
    });
    expect(dias).toHaveLength(2);
    expect(dias[0]).toMatchObject({ tipo_dte: 39, documentos: 60_000, folio_max: 60_000 });
    expect(dias[1]).toMatchObject({ tipo_dte: 41, mnt_exe: 5_000, folio_min: 7 });
    expect(consultas.map((c) => c.tabla)).toEqual(['v_ventas_diarias']);
    expect(consultas[0]?.llamadas).toEqual(
      expect.arrayContaining([
        ['eq', 'organizacion_id', 'org-1'],
        ['eq', 'empresa_id', 'emp-1'],
        ['eq', 'ambiente', 'produccion'],
        ['gte', 'fecha_emision', '2026-11-01'],
        ['lt', 'fecha_emision', '2026-12-01'],
      ]),
    );
  });

  it('producción: un error de la vista se informa sin detalles', async () => {
    const { cliente } = clienteFalso({ total: 0, error: { code: '42501' } });
    await expect(
      leerResumenDiario(CTX_PRODUCCION, '2026-11', { sesion: async () => cliente }),
    ).rejects.toThrow('No se pudo leer el resumen diario en Supabase (código 42501).');
  });

  it('sin mes no consulta', async () => {
    const { cliente, consultas } = clienteFalso({ total: 0 });
    await expect(leerResumenDiario(CTX, 'todos', { sesion: async () => cliente })).rejects.toThrow(
      'AAAA-MM',
    );
    expect(consultas).toHaveLength(0);
  });
});
