// Declaración de cumplimiento de requisitos de Boleta Electrónica (el último paso
// de la certificación) y los trámites del mismo portal: estado, revisión del set y
// descarga del set de pruebas.
//
// Deriva de winex/certificacion v1.9.1 (src/Postulacion/DeclaracionBoletas.php,
// src/Postulacion/DeclaracionInciertaException.php y
// src/Postulacion/SetSinDescargarException.php), © 2026 Meniaz (William Menares),
// Apache-2.0. Modificado: port a TypeScript.
//
// Lo que se envía al SII (URLs, cabeceras, cuerpos GWT-RPC y la query de
// `DownloadFileServlet`) es idéntico al PHP; lo comparan los casos
// `http-declaracion-*` con el servidor de captura (PLAN §5.3) y los `gwt-llamada-*`.
//
// Cambios respecto del PHP (ninguno cambia bytes enviados al SII):
// - pend. 1.9 (códigos HTTP): en cada llamada GWT se revisa primero la sesión (como
//   el PHP) y después el código; un HTTP distinto de 200 lanza `ErrorTransporte`
//   (reintentable, con `status`) en vez de `PostulacionException`. Igual en
//   `verificarPortal()` (código distinto de 200 y 404) y en `descargarSetPruebas()`
//   (código distinto de 200; con 200 y sin el set sigue siendo `ErrorPostulacion`).
//   Antes de la orden de declarar nada graba, así que reintentar es seguro.
// - Las fallas de red salen como `ErrorTransporte` (el PHP las envolvía en
//   `PostulacionException`), salvo desde el POST de `autorizarEmpresaBolProd`.
// - **Declaración incierta:** desde que sale el POST de `autorizarEmpresaBolProd`,
//   CUALQUIER falla (red, HTTP distinto de 200, sesión caducada, redirección fuera
//   del host, respuesta GWT mal formada, `//EX`, respuesta sin P91) termina en
//   `DeclaracionInciertaError`, con la causa en `cause`. En el PHP la red llegaba
//   envuelta en `PostulacionException` y caía en el mismo `catch`; aquí hay que
//   capturarla explícitamente porque `NavegadorSii` no la envuelve. El PHP no miraba
//   el código HTTP de esa respuesta (un 500 con un `//OK` y P91 habría contado como
//   declarada); aquí un código distinto de 200 es incierta. Ese POST va por una
//   conexión propia (`conexionNueva`, decisión de la fase 4).
// - pend. 2.3: los RUT pasan por `Rut` (`ErrorValidacion` si no son válidos; el PHP
//   lanzaba `PostulacionException`). El trackId inválido también es `ErrorValidacion`,
//   y se exige sin el salto de línea final que el `$` de PCRE dejaba pasar
//   (`"123\n"` el PHP lo aceptaba y lo enviaba).
// - `estado()` exige que la respuesta sea un `EstadoAutorizaTo` (el PHP tomaba por
//   posición los campos de cualquier DTO, o fallaba con un `TypeError` si no era un
//   DTO); un paso numérico que no cabe en un entero seguro lanza en vez de saturar.
// - La fecha de hoy (`d-m-Y` en America/Santiago) sale del reloj inyectable.

