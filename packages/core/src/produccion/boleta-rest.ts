// Deriva de winex/certificacion v1.9.1 (src/Produccion/SiiBoletaProduccion.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript con
// transporte inyectable, revisión del código HTTP en todas las llamadas
// (pend. 1.9), caché de token inyectable por empresa, ambiente y certificado
// (pend. 1.4), respuestas tipadas (pend. 1.6), multipart compartido sin archivos
// temporales (pend. 2.4) y RUT validados con `Rut` (pend. 2.3).
//
// API REST de Boleta Electrónica (distinta del canal SOAP DTEWS):
//
// | Ambiente      | Semilla, token y consulta     | Envío de boleta y RCOF          |
// |---------------|-------------------------------|---------------------------------|
// | producción    | https://api.sii.cl/recursos/v1     | https://rahue.sii.cl/recursos/v1  |
// | certificación | https://apicert.sii.cl/recursos/v1 | https://pangal.sii.cl/recursos/v1 |
//
// Paridad de requests con el cURL del PHP (PLAN §5.3): mismas URLs (la consulta
// del envío va al host de autenticación, igual que en el PHP), mismo método,
// mismas cabeceras y mismo multipart. cURL agrega siempre `Accept: */*`, así que
// aquí se pone explícita. El cURL de la API REST no tenía `CURLOPT_ENCODING`: no
// se envía `Accept-Encoding` ni se descomprime (`descomprimir: false`). Los dos
// POST que no se pueden repetir sin consecuencias (envío de boleta y RCOF) van
// con `conexionNueva: true`; el resto reutiliza conexiones (decisión 2026-11-06).

import { type Ambiente, esAmbiente } from '../comun/ambiente.ts';
import { decodificarUtf8OIso, largoCodePoints, truncarCodePoints } from '../comun/codificacion.ts';
import { ErrorRespuestaSii, ErrorTransporte, ErrorValidacion } from '../comun/errores.ts';
import { armarMultipart, boundaryAleatorio } from '../comun/http/multipart.ts';
import { exigirStatus, type RespuestaHttp } from '../comun/http/respuesta.ts';
import type { PeticionHttp, TransporteHttp } from '../comun/http/transporte.ts';
import { type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import {
  type ClaveToken,
  huellaCertificado,
  type TokenStore,
  TokenStoreMemoria,
} from '../comun/token-store.ts';
import type { Certificado } from '../core/certificado.ts';
import { FirmaElectronica } from '../core/firma-electronica.ts';

/** `User-Agent` que el PHP envía en las subidas (boleta y RCOF), tal cual. */
export const USER_AGENT_BOLETA_REST = 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)';

/**
 * Un token se reutiliza durante este tiempo desde que se obtuvo, en segundos
 * (el SII lo da por una hora; el PHP lo reutilizaba si tenía menos de 3000 s).
 */
export const SEGUNDOS_VIGENCIA_TOKEN = 3000;

/** Nombre del archivo en el multipart si no se indica otro. */
export const NOMBRE_ARCHIVO_BOLETA = 'envio.xml';
/** Nombre del archivo del RCOF en el multipart si no se indica otro. */
export const NOMBRE_ARCHIVO_RCOF = 'rcof.xml';

/** URLs base, sin `/` final. */
export interface UrlsBoletaRest {
  /** Semilla, token y consulta del envío. */
  readonly auth: string;
  /** Envío de boleta y de RCOF. */
  readonly envio: string;
}

export const URLS_BOLETA_REST: Readonly<Record<Ambiente, UrlsBoletaRest>> = Object.freeze({
  produccion: Object.freeze({
    auth: 'https://api.sii.cl/recursos/v1',
    envio: 'https://rahue.sii.cl/recursos/v1',
  }),
  certificacion: Object.freeze({
    auth: 'https://apicert.sii.cl/recursos/v1',
    envio: 'https://pangal.sii.cl/recursos/v1',
  }),
});

