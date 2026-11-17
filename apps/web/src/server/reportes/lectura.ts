import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fallaBase } from '../certificacion/comun';
import {
  armarConsulta,
  type ConsultaDocumentos,
  type FiltrosDocumentos,
  rangoPeriodo,
} from '../documentos/filtros';
import type { AmbienteSii, EstadoDocumentoBd } from '../documentos/presentacion';
import { clienteServidor } from '../supabase/servidor';
import type { Database } from '../supabase/tipos';
import { agruparPorDia, type DiaResumen, type DocumentoExportado, MAXIMO_FILAS } from './filas';

// Lecturas de las exportaciones (PLAN-SAAS Fase 9) con el cliente de SESIÓN: todo pasa
// por RLS (lectura para cualquier miembro) y cada consulta filtra además por organización,
// empresa y ambiente. Nada de secretos: ni `ted_xml` ni ids de Vault.

type ClienteSesion = SupabaseClient<Database>;

export interface DependenciasLectura {
  sesion: () => Promise<ClienteSesion>;
}

function resolver(d?: Partial<DependenciasLectura>): DependenciasLectura {
  return { sesion: d?.sesion ?? clienteServidor };
}

/** Filas por petición: el `max-rows` de PostgREST en Supabase es 1.000. */
export const FILAS_POR_LOTE = 1000;

/**
 * Más filas que `MAXIMO_FILAS`: la ruta responde 413 y pide acotar los filtros. `total` es
 * el conteo inicial o, si las filas crecieron durante la lectura, las leídas hasta pasarse
 * (una cota inferior).
 */
export class ExportacionDemasiadoGrande extends Error {
  constructor(readonly total: number) {
    super(`La exportación tiene ${total} filas (máximo ${MAXIMO_FILAS}).`);
    this.name = 'ExportacionDemasiadoGrande';
  }
}

export interface ContextoExportacion {
  organizacionId: string;
  empresaId: string;
  ambiente: AmbienteSii;
}

// `track_id` por el embed de la FK compuesta (empresa_id, envio_id): una sola consulta
// en vez de un `in` con miles de ids. La pista evita la ambigüedad con la vista
// `v_envios_por_consultar`, que expone la misma FK.
// `id` solo para el cursor de la paginación (no sale en el archivo).
const COLUMNAS_EXPORTACION =
  'id, tipo_dte, folio, fecha_emision, receptor_rut, receptor_razon_social, mnt_neto, mnt_exe, iva, mnt_total, estado, envios!documentos_empresa_id_envio_id_fkey(track_id)';

type FilaBd = Omit<DocumentoExportado, 'track_id'> & {
  id: string;
  envios: { track_id: string | null } | null;
};

/** Última fila leída: el lote siguiente empieza estrictamente después de ella. */
export interface Cursor {
  fecha_emision: string;
  tipo_dte: number;
  folio: number;
  id: string;
}

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Condición de keyset `(fecha_emision, tipo_dte, folio, id) > cursor` para el `or()` de
 * PostgREST, expandida (PostgREST no compara tuplas). Los valores vienen de la base, pero
 * igual se validan y van entre comillas dobles (la forma de PostgREST para valores con
 * caracteres reservados): una fecha o un uuid raros no pueden inyectar filtros.
 */
export function condicionCursor(c: Cursor): string {
  if (
    !PATRON_FECHA.test(c.fecha_emision) ||
    !Number.isSafeInteger(c.tipo_dte) ||
    !Number.isSafeInteger(c.folio) ||
    !PATRON_UUID.test(c.id)
  ) {
    throw new Error('Cursor de exportación inválido.');
  }
  const f = `fecha_emision.eq."${c.fecha_emision}"`;
  const t = `tipo_dte.eq.${c.tipo_dte}`;
  const n = `folio.eq.${c.folio}`;
  return [
    `fecha_emision.gt."${c.fecha_emision}"`,
    `and(${f},tipo_dte.gt.${c.tipo_dte})`,
    `and(${f},${t},folio.gt.${c.folio})`,
    `and(${f},${t},${n},id.gt."${c.id}")`,
  ].join(',');
}

