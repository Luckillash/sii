import { z } from 'zod';
import {
  type EstadoPaso,
  type EtapaCertificacion,
  estadoPaso,
  type NumeroPaso,
  type OperacionSii,
  PASOS,
  pasoDeEtapa,
  type ResultadoOperacion,
} from '@/lib/certificacion';
import { correoSiiValido, formatearFechaHora, rutSii, rutValidoSii } from '@/lib/formatos';
import type { MensajeError } from '@/server/equipo-errores';

// Lógica pura del asistente de certificación (PLAN-SAAS Fase 5): qué acción ofrece cada
// paso, qué falta, cómo se nombran las operaciones y la validación de los formularios.
// Sin `server-only` ni React: la usan la página, los componentes cliente y las Server
// Actions, y se prueba con Vitest. La autoridad sigue siendo el backend (que vuelve a
// validar todo) y RLS.

// --- Acciones del asistente ---------------------------------------------------------

/** Acciones que salen al SII y piden ensayo + confirmación (⚠️). */
export type AccionSii =
  | 'postular'
  | 'descargarSet'
  | 'solicitarFolios'
  | 'enviarSet'
  | 'solicitarRevision'
  | 'declarar';

/** Consultas de solo lectura al SII (sin ensayo). */
export type ConsultaSii = 'consultarEstadoSet' | 'consultarEstadoDeclaracion';

/** Formularios que guardan datos en la app (no salen al SII). */
export type FormularioAsistente = 'guardarPostulacion' | 'guardarDeclaracion';

export type AccionAsistente = AccionSii | ConsultaSii | FormularioAsistente;

export const ACCIONES_SII: readonly AccionSii[] = [
  'postular',
  'descargarSet',
  'solicitarFolios',
  'enviarSet',
  'solicitarRevision',
  'declarar',
];

export function esAccionSii(valor: unknown): valor is AccionSii {
  return typeof valor === 'string' && (ACCIONES_SII as readonly string[]).includes(valor);
}

export interface AccionDisponible {
  accion: AccionAsistente;
  habilitada: boolean;
  /** Por qué está deshabilitada (se muestra junto al botón). */
  motivo?: string;
}

/** Envío del set, reducido a lo que decide las acciones. */
export interface EnvioResumen {
  trackId: string | null;
  estado: string;
  incierto: boolean;
}

/** Lo que la página sabe de la empresa y del proceso para decidir las acciones. */
export interface EntradaPlan {
  etapa: EtapaCertificacion;
  /** Propietario o administrador (`puedeAdministrar`). */
  admin: boolean;
  empresaActiva: boolean;
  autorizadaProduccion: boolean;
  /** La empresa tiene certificado predeterminado. */
  tieneCertificado: boolean;
  /** Hay una operación `en_curso` de la empresa en certificación. */
  operacionEnCurso: boolean;
  /** Hay una operación `incierto` sin marcar como revisada. */
  inciertaSinRevisar: boolean;
  postulacionCompleta: boolean;
  declaracionCompleta: boolean;
  /** Casos del set de pruebas descargado. */
  casos: number;
  /** Folios disponibles del CAF 39 de certificación activo (`null` = no hay CAF). */
  foliosDisponibles: number | null;
  envio: EnvioResumen | null;
}

export interface PlanPaso {
  numero: NumeroPaso;
  titulo: string;
  estado: EstadoPaso;
  /** Qué falta para completar el paso (solo el paso en curso). */
  falta: string | null;
  /** Acciones del paso en curso; vacío para lector/emisor y para los otros pasos. */
  acciones: AccionDisponible[];
}

/** Folios que pide el set: uno por caso (la librería pide 5 por defecto). */
export function foliosNecesarios(casos: number): number {
  return casos > 0 ? casos : 5;
}

export function faltanFolios(e: Pick<EntradaPlan, 'casos' | 'foliosDisponibles'>): boolean {
  return (e.foliosDisponibles ?? 0) < foliosNecesarios(e.casos);
}

const ESTADOS_ENVIO_RECHAZADO = new Set(['rechazado', 'inconsistente']);
const ESTADOS_ENVIO_ACEPTADO = new Set(['aceptado', 'aceptado_con_reparos']);

/**
 * Motivo por el que ninguna acción que sale al SII se puede usar ahora, o `null`.
 * El orden importa: se muestra el primero que aplique.
 */
