import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { formatearFechaHora } from '@/lib/formatos';
import { confirmarSesion as confirmarSesionConAuth } from '@/server/certificados/acceso';
import type { ClienteServicio } from '@/server/supabase/service';
import type { Database } from '@/server/supabase/tipos';
import {
  type DetalleSeguro,
  detalleSeguro,
  hostDelError,
  type MensajeError,
  mensajeEnTexto,
  mensajeParaUsuario,
  type ResultadoFinal,
  resultadoDeError,
  sanearDetalle,
  sanearTexto,
} from './errores';

// Envoltorio de toda llamada al SII (PLAN-SAAS Fase 4; principios 3 y 5; §4.8).
//
//   0. Operación con efecto global sin empresa: `uso`, sin fila (el índice único de
//      abajo no cubre `empresa_id` nulo).
//   1. Operación ⚠️ confirmada por una persona: confirma la sesión con getUser()
//      (getClaims() no detecta una sesión revocada hasta el `exp`).
//   2. Operación con efecto global confirmada, control PREVIO: si la anterior quedó
//      `incierto` (o sigue `en_curso`) y nadie la marcó como revisada, no se ejecuta
//      ni se inserta. No basta para la carrera (consulta e insert no son atómicos);
//      está para no ensuciar la tabla (ni Realtime) con filas que nacen bloqueadas y
//      para dar el mensaje en el caso común.
//   3. Inserta la fila propia en `en_curso`. Para las de efecto global confirmadas,
//      el índice único parcial `operaciones_sii_efecto_global_en_curso` (migración
//      0007) admite una sola `en_curso` por (empresa, operación, ambiente): la
//      segunda de dos simultáneas recibe 23505 y no se ejecuta.
//   4. Control POSTERIOR (efecto global confirmada): con la fila propia ya puesta,
//      ninguna otra puede entrar, así que toda otra fila de esa llave terminó antes.
//      Si la última de ellas que llegó al SII quedó `incierto` sin revisar (apareció
//      entre el control previo y el insert), la fila propia se cierra como `uso`
//      (nada salió al SII) con `detalle.motivo` y no se ejecuta.
//   5. Ejecuta, traduce el error a `resultado_operacion`, cierra la fila y registra
//      en Sentry.
//
// Los controles 2 y 4 miran la última fila confirmada de la llave que pudo llegar
// al SII: se saltan `uso` y `config` (código 2 y 3, nada salió), así una fila
// cerrada por el control 4 no tapa el `incierto` que la bloqueó.
//
// Nada de lo que se guarda o se registra lleva `cause`, stack, tokens, cookies,
// claves ni PEM: todo pasa por los saneadores de ./errores.

type Enums = Database['public']['Enums'];
export type OperacionSii = Enums['operacion_sii'];
export type AmbienteSii = Enums['ambiente_sii'];
export type CanalSii = Enums['canal_sii'];

/** Operaciones ⚠️: graban algo en el SII. Exigen confirmación y, con persona, getUser(). */
export const OPERACIONES_QUE_GRABAN: readonly OperacionSii[] = Object.freeze([
  'postular',
  'descargar_set',
  'solicitar_folios',
  'enviar_set',
  'solicitar_revision',
  'declarar',
  'enviar_rcof',
  'emitir',
]);

/**
 * Operaciones con efecto global para la empresa: un `incierto` bloquea repetirlas
 * hasta revisarlo en el SII, y solo puede haber una `en_curso` confirmada por
 * empresa y ambiente. `emitir` se bloquea por documento (`envios.incierto`, Fase 7),
 * no aquí.
 *
 * SINCRONIZADA con el predicado del índice `operaciones_sii_efecto_global_en_curso`
 * (supabase/migrations/0007_bloqueos_sii.sql): si cambia una, cambia la otra.
 */
export const OPERACIONES_EFECTO_GLOBAL: readonly OperacionSii[] = Object.freeze([
  'solicitar_folios',
  'postular',
  'declarar',
]);

