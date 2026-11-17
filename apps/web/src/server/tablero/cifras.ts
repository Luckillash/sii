import { formatearMiles, formatearMonto, nombreTipoDte } from '@/lib/formatos';
import {
  leerFiltros,
  opcionesPeriodo,
  type ParametrosUrl,
  periodoActual,
  TODOS_LOS_PERIODOS,
} from '../documentos/filtros';
import type { AmbienteSii, EstadoDocumentoBd } from '../documentos/presentacion';
import type { ResumenTipo } from '../folios/tipos';

// Lógica pura del Tablero (PLAN-SAAS Fase 9): filtros de la URL, cifras del período a
// partir de las filas que trae `lectura.ts`, textos de detalle y alertas de folios. Sin
// red ni base, así que se prueba con Vitest.

// --- Filtros ---------------------------------------------------------------------------

export interface FiltrosTablero {
  /** `null`: la empresa activa (`?empresa` ausente). */
  empresa: string | null;
  /** `null`: el ambiente por defecto de la empresa (lo resuelve la página). */
  ambiente: AmbienteSii | null;
  /** Siempre un mes `AAAA-MM`: el Tablero resume un período tributario. */
  periodo: string;
}

/**
 * Empresa, ambiente y período desde la URL, con las mismas reglas que Documentos
 * (`leerFiltros`), salvo que «Todos los períodos» no existe aquí: si llega, vale el mes
 * actual. Nunca lanza.
 */
export function leerFiltrosTablero(parametros: ParametrosUrl, ahora = new Date()): FiltrosTablero {
  const f = leerFiltros(parametros, ahora);
  return {
    empresa: f.empresa,
    ambiente: f.ambiente,
    periodo: f.periodo === TODOS_LOS_PERIODOS ? periodoActual(ahora) : f.periodo,
  };
}

/** Las opciones del selector de período de Documentos, sin «Todos los períodos». */
export function opcionesPeriodoTablero(
  actual: string,
  ahora = new Date(),
): { valor: string; texto: string }[] {
  return opcionesPeriodo(actual, ahora).filter((o) => o.valor !== TODOS_LOS_PERIODOS);
}

// --- Ventas ----------------------------------------------------------------------------

/** Una fila de `v_ventas_diarias` o un documento del set (las columnas que se suman). */
export interface FilaMontos {
  mnt_neto: number | string | null;
  iva: number | string | null;
  mnt_exe: number | string | null;
  mnt_total: number | string | null;
  /** En la vista, cuántos documentos resume la fila; un documento suelto cuenta 1. */
  documentos?: number | string | null;
}

export interface Ventas {
  neto: number;
  iva: number;
  exento: number;
  total: number;
  /** Documentos aceptados (con o sin reparos) que suman. */
  documentos: number;
}