export function bloqueoSii(e: EntradaPlan): string | null {
  if (e.autorizadaProduccion || e.etapa === 'autorizada') {
    return 'La empresa ya está autorizada en producción.';
  }
  if (!e.empresaActiva) return 'La empresa está desactivada. Actívala en Configuración.';
  if (!e.tieneCertificado) {
    return 'La empresa no tiene certificado predeterminado. Elige uno en Configuración.';
  }
  if (e.operacionEnCurso) return 'Espera a que termine la operación en curso.';
  if (e.inciertaSinRevisar) {
    return 'Hay una operación por verificar. Revísala en el SII y márcala como revisada.';
  }
  return null;
}

function sii(accion: AccionSii | ConsultaSii, bloqueo: string | null, motivo?: string) {
  const razon = bloqueo ?? motivo;
  return razon ? { accion, habilitada: false, motivo: razon } : { accion, habilitada: true };
}

function faltaYAcciones(
  e: EntradaPlan,
  bloqueo: string | null,
): { falta: string | null; acciones: AccionDisponible[] } {
  const formulario = (accion: FormularioAsistente): AccionDisponible => ({
    accion,
    habilitada: !e.autorizadaProduccion,
  });
  switch (e.etapa) {
    case 'borrador':
      return {
        falta: e.postulacionCompleta
          ? 'Postula la empresa a boleta electrónica en el SII.'
          : 'Completa y guarda los datos de la postulación.',
        acciones: [
          formulario('guardarPostulacion'),
          sii(
            'postular',
            bloqueo,
            e.postulacionCompleta ? undefined : 'Guarda primero los datos de la postulación.',
          ),
        ],
      };
    case 'postulada':
      return {
        falta: 'Descarga el set de pruebas que el SII preparó para la empresa.',
        acciones: [sii('descargarSet', bloqueo)],
      };
    case 'set_descargado':
    case 'set_enviado': {
      const sinFolios = faltanFolios(e);
      const envio = e.envio;
      const conReparos = envio !== null && envio.estado === 'aceptado_con_reparos';
      // Con reparos el set no pasa a `set_aceptado` (el backend exige EPR limpio): hay que
      // corregir y reenviar, igual que con un rechazo.
      const rechazado = envio !== null && (ESTADOS_ENVIO_RECHAZADO.has(envio.estado) || conReparos);
      const enviado = e.etapa === 'set_enviado' && envio !== null && !rechazado && !envio.incierto;
      const acciones: AccionDisponible[] = [];
      if (!enviado && sinFolios) acciones.push(sii('solicitarFolios', bloqueo));
      if (!enviado) {
        acciones.push(
          sii(
            'enviarSet',
            bloqueo,
            sinFolios ? 'Primero solicita los folios de certificación.' : undefined,
          ),
        );
      }
      if (envio?.trackId) acciones.push(sii('consultarEstadoSet', bloqueo));

      let falta: string;
      if (envio?.incierto) {
        falta =
          'No sabemos si el set llegó al SII. Revisa el envío en el SII antes de volver a enviarlo.';
      } else if (conReparos) {
        falta =
          'El SII aceptó el set con reparos. Revisa los reparos, corrige y vuelve a enviarlo.';
      } else if (rechazado) {
        falta = 'El SII rechazó el set. Revisa los rechazos y vuelve a enviarlo.';
      } else if (enviado) {
        falta = ESTADOS_ENVIO_ACEPTADO.has(envio.estado)
          ? 'Consulta el estado una vez más para registrar la aceptación.'
          : 'Consulta el estado del envío hasta que el SII lo acepte.';
      } else if (sinFolios) {
        falta = `Solicita ${foliosNecesarios(e.casos)} folios de boleta electrónica (tipo 39) de certificación.`;
      } else {
        falta = 'Envía el set de pruebas al SII.';
      }
      return { falta, acciones };
    }
    case 'set_aceptado':
      return {
        falta: 'Solicita al SII que revise el set aceptado.',
        acciones: [sii('solicitarRevision', bloqueo)],
      };
    case 'revision_solicitada':
      return {
        falta:
          'El SII está revisando el set. Consulta el estado hasta que la empresa quede lista para declarar (P90).',
        acciones: [sii('consultarEstadoDeclaracion', bloqueo)],
      };
    case 'por_declarar':
      return {
        falta: e.declaracionCompleta
          ? 'Declara el cumplimiento de requisitos en el SII.'
          : 'Completa y guarda los datos de la declaración de cumplimiento.',
        acciones: [
          formulario('guardarDeclaracion'),
          sii(
            'declarar',
            bloqueo,
            e.declaracionCompleta ? undefined : 'Guarda primero los datos de la declaración.',
          ),
          sii('consultarEstadoDeclaracion', bloqueo),
        ],
      };
    case 'autorizada':
      return { falta: null, acciones: [] };
  }
}

