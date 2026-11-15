// Nuevo en Node (no existe en winex/certificacion): consulta si una empresa está
// autorizada para emitir con software de mercado, con la página «Actualización de
// datos del contribuyente» del portal de producción (`cvc_cgi/dte/ad_empresa1` →
// `ad_empresa2`). Validado contra palena el 2026-11-13 (docs/validaciones.md).
//
// Solo lectura. `ad_empresa2` trae, para el representante legal, un formulario que
// ACTUALIZA los datos del contribuyente (botones MOD_EMP / MOD_USU): nunca se envía.
// Los candados no dependen de lo que mande el SII:
// - solo `GET ad_empresa1` y `POST ad_empresa2`, por https a palena;
// - el POST lleva solo `RUT_EMP`, `DV_EMP` y `ACEPTAR`, armados aquí;
// - el RUT de la respuesta tiene que ser el pedido;
// - una página que no se reconoce lanza `ErrorVerificacion`, sin copiar el HTML (la
//   página de una empresa autorizada trae correos, URL y nombre del software).

import { datosAmbiente } from '../comun/ambiente.ts';
import { decodificarUtf8OIso, minusculasAscii } from '../comun/codificacion.ts';
import { ErrorVerificacion } from '../comun/errores.ts';
import { textoHtml } from '../comun/html.ts';
import { exigirStatus } from '../comun/http/respuesta.ts';
import type { TransporteHttp } from '../comun/http/transporte.ts';
import { TransporteUndici } from '../comun/http/transporte-undici.ts';
import { exigirSesionVigente, navegar } from '../comun/navegacion-sii.ts';
import { type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import type { Certificado } from '../core/certificado.ts';
import type { SesionSii } from './sesion-sii.ts';
import { formularioFolios, MS_ASISTENTE, SolicitudFolios } from './solicitud-folios.ts';

/** Ruta de la página con el formulario del RUT. */
export const RUTA_AD_EMPRESA1 = '/cvc_cgi/dte/ad_empresa1';
/** Ruta de la página que responde. */
export const RUTA_AD_EMPRESA2 = '/cvc_cgi/dte/ad_empresa2';

/** Respuesta del SII para la empresa consultada. */
export type ResultadoAutorizacion =
  | {
      /** El titular del certificado es representante legal y la empresa está autorizada. */
      readonly tipo: 'autorizada';
      /** RUT de la empresa, `76123456-0`. */
      readonly rut: string;
      readonly razonSocial: string;
      /** Fecha de autorización, `AAAA-MM-DD`. */
      readonly fechaAutorizacion: string;
      /** Resolución de producción que informa el SII (fecha `AAAA-MM-DD`). */
      readonly resolucion: { readonly numero: number; readonly fecha: string };
    }
  | {
      /**
       * El titular no figura como representante legal de la empresa. El SII responde
       * lo mismo esté o no autorizada: no dice nada de la autorización.
       */
      readonly tipo: 'sin_representacion';
    }
  | {
      /** El SII dice que la empresa no está autorizada para operar con software de mercado. */
      readonly tipo: 'no_autorizada';
    };

export interface OpcionesConsultaAutorizacion {
  /** Por defecto, un `TransporteUndici` propio. */
  readonly transporte?: TransporteHttp;
  /** Para la expiración de las cookies de la sesión. */
  readonly reloj?: Reloj;
}

/**
 * Consulta en el portal de producción (palena) si una empresa está autorizada y con
 * qué resolución. Exige que el titular del certificado sea **representante legal**
 * de la empresa en el SII (no basta el representante electrónico): si no, la
 * respuesta es `sin_representacion`.
 *
 * Solo producción: en maullin la página no dice nada útil. La sesión es la misma
 * AUT2000 de `SolicitudFolios` en producción (se puede reutilizar una guardada).
 */
export class ConsultaAutorizacion {
  readonly ambiente = 'produccion' as const;
  readonly #transporte: TransporteHttp;
  readonly #reloj: Reloj;

  constructor(opciones: OpcionesConsultaAutorizacion = {}) {
    this.#transporte = opciones.transporte ?? new TransporteUndici();
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  get #datos() {
    return datosAmbiente(this.ambiente);
  }

  /**
   * Login AUT2000 de producción con el certificado (el mismo de `SolicitudFolios`).
   * Ojo con el freno de re-login del SII: si se consulta seguido, guardar la sesión.
   *
   * @throws ErrorSolicitudFolios si el SII no aceptó el certificado
   * @throws ErrorTransporte si falla la red o el SII responde un código inesperado
   */
  autenticar(certificado: Certificado): Promise<SesionSii> {
    return new SolicitudFolios({
      ambiente: this.ambiente,
      transporte: this.#transporte,
      reloj: this.#reloj,
    }).autenticar(certificado);
  }

  /**
   * @throws ErrorValidacion si el RUT no es válido (no sale nada al SII)
   * @throws SesionCaducaError si la sesión ya no sirve (volver a autenticar)
   * @throws ErrorVerificacion si el SII respondió una página que no se reconoce,
   *   con un RUT distinto del pedido, o redirigió fuera de la consulta
   * @throws ErrorTransporte si falla la red o el SII responde un código inesperado
   */
  async consultar(sesion: SesionSii, rutEmpresa: string | Rut): Promise<ResultadoAutorizacion> {
    const rut = rutEmpresa instanceof Rut ? rutEmpresa : Rut.de(rutEmpresa, 'RUT de la empresa');
    const url1 = `${this.#datos.portal}${RUTA_AD_EMPRESA1}`;
    const url2 = `${this.#datos.portal}${RUTA_AD_EMPRESA2}`;

    const pagina1 = await this.#pedir(sesion, 'GET', url1, null, url1);
    exigirSesionVigente(pagina1);
    const form = formularioFolios(pagina1);
    if (
      form === null ||
      !form.action.endsWith(RUTA_AD_EMPRESA2) ||
      !form.inputs.has('RUT_EMP') ||
      !form.inputs.has('DV_EMP')
    ) {
      throw new ErrorVerificacion(
        'La página de consulta de datos del contribuyente del SII no es la que conoce la librería ' +
          '(sin el formulario del RUT de la empresa). No se consultó.',
      );
    }

    // Solo estos tres campos: nunca los de otro formulario.
    const campos = new Map([
      ['RUT_EMP', rut.numero],
      ['DV_EMP', rut.dv],
      ['ACEPTAR', form.inputs.get('ACEPTAR') || 'Ingresar'],
    ]);
    const pagina2 = await this.#pedir(sesion, 'POST', url2, campos, url1);
    exigirSesionVigente(pagina2);
    return leerAdEmpresa2(pagina2, rut);
  }

  async #pedir(
    sesion: SesionSii,
    metodo: 'GET' | 'POST',
    url: string,
    campos: Map<string, string> | null,
    referer: string,
  ): Promise<string> {
    const respuesta = await navegar(this.#transporte, sesion, {
      metodo,
      url,
      ...(campos !== null ? { cuerpo: { tipo: 'formulario', campos } } : {}),
      cabeceras: { Referer: referer },
      msRespuesta: MS_ASISTENTE,
      revisar: (destino) => this.#soloConsulta(destino),
      errorRedirecciones: (mensaje) => new ErrorVerificacion(mensaje),
    });
    return decodificarUtf8OIso(exigirStatus(respuesta, url, 200).cuerpo);
  }

  /** Solo las dos páginas de la consulta, en palena y por https. */
  #soloConsulta(url: string): void {
    exigirSesionVigente(url);
    let u: URL | null = null;
    try {
      u = new URL(url);
    } catch {
      u = null;
    }
    if (
      u === null ||
      u.protocol !== 'https:' ||
      u.hostname !== this.#datos.host ||
      u.port !== '' ||
      u.username !== '' ||
      u.password !== '' ||
      (u.pathname !== RUTA_AD_EMPRESA1 && u.pathname !== RUTA_AD_EMPRESA2)
    ) {
      throw new ErrorVerificacion(
        `Consulta de autorización detenida: el SII apuntó fuera de la consulta de datos del contribuyente (${this.#datos.host}).`,
      );
    }
  }
}

