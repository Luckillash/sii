import 'server-only';
import { z } from 'zod';
import { textoEstadoDte } from '@/components/boleteame/EstadoDTE';
import { type AmbienteSii, type EstadoDocumentoBd, estadoUi } from '@/lib/documentos-presentacion';
import { formatearRut, nombreTipoDte, rutSii } from '@/lib/formatos';
import { FORMATOS_REPORTE, type FormatoReporte, REPORTES, type Reporte } from '@/lib/reportes';
import {
  type FiltrosDocumentos,
  type ParametrosUrl,
  parametrosDe,
  TODOS_LOS_PERIODOS,
} from '../documentos/filtros';
import type { Columna, Fila, Tabla } from './tabla';

// Exportaciones de la Fase 9 (PLAN-SAAS, punto 2): qué se pide (`reporte` y `formato` de
// la URL), las columnas y filas de cada reporte, el nombre del archivo y el enlace. Puro:
// la lectura está en `lectura.ts` y la escritura en `csv.ts` / `xlsx.ts`.
//
// Contrato de la URL (el Tablero y Documentos enlazan así):
//   /[org]/reportes/exportar?empresa&ambiente&periodo&reporte=documentos|resumen&formato=csv|xlsx
// y, solo con `reporte=documentos`, `tipo`, `estado` y `q` como en Documentos.

// Los valores válidos son los de `lib/reportes.ts` (el contrato que usa el Tablero).
export type { Reporte };
export type Formato = FormatoReporte;

/** Tope de filas de una exportación de documentos (50 páginas de 1.000). */
export const MAXIMO_FILAS = 50_000;

export type Pedido =
  | { ok: true; reporte: Reporte; formato: Formato }
  | { ok: false; mensaje: string };

function unico(valor: string | string[] | undefined): string | undefined {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim();
}

/**
 * Lee `reporte` y `formato`, y rechaza el resumen sin mes: `v_ventas_diarias` agrupa por
 * día y el resumen es del período tributario (mensual). El resto de los filtros los lee
 * `leerFiltros`, que nunca falla.
 */
export function leerPedido(parametros: ParametrosUrl, periodo: string): Pedido {
  const reporte = z.enum(REPORTES).safeParse(unico(parametros.reporte));
  if (!reporte.success) {
    return {
      ok: false,
      mensaje:
        'No reconocemos el reporte pedido. Usa «documentos» (boletas del período) o «resumen» (resumen diario por tipo).',
    };
  }
  const formato = z.enum(FORMATOS_REPORTE).safeParse(unico(parametros.formato));
  if (!formato.success) {
    return {
      ok: false,
      mensaje: 'No reconocemos el formato pedido. Usa «csv» o «xlsx» (Excel).',
    };
  }
  if (reporte.data === 'resumen' && periodo === TODOS_LOS_PERIODOS) {
    return {
      ok: false,
      mensaje:
        'El resumen diario es de un período tributario. Elige un mes en el selector de período y vuelve a exportar.',
    };
  }
  return { ok: true, reporte: reporte.data, formato: formato.data };
}

/** Enlace de exportación con los filtros vigentes (para `reporte=resumen`, sin tipo, estado ni búsqueda). */
export function hrefExportar(
  slug: string,
  filtros: FiltrosDocumentos,
  reporte: Reporte,
  formato: Formato,
): string {
  const base: Partial<FiltrosDocumentos> = { pagina: 1, doc: null };
  const p = parametrosDe(
    filtros,
    reporte === 'resumen' ? { ...base, tipo: null, estado: null, q: '' } : base,
  );
  p.set('reporte', reporte);
  p.set('formato', formato);
  return `/${encodeURIComponent(slug)}/reportes/exportar?${p.toString()}`;
}