/** Estado, qué falta y acciones de cada uno de los 5 pasos (H3). */
export function planAsistente(e: EntradaPlan): PlanPaso[] {
  const etapa: EtapaCertificacion = e.autorizadaProduccion ? 'autorizada' : e.etapa;
  const entrada = { ...e, etapa };
  const bloqueo = bloqueoSii(entrada);
  return PASOS.map((paso) => {
    const estado = estadoPaso(paso.numero, etapa);
    if (estado !== 'en_curso') {
      return { numero: paso.numero, titulo: paso.titulo, estado, falta: null, acciones: [] };
    }
    const { falta, acciones } = faltaYAcciones(entrada, bloqueo);
    return {
      numero: paso.numero,
      titulo: paso.titulo,
      estado,
      falta,
      acciones: e.admin ? acciones : [],
    };
  });
}

/** Pasos completos (para el medidor de la cabecera). */
export function pasosCompletos(etapa: EtapaCertificacion): number {
  if (etapa === 'autorizada') return PASOS.length;
  return pasoDeEtapa(etapa) - 1;
}

export function buscarAccion(plan: PlanPaso, accion: AccionAsistente): AccionDisponible | null {
  return plan.acciones.find((a) => a.accion === accion) ?? null;
}

// --- Operaciones del SII ---------------------------------------------------------------

const NOMBRE_OPERACION: Partial<Record<OperacionSii, string>> = {
  autenticar: 'Inicio de sesión en el SII',
  obtener_token: 'Token del SII',
  postular: 'Postulación',
  descargar_set: 'Descarga del set de pruebas',
  solicitar_folios: 'Solicitud de folios',
  enviar_set: 'Envío del set de pruebas',
  estado_envio: 'Estado del envío del set',
  solicitar_revision: 'Solicitud de revisión',
  verificar_portal: 'Verificación del portal del SII',
  estado_declaracion: 'Estado de la declaración',
  declarar: 'Declaración de cumplimiento',
};

const GERUNDIO_OPERACION: Partial<Record<OperacionSii, string>> = {
  autenticar: 'Iniciando sesión en el SII',
  obtener_token: 'Obteniendo un token del SII',
  postular: 'Postulando en el SII',
  descargar_set: 'Descargando el set de pruebas',
  solicitar_folios: 'Solicitando folios al SII',
  enviar_set: 'Enviando el set de pruebas al SII',
  estado_envio: 'Consultando el estado del envío',
  solicitar_revision: 'Solicitando la revisión al SII',
  verificar_portal: 'Verificando el portal del SII',
  estado_declaracion: 'Consultando el estado de la declaración',
  declarar: 'Declarando el cumplimiento en el SII',
};

export function nombreOperacion(operacion: OperacionSii): string {
  return NOMBRE_OPERACION[operacion] ?? 'Operación en el SII';
}

/** `14:32`, en hora de Chile y 24 h. */
export function horaChile(fecha: string | Date): string {
  return formatearFechaHora(fecha).split(' ')[1] ?? '';
}

/**
 * «Postulando en el SII desde las 14:32…». Si empezó otro día, con la fecha completa
 * («desde el 10-11-2026 14:32…»).
 */
export function textoEnCurso(
  operacion: OperacionSii,
  iniciadaEn: string,
  ahora: Date = new Date(),
): string {
  const gerundio = GERUNDIO_OPERACION[operacion] ?? 'Operando en el SII';
  const inicio = formatearFechaHora(iniciadaEn);
  const hoy = formatearFechaHora(ahora).split(' ')[0];
  const [dia, hora] = inicio.split(' ');
  return dia === hoy ? `${gerundio} desde las ${hora}…` : `${gerundio} desde el ${inicio}…`;
}

export type TonoResultado = 'exito' | 'info' | 'aviso' | 'error';

