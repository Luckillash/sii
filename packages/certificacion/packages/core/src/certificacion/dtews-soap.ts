// Deriva de winex/certificacion v1.9.1 (src/Certificacion/SiiSoapClient.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript
// con transporte inyectable, errores tipados, RUT validado, revisión del código
// HTTP y caché de token inyectable (la misma API de token que la REST).
//
// Canal SOAP DTEWS de maullin (certificación) y palena (producción): semilla
// (CrSeed), token (GetTokenFromSeed), subida de DTE/RCOF (cgi_dte/UPL/DTEUpload)
// y estado de un envío (QueryEstUp.getEstUp).
//
// Paridad con el PHP: las peticiones (método, ruta, cabeceras y cuerpo) son byte
// a byte las mismas en el cable, salvo `Connection` (paridad/casos/http-dtews-*,
// servidor de captura). La firma de la semilla es la del PHP, no la de
// `firmarSemilla()` (ver firma-semilla-dtews.ts).
//
// Peticiones:
// - Semilla, token y estado: como `file_get_contents` del PHP. `Content-Type:
//   text/xml; charset=utf-8` y `SOAPAction: ""`, sin `Accept` ni
//   `Accept-Encoding` (`descomprimir: false`, decidido). El PHP abría una
//   conexión por petición (`Connection: close`); aquí se reutilizan, como decidió
//   el plan para todo lo que se puede repetir sin consecuencias.
// - DTEUpload: como el cURL del PHP. `Accept: */*` (cURL lo agrega solo),
//   `Cookie: TOKEN=…`, el User-Agent fijo del PHP (distinto del de la API REST),
//   sin `Expect` y en una conexión propia (`conexionNueva`, decidido: no se puede
//   repetir sin riesgo de subir dos veces).
//
// Diferencias con el PHP que no cambian los bytes enviados:
// - Código HTTP (pend. 1.9): el PHP usaba `ignore_errors` y nunca lo miraba. Aquí
//   un 200 sigue igual; un fault SOAP (el Axis del SII responde HTTP 500 con
//   `<soapenv:Fault>`) lanza `ErrorRespuestaSii` con el `faultcode` y el
//   `faultstring`; cualquier otro código lanza `ErrorTransporte` con el status
//   (p. ej. el 503 ocasional de maullin en QueryEstUp: quien llama reintenta).
//   Tampoco se siguen redirecciones (`file_get_contents` sí las seguía).
// - Errores tipados y mensajes sin token, cookies, PEM ni XML firmado. El PHP
//   ponía la respuesta cruda en el mensaje; aquí van el ESTADO y la GLOSA del SII
//   o, si no vienen, un extracto sin etiquetas, sin el token y truncado.
// - RUT validado con `Rut` (el PHP hacía `explode('-')`): con un RUT ya normalizado
//   (`76543210-K`) se envían los mismos bytes; uno con puntos, ceros a la izquierda
//   o `k` minúscula se normaliza (el PHP lo enviaba tal cual y el SII lo rechazaba).
// - Un token vacío o con caracteres raros se rechaza antes de usarlo, y un TrackID
//   que no es numérico se informa como error en vez de devolverse.
// - El archivo se recibe en memoria (`Buffer` en ISO-8859-1, como lo entregan
//   `EnvioBoleta` y el RCOF), sin archivos temporales.

