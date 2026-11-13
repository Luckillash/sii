import 'server-only';
import { DatosDeclaracion, DatosPostulacion, ErrorValidacion } from '@winex/certificacion';
import { z } from 'zod';
import type { ResultadoPaso } from '@/lib/certificacion';
import { correoSiiValido, rutSii, rutValidoSii } from '@/lib/formatos';
import type { MensajeError } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import type { TablesUpdate } from '../supabase/tipos';
import { EXPLICACION_ASCII, ok, primerNoAscii } from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type { ContextoCertificacion, DatosDeclaracionForm, DatosPostulacionForm } from './tipos';

// Datos de los formularios del asistente (PLAN-SAAS Fase 5). No salen al SII: se
// guardan en `procesos_certificacion` con el cliente de SESIÓN (RLS: solo
// administradores escriben; `tg_proteger_proceso` impide tocar la etapa o el estado SII
// desde aquí, y no se tocan). Se validan con zod campo por campo y, al final, con
// `DatosPostulacion` / `DatosDeclaracion` de la librería, que aplican las reglas del
// formulario del SII.
//
// Postulación: todo lo que va a maullin en ASCII imprimible (regla de la CLI). La
// declaración va por GWT-RPC en UTF-8: admite tildes (como dice la CLI).

const DATOS_INVALIDOS: MensajeError = Object.freeze({
  titulo: 'Revisa los datos del formulario',
  detalle: 'Hay campos con problemas. Corrígelos y vuelve a guardar.',
});

const SIN_PERMISO_O_EMPRESA: MensajeError = Object.freeze({
  titulo: 'No pudimos guardar los datos',
  detalle:
    'Puede que la empresa ya no exista o que tu rol no permita editar la certificación. Recarga la página.',
});

const MENSAJE_FALLA: MensajeError = Object.freeze({
  titulo: 'No pudimos guardar los datos',
  detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
});

const MENSAJE_ASCII = `Tiene caracteres que el SII no acepta aquí. ${EXPLICACION_ASCII}`;

function textoAscii(largoMaximo: number, nombre: string) {
  return z
    .string()
    .trim()
    .min(1, `Escribe ${nombre}.`)
    .max(largoMaximo, `Usa hasta ${largoMaximo} caracteres.`)
    .refine((v) => primerNoAscii(v) === undefined, MENSAJE_ASCII);
}

const rut = z
  .string()
  .transform((v) => rutSii(v))
  .refine((v) => rutValidoSii(v), 'Revisa el RUT: no es válido.');

const correoSii = z
  .string()
  .trim()
  .min(1, 'Escribe el correo.')
  .refine(
    (v) => correoSiiValido(v),
    'Revisa el correo: hasta 50 caracteres, sin espacios, sin + ni símbolos y con un solo @.',
  );

const esquemaPostulacion = z.object({
  rutAdministrador: rut,
  correoAdministrador: correoSii,
  correoContactoSii: correoSii,
  correoIntercambio: correoSii,
  nombreSoftware: textoAscii(30, 'el nombre del software'),
  boletaExenta: z.boolean(),
  url: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .refine((v) => v === undefined || primerNoAscii(v) === undefined, MENSAJE_ASCII)
    .refine(
      (v) => v === undefined || (v.startsWith('www.') && v.length <= 100),
      'La URL empieza con «www.» y tiene hasta 100 caracteres.',
    ),
});

const esquemaDeclaracion = z.object({
  linkConsulta: z
    .string()
    .trim()
    .min(1, 'Escribe el enlace de consulta de boletas.')
    .max(100, 'Usa hasta 100 caracteres.'),
  rutProveedor: rut,
  nombreProveedor: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre del proveedor de software.')
    .max(30, 'Usa hasta 30 caracteres.'),
  correoProveedor: correoSii,
});

function erroresDe(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? 'formulario');
    errores[campo] ??= issue.message;
  }
  return errores;
}

function falla(mensaje: MensajeError, errores?: Record<string, string>): ResultadoPaso {
  return {
    tipo: 'error',
    mensaje: { ...mensaje },
    operacionId: null,
    motivo: 'datos_invalidos',
    ...(errores ? { errores } : {}),
  };
}

/** RUT de la empresa (de la organización, por RLS). `null` si no se ve. */
async function rutEmpresa(
  supabase: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<string | null | 'error'> {
  const { data, error } = await supabase
    .from('empresas')
    .select('rut')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.empresaId)
    .maybeSingle();
  if (error) return error.code === '22P02' ? null : 'error';
  return data?.rut ?? null;
}

