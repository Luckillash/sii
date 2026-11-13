// Errores y mensajes de los certificados digitales (PLAN-SAAS Fase 3), con el formato
// del design system: qué pasó y qué hacer. Puro, sin `server-only`: lo usan el
// servidor y los componentes cliente, y se prueba con Vitest.
//
// Ningún mensaje lleva la clave, el contenido del .pfx (ni su base64) ni el nombre
// del archivo (los .pfx del SII suelen llevar el RUT en el nombre).

import { formatearFecha } from '@/lib/formatos';
import type { ErrorBase, MensajeError } from '@/server/equipo-errores';

export type { MensajeError };

export type MotivoErrorCertificado =
  | 'no_es_pfx'
  | 'clave_incorrecta'
  | 'danado'
  | 'vencido'
  | 'no_vigente';

/** Campo del formulario al que apunta cada motivo. */
export const CAMPO_DEL_MOTIVO: Readonly<Record<MotivoErrorCertificado, 'pfx' | 'clave'>> = {
  no_es_pfx: 'pfx',
  clave_incorrecta: 'clave',
  danado: 'pfx',
  vencido: 'pfx',
  no_vigente: 'pfx',
};

function mensajeDelMotivo(
  motivo: MotivoErrorCertificado,
  fechas: { vigenteDesde?: Date; vigenteHasta?: Date },
): MensajeError {
  switch (motivo) {
    case 'no_es_pfx':
      return {
        titulo: 'El archivo no es un certificado .pfx',
        detalle:
          'Elige el archivo .pfx o .p12 que te entregó la entidad certificadora (por ejemplo, E-Certchile o Acepta).',
      };
    case 'clave_incorrecta':
      return {
        titulo: 'La contraseña del certificado no es correcta',
        detalle:
          'Escribe la contraseña que definiste al descargar el certificado. Respeta mayúsculas y minúsculas.',
      };
    case 'danado':
      return {
        titulo: 'No pudimos leer el certificado',
        detalle:
          'El archivo está dañado o usa un formato no soportado. Vuelve a exportarlo desde la entidad certificadora e inténtalo de nuevo.',
      };
    case 'vencido':
      return {
        titulo: 'El certificado está vencido',
        detalle: `${fechas.vigenteHasta ? `Venció el ${formatearFecha(fechas.vigenteHasta)}. ` : ''}Renuévalo con tu entidad certificadora y sube el nuevo.`,
      };
    case 'no_vigente':
      return {
        titulo: 'El certificado todavía no está vigente',
        detalle: `${fechas.vigenteDesde ? `Empieza a regir el ${formatearFecha(fechas.vigenteDesde)}. ` : ''}Súbelo desde esa fecha.`,
      };
  }
}

/**
 * Error de `analizarCertificado()`. El mensaje es fijo (no depende del archivo) y no
 * tiene `cause`: el error original de node-forge o de la librería no se propaga.
 */
export class ErrorAnalisisCertificado extends Error {
  override name = 'ErrorAnalisisCertificado';
  readonly motivo: MotivoErrorCertificado;
  readonly mensaje: MensajeError;

  constructor(
    motivo: MotivoErrorCertificado,
    fechas: { vigenteDesde?: Date; vigenteHasta?: Date } = {},
  ) {
    const mensaje = mensajeDelMotivo(motivo, fechas);
    super(mensaje.titulo);
    this.motivo = motivo;
    this.mensaje = mensaje;
  }
}

export const MENSAJE_GENERICO_CERTIFICADO: MensajeError = {
  titulo: 'No pudimos completar la operación',
  detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
};

export const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para hacer esto',
  detalle: 'Solo un propietario o un administrador de la organización gestiona los certificados.',
};

export const SESION_VENCIDA: MensajeError = {
  titulo: 'Tu sesión ya no es válida',
  detalle: 'Por seguridad, vuelve a ingresar y repite la operación.',
};

export const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Los datos no son válidos',
  detalle: 'Recarga la página y vuelve a intentarlo.',
};

export const SIN_EFECTO: MensajeError = {
  titulo: 'No se aplicó el cambio',
  detalle:
    'Puede que ya no exista o que tu rol no lo permita. Recarga la página para ver el estado actual.',
};

export type OperacionCertificado =
  | 'subir'
  | 'revocar'
  | 'eliminar'
  | 'asociar'
  | 'editar_asociacion'
  | 'predeterminado'
  | 'quitar_asociacion';

/**
 * Errores de Postgres/PostgREST de `registrar_certificado()`, `empresa_certificados`
 * y `fijar_certificado_predeterminado()`:
 *
 *   23505  `unique (organizacion_id, huella_sha256)` de `certificados`, o la llave
 *          primaria `(empresa_id, certificado_id)` de `empresa_certificados`.
 *   23503  FK compuesta de `empresa_certificados`: el certificado no es de la
 *          organización; o, en `registrar_certificado`, la organización no existe.
 *   22023  `registrar_certificado`: RUT del titular inválido, huella o .pfx vacíos.
 *   P0002  `fijar_certificado_predeterminado`: el certificado no está asociado.
 *   42501  RLS (no es admin) o `registrar_certificado` llamado sin service_role.
 *   23514  checks (`public.rut`, huella en hex).
 */
export function traducirErrorCertificado(
  error: ErrorBase | null | undefined,
  operacion: OperacionCertificado,
): MensajeError {
  const codigo = error?.code ?? '';
  if (codigo === '23505') {
    return operacion === 'subir'
      ? {
          titulo: 'Ese certificado ya está cargado en la organización',
          detalle: 'Lo encuentras en la lista de certificados. No hace falta subirlo de nuevo.',
        }
      : {
          titulo: 'Ese certificado ya está asociado a la empresa',
          detalle: 'Cambia sus opciones en la tabla de certificados de la empresa.',
        };
  }
  if (codigo === '23503') {
    return {
      titulo: 'El certificado o la empresa ya no existen',
      detalle: 'Recarga la página para ver el estado actual.',
    };
  }
  if (codigo === 'P0002') return SIN_EFECTO;
  if (codigo === '42501') return SIN_PERMISO;
  if (codigo === '23514' || codigo === '22P02' || codigo === '22023') {
    return {
      titulo: 'Los datos del certificado no son válidos',
      detalle: 'Revisa el RUT del titular y vuelve a intentarlo.',
    };
  }
  return MENSAJE_GENERICO_CERTIFICADO;
}
