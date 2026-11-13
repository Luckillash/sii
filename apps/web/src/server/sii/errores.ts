import 'server-only';
import {
  DeclaracionInciertaError,
  ErrorCertificado,
  ErrorPostulacion,
  ErrorRespuestaSii,
  ErrorSolicitudFolios,
  ErrorTransporte,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  hostDe,
  SiiError,
} from '@winex/certificacion';
import { depurarBreadcrumb, depurarTexto, FILTRADO } from '@/lib/sentry/depurar';
import type { MensajeError } from '@/server/equipo-errores';
import type { Database } from '@/server/supabase/tipos';

// Errores de la capa SII y su traducción a `resultado_operacion` (PLAN-SAAS Fase 4,
// principios 3 y 5).
//
// `resultadoDeError()` tiene paridad exacta con `codigoDeError()` de la CLI
// (packages/certificacion/apps/cli/src/errores.ts): el `resultado` de una fila de
// `operaciones_sii` equivale al código de salida 0–7.
//
// Regla: lo que sale de este módulo (mensajes para la UI, `detalle` para la base,
// lo que va a Sentry) nunca lleva `cause`, stack, tokens, cookies, claves ni PEM.

export type ResultadoOperacion = Database['public']['Enums']['resultado_operacion'];

/** Los resultados con que se cierra una operación (todos menos `en_curso`). */
export type ResultadoFinal = Exclude<ResultadoOperacion, 'en_curso'>;

/** Código de salida de la CLI que corresponde a cada resultado. */
export const CODIGO_DE_RESULTADO: Readonly<Record<ResultadoFinal, number>> = Object.freeze({
  ok: 0,
  error: 1,
  uso: 2,
  config: 3,
  transporte: 4,
  rechazo_sii: 5,
  incierto: 6,
  verificacion_fallida: 7,
});

export type { MensajeError };

// --- Errores propios de la app ------------------------------------------------------
//
// Los resultados que la librería no produce con un error: en la CLI salen de
// `ErrorUso` / `ErrorConfig` (2 y 3) o de un `return CODIGOS.X` del comando (7 en
// `util verificar-ted`; 6 en `solicitar-folios` cuando el CAF no se pudo guardar y en
// `produccion emitir` cuando no se sabe si el envío llegó). La app los expresa
// lanzando estos errores desde la función de la operación. Sus mensajes los escribe
// la app con el formato del design system (qué pasó y qué hacer) y se muestran tal
// cual: nunca deben incluir valores de secretos, solo nombres de campos.

/** Uso incorrecto (código 2): faltan datos o no son válidos. Nada salió al SII. */
export class ErrorUso extends Error {
  override name = 'ErrorUso';
}

/**
 * Configuración inválida (código 3): falta el certificado, la resolución, el CAF o
 * algo de la empresa. Nada salió al SII. `cause` nunca se muestra ni se guarda.
 */
export class ErrorConfig extends Error {
  override name = 'ErrorConfig';
}

/** Una verificación local no pasó (código 7), p. ej. un TED que no calza con el CAF. */
export class ErrorVerificacion extends Error {
  override name = 'ErrorVerificacion';
}

/**
 * La operación llegó al SII pero no se sabe si quedó hecha (código 6), en casos que
 * la librería no cubre con su propio error: el CAF se timbró pero no se pudo
 * guardar, o no se sabe si una boleta llegó. Bloquea el reintento (principio 3).
 */
export class ErrorIncierto extends Error {
  override name = 'ErrorIncierto';
}

// Errores de otros módulos de la capa SII, reconocidos por `name` y por su forma
// (sin importarlos, para no acoplar este archivo a ellos):
//   ErrorCredenciales    (credenciales.ts) falta el certificado, está revocado, vencido
//                        o Vault no lo entrega: `config` (3), nada salió al SII. Trae
//                        `resultado` ('config' | 'error': 'error' si falló la base) y
//                        `mensaje: MensajeError`; se respetan los dos.
//   BloqueoOcupadoError  (bloqueos.ts) otra petición tiene tomado el certificado: nada
//                        salió al SII y basta con reintentar en un momento, igual que
//                        un 4 (`transporte`, sin host). Trae `mensajeUsuario`.
//   ErrorEmpresaAutorizada (certificacion/comun.ts) la empresa ya está autorizada en
//                        producción y se intentó un paso de la certificación: `uso`
//                        (2), nada salió al SII. Trae `mensajeUsuario`.
// Los demás de esos módulos (ErrorBloqueo, ErrorSesiones, ErrorAlmacen,
// ErrorTokenStore: fallas de Supabase) caen en `error` con mensaje genérico.
const POR_NOMBRE: Readonly<Record<string, ResultadoFinal>> = Object.freeze({
  ErrorCredenciales: 'config',
  BloqueoOcupadoError: 'transporte',
  ErrorEmpresaAutorizada: 'uso',
});

