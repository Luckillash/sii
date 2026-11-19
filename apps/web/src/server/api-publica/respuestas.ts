import 'server-only';
import {
  CABECERA_REPETIDA,
  CODIGOS_ERROR,
  type CodigoError,
  type CuerpoError,
  type DocumentoApi,
  MENSAJES_ERROR,
} from '@/lib/api-publica';

// Respuestas de `/api/v1` (PLAN-SAAS Fase 11, §2.1 del diseño): JSON, `Cache-Control:
// no-store` siempre (son datos tributarios de una organización) y errores con la forma
// `{ error: { codigo, mensaje, campos?, documento?, operacion_pendiente_id? } }` del
// contrato (`@/lib/api-publica`). Sin CORS: es una API de servidor a servidor.

export const CABECERAS_BASE: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
});

export interface OpcionesError {
  /** Reemplaza el mensaje del contrato (cuando la capa de abajo dio uno más preciso). */
  mensaje?: string;
  campos?: Record<string, string>;
  documento?: DocumentoApi;
  operacionPendienteId?: string;
  cabeceras?: Record<string, string>;
  /**
   * Solo para Sentry (etiquetas de un `error_interno`): nunca sale al cliente. Valores
   * fijos (motivo y resultado de la capa de abajo), sin datos de la petición.
   */
  diagnostico?: Record<string, string>;
}

/**
 * Error de la API que se lanza desde cualquier paso de una ruta y `manejarApi` traduce a
 * su respuesta. Nunca lleva datos de la base ni secretos: solo el código y textos fijos.
 */
export class ErrorApi extends Error {
  override name = 'ErrorApi';
  readonly codigo: CodigoError;
  readonly opciones: OpcionesError;
  constructor(codigo: CodigoError, opciones: OpcionesError = {}) {
    super(opciones.mensaje ?? MENSAJES_ERROR[codigo]);
    this.codigo = codigo;
    this.opciones = opciones;
  }
}

export function esErrorApi(error: unknown): error is ErrorApi {
  return error instanceof ErrorApi;
}

/** El cuerpo de un error (también lo guarda la idempotencia y lo devuelve el lote). */
export function cuerpoError(codigo: CodigoError, opciones: OpcionesError = {}): CuerpoError {
  return {
    error: {
      codigo,
      mensaje: opciones.mensaje ?? MENSAJES_ERROR[codigo],
      ...(opciones.campos && Object.keys(opciones.campos).length > 0
        ? { campos: opciones.campos }
        : {}),
      ...(opciones.documento ? { documento: opciones.documento } : {}),
      ...(opciones.operacionPendienteId
        ? { operacion_pendiente_id: opciones.operacionPendienteId }
        : {}),
    },
  };
}

export function respuestaJson(
  cuerpo: unknown,
  status = 200,
  cabeceras: Record<string, string> = {},
): Response {
  return Response.json(cuerpo, { status, headers: { ...CABECERAS_BASE, ...cabeceras } });
}

export function respuestaError(codigo: CodigoError, opciones: OpcionesError = {}): Response {
  return respuestaJson(cuerpoError(codigo, opciones), CODIGOS_ERROR[codigo], {
    ...(codigo === 'no_autenticado' || codigo.startsWith('clave_')
      ? { 'WWW-Authenticate': 'Bearer realm="boleteame"' }
      : {}),
    ...opciones.cabeceras,
  });
}

/** La respuesta guardada de una petición repetida con la misma `Idempotency-Key`. */
export function respuestaRepetida(
  cuerpo: unknown,
  status: number,
  cabeceras: Record<string, string> = {},
): Response {
  return respuestaJson(cuerpo, status, { ...cabeceras, [CABECERA_REPETIDA]: 'true' });
}