/** `boletas-20630500-2-certificacion-2026-11.csv` / `resumen-diario-….xlsx`. */
export function nombreArchivo(
  reporte: Reporte,
  rutEmpresa: string,
  ambiente: AmbienteSii,
  periodo: string,
  formato: Formato,
): string {
  const prefijo = reporte === 'documentos' ? 'boletas' : 'resumen-diario';
  const rut = rutSii(rutEmpresa) || 'empresa';
  const p = /^\d{4}-\d{2}$/.test(periodo) ? periodo : TODOS_LOS_PERIODOS;
  return `${prefijo}-${rut}-${ambiente}-${p}.${formato}`;
}

// --- Documentos del período ---------------------------------------------------------------

/** Una fila de `documentos` tal como la lee `lectura.ts` (sin secretos ni `ted_xml`). */
export interface DocumentoExportado {
  tipo_dte: number;
  folio: number | null;
  fecha_emision: string;
  receptor_rut: string;
  receptor_razon_social: string | null;
  mnt_neto: number;
  mnt_exe: number;
  iva: number;
  mnt_total: number;
  estado: EstadoDocumentoBd;
  track_id: string | null;
}

const COLUMNAS_DOCUMENTOS: readonly Columna[] = [
  { titulo: 'Tipo (código)', tipo: 'entero', ancho: 14 },
  { titulo: 'Tipo', tipo: 'texto', ancho: 28 },
  { titulo: 'Folio', tipo: 'entero', ancho: 10 },
  { titulo: 'Fecha de emisión', tipo: 'fecha', ancho: 16 },
  { titulo: 'RUT receptor', tipo: 'texto', ancho: 14 },
  { titulo: 'Razón social receptor', tipo: 'texto', ancho: 36 },
  { titulo: 'Neto', tipo: 'monto', ancho: 14 },
  { titulo: 'Exento', tipo: 'monto', ancho: 14 },
  { titulo: 'IVA', tipo: 'monto', ancho: 14 },
  { titulo: 'Total', tipo: 'monto', ancho: 14 },
  { titulo: 'Estado', tipo: 'texto', ancho: 16 },
  { titulo: 'Track ID', tipo: 'texto', ancho: 14 },
];

/** Igual que la tabla de Documentos (`aFila` de `server/documentos/lectura.ts`). */
function razonSocial(d: Pick<DocumentoExportado, 'receptor_rut' | 'receptor_razon_social'>) {
  return (
    d.receptor_razon_social?.trim() ||
    (d.receptor_rut === '66666666-6' ? 'Cliente General' : 'Sin razón social')
  );
}

export function tablaDocumentos(docs: readonly DocumentoExportado[]): Tabla {
  return {
    hoja: 'Boletas',
    columnas: COLUMNAS_DOCUMENTOS,
    filas: docs.map(
      (d): Fila => ({
        celdas: [
          d.tipo_dte,
          nombreTipoDte(d.tipo_dte),
          d.folio,
          d.fecha_emision,
          formatearRut(d.receptor_rut),
          razonSocial(d),
          d.mnt_neto,
          d.mnt_exe,
          d.iva,
          d.mnt_total,
          textoEstadoDte(estadoUi(d.estado)),
          d.track_id,
        ],
      }),
    ),
  };
}

// --- Resumen diario por tipo --------------------------------------------------------------

/**
 * Un día y tipo del resumen: las mismas columnas que `v_ventas_diarias`, pero sin los
 * documentos del set de pruebas (ver `leerResumenDiario` en `lectura.ts`).
 */
export interface DiaResumen {
  fecha_emision: string;
  tipo_dte: number;
  documentos: number;
  folio_min: number | null;
  folio_max: number | null;
  mnt_neto: number;
  mnt_exe: number;
  iva: number;
  mnt_total: number;
}

/**
 * Agrupa documentos por fecha de emisión y tipo, como el `group by` de `v_ventas_diarias`
 * (conteo, folio mínimo y máximo, sumas). No filtra estados: quien llama pasa solo los
 * aceptados y con reparos. Ordenado por fecha y tipo.
 */
