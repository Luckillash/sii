import 'server-only';
import type { SesionSii } from '@winex/certificacion';
import type { EtapaCertificacion, ResultadoPaso, ResumenEnsayo } from '@/lib/certificacion';
import { indiceEtapa } from '@/lib/certificacion';
import { conBloqueoCertificado } from '../sii/bloqueos';
import type { CredencialesCertificado } from '../sii/credenciales';
import { ErrorUso, type MensajeError, mensajeParaUsuario, resultadoDeError } from '../sii/errores';
import {
  type ContextoOperacion,
  ejecutarOperacion,
  type HerramientasOperacion,
  type ResultadoEjecucion,
} from '../sii/operacion';
import { claveSesion, conSesionReutilizada } from '../sii/sesiones';
import type { ClienteServicio } from '../supabase/service';
import type { Tables, TablesUpdate } from '../supabase/tipos';
import type { DependenciasCertificacion } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// Piezas comunes de las acciones del asistente (PLAN-SAAS Fase 5).
//
// Reglas que se repiten en todos los módulos:
//   - Ensayo (`confirmada: false`) = se valida todo (datos, empresa, certificado, CAF,
//     resolución) y se devuelve el resumen SIN salir al SII y SIN filas en
//     `operaciones_sii` (como la CLI sin `--confirmar`).
//   - Confirmada: se valida lo mismo antes de abrir la operación (un dato que falta no
//     deja una fila) y otra vez dentro de `ejecutarOperacion`, que es quien audita.
//   - Lo que cambia `etapa` / estado SII de `procesos_certificacion` se escribe con
//     service_role (lo exige `tg_proteger_proceso`), siempre filtrando por organización.
//   - Los errores de PostgREST se reportan solo con su código: el detalle podría traer
//     la fila (y en `cafs`/Vault, nada de eso puede salir).

export const AMBIENTE = 'certificacion' as const;
export const TIPO_BOLETA = 39;

export type FilaProcesoDb = Tables<'procesos_certificacion'>;
export type FilaEmpresaDb = Pick<
  Tables<'empresas'>,
  | 'id'
  | 'rut'
  | 'razon_social'
  | 'giro'
  | 'direccion'
  | 'comuna'
  | 'activa'
  | 'autorizada_produccion'
>;

// --- Solo ASCII imprimible (decisión del 2026-11-07, PLAN-MIGRACION §8) -------------

/**
 * Por qué se rechazan las tildes en lo que va a los asistentes HTML del SII (misma regla
 * y explicación que `comun-portal.ts` de la CLI): el asistente de postulación declara
 * `charset=iso-8859-1`; con tildes la confirmación del SII no calza con lo enviado y la
 * postulación se detiene sin grabar.
 */
export const EXPLICACION_ASCII =
  'Escríbelo sin tildes, ñ ni otros caracteres especiales (por ejemplo «Senal» en vez de «Señal»): el asistente del SII declara charset=iso-8859-1 y con tildes la confirmación no calza y la postulación no se graba.';

/** Primer carácter fuera de ASCII imprimible (0x20–0x7E), o `undefined`. */
export function primerNoAscii(valor: string): string | undefined {
  return /[^\x20-\x7E]/u.exec(valor)?.[0];
}

// --- Errores de base ------------------------------------------------------------------

/** Falla de Supabase: solo el código, nunca el detalle (podría traer la fila). */
export class ErrorBaseCertificacion extends Error {
  override name = 'ErrorBaseCertificacion';
}

export function fallaBase(paso: string, error: { code?: string } | null | undefined): Error {
  const codigo = error?.code ? ` (código ${error.code})` : '';
  return new ErrorBaseCertificacion(`No se pudo ${paso} en Supabase${codigo}.`);
}

// --- Lecturas comunes (service_role, filtradas por organización) ------------------------

