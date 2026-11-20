import 'server-only';
import type { ClienteServicio } from '../supabase/service';

// Cliente de Supabase falso en memoria para las pruebas de `server/pagos/`. Cubre lo que
// usa `suscripciones.ts`: select (con `count`/`head`), insert, update y upsert (con
// `onConflict`), filtros `eq`/`neq`/`in`/`not(…, 'is', null)`, `order` y `limit`,
// `single`/`maybeSingle` (con el error PGRST116 de supabase-js), los índices únicos de la
// 0016 (error 23505) y `rpc('activar_suscripcion')` con la semántica de la 0016. Las filas
// salen copiadas (como si vinieran serializadas) y las claves `undefined` no se escriben
// (supabase-js las omite al serializar).

export type Fila = Record<string, unknown>;
export type ErrorBase = { message: string; code?: string };
type Resultado = { data: unknown; error: ErrorBase | null; count?: number | null };

const VIGENTES = ['prueba', 'activa', 'morosa'];

/** Índices únicos (y claves primarias) de las tablas que se escriben. */
const UNICOS: Record<string, string[][]> = {
  eventos_pasarela: [['id'], ['proveedor', 'tipo', 'token']],
  clientes_pago: [['organizacion_id'], ['proveedor', 'cliente_externo']],
  pagos: [['id'], ['proveedor', 'factura_externa']],
  suscripciones: [['id'], ['proveedor_pago', 'id_externo']],
};

/** Valores por defecto de las columnas (los de las migraciones). */
const POR_DEFECTO: Record<string, () => Fila> = {
  eventos_pasarela: () => ({
    estado: 'recibido',
    intentos: 1,
    datos: {},
    error: null,
    organizacion_id: null,
    recibido_en: new Date().toISOString(),
    procesado_en: null,
  }),
  clientes_pago: () => ({
    tarjeta_marca: null,
    tarjeta_ultimos4: null,
    tarjeta_registrada_en: null,
    plan_pendiente_id: null,
    plan_pendiente_por: null,
    plan_pendiente_en: null,
  }),
  suscripciones: () => ({
    proveedor_pago: null,
    id_externo: null,
    periodo_fin: null,
    cancelar_al_fin_periodo: false,
    sincronizada_en: null,
  }),
  pagos: () => ({ intentos: 0 }),
};

export interface BaseMemoria {
  cliente: ClienteServicio;
  tablas: Record<string, Fila[]>;
  /** Llamadas a `rpc`, en orden. */
  rpcs: { nombre: string; args: Fila }[];
  /** Errores forzados: `tabla:operación` (`pagos:upsert`) o `rpc:nombre`. Persisten hasta borrarlos. */
  fallas: Map<string, ErrorBase>;
}

function sinIndefinidos(v: Fila): Fila {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
}

function copia<T>(v: T): T {
  return structuredClone(v);
}