import { createHash, type KeyObject, X509Certificate } from 'node:crypto';
import { type Ambiente, datosAmbiente } from '../comun/ambiente.ts';
import { decodificarUtf8OIso, escaparXml, truncarCodePoints } from '../comun/codificacion.ts';
import { decodificarEntidadesHtml } from '../comun/entidades-html.ts';
import {
  ErrorCertificado,
  ErrorRespuestaSii,
  ErrorTransporte,
  ErrorValidacion,
} from '../comun/errores.ts';
import { armarMultipart } from '../comun/http/multipart.ts';
import { exigirStatus, hostDe, type RespuestaHttp } from '../comun/http/respuesta.ts';
import type { PeticionHttp, TransporteHttp } from '../comun/http/transporte.ts';
import { type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import {
  type ClaveToken,
  huellaCertificado,
  type TokenStore,
  TokenStoreMemoria,
} from '../comun/token-store.ts';
import { SEGUNDOS_VIGENCIA_TOKEN } from '../produccion/boleta-rest.ts';
import { EstadoEnvio } from './estado-envio.ts';
import { firmarSemillaDtews, llaveDtews, sobreGetToken } from './firma-semilla-dtews.ts';

export const RUTA_SEMILLA = '/DTEWS/CrSeed.jws';
export const RUTA_TOKEN = '/DTEWS/GetTokenFromSeed.jws';
export const RUTA_ESTADO = '/DTEWS/QueryEstUp.jws';
export const RUTA_UPLOAD = '/cgi_dte/UPL/DTEUpload';

/** User-Agent fijo del PHP para DTEUpload. No es el de la API REST de boleta. */
export const USER_AGENT_DTEUPLOAD = 'Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.1)';

const CONTENT_TYPE_SOAP = 'text/xml; charset=utf-8';
/** Mismas cabeceras y en el mismo orden que el `stream_context_create` del PHP. */
const CABECERAS_SOAP: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': CONTENT_TYPE_SOAP,
  SOAPAction: '""',
});

const SOBRE_SEMILLA =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/>' +
  '<soapenv:Body><getSeed/></soapenv:Body></soapenv:Envelope>';

/**
 * Un token tiene que poder ir en `Cookie: TOKEN=<token>` sin romper la cabecera:
 * ASCII visible, sin espacios ni `;` (la misma regla que la API REST; los del SII
 * son alfanuméricos).
 */
const TOKEN_VALIDO = /^[\x21-\x3A\x3C-\x7E]+$/;
const TRACKID_VALIDO = /^\d{1,15}$/;
/** Largo máximo del extracto de una respuesta en un mensaje (como el `mb_substr(…, 0, 200)` del PHP). */
const LARGO_DETALLE = 200;

/**
 * Glosa de cada `STATUS` de DTEUpload, según la documentación del SII para el
 * envío automático de documentos.
 */
const STATUS_UPLOAD: ReadonlyMap<string, string> = new Map([
  ['1', 'el usuario que envía no tiene permiso para enviar'],
  ['2', 'error en el tamaño del archivo (muy grande o muy chico)'],
  ['3', 'archivo cortado (el tamaño no coincide)'],
  ['5', 'no está autenticado (token inválido o vencido)'],
  ['6', 'la empresa no está autorizada a enviar archivos'],
  ['7', 'esquema inválido'],
  ['8', 'error en la firma del documento'],
  ['9', 'sistema bloqueado'],
]);

/**
 * Llave y certificado con que se firma la semilla. Un `Certificado`
 * (`core/certificado.ts`) sirve tal cual.
 */
export interface CredencialesDtews {
  /** Llave privada RSA en PEM, sin cifrar. */
  readonly llavePrivada: string;
  /**
   * Va TAL CUAL a `<X509Certificate>`, como el `$publicKeyLimpia` del PHP. Rareza
   * conocida (pend. 1.3): pese al nombre, los scripts del PHP le pasan
   * `Certificate::getPublicKey()`, que es el PEM completo (con `-----BEGIN
   * CERTIFICATE-----`, saltos de línea y, si el .pfx se leyó por la ruta nativa,
   * un `\n` final), y el SII lo acepta así. `Certificado.certificado` entrega
   * exactamente esos bytes. No se limpia: limpiarlo cambia lo que se envía al SII.
   */
  readonly certificado: string;
}

