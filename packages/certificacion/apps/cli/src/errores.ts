// Códigos de salida y errores propios de la CLI (PLAN-MIGRACION.md fase 7, pend. 5).
//
// Los códigos son estables: los scripts que llaman a la CLI pueden decidir con ellos
// si reintentar (4), revisar el SII antes de repetir (6) o corregir la config (3).

import {
  DeclaracionInciertaError,
  ErrorCertificado,
  ErrorPostulacion,
  ErrorRespuestaSii,
  ErrorSolicitudFolios,
  ErrorTransporte,
  FoliosSinCafError,
  SiiError,
} from '@winex/certificacion';

export const CODIGOS = Object.freeze({
  /** Terminó bien. */
  OK: 0,
  /** Error no clasificado: datos que no cumplen las reglas del SII, firma, timbre, un bug. */
  ERROR: 1,
  /** Uso incorrecto: comando desconocido, opción inválida o faltante. Nada salió al SII. */
  USO: 2,
  /** Configuración inválida: `.env`, certificado ilegible, archivo que no existe. Nada salió al SII. */
  CONFIG: 3,
  /** Falla de red o HTTP inesperado. Se puede reintentar. */
  TRANSPORTE: 4,
  /** El SII respondió pero rechazó la operación o devolvió algo que no se entiende. */
  SII: 5,
  /**
   * La operación llegó al SII pero no se sabe si quedó hecha (declaración, folios
   * timbrados sin CAF). **No reintentar a ciegas:** revisar el estado en el SII.
   */
  INCIERTO: 6,
  /** Una verificación local no pasó (p. ej. un TED que no calza con el CAF). */
  VERIFICACION: 7,
});

export type CodigoSalida = (typeof CODIGOS)[keyof typeof CODIGOS];

/** Uso incorrecto de la CLI (código 2). El mensaje se muestra junto al uso del comando. */
export class ErrorUso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorUso';
  }
}

/**
 * Configuración inválida (código 3): variables del `.env` faltantes o mal formadas,
 * archivos que no existen. El mensaje nunca incluye valores (pueden ser secretos):
 * solo los nombres de las variables o las rutas.
 */
export class ErrorConfig extends Error {
  constructor(mensaje: string, opciones?: ErrorOptions) {
    super(mensaje, opciones);
    this.name = 'ErrorConfig';
  }
}

/** Código de salida que corresponde a un error. */
export function codigoDeError(error: unknown): CodigoSalida {
  if (error instanceof ErrorUso) return CODIGOS.USO;
  if (error instanceof ErrorConfig || error instanceof ErrorCertificado) return CODIGOS.CONFIG;
  if (error instanceof DeclaracionInciertaError || error instanceof FoliosSinCafError) {
    return CODIGOS.INCIERTO;
  }
  if (error instanceof ErrorTransporte) return CODIGOS.TRANSPORTE;
  if (
    error instanceof ErrorRespuestaSii ||
    error instanceof ErrorPostulacion ||
    error instanceof ErrorSolicitudFolios
  ) {
    return CODIGOS.SII;
  }
  return CODIGOS.ERROR;
}

/**
 * Texto de un error para mostrar al usuario. Los errores de la librería ya traen un
 * mensaje seguro (sin PEM, claves, tokens ni cookies). De los demás se muestra solo
 * el mensaje; `cause` nunca se imprime porque puede nombrar rutas o datos sensibles.
 */
export function describirError(error: unknown): string {
  if (error instanceof SiiError || error instanceof ErrorUso || error instanceof ErrorConfig) {
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
