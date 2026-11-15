import { z } from 'zod';
import {
  calcularFolios,
  type EstadoFolios,
  UMBRAL_AVISO_FOLIOS,
} from '@/components/boleteame/folios';
import type { ResultadoPaso, ResumenEnsayo } from '@/lib/certificacion';
import { formatearMiles, nombreTipoDte } from '@/lib/formatos';
import type { Database } from '@/server/supabase/tipos';

// Contrato compartido de la Fase 6 (PLAN-SAAS §7, «Folios (CAF)»): tipos permitidos,
// ambientes, la forma de lo que devuelven las acciones de `/[org]/folios`, la regla del
// umbral de folios y la validación de los formularios. Puro (sin `server-only` ni React):
// lo importan los componentes cliente, las Server Actions y la capa `server/folios/`.
//
// `Database`, `ResultadoPaso` y `ResumenEnsayo` llegan con `import type`.

export type AmbienteSii = Database['public']['Enums']['ambiente_sii'];
export type EstadoSolicitudFolios = Database['public']['Enums']['estado_solicitud_folios'];
export type EstadoCaf = Database['public']['Enums']['estado_caf'];

/** Boleta electrónica (39) y boleta exenta electrónica (41): lo único que emite el MVP (H1). */
export const TIPOS_FOLIO = [39, 41] as const;
export type TipoFolio = (typeof TIPOS_FOLIO)[number];

export const AMBIENTES_FOLIO = [
  'produccion',
  'certificacion',
] as const satisfies readonly AmbienteSii[];

export function esTipoFolio(valor: unknown): valor is TipoFolio {
  return typeof valor === 'number' && (TIPOS_FOLIO as readonly number[]).includes(valor);
}

export function esAmbiente(valor: unknown): valor is AmbienteSii {
  return valor === 'certificacion' || valor === 'produccion';
}

/** Tope de una solicitud (el SII acepta más, pero un CAF de 10.000 folios ya es mucho). */
export const CANTIDAD_MAXIMA = 10_000;

/** Un CAF del SII pesa 2–4 KB; 64 KB es holgado y frena archivos equivocados. */
export const TAMANO_MAXIMO_CAF = 64 * 1024;

/** Una revisión con el SII sirve para timbrar durante este tiempo (el SII puede reasignar). */
export const MINUTOS_REVISION_VIGENTE = 30;

/** IDK de cada ambiente (mismo candado que `SolicitudFolios` y el check de `cafs`). */
export const IDK_DEL_AMBIENTE: Readonly<Record<AmbienteSii, number>> = {
  certificacion: 100,
  produccion: 300,
};

export const ETIQUETA_AMBIENTE: Readonly<Record<AmbienteSii, string>> = {
  certificacion: 'Certificación',
  produccion: 'Producción',
};

/** «en certificación» / «en producción», para frases. */
export function enAmbiente(ambiente: AmbienteSii): string {
  return ambiente === 'produccion' ? 'en producción' : 'en certificación';
}

/** «Boleta electrónica (39)». */
export function nombreTipoFolio(tipo: number): string {
  return `${nombreTipoDte(tipo)} (${tipo})`;
}

export const ETIQUETA_ESTADO_SOLICITUD: Readonly<Record<EstadoSolicitudFolios, string>> = {
  en_curso: 'En curso',
  simulada: 'Revisada con el SII',
  timbrada: 'Timbrada',
  incierta: 'Por verificar',
  rechazada: 'Rechazada',
  error: 'Con error',
};

export const ETIQUETA_ESTADO_CAF: Readonly<Record<EstadoCaf, string>> = {
  activo: 'Activo',
  agotado: 'Agotado',
  anulado: 'Anulado',
};

/** «del 11 al 15» con separador de miles. */
export function textoRango(desde: number, hasta: number): string {
  return desde === hasta
    ? `${formatearMiles(desde)}`
    : `${formatearMiles(desde)} a ${formatearMiles(hasta)}`;
}

// --- Disponibilidad y umbral -------------------------------------------------------------

/** Un CAF reducido a lo que decide la disponibilidad. */
export interface CafRango {
  id: string;
  desde: number;
  hasta: number;
  siguiente: number;
  estado: EstadoCaf;
}

