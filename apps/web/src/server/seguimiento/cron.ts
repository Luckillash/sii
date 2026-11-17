import 'server-only';
import type { ResumenSeguimiento } from '@/lib/seguimiento';
import {
  ejecutarOperacion,
  MINUTOS_EN_CURSO_ABANDONADA,
  registrarEnSentry,
} from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import { clienteEstado, consultarConRenovacion, rutDeEmpresa, tokenRechazado } from './consulta';
import { type DependenciasSeguimiento, resolverDependenciasSeguimiento } from './dependencias';
import { guardarRespuesta, registrarFalla } from './persistencia';
import { COLUMNAS_ENVIO, type EnvioSeguimiento } from './tipos';

// Seguimiento automático de envíos (PLAN-SAAS Fase 8, `/api/cron/seguimiento` cada 5 min).
//
//   0. Cierra las operaciones `seguimiento` / `consultar_envio` que una corrida cortada
//      dejó `en_curso` (ver `cerrarAbandonadas`).
//   1. Lee los envíos a los que TOCA consultar, con el *backoff* en el filtro de PostgREST
//      (`filtroPorConsultar`): `v_envios_por_consultar` (en proceso o pendientes con Track
//      ID) más los `inconsistente` (EPR cuyos conteos no cuadran; la vista no los trae).
//      Los `incierto` no tienen Track ID: nunca se consultan ni se reenvían (principio 3).
//   2. Prioriza `ultima_consulta_en nulls first` y toma hasta `TOPE_ENVIOS` por corrida.
//   3. Agrupa por empresa + ambiente + canal: un certificado, un transporte y UN token por
//      grupo (los tokens REST y DTEWS son distintos, por eso el canal también agrupa).
//   4. Cada grupo es UNA operación `seguimiento` en `operaciones_sii` (principio 5). Una
//      fila por consulta serían hasta 100 filas cada 5 minutos (28.800 al día) con lo que
//      ya guarda `consultas_envio` envío por envío; una por grupo deja la auditoría de cada
//      salida al SII (token incluido) con los conteos en `detalle`, y el resultado del
//      grupo: `ok` si al menos una consulta respondió; si fallaron todas, el error de la
//      última (p. ej. `transporte`, con su host en Sentry). Si el token o el certificado
//      fallan, el grupo se omite (`gruposOmitidos`) y se reintenta en la próxima corrida.
//   5. Por consulta: `guardarRespuesta` (orden de escrituras en ./persistencia.ts). Una
//      falla de red/HTTP, una respuesta ilegible o un estado desconocido deja su fila en
//      `consultas_envio` con el `error` y sigue con el resto.
//   6. Tiempo: antes de cada paso que sale al SII se mira si cabe su peor caso dentro de
//      `LIMITE_MS` (ver abajo); lo que no cabe queda para la próxima corrida.
//
// Solo lectura en el SII: aquí no se envía ni se firma nada.

/** Máximo de envíos por corrida: 100 consultas de ~1 s caben de sobra en 300 s. */
export const TOPE_ENVIOS = 100;

/** Tope de una petición al SII: `TransporteUndici` corta a los 45 s. */
export const MS_PETICION = 45_000;

/** Leer la empresa y abrir el certificado de Vault (base, sin SII): holgado. */
export const MS_PREPARAR_GRUPO = 15_000;

/**
 * Hasta dónde puede llegar el trabajo: la ruta tiene `maxDuration = 300` y se dejan 20 s
 * para cerrar la operación del grupo, el *check-in* de Sentry y la respuesta. Antes de
 * cada paso se exige que su PEOR caso termine antes de este límite:
 *
 *   - empezar un grupo: preparar (15 s) + token (semilla y token: 2 × 45 s) + la primera
 *     consulta (45 s) = 150 s → ningún grupo empieza después del segundo 130;
 *   - otra consulta del grupo: 45 s;
 *   - renovar el token: semilla + token + repetir la consulta = 3 × 45 s = 135 s.
 *
 * Así nada que haya empezado puede pasar del segundo 280 aunque cada petición agote su
 * tope. Si aun así Vercel corta la función (p. ej. la base se cuelga), la fila queda
 * `en_curso` y la cierra `cerrarAbandonadas` en una corrida posterior.
 */
export const LIMITE_MS = 280_000;
export const MS_EMPEZAR_GRUPO = MS_PREPARAR_GRUPO + 3 * MS_PETICION;
export const MS_CONSULTA = MS_PETICION;
export const MS_RENOVAR = 3 * MS_PETICION;

/**
 * *Backoff* sin migración, por `envios.consultas` (que cuenta también los intentos
 * fallidos): la primera hora se consulta en cada corrida; después, cada vez menos.
 */