/**
 * Una fila `en_curso` más antigua que esto quedó abandonada (la función murió a
 * mitad de camino; el máximo de Vercel es 800 s): se trata como `incierto`.
 */
export const MINUTOS_EN_CURSO_ABANDONADA = 15;

/** Lo que llega a Sentry. `registrar` por defecto lo envía con `@sentry/nextjs`. */
export interface RegistroOperacion {
  /** `breadcrumb`: solo rastro; `evento`: captureMessage; `excepcion`: captureException. */
  tipo: 'breadcrumb' | 'evento' | 'excepcion';
  nivel: 'info' | 'warning' | 'error';
  mensaje: string;
  /** organizacion, empresa, ambiente, operacion_sii, resultado (y host_sii en transporte). */
  etiquetas: Readonly<Record<string, string>>;
  /** Solo el id: nunca correo ni nombre. */
  usuarioId?: string;
  /** Contexto ya saneado. */
  contexto?: DetalleSeguro;
  /** Solo en `excepcion`: error saneado (nombre y mensaje depurados, sin `cause`). */
  error?: Error;
}

export interface DependenciasOperacion {
  /** Confirma contra Auth que la sesión sigue viva y es de ese usuario. */
  confirmarSesion: (usuarioId: string) => Promise<boolean>;
  registrar: (registro: RegistroOperacion) => void;
  reloj: () => Date;
}

export interface ContextoOperacion {
  /** Cliente service_role: todas las consultas filtran por `organizacionId`. */
  cliente: ClienteServicio;
  organizacionId: string;
  empresaId?: string | null;
  /** `null` en cron y API pública. */
  usuarioId?: string | null;
  apiKeyId?: string | null;
  operacion: OperacionSii;
  ambiente: AmbienteSii;
  canal?: CanalSii | null;
  /** `false` = ensayo (equivale a no pasar `--confirmar`). */
  confirmada: boolean;
  envioId?: string | null;
  solicitudId?: string | null;
  documentoId?: string | null;
  /** Para pruebas. */
  dependencias?: Partial<DependenciasOperacion>;
}

export interface HerramientasOperacion {
  operacionId: string;
  /** Suma datos a `operaciones_sii.detalle` (pasan por `sanearDetalle()`). */
  agregarDetalle: (datos: Record<string, unknown>) => void;
}

export type MotivoNoEjecutada =
  /** Uso incorrecto de la capa (operación de efecto global sin empresa). */
  | 'uso'
  /** getUser() no confirmó la sesión. */
  | 'sesion_invalida'
  /** La anterior quedó `incierto` (o abandonada) sin revisar. */
  | 'incierto_sin_revisar'
  /** Hay otra igual `en_curso` (control previo o 23505 del índice único). */
  | 'en_curso'
  /** No se pudo consultar o insertar en `operaciones_sii`: no se llama al SII. */
  | 'sin_registro';

/**
 * Resultado de `ejecutarOperacion`. La función nunca lanza por un error de la
 * operación: lo traduce. `ejecutada: false` = no se llamó a `fn`. En ese caso
 * `operacionId` es `null`, salvo cuando el control posterior al insert bloqueó: ahí
 * es la fila propia, ya cerrada como `uso`.
 */
export type ResultadoEjecucion<T> =
  | { ok: true; valor: T; operacionId: string }
  | {
      ok: false;
      ejecutada: true;
      resultado: Exclude<ResultadoFinal, 'ok'>;
      mensaje: MensajeError;
      operacionId: string;
    }
  | {
      ok: false;
      ejecutada: false;
      motivo: MotivoNoEjecutada;
      mensaje: MensajeError;
      operacionId: string | null;
      /** La operación anterior que bloquea (para enlazar «Marcar como revisada»). */
      operacionPendienteId?: string;
    };

export const MENSAJE_SESION_INVALIDA: MensajeError = Object.freeze({
  titulo: 'Tu sesión ya no es válida',
  detalle: 'Vuelve a ingresar y repite la operación. No se envió nada al SII.',
});

const MENSAJE_SIN_REGISTRO: MensajeError = Object.freeze({
  titulo: 'No pudimos registrar la operación',
  detalle: 'No se envió nada al SII. Inténtalo de nuevo en unos minutos.',
});