const RESULTADOS_FINALES: readonly string[] = Object.keys(CODIGO_DE_RESULTADO);

function conocidoPorNombre(error: unknown): error is Error & Record<string, unknown> {
  return error instanceof Error && Object.hasOwn(POR_NOMBRE, error.name);
}

/** `resultado` propio de un error conocido por nombre, si es uno válido (no `ok`). */
function resultadoPropio(error: Error & Record<string, unknown>): ResultadoFinal | undefined {
  const r = error.resultado;
  return typeof r === 'string' && r !== 'ok' && RESULTADOS_FINALES.includes(r)
    ? (r as ResultadoFinal)
    : undefined;
}

function esMensajeError(valor: unknown): valor is MensajeError {
  if (valor === null || typeof valor !== 'object') return false;
  const v = valor as Record<string, unknown>;
  return typeof v.titulo === 'string' && typeof v.detalle === 'string' && v.titulo !== '';
}

/** `mensajeUsuario` o `mensaje` (MensajeError) de un error conocido por nombre. */
function mensajePropio(error: unknown): MensajeError | undefined {
  if (!conocidoPorNombre(error)) return undefined;
  if (esMensajeError(error.mensajeUsuario)) return error.mensajeUsuario;
  if (esMensajeError(error.mensaje)) return error.mensaje;
  return undefined;
}

/** Errores cuyo `message` está escrito para el usuario y se puede mostrar. */
function tieneMensajeSeguro(error: unknown): error is Error {
  return (
    error instanceof SiiError ||
    error instanceof ErrorUso ||
    error instanceof ErrorConfig ||
    error instanceof ErrorVerificacion ||
    error instanceof ErrorIncierto ||
    conocidoPorNombre(error)
  );
}

/**
 * Resultado que corresponde a un error. Mismo orden que `codigoDeError()` de la CLI,
 * con los errores de la app delante (no se cruzan con los de la librería).
 */
export function resultadoDeError(error: unknown): ResultadoFinal {
  if (error instanceof ErrorUso) return 'uso';
  if (error instanceof ErrorConfig) return 'config';
  if (error instanceof ErrorVerificacion) return 'verificacion_fallida';
  if (error instanceof ErrorIncierto) return 'incierto';
  if (conocidoPorNombre(error)) return resultadoPropio(error) ?? POR_NOMBRE[error.name] ?? 'error';

  // Paridad con codigoDeError() de la CLI.
  if (error instanceof ErrorCertificado) return 'config';
  if (error instanceof DeclaracionInciertaError || error instanceof FoliosSinCafError) {
    return 'incierto';
  }
  if (error instanceof ErrorTransporte) return 'transporte';
  if (
    error instanceof ErrorRespuestaSii ||
    error instanceof ErrorPostulacion ||
    error instanceof ErrorSolicitudFolios
  ) {
    return 'rechazo_sii';
  }
  return 'error';
}

// --- Saneado de textos y objetos ----------------------------------------------------

/** `clave=...`, `token: ...`, `password="..."` dentro de un texto libre. */
const CLAVE_VALOR =
  /\b(clave|contrase(?:ñ|n)a|password|passwd|secreto|secret|token|api[-_]?key|apikey|authorization|rsask)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
/** Cabeceras de cookies completas: `Cookie: a=b; c=d`. */
const CABECERA_COOKIE = /\b(set-cookie|cookie)\s*:\s*[^\r\n]*/gi;
/** Un trozo largo con pinta de token (letras y dígitos, sin espacios ni guiones). */
const TOKEN_LARGO = /[A-Za-z0-9+/_]{32,}={0,2}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LARGO_MAXIMO_TEXTO = 1000;

function pareceToken(trozo: string): boolean {
  return /[A-Za-z]/.test(trozo) && /[0-9]/.test(trozo);
}

/**
 * Quita de un texto libre todo lo que parezca secreto: lo de `depurarTexto()` de
 * Sentry (PEM, RSASK, `TOKEN=`, Bearer, JWT, base64 largo, query sensible), más
 * pares `clave=valor`, cabeceras `Cookie:` y tokens largos sueltos. Recorta a
 * 1.000 caracteres.
 */
