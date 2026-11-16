import 'server-only';
import type { DocumentoEmitido, MotivoAmbienteBloqueado, ResultadoEmision } from '@/lib/emision';
import { type AmbienteSii, enAmbiente, nombreTipoFolio } from '@/lib/folios';
import { formatearMiles } from '@/lib/formatos';
import {
  ErrorConfig,
  ErrorUso,
  type MensajeError,
  mensajeParaUsuario,
  resultadoDeError,
} from '../sii/errores';
import type { ResultadoEjecucion } from '../sii/operacion';

// Errores de la capa de emisión (PLAN-SAAS Fase 7) y su traducción a `ResultadoEmision`
// con el formato del design system (qué pasó y qué hacer, sin exclamaciones).
//
// `ErrorEmision*` hereda de `ErrorUso` / `ErrorConfig`, así que dentro de
// `ejecutarOperacion` queda con el resultado correcto (`uso` o `config`, nada salió al
// SII) sin tocar `sii/errores.ts`. Su `mensajeUsuario` (con título propio) lo recupera
// quien arma el `ResultadoEmision`. Ningún mensaje lleva el CAF, la `<RSASK>`, el token,
// el .pfx, su clave ni datos de una fila de la base: solo folios, tipos y nombres de campo.

export type MotivoEmision =
  | MotivoAmbienteBloqueado
  | 'empresa_no_encontrada'
  | 'sin_folios'
  | 'cuota'
  | 'receptor_sin_razon_social'
  | 'borrador_no_encontrado'
  | 'borrador_emitido'
  | 'documento_incierto'
  | 'folio_anulado'
  | 'borrador_cambio'
  | 'sin_permiso';

interface DatosErrorEmision {
  readonly motivo: MotivoEmision;
  readonly mensajeUsuario: MensajeError;
  /** Campo del formulario al que apunta (`receptor.razonSocial`...). */
  readonly campo?: string;
}

export class ErrorEmisionUso extends ErrorUso implements DatosErrorEmision {
  override name = 'ErrorEmision';
  readonly motivo: MotivoEmision;
  readonly mensajeUsuario: MensajeError;
  readonly campo?: string;
  constructor(datos: DatosErrorEmision) {
    super(datos.mensajeUsuario.detalle);
    this.motivo = datos.motivo;
    this.mensajeUsuario = datos.mensajeUsuario;
    if (datos.campo) this.campo = datos.campo;
  }
}

export class ErrorEmisionConfig extends ErrorConfig implements DatosErrorEmision {
  override name = 'ErrorEmision';
  readonly motivo: MotivoEmision;
  readonly mensajeUsuario: MensajeError;
  readonly campo?: string;
  constructor(datos: DatosErrorEmision) {
    super(datos.mensajeUsuario.detalle);
    this.motivo = datos.motivo;
    this.mensajeUsuario = datos.mensajeUsuario;
    if (datos.campo) this.campo = datos.campo;
  }
}

export type ErrorEmision = ErrorEmisionUso | ErrorEmisionConfig;

export function esErrorEmision(error: unknown): error is ErrorEmision {
  return error instanceof ErrorEmisionUso || error instanceof ErrorEmisionConfig;
}

function errorEmision(
  motivo: MotivoEmision,
  mensajeUsuario: MensajeError,
  opciones: { resultado?: 'uso' | 'config'; campo?: string } = {},
): ErrorEmision {
  const datos = { motivo, mensajeUsuario, ...(opciones.campo ? { campo: opciones.campo } : {}) };
  return opciones.resultado === 'config'
    ? new ErrorEmisionConfig(datos)
    : new ErrorEmisionUso(datos);
}

const NADA_AL_SII = 'No se envió nada al SII.';
const RUTA_EMPRESAS = 'Configuración → Empresas';