export function baseMemoria(inicial: Record<string, Fila[]> = {}): BaseMemoria {
  const tablas: Record<string, Fila[]> = {};
  for (const [t, filas] of Object.entries(inicial)) tablas[t] = filas.map((f) => copia(f));
  const rpcs: BaseMemoria['rpcs'] = [];
  const fallas = new Map<string, ErrorBase>();
  let secuencia = 0;
  const nuevoId = (tabla: string) => `${tabla}-${++secuencia}`;
  const filasDe = (tabla: string) => {
    tablas[tabla] ??= [];
    return tablas[tabla];
  };

  function violacion(tabla: string, fila: Fila, otras: Fila[], propia?: Fila): ErrorBase | null {
    for (const columnas of UNICOS[tabla] ?? []) {
      if (columnas.some((c) => fila[c] === null || fila[c] === undefined)) continue;
      if (otras.some((o) => o !== propia && columnas.every((c) => o[c] === fila[c]))) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint (${tabla}: ${columnas.join(', ')})`,
        };
      }
    }
    if (
      tabla === 'suscripciones' &&
      VIGENTES.includes(String(fila.estado)) &&
      otras.some(
        (o) =>
          o !== propia &&
          o.organizacion_id === fila.organizacion_id &&
          VIGENTES.includes(String(o.estado)),
      )
    ) {
      return {
        code: '23505',
        message: 'duplicate key value violates unique constraint "suscripciones_vigente_unica"',
      };
    }
    return null;
  }

  function insertar(tabla: string, valores: Fila[]): { filas: Fila[]; error: ErrorBase | null } {
    const destino = filasDe(tabla);
    const nuevas = valores.map((v) => ({
      id: nuevoId(tabla),
      creado_en: new Date().toISOString(),
      ...POR_DEFECTO[tabla]?.(),
      ...sinIndefinidos(v),
    }));
    for (const [i, fila] of nuevas.entries()) {
      const error = violacion(tabla, fila, [...destino, ...nuevas.slice(0, i)]);
      if (error) return { filas: [], error };
    }
    destino.push(...nuevas);
    return { filas: nuevas, error: null };
  }

  function consulta(tabla: string) {
    let operacion: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let valores: Fila[] = [];
    let cambios: Fila = {};
    let conflicto: string[] = [];
    let devolver = false;
    let contar = false;
    let soloCabecera = false;
    const filtros: ((f: Fila) => boolean)[] = [];
    let orden: { columna: string; asc: boolean; nulosPrimero: boolean } | null = null;
    let tope = Number.POSITIVE_INFINITY;
    let modo: 'varios' | 'uno' | 'quizas' = 'varios';

    const cumple = (f: Fila) => filtros.every((p) => p(f));

    function ejecutar(): Resultado {
      const falla = fallas.get(`${tabla}:${operacion}`);
      if (falla) return { data: null, error: falla, count: null };
      const destino = filasDe(tabla);
      let filas: Fila[];
      switch (operacion) {
        case 'select':
          filas = destino.filter(cumple);
          break;
        case 'insert': {
          const r = insertar(tabla, valores);
          if (r.error) return { data: null, error: r.error };
          filas = r.filas;
          break;
        }
        case 'update': {
          const objetivo = destino.filter(cumple);
          const limpio = sinIndefinidos(cambios);
          for (const f of objetivo) {
            const error = violacion(tabla, { ...f, ...limpio }, destino, f);
            if (error) return { data: null, error };
          }
          for (const f of objetivo) Object.assign(f, limpio);
          filas = objetivo;
          break;
        }
        case 'upsert': {
          filas = [];
          for (const v of valores) {
            const existente = destino.find((f) => conflicto.every((c) => f[c] === v[c]));
            if (existente) {
              Object.assign(existente, sinIndefinidos(v));
              filas.push(existente);
            } else {
              const r = insertar(tabla, [v]);
              if (r.error) return { data: null, error: r.error };
              filas.push(...r.filas);
            }
          }
          break;
        }
      }
      if (orden) {
        const { columna, asc, nulosPrimero } = orden;
        filas = [...filas].sort((a, b) => {
          const x = a[columna];
          const y = b[columna];
          const nx = x === null || x === undefined;
          const ny = y === null || y === undefined;
          if (nx || ny) return nx === ny ? 0 : nx === nulosPrimero ? -1 : 1;
          const c = String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          return asc ? c : -c;
        });
      }
      filas = filas.slice(0, tope).map((f) => copia(f));
      const count = contar ? filas.length : null;
      if (operacion !== 'select' && !devolver) return { data: null, error: null, count };
      if (modo === 'uno' && filas.length !== 1) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
          },
        };
      }
      if (modo === 'quizas' && filas.length > 1) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' },
        };
      }
      if (modo !== 'varios') return { data: filas[0] ?? null, error: null };
      return { data: soloCabecera ? null : filas, error: null, count };
    }

    const b = {
      select(_columnas?: string, opciones?: { count?: string; head?: boolean }) {
        if (operacion !== 'select') devolver = true;
        if (opciones?.count) contar = true;
        if (opciones?.head) soloCabecera = true;
        return b;
      },
      insert(v: Fila | Fila[]) {
        operacion = 'insert';
        valores = Array.isArray(v) ? v : [v];
        return b;
      },
      upsert(v: Fila | Fila[], opciones?: { onConflict?: string }) {
        operacion = 'upsert';
        valores = Array.isArray(v) ? v : [v];
        conflicto = (opciones?.onConflict ?? 'id').split(',').map((c) => c.trim());
        return b;
      },
      update(v: Fila) {
        operacion = 'update';
        cambios = v;
        return b;
      },
      eq(c: string, v: unknown) {
        filtros.push((f) => f[c] === v);
        return b;
      },
      neq(c: string, v: unknown) {
        filtros.push((f) => f[c] !== v);
        return b;
      },
      in(c: string, vs: unknown[]) {
        filtros.push((f) => vs.includes(f[c]));
        return b;
      },
      not(c: string, operador: string, v: unknown) {
        if (operador !== 'is' || v !== null) throw new Error(`not(${operador}) no simulado`);
        filtros.push((f) => f[c] !== null && f[c] !== undefined);
        return b;
      },
      order(c: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }) {
        const asc = opciones?.ascending ?? true;
        // Como Postgres: NULLS LAST en ascendente, NULLS FIRST en descendente.
        orden = { columna: c, asc, nulosPrimero: opciones?.nullsFirst ?? !asc };
        return b;
      },
      limit(n: number) {
        tope = n;
        return b;
      },
      single() {
        modo = 'uno';
        return Promise.resolve().then(ejecutar);
      },
      maybeSingle() {
        modo = 'quizas';
        return Promise.resolve().then(ejecutar);
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el builder «thenable» de supabase-js.
      then<A, B>(ok?: (r: Resultado) => A, mal?: (e: unknown) => B) {
        return Promise.resolve().then(ejecutar).then(ok, mal);
      },
    };
    return b;
  }

  function error(code: string, message: string): Resultado {
    return { data: null, error: { code, message } };
  }

  /** `activar_suscripcion` de la 0016. */
  function activarSuscripcion(args: Fila): Resultado {
    const org = args.p_organizacion as string | undefined;
    const plan = args.p_plan as string | undefined;
    const estado = args.p_estado as string | undefined;
    const proveedor = (args.p_proveedor as string | undefined) ?? null;
    const externo = (args.p_id_externo as string | undefined) ?? null;
    const inicio = (args.p_periodo_inicio as string | undefined) ?? null;
    const fin = (args.p_periodo_fin as string | undefined) ?? null;
    if (!org || !plan || !estado)
      return error('22004', 'Faltan la organización, el plan o el estado');
    if (estado !== 'prueba' && estado !== 'activa') {
      return error('22023', `Estado no permitido al activar: ${estado}`);
    }
    if ((proveedor === null) !== (externo === null)) {
      return error('22023', 'El proveedor y el id externo van juntos');
    }
    if (!filasDe('organizaciones').some((o) => o.id === org)) {
      return error('P0002', 'La organización no existe');
    }
    if (!filasDe('planes').some((p) => p.id === plan)) return error('P0002', 'El plan no existe');
    const suscripciones = filasDe('suscripciones');
    if (
      externo !== null &&
      suscripciones.some(
        (s) =>
          s.proveedor_pago === proveedor && s.id_externo === externo && s.estado === 'cancelada',
      )
    ) {
      return error('22023', `La suscripción externa ${externo} ya terminó`);
    }
    const ahora = new Date().toISOString();
    const vigente = suscripciones.find(
      (s) => s.organizacion_id === org && VIGENTES.includes(String(s.estado)),
    );
    if (
      vigente &&
      ((externo !== null &&
        vigente.proveedor_pago === proveedor &&
        vigente.id_externo === externo) ||
        (externo === null && vigente.id_externo === null && vigente.plan_id === plan))
    ) {
      Object.assign(vigente, {
        plan_id: plan,
        estado,
        periodo_inicio: inicio ?? vigente.periodo_inicio,
        periodo_fin: externo === null ? fin : (fin ?? vigente.periodo_fin),
        cancelar_al_fin_periodo: false,
      });
      return { data: vigente.id, error: null };
    }
    if (vigente) {
      const finAnterior = vigente.periodo_fin as string | null;
      vigente.estado = 'cancelada';
      vigente.periodo_fin = finAnterior && finAnterior < ahora ? finAnterior : ahora;
    }
    const id = nuevoId('suscripciones');
    suscripciones.push({
      id,
      organizacion_id: org,
      plan_id: plan,
      estado,
      periodo_inicio: inicio ?? ahora,
      periodo_fin: fin,
      proveedor_pago: proveedor,
      id_externo: externo,
      cancelar_al_fin_periodo: false,
      sincronizada_en: proveedor !== null ? ahora : null,
    });
    return { data: id, error: null };
  }

  const cliente = {
    from: (tabla: string) => consulta(tabla),
    rpc: async (nombre: string, args: Fila = {}): Promise<Resultado> => {
      rpcs.push({ nombre, args: copia(args) });
      const falla = fallas.get(`rpc:${nombre}`);
      if (falla) return { data: null, error: falla };
      if (nombre === 'activar_suscripcion') return activarSuscripcion(args);
      return error('42883', `rpc ${nombre} no simulada`);
    },
  } as unknown as ClienteServicio;

  return { cliente, tablas, rpcs, fallas };
}
