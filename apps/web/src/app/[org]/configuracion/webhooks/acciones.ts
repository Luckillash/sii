'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { EVENTOS_WEBHOOK, validarUrlWebhook } from '@/lib/api-publica';
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
import { type ContextoOrganizacion, exigirMembresia } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';

// Webhooks de la organización (PLAN-SAAS Fase 11, punto 4). Solo propietarios y
// administradores, con la sesión confirmada contra Auth (`getUser()`) antes de cada
// cambio (PLAN-SAAS Fase 13, punto 1). Todo con la sesión del usuario:
//   crear      `crear_webhook` (0001: es_admin y plan con webhooks; secreto a Vault)
//   editar     UPDATE de `url`, `eventos` y `activo` (RLS `edicion`; check
//              `webhooks_url_permitida` de la 0018)
//   borrar     DELETE (RLS `borrado`; `tg_borrar_secretos` borra el secreto de Vault)
//   probar     `probar_webhook`, rotar `rotar_secreto_webhook`, reenviar
//              `reenviar_entrega_webhook` (0018)
//
// El secreto existe solo en esta respuesta: se devuelve UNA vez. Nunca a logs ni a Sentry.

export type CampoWebhook = 'url' | 'eventos';

export interface ValoresWebhook {
  url: string;
  eventos: string[];
}

export type ResultadoFormularioWebhook =
  | { ok: true; mensaje: string; secreto?: string; webhookId?: string }
  | {
      ok: false;
      error: MensajeError;
      errores?: Partial<Record<CampoWebhook, string>>;
      valores?: ValoresWebhook;
    };

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };
export type ResultadoRotar = { ok: true; secreto: string } | { ok: false; error: MensajeError };

const esquemaId = z.uuid();
const esquemaEntrega = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const esquemaEventos = z.array(z.enum(EVENTOS_WEBHOOK)).min(1);

const MENSAJE_EVENTOS = 'Marca al menos un evento.';

function rutaWebhooks(slug: string): string {
  return `/${slug}/configuracion/webhooks`;
}

function revalidar(slug: string, webhookId?: string) {
  revalidatePath(rutaWebhooks(slug));
  if (webhookId) revalidatePath(`${rutaWebhooks(slug)}/${webhookId}`);
}

function fallo(
  error: ErrorBase,
  operacion: OperacionIntegracion,
): { ok: false; error: MensajeError } {
  const traducido = traducirErrorIntegracion(error, operacion);
  if (traducido === MENSAJE_GENERICO) {
    // Solo código y mensaje de Postgres: nunca el secreto.
    console.error(`Webhooks: ${operacion} falló`, { codigo: error.code, mensaje: error.message });
  }
  return { ok: false, error: traducido };
}

async function contextoAdmin(
  slug: string,
): Promise<{ ok: true; ctx: ContextoOrganizacion } | { ok: false; error: MensajeError }> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!(await confirmarSesion(ctx.usuario.id))) return { ok: false, error: SESION_VENCIDA };
  return { ok: true, ctx };
}

function leerValores(formulario: FormData): ValoresWebhook {
  const url = formulario.get('url');
  return {
    url: typeof url === 'string' ? url.slice(0, 4096) : '',
    eventos: formulario
      .getAll('eventos')
      .filter((v): v is string => typeof v === 'string')
      .slice(0, 20),
  };
}

/** Valida URL y eventos; devuelve los datos limpios o el resultado de error para el formulario. */
function validar(
  valores: ValoresWebhook,
):
  | { ok: true; url: string; eventos: (typeof EVENTOS_WEBHOOK)[number][] }
  | Extract<ResultadoFormularioWebhook, { ok: false }> {
  const errores: Partial<Record<CampoWebhook, string>> = {};
  const url = validarUrlWebhook(valores.url);
  if (!url.ok) errores.url = url.mensaje;
  const eventos = esquemaEventos.safeParse([...new Set(valores.eventos)]);
  if (!eventos.success) errores.eventos = MENSAJE_EVENTOS;
  if (!url.ok || !eventos.success) {
    return {
      ok: false,
      error: { titulo: 'Revisa los datos del webhook', detalle: 'Corrige los campos marcados.' },
      errores,
      valores,
    };
  }
  return { ok: true, url: url.url, eventos: eventos.data };
}

/** Crea el webhook con `crear_webhook` y devuelve el secreto UNA vez. */
export async function crearWebhook(
  slug: string,
  _anterior: ResultadoFormularioWebhook | null,
  formulario: FormData,
): Promise<ResultadoFormularioWebhook> {
  const valores = leerValores(formulario);
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return { ok: false, error: previo.error, valores };

  const datos = validar(valores);
  if (!datos.ok) return datos;

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('crear_webhook', {
    p_organizacion: previo.ctx.organizacion.id,
    p_url: datos.url,
    p_eventos: datos.eventos,
  });
  const fila = Array.isArray(data) ? data[0] : undefined;
  if (error || !fila?.secreto) return { ...fallo(error ?? {}, 'crear_webhook'), valores };

  revalidar(slug);
  return {
    ok: true,
    mensaje: 'Creaste el webhook. Empezará a recibir los eventos que marcaste.',
    secreto: fila.secreto,
    webhookId: fila.webhook_id,
  };
}