export interface OpcionesClienteDtews {
  /** `certificacion` → maullin.sii.cl; `produccion` → palena.sii.cl. */
  readonly ambiente: Ambiente;
  /** Transporte HTTP (`TransporteUndici` en producción; `TransporteFalso` en tests). */
  readonly transporte: TransporteHttp;
  /** Caché de tokens para `obtenerToken`. Por defecto, uno en memoria propio de este cliente. */
  readonly tokenStore?: TokenStore;
  /** Reloj para la vigencia de los tokens. Por defecto, el del sistema. */
  readonly reloj?: Reloj;
  /**
   * **Solo para tests** (servidor de captura, PLAN §5.3): reemplaza
   * `https://{host del ambiente}`. Nunca apuntar a otro servidor en producción:
   * recibiría el token.
   */
  readonly urlBase?: string;
}

/** Un archivo para subir con DTEUpload (sobre EnvioBOLETA o RCOF ya firmado). */
export interface ArchivoDte {
  /** Empresa emisora (`rutCompany` / `dvCompany`). */
  readonly rutEmisor: string | Rut;
  /** Persona que envía, titular del certificado (`rutSender` / `dvSender`). */
  readonly rutEnvia: string | Rut;
  /** Bytes exactos del XML (ISO-8859-1). */
  readonly xml: Uint8Array;
  /** Nombre con que lo recibe el SII, sin ruta (el PHP usaba `basename($ruta)`). */
  readonly nombreArchivo: string;
}

/**
 * Cliente del canal SOAP DTEWS. Misma forma que `ClienteBoletaRest`:
 * `solicitarToken()` pide siempre uno nuevo; `obtenerToken(rut)` usa el caché.
 *
 * ```ts
 * const sii = new ClienteDtews(certificado, { ambiente: 'certificacion', transporte });
 * const token = await sii.obtenerToken('76543210-3');
 * const trackId = await sii.enviarDte(token, { rutEmisor, rutEnvia, xml, nombreArchivo });
 * const estado = await sii.estadoEnvio(token, rutEmisor, trackId);
 * ```
 */
export class ClienteDtews {
  readonly ambiente: Ambiente;
  readonly #urlBase: string;
  readonly #llave: KeyObject;
  readonly #certificado: string;
  readonly #transporte: TransporteHttp;
  readonly #tokenStore: TokenStore;
  readonly #reloj: Reloj;
  /** Huella del certificado para la clave del caché (se calcula al usarla). */
  #huella: string | undefined;
  /** Pedidos de token en curso, por RUT de empresa: dos llamadas simultáneas comparten uno. */
  readonly #enCurso = new Map<string, Promise<string>>();

