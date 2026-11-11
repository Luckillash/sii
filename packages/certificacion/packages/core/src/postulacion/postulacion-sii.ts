// Deriva de winex/certificacion v1.9.1 (src/Postulacion/PostulacionSii.php y
// src/Postulacion/ResultadoPostulacion.php), © 2026 Meniaz (William Menares),
// Apache-2.0. Modificado: port a TypeScript.
//
// Lo que se envía al SII (URLs, cabeceras, campos, su orden y su codificación) es
// idéntico al PHP; lo comparan los casos `http-postulacion-*` con el servidor de
// captura (PLAN §5.3). Eso incluye dos rarezas del PHP que se replican a propósito:
// - el `<meta charset=iso-8859-1>` de una página hace que los valores con tildes
//   de sus formularios se reenvíen doblemente codificados (ver `comun/html.ts`); y
//   que la confirmación no calce si el SII repite ahí un valor con tildes
//   (caso `http-postulacion-meta-charset-confirma`);
// - los campos con nombre numérico (`name="7"`) se renumeran desde 0 al combinar
//   (las claves enteras de `array_merge`).
//
// Cambios respecto del PHP (ninguno cambia bytes enviados):
// - pend. 1.9: exige HTTP 200 en cada página. Antes de grabar, un código distinto o
//   una falla de red lanzan `ErrorTransporte` (el PHP no miraba el código y envolvía
//   la red en `PostulacionException`).
// - Desde el POST a `pe_graba_postulacion`, una falla de red o un código distinto
//   de 200 lanzan `ErrorPostulacion` (con la causa): la orden pudo llegar. Repetir
//   la postulación es seguro (vuelve a dejar la empresa en certificación con los
//   datos enviados), pero conviene revisar antes el portal. Ese POST va por una
//   conexión propia (`conexionNueva`, decisión de la fase 4).
// - pend. 2.2: navegación compartida (`NavegadorSii` sobre `comun/navegacion-sii.ts`).
// - pend. 2.3: los RUT vienen validados en `DatosPostulacion` (`Rut`).
// - El login es el de `SolicitudFolios` (fase 5): su `ErrorSolicitudFolios` se
//   entrega como `ErrorPostulacion`; las fallas de red, como `ErrorTransporte`.

import { aIso88591, trimPhp, truncarCodePoints } from '../comun/codificacion.ts';
import { ErrorPostulacion, ErrorSolicitudFolios, ErrorTransporte } from '../comun/errores.ts';
import type { TransporteHttp } from '../comun/http/transporte.ts';
import { TransporteUndici } from '../comun/http/transporte-undici.ts';
import { type Reloj, relojSistema } from '../comun/reloj.ts';
import type { Rut } from '../comun/rut.ts';
import type { Certificado } from '../core/certificado.ts';
import type { SesionSii } from '../folios/sesion-sii.ts';
import { SolicitudFolios } from '../folios/solicitud-folios.ts';
import type { DatosPostulacion } from './datos-postulacion.ts';
import {
  type CamposPostulacion,
  contieneSinMayusculas,
  ESPACIO_PCRE_UNICODE,
  type FormularioPostulacion,
  formularioPostulacion,
  NavegadorSii,
  textoPostulacion,
} from './navegador-sii.ts';

/** Host del asistente de postulación (certificación). */
export const HOST_POSTULACION = 'maullin.sii.cl';

/** Tope de cada paso, en ms (PHP: 70 s). */
export const MS_POSTULACION = 70_000;

/** Textos que delatan que el SII rechazó el paso (se buscan en el texto ya decodificado). */
const MARCADORES_ERROR = [
  'El código de este mensaje es',
  'no está autorizado',
  'no es representante',
  'No ha sido posible completar su solicitud',
  'Usted no tiene',
];

/** Campos del formulario de datos que no se reenvían (factura no se postula desde aquí). */
const CAMPOS_EXCLUIDOS = [
  'ESFAC',
  'FACT',
  'NC',
  'ND',
  'SET03',
  'SET06',
  'SET11',
  'SET84',
  'SET72',
  'BOLEXEN',
];

/** Vueltas por páginas de aviso antes de rendirse (el PHP: 3 avisos como máximo). */
const MAX_AVISOS = 3;

const AVISO = new RegExp(
  `Sr\\. Contribuyente:${ESPACIO_PCRE_UNICODE}*([^\\n]+?)(?:Continuar|Salir|$)`,
  'u',
);