/** Cambia la URL y los eventos (el secreto no cambia). */
export async function actualizarWebhook(
  slug: string,
  webhookId: string,
  _anterior: ResultadoFormularioWebhook | null,
  formulario: FormData,
): Promise<ResultadoFormularioWebhook> {
  const valores = leerValores(formulario);
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return { ok: false, error: previo.error, valores };
  if (!esquemaId.safeParse(webhookId).success) {
    return { ok: false, error: DATOS_INVALIDOS, valores };
  }

  const datos = validar(valores);
  if (!datos.ok) return datos;

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('webhooks')
    .update({ url: datos.url, eventos: datos.eventos }, { count: 'exact' })
    .eq('organizacion_id', previo.ctx.organizacion.id)
    .eq('id', webhookId);
  if (error) return { ...fallo(error, 'actualizar_webhook'), valores };
  if (!count) return { ok: false, error: SIN_EFECTO, valores };

  revalidar(slug, webhookId);
  return { ok: true, mensaje: 'Guardaste los cambios del webhook.' };
}

/** Pausa (`activo = false`) o reactiva el webhook. Pausado, no se encolan eventos nuevos. */
export async function cambiarEstadoWebhook(
  slug: string,
  webhookId: string,
  activo: boolean,
): Promise<ResultadoAccion> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(webhookId).success || typeof activo !== 'boolean') {
    return { ok: false, error: DATOS_INVALIDOS };
  }

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('webhooks')
    .update({ activo }, { count: 'exact' })
    .eq('organizacion_id', previo.ctx.organizacion.id)
    .eq('id', webhookId)
    .eq('activo', !activo);
  if (error) return fallo(error, 'cambiar_estado_webhook');
  if (!count) return { ok: false, error: SIN_EFECTO };

  revalidar(slug, webhookId);
  return {
    ok: true,
    mensaje: activo
      ? 'Activaste el webhook. Recibirá los eventos nuevos.'
      : 'Pausaste el webhook. No recibirá eventos hasta que lo actives, y las entregas pendientes se descartarán.',
  };
}

/** Borra el webhook, su historial de entregas y su secreto en Vault. */
export async function borrarWebhook(slug: string, webhookId: string): Promise<ResultadoAccion> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(webhookId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('webhooks')
    .delete({ count: 'exact' })
    .eq('organizacion_id', previo.ctx.organizacion.id)
    .eq('id', webhookId);
  if (error) return fallo(error, 'borrar_webhook');
  if (!count) return { ok: false, error: SIN_EFECTO };

  revalidar(slug);
  return { ok: true, mensaje: 'Borraste el webhook y su historial de entregas.' };
}

/** Encola un evento `webhook.prueba` para el webhook. */
export async function probarWebhook(slug: string, webhookId: string): Promise<ResultadoAccion> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(webhookId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc('probar_webhook', { p_webhook: webhookId });
  if (error) return fallo(error, 'probar_webhook');

  revalidar(slug, webhookId);
  return {
    ok: true,
    mensaje:
      'Encolamos una entrega de prueba. Saldrá en el próximo minuto: recarga la página para ver el resultado.',
  };
}

/** Cambia el secreto HMAC y devuelve el nuevo UNA vez. El anterior deja de servir de inmediato. */
export async function rotarSecretoWebhook(
  slug: string,
  webhookId: string,
): Promise<ResultadoRotar> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(webhookId).success) return { ok: false, error: DATOS_INVALIDOS };

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('rotar_secreto_webhook', { p_webhook: webhookId });
  if (error || typeof data !== 'string') return fallo(error ?? {}, 'rotar_secreto');

  revalidar(slug, webhookId);
  return { ok: true, secreto: data };
}

/** Vuelve a poner en cola una entrega (la misma: conserva su id para que el receptor deduplique). */
export async function reenviarEntrega(
  slug: string,
  webhookId: string,
  entregaId: number,
): Promise<ResultadoAccion> {
  const previo = await contextoAdmin(slug);
  if (!previo.ok) return previo;
  if (!esquemaId.safeParse(webhookId).success || !esquemaEntrega.safeParse(entregaId).success) {
    return { ok: false, error: DATOS_INVALIDOS };
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc('reenviar_entrega_webhook', { p_entrega: entregaId });
  if (error) return fallo(error, 'reenviar_entrega');

  revalidar(slug, webhookId);
  return {
    ok: true,
    mensaje: `La entrega N.º ${entregaId} volvió a la cola. Saldrá en el próximo minuto.`,
  };
}