  /**
   * @param certificado firma la semilla. Un `Certificado` (`core/certificado.ts`)
   *   sirve tal cual: su `certificado` va a `<X509Certificate>` con los mismos bytes
   *   que el PHP (ver `CredencialesDtews`).
   * @throws ErrorFirma si la llave privada no es un PEM legible
   * @throws ErrorValidacion si `urlBase` no es válida
   * @throws TypeError si el ambiente no es válido
   */
  constructor(certificado: CredencialesDtews, opciones: OpcionesClienteDtews) {
    this.ambiente = opciones.ambiente;
    const { host } = datosAmbiente(opciones.ambiente);
    this.#urlBase =
      opciones.urlBase === undefined ? `https://${host}` : leerUrlBase(opciones.urlBase);
    this.#llave = llaveDtews(certificado.llavePrivada);
    this.#certificado = certificado.certificado;
    this.#transporte = opciones.transporte;
    this.#tokenStore = opciones.tokenStore ?? new TokenStoreMemoria();
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * Pide una semilla a `CrSeed.getSeed`.
   *
   * @throws ErrorTransporte si no hubo respuesta o el código HTTP no es 200
   * @throws ErrorRespuestaSii si el SII respondió con un fault o sin `<SEMILLA>` numérica
   */
  async obtenerSemilla(): Promise<string> {
    const texto = decodificarEntidadesHtml(
      await this.#soap('pedir la semilla', RUTA_SEMILLA, SOBRE_SEMILLA),
    );
    const semilla = /<SEMILLA>([0-9]+)<\/SEMILLA>/.exec(texto)?.[1];
    if (semilla === undefined) throw errorDelSii('El SII no entregó la semilla', texto);
    return semilla;
  }

  /**
   * Semilla → firma (la del PHP) → token de `GetTokenFromSeed.getToken`, **sin
   * caché** (como `getToken()` del PHP). Para que una app guarde el token con su
   * propio mecanismo; si no, usar `obtenerToken`.
   *
   * @throws ErrorTransporte si no hubo respuesta o el código HTTP no es 200
   * @throws ErrorRespuestaSii si el SII no entregó el token (p. ej. ESTADO 11, firma rechazada)
   */
  async solicitarToken(): Promise<string> {
    const semilla = await this.obtenerSemilla();
    const xmlFirmado = firmarSemillaDtews(semilla, this.#llave, this.#certificado);
    const texto = decodificarEntidadesHtml(
      await this.#soap('canjear el token', RUTA_TOKEN, sobreGetToken(xmlFirmado)),
    );

    // `.` de PCRE sin /s: todo menos \n (el `.` de JS tampoco toma \r ni U+2028/9).
    const token = /<TOKEN>([^\n]*?)<\/TOKEN>/.exec(texto)?.[1];
    if (token === undefined) throw errorDelSii('El SII no entregó el token', texto);
    if (!TOKEN_VALIDO.test(token)) {
      // El PHP lo devolvía igual (incluso vacío) y fallaba después.
      throw new ErrorRespuestaSii(
        'El SII entregó un token vacío o con caracteres inesperados.',
        datosRespuesta(texto),
      );
    }
    return token;
  }

  /**
   * Token para operar a nombre de la empresa: el del caché si sigue vigente, o uno
   * nuevo que se guarda por `SEGUNDOS_VIGENCIA_TOKEN` (la misma regla que la API
   * REST). Si el SII rechaza el token antes de que venza, llamar a `olvidarToken`.
   *
   * @throws ErrorValidacion si el RUT no es válido
   * @throws ErrorCertificado si el certificado no se puede leer para calcular su huella.
   *   Además, los de `solicitarToken` y los del `TokenStore`.
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
   * Clave del caché para la empresa con este certificado y ambiente (canal `soap`).
   *
   * @throws ErrorValidacion si el RUT no es válido
   * @throws ErrorCertificado si el certificado no se puede leer para calcular su huella
   */
  claveToken(rutEmpresa: string | Rut): ClaveToken {
    const rut = aRut(rutEmpresa, 'RUT de la empresa');
    this.#huella ??= huellaDe(this.#certificado);
    return Object.freeze({
      canal: 'soap',
      ambiente: this.ambiente,
      rutEmpresa: rut.toString(),
      huellaCertificado: this.#huella,
    });
  }

  /**
   * Sube un sobre EnvioBOLETA o un RCOF firmado a `cgi_dte/UPL/DTEUpload` y
   * devuelve el TrackID.
   *
   * No se reintenta solo: si falla después de enviar, el archivo puede haber
   * llegado. Antes de volver a subirlo, revisa los envíos de la empresa.
   *
   * @throws ErrorValidacion si un RUT, el token o el nombre del archivo no son válidos
   * @throws ErrorTransporte si no hubo respuesta o el código HTTP no es 200
   * @throws ErrorRespuestaSii si el SII no devolvió un TrackID (con el `STATUS` en `estado`)
   */
  async enviarDte(token: string, archivo: ArchivoDte): Promise<string> {
    exigirToken(token);
    const empresa = aRut(archivo.rutEmisor, 'RUT del emisor');
    const envia = aRut(archivo.rutEnvia, 'RUT de quien envía');
    const { nombreArchivo } = archivo;
    if (nombreArchivo === '' || /[/\\]/.test(nombreArchivo)) {
      throw new ErrorValidacion('El nombre del archivo no puede estar vacío ni incluir una ruta.');
    }

    // Mismos campos y en el mismo orden que el CURLOPT_POSTFIELDS del PHP.
    const multipart = armarMultipart([
      { nombre: 'rutSender', valor: envia.numero },
      { nombre: 'dvSender', valor: envia.dv },
      { nombre: 'rutCompany', valor: empresa.numero },
      { nombre: 'dvCompany', valor: empresa.dv },
      { nombre: 'archivo', archivo: archivo.xml, nombreArchivo, contentType: 'text/xml' },
    ]);

    const url = this.#url(RUTA_UPLOAD);
    const respuesta = await this.#enviar('subir el archivo', {
      metodo: 'POST',
      url,
      cabeceras: {
        Accept: '*/*',
        Cookie: `TOKEN=${token}`,
        'User-Agent': USER_AGENT_DTEUPLOAD,
      },
      cuerpo: { tipo: 'crudo', datos: multipart.datos, contentType: multipart.contentType },
      descomprimir: false,
      conexionNueva: true,
    });
    exigirStatus(respuesta, url, 200);

    // El PHP busca <TRACKID> en la respuesta cruda, sin decodificar entidades.
    const texto = decodificarUtf8OIso(respuesta.cuerpo);
    const trackId = /<TRACKID>([^\n]*?)<\/TRACKID>/.exec(texto)?.[1];
    if (trackId !== undefined && TRACKID_VALIDO.test(trackId)) return trackId;

    const status = /<STATUS>\s*([^<]*?)\s*<\/STATUS>/.exec(texto)?.[1];
    const errores = [...texto.matchAll(/<ERROR>([^<]*)<\/ERROR>/g)].map((m) => m[1] ?? '');
    const glosa = sanear(
      errores.length > 0 ? errores.join('; ') : (STATUS_UPLOAD.get(status ?? '') ?? ''),
      [token],
    );
    const datos: { estado?: string; glosa?: string } = {};
    if (status !== undefined && status !== '') datos.estado = sanear(status, [token]);
    if (glosa !== '') datos.glosa = glosa;

    let mensaje = 'El SII no devolvió el TrackID del archivo subido';
    if (datos.estado !== undefined) {
      mensaje += ` (STATUS ${datos.estado}${glosa !== '' ? `: ${glosa}` : ''})`;
    } else if (trackId !== undefined) {
      mensaje += ' (el TrackID no es numérico)';
    } else {
      mensaje += `: ${sanear(texto, [token]) || 'respuesta vacía'}`;
    }
    throw new ErrorRespuestaSii(`${mensaje}.`, datos);
  }

