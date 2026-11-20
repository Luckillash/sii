import 'server-only';
import { z } from 'zod';
import type { EstadoDte } from '@/components/boleteame/tipos';
import type { AmbienteSii, EstadoDocumentoBd } from '@/lib/documentos-presentacion';
import { hoyEnChile } from '@/lib/formatos';
import { patronBusqueda } from '../emision/catalogo';

// Filtros de `/[org]/documentos` (PLAN-SAAS Fase 8, §4.3). La URL (`searchParams`) es la
// fuente de verdad: esto la lee (sin lanzar: un valor raro vuelve al valor por defecto),
// la vuelve a escribir para los enlaces y arma la consulta que aplica `lectura.ts`. Puro
// (salvo `patronBusqueda`, también puro), así que se prueba con Vitest.

/** Filas por página de la tabla (paginación en el servidor con `range` + `count`). */
export const POR_PAGINA = 20;
/** Meses que ofrece el selector de período (el actual y los 11 anteriores). */
export const MESES_SELECTOR = 12;
/** Largo máximo de la búsqueda que se considera. */
export const LARGO_MAXIMO_BUSQUEDA = 60;

/** Estados que ofrece el filtro (sin `borrador`: los borradores viven en Emitir). */
export const ESTADOS_FILTRO = [
  'enviado',
  'aceptado',
  'reparos',
  'rechazado',
  'incierto',
  'firmado',
  'anulado',
] as const satisfies readonly EstadoDte[];
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

const ESTADO_BD: Readonly<Record<EstadoFiltro, EstadoDocumentoBd>> = {
  enviado: 'enviado',
  aceptado: 'aceptado',
  reparos: 'aceptado_con_reparos',
  rechazado: 'rechazado',
  incierto: 'incierto',
  firmado: 'firmado',
  anulado: 'anulado',
};

/** Todos los estados de un documento emitido (o que intentó emitirse): todo menos `borrador`. */
export const ESTADOS_LISTADOS: readonly EstadoDocumentoBd[] = Object.values(ESTADO_BD);

export const TODOS_LOS_PERIODOS = 'todos';

export interface FiltrosDocumentos {
  /** `null`: el ambiente por defecto de la empresa (lo resuelve la página). */
  ambiente: AmbienteSii | null;
  /** `null`: la empresa activa (`?empresa` ausente). */
  empresa: string | null;
  /** `AAAA-MM` o `todos`. */
  periodo: string;
  tipo: 39 | 41 | null;
  estado: EstadoFiltro | null;
  /** Folio, RUT o razón social; `''` sin búsqueda. */
  q: string;
  /** Desde 1. */
  pagina: number;
  /** Documento abierto en el panel de detalle. */
  doc: string | null;
}

export type ParametrosUrl = Record<string, string | string[] | undefined>;

function unico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const esquemaPeriodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((p) => {
    const anio = Number(p.slice(0, 4));
    return anio >= 2000 && anio <= 2100;
  });
const esquemaAmbiente = z.enum(['certificacion', 'produccion']);
const esquemaTipo = z.enum(['39', '41']).transform((t) => Number(t) as 39 | 41);
const esquemaEstado = z.enum(ESTADOS_FILTRO);
const esquemaPagina = z.coerce.number().int().min(1).max(100_000);
const esquemaUuid = z.uuid();

/** `AAAA-MM` del mes actual en Chile. */
export function periodoActual(ahora: Date = new Date()): string {
  return hoyEnChile(ahora).slice(0, 7);
}

/** Lee los filtros de la URL. Nunca lanza: lo inválido vuelve a su valor por defecto. */
export function leerFiltros(
  parametros: ParametrosUrl,
  ahora: Date = new Date(),
): FiltrosDocumentos {
  const valor = (clave: string) => unico(parametros[clave])?.trim();
  const periodoPedido = valor('periodo');
  const periodo =
    periodoPedido === TODOS_LOS_PERIODOS
      ? TODOS_LOS_PERIODOS
      : (esquemaPeriodo.safeParse(periodoPedido).data ?? periodoActual(ahora));
  return {
    ambiente: esquemaAmbiente.safeParse(valor('ambiente')).data ?? null,
    empresa: esquemaUuid.safeParse(valor('empresa')).data ?? null,
    periodo,
    tipo: esquemaTipo.safeParse(valor('tipo')).data ?? null,
    estado: esquemaEstado.safeParse(valor('estado')).data ?? null,
    q: (valor('q') ?? '').replace(/\s+/g, ' ').slice(0, LARGO_MAXIMO_BUSQUEDA),
    pagina: esquemaPagina.safeParse(valor('pagina')).data ?? 1,
    doc: esquemaUuid.safeParse(valor('doc')).data ?? null,
  };
}

/**
 * Los filtros como parámetros de URL, sin los valores por defecto (página 1, búsqueda
 * vacía) ni el documento abierto, salvo que se pida. El período siempre va: así un enlace
 * copiado muestra lo mismo otro mes.
 */
export function parametrosDe(
  f: FiltrosDocumentos,
  cambios: Partial<FiltrosDocumentos> = {},
): URLSearchParams {
  const g = { ...f, ...cambios };
  const p = new URLSearchParams();
  if (g.empresa) p.set('empresa', g.empresa);
  if (g.ambiente) p.set('ambiente', g.ambiente);
  p.set('periodo', g.periodo);
  if (g.tipo) p.set('tipo', String(g.tipo));
  if (g.estado) p.set('estado', g.estado);
  if (g.q) p.set('q', g.q);
  if (g.pagina > 1) p.set('pagina', String(g.pagina));
  if (g.doc) p.set('doc', g.doc);
  return p;
}

