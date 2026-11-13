'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formatearFecha } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { bloqueoPorPlan, cupoEmpresas, obtenerEmpresa } from '@/server/empresas';
import {
  type ErrorBase,
  MENSAJE_GENERICO,
  MENSAJE_SIN_EFECTO,
  type MensajeError,
  mensajeCupoEmpresas,
  type OperacionEmpresa,
  RUT_DUPLICADO,
  SIN_PERMISO,
  SIN_PLAN_VIGENTE,
  traducirErrorEmpresa,
} from '@/server/empresas-errores';
import { exigirMembresia } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';
import {
  CAMPOS_EMPRESA,
  type CampoEmpresa,
  type CampoResolucion,
  ETIQUETA_AMBIENTE,
  esquemaEdicionEmpresa,
  esquemaEmpresa,
  esquemaResolucion,
  leerCampos,
  type ValoresEmpresa,
  validarCampos,
} from './esquemas';

// Mutaciones de empresas y resoluciones (PLAN-SAAS Fase 3, puntos 1 y 4). La UI oculta
// lo que el rol no permite, pero la autoridad es la base: RLS de `empresas` y
// `resoluciones` (solo administradores escriben), `tg_limite_empresas` (plan),
// `tg_proteger_autorizacion` y `registrar_resolucion()`. Aquí se revisan el rol y el
// cupo solo para responder antes y con un mensaje claro. Todo con la sesión del
// usuario: nada de service_role.
//
// No hay «borrar empresa»: el borrado arrastra en cascada documentos, folios, envíos y
// resoluciones. En su lugar se desactiva.
//
// Logs: solo el código y el mensaje de Postgres, nunca los datos del formulario.

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };

export type ResultadoFormularioEmpresa =
  | { ok: true; mensaje: string }
  | {
      ok: false;
      error: MensajeError;
      errores?: Partial<Record<CampoEmpresa, string>>;
      valores?: ValoresEmpresa;
    };

export type ValoresResolucion = Record<CampoResolucion, string>;

export type ResultadoResolucion =
  | { ok: true; mensaje: string }
  | {
      ok: false;
      error: MensajeError;
      errores?: Partial<Record<CampoResolucion, string>>;
      valores?: ValoresResolucion;
    };

const esquemaId = z.guid();

const REVISA_CAMPOS: MensajeError = {
  titulo: 'Revisa los datos de la empresa',
  detalle: 'Corrige los campos marcados y vuelve a guardar.',
};

const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Los datos no son válidos',
  detalle: 'Recarga la página y vuelve a intentarlo.',
};

const EMPRESA_NO_ENCONTRADA: MensajeError = {
  titulo: 'No encontramos la empresa',
  detalle:
    'Puede que ya no exista o que tu rol no te deje verla. Recarga la página para ver el estado actual.',
};

function rutaEmpresas(slug: string): string {
  return `/${slug}/configuracion/empresas`;
}

function fallo(error: ErrorBase, operacion: OperacionEmpresa): MensajeError {
  const traducido = traducirErrorEmpresa(error, operacion);
  if (traducido === MENSAJE_GENERICO) {
    // Solo código y mensaje de Postgres: nunca los datos del formulario.
    console.error(`Empresas: ${operacion} falló`, { codigo: error.code, mensaje: error.message });
  }
  return traducido;
}

export async function crearEmpresa(
  slug: string,
  _anterior: ResultadoFormularioEmpresa | null,
  formulario: FormData,
): Promise<ResultadoFormularioEmpresa> {
  const ctx = await exigirMembresia(slug);
  const valores = leerCampos(formulario, CAMPOS_EMPRESA);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO, valores };

  const validacion = validarCampos<typeof esquemaEmpresa, CampoEmpresa>(esquemaEmpresa, valores);
  if (!validacion.ok) {
    return { ok: false, error: REVISA_CAMPOS, errores: validacion.errores, valores };
  }
  const datos = validacion.datos;

  // Aviso temprano del plan: la base lo exige igual (tg_limite_empresas).
  const cupo = await cupoEmpresas(ctx.organizacion.id);
  const bloqueo = bloqueoPorPlan(cupo);
  if (bloqueo === 'sin_plan') return { ok: false, error: SIN_PLAN_VIGENTE, valores };
  if (bloqueo === 'cupo_lleno' && cupo.maximo !== null) {
    return {
      ok: false,
      error: mensajeCupoEmpresas(cupo.plan ?? 'vigente', cupo.maximo),
      valores,
    };
  }

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('empresas')
    .insert({
      organizacion_id: ctx.organizacion.id,
      rut: datos.rut,
      razon_social: datos.razonSocial,
      giro: datos.giro,
      direccion: datos.direccion,
      comuna: datos.comuna,
      correo_intercambio: datos.correoIntercambio,
    })
    .select('id')
    .single();
  if (error || !data) {
    const mensaje = fallo(error ?? {}, 'crear');
    return mensaje === RUT_DUPLICADO
      ? {
          ok: false,
          error: mensaje,
          errores: { rut: 'Ya hay una empresa con este RUT en la organización.' },
          valores,
        }
      : { ok: false, error: mensaje, valores };
  }

  revalidatePath(rutaEmpresas(slug));
  // Fuera de cualquier try/catch: redirect() lanza.
  redirect(`${rutaEmpresas(slug)}/${data.id}?creada=1`);
}

