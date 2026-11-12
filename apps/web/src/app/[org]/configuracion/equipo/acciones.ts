'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  ETIQUETA_ROL,
  puedeAdministrar,
  puedeCambiarRol,
  puedeQuitarMiembro,
  ROLES,
  type RolMiembro,
  rolesInvitables,
} from '@/lib/permisos';
import { enviarInvitacion } from '@/server/correo/invitacion';
import { cupoUsuarios, listarMiembros, urlBaseApp } from '@/server/equipo';
import {
  MENSAJE_GENERICO,
  MENSAJE_SIN_EFECTO,
  type MensajeError,
  mensajeCupo,
  type OperacionEquipo,
  traducirErrorEquipo,
} from '@/server/equipo-errores';
import { type ContextoOrganizacion, exigirMembresia, obtenerPerfil } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';

// Mutaciones del equipo (PLAN-SAAS Fase 2, punto 4). La UI oculta lo que el rol no
// permite, pero la autoridad es la base: RLS de `miembros_organizacion` e
// `invitaciones`, `crear_invitacion()` (exige es_admin) y los triggers
// `tg_proteger_ultimo_propietario` y `exigir_cupo_usuarios`. Aquí se revisa el rol
// solo para responder antes y con un mensaje claro. Todo con la sesión del usuario:
// nada de service_role.
//
// El token de una invitación existe solo en esta petición: se usa para armar el enlace
// y, si no hay Resend, se devuelve UNA vez al administrador. Nunca a logs ni a Sentry.

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };

export type ResultadoInvitacion =
  | { ok: true; correo: string; enviado: true }
  | { ok: true; correo: string; enviado: false; enlace: string; aviso: MensajeError }
  | {
      ok: false;
      error: MensajeError;
      errores?: { correo?: string; rol?: string };
      valores?: { correo: string; rol: string };
    };

const esquemaRol = z.enum(ROLES);
const esquemaId = z.uuid();

const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para hacer esto',
  detalle: 'Tu rol en la organización no lo permite. Pide ayuda a un propietario o administrador.',
};

const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Los datos no son válidos',
  detalle: 'Recarga la página y vuelve a intentarlo.',
};

function rutaEquipo(slug: string): string {
  return `/${slug}/configuracion/equipo`;
}

function fallo(
  error: { code?: string | null; message?: string | null },
  operacion: OperacionEquipo,
): { ok: false; error: MensajeError } {
  const traducido = traducirErrorEquipo(error, operacion);
  if (traducido === MENSAJE_GENERICO) {
    // Solo código y mensaje de Postgres: nunca tokens ni datos de la invitación.
    console.error(`Equipo: ${operacion} falló`, { codigo: error.code, mensaje: error.message });
  }
  return { ok: false, error: traducido };
}

async function nombreDeQuienInvita(ctx: ContextoOrganizacion): Promise<string> {
  try {
    return (await obtenerPerfil())?.nombre?.trim() || ctx.usuario.correo;
  } catch {
    // Sin la migración 0003, obtenerPerfil() falla: basta con el correo.
    return ctx.usuario.correo;
  }
}

/**
 * Crea (o renueva) la invitación con `crear_invitacion()`, que borra la pendiente
 * anterior del mismo correo, y la envía por correo. Sin Resend, o si el envío falla,
 * devuelve el enlace para copiarlo.
 */