  /**
   * Estado de un envío por TrackID (`QueryEstUp.getEstUp`). Solo lectura: se
   * puede repetir. Maullin responde 503 de vez en cuando (`ErrorTransporte` con
   * `status` 503): quien llama vuelve a consultar más tarde.
   *
   * @throws ErrorValidacion si el TrackID, el RUT o el token no son válidos
   * @throws ErrorTransporte si no hubo respuesta o el código HTTP no es 200
   * @throws ErrorRespuestaSii si el SII respondió con un fault o sin el estado
   */
  async estadoEnvio(
    token: string,
    rutEmpresa: string | Rut,
    trackId: string,
  ): Promise<EstadoEnvio> {
    // Más estricto que el `$` de PCRE, que acepta un "\n" final.
    if (typeof trackId !== 'string' || !TRACKID_VALIDO.test(trackId)) {
      throw new ErrorValidacion(`TrackID inválido: ${truncarCodePoints(String(trackId), 40)}.`);
    }
    exigirToken(token);
    const rut = aRut(rutEmpresa, 'RUT de la empresa');

    // htmlspecialchars() por defecto, como el PHP (el DV ya viene en mayúscula).
    const xml =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
      '<ns:getEstUp xmlns:ns="http://DefaultNamespace">' +
      `<RutCompania>${escaparXml(rut.numero, 'defecto')}</RutCompania>` +
      `<DvCompania>${escaparXml(rut.dv, 'defecto')}</DvCompania>` +
      `<TrackId>${trackId}</TrackId><Token>${escaparXml(token, 'defecto')}</Token>` +
      '</ns:getEstUp></soapenv:Body></soapenv:Envelope>';

    const texto = await this.#soap('consultar el estado del envío', RUTA_ESTADO, xml, [token]);
    if (!texto.includes('getEstUpReturn')) {
      throw new ErrorRespuestaSii(
        `El SII no respondió el estado del envío ${trackId}: ` +
          `${sanear(decodificarEntidadesHtml(texto), [token]) || 'respuesta vacía'}.`,
      );
    }
    return EstadoEnvio.desdeRespuesta(texto, trackId);
  }