export function agruparPorDia(
  docs: readonly Pick<
    DocumentoExportado,
    'fecha_emision' | 'tipo_dte' | 'folio' | 'mnt_neto' | 'mnt_exe' | 'iva' | 'mnt_total'
  >[],
): DiaResumen[] {
  const grupos = new Map<string, DiaResumen>();
  for (const d of docs) {
    const clave = `${d.fecha_emision}|${d.tipo_dte}`;
    const g = grupos.get(clave) ?? {
      fecha_emision: d.fecha_emision,
      tipo_dte: d.tipo_dte,
      documentos: 0,
      folio_min: null,
      folio_max: null,
      mnt_neto: 0,
      mnt_exe: 0,
      iva: 0,
      mnt_total: 0,
    };
    g.documentos += 1;
    if (d.folio !== null) {
      g.folio_min = g.folio_min === null ? d.folio : Math.min(g.folio_min, d.folio);
      g.folio_max = g.folio_max === null ? d.folio : Math.max(g.folio_max, d.folio);
    }
    g.mnt_neto += Number(d.mnt_neto);
    g.mnt_exe += Number(d.mnt_exe);
    g.iva += Number(d.iva);
    g.mnt_total += Number(d.mnt_total);
    grupos.set(clave, g);
  }
  return [...grupos.values()].sort(
    (a, b) => a.fecha_emision.localeCompare(b.fecha_emision) || a.tipo_dte - b.tipo_dte,
  );
}

const COLUMNAS_RESUMEN: readonly Columna[] = [
  { titulo: 'Fecha', tipo: 'fecha', ancho: 12 },
  { titulo: 'Tipo', tipo: 'entero', ancho: 8 },
  { titulo: 'Documentos', tipo: 'entero', ancho: 12 },
  { titulo: 'Folio desde', tipo: 'entero', ancho: 12 },
  { titulo: 'Folio hasta', tipo: 'entero', ancho: 12 },
  { titulo: 'Neto', tipo: 'monto', ancho: 14 },
  { titulo: 'Exento', tipo: 'monto', ancho: 14 },
  { titulo: 'IVA', tipo: 'monto', ancho: 14 },
  { titulo: 'Total', tipo: 'monto', ancho: 14 },
];

/** Totales del período (la fila final del resumen). */
export function totalesResumen(dias: readonly DiaResumen[]) {
  return dias.reduce(
    (t, d) => ({
      documentos: t.documentos + d.documentos,
      mnt_neto: t.mnt_neto + d.mnt_neto,
      mnt_exe: t.mnt_exe + d.mnt_exe,
      iva: t.iva + d.iva,
      mnt_total: t.mnt_total + d.mnt_total,
    }),
    { documentos: 0, mnt_neto: 0, mnt_exe: 0, iva: 0, mnt_total: 0 },
  );
}

/** Una fila por día y tipo, en orden, y al final «Total» (sin rango de folios: mezcla tipos). */
export function tablaResumen(dias: readonly DiaResumen[]): Tabla {
  const ordenados = [...dias].sort(
    (a, b) => a.fecha_emision.localeCompare(b.fecha_emision) || a.tipo_dte - b.tipo_dte,
  );
  const t = totalesResumen(ordenados);
  return {
    hoja: 'Resumen diario',
    columnas: COLUMNAS_RESUMEN,
    filas: [
      ...ordenados.map(
        (d): Fila => ({
          celdas: [
            d.fecha_emision,
            d.tipo_dte,
            d.documentos,
            d.folio_min,
            d.folio_max,
            d.mnt_neto,
            d.mnt_exe,
            d.iva,
            d.mnt_total,
          ],
        }),
      ),
      {
        celdas: [
          'Total',
          null,
          t.documentos,
          null,
          null,
          t.mnt_neto,
          t.mnt_exe,
          t.iva,
          t.mnt_total,
        ],
        destacada: true,
      },
    ],
  };
}