async function emitirInvitacion(
  ctx: ContextoOrganizacion,
  correo: string,
  rol: RolMiembro,
  operacion: 'invitar' | 'reenviar',
): Promise<ResultadoInvitacion> {
  const supabase = await clienteServidor();
  const { data: token, error } = await supabase.rpc('crear_invitacion', {
    p_organizacion: ctx.organizacion.id,
    p_correo: correo,
    p_rol: rol,
  });
  if (error || !token) return fallo(error ?? {}, operacion);

  // Vencimiento real (default de la tabla: 7 días); si no se puede leer, el mismo cálculo.
  const { data: fila } = await supabase
    .from('invitaciones')
    .select('expira_en')
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('correo', correo)
    .is('aceptada_en', null)
    .maybeSingle();
  const expiraEn = fila ? new Date(fila.expira_en) : new Date(Date.now() + 7 * 86_400_000);

  const { enlace, envio } = await enviarInvitacion({
    token,
    urlApp: await urlBaseApp(),
    correo,
    organizacion: ctx.organizacion.nombre,
    rol: ETIQUETA_ROL[rol],
    invitadoPor: await nombreDeQuienInvita(ctx),
    expiraEn,
  });

  revalidatePath(rutaEquipo(ctx.organizacion.slug));

  if (envio.ok) return { ok: true, correo, enviado: true };

  const copiar =
    'Copia este enlace y compártelo con la persona invitada por un canal privado. No se volverá a mostrar: si lo pierdes, reenvía la invitación.';
  if (envio.motivo === 'sin_configuracion') {
    return {
      ok: true,
      correo,
      enviado: false,
      enlace,
      aviso: {
        titulo: 'La invitación está lista, pero no se envió por correo',
        detalle: `El envío de correos aún no está configurado. ${copiar}`,
      },
    };
  }
  console.error('Equipo: no se pudo enviar la invitación por correo', {
    motivo: envio.motivo,
    detalle: envio.detalle,
    estado: envio.estado,
  });
  return {
    ok: true,
    correo,
    enviado: false,
    enlace,
    aviso: {
      titulo: 'La invitación está lista, pero el correo no salió',
      detalle: `El servicio de correo no respondió como esperábamos. ${copiar}`,
    },
  };
}

const esquemaInvitar = z.object({
  correo: z.string().trim().toLowerCase().pipe(z.email()),
  rol: esquemaRol,
});

export async function invitar(
  slug: string,
  _anterior: ResultadoInvitacion | null,
  formulario: FormData,
): Promise<ResultadoInvitacion> {
  const ctx = await exigirMembresia(slug);
  const valores = {
    correo: String(formulario.get('correo') ?? ''),
    rol: String(formulario.get('rol') ?? ''),
  };
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO, valores };

  const datos = esquemaInvitar.safeParse(valores);
  if (!datos.success) {
    const errores: { correo?: string; rol?: string } = {};
    for (const issue of datos.error.issues) {
      if (issue.path[0] === 'correo') {
        errores.correo = 'Escribe un correo válido, por ejemplo nombre@empresa.cl.';
      }
      if (issue.path[0] === 'rol') errores.rol = 'Elige un rol.';
    }
    return {
      ok: false,
      error: {
        titulo: 'Revisa los datos de la invitación',
        detalle: 'Corrige los campos marcados.',
      },
      errores,
      valores,
    };
  }
  const { correo, rol } = datos.data;

  if (!rolesInvitables(ctx.rol).includes(rol)) {
    return {
      ok: false,
      error: {
        titulo: `No puedes invitar como ${ETIQUETA_ROL[rol]}`,
        detalle:
          'Invita con otro rol y, si hace falta, un propietario puede cambiarlo después en la tabla de miembros.',
      },
      errores: { rol: 'Elige otro rol.' },
      valores,
    };
  }

  const miembros = await listarMiembros(ctx.organizacion.id);
  if (miembros.some((m) => m.correo?.toLowerCase() === correo)) {
    return {
      ok: false,
      error: {
        titulo: 'Esa persona ya es miembro de la organización',
        detalle: 'Si quieres cambiar su rol, hazlo en la tabla de miembros.',
      },
      errores: { correo: 'Ya es miembro.' },
      valores,
    };
  }

  // Aviso temprano del cupo: la base lo exige recién al aceptar (exigir_cupo_usuarios).
  const cupo = await cupoUsuarios(ctx.organizacion.id);
  if (cupo.maximo !== null && cupo.usados >= cupo.maximo) {
    return {
      ok: false,
      error: mensajeCupo(cupo.plan ?? 'vigente', cupo.maximo, 'invitar'),
      valores,
    };
  }

  const resultado = await emitirInvitacion(ctx, correo, rol, 'invitar');
  return resultado.ok ? resultado : { ...resultado, valores };
}

