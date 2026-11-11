// Deriva de winex/certificacion v1.9.1 (src/Core/Timbre.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// hora inyectable, datos tipados, el CAF se recibe como contenido (no como ruta)
// y la llave del CAF se valida al construir.

import { createPrivateKey, type KeyObject, sign } from 'node:crypto';
import {
  aIso88591,
  decodificarUtf8OIso,
  escaparXml,
  truncarCodePoints,
} from '../comun/codificacion.ts';
import { ErrorTimbre, ErrorValidacion } from '../comun/errores.ts';
import { fechaHoraSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import { parsearDocumento } from '../comun/xml.ts';

/**
 * Datos del documento que van en el `<DD>` del TED. Equivale al array de
 * `Timbre::generarTed()` del PHP (`rut_emisor`, `tipo_dte`, ...).
 *
 * Los campos se insertan tal cual (sin escapar, como el PHP), salvo
 * `razonSocialReceptor` y `nombreItem1`, que se escapan para XML. Los números se
 * escriben en decimal, como la interpolación de un `int` en PHP.
 */
export interface DatosTed {
  /** `<RE>`: RUT del emisor con guion y DV (`76123456-0`). */
  rutEmisor: string;
  /** `<TD>`: tipo de documento (39 boleta afecta, 41 exenta...). */
  tipoDte: string | number;
  /** `<F>`: folio. */
  folio: string | number;
  /** `<FE>`: fecha de emisión `YYYY-MM-DD`. */
  fecha: string;
  /** `<RR>`: RUT del receptor (`66666666-6` para boletas sin receptor identificado). */
  rutReceptor: string;
  /** `<RSR>`: razón social del receptor. Se escapa; no se trunca (igual que el PHP). */
  razonSocialReceptor: string;
  /** `<MNT>`: monto total. */
  montoTotal: string | number;
  /** `<IT1>`: nombre del primer ítem. Se trunca a 40 caracteres y se escapa. */
  nombreItem1: string;
}

export interface OpcionesTimbre {
  /** Reloj para el `<TSTED>` (hora de Chile). Por defecto, el del sistema. */
  reloj?: Reloj;
}

/** Blancos de `\s` en PCRE sin `/u` (locale C): espacio, \t, \n, VT, FF y \r. Nada más. */
const BLANCOS_ENTRE_ETIQUETAS = />[ \t\n\v\f\r]+</g;
/** Lo que quita `trim()` de PHP: espacio, \t, \n, \r, NUL y VT (no FF). */
const TRIM_PHP = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;
const ENCABEZADOS_RSASK = ['-----BEGIN RSA PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----'];

/**
 * Timbre electrónico (TED) firmado con la llave privada del CAF.
 *
 * ```ts
 * const timbre = new Timbre(readFileSync('caf.xml'));
 * const ted = timbre.generarTed({ rutEmisor: '76123456-0', tipoDte: 39, ... });
 * ```
 */
export class Timbre {
  /** Bloque `<CAF>…</CAF>` tal como viene en el archivo (con sus blancos). */
  readonly #caf: string;
  readonly #llave: KeyObject;
  readonly #reloj: Reloj;

  /**
   * @param caf contenido del XML del CAF que entrega el SII. Como `Buffer` se
   *   acepta en UTF-8 o en ISO-8859-1 aunque el prólogo no lo declare (algunos
   *   CAF traen así las tildes de la razón social). Un `string` ya es texto.
   * @throws {ErrorTimbre} si el XML no es válido, no trae `<CAF>` o `<RSASK>`, o
   *   la llave no es una RSA legible.
   */
  constructor(caf: Uint8Array | string, opciones: OpcionesTimbre = {}) {
    this.#reloj = opciones.reloj ?? relojSistema;

    // Igual que el PHP: si los bytes no son UTF-8 válido, son ISO-8859-1.
    const contenido = typeof caf === 'string' ? caf : decodificarUtf8OIso(caf);

    // El bloque <CAF> se toma tal cual del original, no reserializado: lleva la
    // <FRMA> que el SII calculó sobre su propio <DA>. Los blancos se aplanan
    // después, junto con el resto del <DD>.
    const bloque = /<CAF\b[\s\S]*?<\/CAF>/.exec(contenido);
    if (bloque === null) throw new ErrorTimbre('El XML no contiene el nodo <CAF>.');
    this.#caf = bloque[0];

    let doc: Document;
    try {
      doc = parsearDocumento(contenido);
    } catch (error) {
      throw new ErrorTimbre('El CAF no es un XML válido.', { cause: error });
    }

    const rsask = doc.getElementsByTagName('RSASK').item(0);
    if (rsask === null) {
      throw new ErrorTimbre('El CAF no contiene el nodo <RSASK> (llave privada del timbre).');
    }
    this.#llave = llaveDelCaf(rsask.textContent ?? '');
  }

  /**
   * Genera el `<TED>` firmado, en bytes ISO-8859-1 (los mismos que el PHP).
   *
   * El `<DD>` se aplana (sin blancos entre etiquetas) y se pasa a ISO-8859-1
   * antes de firmar, porque el SII verifica la `<FRMT>` sobre esos bytes: con
   * blancos responde el reparo 510 y con tildes en UTF-8, RFR. Los caracteres
   * fuera de ISO-8859-1 quedan como `?`.
   *
   * Para insertarlo en un DTE en ISO-8859-1, se concatenan los bytes. Si se
   * necesita como texto, `desdeIso88591(ted)` da un string que vuelve a estos
   * mismos bytes con `aIso88591` (todos sus caracteres son ≤ U+00FF).
   *
   * @throws {ErrorValidacion} si un campo numérico no es un entero seguro.
   * @throws {ErrorTimbre} si falla la firma.
   */
  generarTed(datos: DatosTed): Buffer {
    const it1 = escaparXml(truncarCodePoints(datos.nombreItem1, 40), 'xml1-sustituir');
    const rsr = escaparXml(datos.razonSocialReceptor, 'xml1-sustituir');

    const dd =
      '<DD>' +
      `<RE>${datos.rutEmisor}</RE>` +
      `<TD>${entero(datos.tipoDte, 'tipoDte')}</TD>` +
      `<F>${entero(datos.folio, 'folio')}</F>` +
      `<FE>${datos.fecha}</FE>` +
      `<RR>${datos.rutReceptor}</RR>` +
      `<RSR>${rsr}</RSR>` +
      `<MNT>${entero(datos.montoTotal, 'montoTotal')}</MNT>` +
      `<IT1>${it1}</IT1>` +
      this.#caf +
      `<TSTED>${fechaHoraSii(this.#reloj.ahora())}</TSTED>` +
      '</DD>';

    const bytes = aIso88591(aplanar(dd));

    let firma: Buffer;
    try {
      firma = sign('sha1', bytes, this.#llave);
    } catch (error) {
      throw new ErrorTimbre('Falló la firma del TED.', { cause: error });
    }

    return Buffer.concat([
      Buffer.from('<TED version="1.0">', 'latin1'),
      bytes,
      Buffer.from(
        `<FRMT algoritmo="SHA1withRSA">${firma.toString('base64')}</FRMT></TED>`,
        'latin1',
      ),
    ]);
  }
}

/**
 * `preg_replace('/>\s+</', '><', trim($xml))`: el SII elimina los blancos entre
 * etiquetas antes de verificar la firma del TED (y la del propio CAF).
 */
function aplanar(xml: string): string {
  return xml.replace(TRIM_PHP, '').replace(BLANCOS_ENTRE_ETIQUETAS, '><');
}

/**
 * Reconstruye el PEM de la `<RSASK>` como el PHP (quita encabezados y blancos y
 * corta en líneas de 64) y lo carga.
 */
function llaveDelCaf(rsask: string): KeyObject {
  let cuerpo = rsask;
  for (const encabezado of ENCABEZADOS_RSASK) cuerpo = cuerpo.replaceAll(encabezado, '');
  cuerpo = cuerpo.replace(/[\r\n \t]/g, '');
  const lineas = cuerpo.match(/[\s\S]{1,64}/g) ?? [];
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${lineas.join('\n')}\n-----END RSA PRIVATE KEY-----`;

  let llave: KeyObject;
  try {
    llave = createPrivateKey(pem);
  } catch (error) {
    throw new ErrorTimbre('La llave privada del CAF (<RSASK>) no se pudo leer.', { cause: error });
  }
  if (llave.asymmetricKeyType !== 'rsa') {
    throw new ErrorTimbre('La llave privada del CAF (<RSASK>) no es RSA.');
  }
  return llave;
}

function entero(valor: string | number, campo: string): string {
  if (typeof valor === 'string') return valor;
  if (!Number.isSafeInteger(valor)) {
    throw new ErrorValidacion(`${campo} debe ser un número entero (se recibió ${valor}).`);
  }
  return String(valor);
}