export interface OpcionesClienteBoletaRest {
  /** Obligatorio: producción emite documentos reales y consume folios. */
  readonly ambiente: Ambiente;
  /** Transporte HTTP (`TransporteUndici` en producción; `TransporteFalso` en tests). */
  readonly transporte: TransporteHttp;
  /** Caché de tokens para `obtenerToken`. Por defecto, uno en memoria propio de este cliente. */
  readonly tokenStore?: TokenStore;
  /** Reloj para la vigencia de los tokens. Por defecto, el del sistema. */
  readonly reloj?: Reloj;
  /**
   * **Solo para tests** (servidor de captura, PLAN §5.3): reemplaza las URLs base
   * del ambiente. Nunca apuntar a otro servidor en producción: recibiría el token.
   */
  readonly urls?: UrlsBoletaRest;
  /** **Solo para tests:** genera el boundary del multipart. Por defecto, uno aleatorio como cURL. */
  readonly boundary?: () => string;
}

export interface OpcionesSubida {
  /**
   * Nombre con que el SII recibe el archivo en el multipart (`filename`). Por
   * defecto `envio.xml` (boleta) o `rcof.xml` (RCOF). El PHP usaba el nombre del
   * archivo temporal más `.xml` (p. ej. `bol_AbC123.xml` en Linux), que cambiaba
   * en cada envío; el SII lo devuelve en `file` pero no lo valida.
   */
  readonly nombreArchivo?: string;
}

/** Respuesta del SII al subir una boleta o un RCOF. */
export interface RespuestaEnvioRest {
  /** Identificador del envío, para consultar su estado. */
  readonly trackId: string;
  /** Normalmente `REC` (recibido). */
  readonly estado: string;
  /** `YYYY-MM-DD HH:MM:SS`, tal como la entrega el SII ('' si no vino). */
  readonly fechaRecepcion: string;
  readonly rutEmisor: string;
  readonly rutEnvia: string;
  /** Nombre del archivo recibido (`file`). */
  readonly archivo: string;
  /** El JSON completo que devolvió el SII. */
  readonly json: Readonly<Record<string, unknown>>;
}

/** Cantidades por tipo de documento (`estadistica[]`). */
export interface EstadisticaEnvioRest {
  readonly tipo: number;
  readonly informados: number;
  readonly aceptados: number;
  readonly rechazados: number;
  readonly reparos: number;
}

/** Un error o reparo de un documento (`detalle_rep_rech[].error[]`). */
export interface ErrorDocumentoRest {
  readonly seccion: string;
  readonly linea: number | null;
  readonly nivel: number | null;
  readonly codigo: number | null;
  readonly descripcion: string;
  readonly detalle: string;
}

/** Un documento rechazado o con reparos (`detalle_rep_rech[]`). */
export interface DetalleRepRechRest {
  readonly tipo: number;
  readonly folio: number;
  readonly estado: string;
  readonly descripcion: string;
  readonly errores: readonly ErrorDocumentoRest[];
}

/** Estados intermedios: el SII todavía no termina de validar el envío. */
const EN_PROCESO: readonly string[] = ['REC', 'SOK', 'CRT', 'FOK', 'PRD'];

/**
 * Estado de un envío de boletas según la API REST
 * (`GET boleta.electronica.envio/{rut}-{dv}-{trackid}`), pend. 1.6. Forma del
 * JSON (los campos que falten quedan en `''`, `0` o `[]`):
 *
 * ```json
 * { "rut_emisor": "…", "rut_envia": "…", "trackid": 123, "fecha_recepcion": "…",
 *   "estado": "EPR",
 *   "estadistica": [{ "tipo": 39, "informados": 5, "aceptados": 5, "rechazados": 0, "reparos": 0 }],
 *   "detalle_rep_rech": [{ "tipo": 39, "folio": 1, "estado": "RCH", "descripcion": "…",
 *                          "error": [{ "seccion": "…", "linea": 1, "nivel": 1, "codigo": 1,
 *                                      "descripcion": "…", "detalle": "…" }] }] }
 * ```
 */
