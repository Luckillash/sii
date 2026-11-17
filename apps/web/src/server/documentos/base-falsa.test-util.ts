import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/tipos';

// Cliente de Supabase falso para las pruebas de `server/documentos`: filtra en memoria con
// `eq`, `neq` e `in`, respeta `limit` y registra los `update`. Sin red ni base.

export type Fila = Record<string, unknown>;
export type Escritura = { tabla: string; valor: Fila; filtros: [string, unknown][] };

export function baseFalsa(
  tablas: Record<string, Fila[]>,
  escrituras: Escritura[] = [],
): SupabaseClient<Database> {
  return {
    from(tabla: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      const iguales: [string, unknown][] = [];
      let tope = Number.POSITIVE_INFINITY;
      let valor: Fila | null = null;
      const filas = () => (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      const b = {
        select: () => b,
        update: (v: Fila) => {
          valor = v;
          return b;
        },
        eq: (c: string, v: unknown) => {
          iguales.push([c, v]);
          filtros.push((f) => f[c] === v);
          return b;
        },
        neq: (c: string, v: unknown) => {
          filtros.push((f) => f[c] !== v);
          return b;
        },
        in: (c: string, vs: unknown[]) => {
          filtros.push((f) => vs.includes(f[c]));
          return b;
        },
        order: () => b,
        limit: (n: number) => {
          tope = n;
          return b;
        },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: imita el builder «thenable» de supabase-js.
        then: (ok: (r: { data: Fila[] | null; error: null }) => void) => {
          if (valor) {
            escrituras.push({ tabla, valor, filtros: iguales });
            ok({ data: null, error: null });
            return;
          }
          ok({ data: filas().slice(0, tope), error: null });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient<Database>;
}