export const ESCALONES_BACKOFF: readonly { desde: number; minutos: number }[] = Object.freeze([
  { desde: 0, minutos: 4 }, //   ~12 consultas en la primera hora (el cron corre cada 5 min)
  { desde: 12, minutos: 15 }, // ~3 horas más
  { desde: 24, minutos: 60 }, // ~1 día más
  { desde: 48, minutos: 360 }, // de ahí en adelante, cada 6 horas
]);

/**
 * Un envío que lleva más de `DIAS_SIN_CERRAR` desde `enviado_en` sin estado final ya no
 * se va a resolver solo: se consulta una vez al día y cada consulta deja un aviso en
 * Sentry (como mucho uno por envío y día, porque se consulta una vez al día).
 */
export const DIAS_SIN_CERRAR = 7;
export const MINUTOS_SIN_CERRAR = 24 * 60;

/** Minutos que tienen que pasar desde la última consulta, según cuántas lleva. */
export function intervaloMinutos(consultas: number): number {
  let minutos = ESCALONES_BACKOFF[0]?.minutos ?? 4;
  for (const escalon of ESCALONES_BACKOFF) {
    if (consultas >= escalon.desde) minutos = escalon.minutos;
  }
  return minutos;
}

function hace(ahora: Date, minutos: number): Date {
  return new Date(ahora.getTime() - minutos * 60_000);
}

/** Si el envío salió hace más de `DIAS_SIN_CERRAR` días. */
export function sinCerrar(envio: Pick<EnvioSeguimiento, 'enviado_en'>, ahora: Date): boolean {
  if (envio.enviado_en === null) return false;
  const enviado = Date.parse(envio.enviado_en);
  return !Number.isNaN(enviado) && enviado < hace(ahora, DIAS_SIN_CERRAR * 24 * 60).getTime();
}

/**
 * Si toca consultar el envío. Es la MISMA regla que `filtroPorConsultar` (que es la que
 * se aplica de verdad, en la base); esta queda para que las pruebas comparen ambas.
 */
export function debeConsultar(
  envio: Pick<EnvioSeguimiento, 'consultas' | 'ultima_consulta_en' | 'enviado_en'>,
  ahora: Date,
): boolean {
  if (envio.ultima_consulta_en === null) return true;
  const ultima = Date.parse(envio.ultima_consulta_en);
  if (Number.isNaN(ultima)) return true;
  const minutos = sinCerrar(envio, ahora) ? MINUTOS_SIN_CERRAR : intervaloMinutos(envio.consultas);
  return ultima <= hace(ahora, minutos).getTime();
}

/**
 * El *backoff* como filtro `or` de PostgREST, para que la base devuelva solo los envíos a
 * los que toca consultar. Filtrar en JS después de un `limit` dejaba fuera de la ventana a
 * un envío nuevo cuando había cientos en *backoff* largo con `ultima_consulta_en` más
 * antigua (cola con hambre). Las fechas van entre comillas (llevan `:` y `.`).
 */
export function filtroPorConsultar(ahora: Date): string {
  const fecha = (d: Date) => `"${d.toISOString()}"`;
  const corteAntiguo = fecha(hace(ahora, DIAS_SIN_CERRAR * 24 * 60));
  const reciente = `or(enviado_en.is.null,enviado_en.gte.${corteAntiguo})`;
  const tramos = ESCALONES_BACKOFF.map((escalon, i) => {
    const siguiente = ESCALONES_BACKOFF[i + 1];
    const partes = [
      reciente,
      `consultas.gte.${escalon.desde}`,
      ...(siguiente ? [`consultas.lt.${siguiente.desde}`] : []),
      `ultima_consulta_en.lte.${fecha(hace(ahora, escalon.minutos))}`,
    ];
    return `and(${partes.join(',')})`;
  });
  const antiguo = `and(enviado_en.lt.${corteAntiguo},ultima_consulta_en.lte.${fecha(hace(ahora, MINUTOS_SIN_CERRAR))})`;
  return ['ultima_consulta_en.is.null', ...tramos, antiguo].join(',');
}

/** Falla al leer los envíos: la corrida no puede seguir (el *cron monitor* queda en error). */
export class ErrorSeguimiento extends Error {
  override name = 'ErrorSeguimiento';
}

export interface OpcionesSeguimiento {
  tope?: number;
  /** Límite de la corrida (pruebas). Por defecto `LIMITE_MS`. */
  limiteMs?: number;
}