export class EstadoEnvioRest {
  readonly trackId: string;
  readonly estado: string;
  readonly rutEmisor: string;
  readonly rutEnvia: string;
  readonly fechaRecepcion: string;
  readonly estadistica: readonly EstadisticaEnvioRest[];
  readonly detalleRepRech: readonly DetalleRepRechRest[];
  /** Sumas de `estadistica` sobre todos los tipos de documento. */
  readonly informados: number;
  readonly aceptados: number;
  readonly rechazados: number;
  readonly reparos: number;
  /** El JSON completo que devolvió el SII. */
  readonly json: Readonly<Record<string, unknown>>;

  private constructor(json: Readonly<Record<string, unknown>>, trackId: string, estado: string) {
    this.json = json;
    this.estado = estado;
    this.trackId = textoTrackId(json.trackid) ?? trackId;
    this.rutEmisor = texto(json.rut_emisor);
    this.rutEnvia = texto(json.rut_envia);
    this.fechaRecepcion = texto(json.fecha_recepcion);
    this.estadistica = Object.freeze(
      objetos(json.estadistica).map((e) =>
        Object.freeze({
          tipo: entero(e.tipo) ?? 0,
          informados: entero(e.informados) ?? 0,
          aceptados: entero(e.aceptados) ?? 0,
          rechazados: entero(e.rechazados) ?? 0,
          reparos: entero(e.reparos) ?? 0,
        }),
      ),
    );
    this.detalleRepRech = Object.freeze(
      objetos(json.detalle_rep_rech).map((d) =>
        Object.freeze({
          tipo: entero(d.tipo) ?? 0,
          folio: entero(d.folio) ?? 0,
          estado: texto(d.estado),
          descripcion: texto(d.descripcion),
          errores: Object.freeze(
            objetos(d.error).map((e) =>
              Object.freeze({
                seccion: texto(e.seccion),
                linea: entero(e.linea) ?? null,
                nivel: entero(e.nivel) ?? null,
                codigo: entero(e.codigo) ?? null,
                descripcion: texto(e.descripcion),
                detalle: texto(e.detalle),
              }),
            ),
          ),
        }),
      ),
    );
    const sumar = (campo: Exclude<keyof EstadisticaEnvioRest, 'tipo'>) =>
      this.estadistica.reduce((total, e) => total + e[campo], 0);
    this.informados = sumar('informados');
    this.aceptados = sumar('aceptados');
    this.rechazados = sumar('rechazados');
    this.reparos = sumar('reparos');
    Object.freeze(this);
  }

  /**
   * @param trackId el consultado; se usa si el JSON no trae `trackid`.
   * @throws ErrorRespuestaSii si el JSON no es un objeto o no trae `estado`.
   */
  static desdeJson(json: unknown, trackId: string): EstadoEnvioRest {
    if (!esObjeto(json)) {
      throw new ErrorRespuestaSii(`El SII no devolvió el estado del envío ${trackId}.`);
    }
    const estado = texto(json.estado);
    if (estado === '') {
      throw new ErrorRespuestaSii(`El SII no devolvió el estado del envío ${trackId}.`);
    }
    return new EstadoEnvioRest(json, trackId, estado);
  }

  /** El SII todavía está validando: hay que volver a consultar más tarde. */
  enProceso(): boolean {
    return EN_PROCESO.includes(this.estado);
  }

  procesado(): boolean {
    return this.estado === 'EPR';
  }

  /** Procesado con todos los documentos aceptados, sin rechazos ni reparos. */
  limpio(): boolean {
    return (
      this.procesado() &&
      this.informados > 0 &&
      this.aceptados === this.informados &&
      this.rechazados === 0 &&
      this.reparos === 0
    );
  }
}