export async function editarEmpresa(
  slug: string,
  empresaId: string,
  _anterior: ResultadoFormularioEmpresa | null,
  formulario: FormData,
): Promise<ResultadoFormularioEmpresa> {
  const ctx = await exigirMembresia(slug);
  const valores = leerCampos(formulario, CAMPOS_EMPRESA);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO, valores };
  const id = esquemaId.safeParse(empresaId);
  if (!id.success) return { ok: false, error: DATOS_INVALIDOS, valores };

  const validacion = validarCampos<typeof esquemaEdicionEmpresa, CampoEmpresa>(
    esquemaEdicionEmpresa,
    valores,
  );
  if (!validacion.ok) {
    return { ok: false, error: REVISA_CAMPOS, errores: validacion.errores, valores };
  }
  const datos = validacion.datos;

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('empresas')
    .update(
      {
        razon_social: datos.razonSocial,
        giro: datos.giro,
        direccion: datos.direccion,
        comuna: datos.comuna,
        correo_intercambio: datos.correoIntercambio,
      },
      { count: 'exact' },
    )
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('id', id.data);
  if (error) return { ok: false, error: fallo(error, 'editar'), valores };
  // RLS filtró la fila (no es admin) o ya no existe.
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO, valores };

  revalidatePath(rutaEmpresas(slug));
  revalidatePath(`${rutaEmpresas(slug)}/${id.data}`);
  return { ok: true, mensaje: 'Guardamos los datos de la empresa.' };
}

export async function cambiarEstadoEmpresa(
  slug: string,
  empresaId: string,
  activa: boolean,
): Promise<ResultadoAccion> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const id = esquemaId.safeParse(empresaId);
  const estado = z.boolean().safeParse(activa);
  if (!id.success || !estado.success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('empresas')
    .update({ activa: estado.data }, { count: 'exact' })
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('id', id.data);
  const operacion = estado.data ? 'activar' : 'desactivar';
  if (error) return { ok: false, error: fallo(error, operacion) };
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO };

  revalidatePath(rutaEmpresas(slug));
  revalidatePath(`${rutaEmpresas(slug)}/${id.data}`);
  return {
    ok: true,
    mensaje: estado.data
      ? 'Activaste la empresa. Ya se puede elegir para emitir.'
      : 'Desactivaste la empresa. Sus datos y documentos se conservan.',
  };
}

export async function registrarResolucion(
  slug: string,
  empresaId: string,
  _anterior: ResultadoResolucion | null,
  formulario: FormData,
): Promise<ResultadoResolucion> {
  const ctx = await exigirMembresia(slug);
  const valores = leerCampos(formulario, ['ambiente', 'numero', 'fecha'] as const);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO, valores };
  const id = esquemaId.safeParse(empresaId);
  if (!id.success) return { ok: false, error: DATOS_INVALIDOS, valores };

  const validacion = validarCampos<ReturnType<typeof esquemaResolucion>, CampoResolucion>(
    esquemaResolucion(),
    valores,
  );
  if (!validacion.ok) {
    return {
      ok: false,
      error: {
        titulo: 'Revisa los datos de la resolución',
        detalle: 'Corrige los campos marcados y vuelve a registrarla.',
      },
      errores: validacion.errores,
      valores,
    };
  }
  const { ambiente, numero, fecha } = validacion.datos;

  // La empresa tiene que ser de esta organización (RLS ya oculta las ajenas).
  const empresa = await obtenerEmpresa(ctx.organizacion.id, id.data);
  if (!empresa) return { ok: false, error: EMPRESA_NO_ENCONTRADA, valores };

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc('registrar_resolucion', {
    p_empresa: empresa.id,
    p_ambiente: ambiente,
    p_numero: numero,
    p_fecha: fecha,
  });
  if (error) return { ok: false, error: fallo(error, 'resolucion'), valores };

  revalidatePath(`${rutaEmpresas(slug)}/${empresa.id}`);
  const nombre =
    ambiente === 'produccion'
      ? `la resolución N° ${numero} del ${formatearFecha(fecha)}`
      : `la resolución del ${formatearFecha(fecha)}`;
  return {
    ok: true,
    mensaje: `Registraste ${nombre} para ${ETIQUETA_AMBIENTE[ambiente]}. Ahora es la vigente.`,
  };
}