/**
 * Lee todas las filas de una consulta armada, en orden estable de fecha, tipo y folio
 * (`id` desempata). Los filtros son los mismos de `consultar` en
 * `server/documentos/lectura.ts`: sin el set de pruebas y sin documentos sin folio.
 *
 * Pagina por keyset (cada lote empieza después de la última fila leída) y no por `range`:
 * con offset, una boleta que cambia de estado durante la exportación (el seguimiento la
 * pasa de `enviado` a `aceptado`) corre las filas siguientes y el archivo duplica o se
 * salta otras. Si hay más de `MAXIMO_FILAS` (por el conteo del primer lote o porque
 * llegaron filas durante la lectura), lanza `ExportacionDemasiadoGrande`: nunca un archivo
 * cortado sin aviso.
 */
async function leerTodos(
  sesion: ClienteSesion,
  c: ConsultaDocumentos,
): Promise<DocumentoExportado[]> {
  const lote = (cursor: Cursor | null) => {
    let q = sesion
      .from('documentos')
      .select(COLUMNAS_EXPORTACION, cursor ? undefined : { count: 'exact' })
      .eq('organizacion_id', c.organizacionId)
      .eq('empresa_id', c.empresaId)
      .eq('ambiente', c.ambiente)
      .in('estado', [...c.estados])
      .neq('origen', 'set_pruebas')
      .not('folio', 'is', null);
    if (c.periodo) {
      q = q.gte('fecha_emision', c.periodo.desde).lt('fecha_emision', c.periodo.hasta);
    }
    if (c.tipo) q = q.eq('tipo_dte', c.tipo);
    // Un solo `or()`: la búsqueda y el cursor se combinan con `and(or(…),or(…))` para no
    // depender de cómo PostgREST trata dos parámetros `or` repetidos.
    const busqueda = c.busqueda;
    const condicion = cursor ? condicionCursor(cursor) : null;
    if (busqueda && condicion) q = q.or(`and(or(${busqueda}),or(${condicion}))`);
    else if (busqueda) q = q.or(busqueda);
    else if (condicion) q = q.or(condicion);
    return q
      .order('fecha_emision', { ascending: true })
      .order('tipo_dte', { ascending: true })
      .order('folio', { ascending: true })
      .order('id', { ascending: true })
      .limit(FILAS_POR_LOTE);
  };

  const filas: DocumentoExportado[] = [];
  let cursor: Cursor | null = null;
  for (;;) {
    const r = await lote(cursor);
    if (r.error) throw fallaBase('leer los documentos para exportar', r.error);
    if (!cursor && (r.count ?? 0) > MAXIMO_FILAS) {
      throw new ExportacionDemasiadoGrande(r.count ?? 0);
    }
    const datos = (r.data ?? []) as unknown as FilaBd[];
    for (const { envios, id: _id, ...d } of datos) {
      filas.push({ ...d, track_id: envios?.track_id ?? null });
    }
    if (filas.length > MAXIMO_FILAS) throw new ExportacionDemasiadoGrande(filas.length);
    // Un lote incompleto es el último.
    const ultima = datos.at(-1);
    if (datos.length < FILAS_POR_LOTE || !ultima) break;
    // No pasa (la consulta exige folio), pero sin folio no hay cursor: mejor fallar que cortar.
    if (ultima.folio === null) throw new Error('Documento sin folio en la exportación.');
    cursor = {
      fecha_emision: ultima.fecha_emision,
      tipo_dte: ultima.tipo_dte,
      folio: ultima.folio,
      id: ultima.id,
    };
  }
  return filas;
}

