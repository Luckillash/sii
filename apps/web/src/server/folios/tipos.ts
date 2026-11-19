import type { EstadoFolios } from '@/components/boleteame/folios';
import type { ResultadoOperacion } from '@/lib/certificacion';
import type { AmbienteSii, EstadoCaf, EstadoSolicitudFolios, TipoFolio } from '@/lib/folios';

// Tipos públicos de la capa de folios (contrato de la Fase 6 con la UI). Solo tipos: los
// importa `index.ts` y, con `import type`, la página y sus componentes cliente.

/** Contexto ya autorizado por el Server Action (membresía y rol verificados). */
export interface ContextoFolios {
  organizacionId: string;
  empresaId: string;
  usuarioId: string;
}

/**
 * Contexto de la API pública (Fase 11, `POST /folios/solicitudes`): sin usuario, con la
 * API key ya autenticada con el alcance `folios:solicitar`. Solo para `solicitarFolios`.
 */
export interface ContextoFoliosApi {
  organizacionId: string;
  empresaId: string;
  usuarioId: null;
  apiKeyId: string;
}

/** Empresa, ambiente y tipo: la llave de la disponibilidad y de la alerta. */
export interface ClaveFolios {
  organizacionId: string;
  empresaId: string;
  ambiente: AmbienteSii;
  tipoDte: number;
}

/** Folios de un tipo en un ambiente (una tarjeta del resumen). */
export interface ResumenTipo {
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  /** El CAF que usa `asignar_folio` (activo con folios libres, `desde` más bajo). */
  enUso: { id: string; desde: number; hasta: number; siguiente: number } | null;
  /** Folios libres sumando todos los CAF activos (`v_folios_disponibles`). */
  disponibles: number;
  /** Denominador del umbral (tamaño de los CAF activos con folios libres). */
  total: number;
  /** `sello` / `aviso` (≤ 15 %) / `error` (agotado o sin CAF). */
  estado: EstadoFolios;
  /** Hubo CAF alguna vez (para distinguir «agotado» de «sin folios todavía»). */
  tuvoCaf: boolean;
  /** Se puede emitir este tipo en este ambiente (la Fase 7 deshabilita el botón si no). */
  puedeEmitir: boolean;
}

export interface FilaCaf {
  id: string;
  ambiente: AmbienteSii;
  tipoDte: number;
  desde: number;
  hasta: number;
  siguiente: number;
  fechaAutorizacion: string;
  estado: EstadoCaf;
  creadoEn: string;
  /** Folios anulados de este CAF (`folios_anulados`). */
  anulados: number;
  /** Lo trajo una solicitud de Boletéame (o se subió a mano). */
  deSolicitud: boolean;
}

export interface FilaSolicitud {
  id: string;
  ambiente: AmbienteSii;
  tipoDte: number;
  cantidad: number;
  folioInicial: number | null;
  confirmada: boolean;
  estado: EstadoSolicitudFolios;
  desde: number | null;
  hasta: number | null;
  mensaje: string | null;
  /** Nombre o correo de quien la pidió (`null` si ya no está). */
  solicitadoPor: string | null;
  creadoEn: string;
  terminadoEn: string | null;
}

export interface OperacionFolios {
  id: string;
  ambiente: AmbienteSii;
  resultado: ResultadoOperacion;
  confirmada: boolean;
  mensaje: string | null;
  iniciadaEn: string;
  revisada: boolean;
  solicitudId: string | null;
  /**
   * Incierta porque el CAF timbrado choca con uno ya cargado (no sirve subirlo): el rango
   * del cargado si se pudo leer (`{}` si no); `null` si no es un traslape.
   */
  traslape: { desde?: number; hasta?: number } | null;
}

/** Estado completo de `/[org]/folios` para una empresa. */
export interface VistaFolios {
  empresa: {
    id: string;
    rut: string;
    razonSocial: string;
    activa: boolean;
    autorizadaProduccion: boolean;
  };
  /** El plan vigente permite producción (`null` si no se pudo leer: decide el servidor). */
  planPermiteProduccion: boolean | null;
  /** Certificado de un representante electrónico vigente (lo exige el SII para pedir folios). */
  representante: { titular: string; rut: string; vigenteHasta: string } | null;
  /** Los cuatro: 39 y 41 en producción y en certificación. */
  resumen: ResumenTipo[];
  cafs: FilaCaf[];
  solicitudes: FilaSolicitud[];
  /** Últimas operaciones `solicitar_folios` confirmadas de la empresa (los dos ambientes). */
  operaciones: OperacionFolios[];
}