/**
 * Folios disponibles de una empresa para un ambiente y un tipo.
 *
 * REGLA DEL UMBRAL (la misma de `calcularFolios` / `MedidorFolios`, 15 %): se mira el
 * conjunto de CAF que `asignar_folio` todavía puede usar, es decir, los `activo` con
 * folios libres (`siguiente <= hasta`):
 *
 *   restante = Σ (hasta − siguiente + 1)      ← lo que muestra `v_folios_disponibles`
 *   total    = Σ (hasta − desde + 1)          ← el DENOMINADOR: el tamaño de esos CAF
 *
 * y el estado es el de `calcularFolios` con esos dos números (`error` si no queda
 * ninguno; `aviso` si restante / total ≤ 15 %). Con un solo CAF es exactamente lo que
 * muestra su `MedidorFolios`. Cuando un CAF se agota sale del conjunto, lo que solo puede
 * subir la proporción (nunca provoca un cruce falso); un CAF nuevo la sube y, si después
 * vuelve a bajar del 15 %, es un cruce nuevo (con otro CAF en uso).
 */
export interface Disponibilidad {
  restante: number;
  total: number;
  /** El CAF que usará `asignar_folio`: el activo con folios libres de `desde` más bajo. */
  cafEnUso: string | null;
}

export function disponibilidadDe(cafs: readonly CafRango[]): Disponibilidad {
  const libres = cafs
    .filter((c) => c.estado === 'activo' && c.siguiente <= c.hasta)
    .sort((a, b) => a.desde - b.desde);
  return {
    restante: libres.reduce((s, c) => s + (c.hasta - c.siguiente + 1), 0),
    total: libres.reduce((s, c) => s + (c.hasta - c.desde + 1), 0),
    cafEnUso: libres[0]?.id ?? null,
  };
}

/** `sello` / `aviso` / `error` con la regla de `calcularFolios`; `error` también sin CAF. */
export function estadoDisponibilidad(d: Pick<Disponibilidad, 'restante' | 'total'>): EstadoFolios {
  if (d.total <= 0 || d.restante <= 0) return 'error';
  return calcularFolios({
    desde: 1,
    hasta: d.total,
    siguiente: d.total - d.restante + 1,
    umbralAviso: UMBRAL_AVISO_FOLIOS,
  }).estado;
}

export type DecisionAlerta = 'por_agotarse' | 'agotado';

/**
 * ¿Se CRUZÓ el umbral entre `antes` y `despues`? `por_agotarse` al pasar de `sello` a
 * `aviso`; `agotado` al llegar a cero desde cualquier estado con folios. Sin CAF antes no
 * hay alerta (no había nada que agotar). Pura: la usa `server/folios/alertas.ts`.
 */
export function decidirAlerta(
  antes: Pick<Disponibilidad, 'restante' | 'total'>,
  despues: Pick<Disponibilidad, 'restante' | 'total'>,
): DecisionAlerta | null {
  if (antes.total <= 0 || antes.restante <= 0) return null;
  const e0 = estadoDisponibilidad(antes);
  const e1 = estadoDisponibilidad(despues);
  if (e1 === 'error' && e0 !== 'error') return 'agotado';
  if (e1 === 'aviso' && e0 === 'sello') return 'por_agotarse';
  return null;
}

// --- Anulación ------------------------------------------------------------------------------

export const LARGO_MAXIMO_MOTIVO = 500;

/**
 * Reglas de `anular_folios` (migración 0011), para avisar antes de llamar a la base:
 *   a. todo el rango bajo `siguiente` (folios asignados que no se usaron), o
 *   b. la cola completa: `desde <= siguiente` y `hasta = folio_hasta` (deja el CAF anulado).
 * Devuelve qué corregir, o `null` si el rango sirve. La autoridad es la RPC.
 */
export function validarRangoAnulacion(
  caf: Pick<CafRango, 'desde' | 'hasta' | 'siguiente' | 'estado'>,
  desde: number,
  hasta: number,
): string | null {
  if (!Number.isSafeInteger(desde) || !Number.isSafeInteger(hasta)) {
    return 'Escribe el primer y el último folio como números enteros.';
  }
  if (desde > hasta) return 'El primer folio no puede ser mayor que el último.';
  if (desde < caf.desde || hasta > caf.hasta) {
    return `El rango tiene que estar dentro del CAF (folios ${textoRango(caf.desde, caf.hasta)}).`;
  }
  if (hasta >= caf.siguiente) {
    if (caf.siguiente > caf.hasta) {
      return 'Ese CAF ya no tiene folios sin asignar: solo puedes anular folios asignados que no se usaron.';
    }
    if (hasta !== caf.hasta || desde > caf.siguiente) {
      return `Los folios que aún no se asignan se anulan todos juntos: desde el ${formatearMiles(caf.siguiente)} hasta el último del CAF (${formatearMiles(caf.hasta)}).`;
    }
  }
  return null;
}

/** El CAF tiene folios sin asignar que se pueden anular de una vez («los que quedan»). */
export function tieneCola(caf: Pick<CafRango, 'hasta' | 'siguiente' | 'estado'>): boolean {
  return caf.estado === 'activo' && caf.siguiente <= caf.hasta;
}

// --- Resultado de las acciones ------------------------------------------------------------