export function sanearTexto(texto: string): string {
  let salida = depurarTexto(texto)
    .replace(CABECERA_COOKIE, (_c, nombre: string) => `${nombre}: ${FILTRADO}`)
    .replace(CLAVE_VALOR, (_c, nombre: string, separador: string) => {
      return `${nombre}${separador}${FILTRADO}`;
    })
    .replace(TOKEN_LARGO, (trozo) => (pareceToken(trozo) ? FILTRADO : trozo));
  if (salida.length > LARGO_MAXIMO_TEXTO) salida = `${salida.slice(0, LARGO_MAXIMO_TEXTO)}…`;
  return salida;
}

/** Objeto JSON con valores ya saneados. */
export type DetalleSeguro = { [clave: string]: ValorSeguro };
type ValorSeguro = string | number | boolean | null | ValorSeguro[] | DetalleSeguro;

const PROFUNDIDAD_MAXIMA = 6;
const ELEMENTOS_MAXIMOS = 100;

/**
 * Claves sensibles que la lista de Sentry (`CLAVE_SENSIBLE` de depurar.ts, no
 * exportada) no cubre: las cookies de `SesionSii`, CSRF y credenciales en general.
 */
const CLAVE_SENSIBLE_SII = /sesi[oó]n|session|csrf|credencial|bearer|jwt|passphrase/i;

function sanearValor(valor: unknown, profundidad: number): ValorSeguro | undefined {
  if (typeof valor === 'string') {
    if (UUID.test(valor)) return valor;
    return sanearTexto(valor);
  }
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'boolean' || valor === null) return valor;
  if (typeof valor !== 'object' || valor === undefined) return undefined;
  if (profundidad >= PROFUNDIDAD_MAXIMA) return FILTRADO;
  if (Array.isArray(valor)) {
    return valor.slice(0, ELEMENTOS_MAXIMOS).map((v) => sanearValor(v, profundidad + 1) ?? null);
  }
  const salida: DetalleSeguro = {};
  for (const [clave, v] of Object.entries(valor).slice(0, ELEMENTOS_MAXIMOS)) {
    if (CLAVE_SENSIBLE_SII.test(clave) && v !== null && v !== undefined) {
      salida[clave] = FILTRADO;
      continue;
    }
    const saneado = sanearValor(v, profundidad + 1);
    if (saneado !== undefined) salida[clave] = saneado;
  }
  return salida;
}

/**
 * Sanea un objeto antes de guardarlo en `operaciones_sii.detalle`. Primero pasa por
 * `depurarBreadcrumb()` de Sentry sobre una copia JSON (misma lista de claves
 * sensibles: token, clave, contraseña, pfx, cookie(s), secreto, RSASK, api_key,
 * authorization, llave…, cuyo valor queda como `[Filtrado]`), y luego cada texto
 * pasa por `sanearTexto()`. Funciones, símbolos y `undefined` se descartan; fechas
 * quedan en ISO. Si el objeto no se puede serializar, devuelve `{}`.
 */
export function sanearDetalle(objeto: unknown): DetalleSeguro {
  let copia: unknown;
  try {
    copia = JSON.parse(JSON.stringify(objeto ?? {}));
  } catch {
    return {};
  }
  if (copia === null || typeof copia !== 'object' || Array.isArray(copia)) return {};
  const saneado = sanearValor(depurarBreadcrumb(copia), 0);
  return saneado !== null && typeof saneado === 'object' && !Array.isArray(saneado) ? saneado : {};
}

// --- Detalle técnico seguro de un error ----------------------------------------------

/**
 * Lo que se guarda de un error en `operaciones_sii.detalle`: solo campos tipados y
 * seguros (nombre, `status` y host de `ErrorTransporte` sin ruta ni query, `estado`
 * y `glosa` de `ErrorRespuestaSii`, rango de `FoliosSinCafError`, `folioSugerido`,
 * RUT de `DeclaracionInciertaError`). Nunca `cause`, stack ni el `message` de un
 * error desconocido.
 */