export interface PresentacionResultado {
  texto: string;
  tono: TonoResultado;
  glifo: 'aceptado' | 'enviado' | 'incierto' | 'reparos' | 'rechazado';
}

const RESULTADOS: Readonly<Record<ResultadoOperacion, PresentacionResultado>> = {
  ok: { texto: 'Completada', tono: 'exito', glifo: 'aceptado' },
  en_curso: { texto: 'En curso', tono: 'info', glifo: 'enviado' },
  // D3: mismo texto y tono que el estado `incierto` de un documento.
  incierto: { texto: 'Por verificar', tono: 'aviso', glifo: 'incierto' },
  transporte: { texto: 'Sin conexión con el SII', tono: 'aviso', glifo: 'reparos' },
  rechazo_sii: { texto: 'Rechazada por el SII', tono: 'error', glifo: 'rechazado' },
  verificacion_fallida: { texto: 'Verificación fallida', tono: 'error', glifo: 'rechazado' },
  uso: { texto: 'Datos inválidos', tono: 'error', glifo: 'rechazado' },
  config: { texto: 'Configuración incompleta', tono: 'error', glifo: 'rechazado' },
  error: { texto: 'Error', tono: 'error', glifo: 'rechazado' },
};

export function presentarResultado(resultado: ResultadoOperacion): PresentacionResultado {
  return RESULTADOS[resultado] ?? RESULTADOS.error;
}

/** Estado (clasificación) del envío del set, en palabras del design system. */
export function presentarEstadoEnvio(estado: string): { texto: string; tono: TonoResultado } {
  switch (estado) {
    case 'aceptado':
      return { texto: 'Aceptado', tono: 'exito' };
    case 'aceptado_con_reparos':
      return { texto: 'Aceptado con reparos', tono: 'aviso' };
    case 'rechazado':
      return { texto: 'Rechazado', tono: 'error' };
    case 'inconsistente':
      return { texto: 'Inconsistente', tono: 'error' };
    case 'incierto':
      return { texto: 'Por verificar', tono: 'aviso' };
    case 'en_proceso':
      return { texto: 'En proceso en el SII', tono: 'info' };
    default:
      return { texto: 'Enviado, sin respuesta del SII', tono: 'info' };
  }
}

// --- Mensajes de las Server Actions ---------------------------------------------------

export const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para certificar empresas',
  detalle: 'Solo un propietario o un administrador puede avanzar la certificación ante el SII.',
};

export const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Revisa los datos',
  detalle: 'Hay campos con errores. Corrígelos y vuelve a intentarlo.',
};

export const EMPRESA_NO_ENCONTRADA: MensajeError = {
  titulo: 'No encontramos la empresa',
  detalle: 'Puede que la hayan quitado de la organización. Recarga la página y elige otra.',
};

// --- Formularios ------------------------------------------------------------------------

/** ASCII imprimible: lo único que acepta el asistente de postulación de maullin. */
const PATRON_ASCII = /^[\x20-\x7E]*$/;

export function esAsciiImprimible(texto: string): boolean {
  return PATRON_ASCII.test(texto);
}

const MENSAJE_ASCII = 'Sin tildes, ñ ni símbolos especiales: el SII solo acepta ASCII.';
const MENSAJE_CORREO =
  'El SII no acepta este correo: sin + ni símbolos ni tildes, un solo @ y hasta 50 caracteres.';
const MENSAJE_RUT = 'Revisa el RUT: el dígito verificador no corresponde.';

const texto = z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string());

const rut = texto
  .refine((v) => v !== '', 'Escribe el RUT.')
  .transform((v) => rutSii(v))
  .refine((v) => rutValidoSii(v), MENSAJE_RUT);

const correoSii = texto
  .refine((v) => v !== '', 'Escribe el correo.')
  .refine((v) => correoSiiValido(v), MENSAJE_CORREO);

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const esquemaPostulacion = z.object({
  rutAdministrador: rut,
  correoAdministrador: correoSii,
  correoContactoSii: correoSii,
  correoIntercambio: correoSii,
  nombreSoftware: texto
    .refine((v) => v !== '', 'Escribe el nombre del software.')
    .refine((v) => v.length <= 30, 'Hasta 30 caracteres.')
    .refine(esAsciiImprimible, MENSAJE_ASCII),
  boletaExenta: casilla,
  url: texto
    .refine((v) => v === '' || v.startsWith('www.'), 'Debe empezar con «www.».')
    .refine((v) => v.length <= 100, 'Hasta 100 caracteres.')
    .refine(esAsciiImprimible, MENSAJE_ASCII)
    .transform((v) => (v === '' ? undefined : v)),
});