const MENSAJE_SIN_EMPRESA: MensajeError = Object.freeze({
  titulo: 'Falta la empresa de la operación',
  detalle: 'Elige la empresa y vuelve a intentarlo. No se envió nada al SII.',
});

const MENSAJE_EN_CURSO_SIN_FILA: MensajeError = Object.freeze({
  titulo: 'Ya hay una operación igual en curso',
  detalle:
    'Otra solicitud igual empezó al mismo tiempo. Espera a que termine y revisa su resultado antes de repetirla. No se envió nada al SII.',
});

const NOMBRES: Readonly<Partial<Record<OperacionSii, string>>> = Object.freeze({
  solicitar_folios: 'solicitud de folios',
  postular: 'postulación',
  declarar: 'declaración de cumplimiento',
});

const COMO_REVISAR: Readonly<Partial<Record<OperacionSii, string>>> = Object.freeze({
  solicitar_folios:
    'Revisa «Folios ya autorizados» en el portal del SII y, si se timbraron, baja el CAF desde ahí en vez de volver a pedirlos.',
  postular:
    'Revisa en el portal de certificación del SII si la postulación quedó registrada antes de volver a postular.',
  declarar:
    'Consulta el estado de la declaración de cumplimiento: si quedó autorizada, no la repitas; si el SII permite volver a declarar, puedes hacerlo.',
});

function mensajeInciertoPendiente(operacion: OperacionSii, iniciadaEn: string): MensajeError {
  const nombre = NOMBRES[operacion] ?? 'operación';
  return {
    titulo: 'Hay una operación anterior sin confirmar en el SII',
    detalle:
      `La última ${nombre} (${formatearFechaHora(iniciadaEn)}) quedó con resultado incierto: pudo haberse completado. ` +
      `${COMO_REVISAR[operacion] ?? 'Revisa en el SII si quedó hecha.'} ` +
      'Cuando lo hayas revisado, márcala como revisada para poder repetirla.',
  };
}

function mensajeEnCurso(operacion: OperacionSii, iniciadaEn: string): MensajeError {
  const nombre = NOMBRES[operacion] ?? 'operación';
  return {
    titulo: 'Ya hay una operación igual en curso',
    detalle: `Hay una ${nombre} en curso desde ${formatearFechaHora(iniciadaEn)}. Espera a que termine y revisa su resultado antes de repetirla.`,
  };
}

// --- Sentry ---------------------------------------------------------------------

/** Implementación real de `registrar`, con `@sentry/nextjs` (que además depura en beforeSend). */
export function registrarEnSentry(registro: RegistroOperacion): void {
  if (registro.tipo === 'breadcrumb') {
    Sentry.addBreadcrumb({
      category: 'operacion_sii',
      level: registro.nivel,
      message: registro.mensaje,
      data: { ...registro.etiquetas },
    });
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTags({ ...registro.etiquetas });
    scope.setLevel(registro.nivel);
    if (registro.usuarioId) scope.setUser({ id: registro.usuarioId });
    if (registro.contexto) scope.setContext('operacion_sii', registro.contexto);
    if (registro.tipo === 'excepcion' && registro.error) {
      Sentry.captureException(registro.error);
    } else {
      scope.setFingerprint([
        'operacion_sii',
        registro.etiquetas.operacion_sii ?? '',
        registro.etiquetas.resultado ?? '',
      ]);
      Sentry.captureMessage(registro.mensaje, registro.nivel);
    }
  });
}

/** Copia saneada de un error para Sentry: nombre y mensaje depurados, sin `cause`. */
function errorSaneado(error: unknown): Error {
  const original = error instanceof Error ? error : undefined;
  const mensaje = original ? sanearTexto(original.message) : `Valor lanzado: ${typeof error}`;
  const copia = new Error(mensaje);
  copia.name = original ? sanearTexto(original.name) : 'ErrorDesconocido';
  // Solo los marcos (`    at ...`) del stack original: la primera línea trae el mensaje.
  const marcos = original?.stack
    ?.split('\n')
    .filter((linea) => /^\s+at /.test(linea))
    .map(sanearTexto);
  copia.stack = [`${copia.name}: ${mensaje}`, ...(marcos ?? [])].join('\n');
  return copia;
}

