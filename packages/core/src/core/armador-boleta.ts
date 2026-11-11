// Deriva de winex/certificacion v1.9.1 (bin/certificacion/enviar-set-boletas.php,
// el bucle que arma cada DTE), © 2026 Meniaz (William Menares), Apache-2.0.
// Modificado: el armado pasa de los scripts a la librería (pend. 2.5), con un
// solo reloj para todas las marcas, validación del CAF contra la boleta y
// razón social del receptor obligatoria (decisión del usuario, 2026-11-06).
//
// La salida es byte a byte la del bin (golden tests paridad/casos/armar-boleta-*
// y set-completo).

import { decodificarUtf8OIso } from '../comun/codificacion.ts';
import { ErrorTimbre, ErrorValidacion } from '../comun/errores.ts';
import { fechaHoraSii, fechaSii, type Reloj, relojFijo, relojSistema } from '../comun/reloj.ts';
import { parsearDocumento } from '../comun/xml.ts';
import type { FirmaElectronica } from './firma-electronica.ts';
import { type DatosBoleta, GeneradorBoleta } from './generador-boleta.ts';
import { Timbre } from './timbre.ts';

export interface OpcionesArmadorBoleta {
  /**
   * Reloj para TODAS las marcas de la boleta: `<FchEmis>`, la `<FE>` y el
   * `<TSTED>` del TED y el `<TmstFirma>`. Se lee una sola vez por boleta. Por
   * defecto, el del sistema.
   */
  reloj?: Reloj;
}

/** Lo que el armador lee del `<DA>` del CAF para validar la boleta. */
interface DatosCaf {
  rutEmisor: string;
  tipoDte: number;
  desde: number;
  hasta: number;
}

const ENTERO = /^[0-9]+$/;

/**
 * Arma el DTE de una boleta listo para el sobre: genera el XML, lo timbra con
 * el CAF, agrega el TED y el `<TmstFirma>` y lo firma. Es lo que hace con cada
 * caso el bin `enviar-set-boletas.php` del PHP, con los mismos bytes.
 *
 * ```ts
 * const armador = new ArmadorBoleta(firmador);
 * const dtes = casos.map((caso, i) => armador.armar({ ...datos, folio: 56 + i }, caf));
 * const sobre = new EnvioBoleta(firmador, caratula).empaquetar(dtes);
 * ```
 *
 * **Un solo reloj.** El armador recibe el contenido del CAF y no un `Timbre` ya
 * construido, porque el reloj de un `Timbre` ajeno no se puede comprobar. En
 * cada llamada lee la hora una vez y construye el `GeneradorBoleta` y el
 * `Timbre` con un reloj detenido en ese instante: `<FchEmis>`, la `<FE>` y el
 * `<TSTED>` del TED y el `<TmstFirma>` siempre coinciden. En el PHP cada marca
 * es un `date()` aparte: una boleta armada justo a medianoche puede quedar con
 * `<FchEmis>` y `<FE>` en días distintos. Con la hora fija, los bytes son los
 * mismos que los del PHP.
 *
 * El costo es leer el CAF (XML y llave) en cada boleta: menos de un
 * milisegundo con las llaves de 512 bits de los CAF del SII.
 */
export class ArmadorBoleta {
  readonly #firmador: FirmaElectronica;
  readonly #reloj: Reloj;