/** Todos los documentos que mostraría la lista de Documentos con esos filtros (sin borradores). */
export async function leerDocumentosExportacion(
  ctx: ContextoExportacion,
  filtros: Pick<FiltrosDocumentos, 'periodo' | 'tipo' | 'estado' | 'q'>,
  dependencias?: Partial<DependenciasLectura>,
): Promise<DocumentoExportado[]> {
  const sesion = await resolver(dependencias).sesion();
  return leerTodos(sesion, armarConsulta(ctx, { ...filtros, pagina: 1 }));
}

/** Los estados que suman ventas: los mismos de `v_ventas_diarias`. */
export const ESTADOS_VENTAS: readonly EstadoDocumentoBd[] = ['aceptado', 'aceptado_con_reparos'];

/** Días × tipos de un mes en `v_ventas_diarias`: a lo más 31 × 2 filas. */
const MAXIMO_FILAS_VISTA = 1000;

/**
 * Resumen diario por tipo del período (`AAAA-MM`): aceptados y aceptados con reparos, una
 * fila por día y tipo. Da los mismos totales que el Tablero y las mismas filas que el
 * reporte de boletas filtrado por esos estados.
 *
 * - **Producción:** directo de `v_ventas_diarias` (una fila por día y tipo, con conteo,
 *   folio mínimo y máximo y sumas), sin leer boleta por boleta: así no hay tope de filas
 *   aunque la empresa emita miles al día. La vista no distingue el origen, pero en
 *   producción no hay documentos del set de pruebas: el set solo se crea en certificación
 *   (`server/certificacion/envio-set.ts` inserta `origen = 'set_pruebas'` siempre con
 *   `ambiente = AMBIENTE`, que es `'certificacion'` en `certificacion/comun.ts`). Y todo
 *   aceptado tiene folio (el `check` de `documentos` lo exige fuera de `borrador`).
 * - **Certificación:** la vista sumaría el set de pruebas aceptado, que no son ventas
 *   (Documentos no lo lista y el Tablero lo resta). Restarlo por día y tipo cuadraría los
 *   montos, pero no el rango de folios (la vista solo trae mínimo y máximo), así que se
 *   leen los documentos sin el set y se agrupan con `agruparPorDia`. El volumen de
 *   certificación es chico; si pasara el tope, la ruta responde 413.
 */
export async function leerResumenDiario(
  ctx: ContextoExportacion,
  periodo: string,
  dependencias?: Partial<DependenciasLectura>,
): Promise<DiaResumen[]> {
  const rango = rangoPeriodo(periodo);
  if (!rango) throw new Error('El resumen diario necesita un período AAAA-MM.');
  const sesion = await resolver(dependencias).sesion();

  if (ctx.ambiente === 'produccion') {
    const r = await sesion
      .from('v_ventas_diarias')
      .select(
        'fecha_emision, tipo_dte, documentos, folio_min, folio_max, mnt_neto, mnt_exe, iva, mnt_total',
      )
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('ambiente', ctx.ambiente)
      .gte('fecha_emision', rango.desde)
      .lt('fecha_emision', rango.hasta)
      .order('fecha_emision', { ascending: true })
      .order('tipo_dte', { ascending: true })
      .limit(MAXIMO_FILAS_VISTA);
    if (r.error) throw fallaBase('leer el resumen diario', r.error);
    return (r.data ?? []).map(
      (d): DiaResumen => ({
        fecha_emision: String(d.fecha_emision),
        tipo_dte: Number(d.tipo_dte),
        documentos: Number(d.documentos ?? 0),
        folio_min: d.folio_min === null ? null : Number(d.folio_min),
        folio_max: d.folio_max === null ? null : Number(d.folio_max),
        mnt_neto: Number(d.mnt_neto ?? 0),
        mnt_exe: Number(d.mnt_exe ?? 0),
        iva: Number(d.iva ?? 0),
        mnt_total: Number(d.mnt_total ?? 0),
      }),
    );
  }

  const c = armarConsulta(ctx, { periodo, tipo: null, estado: null, q: '', pagina: 1 });
  return agruparPorDia(await leerTodos(sesion, { ...c, estados: ESTADOS_VENTAS }));
}
