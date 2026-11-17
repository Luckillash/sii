import 'server-only';
import {
  type DetalleRepRechRest,
  type EstadoEnvio,
  type EstadoEnvioRest,
  SiiError,
} from '@winex/certificacion';
import type { ClasificacionEnvio } from '@/lib/seguimiento';
import { sanearTexto } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import type { Json } from '../supabase/tipos';
import type { EnvioSeguimiento, RespuestaEstado } from './tipos';

// Lo que el seguimiento escribe en la base por cada consulta al SII (Fase 8).
//
// ORDEN (importa por los triggers de 0001_esquema_inicial.sql):
//
//   -. Antes de escribir: un EPR cuyo detalle por documento no cubre sus contadores no se
//      guarda (`detalleIncompleto`), y un envío que ya quedó final no se pisa (`ya_final`).
//   1. `envio_estadisticas` (upsert por envío y tipo): no tiene triggers.
//   2. `envio_rechazos` (upsert por envío, tipo y folio). `trg_10_envio_rechazo` enlaza
//      el documento por empresa, ambiente, tipo y folio, y `trg_50_envio_rechazo_sincronizar`
//      llama a `sincronizar_documentos_envio` con el envío TODAVÍA en su estado anterior
//      (en proceso o pendiente): los documentos quedan `enviado` (o sin cambio), nunca en
//      un estado final.
//   3. `envios` (estado, conteos, respuesta, `ultima_consulta_en`, `consultas + 1`), solo
//      si su clasificación no es final (filtro en el mismo update). Si
//      cambian estado o conteos, `trg_50_envio_actualizado` vuelve a sincronizar los
//      documentos, ahora con los rechazos ya guardados, y encola `envio.actualizado`.
//   4. `consultas_envio` (la bitácora).
//
// Al revés (envío antes que rechazos), un EPR con rechazos dejaría primero TODOS los
// documentos `aceptado` (no hay rechazos que mirar) y `tg_evento_documento` encolaría un
// webhook `documento.aceptado` falso, antes de que el rechazo los pasara a `rechazado`. El
// estado final sería el mismo; los webhooks, no.
//
// Saneado: el token del SII nunca entra en lo que se guarda. El JSON de la respuesta pasa
// por `jsonSeguro` (sin claves sensibles, textos por `sanearTexto` y sin el token literal,
// aunque el SII lo devolviera), y de un error solo se guarda el texto de los errores de la
// librería (escrito para mostrarse); de uno desconocido, su nombre.

/** Claves que nunca se guardan de una respuesta, aunque el SII las mandara. */
const CLAVE_SENSIBLE =
  /token|cookie|clave|contrase|password|secret|authorization|bearer|rsask|pfx|session|sesion/i;
const PROFUNDIDAD_MAXIMA = 8;
/** Holgado: el detalle de un lote grande (API, Fase 11) puede traer cientos de documentos. */
const ELEMENTOS_MAXIMOS = 2000;
const FILTRADO = '[FILTRADO]';

/** Un texto sin secretos: sin los valores dados (el token) y por `sanearTexto`. */
export function textoSeguro(texto: string, secretos: readonly string[] = []): string {
  let salida = texto;
  for (const secreto of secretos) {
    if (secreto !== '') salida = salida.replaceAll(secreto, FILTRADO);
  }
  return sanearTexto(salida);
}

function aJsonSeguro(valor: unknown, secretos: readonly string[], profundidad: number): Json {
  if (typeof valor === 'string') return textoSeguro(valor, secretos);
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'boolean' || valor === null || valor === undefined) return valor ?? null;
  if (typeof valor !== 'object') return null;
  if (profundidad >= PROFUNDIDAD_MAXIMA) return FILTRADO;
  if (Array.isArray(valor)) {
    return valor.slice(0, ELEMENTOS_MAXIMOS).map((v) => aJsonSeguro(v, secretos, profundidad + 1));
  }
  const salida: Record<string, Json> = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (CLAVE_SENSIBLE.test(clave)) continue;
    salida[clave] = aJsonSeguro(v, secretos, profundidad + 1);
  }
  return salida;
}

/** Copia de una respuesta del SII apta para `respuesta_estado` / `consultas_envio.respuesta`. */
export function jsonSeguro(valor: unknown, secretos: readonly string[] = []): Json {
  return aJsonSeguro(valor, secretos, 0);
}

