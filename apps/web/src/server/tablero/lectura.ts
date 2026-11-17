import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fallaBase } from '../certificacion/comun';
import { rangoPeriodo } from '../documentos/filtros';
import type { AmbienteSii } from '../documentos/presentacion';
import { clienteServidor } from '../supabase/servidor';
import type { Database } from '../supabase/tipos';
import {
  type ConteoEstados,
  calcularVentas,
  conteoVacio,
  ESTADOS_CONTADOS,
  type Ventas,
} from './cifras';

// Lecturas del Tablero (PLAN-SAAS Fase 9) con el cliente de SESIÓN: todo pasa por RLS
// (lectura para cualquier miembro) y cada consulta filtra además por organización,
// empresa y ambiente. Sin migración: las ventas salen de `v_ventas_diarias` (una fila por
// día y tipo, pocas filas aunque haya miles de boletas) y los conteos por estado con
// `count: 'exact', head: true` (sin traer filas). Las agregaciones de PostgREST
// (`mnt_neto.sum()`) están apagadas en el proyecto, por eso no se usan.

type ClienteSesion = SupabaseClient<Database>;

export interface DependenciasTablero {
  sesion: () => Promise<ClienteSesion>;
}

export interface ContextoTablero {
  organizacionId: string;
  empresaId: string;
  ambiente: AmbienteSii;
  /** `AAAA-MM`. */
  periodo: string;
}

export interface CifrasPeriodo {
  ventas: Ventas;
  conteo: ConteoEstados;
}

/** Tope de documentos del set de pruebas que se leen para restarlos (un set trae ~10). */
const MAXIMO_SET = 1000;

/**
 * Cifras del período: ventas (aceptados y con reparos, sin el set de pruebas) y
 * documentos por estado con los mismos filtros que la lista de Documentos (sin borradores,
 * sin el set y con folio), así que cada conteo por estado calza con «Ver todos» filtrado
 * por ese estado. El total de «Documentos emitidos» no es el de «Ver todos»: descuenta los
 * anulados, que la lista sí muestra (la UI lo dice con «Sin contar N anulados»; ver
 * `cifrasDocumentos`). Lanza `fallaBase` si una consulta falla.
 */
export async function leerCifras(
  ctx: ContextoTablero,
  dependencias?: Partial<DependenciasTablero>,
): Promise<CifrasPeriodo> {
  const rango = rangoPeriodo(ctx.periodo);
  if (!rango) throw new Error(`Período inválido: ${ctx.periodo}`);
  const sesion = await (dependencias?.sesion ?? clienteServidor)();

  const diarias = sesion
    .from('v_ventas_diarias')
    .select('documentos, mnt_neto, iva, mnt_exe, mnt_total')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', ctx.ambiente)
    .gte('fecha_emision', rango.desde)
    .lt('fecha_emision', rango.hasta);

  // El set solo existe en certificación: en producción no hace falta la consulta.
  const delSet =
    ctx.ambiente === 'certificacion'
      ? sesion
          .from('documentos')
          .select('mnt_neto, iva, mnt_exe, mnt_total')
          .eq('organizacion_id', ctx.organizacionId)
          .eq('empresa_id', ctx.empresaId)
          .eq('ambiente', ctx.ambiente)
          .eq('origen', 'set_pruebas')
          .in('estado', ['aceptado', 'aceptado_con_reparos'])
          .gte('fecha_emision', rango.desde)
          .lt('fecha_emision', rango.hasta)
          .limit(MAXIMO_SET)
      : Promise.resolve({ data: [], error: null });

  const conteos = ESTADOS_CONTADOS.map((estado) =>
    sesion
      .from('documentos')
      .select('id', { count: 'exact', head: true })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('ambiente', ctx.ambiente)
      .eq('estado', estado)
      .neq('origen', 'set_pruebas')
      .not('folio', 'is', null)
      .gte('fecha_emision', rango.desde)
      .lt('fecha_emision', rango.hasta),
  );

  const [v, s, ...c] = await Promise.all([diarias, delSet, ...conteos]);
  if (v.error) throw fallaBase('leer las ventas del período', v.error);
  if (s.error) throw fallaBase('leer los documentos del set de pruebas', s.error);
  const conteo = conteoVacio();
  ESTADOS_CONTADOS.forEach((estado, i) => {
    const r = c[i];
    if (!r || r.error) throw fallaBase('contar los documentos del período', r?.error ?? null);
    conteo[estado] = r.count ?? 0;
  });
  return { ventas: calcularVentas(v.data ?? [], s.data ?? []), conteo };
}