/** La fila con los no nulos que garantiza la tabla (la vista los tipa nullables). */
function aEnvio(fila: Record<string, unknown>): EnvioSeguimiento | null {
  const { id, organizacion_id, empresa_id, ambiente, canal, proposito, track_id, clasificacion } =
    fila;
  if (
    typeof id !== 'string' ||
    typeof organizacion_id !== 'string' ||
    typeof empresa_id !== 'string' ||
    (ambiente !== 'certificacion' && ambiente !== 'produccion') ||
    typeof track_id !== 'string' ||
    fila.incierto === true
  ) {
    return null;
  }
  const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const textoONulo = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id,
    organizacion_id,
    empresa_id,
    ambiente,
    canal: canal === 'soap' ? 'soap' : 'rest',
    proposito: proposito === 'set_pruebas' || proposito === 'rcof' ? proposito : 'emision',
    track_id,
    incierto: false,
    estado_sii: textoONulo(fila.estado_sii),
    glosa_sii: textoONulo(fila.glosa_sii),
    informados: numero(fila.informados),
    aceptados: numero(fila.aceptados),
    rechazados: numero(fila.rechazados),
    reparos: numero(fila.reparos),
    consultas: numero(fila.consultas),
    ultima_consulta_en: textoONulo(fila.ultima_consulta_en),
    enviado_en: textoONulo(fila.enviado_en),
    clasificacion: (textoONulo(clasificacion) as EnvioSeguimiento['clasificacion']) ?? null,
  };
}

function filas(data: unknown): EnvioSeguimiento[] {
  return ((data ?? []) as Record<string, unknown>[])
    .map(aEnvio)
    .filter((e): e is EnvioSeguimiento => e !== null);
}

function errorLectura(origen: string, error: { code?: string }): ErrorSeguimiento {
  return new ErrorSeguimiento(
    `No se pudo leer ${origen}${error.code ? ` (código ${error.code})` : ''}.`,
  );
}

/** Orden de prioridad: nunca consultados primero, luego los consultados hace más tiempo. */
function porPrioridad(a: EnvioSeguimiento, b: EnvioSeguimiento): number {
  if (a.ultima_consulta_en === b.ultima_consulta_en) return 0;
  if (a.ultima_consulta_en === null) return -1;
  if (b.ultima_consulta_en === null) return 1;
  return a.ultima_consulta_en.localeCompare(b.ultima_consulta_en);
}

async function leerPorConsultar(
  cliente: ClienteServicio,
  ahora: Date,
  tope: number,
): Promise<EnvioSeguimiento[]> {
  const filtro = filtroPorConsultar(ahora);
  const vista = await cliente
    .from('v_envios_por_consultar')
    .select(COLUMNAS_ENVIO)
    .or(filtro)
    .order('ultima_consulta_en', { ascending: true, nullsFirst: true })
    .limit(tope);
  if (vista.error) throw errorLectura('v_envios_por_consultar', vista.error);
  // Los `inconsistente` quedan fuera de la vista (y el panel no puede cerrarlos solo): se
  // leen aparte, con el mismo *backoff*. Un EPR inconsistente siempre tiene Track ID.
  const inconsistentes = await cliente
    .from('envios')
    .select(COLUMNAS_ENVIO)
    .eq('clasificacion', 'inconsistente')
    .eq('incierto', false)
    .or(filtro)
    .order('ultima_consulta_en', { ascending: true, nullsFirst: true })
    .limit(tope);
  if (inconsistentes.error) throw errorLectura('los envíos inconsistentes', inconsistentes.error);

  const unicos = new Map<string, EnvioSeguimiento>();
  for (const e of [...filas(vista.data), ...filas(inconsistentes.data)]) unicos.set(e.id, e);
  return [...unicos.values()].sort(porPrioridad).slice(0, tope);
}

/**
 * Cierra las operaciones del seguimiento que quedaron `en_curso` hace más de
 * `MINUTOS_EN_CURSO_ABANDONADA` (Vercel cortó la función antes de cerrarlas).
 * `ejecutarOperacion` solo trata como abandonadas las de efecto global (para bloquear su
 * reintento); estas son de lectura y no bloquean nada, pero sin cerrar ensucian la
 * auditoría y los contadores de «en curso». Se cierran como `error`, con un mensaje que
 * dice que no quedó nada pendiente en el SII. De mejor esfuerzo: nunca lanza.
 */