function etiquetasDe(ctx: ContextoOperacion): Record<string, string> {
  const etiquetas: Record<string, string> = {
    organizacion: ctx.organizacionId,
    ambiente: ctx.ambiente,
    operacion_sii: ctx.operacion,
  };
  if (ctx.empresaId) etiquetas.empresa = ctx.empresaId;
  return etiquetas;
}

function registrarResultado(
  deps: DependenciasOperacion,
  ctx: ContextoOperacion,
  resultado: ResultadoFinal,
  operacionId: string,
  error: unknown,
): void {
  const etiquetas: Record<string, string> = { ...etiquetasDe(ctx), resultado };
  const base = {
    mensaje: `Operación SII ${ctx.operacion} terminó en ${resultado}`,
    usuarioId: ctx.usuarioId ?? undefined,
    contexto: sanearDetalle({
      operacion_id: operacionId,
      confirmada: ctx.confirmada,
      canal: ctx.canal ?? null,
      error: resultado === 'ok' ? null : detalleSeguro(error),
    }),
  };
  switch (resultado) {
    case 'incierto':
    case 'verificacion_fallida':
      deps.registrar({ ...base, tipo: 'evento', nivel: 'error', etiquetas });
      return;
    case 'transporte': {
      const host = hostDelError(error);
      if (host) etiquetas.host_sii = host;
      deps.registrar({ ...base, tipo: 'evento', nivel: 'warning', etiquetas });
      return;
    }
    case 'error':
      deps.registrar({
        ...base,
        tipo: 'excepcion',
        nivel: 'error',
        etiquetas,
        error: errorSaneado(error),
      });
      return;
    default:
      deps.registrar({
        ...base,
        tipo: 'breadcrumb',
        nivel: resultado === 'ok' ? 'info' : 'warning',
        etiquetas,
      });
  }
}

/** Falla de la propia base (insertar, cerrar, consultar): se reporta sin datos de la fila. */
function reportarFalloBase(
  deps: DependenciasOperacion,
  ctx: ContextoOperacion,
  paso: string,
  codigo: string | undefined,
  operacionId?: string,
): void {
  const texto = `No se pudo ${paso} en operaciones_sii${codigo ? ` (código ${codigo})` : ''}.`;
  console.error(`[operaciones_sii] ${texto}${operacionId ? ` Operación ${operacionId}.` : ''}`);
  const error = new Error(texto);
  error.name = 'ErrorRegistroOperacion';
  deps.registrar({
    tipo: 'excepcion',
    nivel: 'error',
    mensaje: texto,
    etiquetas: etiquetasDe(ctx),
    usuarioId: ctx.usuarioId ?? undefined,
    contexto: operacionId ? { operacion_id: operacionId } : undefined,
    error,
  });
}

function codigoDe(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const codigo = (error as { code?: unknown }).code;
    return typeof codigo === 'string' ? codigo : undefined;
  }
  return undefined;
}

// --- Bloqueo por incierto y por en curso ---------------------------------------------

function revisada(detalle: unknown): boolean {
  return (
    detalle !== null &&
    typeof detalle === 'object' &&
    !Array.isArray(detalle) &&
    typeof (detalle as Record<string, unknown>).revisada_en === 'string'
  );
}

function abandonada(iniciadaEn: string, ahora: Date): boolean {
  return ahora.getTime() - new Date(iniciadaEn).getTime() > MINUTOS_EN_CURSO_ABANDONADA * 60_000;
}

type Pendiente =
  | { tipo: 'libre' }
  | { tipo: 'fallo'; codigo: string | undefined }
  | { tipo: 'incierto' | 'en_curso'; id: string; iniciadaEn: string };