export async function cargarEmpresa(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<FilaEmpresaDb> {
  const { data, error } = await cliente
    .from('empresas')
    .select('id, rut, razon_social, giro, direccion, comuna, activa, autorizada_produccion')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.empresaId)
    .maybeSingle();
  if (error) throw fallaBase('leer la empresa', error);
  if (!data) {
    throw new ErrorUso(
      'No encontramos la empresa en esta organización. Recarga la página y vuelve a intentarlo.',
    );
  }
  if (!data.activa) {
    throw new ErrorUso(
      'La empresa está desactivada. Actívala en Configuración → Empresas para continuar con la certificación.',
    );
  }
  return data;
}

export async function cargarProceso(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<FilaProcesoDb | null> {
  const { data, error } = await cliente
    .from('procesos_certificacion')
    .select('*')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (error) throw fallaBase('leer el proceso de certificación', error);
  return data;
}

export async function exigirProceso(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<FilaProcesoDb> {
  const proceso = await cargarProceso(cliente, ctx);
  if (!proceso) {
    throw new ErrorUso('Primero guarda los datos de la postulación en el paso 1.');
  }
  return proceso;
}

/** `etapa` está entre `desde` y `hasta` (en el orden del enum, ambos incluidos). */
export function etapaEntre(
  etapa: EtapaCertificacion,
  desde: EtapaCertificacion,
  hasta: EtapaCertificacion,
): boolean {
  const i = indiceEtapa(etapa);
  return i >= indiceEtapa(desde) && i <= indiceEtapa(hasta);
}

export interface CambioEtapa {
  anterior: EtapaCertificacion;
  nueva: EtapaCertificacion;
}

/**
 * Actualiza el proceso con service_role (el trigger `tg_proteger_proceso` lo exige para
 * la etapa y el estado SII) y devuelve la etapa antes y después: el trigger
 * `tg_certificacion_autorizada` puede moverla (P90 → por_declarar, P91 → autorizada).
 */
export async function actualizarProceso(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  proceso: Pick<FilaProcesoDb, 'id' | 'etapa'>,
  cambios: TablesUpdate<'procesos_certificacion'>,
): Promise<CambioEtapa> {
  const { data, error } = await cliente
    .from('procesos_certificacion')
    .update(cambios)
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', proceso.id)
    .select('etapa')
    .maybeSingle();
  if (error) throw fallaBase('actualizar el proceso de certificación', error);
  if (!data) throw fallaBase('actualizar el proceso de certificación', null);
  return { anterior: proceso.etapa, nueva: data.etapa };
}

/** Enlaza la fila de `operaciones_sii` con la solicitud o el envío que se creó adentro. */
export async function enlazarOperacion(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  operacionId: string,
  enlace: { solicitud_id?: string; envio_id?: string; documento_id?: string },
): Promise<void> {
  const { error } = await cliente
    .from('operaciones_sii')
    .update(enlace)
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', operacionId);
  // Solo informativo: la operación sigue aunque no quede enlazada.
  if (error) console.warn(`certificacion: no se pudo enlazar la operación (código ${error.code})`);
}

/** Titular y vigencia del certificado para el resumen del ensayo (sin secretos). */
export async function resumenCertificado(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: CredencialesCertificado,
): Promise<ResumenEnsayo['certificado']> {
  const { data } = await cliente
    .from('certificados')
    .select('nombre_titular, cn')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', credenciales.certificadoId)
    .maybeSingle();
  return {
    titular: data?.nombre_titular ?? data?.cn ?? credenciales.rutTitular,
    rut: credenciales.rutTitular,
    vigenteHasta: credenciales.vigenteHasta.toISOString(),
  };
}

// --- Ejecución ------------------------------------------------------------------------

export interface OpcionesEjecucion {
  operacion: ContextoOperacion['operacion'];
  confirmada: boolean;
  canal?: ContextoOperacion['canal'];
  envioId?: string | null;
}

/** `ejecutarOperacion` en certificación, con la empresa y el usuario del contexto. */
export function ejecutar<T>(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  opciones: OpcionesEjecucion,
  fn: (herramientas: HerramientasOperacion) => Promise<T>,
): Promise<ResultadoEjecucion<T>> {
  return ejecutarOperacion(
    {
      cliente,
      organizacionId: ctx.organizacionId,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      operacion: opciones.operacion,
      ambiente: AMBIENTE,
      canal: opciones.canal ?? null,
      confirmada: opciones.confirmada,
      envioId: opciones.envioId ?? null,
      dependencias: deps.operacion,
    },
    fn,
  );
}

/**
 * Sesión AUT2000 reutilizada del certificado, dentro de su bloqueo (dos peticiones no
 * abren sesiones en paralelo con el mismo certificado). `autenticar` es el login de la
 * librería (`PostulacionSii.autenticar` o `SolicitudFolios.autenticar`: el mismo login
 * con la vuelta a maullin; la sesión sirve para maullin y www4).
 */
export function conSesionSii<T>(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  credenciales: CredencialesCertificado,
  autenticar: () => Promise<SesionSii>,
  usar: (sesion: SesionSii) => Promise<T>,
): Promise<T> {
  return conBloqueoCertificado(
    cliente,
    { certificadoId: credenciales.certificadoId, ambiente: AMBIENTE },
    () =>
      conSesionReutilizada({
        sesiones: deps.sesionesSii(cliente),
        clave: claveSesion(credenciales, AMBIENTE),
        autenticar,
        usar,
      }),
    deps.bloqueo,
  );
}

/** Agrega una indicación al mensaje de un error (conserva su clase), como la CLI. */
export function conIndicacion<E extends Error>(error: E, indicacion: string): E {
  error.message = `${error.message.trim()} ${indicacion}`;
  return error;
}

// --- Traducción a ResultadoPaso ---------------------------------------------------------

/**
 * Un error al preparar (validar) sin haber abierto una operación: no se llamó al SII ni
 * se registró nada. Los errores de la app y de la librería traen un mensaje seguro; uno
 * desconocido queda como el genérico (sin detalles técnicos).
 */
export function errorSinEjecutar(error: unknown): ResultadoPaso {
  const resultado = resultadoDeError(error);
  if (resultado === 'error') {
    console.error('certificacion: falló la validación previa', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
  return {
    tipo: 'error',
    mensaje: mensajeParaUsuario(resultado === 'ok' ? 'error' : resultado, error),
    motivo: resultado,
    operacionId: null,
  };
}

/** El ensayo: valida (con `preparar`) y devuelve el resumen, o el error de validación. */
export async function ensayar(armar: () => Promise<ResumenEnsayo>): Promise<ResultadoPaso> {
  try {
    return { tipo: 'ensayo', resumen: await armar() };
  } catch (error) {
    return errorSinEjecutar(error);
  }
}

/** Validación previa a una operación confirmada: `null` si pasó, o el error. */
export async function validarAntes<T>(
  preparar: () => Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; resultado: ResultadoPaso }> {
  try {
    return { ok: true, valor: await preparar() };
  } catch (error) {
    return { ok: false, resultado: errorSinEjecutar(error) };
  }
}

/** Traduce el resultado de `ejecutarOperacion` (lo que no es `ok`) a `ResultadoPaso`. */
export function errorDeEjecucion(
  r: Exclude<ResultadoEjecucion<unknown>, { ok: true }>,
  extra: Partial<Extract<ResultadoPaso, { tipo: 'error' }>> = {},
): ResultadoPaso {
  if (r.ejecutada) {
    return {
      tipo: 'error',
      mensaje: r.mensaje,
      resultado: r.resultado,
      operacionId: r.operacionId,
      ...extra,
    };
  }
  return {
    tipo: 'error',
    mensaje: r.mensaje,
    motivo: r.motivo,
    operacionId: r.operacionId,
    ...(r.operacionPendienteId ? { operacionPendienteId: r.operacionPendienteId } : {}),
    ...extra,
  };
}

export function ok(
  mensaje: MensajeError,
  operacionId: string | null,
  avisos: readonly string[] = [],
): ResultadoPaso {
  return {
    tipo: 'ok',
    mensaje: { ...mensaje },
    operacionId,
    ...(avisos.length > 0 ? { avisos: [...avisos] } : {}),
  };
}