export type NivelSolicitud = 'ensayo' | 'revision' | 'timbrar';

/**
 * Ensayo local de una solicitud de folios (sin red ni filas): lo que el `Dialogo` muestra
 * antes de revisar con el SII o timbrar.
 */
export interface ResumenSolicitud extends Omit<ResumenEnsayo, 'ambiente' | 'operacion'> {
  operacion: 'solicitar_folios';
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  cantidad: number;
  folioInicial: number | null;
  /** En producción hay que revisar con el SII antes de timbrar (paridad con la CLI). */
  revisionObligatoria: boolean;
}

/** Lo que dejó una revisión con el SII (solicitud `simulada`): sirve para timbrar después. */
export interface RevisionFolios {
  /** id de la fila `simulada` de `solicitudes_folios`. */
  revisionId: string;
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  cantidad: number;
  folioInicial: number | null;
  desde: number;
  hasta: number;
}

type Ok = Extract<ResultadoPaso, { tipo: 'ok' }>;
type Fallo = Extract<ResultadoPaso, { tipo: 'error' }>;

export type ResultadoFolios =
  | { tipo: 'ensayo'; resumen: ResumenSolicitud }
  | {
      tipo: 'revision';
      mensaje: { titulo: string; detalle: string };
      revision: RevisionFolios;
      operacionId: string;
    }
  | Ok
  | Fallo;

/** ¿Esta revisión sirve para timbrar lo que muestra el ensayo? (mismo tipo, ambiente, cantidad). */
export function revisionCalza(
  revision: RevisionFolios | null,
  resumen: Pick<ResumenSolicitud, 'ambiente' | 'tipoDte' | 'cantidad' | 'folioInicial'> | null,
): boolean {
  return (
    revision !== null &&
    resumen !== null &&
    revision.ambiente === resumen.ambiente &&
    revision.tipoDte === resumen.tipoDte &&
    revision.cantidad === resumen.cantidad &&
    revision.folioInicial === resumen.folioInicial
  );
}

// --- Formularios (zod) ----------------------------------------------------------------------

const UUID = z.uuid();

const esquemaTipo = z.union([z.literal(39), z.literal(41)], {
  error: 'Elige boleta electrónica (39) o boleta exenta electrónica (41).',
});

const esquemaAmbiente = z.enum(['certificacion', 'produccion'], {
  error: 'Elige el ambiente: certificación o producción.',
});

export const esquemaCantidad = z
  .number({ error: 'Escribe cuántos folios quieres pedir.' })
  .int('La cantidad es un número entero.')
  .min(1, 'Pide al menos 1 folio.')
  .max(
    CANTIDAD_MAXIMA,
    `Pide como máximo ${formatearMiles(CANTIDAD_MAXIMA)} folios por solicitud.`,
  );

export const esquemaFolioInicial = z
  .number()
  .int('El folio inicial es un número entero.')
  .positive('El folio inicial es mayor que cero.')
  .max(999_999_999, 'Revisa el folio inicial.');

export const esquemaSolicitud = z.object({
  nivel: z.enum(['ensayo', 'revision', 'timbrar']),
  tipoDte: esquemaTipo,
  ambiente: esquemaAmbiente,
  cantidad: esquemaCantidad,
  folioInicial: esquemaFolioInicial.optional(),
  revisionId: UUID.optional(),
});

export type EntradaSolicitud = z.infer<typeof esquemaSolicitud>;

export const esquemaAnulacion = z.object({
  cafId: UUID,
  desde: z
    .number({ error: 'Escribe el primer folio.' })
    .int('El primer folio es un número entero.')
    .positive('El primer folio es mayor que cero.'),
  hasta: z
    .number({ error: 'Escribe el último folio.' })
    .int('El último folio es un número entero.')
    .positive('El último folio es mayor que cero.'),
  motivo: z
    .string()
    .trim()
    .min(1, 'Escribe por qué anulas estos folios.')
    .max(LARGO_MAXIMO_MOTIVO, `El motivo puede tener hasta ${LARGO_MAXIMO_MOTIVO} caracteres.`),
});

export type EntradaAnulacion = z.infer<typeof esquemaAnulacion>;

export const esquemaAmbienteCaf = esquemaAmbiente;

/** Errores de zod por campo (el primero de cada uno). */
export function erroresPorCampo(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? 'formulario');
    errores[campo] ??= issue.message;
  }
  return errores;
}

/** Texto de un campo numérico de formulario: entero o `undefined` si está vacío. */
export function enteroDeTexto(valor: string): number | undefined {
  const limpio = valor.replace(/\./g, '').trim();
  if (limpio === '') return undefined;
  return /^\d+$/.test(limpio) ? Number(limpio) : Number.NaN;
}