import { decodificarUtf8OIso } from '../comun/codificacion.ts';
import {
  DeclaracionInciertaError,
  ErrorPostulacion,
  ErrorTransporte,
  ErrorValidacion,
  SesionCaducaError,
  SetSinDescargarError,
} from '../comun/errores.ts';
import { codificarFormulario } from '../comun/http/formulario.ts';
import type { RespuestaHttp } from '../comun/http/respuesta.ts';
import type { TransporteHttp } from '../comun/http/transporte.ts';
import { TransporteUndici } from '../comun/http/transporte-undici.ts';
import { fechaSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import { Rut } from '../comun/rut.ts';
import { SesionSii } from '../folios/sesion-sii.ts';
import { type DatosDeclaracion, validarCorreo } from './datos-postulacion.ts';
import { EstadoDeclaracion } from './estado-declaracion.ts';
import {
  esDtoGwt,
  esListaGwt,
  GwtRpc,
  type LectorGwt,
  type ObjetoGwt,
  type ParametroGwt,
} from './gwt-rpc.ts';
import { NavegadorSii } from './navegador-sii.ts';

/** Host del portal de la declaración (el mismo en certificación y producción). */
export const HOST_DECLARACION = 'www4.sii.cl';

/** Base de la app GWT `certBolElectDteInternet` (capturada el 2026-09-14, versión 1.0.55). */
export const BASE_DECLARACION = `https://${HOST_DECLARACION}/certBolElectDteInternet/`;

/** Hash de la política de serialización de la versión capturada del portal. */
export const POLICY_DECLARACION = '082D0AC4BC4D75A5DF38F116C53877D4';

/** Permutación (archivo `<PERMUTACION>.cache.html`) de la versión capturada. */
export const PERMUTACION_DECLARACION = '0FC3D987613537E6E13E9BB93A406F13';

/** Servicio GWT del portal. */
export const SERVICIO_DECLARACION = 'cl.sii.sdi.diii.certBolElectDte.web.client.service.Facade';

/** Paso "declarar cumplimiento" del set de boletas. */
export const PASO_DECLARACION = 90;

/** Tope de cada petición, en ms (PHP: 45 s). */
export const MS_DECLARACION = 45_000;

/** Firmas de tipo de los DTO del portal (cambian si el SII cambia un DTO). */
export const FIRMAS_DECLARACION = Object.freeze({
  estado: 'cl.sii.sdi.diii.certBolElectDte.to.EstadoAutorizaTo/1011533792',
  postulacion: 'cl.sii.sdi.diii.certBolElectDte.to.PostulSegHistInsUpdTo/138688689',
  empresaAutorizada: 'cl.sii.sdi.diii.certBolElectDte.to.TdtEmpresaAutorizadaTo/2240026086',
  documento: 'cl.sii.sdi.diii.certBolElectDte.to.DocumentoAutorizadoTo/493967287',
});

/**
 * Orden de serialización de cada DTO (`S` = campo String, `O` = objeto,
 * `B` = boolean), sacado de los FieldSerializer del JavaScript del portal.
 */
export const ESQUEMAS_DECLARACION: Readonly<Record<string, string>> = Object.freeze({
  [FIRMAS_DECLARACION.estado]: 'SSS',
  [FIRMAS_DECLARACION.postulacion]: 'SOSOSSOSSSOSSSOSSOOOOS',
  [FIRMAS_DECLARACION.empresaAutorizada]: 'BSSSSSSSSSSSSOOOS',
  [FIRMAS_DECLARACION.documento]: 'OOSSSSSSSSSOOOOOS',
});

/** Métodos del servicio que se usan (los revisa `verificarPortal()`). */
const METODOS = [
  'obtenerEstadoAutorizaEmp',
  'recuperarNombreContribuyente',
  'listarDocAutorizados',
  'autorizarEmpresaBolProd',
  'recuperarNroActividadesVigAfecIva',
  'ingresarTrackId',
  'obtenerPostulacionSeg',
] as const;

const FACADE = `${BASE_DECLARACION}facade`;
const CONTENT_TYPE_GWT = 'text/x-gwt-rpc; charset=UTF-8';

/**
 * Cabeceras de las llamadas GWT. El `Content-Type` va también aquí (no solo en el
 * cuerpo crudo): el PHP lo pone en las cabeceras, así que se conserva si una
 * redirección convierte el POST en GET.
 */
const CABECERAS_GWT: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': CONTENT_TYPE_GWT,
  'X-GWT-Permutation': PERMUTACION_DECLARACION,
  'X-GWT-Module-Base': BASE_DECLARACION,
  Origin: `https://${HOST_DECLARACION}`,
  Referer: BASE_DECLARACION,
});

export interface OpcionesDeclaracionBoletas {
  /** Por defecto, un `TransporteUndici` propio. */
  readonly transporte?: TransporteHttp;
  /** Para la fecha de la declaración (`d-m-Y` en hora de Chile). */
  readonly reloj?: Reloj;
}

/**
 * Declaración de cumplimiento de requisitos de Boleta Electrónica: el último paso
 * de la certificación, que deja a la empresa AUTORIZADA EN PRODUCCIÓN para emitir
 * boletas (39 y, si se postuló, 41).
 *
 * Vive en la app GWT `https://www4.sii.cl/certBolElectDteInternet/` (no en
 * maullin) y se habla por GWT-RPC con la misma sesión AUT2000 de `PostulacionSii` /
 * `SolicitudFolios`. Capturado el 2026-09-14 (versión 1.0.55 del portal).
 *
 * Si el SII publica otra versión, las llamadas responden
 * `IncompatibleRemoteServiceException` y se corta con un mensaje claro: hay que
 * actualizar POLICY/PERMUTACION (y revisar los esquemas) desde el portal.
 * `verificarPortal()` lo detecta antes, sin sesión.
 */