/**
 * Texto de un error para `consultas_envio.error`. Solo el de los errores de la librería
 * (escrito para mostrarse, y aun así saneado) o el título de un error con `MensajeError`
 * propio (`ErrorCredenciales`); de uno desconocido, solo su nombre: su mensaje podría traer
 * cualquier cosa.
 */
export function textoDeError(error: unknown, secretos: readonly string[] = []): string {
  if (error instanceof SiiError) return textoSeguro(`${error.name}: ${error.message}`, secretos);
  if (error instanceof Error) {
    const propio = (error as { mensaje?: { titulo?: unknown } }).mensaje;
    if (propio && typeof propio.titulo === 'string') {
      return textoSeguro(`${error.name}: ${propio.titulo}`, secretos);
    }
    if (error.name === 'ErrorPersistencia') return textoSeguro(error.message, secretos);
    return `${textoSeguro(error.name)} (sin detalle)`;
  }
  return 'Error (sin detalle)';
}

/** Falla de la base al guardar una consulta. Su mensaje es nuestro (sin datos de la fila). */
export class ErrorPersistencia extends Error {
  override name = 'ErrorPersistencia';
  constructor(paso: string, error: { code?: string } | null | undefined) {
    super(`No se pudo ${paso}${error?.code ? ` (código ${error.code})` : ''}.`);
  }
}

// --- Normalización de las respuestas de la librería ---------------------------------

/** La respuesta REST (`ClienteBoletaRest.consultarEnvio`), tal cual la leyó la librería. */
export function desdeRest(estado: EstadoEnvioRest): RespuestaEstado {
  const glosa = estado.json.glosa;
  return {
    estado: estado.estado,
    glosa: typeof glosa === 'string' && glosa.trim() !== '' ? glosa.trim() : null,
    informados: estado.informados,
    aceptados: estado.aceptados,
    rechazados: estado.rechazados,
    reparos: estado.reparos,
    estadistica: estado.estadistica,
    detalle: estado.detalleRepRech,
    conDetalle: true,
    json: estado.json,
  };
}

/** La respuesta SOAP (`ClienteDtews.estadoEnvio`, QueryEstUp): sin detalle por documento. */
export function desdeSoap(estado: EstadoEnvio): RespuestaEstado {
  return {
    estado: estado.estado,
    glosa: estado.glosa.trim() === '' ? null : estado.glosa.trim(),
    informados: estado.informados,
    aceptados: estado.aceptados,
    rechazados: estado.rechazados,
    reparos: estado.reparos,
    estadistica: [],
    detalle: [],
    conDetalle: false,
    json: {
      trackid: estado.trackId,
      estado: estado.estado,
      glosa: estado.glosa,
      informados: estado.informados,
      aceptados: estado.aceptados,
      rechazados: estado.rechazados,
      reparos: estado.reparos,
    },
  };
}

// --- Escritura --------------------------------------------------------------------

/**
 * Reparo o rechazo de un documento de `detalle_rep_rech`. Mismo criterio que el envío
 * del set (Fase 5): RPR, REP y RLV son reparos; si el envío no tiene rechazos pero sí
 * reparos, todo su detalle es de reparos aunque el código no sea uno de esos.
 */
export function tipoObservacion(
  detalle: Pick<DetalleRepRechRest, 'estado'>,
  respuesta: Pick<RespuestaEstado, 'rechazados' | 'reparos'>,
): 'rechazo' | 'reparo' {
  if (/^(RPR|REP|RLV)$/i.test(detalle.estado.trim())) return 'reparo';
  if (respuesta.rechazados === 0 && respuesta.reparos > 0) return 'reparo';
  return 'rechazo';
}

/** Cambió lo mismo que mira `trg_50_envio_actualizado` (estado o conteos). */
export function huboCambio(envio: EnvioSeguimiento, r: RespuestaEstado): boolean {
  return (
    envio.estado_sii !== r.estado ||
    envio.informados !== r.informados ||
    envio.aceptados !== r.aceptados ||
    envio.rechazados !== r.rechazados ||
    envio.reparos !== r.reparos
  );
}