/**
 * Cliente de la API REST de Boleta Electrónica del SII.
 *
 * ```ts
 * const sii = new ClienteBoletaRest(certificado, { ambiente: 'certificacion', transporte });
 * const token = await sii.obtenerToken('76543210-3');
 * const { trackId } = await sii.enviarBoleta(token, '76543210-3', '11111111-1', sobre);
 * const estado = await sii.consultarEnvio(token, '76543210-3', trackId);
 * ```
 *
 * Errores: `ErrorTransporte` si falla la red o el SII responde con un código HTTP
 * distinto de 200 (`status`); `ErrorRespuestaSii` si responde 200 sin la
 * semilla, el token o el JSON esperado; `ErrorValidacion` si un RUT, el token o el
 * XML no son válidos. Ningún mensaje incluye el token, cookies, PEM ni el XML
 * firmado.
 */
export class ClienteBoletaRest {
  readonly ambiente: Ambiente;
  readonly urls: UrlsBoletaRest;
  readonly #firmador: FirmaElectronica;
  readonly #huella: string;
  readonly #transporte: TransporteHttp;
  readonly #tokenStore: TokenStore;
  readonly #reloj: Reloj;
  readonly #boundary: () => string;
  /** Pedidos de token en curso, por RUT de empresa: dos llamadas simultáneas comparten uno. */
  readonly #enCurso = new Map<string, Promise<string>>();

  /**
   * @param certificado firma la semilla; su huella forma parte de la clave del caché.
   * @throws TypeError si el ambiente o las URLs no son válidos.
   */
  constructor(certificado: Certificado, opciones: OpcionesClienteBoletaRest) {
    if (!esAmbiente(opciones.ambiente)) {
      throw new TypeError(`Ambiente desconocido: ${String(opciones.ambiente)}`);
    }
    this.ambiente = opciones.ambiente;
    const urls = opciones.urls ?? URLS_BOLETA_REST[opciones.ambiente];
    this.urls = Object.freeze({ auth: urlBase(urls.auth), envio: urlBase(urls.envio) });
    this.#firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
    this.#huella = huellaCertificado(certificado.certificado);
    this.#transporte = opciones.transporte;
    this.#tokenStore = opciones.tokenStore ?? new TokenStoreMemoria();
    this.#reloj = opciones.reloj ?? relojSistema;
    this.#boundary = opciones.boundary ?? boundaryAleatorio;
  }