  async #tokenDeCacheONuevo(clave: ClaveToken): Promise<string> {
    const guardado = await this.#tokenStore.obtener(clave);
    if (
      guardado !== undefined &&
      TOKEN_VALIDO.test(guardado.token) &&
      this.#reloj.ahora().getTime() < guardado.venceEn.getTime()
    ) {
      return guardado.token;
    }

    const token = await this.solicitarToken();
    // Como la API REST: la vigencia corre desde que se recibió el token.
    const venceEn = new Date(this.#reloj.ahora().getTime() + SEGUNDOS_VIGENCIA_TOKEN * 1000);
    await this.#tokenStore.guardar(clave, { token, venceEn });
    return token;
  }

  #url(ruta: string): string {
    return `${this.#urlBase}${ruta}`;
  }

  /** Envía y agrega a una falla de red el paso que se intentaba (como `errorDeConexion` del PHP). */
  async #enviar(paso: string, peticion: PeticionHttp): Promise<RespuestaHttp> {
    try {
      return await this.#transporte.enviar(peticion);
    } catch (error) {
      if (error instanceof ErrorTransporte) {
        throw new ErrorTransporte(
          `No se pudo conectar con ${hostDe(peticion.url)} para ${paso}: ${error.message}`,
          error.url,
          error.status,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * POST SOAP con la semántica de `file_get_contents` del PHP. Devuelve el cuerpo
   * como texto (UTF-8, o ISO-8859-1 si no es UTF-8 válido), sin decodificar entidades.
   */
  async #soap(
    paso: string,
    ruta: string,
    sobre: string,
    secretos: readonly string[] = [],
  ): Promise<string> {
    const url = this.#url(ruta);
    const respuesta = await this.#enviar(paso, {
      metodo: 'POST',
      url,
      cabeceras: CABECERAS_SOAP,
      cuerpo: { tipo: 'crudo', datos: sobre, contentType: CONTENT_TYPE_SOAP },
      descomprimir: false,
    });
    const texto = decodificarUtf8OIso(respuesta.cuerpo);

    if (respuesta.status !== 200) {
      const decodificado = decodificarEntidadesHtml(texto);
      const faultstring = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(decodificado)?.[1];
      if (faultstring !== undefined) {
        const faultcode = /<faultcode>([\s\S]*?)<\/faultcode>/.exec(decodificado)?.[1];
        const glosa = sanear(faultstring, secretos);
        const datos: { estado?: string; glosa?: string } = { glosa };
        if (faultcode !== undefined) datos.estado = sanear(faultcode, secretos);
        throw new ErrorRespuestaSii(
          `El SII respondió con un error SOAP (HTTP ${respuesta.status}) al ${paso}: ${glosa || 'sin detalle'}.`,
          datos,
        );
      }
      exigirStatus(respuesta, url, 200);
    }
    return texto;
  }
}

// --- Respuestas ---------------------------------------------------------------