/** PostgREST puede devolver `numeric` como texto; `null` (vista sin filas) es 0. */
function numero(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumar(filas: readonly FilaMontos[]): Ventas {
  const v: Ventas = { neto: 0, iva: 0, exento: 0, total: 0, documentos: 0 };
  for (const f of filas) {
    v.neto += numero(f.mnt_neto);
    v.iva += numero(f.iva);
    v.exento += numero(f.mnt_exe);
    v.total += numero(f.mnt_total);
    v.documentos += f.documentos === undefined ? 1 : numero(f.documentos);
  }
  return v;
}

/**
 * Ventas del período: las filas diarias de `v_ventas_diarias` (aceptados y aceptados con
 * reparos) menos los documentos del set de pruebas aceptados en el mismo período. La
 * vista no distingue el origen y el set no son ventas: Documentos tampoco los lista, así
 * que sin restarlos el Tablero no cuadraría con «Ver todos» (solo pasa en certificación).
 */
export function calcularVentas(
  diarias: readonly FilaMontos[],
  delSet: readonly FilaMontos[] = [],
): Ventas {
  const a = sumar(diarias);
  const b = sumar(delSet.map((d) => ({ ...d, documentos: undefined })));
  return {
    neto: a.neto - b.neto,
    iva: a.iva - b.iva,
    exento: a.exento - b.exento,
    total: a.total - b.total,
    documentos: a.documentos - b.documentos,
  };
}

// --- Documentos por estado ---------------------------------------------------------------

/** Estados que cuenta el Tablero: todos menos `borrador` (los borradores viven en Emitir). */
export const ESTADOS_CONTADOS = [
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'enviado',
  'incierto',
  'firmado',
  'anulado',
] as const satisfies readonly EstadoDocumentoBd[];
export type EstadoContado = (typeof ESTADOS_CONTADOS)[number];
export type ConteoEstados = Record<EstadoContado, number>;

export function conteoVacio(): ConteoEstados {
  return {
    aceptado: 0,
    aceptado_con_reparos: 0,
    rechazado: 0,
    enviado: 0,
    incierto: 0,
    firmado: 0,
    anulado: 0,
  };
}

export interface CifrasDocumentos {
  /**
   * Todo lo emitido en el período menos los anulados (que no valen como documento). Por eso
   * no es el total de «Ver todos», que sí lista los anulados: la diferencia es `anulados`.
   */
  emitidos: number;
  /** Enviados con Track ID que el SII todavía no responde. */
  esperando: number;
  /** «2 aceptados · 0 con reparos · 0 rechazados», más los otros estados si hay. */
  detalle: string;
  /** «Sin contar 1 anulado», o `null` si no hay. */
  anulados: string | null;
}

function cantidad(n: number, singular: string, plural: string): string {
  return `${formatearMiles(n)} ${n === 1 ? singular : plural}`;
}

export function cifrasDocumentos(c: ConteoEstados): CifrasDocumentos {
  const emitidos = ESTADOS_CONTADOS.filter((e) => e !== 'anulado').reduce((s, e) => s + c[e], 0);
  const partes = [
    cantidad(c.aceptado, 'aceptado', 'aceptados'),
    `${formatearMiles(c.aceptado_con_reparos)} con reparos`,
    cantidad(c.rechazado, 'rechazado', 'rechazados'),
  ];
  if (c.enviado > 0) partes.push(cantidad(c.enviado, 'enviado', 'enviados'));
  if (c.incierto > 0) partes.push(`${formatearMiles(c.incierto)} por verificar`);
  if (c.firmado > 0) partes.push(cantidad(c.firmado, 'firmado', 'firmados'));
  return {
    emitidos,
    esperando: c.enviado,
    detalle: partes.join(' · '),
    anulados: c.anulado > 0 ? `Sin contar ${cantidad(c.anulado, 'anulado', 'anulados')}` : null,
  };
}

/** Texto bajo las ventas netas: cuántas boletas aceptadas suman. */
export function detalleVentas(v: Pick<Ventas, 'documentos'>): string {
  return v.documentos === 0
    ? 'Aún no hay boletas aceptadas en el período'
    : `${cantidad(v.documentos, 'boleta aceptada', 'boletas aceptadas')} por el SII`;
}

/** Segunda línea si hubo ventas exentas (boleta 41 o líneas exentas): no van en el neto. */
export function detalleExento(v: Pick<Ventas, 'exento'>): string | null {
  return v.exento > 0 ? `Más ${formatearMonto(v.exento)} exentos` : null;
}

// --- Medidor de folios ---------------------------------------------------------------------

export interface MedidorTablero {
  desde: number;
  hasta: number;
  siguiente: number;
  /** Suma más de un CAF activo (la página muestra una nota que lo dice). */
  varios: boolean;
}

/**
 * Props del `MedidorFolios` de un tipo, con los MISMOS números que la alerta de folios
 * (`estadoDisponibilidad`: disponibles sobre el total de los CAF activos con folios libres).
 * Pasarle solo el rango del CAF en uso los contradecía con dos CAF: A 1–100 con el
 * siguiente en 98 y B 101–1.100 sin usar daban «3 de 100 disponibles» en tono de aviso, sin
 * alerta, cuando quedan 1.003.
 *
 * Con un solo CAF es exactamente su rango. Con varios, el rango se arma desde el primer
 * folio del CAF en uso y con el largo del total: es exacto si los CAF son consecutivos (lo
 * normal, el SII timbra rangos seguidos) y una aproximación si no, por eso `varios`.
 * `null` si no hay CAF en uso (la página muestra «agotado» o «sin folios»).
 */
export function medidorFoliosTablero(r: ResumenTipo): MedidorTablero | null {
  if (!r.enUso || r.total <= 0) return null;
  const libresEnUso = r.enUso.hasta - r.enUso.siguiente + 1;
  const tamanoEnUso = r.enUso.hasta - r.enUso.desde + 1;
  if (r.total === tamanoEnUso && r.disponibles === libresEnUso) {
    return {
      desde: r.enUso.desde,
      hasta: r.enUso.hasta,
      siguiente: r.enUso.siguiente,
      varios: false,
    };
  }
  const usados = Math.min(r.total, Math.max(0, r.total - r.disponibles));
  return {
    desde: r.enUso.desde,
    hasta: r.enUso.desde + r.total - 1,
    siguiente: r.enUso.desde + usados,
    varios: true,
  };
}

// --- Alertas de folios ---------------------------------------------------------------------

export interface AlertaFolios {
  tono: 'aviso' | 'error';
  titulo: string;
  detalle: string;
}

/** «boleta», «boleta exenta»: en minúscula porque va dentro de la frase. */
function nombreEnFrase(tipo: number): string {
  return nombreTipoDte(tipo, true).toLowerCase();
}

function listaTipos(tipos: readonly number[]): string {
  const nombres = tipos.map(nombreEnFrase);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;
}

/**
 * Avisos de folios del ambiente elegido, con la regla del 15 % de `estadoDisponibilidad`
 * (la misma de la página de Folios y del correo `folios.por_agotarse`): uno `error` para
 * los tipos con CAF agotado y uno `aviso` para los que están por agotarse. Un tipo que
 * nunca tuvo CAF no avisa: es lo normal para quien no emite ese tipo.
 */
export function alertasFolios(
  resumen: readonly ResumenTipo[],
  ambiente: AmbienteSii,
): AlertaFolios[] {
  const delAmbiente = resumen.filter((r) => r.ambiente === ambiente);
  const agotados = delAmbiente.filter((r) => r.estado === 'error' && r.tuvoCaf);
  const porAgotarse = delAmbiente.filter((r) => r.estado === 'aviso');
  const alertas: AlertaFolios[] = [];
  if (agotados.length > 0) {
    const tipos = agotados.map((r) => r.tipoDte);
    alertas.push({
      tono: 'error',
      titulo: `Se acabaron los folios de ${listaTipos(tipos)}`,
      detalle:
        'No puedes emitir documentos de ese tipo hasta que pidas o subas un CAF nuevo en Folios.',
    });
  }
  if (porAgotarse.length > 0) {
    const tipos = porAgotarse.map((r) => r.tipoDte);
    const quedan = porAgotarse
      .map((r) => `${cantidad(r.disponibles, 'folio', 'folios')} de ${nombreEnFrase(r.tipoDte)}`)
      .join(' y ');
    const verbo =
      porAgotarse.length === 1 && porAgotarse[0]?.disponibles === 1 ? 'Queda' : 'Quedan';
    alertas.push({
      tono: 'aviso',
      titulo: `Quedan pocos folios de ${listaTipos(tipos)}`,
      detalle: `${verbo} ${quedan}. Pide un CAF nuevo antes de que se acaben para no interrumpir la emisión.`,
    });
  }
  return alertas;
}