export type DatosPostulacionValidos = z.infer<typeof esquemaPostulacion>;

export const esquemaDeclaracion = z.object({
  // Van por GWT-RPC (UTF-8): admiten tildes.
  linkConsulta: texto
    .refine((v) => v !== '', 'Escribe el link de consulta de boletas.')
    .refine((v) => v.length <= 100, 'Hasta 100 caracteres.'),
  rutProveedor: rut,
  nombreProveedor: texto
    .refine((v) => v !== '', 'Escribe el nombre del proveedor de software.')
    .refine((v) => v.length <= 30, 'Hasta 30 caracteres.'),
  correoProveedor: correoSii,
});

export type DatosDeclaracionValidos = z.infer<typeof esquemaDeclaracion>;

export const esquemaCorreoProveedorSet = z
  .string()
  .trim()
  .refine((v) => v === '' || correoSiiValido(v), MENSAJE_CORREO)
  .transform((v) => (v === '' ? undefined : v));

export const esquemaFolioInicial = z
  .number()
  .int('El folio inicial es un número entero.')
  .positive('El folio inicial es mayor que cero.')
  .max(999_999_999, 'Revisa el folio inicial.');

export type Validacion<T> = { ok: true; datos: T } | { ok: false; errores: Record<string, string> };

function validar<T>(esquema: z.ZodType<T>, entrada: Record<string, unknown>): Validacion<T> {
  const r = esquema.safeParse(entrada);
  if (r.success) return { ok: true, datos: r.data };
  const errores: Record<string, string> = {};
  for (const problema of r.error.issues) {
    const campo = String(problema.path[0] ?? 'formulario');
    errores[campo] ??= problema.message;
  }
  return { ok: false, errores };
}

export function validarPostulacion(
  entrada: Record<string, unknown>,
): Validacion<DatosPostulacionValidos> {
  return validar(esquemaPostulacion, entrada);
}

export function validarDeclaracion(
  entrada: Record<string, unknown>,
): Validacion<DatosDeclaracionValidos> {
  return validar(esquemaDeclaracion, entrada);
}

/** Campos de texto de un `FormData` como objeto (los archivos se ignoran). */
export function camposDe(formulario: FormData): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const [clave, valor] of formulario.entries()) {
    if (typeof valor === 'string') campos[clave] = valor;
  }
  return campos;
}

// --- Datos del proceso ------------------------------------------------------------------

export interface DatosPostulacionGuardados {
  rutAdministrador?: string | null;
  correoAdministrador?: string | null;
  correoContactoSii?: string | null;
  correoIntercambio?: string | null;
  nombreSoftware?: string | null;
}

/** ¿Están guardados todos los datos obligatorios de la postulación? */
export function postulacionCompleta(p: DatosPostulacionGuardados | null): boolean {
  if (!p) return false;
  return [
    p.rutAdministrador,
    p.correoAdministrador,
    p.correoContactoSii,
    p.correoIntercambio,
    p.nombreSoftware,
  ].every((v) => typeof v === 'string' && v.trim() !== '');
}

export interface DatosDeclaracionGuardados {
  linkConsulta?: string | null;
  rutProveedor?: string | null;
  nombreProveedor?: string | null;
  correoProveedor?: string | null;
}

export function declaracionCompleta(p: DatosDeclaracionGuardados | null): boolean {
  if (!p) return false;
  return [p.linkConsulta, p.rutProveedor, p.nombreProveedor, p.correoProveedor].every(
    (v) => typeof v === 'string' && v.trim() !== '',
  );
}

// --- Operaciones por verificar ------------------------------------------------------------

/** Operaciones del asistente que graban algo en el SII (un `incierto` en ellas bloquea). */
const OPERACIONES_QUE_GRABAN: ReadonlySet<OperacionSii> = new Set([
  'postular',
  'descargar_set',
  'solicitar_folios',
  'enviar_set',
  'solicitar_revision',
  'declarar',
]);

export interface OperacionResumen {
  id: string;
  operacion: OperacionSii;
  resultado: ResultadoOperacion;
  iniciadaEn: string;
  revisada: boolean;
}