/** `ESTADO` y `GLOSA` de una respuesta del SII ya decodificada, o el fault SOAP. */
function datosRespuesta(texto: string): { estado?: string; glosa?: string } {
  const datos: { estado?: string; glosa?: string } = {};
  const estado =
    /<ESTADO>([^<]*)<\/ESTADO>/.exec(texto)?.[1] ??
    /<faultcode>([^<]*)<\/faultcode>/.exec(texto)?.[1];
  const glosa =
    /<GLOSA>([^<]*)<\/GLOSA>/.exec(texto)?.[1] ??
    /<faultstring>([^<]*)<\/faultstring>/.exec(texto)?.[1];
  const estadoLimpio = estado === undefined ? '' : sanear(estado, []);
  const glosaLimpia = glosa === undefined ? '' : sanear(glosa, []);
  if (estadoLimpio !== '') datos.estado = estadoLimpio;
  if (glosaLimpia !== '') datos.glosa = glosaLimpia;
  return datos;
}

/** Error para una respuesta (ya decodificada) que no trae lo esperado. */
function errorDelSii(inicio: string, texto: string): ErrorRespuestaSii {
  const datos = datosRespuesta(texto);
  let mensaje = inicio;
  if (datos.estado !== undefined || datos.glosa !== undefined) {
    mensaje += ` (ESTADO ${datos.estado ?? '?'}${datos.glosa !== undefined ? `: ${datos.glosa}` : ''})`;
  } else {
    mensaje += `: ${sanear(texto, []) || 'respuesta vacía'}`;
  }
  return new ErrorRespuestaSii(`${mensaje}.`, datos);
}

/**
 * Texto apto para un mensaje: sin los secretos (el token), sin bloques PEM, sin
 * etiquetas, sin tiras base64 largas (firmas, certificados), con los blancos
 * colapsados y truncado a 200 caracteres.
 */
export function sanear(texto: string, secretos: readonly string[]): string {
  let limpio = texto;
  for (const secreto of secretos) {
    if (secreto !== '') limpio = limpio.replaceAll(secreto, '[omitido]');
  }
  limpio = limpio
    .replace(/-----BEGIN [^-]*-----[\s\S]*?(?:-----END [^-]*-----|$)/g, '[PEM omitido]')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[omitido]')
    .replace(/\s+/g, ' ')
    .trim();
  const truncado = truncarCodePoints(limpio, LARGO_DETALLE);
  return truncado.length < limpio.length ? `${truncado}…` : truncado;
}

// --- Entradas -----------------------------------------------------------------

function aRut(rut: string | Rut, campo: string): Rut {
  return rut instanceof Rut ? rut : Rut.de(rut, campo);
}

function exigirToken(token: string): void {
  // Sin el token en el mensaje.
  if (typeof token !== 'string' || !TOKEN_VALIDO.test(token)) {
    throw new ErrorValidacion('El token del SII está vacío o tiene caracteres inválidos.');
  }
}

function leerUrlBase(urlBase: string): string {
  let url: URL;
  try {
    url = new URL(urlBase);
  } catch (error) {
    throw new ErrorValidacion('La URL base del cliente DTEWS no es válida.', { cause: error });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ErrorValidacion('La URL base del cliente DTEWS debe ser http o https.');
  }
  return urlBase.replace(/\/+$/, '');
}

/**
 * Huella del certificado (`huellaCertificado` de token-store) para un PEM, o la
 * misma (sha256 en hex del DER) para un certificado en base64 sin encabezados.
 */
function huellaDe(certificado: string): string {
  if (certificado.includes('-----BEGIN')) return huellaCertificado(certificado);
  let der: Buffer;
  try {
    der = new X509Certificate(Buffer.from(certificado, 'base64')).raw;
  } catch (error) {
    throw new ErrorCertificado('No se pudo leer el certificado para calcular su huella.', {
      cause: error,
    });
  }
  return createHash('sha256').update(der).digest('hex');
}

/** Se movió a `comun/entidades-html.ts` (fase 5); se reexporta para no romper importaciones. */
export { decodificarEntidadesHtml } from '../comun/entidades-html.ts';
