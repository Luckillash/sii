// Deriva de winex/certificacion v1.9.1 (src/Postulacion/DatosPostulacion.php y
// src/Postulacion/DatosDeclaracion.php), © 2026 Meniaz (William Menares),
// Apache-2.0. Modificado: port a TypeScript; los errores de datos son
// ErrorValidacion.

import { largoCodePoints as largo } from '../comun/codificacion.ts';
import { ErrorValidacion } from '../comun/errores.ts';
import { Rut } from '../comun/rut.ts';

export interface EntradaPostulacion {
  /** Empresa que postula. */
  rutEmpresa: string;
  /** Usuario administrador: tiene que ser quien se autentica para después ver/declarar el avance. */
  rutAdministrador: string;
  correoAdministrador: string;
  correoContactoSii: string;
  correoIntercambio: string;
  nombreSoftware: string;
  /** Por omisión `true`. */
  boletaExenta?: boolean;
  /** Opcional; si va, tiene que empezar con "www.". */
  url?: string;
}

/**
 * Lo que se declara al postular una empresa a boleta electrónica en maullin
 * (`pe_datos_empresa`). Factura no se postula desde acá.
 *
 * Las reglas son las del formulario del SII (validadte.js): si no se cumplen, el
 * SII rechaza la página, así que se cortan antes de salir.
 */
export class DatosPostulacion {
  readonly empresa: Rut;
  readonly administrador: Rut;
  readonly correoAdministrador: string;
  readonly correoContactoSii: string;
  readonly correoIntercambio: string;
  readonly nombreSoftware: string;
  readonly boletaExenta: boolean;
  readonly url: string;

  /** @throws ErrorValidacion */
  constructor(entrada: EntradaPostulacion) {
    this.empresa = Rut.de(entrada.rutEmpresa, 'RUT de la empresa');
    this.administrador = Rut.de(entrada.rutAdministrador, 'RUT del usuario administrador');

    validarCorreo(entrada.correoAdministrador, 'correo del usuario administrador');
    validarCorreo(entrada.correoContactoSii, 'correo de contacto con el SII');
    validarCorreo(entrada.correoIntercambio, 'correo de intercambio');

    if (entrada.nombreSoftware.trim() === '' || largo(entrada.nombreSoftware) > 30) {
      throw new ErrorValidacion(
        'El nombre del software es obligatorio y tiene como máximo 30 caracteres.',
      );
    }

    const url = entrada.url ?? '';
    if (url !== '' && (!url.startsWith('www.') || largo(url) > 100)) {
      throw new ErrorValidacion(
        'La URL tiene que empezar con "www." y tener como máximo 100 caracteres.',
      );
    }

    this.correoAdministrador = entrada.correoAdministrador;
    this.correoContactoSii = entrada.correoContactoSii;
    this.correoIntercambio = entrada.correoIntercambio;
    this.nombreSoftware = entrada.nombreSoftware;
    this.boletaExenta = entrada.boletaExenta ?? true;
    this.url = url;
  }
}

export interface EntradaDeclaracion {
  rutEmpresa: string;
  linkConsulta: string;
  rutProveedor: string;
  nombreProveedor: string;
  correoProveedor: string;
}

/**
 * Lo que se informa en la declaración de cumplimiento de boletas (www4). El SII
 * exige los tres datos del proveedor de software: es la empresa que desarrolla o
 * vende el sistema (para clientes, la SpA que vende el software; para ella misma,
 * ella misma).
 */
export class DatosDeclaracion {
  readonly empresa: Rut;
  readonly proveedor: Rut;
  readonly linkConsulta: string;
  readonly nombreProveedor: string;
  readonly correoProveedor: string;

  /** @throws ErrorValidacion */
  constructor(entrada: EntradaDeclaracion) {
    this.empresa = Rut.de(entrada.rutEmpresa, 'RUT de la empresa');
    this.proveedor = Rut.de(entrada.rutProveedor, 'RUT del proveedor de software');

    if (entrada.linkConsulta.trim() === '' || largo(entrada.linkConsulta) > 100) {
      throw new ErrorValidacion(
        'El link de consulta de boletas es obligatorio y tiene como máximo 100 caracteres.',
      );
    }
    if (entrada.nombreProveedor.trim() === '' || largo(entrada.nombreProveedor) > 30) {
      throw new ErrorValidacion(
        'El nombre del proveedor de software es obligatorio y tiene como máximo 30 caracteres.',
      );
    }
    validarCorreo(entrada.correoProveedor, 'correo del proveedor de software');

    this.linkConsulta = entrada.linkConsulta;
    this.nombreProveedor = entrada.nombreProveedor;
    this.correoProveedor = entrada.correoProveedor;
  }
}

const PROHIBIDOS = /[!"#$%&/()=?+*|<>[\];]/;

/**
 * Regla de `esValidoMail2` del SII: sin espacios ni ! " # $ % & / ( ) = ? + * | < > [ ] ;
 * ni letras con tilde, un solo @ y al menos un punto después. Máximo 50.
 *
 * @throws ErrorValidacion
 */
export function validarCorreo(correo: string, campo = 'correo'): void {
  const arroba = correo.indexOf('@');
  const valido =
    correo.length <= 50 &&
    /^[\x21-\x7E]+$/.test(correo) &&
    !PROHIBIDOS.test(correo) &&
    arroba !== -1 &&
    arroba === correo.lastIndexOf('@') &&
    !correo.includes('@.') &&
    !correo.startsWith('@') &&
    !correo.startsWith('.') &&
    !correo.endsWith('@') &&
    !correo.endsWith('.') &&
    correo.slice(arroba + 1).includes('.');

  if (!valido) {
    throw new ErrorValidacion(
      `El ${campo} no lo acepta el SII: ${correo}. Sin + ni símbolos ni tildes, un solo @ y máximo 50 caracteres.`,
    );
  }
}