export class DeclaracionBoletas {
  readonly #reloj: Reloj;
  readonly #navegador: NavegadorSii;

  constructor(opciones: OpcionesDeclaracionBoletas = {}) {
    this.#reloj = opciones.reloj ?? relojSistema;
    this.#navegador = new NavegadorSii(
      opciones.transporte ?? new TransporteUndici(),
      HOST_DECLARACION,
    );
  }

  /**
   * Estado de la certificación de boletas. `porDeclarar()` = se puede declarar.
   * Una empresa ya autorizada, sin trámite o de la que el usuario no es
   * representante responde sin código.
   *
   * @throws ErrorValidacion si el RUT no es válido
   * @throws SesionCaducaError si la sesión ya no sirve
   * @throws ErrorTransporte si falla la red o el SII responde un código distinto de 200
   * @throws ErrorPostulacion si la respuesta no se entiende (o es un `//EX`)
   */
  async estado(sesion: SesionSii, rutEmpresa: string | Rut): Promise<EstadoDeclaracion> {
    const empresa = rutDeEmpresa(rutEmpresa);

    const r = (
      await this.#llamar(sesion, 'obtenerEstadoAutorizaEmp', [
        [GwtRpc.INTEGER, (w) => w.integer(Number(empresa.numero))],
        [GwtRpc.STRING, (w) => w.string(empresa.dv)],
        [GwtRpc.INTEGER, (w) => w.integer(PASO_DECLARACION)],
        [GwtRpc.STRING, (w) => w.string(null)],
      ])
    ).objeto();

    if (r === null) return new EstadoDeclaracion(empresa, null, '', null);

    if (!esDtoGwt(r) || r['@tipo'] !== FIRMAS_DECLARACION.estado) {
      throw new ErrorPostulacion(
        `El SII respondió el estado de ${empresa} con un tipo no esperado (${r['@tipo']}); pudo haber cambiado el portal.`,
      );
    }

    // array_column($r['campos'], 1): EstadoAutorizaTo es 'SSS'.
    const [codigo, paso, glosa] = r.campos.map((campo) => campo[1]) as (string | null)[];
    return new EstadoDeclaracion(empresa, codigo ?? null, glosa ?? '', pasoNumerico(paso ?? null));
  }

  /**
   * Graba la declaración de cumplimiento. **Autoriza a la empresa en producción.**
   *
   * Solo sale si el estado es P90. El usuario de la sesión firma la declaración
   * como representante legal.
   *
   * @throws SesionCaducaError antes de declarar (la sesión no trae el usuario o caducó)
   * @throws ErrorPostulacion si la empresa no está en P90, o el SII no devolvió la
   *   razón social o los documentos (antes de declarar: no salió la orden)
   * @throws ErrorTransporte si falla la red o hay un código distinto de 200 antes de declarar
   * @throws DeclaracionInciertaError si la orden salió y no se pudo confirmar: NO
   *   reintentar a ciegas, consultar `estado()` (P91 = autorizada; P90 = se puede
   *   volver a declarar)
   */
  async declarar(sesion: SesionSii, datos: DatosDeclaracion): Promise<EstadoDeclaracion> {
    const empresa = datos.empresa;
    const usuario = this.#usuario(sesion);

    const estado = await this.estado(sesion, empresa);
    if (!estado.porDeclarar()) {
      throw new ErrorPostulacion(
        `La empresa ${empresa} no está en el paso de declarar cumplimiento de boletas` +
          (estado.codigo !== null
            ? ` (estado ${estado.codigo} ${estado.glosa})`
            : ' (sin trámite pendiente: ya autorizada, sin postular o el usuario no la representa)') +
          '.',
      );
    }

    const paso = estado.paso ?? PASO_DECLARACION;
    const rut = (w: GwtRpc): void => {
      w.integer(Number(empresa.numero));
    };

    const razonSocial = (
      await this.#llamar(sesion, 'recuperarNombreContribuyente', [
        [GwtRpc.INTEGER, rut],
        [GwtRpc.STRING, (w) => w.string(empresa.dv)],
      ])
    ).string();

    const documentos = (
      await this.#llamar(sesion, 'listarDocAutorizados', [
        [GwtRpc.INTEGER, rut],
        [GwtRpc.STRING, (w) => w.string(empresa.dv)],
        [GwtRpc.STRING, (w) => w.string(String(paso))],
      ])
    ).objeto();

    if (razonSocial === null || razonSocial === '') {
      throw new ErrorPostulacion(`El SII no devolvió la razón social de ${empresa}.`);
    }
    // `($documentos['elementos'] ?? []) === []`: cualquier cosa que no sea una lista con elementos.
    if (!esListaGwt(documentos) || documentos.elementos.length === 0) {
      throw new ErrorPostulacion(`El SII no tiene documentos por autorizar para ${empresa}.`);
    }

    const hoy = fechaDmy(this.#reloj.ahora());

    // El cuerpo se arma ANTES de enviar: si algo no se puede escribir, no sale nada.
    const cuerpo = cuerpoGwt('autorizarEmpresaBolProd', [
      [
        FIRMAS_DECLARACION.postulacion,
        (w) => {
          // PostulSegHistInsUpdTo (ver Gi() del portal)
          w.tipo(FIRMAS_DECLARACION.postulacion)
            .string('P91') // b  estado nuevo
            .nulo() // c
            .string('BVE') // d  sistema boleta
            .integer(paso) // e  paso
            .nulo()
            .string(null)
            .nulo()
            .string(null) // f g i j
            .string(empresa.dv) // k
            .string(null); // n

          // o: TdtEmpresaAutorizadaTo (ver Fi() del portal)
          w.tipo(FIRMAS_DECLARACION.empresaAutorizada)
            .int(0) // b  boolean false
            .string('BVE') // c
            .string(empresa.dv) // d  dv empresa
            .string(datos.proveedor.dv) // e  dv proveedor
            .string(usuario.dv) // f  dv usuario
            .string('SII') // g
            .string(hoy)
            .string(hoy)
            .string(hoy) // i j k
            .string(datos.correoProveedor) // n
            .string(datos.nombreProveedor) // o
            .string('19') // p
            .string('S') // q
            .integer(Number(empresa.numero)) // r  rut empresa
            .integer(Number(datos.proveedor.numero)) // s  rut proveedor
            .integer(Number(usuario.numero)) // t  rut usuario
            .string(datos.linkConsulta); // u

          w.string(hoy)
            .string(hoy) // p q
            .string(null) // r
            .valor(documentos) // s  documentos (tal cual los lista el SII)
            .string(null) // t
            .string(razonSocial) // u
            .long(0) // v
            .nulo() // w
            .integer(Number(empresa.numero)) // x
            .nulo() // y
            .string(null); // z
        },
      ],
    ]);

    // Desde aquí la orden puede haber llegado: toda falla es "incierta".
    let resultado: ObjetoGwt | null;
    try {
      const respuesta = await this.#navegador.pedir(sesion, {
        metodo: 'POST',
        url: FACADE,
        cuerpo: { tipo: 'crudo', datos: cuerpo, contentType: CONTENT_TYPE_GWT },
        cabeceras: CABECERAS_GWT,
        msRespuesta: MS_DECLARACION,
        conexionNueva: true,
      });
      resultado = this.#leer(respuesta).objeto();
    } catch (error) {
      throw new DeclaracionInciertaError(
        empresa.toString(),
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }

    if (
      !esDtoGwt(resultado) ||
      resultado['@tipo'] !== FIRMAS_DECLARACION.postulacion ||
      resultado.campos[0]?.[1] !== 'P91'
    ) {
      throw new DeclaracionInciertaError(empresa.toString(), 'El SII respondió sin el estado P91.');
    }

    return new EstadoDeclaracion(empresa, 'P91', `DECLARACION EFECTUADA ${usuario}`, estado.paso);
  }

  /**
   * Solicita la revisión del set de pruebas de boletas (portal `?SET=2`, botón
   * "Solicitar validación") con el TrackID del envío de las boletas.
   *
   * El resultado NO es inmediato: el SII lo manda por correo y, si aprueba,
   * `estado()` pasa a P90 (declarar cumplimiento). Pedirla con un envío que tuvo
   * rechazos o reparos no sirve: revisarlo antes con `ClienteDtews#estadoEnvio()`.
   *
   * @throws ErrorValidacion si el RUT o el trackId no son válidos (no sale nada)
   * @throws SetSinDescargarError si el SII pide descargar antes el set de pruebas
   * @throws SesionCaducaError si la sesión ya no sirve
   * @throws ErrorTransporte si falla la red o el SII responde un código distinto de 200
   * @throws ErrorPostulacion si el SII no recibió la solicitud o la respuesta no se entiende
   */
  async solicitarRevisionSet(
    sesion: SesionSii,
    rutEmpresa: string | Rut,
    trackId: string,
  ): Promise<void> {
    const empresa = rutDeEmpresa(rutEmpresa);

    if (!/^\d{1,15}$/.test(trackId)) {
      throw new ErrorValidacion(`Identificador de envío inválido: ${trackId}.`);
    }

    const rut = (w: GwtRpc): void => {
      w.integer(Number(empresa.numero));
    };
    const dv = (w: GwtRpc): void => {
      w.string(empresa.dv);
    };

    // El portal manda "90" si la empresa tiene actividades afectas a IVA y "91" si no.
    const actividades = (
      await this.#llamar(sesion, 'recuperarNroActividadesVigAfecIva', [
        [GwtRpc.INTEGER, rut],
        [GwtRpc.STRING, dv],
      ])
    ).objeto();
    const codigo = valorPositivoPhp(actividades) ? '90' : '91';

    // ingresarTrackId(Integer rut, String dv, String, String codigo, Integer, String, String trackId)
    const respuesta = (
      await this.#llamar(sesion, 'ingresarTrackId', [
        [GwtRpc.INTEGER, rut],
        [GwtRpc.STRING, dv],
        [GwtRpc.STRING, (w) => w.string(null)],
        [GwtRpc.STRING, (w) => w.string(codigo)],
        [GwtRpc.INTEGER, (w) => w.integer(null)],
        [GwtRpc.STRING, (w) => w.string(null)],
        [GwtRpc.STRING, (w) => w.string(trackId)],
      ])
    ).string();

    if (respuesta === '1') return;
    if (respuesta === 'errorEstado') {
      throw new SetSinDescargarError(
        `El SII no acepta revisar el envío ${trackId} de ${empresa}: primero hay que descargar el set de prueba de boletas.`,
      );
    }
    throw new ErrorPostulacion(
      `El SII no recibió la solicitud de revisión del envío ${trackId} (respuesta: ${varExport(respuesta)}). Intenta más tarde.`,
    );
  }

  /**
   * Descarga el set de pruebas de boletas en el portal (`?SET=1`, "Generación de
   * nuevo set de pruebas"), lo que deja registrada la descarga en el SII.
   * Devuelve el texto del set.
   *
   * **Candado:** si la empresa ya está en P90 (lista para declarar) NO se
   * descarga: el portal advierte que un set nuevo obliga a empezar de nuevo la
   * certificación.
   *
   * Replica el portal: `obtenerPostulacionSeg(rut, dv, "90", "P90")` y luego
   * `GET DownloadFileServlet` con el RUT del representante (el usuario de la
   * sesión) y el correo del proveedor de software.
   *
   * @throws ErrorValidacion si el RUT o el correo no son válidos (no sale nada)
   * @throws SesionCaducaError si la sesión no trae el usuario o caducó
   * @throws ErrorPostulacion si la empresa está en P90 (no se descarga), o el SII
   *   respondió 200 sin el set
   * @throws ErrorTransporte si falla la red o el SII responde un código distinto de 200
   */
  async descargarSetPruebas(
    sesion: SesionSii,
    rutEmpresa: string | Rut,
    correoProveedor: string,
  ): Promise<string> {
    const empresa = rutDeEmpresa(rutEmpresa);
    const usuario = this.#usuario(sesion);
    validarCorreo(correoProveedor, 'correo del proveedor de software');

    const enP90 = !(
      await this.#llamar(sesion, 'obtenerPostulacionSeg', [
        [GwtRpc.INTEGER, (w) => w.integer(Number(empresa.numero))],
        [GwtRpc.STRING, (w) => w.string(empresa.dv)],
        [GwtRpc.STRING, (w) => w.string(String(PASO_DECLARACION))],
        [GwtRpc.STRING, (w) => w.string('P90')],
      ])
    ).esNulo();

    if (enP90 || (await this.estado(sesion, empresa)).porDeclarar()) {
      throw new ErrorPostulacion(
        `No se descarga un set nuevo para ${empresa}: ya está lista para declarar cumplimiento y un set nuevo reiniciaría su certificación.`,
      );
    }

    const url = `${BASE_DECLARACION}DownloadFileServlet?${codificarFormulario([
      ['rutEmpresa', empresa.numero],
      ['dvEmpresa', empresa.dv],
      ['rutRepre', usuario.numero],
      ['dvRepre', usuario.dv],
      ['mailProvSw', correoProveedor],
    ])}`;

    const respuesta = await this.#navegador.pedir(sesion, {
      metodo: 'GET',
      url,
      cabeceras: { Referer: `${BASE_DECLARACION}?SET=1` },
      msRespuesta: MS_DECLARACION,
    });
    // Como el PHP: la sesión se revisa antes que el código (los marcadores son ASCII,
    // así que da lo mismo buscarlos en los bytes o en el texto decodificado).
    const texto = decodificarUtf8OIso(respuesta.cuerpo);
    this.#navegador.sesionVigente(texto);

    if (respuesta.status !== 200 || !texto.includes('SET DE PRUEBA') || !texto.includes('CASO-')) {
      const mensaje = `El SII no entregó el set de pruebas de ${empresa} (HTTP ${respuesta.status}). ${NavegadorSii.texto(texto, 200)}`;
      if (respuesta.status !== 200) {
        throw new ErrorTransporte(
          mensaje,
          `${BASE_DECLARACION}DownloadFileServlet`,
          respuesta.status,
        );
      }
      throw new ErrorPostulacion(mensaje);
    }

    return texto;
  }

  /**
   * Revisa, sin sesión ni login, que el portal de boletas siga siendo la versión
   * capturada: el archivo público de la app GWT (`<PERMUTACION>.cache.html`) tiene
   * que existir y traer la POLICY, los métodos y las firmas de tipo que se usan. Si
   * el SII cambia un DTO, cambia el hash de su firma y se detecta.
   *
   * No envía nada al SII más que ese GET (sin cookies).
   *
   * @returns problemas encontrados (vacío = vigente). Un 404 se devuelve como
   *   problema (el SII publicó otra versión).
   * @throws ErrorTransporte si no se pudo consultar (red, SII caído, código distinto de 200 y 404)
   */
  async verificarPortal(): Promise<string[]> {
    const url = `${BASE_DECLARACION}${PERMUTACION_DECLARACION}.cache.html`;
    const respuesta = await this.#navegador.pedir(new SesionSii({ reloj: this.#reloj }), {
      metodo: 'GET',
      url,
      msRespuesta: MS_DECLARACION,
    });

    if (respuesta.status === 404) {
      return [
        `El SII publicó otra versión del portal de boletas: ya no existe la versión capturada (${PERMUTACION_DECLARACION}).`,
      ];
    }
    if (respuesta.status !== 200) {
      throw new ErrorTransporte(
        `No se pudo verificar el portal de boletas del SII (HTTP ${respuesta.status}).`,
        url,
        respuesta.status,
      );
    }

    const esperado: [string, string][] = [
      [`POLICY ${POLICY_DECLARACION}`, POLICY_DECLARACION],
      ['servicio', SERVICIO_DECLARACION],
      ['tipo EstadoAutorizaTo', FIRMAS_DECLARACION.estado],
      ['tipo PostulSegHistInsUpdTo', FIRMAS_DECLARACION.postulacion],
      ['tipo TdtEmpresaAutorizadaTo', FIRMAS_DECLARACION.empresaAutorizada],
      ['tipo DocumentoAutorizadoTo', FIRMAS_DECLARACION.documento],
      ['DownloadFileServlet', 'DownloadFileServlet'],
      ...METODOS.map((metodo): [string, string] => [`método ${metodo}`, `'${metodo}'`]),
    ];

    // Todo lo que se busca es ASCII: latin1 conserva cada byte.
    const cuerpo = respuesta.cuerpo.toString('latin1');
    return esperado
      .filter(([, texto]) => !cuerpo.includes(texto))
      .map(([nombre]) => `El portal de boletas del SII cambió: falta ${nombre}.`);
  }

  /** RUT del usuario autenticado (cookies RUT_NS/DV_NS de AUT2000). */
  #usuario(sesion: SesionSii): Rut {
    const rut = sesion.valor('RUT_NS');
    const dv = sesion.valor('DV_NS');

    if (rut === null || dv === null) {
      throw new SesionCaducaError(
        'La sesión del SII no trae el RUT del usuario; hay que volver a autenticar.',
      );
    }

    return Rut.de(`${rut}-${dv}`, 'RUT del usuario autenticado');
  }

  /**
   * POST de una llamada GWT. Revisa la sesión antes que el código HTTP (como el PHP).
   *
   * @throws SesionCaducaError, ErrorTransporte (red o HTTP distinto de 200), ErrorPostulacion
   */
  async #llamar(
    sesion: SesionSii,
    metodo: string,
    params: readonly ParametroGwt[],
  ): Promise<LectorGwt> {
    const respuesta = await this.#navegador.pedir(sesion, {
      metodo: 'POST',
      url: FACADE,
      cuerpo: { tipo: 'crudo', datos: cuerpoGwt(metodo, params), contentType: CONTENT_TYPE_GWT },
      cabeceras: CABECERAS_GWT,
      msRespuesta: MS_DECLARACION,
    });
    return this.#leer(respuesta);
  }

  /** Sesión vigente → HTTP 200 → respuesta GWT (`//OK`). */
  #leer(respuesta: RespuestaHttp): LectorGwt {
    this.#navegador.sesionVigente(respuesta.cuerpo.toString('latin1'));

    if (respuesta.status !== 200) {
      throw new ErrorTransporte(
        `El portal de boletas del SII respondió HTTP ${respuesta.status}.`,
        FACADE,
        respuesta.status,
      );
    }

    return GwtRpc.leer(respuesta.cuerpo, ESQUEMAS_DECLARACION);
  }
}

