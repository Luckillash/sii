import type { EtapaCertificacion, OperacionSii, ResultadoOperacion } from '@/lib/certificacion';

// Tipos públicos de la capa de certificación (contrato de la Fase 5 con la UI). Solo
// tipos: los importa `index.ts` y, con `import type`, la página.

/** Contexto ya autorizado por el Server Action (membresía y rol verificados). */
export interface ContextoCertificacion {
  organizacionId: string;
  empresaId: string;
  usuarioId: string;
}

/** Datos del formulario de postulación (van a maullin: solo ASCII imprimible). */
export interface DatosPostulacionForm {
  rutAdministrador: string;
  correoAdministrador: string;
  correoContactoSii: string;
  correoIntercambio: string;
  nombreSoftware: string;
  boletaExenta: boolean;
  url?: string;
}

/** Datos del formulario de la declaración de cumplimiento (van por GWT-RPC, UTF-8). */
export interface DatosDeclaracionForm {
  linkConsulta: string;
  rutProveedor: string;
  nombreProveedor: string;
  correoProveedor: string;
}

/** Columnas de `procesos_certificacion` en camelCase. */
export interface FilaProceso {
  id: string;
  etapa: EtapaCertificacion;
  rutAdministrador: string | null;
  correoAdministrador: string | null;
  correoContactoSii: string | null;
  correoIntercambio: string | null;
  nombreSoftware: string | null;
  boletaExenta: boolean;
  url: string | null;
  postuladaEn: string | null;
  avisosPostulacion: string[];
  correoProveedorSet: string | null;
  setDescargadoEn: string | null;
  envioSetId: string | null;
  revisionSolicitadaEn: string | null;
  linkConsulta: string | null;
  rutProveedor: string | null;
  nombreProveedor: string | null;
  correoProveedor: string | null;
  declaradaEn: string | null;
  codigoEstadoSii: string | null;
  glosaEstadoSii: string | null;
  pasoSii: number | null;
  estadoConsultadoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface DetalleCaso {
  nombre: string;
  cantidad: number;
  precio: number;
  exento?: boolean;
  unidad?: string;
}

export interface CasoSet {
  numero: number;
  tipoDte: number;
  referenciaRazon: string;
  detalles: DetalleCaso[];
  documentoId: string | null;
}

export interface EnvioSet {
  id: string;
  trackId: string | null;
  /** `clasificacion` del envío (pendiente, incierto, en_proceso, aceptado...). */
  estado: string;
  /** Estado tal como lo dio el SII (REC, EPR, RCH...), o null. */
  estadoSii: string | null;
  incierto: boolean;
  enviadoEn: string | null;
  ultimaConsultaEn: string | null;
  aceptados: number | null;
  rechazados: number | null;
  reparos: number | null;
  rechazos: { folio: number | null; codigo: string | null; descripcion: string }[];
}

export interface CafSet {
  id: string;
  folioDesde: number;
  folioHasta: number;
  siguienteFolio: number;
  /**
   * Folios libres de boleta (39) en certificación, sumando todos los CAF activos (lo que
   * puede usar `asignar_folio`). El rango es el del CAF que se usa primero.
   */
  disponibles: number;
}

export interface OperacionAsistente {
  id: string;
  operacion: OperacionSii;
  resultado: ResultadoOperacion;
  confirmada: boolean;
  mensaje: string | null;
  iniciadaEn: string;
  terminadaEn: string | null;
  revisada: boolean;
}

/** Estado completo del asistente para una empresa. */
export interface VistaAsistente {
  empresa: {
    id: string;
    rut: string;
    razonSocial: string;
    activa: boolean;
    autorizadaProduccion: boolean;
  };
  /** null = aún no existe (se crea al guardar la postulación). */
  proceso: FilaProceso | null;
  casos: CasoSet[];
  envioSet: EnvioSet | null;
  /** CAF 39 de certificación activo (el próximo que usa `asignar_folio`). */
  cafSet: CafSet | null;
  resolucionCertificacion: { numero: number; fecha: string } | null;
  /** Certificado predeterminado de la empresa. */
  certificado: {
    id: string;
    titular: string;
    rut: string;
    vigenteHasta: string;
    representante: boolean;
  } | null;
  /** Últimas ~20 operaciones de la empresa en certificación, de la más reciente. */
  operaciones: OperacionAsistente[];
}
