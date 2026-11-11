// Deriva de winex/certificacion v1.9.1 (src/Folios/SolicitudFolios.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Lo que se envía al SII (URLs, cabeceras, campos y su orden) es idéntico al PHP;
// lo comparan los casos `http-folios-*` con el servidor de captura (PLAN §5.3).
//
// Cambios respecto del PHP (ninguno cambia bytes enviados con entradas válidas):
// - pend. 1.2: si el CAF descargado no es del ambiente, la empresa o el tipo
//   pedidos, lanza `FoliosSinCafError` (los folios ya se timbraron; el PHP lanzaba
//   una `SolicitudFoliosException` común, que invitaba a reintentar).
// - pend. 1.9: exige HTTP 200 en la respuesta final del login y de cada paso del
//   asistente (el PHP no miraba el código). Antes de timbrar lanza
//   `ErrorTransporte`; desde el POST que timbra, `FoliosSinCafError`.
// - pend. 2.2: navegación compartida con la postulación (`comun/navegacion-sii.ts`).
// - pend. 2.3: el RUT de la empresa pasa por `Rut` (valida el DV).
// - La orden de timbrar va por una conexión propia (`conexionNueva`, decisión de la
//   fase 4). Las fallas de red antes de timbrar lanzan `ErrorTransporte` (el PHP,
//   `SolicitudFoliosException`): reintentarlas no gasta folios.
// - El CAF se devuelve como `Buffer`, con los bytes tal como llegaron (ISO-8859-1).
// - `FECHA` sale del reloj inyectable, en hora de Chile.