function cuerpoGwt(metodo: string, params: readonly ParametroGwt[]): string {
  return GwtRpc.llamada(BASE_DECLARACION, POLICY_DECLARACION, SERVICIO_DECLARACION, metodo, params);
}

function rutDeEmpresa(rut: string | Rut): Rut {
  return typeof rut === 'string' ? Rut.de(rut, 'RUT de la empresa') : rut;
}

/** `d-m-Y` en hora de Chile (`DateTimeImmutable('now', America/Santiago)->format('d-m-Y')`). */
export function fechaDmy(instante: Date): string {
  const [anio, mes, dia] = fechaSii(instante).split('-');
  return `${dia}-${mes}-${anio}`;
}

/** `is_numeric()` de PHP 8 sobre un texto: blancos a los lados, signo, decimales y exponente. */
const NUMERICO_PHP = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/** Prefijo numérico que toma `(int)` de PHP de un texto (lo demás se ignora). */
const PREFIJO_NUMERICO_PHP = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * `is_numeric($paso) ? (int) $paso : null` (el paso llega como String o null).
 *
 * @throws ErrorPostulacion si el número no cabe en un entero seguro (el PHP saturaba)
 */
export function pasoNumerico(paso: string | null): number | null {
  if (paso === null || !NUMERICO_PHP.test(paso)) return null;
  const valor = Math.trunc(Number(paso.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, '')));
  if (!Number.isSafeInteger(valor)) {
    throw new ErrorPostulacion(`El SII respondió un paso fuera de rango (${paso}).`);
  }
  return valor;
}

/**
 * `(int) ($objeto['valor'] ?? 0) > 0`: Integer y Long por su valor, String con la
 * conversión de PHP (prefijo numérico, `"abc"` → 0), lo demás (null, lista, DTO) → 0.
 */
function valorPositivoPhp(objeto: ObjetoGwt | null): boolean {
  if (objeto === null || !('valor' in objeto)) return false;
  const valor = objeto.valor;
  if (typeof valor === 'number') return valor > 0;
  if (typeof valor === 'bigint') return valor > 0n;
  if (valor === null) return false;
  const prefijo = PREFIJO_NUMERICO_PHP.exec(valor);
  return prefijo !== null && Math.trunc(Number(prefijo[0].trim())) > 0;
}

/** `var_export($valor, true)` de un string o null. */
function varExport(valor: string | null): string {
  return valor === null ? 'NULL' : `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