  /**
   * Pide una semilla (`GET boleta.electronica.semilla`).
   *
   * @throws ErrorTransporte si falla la red o el código HTTP no es 200.
   * @throws ErrorRespuestaSii si la respuesta no trae `<SEMILLA>` (con el ESTADO
   *   y la GLOSA del SII, si vinieron).
   */
  async obtenerSemilla(): Promise<string> {
    const url = `${this.urls.auth}/boleta.electronica.semilla`;
    const respuesta = await this.#transporte.enviar({
      metodo: 'GET',
      url,
      cabeceras: { Accept: '*/*' },
      descomprimir: false,
    });
    exigirStatus(respuesta, url);

    // Como el preg_match del PHP, sobre los bytes (`.` no cruza saltos de línea).
    const cuerpo = respuesta.cuerpo.toString('latin1');
    const semilla = /<SEMILLA>([^\n]*?)<\/SEMILLA>/.exec(cuerpo)?.[1];
    if (semilla === undefined || semilla === '') {
      throw errorSinDato('la semilla', cuerpo);
    }
    return semilla;
  }

  /**
   * Canjea una semilla nueva por un token, **sin caché** (`POST
   * boleta.electronica.token` con la semilla firmada). Para que una app guarde el
   * token con su propio mecanismo; si no, usar `obtenerToken`.
   *
   * @throws ErrorTransporte si falla la red o el código HTTP no es 200.
   * @throws ErrorRespuestaSii si la respuesta no trae `<TOKEN>` (con el ESTADO y la
   *   GLOSA del SII; nunca un extracto de la respuesta, que podría traer el token).
   */
  async solicitarToken(): Promise<string> {
    const semilla = await this.obtenerSemilla();
    const xmlFirmado = this.#firmador.firmarSemilla(semilla);

    const url = `${this.urls.auth}/boleta.electronica.token`;
    const respuesta = await this.#transporte.enviar({
      metodo: 'POST',
      url,
      cabeceras: { Accept: '*/*', 'Content-Type': 'application/xml' },
      // Solo ASCII (dígitos, base64 y etiquetas): en UTF-8 son los mismos bytes del PHP.
      cuerpo: { tipo: 'crudo', datos: xmlFirmado, contentType: 'application/xml' },
      descomprimir: false,
    });
    exigirStatus(respuesta, url);

    const cuerpo = respuesta.cuerpo.toString('latin1');
    const token = /<TOKEN>([^\n]*?)<\/TOKEN>/.exec(cuerpo)?.[1];
    if (token === undefined || token === '') {
      throw errorSinDato('el token', cuerpo);
    }
    if (!tokenValido(token)) {
      throw new ErrorRespuestaSii('El SII entregó un token con un formato inesperado.');
    }
    return token;
  }

  /**
   * Token para operar a nombre de la empresa: el del caché si sigue vigente, o uno
   * nuevo (que se guarda por `SEGUNDOS_VIGENCIA_TOKEN`). Reemplaza el `getToken()`
   * del PHP, que usaba un solo archivo para todas las empresas y ambientes.
   *
   * Si el SII rechaza el token antes de que venza, llamar a `olvidarToken`.
   *
   * @throws ErrorValidacion si el RUT no es válido. Además, los de `solicitarToken`
   *   y los del `TokenStore`.
   */
  async obtenerToken(rutEmpresa: string | Rut): Promise<string> {
    const clave = this.claveToken(rutEmpresa);
    const enCurso = this.#enCurso.get(clave.rutEmpresa);
    if (enCurso !== undefined) return enCurso;

    const pedido = this.#tokenDeCacheONuevo(clave).finally(() => {
      this.#enCurso.delete(clave.rutEmpresa);
    });
    this.#enCurso.set(clave.rutEmpresa, pedido);
    return pedido;
  }

  /** Borra del caché el token de la empresa (p. ej. si el SII lo rechazó). */
  async olvidarToken(rutEmpresa: string | Rut): Promise<void> {
    await this.#tokenStore.borrar(this.claveToken(rutEmpresa));
  }

  /**
   * Clave del caché para la empresa con este certificado y ambiente.
   *
   * @throws ErrorValidacion si el RUT no es válido.
   */
  claveToken(rutEmpresa: string | Rut): ClaveToken {
    const rut =
      typeof rutEmpresa === 'string' ? Rut.de(rutEmpresa, 'RUT de la empresa') : rutEmpresa;
    return Object.freeze({
      canal: 'rest',
      ambiente: this.ambiente,
      rutEmpresa: rut.toString(),
      huellaCertificado: this.#huella,
    });
  }

  /**
   * Sube un `EnvioBOLETA` firmado (`POST boleta.electronica.envio`, multipart).
   * **En producción emite documentos reales y consume folios.**
   *
   * Un `ErrorTransporte` sin `status` (se cortó la conexión) no garantiza que el
   * envío no haya llegado: no reenviar sin revisar antes.
   *
   * @param rutEmisor empresa emisora (`rutCompany` / `dvCompany`).
   * @param rutEnvia persona que firma el envío (`rutSender` / `dvSender`).
   * @param xml bytes exactos del sobre (ISO-8859-1, como los entrega `EnvioBoleta`).
   * @throws ErrorValidacion si el token, un RUT, el XML o el nombre no son válidos.
   * @throws ErrorTransporte si falla la red o el código HTTP no es 200.
   * @throws ErrorRespuestaSii si el SII no devuelve un JSON con `trackid`.
   */
  async enviarBoleta(
    token: string,
    rutEmisor: string | Rut,
    rutEnvia: string | Rut,
    xml: Uint8Array,
    opciones: OpcionesSubida = {},
  ): Promise<RespuestaEnvioRest> {
    return this.#subir(
      'boleta.electronica.envio',
      'de la boleta',
      token,
      rutEmisor,
      rutEnvia,
      xml,
      opciones.nombreArchivo ?? NOMBRE_ARCHIVO_BOLETA,
    );
  }

  /**
   * Sube el Reporte de Consumo de Folios (RCOF) firmado (`POST
   * boleta.electronica.consumo`, multipart). Mismas reglas que `enviarBoleta`.
   *
   * Se porta por paridad con el PHP, pero el SII eliminó el RCOF a partir del
   * 2022-08-01 y pangal responde HTTP 404 a este recurso (validado el
   * 2026-11-07): lanza `ErrorTransporte`. Para un período anterior pendiente,
   * usar `ClienteDtews.enviarDte` (DTEUpload).
   *
   * @param xml bytes exactos del RCOF (ISO-8859-1, como los entrega `GeneradorConsumoFolios`).
   */
  async enviarConsumoFolios(
    token: string,
    rutEmisor: string | Rut,
    rutEnvia: string | Rut,
    xml: Uint8Array,
    opciones: OpcionesSubida = {},
  ): Promise<RespuestaEnvioRest> {
    return this.#subir(
      'boleta.electronica.consumo',
      'del RCOF',
      token,
      rutEmisor,
      rutEnvia,
      xml,
      opciones.nombreArchivo ?? NOMBRE_ARCHIVO_RCOF,
    );
  }

  /**
   * Estado de un envío (`GET boleta.electronica.envio/{rut}-{dv}-{trackid}`). Va al
   * host de autenticación (api / apicert), como en el PHP.
   *
   * @throws ErrorValidacion si el token, el RUT o el trackId no son válidos.
   * @throws ErrorTransporte si falla la red o el código HTTP no es 200.
   * @throws ErrorRespuestaSii si la respuesta no es un JSON con `estado`.
   */
  async consultarEnvio(
    token: string,
    rutEmisor: string | Rut,
    trackId: string | number,
  ): Promise<EstadoEnvioRest> {
    exigirToken(token);
    const rut = aRut(rutEmisor, 'RUT del emisor');
    const id = String(trackId);
    if (!/^[0-9]+$/.test(id)) {
      throw new ErrorValidacion(`TrackID inválido: ${id}. Debe ser numérico.`);
    }

    const url = `${this.urls.auth}/boleta.electronica.envio/${rut.numero}-${rut.dv}-${id}`;
    const respuesta = await this.#transporte.enviar({
      metodo: 'GET',
      url,
      cabeceras: { Accept: '*/*', Cookie: `TOKEN=${token}` },
      descomprimir: false,
    });
    exigir200ConExtracto(respuesta, url, token);
    const json = leerJsonObjeto(respuesta, token, `El SII no devolvió el estado del envío ${id}`);
    return EstadoEnvioRest.desdeJson(json, id);
  }

  async #tokenDeCacheONuevo(clave: ClaveToken): Promise<string> {
    const guardado = await this.#tokenStore.obtener(clave);
    if (
      guardado !== undefined &&
      tokenValido(guardado.token) &&
      this.#reloj.ahora().getTime() < guardado.venceEn.getTime()
    ) {
      return guardado.token;
    }

    const token = await this.solicitarToken();
    // Como el PHP: la vigencia corre desde que se recibió el token.
    const venceEn = new Date(this.#reloj.ahora().getTime() + SEGUNDOS_VIGENCIA_TOKEN * 1000);
    await this.#tokenStore.guardar(clave, { token, venceEn });
    return token;
  }

  async #subir(
    recurso: string,
    /** `de la boleta` o `del RCOF`, para los mensajes. */
    deQue: string,
    token: string,
    rutEmisor: string | Rut,
    rutEnvia: string | Rut,
    xml: Uint8Array,
    nombreArchivo: string,
  ): Promise<RespuestaEnvioRest> {
    exigirToken(token);
    const emisor = aRut(rutEmisor, 'RUT del emisor');
    const envia = aRut(rutEnvia, 'RUT de quien envía');
    if (!(xml instanceof Uint8Array) || xml.byteLength === 0) {
      throw new ErrorValidacion(`El XML ${deQue} debe venir en bytes (Buffer) y no estar vacío.`);
    }
    if (typeof nombreArchivo !== 'string' || nombreArchivo === '') {
      throw new ErrorValidacion('El nombre del archivo no puede estar vacío.');
    }

    // Mismo orden de campos que el arreglo de CURLOPT_POSTFIELDS del PHP.
    const multipart = armarMultipart(
      [
        { nombre: 'rutSender', valor: envia.numero },
        { nombre: 'dvSender', valor: envia.dv },
        { nombre: 'rutCompany', valor: emisor.numero },
        { nombre: 'dvCompany', valor: emisor.dv },
        { nombre: 'archivo', archivo: xml, nombreArchivo, contentType: 'text/xml' },
      ],
      this.#boundary(),
    );

    const url = `${this.urls.envio}/${recurso}`;
    const peticion: PeticionHttp = {
      metodo: 'POST',
      url,
      cabeceras: {
        Accept: '*/*',
        Cookie: `TOKEN=${token}`,
        'User-Agent': USER_AGENT_BOLETA_REST,
      },
      cuerpo: { tipo: 'crudo', datos: multipart.datos, contentType: multipart.contentType },
      descomprimir: false,
      conexionNueva: true,
    };
    const respuesta = await this.#transporte.enviar(peticion);
    exigir200ConExtracto(respuesta, url, token);

    const json = leerJsonObjeto(respuesta, token, `El SII no confirmó la recepción ${deQue}`);
    const trackId = textoTrackId(json.trackid);
    const estado = texto(json.estado);
    if (trackId === undefined) {
      throw new ErrorRespuestaSii(
        `El SII no devolvió el trackid ${deQue}${estado === '' ? '' : ` (estado ${limpiar(estado)})`}.`,
        estado === '' ? {} : { estado },
      );
    }
    return Object.freeze({
      trackId,
      estado,
      fechaRecepcion: texto(json.fecha_recepcion),
      rutEmisor: texto(json.rut_emisor),
      rutEnvia: texto(json.rut_envia),
      archivo: texto(json.file),
      json,
    });
  }
}

