// Deriva de winex/certificacion v1.9.1 (src/Core/EnvioBoleta.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// hora inyectable, datos tipados y los DTE también se aceptan como arreglo.
//
// Arma el sobre EnvioBOLETA con los DTE ya firmados y lo firma sobre `#SetDoc`.
// La salida es byte a byte la del PHP (golden tests paridad/casos/envio-boleta-*).
// Única divergencia (decisión del usuario, 2026-11-06): sin ningún DTE, error.
//
// El PHP trabaja con strings de bytes: concatena los DTE firmados (ISO-8859-1)
// tal cual con el literal del sobre y le pasa el resultado a firmarDte(), que lo
// lee según su declaración (ISO-8859-1). Aquí se hace lo mismo con strings
// "binarios" (un carácter por byte, 0–255, vía `latin1`) para no reinterpretar
// codificaciones en el camino.

import { ErrorValidacion } from '../comun/errores.ts';
import { fechaHoraSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import type { FirmaElectronica } from './firma-electronica.ts';

/** Datos de la `<Caratula>` del sobre. Equivalen a los argumentos del constructor del PHP. */
export interface DatosEnvioBoleta {
  /** `<RutEmisor>`: RUT de la empresa (`76123456-0`). */
  rutEmisor: string;
  /** `<RutEnvia>`: RUT de la persona dueña del certificado que firma. */
  rutEnvia: string;
  /** `<NroResol>`: número de resolución (`0` en certificación). */
  nroResol: string | number;
  /** `<FchResol>`: fecha de resolución `YYYY-MM-DD`. */
  fchResol: string;
}

export interface OpcionesEnvioBoleta {
  /** Reloj para el `<TmstFirmaEnv>` (hora de Chile). Por defecto, el del sistema. */
  reloj?: Reloj;
}

/**
 * Declaraciones XML de los DTE. Igual que `/<\?xml.*?\?>/i` de PCRE sin `/s`:
 * el `.` de PCRE no cruza `\n` pero sí `\r` (y cualquier otro byte), así que se
 * usa `[^\n]` (el `.` de JS tampoco cruzaría `\r`).
 */
const DECLARACION_XML = /<\?xml[^\n]*?\?>/gi;
/** `/<TipoDTE>(\d+)<\/TipoDTE>/`: `\d` de PCRE sin `/u` es solo ASCII, como en JS. */
const TIPO_DTE = /<TipoDTE>([0-9]+)<\/TipoDTE>/g;
/** Caracteres que no caben en un byte ISO-8859-1. */
const FUERA_DE_ISO = /[\u{100}-\u{10FFFF}]/u;

/**
 * Sobre `EnvioBOLETA` firmado.
 *
 * ```ts
 * const envio = new EnvioBoleta(firmador, {
 *   rutEmisor: '76123456-0', rutEnvia: '11111111-1', nroResol: 0, fchResol: '2026-09-04',
 * });
 * const sobre = envio.empaquetar([dte1, dte2]); // Buffer ISO-8859-1 listo para el SII
 * ```
 */
export class EnvioBoleta {
  readonly #firmador: FirmaElectronica;
  readonly #datos: DatosEnvioBoleta;
  readonly #reloj: Reloj;

  constructor(
    firmador: FirmaElectronica,
    datos: DatosEnvioBoleta,
    opciones: OpcionesEnvioBoleta = {},
  ) {
    this.#firmador = firmador;
    this.#datos = { ...datos };
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * Empaqueta los DTE firmados en el `<SetDTE ID="SetDoc">` y firma el sobre
   * con `firmarDte(..., '#SetDoc')`.
   *
   * Como el PHP:
   *
   * - quita TODAS las declaraciones `<?xml ...?>` (sin distinguir mayúsculas; una
   *   declaración partida por un `\n` no se quita). El salto de línea que seguía
   *   a cada una queda;
   * - cuenta los `<TipoDTE>` y escribe un `<SubTotDTE>` por tipo, en el orden en
   *   que aparece cada tipo por primera vez;
   * - los DTE van tal cual (bytes) dentro del `<SetDTE>`, y los datos de la
   *   carátula se insertan sin escapar.
   *
   * @param dtesFirmados los DTE firmados (salidas de `FirmaElectronica.firmarDte`):
   *   - `Buffer`: bytes exactos (lo normal: ISO-8859-1, como los entrega `firmarDte`).
   *   - `string`: texto Unicode; se pasa a ISO-8859-1, la codificación del sobre,
   *     sin importar lo que declare el DTE.
   *   - arreglo: cada elemento (Buffer o string, con las reglas anteriores) seguido
   *     de `\n`. Equivale al `$dtesFirmados .= firmarDte(...) . "\n"` del bin
   *     `enviar-set-boletas.php` del PHP. Un `Buffer` o `string` suelto va tal cual,
   *     sin agregar nada.
   * @returns el sobre firmado en bytes ISO-8859-1, sin salto de línea final.
   * @throws {ErrorValidacion} si un `string` tiene caracteres fuera de ISO-8859-1
   *   (en el sobre irían como `&#N;`: escápelos o pase los bytes), o si no hay
   *   ningún DTE: lista vacía o contenido sin ningún `<TipoDTE>N</TipoDTE>` (el
   *   PHP armaba un sobre que no valida contra el XSD; aquí es un error).
   * @throws {ErrorFirma} si el sobre resultante no es XML válido (p. ej. una
   *   declaración que no se quitó) o la firma falla.
   */
  empaquetar(
    dtesFirmados: Buffer | Uint8Array | string | readonly (Buffer | Uint8Array | string)[],
  ): Buffer {
    const entrada = esLista(dtesFirmados)
      ? dtesFirmados.map((dte) => `${binarioDte(dte)}\n`).join('')
      : binarioDte(dtesFirmados);
    const dtes = entrada.replace(DECLARACION_XML, '');

    // Map y no objeto: un objeto JS ordena las claves numéricas ("41" antes que
    // "39" quedaría al revés); el array PHP conserva el orden de inserción.
    const tipos = new Map<string, number>();
    for (const [, tipo = ''] of dtes.matchAll(TIPO_DTE)) {
      tipos.set(tipo, (tipos.get(tipo) ?? 0) + 1);
    }

    // Decisión del usuario (2026-11-06): sin ningún DTE no se arma el sobre. El
    // PHP lo armaba y firmaba igual, sin SubTotDTE ni DTE, y el XSD exige al
    // menos uno de cada uno: el SII lo rechazaría. "Hay DTE" es que aparece al
    // menos un `<TipoDTE>N</TipoDTE>`, el mismo patrón con que se cuentan los
    // SubTotDTE (sin él no habría ninguno).
    if (tipos.size === 0) {
      throw new ErrorValidacion(
        'No hay DTE que empaquetar: el sobre EnvioBOLETA exige al menos un DTE (con su <TipoDTE>).',
      );
    }

    let subTotales = '';
    for (const [tipo, cantidad] of tipos) {
      subTotales += `<SubTotDTE>\n<TpoDTE>${tipo}</TpoDTE>\n<NroDTE>${cantidad}</NroDTE>\n</SubTotDTE>\n`;
    }

    const tmstFirmaEnv = fechaHoraSii(this.#reloj.ahora());
    const d = this.#datos;

    // El sobre cambia a EnvioBOLETA y la Caratula a versión 2.0 (comentario del PHP;
    // el literal dice version="1.0" y así se conserva).
    const sobre =
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n' +
      '<EnvioBOLETA xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioBOLETA_v11.xsd" version="1.0">\n' +
      '<SetDTE ID="SetDoc">\n' +
      '<Caratula version="1.0">\n' +
      `<RutEmisor>${binarioDato(d.rutEmisor)}</RutEmisor>\n` +
      `<RutEnvia>${binarioDato(d.rutEnvia)}</RutEnvia>\n` +
      '<RutReceptor>60803000-K</RutReceptor>\n' +
      `<FchResol>${binarioDato(d.fchResol)}</FchResol>\n` +
      `<NroResol>${binarioDato(d.nroResol)}</NroResol>\n` +
      `<TmstFirmaEnv>${tmstFirmaEnv}</TmstFirmaEnv>\n` +
      `${subTotales}</Caratula>\n` +
      `${dtes}</SetDTE>\n` +
      '</EnvioBOLETA>';

    return this.#firmador.firmarDte(Buffer.from(sobre, 'latin1'), '#SetDoc');
  }
}

function esLista<T>(valor: T | readonly T[]): valor is readonly T[] {
  return Array.isArray(valor);
}

/** Un DTE como string binario: los bytes de un Buffer, o el texto en ISO-8859-1. */
function binarioDte(dte: Buffer | Uint8Array | string): string {
  if (typeof dte !== 'string') {
    return Buffer.from(dte.buffer, dte.byteOffset, dte.byteLength).toString('latin1');
  }
  if (FUERA_DE_ISO.test(dte)) {
    throw new ErrorValidacion(
      'Un DTE (string) tiene caracteres fuera de ISO-8859-1: páselo como Buffer o escápelos como &#N;.',
    );
  }
  return dte;
}

/**
 * Un dato de la carátula como string binario. En el PHP son strings UTF-8 que se
 * concatenan tal cual dentro de un sobre ISO-8859-1: se replican esos bytes
 * (un dato no ASCII saldría con mojibake, igual que en el PHP). Los números se
 * escriben en decimal, como la concatenación de un `int` en PHP.
 */
function binarioDato(valor: string | number): string {
  return Buffer.from(String(valor), 'utf8').toString('latin1');
}