export async function reenviarInvitacion(
  slug: string,
  invitacionId: string,
): Promise<ResultadoInvitacion> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!esquemaId.safeParse(invitacionId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { data: invitacion, error } = await supabase
    .from('invitaciones')
    .select('correo, rol')
    .eq('id', invitacionId)
    .eq('organizacion_id', ctx.organizacion.id)
    .is('aceptada_en', null)
    .maybeSingle();
  if (error) return fallo(error, 'reenviar');
  if (!invitacion) return { ok: false, error: MENSAJE_SIN_EFECTO };

  return emitirInvitacion(ctx, invitacion.correo, invitacion.rol, 'reenviar');
}

export async function revocarInvitacion(
  slug: string,
  invitacionId: string,
): Promise<ResultadoAccion> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!esquemaId.safeParse(invitacionId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('invitaciones')
    .delete({ count: 'exact' })
    .eq('id', invitacionId)
    .eq('organizacion_id', ctx.organizacion.id);
  if (error) return fallo(error, 'revocar');
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO };

  revalidatePath(rutaEquipo(slug));
  return { ok: true, mensaje: 'Revocaste la invitación. El enlace ya no sirve.' };
}

async function rolActualDe(
  ctx: ContextoOrganizacion,
  usuarioId: string,
): Promise<RolMiembro | null> {
  const miembros = await listarMiembros(ctx.organizacion.id);
  return miembros.find((m) => m.usuarioId === usuarioId)?.rol ?? null;
}

export async function cambiarRol(
  slug: string,
  usuarioId: string,
  rolNuevo: string,
): Promise<ResultadoAccion> {
  const ctx = await exigirMembresia(slug);
  const id = esquemaId.safeParse(usuarioId);
  const rol = esquemaRol.safeParse(rolNuevo);
  if (!id.success || !rol.success) return { ok: false, error: DATOS_INVALIDOS };

  const rolActual = await rolActualDe(ctx, id.data);
  if (!rolActual) return { ok: false, error: MENSAJE_SIN_EFECTO };
  if (rolActual === rol.data) return { ok: true, mensaje: 'El rol ya era ese.' };
  if (!puedeCambiarRol(ctx.rol, rolActual, rol.data)) return { ok: false, error: SIN_PERMISO };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('miembros_organizacion')
    .update({ rol: rol.data }, { count: 'exact' })
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('usuario_id', id.data);
  if (error) return fallo(error, 'cambiar_rol');
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO };

  revalidatePath(`/${slug}`, 'layout');
  return { ok: true, mensaje: `El rol cambió a ${ETIQUETA_ROL[rol.data]}.` };
}

export async function quitarMiembro(slug: string, usuarioId: string): Promise<ResultadoAccion> {
  const ctx = await exigirMembresia(slug);
  const id = esquemaId.safeParse(usuarioId);
  if (!id.success) return { ok: false, error: DATOS_INVALIDOS };
  if (id.data === ctx.usuario.id) return salirDeOrganizacion(slug);

  const rolObjetivo = await rolActualDe(ctx, id.data);
  if (!rolObjetivo) return { ok: false, error: MENSAJE_SIN_EFECTO };
  if (!puedeQuitarMiembro(ctx.rol, rolObjetivo, false)) return { ok: false, error: SIN_PERMISO };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('miembros_organizacion')
    .delete({ count: 'exact' })
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('usuario_id', id.data);
  if (error) return fallo(error, 'quitar');
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO };

  revalidatePath(rutaEquipo(slug));
  return { ok: true, mensaje: 'La persona ya no es parte de la organización.' };
}

export async function salirDeOrganizacion(slug: string): Promise<ResultadoAccion> {
  const ctx = await exigirMembresia(slug);
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('miembros_organizacion')
    .delete({ count: 'exact' })
    .eq('organizacion_id', ctx.organizacion.id)
    .eq('usuario_id', ctx.usuario.id);
  if (error) return fallo(error, 'salir');
  if (!count) return { ok: false, error: MENSAJE_SIN_EFECTO };

  // /bienvenida elige otra organización (o propone crear una).
  revalidatePath('/', 'layout');
  redirect('/bienvenida');
}