/**
 * Filas confirmadas de la misma llave del índice: empresa, operación y ambiente. Solo
 * se llama para operaciones de efecto global, que ya pasaron el paso 0 (con empresa).
 */
function consultaLlave(ctx: ContextoOperacion) {
  return ctx.cliente
    .from('operaciones_sii')
    .select('id, resultado, detalle, iniciada_en')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId ?? '')
    .eq('operacion', ctx.operacion)
    .eq('ambiente', ctx.ambiente)
    .eq('confirmada', true);
}

function clasificar(
  fila: { id: string; resultado: string; detalle: unknown; iniciada_en: string } | undefined,
  ahora: Date,
): Pendiente {
  if (!fila || revisada(fila.detalle)) return { tipo: 'libre' };
  if (fila.resultado === 'incierto') {
    return { tipo: 'incierto', id: fila.id, iniciadaEn: fila.iniciada_en };
  }
  if (fila.resultado === 'en_curso') {
    return {
      tipo: abandonada(fila.iniciada_en, ahora) ? 'incierto' : 'en_curso',
      id: fila.id,
      iniciadaEn: fila.iniciada_en,
    };
  }
  return { tipo: 'libre' };
}

/**
 * La última fila confirmada de la llave que pudo llegar al SII (se saltan `uso` y
 * `config`, y la fila propia si se indica), clasificada: libre, incierta sin revisar
 * (o `en_curso` abandonada) o en curso.
 */
async function operacionPendiente(
  ctx: ContextoOperacion,
  ahora: Date,
  excluirId?: string,
): Promise<Pendiente> {
  try {
    let consulta = consultaLlave(ctx).not('resultado', 'in', '(uso,config)');
    if (excluirId) consulta = consulta.neq('id', excluirId);
    const { data, error } = await consulta.order('iniciada_en', { ascending: false }).limit(1);
    if (error) return { tipo: 'fallo', codigo: codigoDe(error) };
    return clasificar(data?.[0], ahora);
  } catch (error) {
    return { tipo: 'fallo', codigo: codigoDe(error) };
  }
}

/** La fila `en_curso` que hizo chocar el insert con el índice único (23505). */
async function filaEnCurso(ctx: ContextoOperacion, ahora: Date): Promise<Pendiente> {
  try {
    const { data, error } = await consultaLlave(ctx)
      .eq('resultado', 'en_curso')
      .order('iniciada_en', { ascending: false })
      .limit(1);
    if (error) return { tipo: 'fallo', codigo: codigoDe(error) };
    return clasificar(data?.[0], ahora);
  } catch (error) {
    return { tipo: 'fallo', codigo: codigoDe(error) };
  }
}

function mensajePendiente(
  ctx: ContextoOperacion,
  pendiente: Extract<Pendiente, { id: string }>,
): { motivo: 'en_curso' | 'incierto_sin_revisar'; mensaje: MensajeError } {
  return pendiente.tipo === 'en_curso'
    ? { motivo: 'en_curso', mensaje: mensajeEnCurso(ctx.operacion, pendiente.iniciadaEn) }
    : {
        motivo: 'incierto_sin_revisar',
        mensaje: mensajeInciertoPendiente(ctx.operacion, pendiente.iniciadaEn),
      };
}

// --- ejecutarOperacion ----------------------------------------------------------

function noEjecutada<T>(
  motivo: MotivoNoEjecutada,
  mensaje: MensajeError,
  extra: { operacionPendienteId?: string; operacionId?: string } = {},
): ResultadoEjecucion<T> {
  return {
    ok: false,
    ejecutada: false,
    motivo,
    mensaje: { ...mensaje },
    operacionId: extra.operacionId ?? null,
    ...(extra.operacionPendienteId ? { operacionPendienteId: extra.operacionPendienteId } : {}),
  };
}