/** Por qué un ambiente está bloqueado, con qué hacer (los mismos motivos de la vista). */
export function errorAmbiente(
  motivo: MotivoAmbienteBloqueado,
  ambiente: AmbienteSii,
): ErrorEmision {
  switch (motivo) {
    case 'empresa_inactiva':
      return errorEmision(motivo, {
        titulo: 'La empresa está desactivada',
        detalle: `Actívala en ${RUTA_EMPRESAS} para emitir boletas. ${NADA_AL_SII}`,
      });
    case 'sin_autorizacion':
      return errorEmision(motivo, {
        titulo: 'La empresa no está autorizada en producción',
        detalle: `Para emitir boletas reales el SII tiene que haber autorizado a la empresa. Termina su certificación o registra su resolución de producción en ${RUTA_EMPRESAS}. ${NADA_AL_SII}`,
      });
    case 'plan_sin_produccion':
      return errorEmision(motivo, {
        titulo: 'Tu plan no incluye producción',
        detalle: `El plan vigente de la organización no permite emitir boletas reales. Cambia a un plan con producción o emite en certificación. ${NADA_AL_SII}`,
      });
    case 'sin_resolucion':
      return errorEmision(
        motivo,
        {
          titulo: `Falta la resolución ${ambiente === 'produccion' ? 'de producción' : 'de certificación'}`,
          detalle:
            ambiente === 'produccion'
              ? `La carátula del envío lleva el número y la fecha de la resolución del SII. Regístrala en ${RUTA_EMPRESAS}. ${NADA_AL_SII}`
              : `La carátula del envío lleva la resolución de certificación (número 0 y la fecha de la postulación). Regístrala en ${RUTA_EMPRESAS}. ${NADA_AL_SII}`,
        },
        { resultado: 'config' },
      );
    case 'sin_certificado':
      return errorEmision(
        motivo,
        {
          titulo: 'La empresa no tiene un certificado vigente',
          detalle: `Asocia un certificado vigente a la empresa y márcalo como predeterminado en ${RUTA_EMPRESAS} → Certificados. ${NADA_AL_SII}`,
        },
        { resultado: 'config' },
      );
  }
}

export function errorEmpresaNoEncontrada(): ErrorEmision {
  return errorEmision('empresa_no_encontrada', {
    titulo: 'No encontramos la empresa',
    detalle: 'Puede que la hayan quitado de la organización. Recarga la página y elige otra.',
  });
}

export function errorSinFolios(tipoDte: number, ambiente: AmbienteSii): ErrorEmision {
  return errorEmision(
    'sin_folios',
    {
      titulo: 'No quedan folios',
      detalle: `No quedan folios de ${nombreTipoFolio(tipoDte).toLowerCase()} ${enAmbiente(ambiente)}. Pide o sube un CAF en Folios (CAF) y vuelve a intentarlo. ${NADA_AL_SII}`,
    },
    { resultado: 'config' },
  );
}

export function errorCuota(limite: number | null, folio?: number): ErrorEmision {
  const tope = limite === null ? '' : ` de ${formatearMiles(limite)} boletas`;
  return errorEmision(
    'cuota',
    {
      titulo: 'Se alcanzó el límite de boletas del mes',
      detalle:
        folio === undefined
          ? `Tu plan permite un máximo${tope} en producción al mes y ya se usaron todas. Cambia a un plan con más boletas o espera al próximo mes. ${NADA_AL_SII}`
          : `Tu plan permite un máximo${tope} en producción al mes y ya se usaron todas. El folio ${formatearMiles(folio)} quedó anulado. Cambia a un plan con más boletas o espera al próximo mes. ${NADA_AL_SII}`,
    },
    { resultado: 'config' },
  );
}

export function errorReceptorSinRazonSocial(): ErrorEmision {
  return errorEmision(
    'receptor_sin_razon_social',
    {
      titulo: 'Falta la razón social del receptor',
      detalle: `Escribe la razón social del receptor, o deja el RUT vacío para emitir a Cliente General. ${NADA_AL_SII}`,
    },
    { campo: 'receptor.razonSocial' },
  );
}

export function errorBorradorNoEncontrado(): ErrorEmision {
  return errorEmision('borrador_no_encontrado', {
    titulo: 'No encontramos el borrador',
    detalle: 'Puede que alguien lo haya borrado. Vuelve a guardar la boleta y emítela de nuevo.',
  });
}