import { type Ambiente, datosAmbiente } from '../comun/ambiente.ts';
import {
  decodificarUtf8OIso,
  esUtf8Valido,
  minusculasAscii,
  trimPhp,
} from '../comun/codificacion.ts';
import {
  ErrorSolicitudFolios,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  SiiError,
} from '../comun/errores.ts';
import { atributo, elementosPorNombre, parsearHtml, textoHtml } from '../comun/html.ts';
import { exigirStatus, type RespuestaHttp } from '../comun/http/respuesta.ts';
import type { IdentidadTls, MetodoHttp, TransporteHttp } from '../comun/http/transporte.ts';
import { TransporteUndici } from '../comun/http/transporte-undici.ts';
import { exigirSesionVigente, navegar, resolverUrl } from '../comun/navegacion-sii.ts';
import { fechaSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import { parsearDocumento } from '../comun/xml.ts';
import type { Certificado } from '../core/certificado.ts';
import { SesionSii } from './sesion-sii.ts';

/** Host del login AUT2000 con certificado (el mismo en los dos ambientes). */
export const HOST_AUTENTICACION = 'https://herculesr.sii.cl';
/** Host de la página de ingreso (solo va en `Origin` y `Referer` del login). */
export const HOST_SESION = 'https://zeusr.sii.cl';

/** Tope del login, en ms (PHP: 45 s). */
export const MS_LOGIN = 45_000;
/** Tope de cada paso del asistente, en ms (PHP: 70 s). */
export const MS_ASISTENTE = 70_000;

/** Textos que delatan una página de error del SII (se buscan sin distinguir mayúsculas). */
const MARCADORES_ERROR = [
  'El c&oacute;digo de este mensaje es',
  'El código de este mensaje es',
  'no se encuentra autorizado',
  'no est&aacute; autorizado',
  'no está autorizado',
  'Usted no tiene',
  'no es representante',
  'excede',
  'no puede solicitar',
].map((m) => m.toLowerCase());

/** Campos de un formulario, en orden (como un arreglo asociativo de PHP). */
export type CamposForm = Map<string, string>;

/** El primer <form> de una página: `action` y sus campos. */
export interface FormularioFolios {
  readonly action: string;
  readonly inputs: CamposForm;
}

/**
 * Primer `<form>` de la página con la regla de `SolicitudFolios::form()`:
 * - todos los `<input>` con `name`, salvo `type` button y reset (los submit, los
 *   checkbox sin marcar y los disabled SÍ se incluyen: la regla de la postulación
 *   es otra y no se unifica);
 * - después, cada `<select>` con `name`: el `value` de la primera `<option>`
 *   marcada `selected`; si no hay, el primer `value` no vacío (`''` si no hay
 *   ninguno). Un `<option>` sin `value` cuenta como `''` (no se usa su texto).
 * Un nombre repetido se queda en su primera posición con el último valor.
 *
 * Devuelve null si la página no tiene `<form>`.
 */
export function formularioFolios(html: string): FormularioFolios | null {
  const raiz = parsearHtml(html);
  const form = elementosPorNombre(raiz, 'form')[0];
  if (form === undefined) return null;

  const inputs: CamposForm = new Map();
  for (const el of elementosPorNombre(form, 'input')) {
    const nombre = atributo(el, 'name');
    const tipo = minusculasAscii(atributo(el, 'type'));
    if (nombre === '' || tipo === 'button' || tipo === 'reset') continue;
    inputs.set(nombre, atributo(el, 'value'));
  }

  for (const el of elementosPorNombre(form, 'select')) {
    const nombre = atributo(el, 'name');
    if (nombre === '') continue;
    let valor = '';
    for (const opcion of elementosPorNombre(el, 'option')) {
      if (valor === '') valor = atributo(opcion, 'value');
      if (opcion.atributos.has('selected')) {
        valor = atributo(opcion, 'value');
        break;
      }
    }
    inputs.set(nombre, valor);
  }

  return { action: atributo(form, 'action'), inputs };
}

/** `array_merge($campos, $reemplazos)` con claves de texto: reemplaza en su lugar y agrega al final. */
function combinar(campos: CamposForm, reemplazos: Readonly<Record<string, string>>): CamposForm {
  const salida = new Map(campos);
  for (const [k, v] of Object.entries(reemplazos)) salida.set(k, v);
  return salida;
}

/** `(int) $texto` de PHP: el entero inicial, o 0. */
function enteroPhp(texto: string): number {
  const m = /^[ \t\n\r\v\f]*([+-]?\d+)/.exec(texto);
  return m === null ? 0 : Number.parseInt(m[1] as string, 10);
}

export interface OpcionesSolicitudFolios {
  /**
   * Ambiente obligatorio y fijo en código: `certificacion` timbra en maullin,
   * `produccion` en palena (folios reales).
   */
  readonly ambiente: Ambiente;
  /** Por defecto, un `TransporteUndici` propio. */
  readonly transporte?: TransporteHttp;
  /** Para `FECHA` (fecha de autorización del CAF) y la expiración de cookies. */
  readonly reloj?: Reloj;
}

/** Opciones de `SolicitudFolios.solicitar`. */
export interface OpcionesSolicitar {
  /**
   * Folio inicial que se informa si el SII lo pide (primer timbraje del tipo de
   * documento en el ambiente; normalmente 1). Solo se envía en esa página: si el SII
   * no lo pide, no cambia nada. Sin él, esa página lanza `FolioInicialRequeridoError`.
   */
  readonly folioInicial?: number;
}

/**
 * Pide folios (CAF) al SII replicando el asistente web legacy `cvc_cgi/dte/of_*`.
 *
 * Login con certificado de cliente TLS contra AUT2000 (`herculesr.sii.cl`, igual
 * en los dos ambientes: solo cambia la URL de vuelta). Después se navegan los
 * formularios del asistente leyendo el HTML de cada paso:
 *   1. GET  of_solicita_folios       → formulario "RUT del contribuyente"
 *   2. POST of_solicita_folios_dcto  → tipo de documento + cantidad
 *   3. POST of_confirma_folio        → el SII fija NOMUSU / FOLIO_INI / FOLIO_FIN
 *   4. POST of_genera_folio          → * TIMBRA los folios (irreversible) *
 *   5. POST of_genera_archivo        → descarga el XML del CAF
 *
 * Candados del ambiente (no dependen de configuración):
 * - toda petición del asistente, y cada redirección, tiene que ir al host del
 *   ambiente por https; los `action` los manda el SII y se revisan antes de enviar;
 * - el CAF descargado tiene que traer el IDK del ambiente, el RUT de la empresa y
 *   el tipo pedido.
 */
export class SolicitudFolios {
  readonly ambiente: Ambiente;
  readonly #transporte: TransporteHttp;
  readonly #reloj: Reloj;

  constructor(opciones: OpcionesSolicitudFolios) {
    datosAmbiente(opciones.ambiente); // lanza si no es un ambiente válido
    this.ambiente = opciones.ambiente;
    this.#transporte = opciones.transporte ?? new TransporteUndici();
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  get #datos() {
    return datosAmbiente(this.ambiente);
  }

  /**
   * Login AUT2000 con el certificado. El RUT del certificado tiene que ser
   * representante electrónico de la empresa para la que después se piden folios.
   *
   * Ojo: el SII frena el re-login seguido (~5 ciclos → error 01.01.215.500.771.52).
   * Si se piden folios a menudo, guardar la sesión (cifrada) y reutilizarla.
   *
   * @throws ErrorSolicitudFolios si el SII no aceptó el certificado
   * @throws ErrorTransporte si falla la red o el SII responde un código inesperado
   */
  async autenticar(certificado: Certificado): Promise<SesionSii> {
    const sesion = new SesionSii({ reloj: this.#reloj });
    const referencia = `${this.#datos.portal}/cvc_cgi/dte/of_solicita_folios`;
    const url = `${HOST_AUTENTICACION}/cgi_AUT2000/CAutInicio.cgi?${referencia}`;

    const respuesta = await this.#pedir(sesion, {
      metodo: 'POST',
      url,
      campos: new Map([['referencia', referencia]]),
      cabeceras: {
        Origin: HOST_SESION,
        Referer: `${HOST_SESION}/AUT2000/InicioAutenticacion/IngresoCertificado.html?${referencia}`,
      },
      // Cadena completa (hoja + intermedios): sin ella el SII corta el handshake
      // con "tlsv1 alert unknown ca" para algunos proveedores.
      tls: certificado.identidadTls(),
      ms: MS_LOGIN,
      // El login vive en otros hosts del SII; ahí no se timbra nada. Solo se
      // exige que no salga de sii.cl.
      revisar: (destino) => this.#soloSii(destino),
    });
    exigirStatus(respuesta, url, 200);

    // Las cookies que pone el JavaScript de la página: bytes tal cual (latin1).
    sesion.recibirDesdeHtml(respuesta.cuerpo.toString('latin1'));

    if (!sesion.tiene('TOKEN')) {
      throw new ErrorSolicitudFolios(
        'El SII no aceptó el certificado para pedir folios. Revisa que esté vigente y que el RUT ' +
          'del certificado sea representante electrónico de la empresa.',
      );
    }
    return sesion;
  }

  /**
   * Timbra `cantidad` folios del tipo `tipoDte` para `rutEmpresa` y devuelve el
   * XML del CAF (bytes tal como los entregó el SII), ya revisado contra el ambiente.
   *
   * @throws SesionCaducaError si la sesión ya no sirve (antes de timbrar: se puede
   *   volver a autenticar y reintentar sin gastar folios)
   * @throws FoliosSinCafError si la orden de timbrar salió y no se obtuvo un CAF
   *   válido: NO reintentar; revisar "Folios ya autorizados" en el portal
   * @throws ErrorSolicitudFolios si el SII rechazó la solicitud antes de timbrar
   * @throws ErrorTransporte si falla la red antes de timbrar
   * @throws ErrorValidacion si el RUT no es válido
   * @throws FolioInicialRequeridoError si el SII pide el folio inicial (primer
   *   timbraje del tipo de documento) y no se indicó `opciones.folioInicial`
   */
  async solicitar(
    sesion: SesionSii,
    rutEmpresa: string | Rut,
    tipoDte: number,
    cantidad: number,
    opciones: OpcionesSolicitar = {},
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(cantidad) || cantidad < 1) {
      throw new ErrorSolicitudFolios('La cantidad de folios debe ser un entero de al menos 1.');
    }
    if (!Number.isSafeInteger(tipoDte) || tipoDte < 1) {
      throw new ErrorSolicitudFolios(`Tipo de documento inválido: ${tipoDte}.`);
    }
    const { folioInicial } = opciones;
    if (folioInicial !== undefined && (!Number.isSafeInteger(folioInicial) || folioInicial < 1)) {
      throw new ErrorSolicitudFolios('El folio inicial debe ser un entero de al menos 1.');
    }
    const rut = rutEmpresa instanceof Rut ? rutEmpresa : Rut.de(rutEmpresa, 'RUT de la empresa');

    const base = `${this.#datos.portal}/cvc_cgi/dte`;

    // Paso 1.
    let html = await this.#asistente(
      sesion,
      'GET',
      `${base}/of_solicita_folios`,
      null,
      `${base}/of_solicita_folios`,
    );
    exigirSesionVigente(html);

    // Paso 2: tipo de documento + cantidad. El asistente puede recargar
    // `of_solicita_folios_dcto` sobre sí mismo (primero el tipo, luego la
    // cantidad); se reenvía hasta caer en la confirmación.
    const reemplazos = {
      RUT_EMP: rut.numero,
      DV_EMP: rut.dv,
      FOLIO_INICIAL: '0',
      COD_DOCTO: String(tipoDte),
      CANT_DOCTOS: String(cantidad),
      ACEPTAR: 'Continuar',
    };

    let referer = `${base}/of_solicita_folios`;
    for (let i = 0; i < 4; i++) {
      const form = this.#form(html);
      const url = this.#resolver(base, form.action);
      // Primer timbraje del tipo de documento (visto en palena, 2026-11-10): el SII
      // pide "Ingrese Folio Inicial" con el botón "Confirmar Folio Inicial". El PHP
      // manda FOLIO_INICIAL=0 y el SII repite la página. Solo en esa página, y solo
      // si se indicó, va el folio inicial con el botón de la página (lo que enviaría
      // el navegador); en el resto de los pasos todo sigue igual que el PHP.
      const aceptar = form.inputs.get('ACEPTAR') ?? '';
      let campos = combinar(form.inputs, reemplazos);
      if (/folio\s+inicial/i.test(aceptar)) {
        if (folioInicial === undefined) {
          throw new FolioInicialRequeridoError(
            this.ambiente,
            form.inputs.get('FOLIO_INICIAL') ?? '',
          );
        }
        campos = combinar(campos, { FOLIO_INICIAL: String(folioInicial), ACEPTAR: aceptar });
      }
      html = await this.#asistente(sesion, 'POST', url, campos, referer);
      exigirSesionVigente(html);
      this.#sinError(html);
      referer = url;

      if (this.#form(html).action.includes('of_genera_folio')) break;
    }

    // Paso 3: confirmación. Su formulario apunta a of_genera_folio y trae los
    // campos que decide el SII.
    const confirma = this.#form(html);
    if (!confirma.action.includes('of_genera_folio')) {
      throw new ErrorSolicitudFolios(
        `El SII no llegó a la confirmación de folios. ${this.#mensajeSii(html)}`.trim(),
      );
    }
    for (const campo of ['FOLIO_INI', 'FOLIO_FIN', 'NOMUSU']) {
      if ((confirma.inputs.get(campo) ?? '') === '') {
        throw new ErrorSolicitudFolios(
          `La confirmación del SII no trae ${campo}. ${this.#mensajeSii(html)}`.trim(),
        );
      }
    }
    const folioIni = confirma.inputs.get('FOLIO_INI') as string;
    const folioFin = confirma.inputs.get('FOLIO_FIN') as string;

    // Paso 4: generar. ** Esto timbra los folios. ** El candado se revisa aparte
    // y antes: si corta aquí, no se envió nada.
    const urlGenera = this.#resolver(base, confirma.action);
    this.#soloAmbiente(urlGenera);

    // Desde que sale el POST los folios pueden estar timbrados: cualquier falla
    // (red, código HTTP, sesión, un CAF que no cuadra) se informa como
    // FoliosSinCafError para que nadie reintente a ciegas.
    const sinCaf = (detalle: string, causa?: unknown): FoliosSinCafError =>
      new FoliosSinCafError(
        enteroPhp(folioIni),
        enteroPhp(folioFin),
        this.ambiente,
        this.#datos.host,
        detalle,
        causa === undefined ? undefined : { cause: causa },
      );

    let caf: Buffer;
    try {
      const genera = await this.#asistente(
        sesion,
        'POST',
        urlGenera,
        combinar(confirma.inputs, { ACEPTAR: 'Obtener Folios' }),
        referer,
        { conexionNueva: true },
      );
      this.#sinError(genera);

      // Paso 5: descargar el XML del CAF.
      const descarga = this.#form(genera);
      caf = await this.#asistenteBytes(
        sesion,
        'POST',
        this.#resolver(base, descarga.action),
        combinar(descarga.inputs, {
          RUT_EMP: rut.numero,
          DV_EMP: rut.dv,
          COD_DOCTO: String(tipoDte),
          FOLIO_INI: folioIni,
          FOLIO_FIN: folioFin,
          // Hora de Chile explícita: el SII usa FECHA como FA del CAF. Con la hora
          // del servidor en UTC, desde las 21:00 el CAF saldría con fecha de mañana
          // y cada boleta timbrada hoy quedaría con reparo TED-1-646.
          FECHA: fechaSii(this.#reloj.ahora()),
          ACEPTAR: 'AQUI',
        }),
        `${base}/of_genera_folio`,
      );

      if (!caf.includes('<AUTORIZACION') || !caf.includes('<CAF')) {
        throw new ErrorSolicitudFolios(this.#mensajeSii(decodificarUtf8OIso(caf)));
      }

      this.#revisarCaf(caf, rut, tipoDte);
    } catch (error) {
      const detalle = error instanceof SiiError ? error.message : '';
      throw sinCaf(detalle, error);
    }

    return caf;
  }

  // --- candados -----------------------------------------------------------------

  /** Solo el host del ambiente, por https (y sin la página de login en la URL). */
  #soloAmbiente(url: string): void {
    exigirSesionVigente(url);
    const u = leerUrl(url);
    if (
      u === null ||
      u.protocol !== 'https:' ||
      u.hostname !== this.#datos.host ||
      u.port !== '' ||
      u.username !== '' ||
      u.password !== ''
    ) {
      throw new ErrorSolicitudFolios(
        `Solicitud de folios detenida: el SII apuntó fuera del ambiente de ${this.ambiente} (${this.#datos.host}).`,
      );
    }
  }

  /** Solo hosts de sii.cl, por https (login). */
  #soloSii(url: string): void {
    const u = leerUrl(url);
    const host = u?.hostname ?? '';
    if (
      u === null ||
      u.protocol !== 'https:' ||
      (host !== 'sii.cl' && !host.endsWith('.sii.cl')) ||
      u.username !== '' ||
      u.password !== ''
    ) {
      throw new ErrorSolicitudFolios('Autenticación detenida: el SII redirigió fuera de sii.cl.');
    }
  }

  /** El CAF tiene que ser del ambiente (IDK), de la empresa (RE) y del tipo pedido (TD). */
  #revisarCaf(caf: Buffer, rut: Rut, tipoDte: number): void {
    const contenido = caf.subarray(caf[0] === 0xef && caf[1] === 0xbb && caf[2] === 0xbf ? 3 : 0);
    // Los CAF del SII traen bytes ISO-8859-1 (tildes de la razón social): si no es
    // UTF-8 válido se lee como ISO-8859-1, igual que el PHP.
    const texto = esUtf8Valido(contenido)
      ? contenido.toString('utf8')
      : contenido.toString('latin1').replace(/(<\?xml[^>]*encoding=")[^"]*(")/i, '$1UTF-8$2');

    let doc: Document;
    try {
      doc = parsearDocumento(texto);
    } catch (error) {
      throw new ErrorSolicitudFolios('El CAF que entregó el SII no es un XML válido. No se usó.', {
        cause: error,
      });
    }

    const valor = (etiqueta: string): string =>
      trimPhp(doc.getElementsByTagName(etiqueta).item(0)?.textContent ?? '');
    const normalizar = (r: string): string => r.replace(/[^0-9kK-]/g, '').toUpperCase();

    const idk = valor('IDK');
    if (idk !== this.#datos.idk) {
      throw new ErrorSolicitudFolios(
        `El CAF que entregó el SII no es del ambiente de ${this.ambiente} (IDK ${idk}, se esperaba ${this.#datos.idk}). No se usó.`,
      );
    }
    const re = valor('RE');
    if (normalizar(re) !== normalizar(rut.toString())) {
      throw new ErrorSolicitudFolios(
        `El CAF que entregó el SII es del RUT ${re}, no de ${rut}. No se usó.`,
      );
    }
    const td = valor('TD');
    if (td !== String(tipoDte)) {
      throw new ErrorSolicitudFolios(
        `El CAF que entregó el SII es de tipo ${td}, no ${tipoDte}. No se usó.`,
      );
    }
  }

  // --- HTTP -----------------------------------------------------------------------

  /** Página del asistente, en texto (UTF-8, o ISO-8859-1 si no es UTF-8 válido). */
  async #asistente(
    sesion: SesionSii,
    metodo: MetodoHttp,
    url: string,
    campos: CamposForm | null,
    referer: string,
    opciones: { conexionNueva?: boolean } = {},
  ): Promise<string> {
    return decodificarUtf8OIso(
      await this.#asistenteBytes(sesion, metodo, url, campos, referer, opciones),
    );
  }

  /**
   * Petición al asistente: la URL y cada redirección tienen que ser del ambiente.
   * Devuelve el cuerpo en bytes y exige HTTP 200.
   */
  async #asistenteBytes(
    sesion: SesionSii,
    metodo: MetodoHttp,
    url: string,
    campos: CamposForm | null,
    referer: string,
    opciones: { conexionNueva?: boolean } = {},
  ): Promise<Buffer> {
    const respuesta = await this.#pedir(sesion, {
      metodo,
      url,
      campos,
      cabeceras: { Referer: referer },
      ms: MS_ASISTENTE,
      revisar: (destino) => this.#soloAmbiente(destino),
      ...(opciones.conexionNueva === true ? { conexionNueva: true } : {}),
    });
    return exigirStatus(respuesta, url, 200).cuerpo;
  }

  #pedir(
    sesion: SesionSii,
    p: {
      metodo: MetodoHttp;
      url: string;
      campos: CamposForm | null;
      cabeceras: Record<string, string>;
      tls?: IdentidadTls;
      ms: number;
      revisar: (url: string) => void;
      conexionNueva?: boolean;
    },
  ): Promise<RespuestaHttp> {
    return navegar(this.#transporte, sesion, {
      metodo: p.metodo,
      url: p.url,
      ...(p.campos !== null ? { cuerpo: { tipo: 'formulario', campos: p.campos } } : {}),
      cabeceras: p.cabeceras,
      ...(p.tls !== undefined ? { tls: p.tls } : {}),
      msRespuesta: p.ms,
      ...(p.conexionNueva === true ? { conexionNueva: true } : {}),
      revisar: p.revisar,
      errorRedirecciones: (mensaje) => new ErrorSolicitudFolios(mensaje),
    });
  }

  // --- HTML ------------------------------------------------------------------------

  #form(html: string): FormularioFolios {
    const form = formularioFolios(html);
    if (form === null) {
      throw new ErrorSolicitudFolios(
        `El SII no devolvió el formulario esperado. ${this.#mensajeSii(html)}`.trim(),
      );
    }
    return form;
  }

  /** `action` de un formulario del asistente, relativo a `base` (vacío = `base`). */
  #resolver(base: string, action: string): string {
    return action === '' ? base : resolverUrl(`${base}/`, action);
  }

  #sinError(html: string): void {
    const minusculas = html.toLowerCase();
    if (MARCADORES_ERROR.some((m) => minusculas.includes(m))) {
      throw new ErrorSolicitudFolios(
        `El SII rechazó la solicitud de folios. ${this.#mensajeSii(html)}`.trim(),
      );
    }
  }

  #mensajeSii(html: string): string {
    const texto = textoHtml(html, 300);
    return texto === '' ? '' : `(SII: ${texto})`;
  }
}

function leerUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
