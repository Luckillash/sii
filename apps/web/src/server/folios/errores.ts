import 'server-only';
import type { ResultadoFolios } from '@/lib/folios';
import { formatearMiles } from '@/lib/formatos';
import { type MensajeError, mensajeParaUsuario, resultadoDeError } from '../sii/errores';

// Errores de la capa de folios (PLAN-SAAS Fase 6) y su traducción a mensajes del design
// system (qué pasó y qué hacer).
//
// `ErrorFolios` lo reconoce `sii/errores.ts` por nombre (`POR_NOMBRE`): dentro de
// `ejecutarOperacion` queda con su `resultado` (`uso` o `config`, nada salió al SII) y
// su `mensajeUsuario`. Fuera (validación previa, carga manual, anulación) se traduce aquí.
// Ningún mensaje lleva el XML del CAF, la `<RSASK>` ni datos de una fila de la base:
// solo nombres de campos, rangos y RUT públicos del CAF.

export type MotivoFolios =
  | 'tipo_no_permitido'
  | 'sin_autorizacion'
  | 'plan_sin_produccion'
  | 'revision_requerida'
  | 'revision_usada'
  | 'empresa_desactivada'
  | 'empresa_no_encontrada'
  | 'archivo_vacio'
  | 'archivo_grande'
  | 'no_es_caf'
  | 'sin_rsask'
  | 'llave_invalida'
  | 'llaves_distintas'
  | 'idk'
  | 'rut'
  | 'traslape'
  | 'caf_no_encontrado'
  | 'rango_invalido'
  | 'folio_usado'
  | 'sin_permiso'
  | 'sesion_invalida';

export class ErrorFolios extends Error {
  override name = 'ErrorFolios';
  readonly motivo: MotivoFolios;
  readonly mensajeUsuario: MensajeError;
  /** Resultado de `operaciones_sii` si se lanza dentro de una operación (nada salió al SII). */
  readonly resultado: 'uso' | 'config';
  /** Campo del formulario al que apunta (para marcarlo). */
  readonly campo?: string;

  constructor(
    motivo: MotivoFolios,
    mensaje: MensajeError,
    opciones: { resultado?: 'uso' | 'config'; campo?: string } = {},
  ) {
    super(mensaje.detalle);
    this.motivo = motivo;
    this.mensajeUsuario = mensaje;
    this.resultado = opciones.resultado ?? 'uso';
    if (opciones.campo) this.campo = opciones.campo;
  }
}

const NADA_AL_SII = 'No se envió nada al SII.';

export function errorSinAutorizacion(): ErrorFolios {
  return new ErrorFolios('sin_autorizacion', {
    titulo: 'La empresa no está autorizada en producción',
    detalle: `Para pedir folios de producción el SII tiene que haber autorizado a la empresa. Termina su certificación o registra su resolución de producción en Configuración → Empresas. ${NADA_AL_SII}`,
  });
}

export function errorPlanSinProduccion(): ErrorFolios {
  return new ErrorFolios('plan_sin_produccion', {
    titulo: 'Tu plan no incluye producción',
    detalle: `Los folios de producción son para emitir boletas reales, y el plan vigente de la organización no lo permite. Cambia a un plan con producción para pedirlos. ${NADA_AL_SII}`,
  });
}

export function errorRevisionRequerida(): ErrorFolios {
  return new ErrorFolios('revision_requerida', {
    titulo: 'Primero revisa la solicitud con el SII',
    detalle: `En producción los folios son reales: antes de timbrarlos revisa con el SII qué rango asignaría (la revisión no gasta folios). Prepara la solicitud de nuevo y revísala. ${NADA_AL_SII}`,
  });
}

export function errorRevisionUsada(): ErrorFolios {
  return new ErrorFolios('revision_usada', {
    titulo: 'Esa revisión ya no sirve para timbrar',
    detalle: `Después de esa revisión ya se timbraron folios del mismo tipo, o pasaron más de 30 minutos. Revisa de nuevo con el SII antes de timbrar. ${NADA_AL_SII}`,
  });
}

export function errorEmpresaDesactivada(): ErrorFolios {
  return new ErrorFolios('empresa_desactivada', {
    titulo: 'La empresa está desactivada',
    detalle: `Actívala en Configuración → Empresas para pedir o subir folios. ${NADA_AL_SII}`,
  });
}

