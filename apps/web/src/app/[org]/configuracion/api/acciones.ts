'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ALCANCES_OFRECIDOS } from '@/lib/api-publica';
import { puedeAdministrar } from '@/lib/permisos';
import { confirmarSesion } from '@/server/certificados/acceso';
import {
  DATOS_INVALIDOS,
  type ErrorBase,
  MENSAJE_GENERICO,
  type MensajeError,
  type OperacionIntegracion,
  SESION_VENCIDA,
  SIN_EFECTO,
  SIN_PERMISO,
  traducirErrorIntegracion,
} from '@/server/integraciones/errores';
import { expiracionDesde } from '@/server/integraciones/presentacion';
import { type ContextoOrganizacion, exigirMembresia } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';

// API keys de la organización (PLAN-SAAS Fase 11, punto 1). Solo propietarios y
// administradores, con la sesión confirmada contra Auth (`getUser()`) antes de crear o
// revocar (PLAN-SAAS Fase 13, punto 1). Todo con la sesión del usuario: `crear_api_key`
// exige `es_admin` y el plan con API; `api_keys` deja editar `revocada_en` por RLS.
//
// La clave existe solo en esta respuesta: se devuelve UNA vez al administrador. Nunca a
// logs, a Sentry ni a la base (allá queda su sha256).

export type CampoClave = 'nombre' | 'ambiente' | 'empresa' | 'alcances' | 'expiracion';

export interface ValoresClave {
  nombre: string;
  ambiente: string;
  empresa: string;
  alcances: string[];
  expiracion: string;
}

export type ResultadoCrearClave =
  | { ok: true; clave: string; nombre: string }
  | {
      ok: false;
      error: MensajeError;
      errores?: Partial<Record<CampoClave, string>>;
      valores?: ValoresClave;
    };

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };

const esquemaId = z.uuid();

const esquemaClave = z.object({
  nombre: z.string().trim().min(1).max(80),
  ambiente: z.enum(['certificacion', 'produccion']),
  empresa: z.union([z.literal(''), z.uuid()]),
  alcances: z.array(z.enum(ALCANCES_OFRECIDOS)).min(1),
  // = valores de PLAZOS_EXPIRACION
  expiracion: z.enum(['', '30', '90', '365']),
});

function rutaApi(slug: string): string {
  return `/${slug}/configuracion/api`;
}

function fallo(
  error: ErrorBase,
  operacion: OperacionIntegracion,
): { ok: false; error: MensajeError } {
  const traducido = traducirErrorIntegracion(error, operacion);
  if (traducido === MENSAJE_GENERICO) {
    // Solo código y mensaje de Postgres: nunca la clave.
    console.error(`API: ${operacion} falló`, { codigo: error.code, mensaje: error.message });
  }
  return { ok: false, error: traducido };
}

/** Membresía de administrador y sesión viva en Auth; si no, el error para la UI. */
async function contextoAdmin(
  slug: string,
): Promise<{ ok: true; ctx: ContextoOrganizacion } | { ok: false; error: MensajeError }> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!(await confirmarSesion(ctx.usuario.id))) return { ok: false, error: SESION_VENCIDA };
  return { ok: true, ctx };
}

function leerValores(formulario: FormData): ValoresClave {
  const texto = (campo: string, largo: number) => {
    const valor = formulario.get(campo);
    return typeof valor === 'string' ? valor.slice(0, largo) : '';
  };
  return {
    nombre: texto('nombre', 200),
    ambiente: texto('ambiente', 20),
    empresa: texto('empresa', 64),
    alcances: formulario
      .getAll('alcances')
      .filter((v): v is string => typeof v === 'string')
      .slice(0, 10),
    expiracion: texto('expiracion', 8),
  };
}

const MENSAJES_CAMPO: Record<CampoClave, string> = {
  nombre: 'Escribe un nombre de hasta 80 caracteres, por ejemplo «ERP de la tienda».',
  ambiente: 'Elige un ambiente.',
  empresa: 'Elige una empresa de la lista.',
  alcances: 'Marca al menos un permiso.',
  expiracion: 'Elige un plazo.',
};

/** Crea la clave con `crear_api_key` y la devuelve UNA vez. */
export async function crearClaveApi(
  slug: string,
  _anterior: ResultadoCrearClave | null,
  formulario: FormData,
): Promise<ResultadoCrearClave> {
  const valores = leerValores(formulario);
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return { ok: false, error: previo.error, valores };
  const { ctx } = previo;

  const datos = esquemaClave.safeParse(valores);
  if (!datos.success) {
    const errores: Partial<Record<CampoClave, string>> = {};
    for (const issue of datos.error.issues) {
      const campo = issue.path[0];
      if (typeof campo === 'string' && campo in MENSAJES_CAMPO) {
        errores[campo as CampoClave] = MENSAJES_CAMPO[campo as CampoClave];
      }
    }
    return {
      ok: false,
      error: { titulo: 'Revisa los datos de la API key', detalle: 'Corrige los campos marcados.' },
      errores,
      valores,
    };
  }
  const { nombre, ambiente, empresa, alcances, expiracion } = datos.data;

  const supabase = await clienteServidor();
  const { data: clave, error } = await supabase.rpc('crear_api_key', {
    p_organizacion: ctx.organizacion.id,
    p_nombre: nombre,
    p_alcances: alcances,
    p_ambiente: ambiente,
    ...(empresa ? { p_empresa: empresa } : {}),
    ...(expiracion ? { p_expira_en: expiracionDesde(expiracion) ?? undefined } : {}),
  });
  if (error || typeof clave !== 'string') {
    const r = fallo(error ?? {}, 'crear_clave');
    return { ...r, valores };
  }

  revalidatePath(rutaApi(slug));
  return { ok: true, clave, nombre };
}

/** Revoca la clave (`revocada_en`): deja de servir de inmediato y queda en la lista. */
export async function revocarClaveApi(slug: string, claveId: string): Promise<ResultadoAccion> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(claveId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('api_keys')
    .update({ revocada_en: new Date().toISOString() }, { count: 'exact' })
    .eq('organizacion_id', previo.ctx.organizacion.id)
    .eq('id', claveId)
    .is('revocada_en', null);
  if (error) return fallo(error, 'revocar_clave');
  if (!count) return { ok: false, error: SIN_EFECTO };

  revalidatePath(rutaApi(slug));
  return { ok: true, mensaje: 'Revocaste la API key. Las peticiones que la usen recibirán 401.' };
}