/** Inserta o actualiza el proceso con RLS (crea la fila la primera vez). */
async function guardarProceso(
  supabase: ClienteServicio,
  ctx: ContextoCertificacion,
  cambios: TablesUpdate<'procesos_certificacion'>,
): Promise<'ok' | 'sin_efecto' | 'error'> {
  const existente = await supabase
    .from('procesos_certificacion')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (existente.error) return 'error';
  if (existente.data) {
    const { data, error } = await supabase
      .from('procesos_certificacion')
      .update(cambios)
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', existente.data.id)
      .select('id');
    if (error) return error.code === '42501' ? 'sin_efecto' : 'error';
    return data.length > 0 ? 'ok' : 'sin_efecto';
  }
  // `organizacion_id` lo vuelve a fijar `trg_00_organizacion` desde la empresa.
  const { error } = await supabase
    .from('procesos_certificacion')
    .insert({ ...cambios, organizacion_id: ctx.organizacionId, empresa_id: ctx.empresaId });
  if (error) return error.code === '42501' ? 'sin_efecto' : 'error';
  return 'ok';
}

function resultadoGuardado(
  estado: 'ok' | 'sin_efecto' | 'error',
  exito: MensajeError,
): ResultadoPaso {
  if (estado === 'ok') return ok(exito, null);
  return falla(estado === 'sin_efecto' ? SIN_PERMISO_O_EMPRESA : MENSAJE_FALLA);
}

/** Guarda los datos de la postulación (crea el proceso si no existe). No sale al SII. */
export async function guardarDatosPostulacion(
  ctx: ContextoCertificacion,
  datos: DatosPostulacionForm,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const v = esquemaPostulacion.safeParse(datos);
  if (!v.success) return falla(DATOS_INVALIDOS, erroresDe(v.error));

  const deps = resolverDependencias(dependencias);
  const supabase = await deps.sesion();
  const rut = await rutEmpresa(supabase, ctx);
  if (rut === 'error') return falla(MENSAJE_FALLA);
  if (rut === null) return falla(SIN_PERMISO_O_EMPRESA);

  // Las reglas del formulario del SII, con la clase de la librería.
  try {
    new DatosPostulacion({
      rutEmpresa: rut,
      rutAdministrador: v.data.rutAdministrador,
      correoAdministrador: v.data.correoAdministrador,
      correoContactoSii: v.data.correoContactoSii,
      correoIntercambio: v.data.correoIntercambio,
      nombreSoftware: v.data.nombreSoftware,
      boletaExenta: v.data.boletaExenta,
      ...(v.data.url !== undefined ? { url: v.data.url } : {}),
    });
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      return falla({ titulo: DATOS_INVALIDOS.titulo, detalle: error.message });
    }
    throw error;
  }

  const estado = await guardarProceso(supabase, ctx, {
    rut_administrador: v.data.rutAdministrador,
    correo_administrador: v.data.correoAdministrador,
    correo_contacto_sii: v.data.correoContactoSii,
    correo_intercambio: v.data.correoIntercambio,
    nombre_software: v.data.nombreSoftware,
    boleta_exenta: v.data.boletaExenta,
    url: v.data.url ?? null,
  });
  return resultadoGuardado(estado, {
    titulo: 'Guardamos los datos de la postulación',
    detalle: 'Cuando quieras, postula la empresa a boleta electrónica en certificación.',
  });
}

/** Guarda los datos de la declaración de cumplimiento. No sale al SII. */
export async function guardarDatosDeclaracion(
  ctx: ContextoCertificacion,
  datos: DatosDeclaracionForm,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const v = esquemaDeclaracion.safeParse(datos);
  if (!v.success) return falla(DATOS_INVALIDOS, erroresDe(v.error));

  const deps = resolverDependencias(dependencias);
  const supabase = await deps.sesion();
  const rut = await rutEmpresa(supabase, ctx);
  if (rut === 'error') return falla(MENSAJE_FALLA);
  if (rut === null) return falla(SIN_PERMISO_O_EMPRESA);

  try {
    new DatosDeclaracion({ rutEmpresa: rut, ...v.data });
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      return falla({ titulo: DATOS_INVALIDOS.titulo, detalle: error.message });
    }
    throw error;
  }

  const existe = await supabase
    .from('procesos_certificacion')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (existe.error) return falla(MENSAJE_FALLA);
  if (!existe.data) {
    return falla({
      titulo: 'Primero guarda los datos de la postulación',
      detalle: 'La declaración es el último paso: completa antes la postulación en el paso 1.',
    });
  }

  const estado = await guardarProceso(supabase, ctx, {
    link_consulta: v.data.linkConsulta,
    rut_proveedor: v.data.rutProveedor,
    nombre_proveedor: v.data.nombreProveedor,
    correo_proveedor: v.data.correoProveedor,
  });
  return resultadoGuardado(estado, {
    titulo: 'Guardamos los datos de la declaración',
    detalle: 'Cuando la empresa esté lista para declarar (P90), podrás declarar el cumplimiento.',
  });
}