export type ResultadoGuardado =
  | {
      tipo: 'guardado';
      estadoSii: string;
      glosaSii: string | null;
      clasificacion: ClasificacionEnvio;
      cambio: boolean;
    }
  /**
   * EPR con más rechazos o reparos en los contadores que en el detalle por documento
   * (SOAP nunca trae detalle; REST podría traerlo incompleto). Guardar el estado haría que
   * `sincronizar_documentos_envio`, que solo mira `envio_rechazos`, dejara `aceptado` a
   * documentos que el SII rechazó. Se anota la consulta con el error y el envío queda como
   * estaba, para revisarlo en el portal del SII.
   */
  | { tipo: 'sin_detalle'; estadoSii: string }
  /**
   * El envío ya tenía un estado final cuando llegó esta respuesta (otra consulta lo cerró
   * en paralelo): no se pisa ni se tocan sus rechazos. Solo queda en la bitácora.
   */
  | { tipo: 'ya_final'; clasificacion: ClasificacionEnvio };

export const TEXTO_SIN_DETALLE =
  'QueryEstUp (SOAP) no trae el detalle por documento: revisa los rechazos y reparos de este envío en el portal del SII.';

/** Clasificaciones que una respuesta posterior nunca pisa (`inconsistente` sí se reconsulta). */
export const CLASIFICACIONES_FINALES: readonly ClasificacionEnvio[] = Object.freeze([
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
]);

/** Detalle sin repetidos (un documento repetido chocaría consigo mismo en el upsert). */
function detalleUnico(r: RespuestaEstado): Map<string, DetalleRepRechRest> {
  const unicos = new Map<string, DetalleRepRechRest>();
  for (const d of r.detalle) unicos.set(`${d.tipo}:${d.folio}`, d);
  return unicos;
}

/**
 * Si el detalle por documento no alcanza para los contadores de un EPR: menos documentos
 * rechazados (o con reparos) en `detalle_rep_rech` que `rechazados` (o `reparos`).
 * `null` si el detalle está completo (o no es EPR, o es un RCOF, que no tiene documentos).
 */
export function detalleIncompleto(
  envio: Pick<EnvioSeguimiento, 'proposito'>,
  r: RespuestaEstado,
): string | null {
  if (r.estado !== 'EPR' || envio.proposito === 'rcof') return null;
  if (r.rechazados === 0 && r.reparos === 0) return null;
  let rechazos = 0;
  let reparos = 0;
  for (const d of detalleUnico(r).values()) {
    if (tipoObservacion(d, r) === 'rechazo') rechazos++;
    else reparos++;
  }
  if (rechazos >= r.rechazados && reparos >= r.reparos) return null;
  if (!r.conDetalle) return TEXTO_SIN_DETALLE;
  return (
    `El SII informó ${r.rechazados} documentos rechazados y ${r.reparos} con reparos, pero su detalle ` +
    `solo trae ${rechazos} y ${reparos}: no se guardó el estado para no dar por aceptados documentos ` +
    'que pueden estar rechazados. Revisa los rechazos y reparos de este envío en el portal del SII.'
  );
}

function filaRechazo(
  envio: EnvioSeguimiento,
  r: RespuestaEstado,
  d: DetalleRepRechRest,
  secretos: readonly string[],
) {
  return {
    organizacion_id: envio.organizacion_id,
    envio_id: envio.id,
    tipo_dte: d.tipo,
    folio: d.folio,
    estado: textoSeguro(d.estado, secretos),
    tipo_observacion: tipoObservacion(d, r),
    descripcion: d.descripcion === '' ? null : textoSeguro(d.descripcion, secretos),
    errores: d.errores.map((e) => ({
      seccion: textoSeguro(e.seccion, secretos),
      linea: e.linea,
      nivel: e.nivel,
      codigo: e.codigo,
      descripcion: textoSeguro(e.descripcion, secretos),
      detalle: textoSeguro(e.detalle, secretos),
    })),
  };
}