  constructor(firmador: FirmaElectronica, opciones: OpcionesArmadorBoleta = {}) {
    this.#firmador = firmador;
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * Arma y firma el DTE de una boleta.
   *
   * Pasos (los del bin):
   *
   * 1. `GeneradorBoleta.generarBoleta(datos)`.
   * 2. Lee del XML generado el `<MntTotal>` y el primer `<NmbItem>` (texto ya
   *    des-escapado). El monto NO se recalcula: va tal cual lo escribió el
   *    generador.
   * 3. `Timbre.generarTed` con el RUT del emisor, el tipo, el folio, la fecha de
   *    emisión, el RUT y la razón social del receptor (la de `datos`, sin
   *    escapar: la escapa el TED), el monto y el ítem.
   * 4. Reemplaza `</Documento>` por `TED + "\n<TmstFirma>…</TmstFirma>\n</Documento>"`
   *    sobre los bytes ISO-8859-1.
   * 5. `FirmaElectronica.firmarDte(xml, '#F{folio}T{tipo}')`.
   *
   * **Exige `receptor.razonSocial`** (no vacía ni solo de blancos), aunque
   * `GeneradorBoleta` la acepte opcional. Sin ella el PHP firmaba el TED con
   * `<RSR></RSR>` y, como `firmarDte` reserializa como `saveXML()`, el DTE
   * quedaba con `<RSR/>`: una combinación que nunca se probó en el SII (el bin
   * siempre manda `Cliente General`). Para boletas sin receptor identificado,
   * use `Cliente General`.
   *
   * @param datos los datos de la boleta (los mismos de `GeneradorBoleta`).
   * @param caf contenido del XML del CAF que entrega el SII (como `Buffer`, en
   *   UTF-8 o ISO-8859-1, igual que `Timbre`).
   * @returns el DTE firmado en bytes ISO-8859-1, sin salto de línea final (como
   *   `firmarDte`). Para el sobre, se pasa en un arreglo a
   *   `EnvioBoleta.empaquetar`, que agrega el `\n` que agrega el bin.
   * @throws {ErrorValidacion} si el receptor no trae razón social (o es vacía o
   *   solo de blancos), los datos son inválidos (ver `GeneradorBoleta`), el CAF
   *   es de otro emisor o de otro tipo de documento, o el folio está fuera del
   *   rango autorizado.
   * @throws {ErrorTimbre} si el CAF no es un XML válido, no trae `<DA>` con
   *   `<RE>`, `<TD>` y `<RNG>`, o su llave no se puede leer.
   * @throws {ErrorFirma} si la firma falla.
   */
  armar(datos: DatosBoleta, caf: Uint8Array | string): Buffer {
    // Decisión del usuario (2026-11-06): sin razón social del receptor no se
    // arma la boleta (el TED quedaría firmado con <RSR></RSR> y el DTE con
    // <RSR/>, nunca probado en el SII). GeneradorBoleta no cambia: la sigue
    // aceptando opcional, por paridad con el PHP. "Blancos" son los de trim().
    const razonSocial: unknown = datos.receptor.razonSocial;
    if (typeof razonSocial !== 'string' || razonSocial.trim() === '') {
      throw new ErrorValidacion(
        'El receptor debe traer razón social (receptor.razonSocial, p. ej. "Cliente General"): ' +
          'sin ella el TED se firmaría con <RSR> vacío.',
      );
    }

    const instante = this.#reloj.ahora();
    const reloj = relojFijo(instante);

    // 1. El DTE sin timbre (valida los datos).
    const xml = new GeneradorBoleta({ reloj }).generarBoleta(datos);
    const tipoDte = texto(datos.tipoDte ?? '39');
    const folio = texto(datos.folio);

    const contenidoCaf = typeof caf === 'string' ? caf : decodificarUtf8OIso(caf);
    validarContraCaf(datos.emisor.rut, tipoDte, folio, leerDatosCaf(contenidoCaf));

    // 2. Monto e ítem, del XML generado (como el bin: loadXML + nodeValue).
    const doc = parsearDocumento(xml);
    const montoTotal = textoDe(doc, 'MntTotal');
    const nombreItem1 = textoDe(doc, 'NmbItem');

    // 3. El TED.
    const ted = new Timbre(contenidoCaf, { reloj }).generarTed({
      rutEmisor: datos.emisor.rut,
      tipoDte,
      folio,
      fecha: fechaSii(instante),
      rutReceptor: datos.receptor.rut,
      razonSocialReceptor: razonSocial,
      montoTotal,
      nombreItem1,
    });

    // 4. str_replace sobre bytes: todo en strings "binarios" (latin1, un
    // carácter por byte, sin pérdida). Los textos del DTE van escapados, así
    // que `</Documento>` aparece una sola vez.
    const tmstFirma = `<TmstFirma>${fechaHoraSii(instante)}</TmstFirma>`;
    const insercion = `${ted.toString('latin1')}\n${tmstFirma}\n</Documento>`;
    const conTed = xml.toString('latin1').replaceAll('</Documento>', insercion);

    // 5. La firma del documento.
    return this.#firmador.firmarDte(Buffer.from(conTed, 'latin1'), `#F${folio}T${tipoDte}`);
  }
}

/** El folio o el tipo como lo escribe el generador: un string tal cual, un número en decimal. */
function texto(valor: string | number): string {
  return typeof valor === 'string' ? valor : String(valor);
}

function textoDe(doc: Document, etiqueta: string): string {
  const nodo = doc.getElementsByTagName(etiqueta).item(0);
  if (nodo === null) throw new ErrorValidacion(`El DTE generado no trae <${etiqueta}>.`);
  return nodo.textContent ?? '';
}

/** Lee `<RE>`, `<TD>` y `<RNG><D>`/`<H>` del `<DA>` del CAF. */
function leerDatosCaf(contenido: string): DatosCaf {
  let doc: Document;
  try {
    doc = parsearDocumento(contenido);
  } catch (error) {
    throw new ErrorTimbre('El CAF no es un XML válido.', { cause: error });
  }
  const da = doc.getElementsByTagName('DA').item(0);
  if (da === null) throw new ErrorTimbre('El CAF no contiene el nodo <DA>.');

  const campo = (padre: Element, nombre: string): string => {
    const nodo = padre.getElementsByTagName(nombre).item(0);
    if (nodo === null) throw new ErrorTimbre(`El CAF no contiene el nodo <${nombre}> en <DA>.`);
    return (nodo.textContent ?? '').trim();
  };
  const numero = (padre: Element, nombre: string): number => {
    const valor = campo(padre, nombre);
    if (!ENTERO.test(valor)) {
      throw new ErrorTimbre(`El nodo <${nombre}> del CAF no es un entero (${valor}).`);
    }
    return Number(valor);
  };

  const rng = da.getElementsByTagName('RNG').item(0);
  if (rng === null) throw new ErrorTimbre('El CAF no contiene el nodo <RNG> en <DA>.');
  return {
    rutEmisor: campo(da, 'RE'),
    tipoDte: numero(da, 'TD'),
    desde: numero(rng, 'D'),
    hasta: numero(rng, 'H'),
  };
}

/**
 * El CAF debe ser del emisor y del tipo de la boleta, y el folio estar en su
 * rango. El tipo y el folio ya pasaron por el generador, que exige enteros
 * cuando son números; un string se escribe tal cual, así que se revisa aquí.
 */
function validarContraCaf(rutEmisor: string, tipoDte: string, folio: string, caf: DatosCaf): void {
  if (!ENTERO.test(tipoDte)) {
    throw new ErrorValidacion(`tipoDte debe ser un número entero (se recibió ${tipoDte}).`);
  }
  if (!ENTERO.test(folio)) {
    throw new ErrorValidacion(`folio debe ser un número entero (se recibió ${folio}).`);
  }
  if (rutEmisor.toUpperCase() !== caf.rutEmisor.toUpperCase()) {
    throw new ErrorValidacion(`El CAF es del emisor ${caf.rutEmisor}, no de ${rutEmisor}.`);
  }
  if (Number(tipoDte) !== caf.tipoDte) {
    throw new ErrorValidacion(`El CAF es del tipo de documento ${caf.tipoDte}, no del ${tipoDte}.`);
  }
  const numero = Number(folio);
  if (numero < caf.desde || numero > caf.hasta) {
    throw new ErrorValidacion(
      `El folio ${folio} está fuera del rango del CAF (${caf.desde}–${caf.hasta}).`,
    );
  }
}