/** La más reciente primero. */
export function ordenarOperaciones<T extends OperacionResumen>(operaciones: readonly T[]): T[] {
  return [...operaciones].sort((a, b) => b.iniciadaEn.localeCompare(a.iniciadaEn));
}

/**
 * Una fila `en_curso` más antigua que esto quedó abandonada (la función murió a mitad de
 * camino) y cuenta como incierta. SINCRONIZADA con `MINUTOS_EN_CURSO_ABANDONADA` de
 * `server/sii/operacion.ts` (no se importa: ese módulo es `server-only`).
 */
export const MINUTOS_EN_CURSO_ABANDONADA = 15;

function abandonada(o: OperacionResumen, ahora: Date): boolean {
  return (
    o.resultado === 'en_curso' &&
    ahora.getTime() - new Date(o.iniciadaEn).getTime() > MINUTOS_EN_CURSO_ABANDONADA * 60_000
  );
}

/** La operación en curso más reciente (una abandonada no cuenta: es incierta). */
export function operacionEnCurso<T extends OperacionResumen>(
  operaciones: readonly T[],
  ahora: Date = new Date(),
): T | null {
  return (
    ordenarOperaciones(operaciones).find(
      (o) => o.resultado === 'en_curso' && !abandonada(o, ahora),
    ) ?? null
  );
}

/**
 * Operaciones inciertas sin revisar que bloquean repetir (principio 3), incluidas las
 * `en_curso` abandonadas de operaciones que graban: se marcan como revisadas igual que
 * una incierta (`marcarInciertaRevisada` las pasa a `incierto`).
 */
export function inciertasSinRevisar<T extends OperacionResumen>(
  operaciones: readonly T[],
  ahora: Date = new Date(),
): T[] {
  return ordenarOperaciones(operaciones).filter(
    (o) =>
      (o.resultado === 'incierto' || abandonada(o, ahora)) &&
      !o.revisada &&
      OPERACIONES_QUE_GRABAN.has(o.operacion),
  );
}

/** Qué revisar en el SII antes de marcar una operación incierta como revisada. */
export function comoRevisar(operacion: OperacionSii): string {
  switch (operacion) {
    case 'postular':
      return 'Entra a maullin.sii.cl con el certificado de la empresa y revisa si la postulación a boleta electrónica quedó grabada.';
    case 'solicitar_folios':
      return 'Revisa en el SII (ambiente de certificación) si se timbró un CAF nuevo de boleta electrónica para la empresa. Si se timbró, no vuelvas a pedirlo: anúlalo o úsalo.';
    case 'enviar_set':
      return 'Revisa en el SII si llegó un envío de boletas de la empresa en los últimos minutos. Si llegó, no lo vuelvas a enviar.';
    case 'declarar':
      return 'Consulta el estado de la declaración en el SII: si la empresa ya figura autorizada (P91), la declaración se grabó.';
    case 'solicitar_revision':
      return 'Consulta el estado de la declaración en el SII para saber si la revisión del set quedó solicitada.';
    case 'descargar_set':
      return 'Revisa en el SII si se generó un set de pruebas nuevo para la empresa.';
    default:
      return 'Revisa en el SII si la operación se completó antes de repetirla.';
  }
}

// --- Empresa a certificar -----------------------------------------------------------------

export interface EmpresaElegible {
  id: string;
  activa: boolean;
  autorizadaProduccion: boolean;
}

/**
 * Empresa que muestra el asistente: la pedida en `?empresa=` si es de la organización;
 * si no, la última abierta (`perfiles.ultima_empresa`); si no, la primera activa que aún
 * no está autorizada; si no, la primera.
 */
export function elegirEmpresa<T extends EmpresaElegible>(
  empresas: readonly T[],
  pedida?: string | null,
  ultima?: string | null,
): T | null {
  return (
    empresas.find((e) => e.id === pedida) ??
    empresas.find((e) => e.id === ultima) ??
    empresas.find((e) => e.activa && !e.autorizadaProduccion) ??
    empresas[0] ??
    null
  );
}

/** Días hasta una fecha (negativo si ya pasó). */
export function diasHasta(fecha: string, ahora: Date = new Date()): number {
  return Math.ceil((new Date(fecha).getTime() - ahora.getTime()) / 86_400_000);
}