/** URL de la lista con los filtros (y los cambios) aplicados. */
export function hrefDocumentos(
  slug: string,
  f: FiltrosDocumentos,
  cambios: Partial<FiltrosDocumentos> = {},
): string {
  const q = parametrosDe(f, cambios).toString();
  return `/${encodeURIComponent(slug)}/documentos${q ? `?${q}` : ''}`;
}

/**
 * Documentos «Por verificar» de una empresa y un ambiente, en todos los períodos. Lleva
 * empresa y ambiente explícitos: sin ellos `/documentos` usaría la empresa activa y el
 * ambiente de su último documento, que pueden no ser los del envío.
 */
export function hrefInciertos(slug: string, empresaId: string, ambiente: AmbienteSii): string {
  return hrefDocumentos(slug, {
    ambiente,
    empresa: empresaId,
    periodo: TODOS_LOS_PERIODOS,
    tipo: null,
    estado: 'incierto',
    q: '',
    pagina: 1,
    doc: null,
  });
}

/** Rango de `fecha_emision` del período: `[desde, hasta)` en `AAAA-MM-DD`, o `null` (todos). */
export function rangoPeriodo(periodo: string): { desde: string; hasta: string } | null {
  if (!esquemaPeriodo.safeParse(periodo).success) return null;
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(5, 7));
  const siguiente = mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, '0')}`;
  return { desde: `${periodo}-01`, hasta: `${siguiente}-01` };
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** «Noviembre 2026». */
export function nombrePeriodo(periodo: string): string {
  if (periodo === TODOS_LOS_PERIODOS) return 'Todos los períodos';
  if (!esquemaPeriodo.safeParse(periodo).success) return periodo;
  return `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;
}

/**
 * Opciones del selector de período: los últimos `MESES_SELECTOR` meses, el pedido si es
 * más antiguo (para que el selector lo muestre) y «Todos los períodos».
 */
export function opcionesPeriodo(
  actual: string,
  ahora: Date = new Date(),
): { valor: string; texto: string }[] {
  const hoy = periodoActual(ahora);
  let anio = Number(hoy.slice(0, 4));
  let mes = Number(hoy.slice(5, 7));
  const valores: string[] = [];
  for (let i = 0; i < MESES_SELECTOR; i++) {
    valores.push(`${anio}-${String(mes).padStart(2, '0')}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      anio -= 1;
    }
  }
  if (actual !== TODOS_LOS_PERIODOS && !valores.includes(actual)) valores.push(actual);
  return [
    ...valores.map((v) => ({ valor: v, texto: nombrePeriodo(v) })),
    { valor: TODOS_LOS_PERIODOS, texto: nombrePeriodo(TODOS_LOS_PERIODOS) },
  ];
}

/**
 * Expresión `or=(...)` de PostgREST para la búsqueda: razón social y RUT por `ilike`
 * (saneados con `patronBusqueda`, como el autocompletado de Emitir) y, si son solo
 * cifras (con puntos de miles o no), también el folio exacto. `null` sin búsqueda.
 */
export function expresionBusqueda(texto: string): string | null {
  const t = texto.trim();
  if (t === '') return null;
  const partes = [`receptor_razon_social.ilike.%${patronBusqueda(t)}%`];
  const rut = patronBusqueda(t.replace(/\./g, '').replace(/\s/g, '').toUpperCase());
  if (rut !== '') partes.push(`receptor_rut.ilike.%${rut}%`);
  if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(t)) {
    const folio = Number(t.replace(/\./g, ''));
    if (Number.isSafeInteger(folio) && folio > 0 && folio <= 2_147_483_647) {
      partes.push(`folio.eq.${folio}`);
    }
  }
  return partes.join(',');
}

/** La consulta de la lista, ya armada (la aplica `lectura.ts` sobre `documentos`). */
export interface ConsultaDocumentos {
  organizacionId: string;
  empresaId: string;
  ambiente: AmbienteSii;
  /** `fecha_emision >= desde` y `< hasta`; `null`: todos los períodos. */
  periodo: { desde: string; hasta: string } | null;
  tipo: 39 | 41 | null;
  estados: readonly EstadoDocumentoBd[];
  busqueda: string | null;
  /** `range(desde, hasta)` de PostgREST (inclusivo). */
  rango: [number, number];
}

export function armarConsulta(
  ctx: { organizacionId: string; empresaId: string; ambiente: AmbienteSii },
  f: Pick<FiltrosDocumentos, 'periodo' | 'tipo' | 'estado' | 'q' | 'pagina'>,
): ConsultaDocumentos {
  const desde = (Math.max(1, f.pagina) - 1) * POR_PAGINA;
  return {
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    ambiente: ctx.ambiente,
    periodo: rangoPeriodo(f.periodo),
    tipo: f.tipo,
    estados: f.estado ? [ESTADO_BD[f.estado]] : ESTADOS_LISTADOS,
    busqueda: expresionBusqueda(f.q),
    rango: [desde, desde + POR_PAGINA - 1],
  };
}

/** Última página válida para `total` filas. */
export function ultimaPagina(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / POR_PAGINA));
}

/** ¿Hay algún filtro además del período? (para el texto de «sin resultados»). */
export function hayFiltros(f: Pick<FiltrosDocumentos, 'tipo' | 'estado' | 'q'>): boolean {
  return Boolean(f.tipo || f.estado || f.q);
}