/** Upsert del detalle y limpieza de los rechazos que el SII ya no informa. */
async function guardarRechazos(
  cliente: ClienteServicio,
  envio: EnvioSeguimiento,
  r: RespuestaEstado,
  secretos: readonly string[],
): Promise<void> {
  const unicos = detalleUnico(r);

  if (unicos.size > 0) {
    const { error } = await cliente.from('envio_rechazos').upsert(
      [...unicos.values()].map((d) => filaRechazo(envio, r, d, secretos)),
      { onConflict: 'envio_id,tipo_dte,folio' },
    );
    if (error) throw new ErrorPersistencia('guardar los rechazos del envío', error);
  }

  // Rechazos de una consulta anterior que ya no vienen. Solo un EPR tiene autoridad para
  // decir que un documento ya no está rechazado: una respuesta en proceso que llegue tarde
  // (sin detalle) nunca borra el detalle de un EPR guardado en paralelo. Borrar no dispara
  // la sincronización, pero el update del envío sí.
  if (r.estado !== 'EPR') return;
  const { data: existentes, error } = await cliente
    .from('envio_rechazos')
    .select('id, tipo_dte, folio')
    .eq('organizacion_id', envio.organizacion_id)
    .eq('envio_id', envio.id);
  if (error) throw new ErrorPersistencia('leer los rechazos del envío', error);
  const sobrantes = (existentes ?? [])
    .filter((f) => !unicos.has(`${f.tipo_dte}:${f.folio}`))
    .map((f) => f.id);
  if (sobrantes.length > 0) {
    const borrado = await cliente
      .from('envio_rechazos')
      .delete()
      .eq('organizacion_id', envio.organizacion_id)
      .in('id', sobrantes);
    if (borrado.error) throw new ErrorPersistencia('limpiar los rechazos del envío', borrado.error);
  }
}

/**
 * Guarda una respuesta del SII en el orden del encabezado. Lanza `ErrorPersistencia` si
 * falla una escritura de 1 a 3 (la consulta cuenta como error y el envío se vuelve a
 * consultar en la próxima corrida); la bitácora (4) es de mejor esfuerzo.
 */
export async function guardarRespuesta(
  cliente: ClienteServicio,
  envio: EnvioSeguimiento,
  r: RespuestaEstado,
  ahora: Date,
  secretos: readonly string[],
): Promise<ResultadoGuardado> {
  const json = jsonSeguro(r.json, secretos);
  const estado = textoSeguro(r.estado, secretos);
  const glosa = r.glosa === null ? null : textoSeguro(r.glosa, secretos);
  const conteos = {
    informados: r.informados,
    aceptados: r.aceptados,
    rechazados: r.rechazados,
    reparos: r.reparos,
  };

  const incompleto = detalleIncompleto(envio, r);
  if (incompleto !== null) {
    await anotarIntento(cliente, envio, ahora);
    await bitacora(cliente, envio, ahora, {
      estado_sii: estado,
      glosa_sii: glosa,
      ...conteos,
      error: incompleto,
      respuesta: json,
    });
    return { tipo: 'sin_detalle', estadoSii: estado };
  }

  // 0. ¿Ya quedó final (otra consulta en paralelo)? Entonces esta respuesta no escribe
  //    nada más que la bitácora. El update de 3 repite el control (es la garantía); este
  //    evita tocar estadísticas y rechazos con una respuesta vieja.
  const actual = await cliente
    .from('envios')
    .select('clasificacion')
    .eq('organizacion_id', envio.organizacion_id)
    .eq('id', envio.id)
    .maybeSingle();
  if (actual.error || !actual.data) {
    throw new ErrorPersistencia('leer el estado del envío', actual.error);
  }
  const clasificacionActual = actual.data.clasificacion as ClasificacionEnvio | null;
  if (clasificacionActual && CLASIFICACIONES_FINALES.includes(clasificacionActual)) {
    await bitacora(cliente, envio, ahora, {
      estado_sii: estado,
      glosa_sii: glosa,
      ...conteos,
      respuesta: json,
    });
    return { tipo: 'ya_final', clasificacion: clasificacionActual };
  }

  // 1. Estadística por tipo de documento.
  if (r.estadistica.length > 0) {
    const { error } = await cliente.from('envio_estadisticas').upsert(
      r.estadistica.map((e) => ({
        organizacion_id: envio.organizacion_id,
        envio_id: envio.id,
        tipo_dte: e.tipo,
        informados: e.informados,
        aceptados: e.aceptados,
        rechazados: e.rechazados,
        reparos: e.reparos,
      })),
      { onConflict: 'envio_id,tipo_dte' },
    );
    if (error) throw new ErrorPersistencia('guardar las estadísticas del envío', error);
  }

  // 2. Rechazos y reparos, ANTES del estado del envío (ver encabezado). Solo el REST trae
  //    el detalle; en SOAP no se tocan.
  if (r.conDetalle) await guardarRechazos(cliente, envio, r, secretos);

  // 3. El envío, solo si no quedó final entretanto (el filtro va en el mismo update). La
  //    clasificación es una columna generada: se lee de vuelta.
  //    `consultas + 1` se calcula con el valor leído: dos consultas simultáneas del mismo
  //    envío (cron y panel) pueden contar una sola. Se acepta: es un contador para el
  //    *backoff*, no auditoría (esa es `consultas_envio`), y un incremento atómico pediría
  //    una RPC nueva (migración).
  const { data, error } = await cliente
    .from('envios')
    .update({
      estado_sii: estado,
      glosa_sii: glosa,
      ...conteos,
      respuesta_estado: json,
      ultima_consulta_en: ahora.toISOString(),
      consultas: envio.consultas + 1,
    })
    .eq('organizacion_id', envio.organizacion_id)
    .eq('id', envio.id)
    .not('clasificacion', 'in', `(${CLASIFICACIONES_FINALES.join(',')})`)
    .select('clasificacion');
  if (error) throw new ErrorPersistencia('guardar el estado del envío', error);
  const fila = data?.[0];
  if (!fila) {
    // Otra consulta lo cerró entre el control 0 y este update.
    await bitacora(cliente, envio, ahora, {
      estado_sii: estado,
      glosa_sii: glosa,
      ...conteos,
      respuesta: json,
    });
    return { tipo: 'ya_final', clasificacion: clasificacionActual ?? 'pendiente' };
  }

  // 4. La bitácora.
  await bitacora(cliente, envio, ahora, {
    estado_sii: estado,
    glosa_sii: glosa,
    ...conteos,
    respuesta: json,
  });

  return {
    tipo: 'guardado',
    estadoSii: estado,
    glosaSii: glosa,
    clasificacion: fila.clasificacion ?? 'pendiente',
    cambio: huboCambio(envio, r),
  };
}