// --- Lectura de ad_empresa2 ------------------------------------------------------

const MARCA_SIN_REPRESENTACION =
  /no esta registrado en la empresa rut\s+([0-9.]+-[0-9k])\s+como representante legal/;
const MARCA_NO_AUTORIZADA = /no esta autorizado para operar en esta modalidad/;
const MARCA_AUTORIZADA = /antecedentes del contribuyente registrados/;

/** Minúsculas y sin tildes ni espacios duros, para comparar textos del SII. */
function normalizar(texto: string): string {
  return minusculasAscii(texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ /g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto visible de un trozo de HTML, sin espacios duros ni blancos de sobra. */
function textoCelda(html: string): string {
  return textoHtml(html, 1000, { sinScripts: true }).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

const desconocida = (): ErrorVerificacion =>
  new ErrorVerificacion(
    'El SII respondió la consulta de datos del contribuyente con una página que la librería no ' +
      'reconoce. No se interpretó: revisa si el SII cambió la página.',
  );

/**
 * Interpreta la respuesta de `ad_empresa2`. Exportada para las pruebas con páginas
 * grabadas; no hace peticiones.
 *
 * @throws ErrorVerificacion si la página no es una de las tres conocidas, o si es
 *   de otro RUT o le falta un dato
 */
export function leerAdEmpresa2(html: string, rut: Rut): ResultadoAutorizacion {
  const texto = normalizar(textoHtml(html, Number.MAX_SAFE_INTEGER, { sinScripts: true }));
  const sinRepresentacion = MARCA_SIN_REPRESENTACION.exec(texto);
  const marcas = [
    sinRepresentacion !== null,
    MARCA_NO_AUTORIZADA.test(texto),
    MARCA_AUTORIZADA.test(texto),
  ];
  if (marcas.filter(Boolean).length !== 1) throw desconocida();

  if (sinRepresentacion !== null) {
    exigirMismoRut(sinRepresentacion[1] as string, rut);
    return { tipo: 'sin_representacion' };
  }
  if (marcas[1]) return { tipo: 'no_autorizada' };

  const filas = filasDosColumnas(html);
  const dato = (etiqueta: string): string => {
    const valor = filas.get(etiqueta);
    if (valor === undefined || valor === '') throw desconocida();
    return valor;
  };

  exigirMismoRut(dato('rut'), rut);
  const numero = dato('resolucion');
  if (!/^\d{1,9}$/.test(numero) || Number(numero) < 1) throw desconocida();

  return {
    tipo: 'autorizada',
    rut: rut.toString(),
    razonSocial: dato('razon social'),
    fechaAutorizacion: fechaIso(dato('fecha autorizacion')),
    resolucion: { numero: Number(numero), fecha: fechaIso(dato('fecha resolucion')) },
  };
}

/**
 * Filas de dos celdas de las tablas de la página: etiqueta normalizada (sin el
 * `(*)` de los campos editables) → valor tal cual (sin blancos de los bordes). Una
 * etiqueta repetida deja la página como desconocida.
 */
function filasDosColumnas(html: string): Map<string, string> {
  const filas = new Map<string, string>();
  for (const fila of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const cuerpo = fila.split(/<\/table\s*>/i)[0] as string;
    const celdas = cuerpo
      .split(/<td\b[^>]*>/i)
      .slice(1)
      .map(textoCelda);
    if (celdas.length !== 2) continue;
    const etiqueta = normalizar((celdas[0] as string).replace(/\(\*\)/g, ''));
    if (filas.has(etiqueta)) throw desconocida();
    filas.set(etiqueta, celdas[1] as string);
  }
  return filas;
}

function exigirMismoRut(texto: string, rut: Rut): void {
  if (!Rut.esValido(texto) || !Rut.de(texto).equals(rut)) {
    throw new ErrorVerificacion(
      `El SII respondió la consulta de datos del contribuyente con otro RUT (se pidió ${rut}). No se usó.`,
    );
  }
}

/** `DD-MM-AAAA` (fecha real) → `AAAA-MM-DD`. */
function fechaIso(texto: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto);
  if (m === null) throw desconocida();
  const [, d, mes, a] = m as unknown as [string, string, string, string];
  const fecha = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (
    fecha.getUTCFullYear() !== Number(a) ||
    fecha.getUTCMonth() !== Number(mes) - 1 ||
    fecha.getUTCDate() !== Number(d)
  ) {
    throw desconocida();
  }
  return `${a}-${mes}-${d}`;
}