export async function cerrarAbandonadas(cliente: ClienteServicio, ahora: Date): Promise<number> {
  try {
    const { data, error } = await cliente
      .from('operaciones_sii')
      .select('id, organizacion_id, iniciada_en')
      .in('operacion', ['seguimiento', 'consultar_envio'])
      .eq('resultado', 'en_curso')
      .order('iniciada_en', { ascending: true })
      .limit(200);
    if (error || !data) return 0;
    const corte = hace(ahora, MINUTOS_EN_CURSO_ABANDONADA).getTime();
    const porOrganizacion = new Map<string, string[]>();
    for (const fila of data) {
      if (Date.parse(fila.iniciada_en) >= corte) continue;
      const ids = porOrganizacion.get(fila.organizacion_id) ?? [];
      ids.push(fila.id);
      porOrganizacion.set(fila.organizacion_id, ids);
    }
    let cerradas = 0;
    for (const [organizacionId, ids] of porOrganizacion) {
      const r = await cliente
        .from('operaciones_sii')
        .update({
          resultado: 'error',
          mensaje:
            'La consulta de estado se cortó antes de terminar (límite de tiempo de la función). Es de solo lectura: no quedó nada pendiente en el SII.',
          detalle: { abandonada: true },
          terminada_en: ahora.toISOString(),
        })
        .eq('organizacion_id', organizacionId)
        .eq('resultado', 'en_curso')
        .in('id', ids);
      if (!r.error) cerradas += ids.length;
    }
    return cerradas;
  } catch {
    return 0;
  }
}

interface Grupo {
  organizacionId: string;
  empresaId: string;
  ambiente: EnvioSeguimiento['ambiente'];
  canal: EnvioSeguimiento['canal'];
  envios: EnvioSeguimiento[];
}

/** Grupos en el orden de prioridad de su primer envío (el más atrasado primero). */
export function agrupar(envios: readonly EnvioSeguimiento[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const envio of envios) {
    const llave = `${envio.organizacion_id}:${envio.empresa_id}:${envio.ambiente}:${envio.canal}`;
    let grupo = grupos.get(llave);
    if (!grupo) {
      grupo = {
        organizacionId: envio.organizacion_id,
        empresaId: envio.empresa_id,
        ambiente: envio.ambiente,
        canal: envio.canal,
        envios: [],
      };
      grupos.set(llave, grupo);
    }
    grupo.envios.push(envio);
  }
  return [...grupos.values()];
}

interface Parcial {
  consultados: number;
  cambiados: number;
  errores: number;
  postergados: number;
  sinCerrar: number;
}

/** ¿Termina antes del límite algo que puede tardar `ms`? */
type Cabe = (ms: number) => boolean;

function avisarSinCerrar(
  deps: DependenciasSeguimiento,
  envio: EnvioSeguimiento,
  ahora: Date,
): void {
  const dias = envio.enviado_en
    ? Math.floor((ahora.getTime() - Date.parse(envio.enviado_en)) / 86_400_000)
    : null;
  // `deps.operacion.registrar` solo viene inyectado en las pruebas: el registro por
  // defecto hacia Sentry lo resuelve `ejecutarOperacion` por dentro, no las dependencias.
  const registrar = deps.operacion.registrar ?? registrarEnSentry;
  try {
    registrar({
      tipo: 'evento',
      nivel: 'warning',
      mensaje: `Envío sin estado final después de ${DIAS_SIN_CERRAR} días`,
      etiquetas: {
        organizacion: envio.organizacion_id,
        empresa: envio.empresa_id,
        ambiente: envio.ambiente,
        operacion_sii: 'seguimiento',
        resultado: 'envio_sin_cerrar',
      },
      contexto: {
        envio_id: envio.id,
        dias,
        estado_sii: envio.estado_sii,
        consultas: envio.consultas,
      },
    });
  } catch {
    // Sentry nunca corta el seguimiento.
  }
}