/**
 * Anota un intento fallido: fila en `consultas_envio` con el error y el envío con
 * `ultima_consulta_en` y `consultas + 1`. Lo segundo no cambia estado ni conteos (no
 * dispara triggers) y sirve para que un envío que falla siempre no quede primero en la
 * cola de cada corrida (y para que se le aplique el *backoff*). De mejor esfuerzo: nunca
 * lanza.
 */
export async function registrarFalla(
  cliente: ClienteServicio,
  envio: EnvioSeguimiento,
  error: unknown,
  ahora: Date,
  secretos: readonly string[],
): Promise<void> {
  await bitacora(cliente, envio, ahora, { error: textoDeError(error, secretos) });
  await anotarIntento(cliente, envio, ahora);
}

async function anotarIntento(
  cliente: ClienteServicio,
  envio: EnvioSeguimiento,
  ahora: Date,
): Promise<void> {
  try {
    const { error } = await cliente
      .from('envios')
      .update({ ultima_consulta_en: ahora.toISOString(), consultas: envio.consultas + 1 })
      .eq('organizacion_id', envio.organizacion_id)
      .eq('id', envio.id);
    if (error) console.warn(`seguimiento: no se anotó el intento (código ${error.code})`);
  } catch {
    console.warn('seguimiento: no se anotó el intento');
  }
}

async function bitacora(
  cliente: ClienteServicio,
  envio: EnvioSeguimiento,
  ahora: Date,
  datos: {
    estado_sii?: string;
    glosa_sii?: string | null;
    informados?: number;
    aceptados?: number;
    rechazados?: number;
    reparos?: number;
    error?: string;
    respuesta?: Json;
  },
): Promise<void> {
  try {
    const { error } = await cliente.from('consultas_envio').insert({
      organizacion_id: envio.organizacion_id,
      envio_id: envio.id,
      consultado_en: ahora.toISOString(),
      ...datos,
    });
    if (error) console.warn(`seguimiento: no se guardó la consulta (código ${error.code})`);
  } catch {
    console.warn('seguimiento: no se guardó la consulta');
  }
}