// --- Validaciones -------------------------------------------------------------

/**
 * Un token tiene que poder ir en `Cookie: TOKEN=<token>` sin romper la cabecera:
 * ASCII visible, sin espacios ni `;`. (Los del SII son alfanuméricos.)
 */
function tokenValido(token: unknown): token is string {
  return typeof token === 'string' && /^[\x21-\x3a\x3c-\x7e]+$/.test(token);
}

function exigirToken(token: string): void {
  if (!tokenValido(token)) {
    // Sin el token en el mensaje.
    throw new ErrorValidacion('El token del SII está vacío o tiene caracteres inválidos.');
  }
}

function aRut(rut: string | Rut, campo: string): Rut {
  return typeof rut === 'string' ? Rut.de(rut, campo) : rut;
}

function urlBase(url: string): string {
  try {
    new URL(url);
  } catch {
    throw new TypeError(`URL base inválida: ${url}`);
  }
  return url.replace(/\/+$/, '');
}

// --- Lectura de respuestas ----------------------------------------------------

const LARGO_EXTRACTO = 200;

/** Espacios y controles seguidos → un espacio; recorta a `LARGO_EXTRACTO` code points. */
function limpiar(textoCrudo: string): string {
  const limpio = textoCrudo.replace(/[\s\p{Cc}]+/gu, ' ').trim();
  return largoCodePoints(limpio) > LARGO_EXTRACTO
    ? `${truncarCodePoints(limpio, LARGO_EXTRACTO)}…`
    : limpio;
}