export function detalleSeguro(error: unknown): DetalleSeguro {
  if (!(error instanceof Error)) return { nombre: typeof error };
  const detalle: Record<string, unknown> = { nombre: error.name };
  if (error instanceof ErrorTransporte) {
    detalle.status = error.status ?? null;
    const host = error.url !== '' ? hostDe(error.url) : '';
    if (host !== '') detalle.host = host;
  }
  if (error instanceof ErrorRespuestaSii) {
    // Los estados del SII son códigos cortos (EPR, RCH, -11, P91…). Algo más largo no
    // se guarda: podría ser cualquier cosa (un token del SII mide 12 o más).
    if (error.estado !== undefined) {
      detalle.estado = /^[A-Za-z0-9-]{1,10}$/.test(error.estado) ? error.estado : FILTRADO;
    }
    if (error.glosa !== undefined) detalle.glosa = error.glosa;
  }
  if (error instanceof FoliosSinCafError) {
    detalle.folio_desde = error.folioDesde;
    detalle.folio_hasta = error.folioHasta;
    detalle.ambiente = error.ambiente;
  }
  if (error instanceof FolioInicialRequeridoError) {
    detalle.folio_sugerido = error.folioSugerido;
    detalle.ambiente = error.ambiente;
  }
  if (error instanceof DeclaracionInciertaError) detalle.rut_empresa = error.rutEmpresa;
  return sanearDetalle(detalle);
}

/** Host del SII al que iba la petición, si el error es de transporte. */
export function hostDelError(error: unknown): string | undefined {
  if (!(error instanceof ErrorTransporte) || error.url === '') return undefined;
  const host = hostDe(error.url);
  return host === '' ? undefined : host;
}

// --- Mensajes para el usuario -----------------------------------------------------

export const MENSAJE_INESPERADO: MensajeError = Object.freeze({
  titulo: 'No pudimos completar la operación',
  detalle:
    'Ocurrió un error inesperado y quedó registrado. Inténtalo de nuevo en unos minutos; si sigue fallando, escríbenos a soporte.',
});

const TITULOS: Readonly<Record<ResultadoFinal, string>> = Object.freeze({
  ok: 'Operación completada',
  error: 'No pudimos completar la operación',
  uso: 'Faltan datos para la operación',
  config: 'Falta configurar algo antes de operar con el SII',
  transporte: 'No pudimos comunicarnos con el SII',
  rechazo_sii: 'El SII rechazó la operación',
  incierto: 'No sabemos si el SII completó la operación',
  verificacion_fallida: 'La verificación no pasó',
});

/** Lo que se agrega al mensaje del error según el resultado (qué hacer). */
const CIERRES: Readonly<Partial<Record<ResultadoFinal, string>>> = Object.freeze({
  uso: 'No se envió nada al SII.',
  config: 'No se envió nada al SII.',
  transporte: 'Puedes reintentar en unos minutos.',
  incierto: 'No la repitas hasta revisar en el SII si quedó hecha.',
});

function conCierre(texto: string, cierre: string | undefined): string {
  if (cierre === undefined || texto.includes(cierre)) return texto;
  const conPunto = /[.!?…]$/.test(texto) ? texto : `${texto}.`;
  return `${conPunto} ${cierre}`;
}

/**
 * Mensaje para la UI (formato del design system: qué pasó y qué hacer). Si el error
 * trae su propio `MensajeError` (ErrorCredenciales, BloqueoOcupadoError), se usa ese;
 * de los errores de la librería y de la app se muestra su `message`, que ya es seguro
 * (igual pasa por `sanearTexto()`); de un error desconocido, un texto genérico. El
 * `cause` nunca se muestra.
 */
export function mensajeParaUsuario(resultado: ResultadoFinal, error?: unknown): MensajeError {
  if (resultado === 'ok') return { titulo: TITULOS.ok, detalle: '' };
  const propio = mensajePropio(error);
  if (propio) {
    return { titulo: sanearTexto(propio.titulo), detalle: sanearTexto(propio.detalle) };
  }
  if (!tieneMensajeSeguro(error) || error.message.trim() === '') {
    return resultado === 'error'
      ? { ...MENSAJE_INESPERADO }
      : {
          titulo: TITULOS[resultado],
          detalle: conCierre(MENSAJE_INESPERADO.detalle, CIERRES[resultado]),
        };
  }
  return {
    titulo: TITULOS[resultado],
    detalle: conCierre(sanearTexto(error.message.trim()), CIERRES[resultado]),
  };
}

/** El mensaje en una sola línea, para la columna `operaciones_sii.mensaje`. */
export function mensajeEnTexto(mensaje: MensajeError): string {
  return mensaje.detalle === '' ? mensaje.titulo : `${mensaje.titulo}. ${mensaje.detalle}`;
}