export interface ResultadoPostulacion {
  readonly empresa: Rut;
  /**
   * Páginas de aviso que el SII mostró y que se pasaron con "Continuar" (p. ej.
   * que la empresa dejará de ser usuaria del facturador gratuito del SII al
   * autorizarse). Hay que mostrárselas al usuario.
   */
  readonly avisos: readonly string[];
  /** Texto de la página final del SII (hasta 600 caracteres). */
  readonly mensaje: string;
}

export interface OpcionesPostulacionSii {
  /** Por defecto, un `TransporteUndici` propio. */
  readonly transporte?: TransporteHttp;
  /** Para la expiración de las cookies de la sesión que entrega `autenticar`. */
  readonly reloj?: Reloj;
}

// --- arreglos de PHP ---------------------------------------------------------------

/** Si PHP guarda esa clave de arreglo como entero (`"7"` sí; `"07"`, `"-0"` o `" 7"` no). */
function esClaveEntera(clave: string): boolean {
  if (!/^(?:0|-?[1-9][0-9]*)$/.test(clave)) return false;
  const n = BigInt(clave);
  return n >= -(2n ** 63n) && n < 2n ** 63n;
}

/**
 * `array_merge($a, $b)`: las claves de texto de `b` reemplazan en su lugar a las de
 * `a` (gana la derecha) y las nuevas van al final; las claves enteras de los dos se
 * renumeran desde 0, en orden.
 */
export function combinarComoArrayMerge(
  a: Iterable<readonly [string, string]>,
  b: Iterable<readonly [string, string]>,
): CamposPostulacion {
  const salida: CamposPostulacion = new Map();
  let siguiente = 0;
  for (const lista of [a, b]) {
    for (const [clave, valor] of lista) {
      if (esClaveEntera(clave)) salida.set(String(siguiente++), valor);
      else salida.set(clave, valor);
    }
  }
  return salida;
}

/** `$a + $b`: agrega de `b` solo las claves que `a` no tiene (gana la izquierda). */
function unir(
  a: Iterable<readonly [string, string]>,
  b: Iterable<readonly [string, string]>,
): CamposPostulacion {
  const salida: CamposPostulacion = new Map(a);
  for (const [clave, valor] of b) if (!salida.has(clave)) salida.set(clave, valor);
  return salida;
}

