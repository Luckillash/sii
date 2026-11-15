// Nuevo en Node (no existe en winex/certificacion): historial de timbraje de un RUT
// en la consulta pública «Situación tributaria de terceros» (STC) del SII, sin
// login ni certificado. Validado el 2026-11-13 (docs/validaciones.md).
//
// La página https://www2.sii.cl/stc/noauthz es una SPA que llama a dos recursos:
//   1. GET  /app/stc/recurso/v1/recaptcha/key            → { enable, key }
//   2. POST /app/stc/recurso/v1/consulta/getConsultaData/ → { ..., timbrajes: [...] }
// Usa reCAPTCHA Enterprise v3, pero mientras `enable` sea `false` la SPA manda
// `reToken: " "` y el SII responde igual. Si `enable` es `true` no se consulta (no se
// intenta resolver el captcha): se devuelve `{ tipo: 'captcha' }`.
//
// La respuesta trae mucho más (nombre, giros, observaciones): solo se lee
// `timbrajes` y el resto se descarta.

import { ErrorVerificacion } from '../comun/errores.ts';
import { exigirStatus } from '../comun/http/respuesta.ts';
import type { TransporteHttp } from '../comun/http/transporte.ts';
import { TransporteUndici } from '../comun/http/transporte-undici.ts';
import { USER_AGENT_NAVEGADOR } from '../comun/navegacion-sii.ts';
import { Rut } from '../comun/rut.ts';

/** Origen de la consulta pública. */
export const HOST_STC = 'https://www2.sii.cl';
/** Indica si el captcha está activo. */
export const URL_STC_RECAPTCHA = `${HOST_STC}/app/stc/recurso/v1/recaptcha/key`;
/** Datos del contribuyente (con `timbrajes`). */
export const URL_STC_CONSULTA = `${HOST_STC}/app/stc/recurso/v1/consulta/getConsultaData/`;
/** Página de la SPA (va en `Referer`). */
export const PAGINA_STC = `${HOST_STC}/stc/noauthz`;
/** Tope de cada petición, en ms. */
export const MS_STC = 30_000;

/** Un tipo de documento al que el SII le timbró folios. */
export interface TimbrajeStc {
  /** Código del documento (`"0039"` → 39). */
  readonly tipoDte: number;
  /** Año del último timbraje. */
  readonly ultimoAnio: number;
  /** Último folio timbrado (sin los espacios de relleno del SII). */
  readonly folioFinal: number;
}

export type ResultadoTimbrajes =
  | { readonly tipo: 'ok'; readonly timbrajes: readonly TimbrajeStc[] }
  /** El SII activó el captcha: no se consultó. */
  | { readonly tipo: 'captcha' };

export interface OpcionesSituacionTributaria {
  /** Por defecto, un `TransporteUndici` propio. */
  readonly transporte?: TransporteHttp;
}

const CABECERAS = Object.freeze({
  'User-Agent': USER_AGENT_NAVEGADOR,
  Accept: 'application/json, text/plain, */*',
  Referer: PAGINA_STC,
});

/**
 * Historial de timbraje de cualquier RUT, sin representación ni certificado.
 *
 * Qué prueba: un tipo aparece solo cuando ya se le timbraron folios, así que 39 o 41
 * prueban que la empresa está autorizada para boletas (el SII no timbra folios de
 * producción de esos tipos sin autorización). Que falten no prueba nada (una
 * empresa recién certificada todavía no tiene timbrajes).
 *
 * Es frágil: el SII puede activar el captcha cuando quiera. Úsese como apoyo, nunca
 * como requisito.
 */
export class SituacionTributaria {
  readonly #transporte: TransporteHttp;

  constructor(opciones: OpcionesSituacionTributaria = {}) {
    this.#transporte = opciones.transporte ?? new TransporteUndici();
  }

  /**
   * @throws ErrorValidacion si el RUT no es válido (no sale nada al SII)
   * @throws ErrorVerificacion si una respuesta no tiene la forma conocida
   * @throws ErrorTransporte si falla la red o el SII responde un código distinto de 200
   */
  async timbrajes(rutContribuyente: string | Rut): Promise<ResultadoTimbrajes> {
    const rut =
      rutContribuyente instanceof Rut
        ? rutContribuyente
        : Rut.de(rutContribuyente, 'RUT del contribuyente');

    const clave = await this.#json('GET', URL_STC_RECAPTCHA);
    if (typeof clave.enable !== 'boolean') throw desconocida();
    if (clave.enable) return { tipo: 'captcha' };

    const datos = await this.#json('POST', URL_STC_CONSULTA, {
      rut: rut.numero,
      dv: rut.dv,
      reAction: 'consultaSTC',
      reToken: ' ',
    });
    if (typeof datos.captchaInvalido !== 'boolean') throw desconocida();
    if (datos.captchaInvalido) return { tipo: 'captcha' };
    if (!Array.isArray(datos.timbrajes)) throw desconocida();

    return { tipo: 'ok', timbrajes: datos.timbrajes.map(leerTimbraje) };
  }

  async #json(
    metodo: 'GET' | 'POST',
    url: string,
    cuerpo?: Readonly<Record<string, string>>,
  ): Promise<Record<string, unknown>> {
    const respuesta = await this.#transporte.enviar({
      metodo,
      url,
      cabeceras: cuerpo === undefined ? CABECERAS : { ...CABECERAS, Origin: HOST_STC },
      ...(cuerpo !== undefined
        ? {
            cuerpo: {
              tipo: 'crudo',
              datos: JSON.stringify(cuerpo),
              contentType: 'application/json',
            },
          }
        : {}),
      msRespuesta: MS_STC,
    });
    exigirStatus(respuesta, url, 200);
    let json: unknown;
    try {
      json = JSON.parse(respuesta.cuerpo.toString('utf8'));
    } catch {
      throw desconocida();
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) throw desconocida();
    return json as Record<string, unknown>;
  }
}

function desconocida(): ErrorVerificacion {
  return new ErrorVerificacion(
    'La consulta de situación tributaria del SII respondió con una forma que la librería no ' +
      'conoce. No se interpretó: revisa si el SII cambió la consulta.',
  );
}

/** `{ codigo: "0039", fechaTimbraje: "2026", folioFinal: "     5" }` → `{ 39, 2026, 5 }`. */
function leerTimbraje(entrada: unknown): TimbrajeStc {
  if (entrada === null || typeof entrada !== 'object') throw desconocida();
  const { codigo, fechaTimbraje, folioFinal } = entrada as Record<string, unknown>;
  if (
    typeof codigo !== 'string' ||
    typeof fechaTimbraje !== 'string' ||
    typeof folioFinal !== 'string'
  ) {
    throw desconocida();
  }
  const tipo = /^\s*(\d{1,4})\s*$/.exec(codigo);
  const anio = /^\s*(\d{4})\s*$/.exec(fechaTimbraje);
  const folio = /^\s*(\d{1,15})\s*$/.exec(folioFinal);
  if (tipo === null || anio === null || folio === null) throw desconocida();
  return {
    tipoDte: Number(tipo[1]),
    ultimoAnio: Number(anio[1]),
    folioFinal: Number(folio[1]),
  };
}