/** Cierra como `uso` (nada salió al SII) la fila propia que el control posterior bloqueó. */
async function cerrarSinEjecutar(
  deps: DependenciasOperacion,
  ctx: ContextoOperacion,
  operacionId: string,
  mensaje: MensajeError,
  detalle: DetalleSeguro,
): Promise<void> {
  try {
    const { error } = await ctx.cliente
      .from('operaciones_sii')
      .update({
        resultado: 'uso',
        mensaje: mensajeEnTexto(mensaje),
        detalle,
        terminada_en: deps.reloj().toISOString(),
      })
      .eq('id', operacionId)
      .eq('organizacion_id', ctx.organizacionId);
    if (error) reportarFalloBase(deps, ctx, 'cerrar la operación', codigoDe(error), operacionId);
  } catch (error) {
    reportarFalloBase(deps, ctx, 'cerrar la operación', codigoDe(error), operacionId);
  }
}

/**
 * Ejecuta una llamada al SII con auditoría en `operaciones_sii` y registro en Sentry.
 * El orden de los pasos y por qué está en el encabezado de este archivo.
 *
 * `fn` lanza para todo lo que no sea `ok`: errores de la librería tal cual, o los de
 * la app (`ErrorUso`, `ErrorConfig`, `ErrorVerificacion`, `ErrorIncierto`; un
 * rechazo detectado por la app se lanza como `ErrorRespuestaSii`). Así hay un solo
 * camino de traducción, el mismo de `codigoDeError()` de la CLI.
 */