export function errorEmpresaNoEncontrada(): ErrorFolios {
  return new ErrorFolios('empresa_no_encontrada', {
    titulo: 'No encontramos la empresa',
    detalle: 'Puede que la hayan quitado de la organización. Recarga la página y elige otra.',
  });
}

export function errorTraslape(rango?: { desde: number; hasta: number }): ErrorFolios {
  return new ErrorFolios(
    'traslape',
    {
      titulo: 'El CAF se cruza con otro ya cargado',
      detalle: rango
        ? `La empresa ya tiene un CAF del mismo tipo y ambiente con los folios ${formatearMiles(rango.desde)} a ${formatearMiles(rango.hasta)}, que se cruzan con los de este archivo. Revisa que sea el CAF correcto: el SII nunca timbra dos veces el mismo folio.`
        : 'La empresa ya tiene un CAF del mismo tipo y ambiente cuyos folios se cruzan con los de este archivo. Revisa que sea el CAF correcto: el SII nunca timbra dos veces el mismo folio.',
    },
    { campo: 'caf' },
  );
}

export const MENSAJE_SIN_PERMISO: MensajeError = Object.freeze({
  titulo: 'No tienes permiso para gestionar folios',
  detalle: 'Solo un propietario o un administrador puede pedir, subir o anular folios.',
});

export const MENSAJE_SESION_INVALIDA: MensajeError = Object.freeze({
  titulo: 'Tu sesión ya no es válida',
  detalle: 'Vuelve a ingresar y repite la operación. No se guardó nada.',
});

/** Código de PostgREST de un error, sin el mensaje ni el detalle (podrían traer la fila). */
export function codigoPg(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const c = (error as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/**
 * Traduce un error de `anular_folios` (migración 0011): P0002 CAF inexistente o de otra
 * organización, 42501 sin permiso, 22023 rango o motivo inválido, 23503 un folio del rango
 * ya tiene documento. Del mensaje de la base solo se toma el número del folio usado.
 */
export function traducirErrorAnulacion(error: { code?: string; message?: string }): MensajeError {
  switch (error.code) {
    case 'P0002':
      return {
        titulo: 'No encontramos el CAF',
        detalle: 'Puede que lo hayan quitado o que sea de otra organización. Recarga la página.',
      };
    case '42501':
      return { ...MENSAJE_SIN_PERMISO };
    case '22023':
      return {
        titulo: 'Revisa el rango a anular',
        detalle:
          'Tiene que estar dentro del CAF, el primer folio no puede ser mayor que el último y el motivo tiene que tener entre 1 y 500 caracteres. Los folios que aún no se asignan se anulan todos juntos, desde el siguiente folio hasta el último del CAF. No se anuló nada.',
      };
    case '23503': {
      const folio = /folio\s+(\d+)/i.exec(error.message ?? '')?.[1];
      return {
        titulo: 'Hay folios del rango que ya se usaron',
        detalle: `${folio ? `El folio ${formatearMiles(Number(folio))} ya tiene un documento emitido. ` : 'Algún folio del rango ya tiene un documento emitido. '}Un documento emitido no se anula: se corrige con una nota de crédito. Elige un rango sin documentos. No se anuló nada.`,
      };
    }
    default:
      return {
        titulo: 'No pudimos anular los folios',
        detalle: 'Inténtalo de nuevo en unos minutos. No se anuló nada.',
      };
  }
}

/**
 * Un error al validar sin haber abierto una operación (o en la carga manual y la
 * anulación, que no son operaciones del SII): nada salió al SII ni quedó registrado.
 */
export function falloSinEjecutar(error: unknown): ResultadoFolios {
  if (error instanceof ErrorFolios) {
    return {
      tipo: 'error',
      mensaje: { ...error.mensajeUsuario },
      motivo: error.motivo,
      operacionId: null,
      ...(error.campo ? { errores: { [error.campo]: error.mensajeUsuario.titulo } } : {}),
    };
  }
  const resultado = resultadoDeError(error);
  if (resultado === 'error') {
    console.error('folios: falló la validación previa', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
  return {
    tipo: 'error',
    mensaje: mensajeParaUsuario(resultado === 'ok' ? 'error' : resultado, error),
    motivo: resultado,
    operacionId: null,
  };
}