/**
 * Error para una respuesta 200 sin `<SEMILLA>` o `<TOKEN>`. Lleva solo el
 * `ESTADO` y la `GLOSA` del SII (`[^<]*`: no pueden traer el contenido de otro
 * elemento, como un `<TOKEN>` mal formado). Nunca un extracto del cuerpo: la
 * respuesta del token podría traer el token.
 */
function errorSinDato(que: string, cuerpo: string): ErrorRespuestaSii {
  const estado = /<ESTADO>([^<]*)<\/ESTADO>/.exec(cuerpo)?.[1];
  const glosa = /<GLOSA>([^<]*)<\/GLOSA>/.exec(cuerpo)?.[1];
  const datos: { estado?: string; glosa?: string } = {};
  if (estado !== undefined && limpiar(estado) !== '') datos.estado = limpiar(estado);
  if (glosa !== undefined && limpiar(glosa) !== '') datos.glosa = limpiar(glosa);
  const detalle = [datos.estado && `ESTADO ${datos.estado}`, datos.glosa]
    .filter((parte) => parte !== undefined && parte !== '')
    .join(': ');
  return new ErrorRespuestaSii(
    `El SII no entregó ${que}${detalle === '' ? '' : ` (${detalle})`}.`,
    datos,
  );
}

/**
 * Extracto de una respuesta para un mensaje de error: sin el token (ni otro
 * `TOKEN=`/`<TOKEN>`), sin espacios repetidos y corto. Si parece traer material
 * de firma (PEM o una `<Signature>`), se omite entero.
 */