export async function ejecutarOperacion<T>(
  ctx: ContextoOperacion,
  fn: (herramientas: HerramientasOperacion) => Promise<T>,
): Promise<ResultadoEjecucion<T>> {
  const deps: DependenciasOperacion = {
    confirmarSesion: confirmarSesionConAuth,
    registrar: registrarEnSentry,
    reloj: () => new Date(),
    ...ctx.dependencias,
  };
  const etiquetas = etiquetasDe(ctx);
  const efectoGlobal = OPERACIONES_EFECTO_GLOBAL.includes(ctx.operacion);
  const vigilada = efectoGlobal && ctx.confirmada;
  const avisarBloqueo = (motivo: string) =>
    deps.registrar({
      tipo: 'breadcrumb',
      nivel: 'warning',
      mensaje: `Operación SII ${ctx.operacion} no ejecutada: ${motivo}`,
      etiquetas,
      usuarioId: ctx.usuarioId ?? undefined,
    });

  // 0. Una operación de efecto global siempre es de una empresa: sin ella, el índice
  //    único no la protegería (en un índice único los NULL no chocan).
  if (efectoGlobal && !ctx.empresaId) {
    const error = new Error(`Operación SII ${ctx.operacion} sin empresaId.`);
    error.name = 'ErrorUsoOperacion';
    deps.registrar({
      tipo: 'excepcion',
      nivel: 'error',
      mensaje: error.message,
      etiquetas,
      usuarioId: ctx.usuarioId ?? undefined,
      error,
    });
    return noEjecutada('uso', MENSAJE_SIN_EMPRESA);
  }

  // 1. Sesión viva antes de una operación ⚠️ confirmada por una persona.
  if (ctx.confirmada && ctx.usuarioId && OPERACIONES_QUE_GRABAN.includes(ctx.operacion)) {
    let valida = false;
    try {
      valida = await deps.confirmarSesion(ctx.usuarioId);
    } catch {
      valida = false;
    }
    if (!valida) {
      avisarBloqueo('sesión no válida');
      return noEjecutada('sesion_invalida', MENSAJE_SESION_INVALIDA);
    }
  }

  // 2. Control previo: un incierto sin revisar o una igual en curso bloquean (principio
  //    3). Evita filas que nacen bloqueadas; la garantía la dan los pasos 3 y 4.
  if (vigilada) {
    const pendiente = await operacionPendiente(ctx, deps.reloj());
    if (pendiente.tipo === 'fallo') {
      reportarFalloBase(deps, ctx, 'consultar la operación anterior', pendiente.codigo);
      return noEjecutada('sin_registro', MENSAJE_SIN_REGISTRO);
    }
    if (pendiente.tipo !== 'libre') {
      const { motivo, mensaje } = mensajePendiente(ctx, pendiente);
      avisarBloqueo(motivo);
      return noEjecutada(motivo, mensaje, { operacionPendienteId: pendiente.id });
    }
  }

  // 3. Fila en `en_curso`: sin ella no se llama al SII (principio 5). `iniciada_en` la
  //    pone la base (now()), así el orden de las filas no depende del reloj de cada
  //    función. Un 23505 es el índice único: otra igual entró primero.
  let operacionId: string;
  try {
    const { data, error } = await ctx.cliente
      .from('operaciones_sii')
      .insert({
        organizacion_id: ctx.organizacionId,
        empresa_id: ctx.empresaId ?? null,
        usuario_id: ctx.usuarioId ?? null,
        api_key_id: ctx.apiKeyId ?? null,
        operacion: ctx.operacion,
        ambiente: ctx.ambiente,
        canal: ctx.canal ?? null,
        confirmada: ctx.confirmada,
        resultado: 'en_curso',
        envio_id: ctx.envioId ?? null,
        solicitud_id: ctx.solicitudId ?? null,
        documento_id: ctx.documentoId ?? null,
      })
      .select('id')
      .single();
    if (error && codigoDe(error) === '23505' && vigilada) {
      // La otra puede estar viva (en curso) o abandonada (cuenta como incierta).
      const otra = await filaEnCurso(ctx, deps.reloj());
      avisarBloqueo('otra en curso (índice único)');
      if (otra.tipo === 'en_curso' || otra.tipo === 'incierto') {
        const { motivo, mensaje } = mensajePendiente(ctx, otra);
        return noEjecutada(motivo, mensaje, { operacionPendienteId: otra.id });
      }
      return noEjecutada('en_curso', MENSAJE_EN_CURSO_SIN_FILA);
    }
    if (error || !data) {
      reportarFalloBase(deps, ctx, 'insertar la operación', codigoDe(error));
      return noEjecutada('sin_registro', MENSAJE_SIN_REGISTRO);
    }
    operacionId = data.id;
  } catch (error) {
    reportarFalloBase(deps, ctx, 'insertar la operación', codigoDe(error));
    return noEjecutada('sin_registro', MENSAJE_SIN_REGISTRO);
  }

  // 4. Control posterior: con la fila propia en `en_curso` nadie más entra, así que las
  //    demás filas de la llave terminaron antes. Si la última que llegó al SII quedó
  //    incierta sin revisar (apareció entre el paso 2 y el 3), no se ejecuta.
  if (vigilada) {
    const pendiente = await operacionPendiente(ctx, deps.reloj(), operacionId);
    if (pendiente.tipo === 'fallo') {
      reportarFalloBase(deps, ctx, 'consultar la operación anterior', pendiente.codigo);
      await cerrarSinEjecutar(deps, ctx, operacionId, MENSAJE_SIN_REGISTRO, {
        motivo: 'sin_registro',
      });
      return noEjecutada('sin_registro', MENSAJE_SIN_REGISTRO, { operacionId });
    }
    if (pendiente.tipo !== 'libre') {
      const { motivo, mensaje } = mensajePendiente(ctx, pendiente);
      avisarBloqueo(`${motivo} (control posterior)`);
      await cerrarSinEjecutar(deps, ctx, operacionId, mensaje, {
        motivo,
        operacion_pendiente_id: pendiente.id,
      });
      return noEjecutada(motivo, mensaje, { operacionPendienteId: pendiente.id, operacionId });
    }
  }

  // 5. Ejecuta.
  let detalle: DetalleSeguro = {};
  const herramientas: HerramientasOperacion = {
    operacionId,
    agregarDetalle(datos) {
      detalle = { ...detalle, ...sanearDetalle(datos) };
    },
  };
  let resultado: ResultadoFinal = 'ok';
  let valor: T | undefined;
  let errorFn: unknown;
  try {
    valor = await fn(herramientas);
  } catch (error) {
    errorFn = error;
    resultado = resultadoDeError(error);
  }

  // 6. Cierra la fila. Si falla, se reporta, pero manda el resultado de la operación.
  const mensaje = resultado === 'ok' ? undefined : mensajeParaUsuario(resultado, errorFn);
  const detalleFinal: DetalleSeguro =
    resultado === 'ok' ? detalle : { ...detalle, error: detalleSeguro(errorFn) };
  try {
    const { error } = await ctx.cliente
      .from('operaciones_sii')
      .update({
        resultado,
        mensaje: mensaje ? mensajeEnTexto(mensaje) : null,
        detalle: detalleFinal,
        terminada_en: deps.reloj().toISOString(),
      })
      .eq('id', operacionId)
      .eq('organizacion_id', ctx.organizacionId);
    if (error) reportarFalloBase(deps, ctx, 'cerrar la operación', codigoDe(error), operacionId);
  } catch (error) {
    reportarFalloBase(deps, ctx, 'cerrar la operación', codigoDe(error), operacionId);
  }

  // 7. Sentry.
  try {
    registrarResultado(deps, ctx, resultado, operacionId, errorFn);
  } catch {
    // Sentry nunca tapa el resultado.
  }

  if (resultado === 'ok') return { ok: true, valor: valor as T, operacionId };
  return {
    ok: false,
    ejecutada: true,
    resultado,
    mensaje: mensaje ?? mensajeParaUsuario(resultado, errorFn),
    operacionId,
  };
}