/** `var_export($valor, true)` de un string o null. */
function varExport(valor: string | null): string {
  return valor === null ? 'NULL' : `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `strcasecmp($a, $b) === 0`: igualdad sin distinguir mayúsculas, solo en ASCII. */
function igualesSinMayusculasAscii(a: string, b: string): boolean {
  const ascii = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
  return ascii(a) === ascii(b);
}

/**
 * Postula una empresa a boleta electrónica en el ambiente de certificación
 * (maullin), replicando el asistente `cvc_cgi/dte/pe_*`:
 *
 *   1. POST pe_ingrut             → aceptar condiciones, pide el RUT
 *   2. POST pe_datos_empresa      → 0..3 páginas de aviso ("Continuar") y el formulario
 *   3. POST pe_confirma           → pantalla de confirmación (el SII repite los datos)
 *   4. POST pe_graba_postulacion  → * GRABA la postulación *
 *
 * La postulación se puede repetir (vuelve a dejar la empresa en certificación con
 * los datos nuevos). El usuario autenticado tiene que ser representante legal.
 *
 * Candados: todo va a maullin.sii.cl por https (cada redirección se revisa antes de
 * seguirla), y antes de grabar se revisa que la confirmación del SII traiga
 * exactamente los datos enviados.
 */
export class PostulacionSii {
  readonly #transporte: TransporteHttp;
  readonly #reloj: Reloj;
  readonly #navegador: NavegadorSii;

  constructor(opciones: OpcionesPostulacionSii = {}) {
    this.#transporte = opciones.transporte ?? new TransporteUndici();
    this.#reloj = opciones.reloj ?? relojSistema;
    this.#navegador = new NavegadorSii(this.#transporte, HOST_POSTULACION);
  }

  /**
   * Login AUT2000 con el certificado (el mismo de la solicitud de folios, con la
   * URL de vuelta de maullin). La sesión sirve también para `DeclaracionBoletas`.
   *
   * @throws ErrorPostulacion si el SII no aceptó el certificado o el login salió de sii.cl
   * @throws ErrorTransporte si falla la red o el SII responde un código inesperado
   */
  async autenticar(certificado: Certificado): Promise<SesionSii> {
    const folios = new SolicitudFolios({
      ambiente: 'certificacion',
      transporte: this.#transporte,
      reloj: this.#reloj,
    });
    try {
      return await folios.autenticar(certificado);
    } catch (error) {
      if (error instanceof ErrorSolicitudFolios) {
        throw new ErrorPostulacion(error.message, { cause: error });
      }
      throw error;
    }
  }

  /**
   * @throws SesionCaducaError si la sesión ya no sirve (hay que volver a autenticar)
   * @throws ErrorPostulacion si el SII rechazó un paso, no llegó a donde se esperaba,
   *   la confirmación no calza con lo enviado (se detiene SIN grabar), no confirmó la
   *   postulación, o la orden de grabar salió y no llegó respuesta
   * @throws ErrorTransporte si falla la red o el SII responde un código distinto de
   *   200 antes de grabar (se puede reintentar)
   */
  async postular(sesion: SesionSii, datos: DatosPostulacion): Promise<ResultadoPostulacion> {
    const base = `https://${HOST_POSTULACION}/cvc_cgi/dte`;
    const condiciones = `https://${HOST_POSTULACION}/cvc/dte/pe_condiciones.html`;

    // 1. Aceptar condiciones.
    let html = await this.#navegador.pagina(sesion, {
      metodo: 'POST',
      url: `${base}/pe_ingrut`,
      formulario: [['ACEPTAR', 'Aceptar Condiciones']],
      referer: condiciones,
      msRespuesta: MS_POSTULACION,
    });
    let form = this.#formHacia(
      html,
      'pe_datos_empresa',
      'El SII no mostró el formulario del RUT de la empresa.',
    );

    // 2. RUT de la empresa → avisos → formulario de datos.
    html = await this.#enviar(
      sesion,
      base,
      form,
      [
        ['RUT_EMP', datos.empresa.numero],
        ['DV_EMP', datos.empresa.dv],
      ],
      `${base}/pe_ingrut`,
    );
    let referer = `${base}/pe_datos_empresa`;

    const avisos: string[] = [];
    for (let i = 0; ; i++) {
      const actual = formularioPostulacion(html);
      if (actual?.action.includes('pe_confirma')) {
        form = actual;
        break;
      }
      if (i >= MAX_AVISOS || actual === null || !actual.action.includes('pe_datos_empresa')) {
        throw new ErrorPostulacion(
          `El SII no llegó al formulario de postulación. ${this.#mensaje(html)}`.trimEnd(),
        );
      }

      // Página de aviso (p. ej. "perderá su calidad de usuario del facturador
      // gratuito"): se informa y se sigue, como hace el usuario en el portal.
      avisos.push(this.#aviso(html));
      html = await this.#enviar(sesion, base, actual, [['ACEPTAR', 'Continuar']], referer);
    }

    // 3. Datos. Se parte de lo que manda el SII (hidden) y se fijan los campos
    // propios; factura queda sin marcar.
    const valores: [string, string][] = [
      ['RUT_USU', datos.administrador.numero],
      ['DV_USU', datos.administrador.dv],
      ['MAIL_SUP', datos.correoAdministrador],
      ['MAIL_SII', datos.correoContactoSii],
      ['MAIL_DTE', datos.correoIntercambio],
      ['URL', datos.url],
      ['NOM_SW', datos.nombreSoftware],
      ['ESBOL', 'S'],
      ['BOLELEC', 'S'],
    ];
    if (datos.boletaExenta) valores.push(['BOLEXEN', 'S']);

    const inputs = new Map(form.inputs);
    for (const campo of CAMPOS_EXCLUIDOS) inputs.delete(campo);
    html = await this.#enviar(
      sesion,
      base,
      { action: form.action, inputs },
      unir(valores, [['GRABAR', 'Confirmar Datos']]),
      referer,
    );
    referer = `${base}/pe_confirma`;

    // 4. Confirmación: el SII repite los datos en hidden. Tienen que ser los
    // enviados antes de grabar.
    const confirma = this.#formHacia(
      html,
      'pe_graba_postulacion',
      'El SII no mostró la confirmación de la postulación.',
    );
    const esperado: [string, string | null][] = [
      ['RUT_EMP', datos.empresa.numero],
      ['DV_EMP', datos.empresa.dv],
      ['RUT_USU', datos.administrador.numero],
      ['DV_USU', datos.administrador.dv],
      ['MAIL_SUP', datos.correoAdministrador],
      ['MAIL_SII', datos.correoContactoSii],
      ['MAIL_DTE', datos.correoIntercambio],
      ['NOM_SW', datos.nombreSoftware],
      ['ESBOL', 'S'],
      ['BOLELEC', 'S'],
      ['BOLEXEN', datos.boletaExenta ? 'S' : null],
      ['ESFAC', 'N'],
    ];
    for (const [campo, valor] of esperado) {
      const recibido = confirma.inputs.get(campo) ?? null;
      const calza =
        valor === null
          ? recibido === null || recibido === '' || recibido === 'N'
          : igualesSinMayusculasAscii(recibido ?? '', valor);
      if (!calza) {
        throw new ErrorPostulacion(
          `Postulación detenida antes de grabar: la confirmación del SII trae ${campo}=${varExport(recibido)}, distinto de lo enviado.`,
        );
      }
    }

    // ** Esto graba la postulación. ** El host del `action` se revisa antes de
    // enviar (NavegadorSii): si corta ahí, no salió nada.
    try {
      html = await this.#enviar(
        sesion,
        base,
        confirma,
        [['CONF', 'Confirmar Postulación']],
        referer,
        true,
      );
    } catch (error) {
      if (error instanceof ErrorTransporte) {
        throw new ErrorPostulacion(
          `La orden de grabar la postulación de ${datos.empresa} salió hacia el SII, pero no llegó una respuesta válida (${error.message}): no se sabe si quedó grabada. ` +
            'Revisa el estado en el portal; repetir la postulación es seguro (la deja en certificación con estos mismos datos).',
          { cause: error },
        );
      }
      throw error;
    }

    if (
      !contieneSinMayusculas(textoPostulacion(html, Number.POSITIVE_INFINITY), 'ha sido aceptada')
    ) {
      throw new ErrorPostulacion(
        `El SII no confirmó la postulación. ${this.#mensaje(html)}`.trimEnd(),
      );
    }

    return { empresa: datos.empresa, avisos, mensaje: textoPostulacion(html, 600) };
  }

  /**
   * POST del formulario con sus campos + `valores` (`array_merge`), cada valor en
   * ISO-8859-1 como `mb_convert_encoding` (`?` para lo que no cabe): el SII espera
   * ISO-8859-1 (p. ej. "Confirmar Postulación" con tilde). Los nombres van tal cual
   * (UTF-8), como en el PHP.
   *
   * @throws ErrorPostulacion si la página trae un marcador de rechazo del SII
   */
  async #enviar(
    sesion: SesionSii,
    base: string,
    form: FormularioPostulacion,
    valores: Iterable<readonly [string, string]>,
    referer: string,
    conexionNueva = false,
  ): Promise<string> {
    const campos = [...combinarComoArrayMerge(form.inputs, valores)].map(
      ([clave, valor]) => [clave, aIso88591(valor)] as const,
    );

    const html = await this.#navegador.pagina(sesion, {
      metodo: 'POST',
      url: NavegadorSii.resolverUrl(`${base}/`, form.action),
      formulario: campos,
      referer,
      msRespuesta: MS_POSTULACION,
      ...(conexionNueva ? { conexionNueva: true } : {}),
    });

    // Sobre el texto ya decodificado: el SII escribe las tildes como entidades.
    const texto = textoPostulacion(html, Number.POSITIVE_INFINITY);
    if (MARCADORES_ERROR.some((marcador) => contieneSinMayusculas(texto, marcador))) {
      throw new ErrorPostulacion(`El SII rechazó la postulación. ${this.#mensaje(html)}`.trimEnd());
    }
    return html;
  }

  #formHacia(html: string, accion: string, error: string): FormularioPostulacion {
    const form = formularioPostulacion(html);
    if (form === null || !form.action.includes(accion)) {
      throw new ErrorPostulacion(`${error} ${this.#mensaje(html)}`.trimEnd());
    }
    return form;
  }

  #aviso(html: string): string {
    const texto = textoPostulacion(html, 2000);
    const m = AVISO.exec(texto);
    if (m !== null) return trimPhp(m[1] as string);
    return truncarCodePoints(texto, 400);
  }

  #mensaje(html: string): string {
    const texto = textoPostulacion(html);
    return texto === '' ? '' : `(SII: ${texto})`;
  }
}
