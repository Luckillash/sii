// Jerarquía única de errores de la librería (PLAN-MIGRACION.md §7, pend. 6.4).
//
// Deriva de las excepciones de winex/certificacion v1.9.1 (SolicitudFoliosException,
// SesionCaducaException, FoliosSinCafException, PostulacionException,
// DeclaracionInciertaException, SetSinDescargarException), © 2026 Meniaz
// (William Menares), Apache-2.0. Modificado: port a TypeScript y jerarquía unificada.
//
// Regla para todos: el mensaje está pensado para mostrarse al usuario. Nunca
// incluye material PEM, contraseñas, tokens ni cookies. El detalle técnico (que
// puede nombrar rutas o datos sensibles) va en `cause`.

import type { Ambiente } from './ambiente.ts';

/** Base de todos los errores de la librería. */
export class SiiError extends Error {
  constructor(mensaje: string, opciones?: ErrorOptions) {
    super(mensaje, opciones);
    this.name = new.target.name;
  }
}

/** Un dato de entrada no cumple las reglas del SII (RUT, correo, largo de un campo...). */
export class ErrorValidacion extends SiiError {}

/** No se pudo leer o usar el certificado digital (.pfx / PEM). */
export class ErrorCertificado extends SiiError {}

/** Falló la firma XML-DSig. */
export class ErrorFirma extends SiiError {}

/** Falló el timbre electrónico (TED) o la lectura del CAF. */
export class ErrorTimbre extends SiiError {}

/**
 * Falla de red o respuesta HTTP inesperada. `status` es el código HTTP cuando hubo
 * respuesta; queda `undefined` si no se pudo conectar (DNS, TLS, timeout...).
 */
export class ErrorTransporte extends SiiError {
  readonly status: number | undefined;
  readonly url: string;

  constructor(mensaje: string, url: string, status?: number, opciones?: ErrorOptions) {
    super(mensaje, opciones);
    this.url = url;
    this.status = status;
  }
}

/** El SII respondió, pero rechazó la operación o devolvió algo que no se entiende. */
export class ErrorRespuestaSii extends SiiError {
  readonly estado: string | undefined;
  readonly glosa: string | undefined;

  constructor(
    mensaje: string,
    datos: { estado?: string; glosa?: string } = {},
    opciones?: ErrorOptions,
  ) {
    super(mensaje, opciones);
    this.estado = datos.estado;
    this.glosa = datos.glosa;
  }
}

/** La solicitud de folios falló. */
export class ErrorSolicitudFolios extends SiiError {}

/**
 * La sesión AUT2000 ya no sirve. Quien la tenía guardada la descarta, vuelve a
 * autenticar y reintenta. Se lanza antes de timbrar: reintentar no gasta folios.
 */
export class SesionCaducaError extends ErrorSolicitudFolios {}

/**
 * La orden de timbrar llegó al SII y los folios pueden estar timbrados, pero no se
 * obtuvo el CAF. No hay que reintentar la solicitud (quemaría otro rango): primero
 * revisar "Folios ya autorizados" en el portal y bajar el CAF de ahí.
 */
/**
 * Primer timbraje del tipo de documento: el asistente del SII pide el folio inicial
 * ("Ingrese Folio Inicial") y no se indicó `folioInicial`. Se lanza antes de timbrar
 * y sin enviar esa página: reintentar con `folioInicial` no gasta folios.
 * (Nuevo en Node: el PHP mandaba FOLIO_INICIAL=0 y el SII repetía la página.)
 */
export class FolioInicialRequeridoError extends ErrorSolicitudFolios {
  readonly ambiente: Ambiente;
  /** El valor que propone el SII en la página (texto tal cual; puede venir vacío). */
  readonly folioSugerido: string;

  constructor(ambiente: Ambiente, folioSugerido: string) {
    super(
      `El SII pide el folio inicial: es el primer timbraje de este tipo de documento en ${ambiente}` +
        (folioSugerido !== '' ? ` (el SII sugiere ${folioSugerido})` : '') +
        '. Indica el folio inicial y vuelve a solicitar; no se timbró nada.',
    );
    this.ambiente = ambiente;
    this.folioSugerido = folioSugerido;
  }
}

export class FoliosSinCafError extends ErrorSolicitudFolios {
  readonly folioDesde: number;
  readonly folioHasta: number;
  readonly ambiente: Ambiente;

  constructor(
    folioDesde: number,
    folioHasta: number,
    ambiente: Ambiente,
    host: string,
    detalle = '',
    opciones?: ErrorOptions,
  ) {
    super(
      `La solicitud de los folios ${folioDesde} al ${folioHasta} llegó a ${host} y pudo haberlos ` +
        'timbrado, pero no se obtuvo el CAF. Revisa "Folios ya autorizados" en el portal del SII y bájalo de ahí; ' +
        'no los vuelvas a pedir sin revisar.' +
        (detalle !== '' ? ` ${detalle}` : ''),
      opciones,
    );
    this.folioDesde = folioDesde;
    this.folioHasta = folioHasta;
    this.ambiente = ambiente;
  }
}

/** La postulación o la declaración de cumplimiento falló. */
export class ErrorPostulacion extends SiiError {}

/**
 * La orden de grabar la declaración de cumplimiento llegó al SII, pero no se pudo
 * confirmar el resultado: la empresa puede haber quedado autorizada en producción.
 * No reintentar a ciegas: consultar el estado (P91 = autorizada; P90 = se puede
 * volver a declarar).
 */
export class DeclaracionInciertaError extends ErrorPostulacion {
  readonly rutEmpresa: string;

  constructor(rutEmpresa: string, detalle = '', opciones?: ErrorOptions) {
    super(
      `La declaración de cumplimiento de ${rutEmpresa} llegó al SII, pero no se pudo confirmar si quedó grabada. ` +
        'Consulta el estado antes de volver a declarar.' +
        (detalle !== '' ? ` ${detalle}` : ''),
      opciones,
    );
    this.rutEmpresa = rutEmpresa;
  }
}

/**
 * El SII no acepta pedir la revisión del set porque la empresa no ha descargado el
 * set de pruebas de boletas en el portal (respuesta `errorEstado`).
 */
export class SetSinDescargarError extends ErrorPostulacion {}