// --- Marcar un incierto como revisado -----------------------------------------------

/**
 * Marca como revisada una operación `incierto` (o una `en_curso` abandonada, que
 * pasa a `incierto`): guarda `detalle.revisada_en` y `detalle.revisada_por`, y
 * desbloquea repetir la operación. Quien llama ya verificó la membresía y el rol.
 */
export async function marcarInciertaRevisada(
  cliente: ClienteServicio,
  datos: { organizacionId: string; operacionId: string; usuarioId: string },
  reloj: () => Date = () => new Date(),
): Promise<{ ok: true } | { ok: false; mensaje: MensajeError }> {
  const { data: fila, error } = await cliente
    .from('operaciones_sii')
    .select('id, resultado, detalle, iniciada_en')
    .eq('id', datos.operacionId)
    .eq('organizacion_id', datos.organizacionId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      mensaje: {
        titulo: 'No pudimos marcar la operación',
        detalle: 'Inténtalo de nuevo en unos minutos.',
      },
    };
  }
  if (!fila) {
    return {
      ok: false,
      mensaje: {
        titulo: 'No encontramos la operación',
        detalle: 'Puede que ya no exista o que sea de otra organización. Recarga la página.',
      },
    };
  }
  const ahora = reloj();
  const yaAbandonada = fila.resultado === 'en_curso' && abandonada(fila.iniciada_en, ahora);
  if (fila.resultado !== 'incierto' && !yaAbandonada) {
    return {
      ok: false,
      mensaje: {
        titulo: 'Esta operación no necesita revisión',
        detalle: 'Solo se marcan como revisadas las operaciones con resultado incierto.',
      },
    };
  }
  const anterior =
    fila.detalle !== null && typeof fila.detalle === 'object' && !Array.isArray(fila.detalle)
      ? fila.detalle
      : {};
  const cambios: Database['public']['Tables']['operaciones_sii']['Update'] = {
    detalle: {
      ...anterior,
      revisada_en: ahora.toISOString(),
      revisada_por: datos.usuarioId,
      ...(yaAbandonada ? { abandonada: true } : {}),
    },
  };
  if (yaAbandonada) {
    cambios.resultado = 'incierto';
    cambios.terminada_en = ahora.toISOString();
    cambios.mensaje =
      'La operación quedó sin terminar y no se sabe si el SII la completó. Se marcó como revisada.';
  }
  const { error: errorUpdate } = await cliente
    .from('operaciones_sii')
    .update(cambios)
    .eq('id', datos.operacionId)
    .eq('organizacion_id', datos.organizacionId);
  if (errorUpdate) {
    return {
      ok: false,
      mensaje: {
        titulo: 'No pudimos marcar la operación',
        detalle: 'Inténtalo de nuevo en unos minutos.',
      },
    };
  }
  return { ok: true };
}