function extracto(cuerpo: Buffer, token: string): string {
  let textoCuerpo = decodificarUtf8OIso(cuerpo);
  if (/-----BEGIN |<(?:\w+:)?Signature[\s>]|X509Certificate/i.test(textoCuerpo)) return '';
  textoCuerpo = textoCuerpo
    .replaceAll(token, '[omitido]')
    .replace(/TOKEN=[^;\s"'<>&]*/gi, 'TOKEN=[omitido]')
    .replace(/<TOKEN>[^<]*<\/TOKEN>/gi, '<TOKEN>[omitido]</TOKEN>');
  return limpiar(textoCuerpo);
}

/** Como `exigirStatus(…, 200)`, con un extracto saneado de la respuesta en el mensaje. */
function exigir200ConExtracto(respuesta: RespuestaHttp, url: string, token: string): void {
  try {
    exigirStatus(respuesta, url);
  } catch (error) {
    if (!(error instanceof ErrorTransporte)) throw error;
    const detalle = extracto(respuesta.cuerpo, token);
    throw new ErrorTransporte(
      detalle === '' ? error.message : `${error.message} Respuesta del SII: ${detalle}`,
      error.url,
      error.status,
    );
  }
}

/**
 * El cuerpo como objeto JSON no vacío (el PHP exigía `json_decode` verdadero: un
 * `{}` también era error).
 */
function leerJsonObjeto(
  respuesta: RespuestaHttp,
  token: string,
  mensaje: string,
): Readonly<Record<string, unknown>> {
  let datos: unknown;
  try {
    datos = JSON.parse(decodificarUtf8OIso(respuesta.cuerpo));
  } catch {
    datos = undefined;
  }
  if (!esObjeto(datos) || Object.keys(datos).length === 0) {
    const detalle = extracto(respuesta.cuerpo, token);
    throw new ErrorRespuestaSii(
      detalle === '' ? `${mensaje}.` : `${mensaje}. Respuesta del SII: ${detalle}`,
    );
  }
  return datos;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

/** Entero no negativo desde un número o un texto de dígitos. */
function entero(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0) return valor;
  if (typeof valor === 'string' && /^[0-9]{1,15}$/.test(valor.trim())) return Number(valor.trim());
  return undefined;
}

/** El trackid viene como número; se acepta también como texto de dígitos. */
function textoTrackId(valor: unknown): string | undefined {
  if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0) return String(valor);
  if (typeof valor === 'string' && /^[0-9]+$/.test(valor.trim()) && Number(valor) > 0) {
    return valor.trim();
  }
  return undefined;
}

function objetos(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter(esObjeto) : [];
}