async function procesarGrupo(
  deps: DependenciasSeguimiento,
  cliente: ClienteServicio,
  grupo: Grupo,
  cabe: Cabe,
  avisar: (envio: EnvioSeguimiento, ahora: Date) => void,
): Promise<{ omitido: boolean; parcial: Parcial }> {
  const parcial: Parcial = {
    consultados: 0,
    cambiados: 0,
    errores: 0,
    postergados: 0,
    sinCerrar: 0,
  };
  let conToken = false;

  const r = await ejecutarOperacion(
    {
      cliente,
      organizacionId: grupo.organizacionId,
      empresaId: grupo.empresaId,
      usuarioId: null,
      operacion: 'seguimiento',
      ambiente: grupo.ambiente,
      canal: grupo.canal,
      confirmada: true,
      dependencias: deps.operacion,
    },
    async ({ agregarDetalle }) => {
      // Credenciales dentro de la operación: si fallan, queda la fila (`config`).
      const rut = await rutDeEmpresa(cliente, grupo.organizacionId, grupo.empresaId);
      const { certificado } = await deps.credenciales(cliente).certificadoDeEmpresa({
        organizacionId: grupo.organizacionId,
        empresaId: grupo.empresaId,
      });
      await using transporte = deps.transporte();
      const sii = clienteEstado(deps, grupo.canal, certificado, {
        ambiente: grupo.ambiente,
        transporte,
        tokenStore: deps.tokenStore(cliente),
        rutEmpresa: rut,
      });
      // Si preparar tardó más de la cuenta, no se pide un token que no alcanzaría a usarse.
      if (!cabe(2 * MS_PETICION + MS_CONSULTA)) {
        parcial.postergados = grupo.envios.length;
        agregarDetalle({ envios: grupo.envios.length, ...parcial });
        return;
      }
      const token = { token: await sii.obtenerToken(), renovado: false, sinTiempo: false };
      conToken = true;

      let ultimoError: unknown;
      for (const [i, envio] of grupo.envios.entries()) {
        if (!cabe(MS_CONSULTA)) {
          parcial.postergados += grupo.envios.length - i;
          break;
        }
        const ahora = deps.reloj.ahora();
        const secretos = () => [token.token];
        if (sinCerrar(envio, ahora)) {
          parcial.sinCerrar++;
          avisar(envio, ahora);
        }
        try {
          const respuesta = await consultarConRenovacion(sii, token, envio.track_id ?? '', () =>
            cabe(MS_RENOVAR),
          );
          const guardado = await guardarRespuesta(cliente, envio, respuesta, ahora, secretos());
          if (guardado.tipo === 'sin_detalle') {
            parcial.errores++;
            continue;
          }
          parcial.consultados++;
          if (guardado.tipo === 'guardado' && guardado.cambio) parcial.cambiados++;
        } catch (error) {
          ultimoError = error;
          parcial.errores++;
          await registrarFalla(cliente, envio, error, ahora, secretos());
          // El SII rechaza el token y ya se renovó (o no queda tiempo para renovarlo): el
          // resto fallaría igual.
          if (tokenRechazado(error) && (token.renovado || token.sinTiempo)) {
            parcial.postergados += grupo.envios.length - i - 1;
            break;
          }
        }
      }

      agregarDetalle({ envios: grupo.envios.length, ...parcial });
      // Si ninguna respondió, la operación queda con el resultado de la última falla
      // (`transporte` → aviso con el host del SII en Sentry). Las filas ya están.
      if (parcial.consultados === 0 && ultimoError !== undefined) throw ultimoError;
    },
  );

  // Sin token (o sin fila en operaciones_sii, o sin certificado) no se consultó nada.
  return { omitido: !r.ok && !conToken, parcial };
}

/**
 * Una corrida del seguimiento. Lanza `ErrorSeguimiento` solo si no puede leer los envíos;
 * cualquier otra falla queda en el resumen y en `operaciones_sii` / `consultas_envio`.
 */
export async function ejecutarSeguimiento(
  dependencias?: Partial<DependenciasSeguimiento>,
  opciones: OpcionesSeguimiento = {},
): Promise<ResumenSeguimiento> {
  const deps = resolverDependenciasSeguimiento(dependencias);
  const tope = opciones.tope ?? TOPE_ENVIOS;
  const limite = opciones.limiteMs ?? LIMITE_MS;
  const cliente = deps.servicio();
  const inicio = deps.reloj.ahora().getTime();
  const cabe: Cabe = (ms) => deps.reloj.ahora().getTime() + ms <= inicio + limite;

  await cerrarAbandonadas(cliente, deps.reloj.ahora());
  const elegidos = await leerPorConsultar(cliente, deps.reloj.ahora(), tope);

  const resumen: ResumenSeguimiento = {
    envios: elegidos.length,
    consultados: 0,
    cambiados: 0,
    errores: 0,
    gruposOmitidos: 0,
    postergados: 0,
  };
  const avisar = (envio: EnvioSeguimiento, ahora: Date) => avisarSinCerrar(deps, envio, ahora);

  for (const grupo of agrupar(elegidos)) {
    if (!cabe(MS_EMPEZAR_GRUPO)) {
      resumen.postergados = (resumen.postergados ?? 0) + grupo.envios.length;
      continue;
    }
    const { omitido, parcial } = await procesarGrupo(deps, cliente, grupo, cabe, avisar);
    if (omitido) {
      resumen.gruposOmitidos++;
      continue;
    }
    resumen.consultados += parcial.consultados;
    resumen.cambiados += parcial.cambiados;
    resumen.errores += parcial.errores;
    resumen.postergados = (resumen.postergados ?? 0) + parcial.postergados;
  }
  return resumen;
}