export function errorBorradorEmitido(folio: number | null): ErrorEmision {
  return errorEmision('borrador_emitido', {
    titulo: 'Este borrador ya se emitió',
    detalle: `${folio ? `Es la boleta N.º ${formatearMiles(folio)}. ` : ''}Búscala en Documentos. Para emitir otra igual, crea una boleta nueva.`,
  });
}

export function errorDocumentoIncierto(folio: number | null): ErrorEmision {
  return errorEmision('documento_incierto', {
    titulo: 'No sabemos si el SII recibió esta boleta',
    detalle: `${folio ? `La boleta N.º ${formatearMiles(folio)}` : 'La boleta'} quedó con resultado incierto. No la vuelvas a emitir: revisa en el portal del SII si el folio quedó recibido.`,
  });
}

export function errorBorradorCambio(folio: number): ErrorEmision {
  return errorEmision('borrador_cambio', {
    titulo: 'El borrador cambió mientras lo emitíamos',
    detalle: `Alguien lo borró o lo emitió al mismo tiempo. El folio ${formatearMiles(folio)} quedó anulado. Revisa Documentos antes de volver a emitir. ${NADA_AL_SII}`,
  });
}

export function errorFoliosAnulados(folios: readonly number[]): ErrorEmision {
  return errorEmision(
    'folio_anulado',
    {
      titulo: 'Los folios asignados se anularon mientras emitíamos',
      detalle: `Se anularon los folios ${folios.map(formatearMiles).join(', ')} justo al asignarlos. Revisa las anulaciones en Folios (CAF) y vuelve a intentarlo. ${NADA_AL_SII}`,
    },
    { resultado: 'config' },
  );
}

export function errorSinPermiso(): ErrorEmision {
  return errorEmision('sin_permiso', {
    titulo: 'No tienes permiso para emitir',
    detalle: 'Solo un propietario, un administrador o un emisor puede emitir boletas.',
  });
}

// --- Traducción a ResultadoEmision ------------------------------------------------------

export type ErrorResultado = Extract<ResultadoEmision, { tipo: 'error' }>;

function errores(error: ErrorEmision): Pick<ErrorResultado, 'errores'> {
  return error.campo ? { errores: { [error.campo]: error.mensajeUsuario.titulo } } : {};
}

/**
 * Un error sin haber abierto una operación (validación previa, ensayo, borrador): nada
 * salió al SII ni quedó en `operaciones_sii`. Los errores de la app y de la librería
 * traen un mensaje seguro; de uno desconocido, el genérico (solo su nombre a la consola).
 */
export function falloSinEjecutar(error: unknown): ErrorResultado {
  if (esErrorEmision(error)) {
    return {
      tipo: 'error',
      mensaje: { ...error.mensajeUsuario },
      motivo: error.motivo,
      operacionId: null,
      ...errores(error),
    };
  }
  const resultado = resultadoDeError(error);
  if (resultado === 'error') {
    console.error('emision: falló la validación previa', {
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

/** Lo que no es `ok` de `ejecutarOperacion`, con el mensaje propio si la emisión dio uno. */
export function falloDeEjecucion(
  r: Exclude<ResultadoEjecucion<unknown>, { ok: true }>,
  extra: { mensaje?: MensajeError; error?: unknown; documento?: DocumentoEmitido } = {},
): ErrorResultado {
  const propio = esErrorEmision(extra.error) ? extra.error : undefined;
  const mensaje = extra.mensaje ?? (propio ? propio.mensajeUsuario : r.mensaje);
  const base: ErrorResultado = r.ejecutada
    ? { tipo: 'error', mensaje: { ...mensaje }, resultado: r.resultado, operacionId: r.operacionId }
    : { tipo: 'error', mensaje: { ...mensaje }, motivo: r.motivo, operacionId: r.operacionId };
  return {
    ...base,
    ...(propio ? { motivo: propio.motivo, ...errores(propio) } : {}),
    ...(extra.documento ? { documento: extra.documento } : {}),
  };
}
