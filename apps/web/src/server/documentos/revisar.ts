import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MensajeError } from '@/lib/equipo-errores';
import { confirmarSesion } from '../certificados/acceso';
import { marcarInciertaRevisada } from '../sii/operacion';
import { clienteServicio } from '../supabase/service';
import { clienteServidor } from '../supabase/servidor';
import type { Database } from '../supabase/tipos';
import { RESULTADOS_POR_REVISAR, revisadaEn } from './revision';

// «Ya lo revisé» de un envío `incierto` (PLAN-SAAS Fase 8, punto 2). Sin migración: marca
// revisadas, con `marcarInciertaRevisada` (el mismo mecanismo que usan Certificación y
// Folios), las operaciones inciertas enlazadas al envío (`operaciones_sii.envio_id`). El
// envío se lee con la SESIÓN (RLS, filtrado por organización); la marca la escribe
// service_role, como el resto de la capa SII. No reintenta nada ni cambia el envío ni sus
// documentos: solo deja constancia de que alguien revisó en el SII, y el Tablero deja de
// avisarlo. Quién puede lo decide la Server Action (`puede_emitir`). Nunca lanza.
//
// Desbloquea volver a emitir boletas que quizá ya llegaron al SII (duplicado), así que antes
// de marcar confirma la sesión con Auth (`getUser()`, PLAN-SAAS Fase 13, punto 1).

export type ResultadoRevision =
  | { ok: true; mensaje: MensajeError }
  | { ok: false; mensaje: MensajeError };

export interface DependenciasRevision {
  sesion: () => Promise<SupabaseClient<Database>>;
  servicio: () => SupabaseClient<Database>;
  marcar: typeof marcarInciertaRevisada;
  /** Confirma contra Auth que la sesión sigue viva y es de ese usuario. */
  confirmarSesion: (usuarioId: string) => Promise<boolean>;
  ahora: () => Date;
}

function resolver(d: Partial<DependenciasRevision> = {}): DependenciasRevision {
  return {
    sesion: d.sesion ?? clienteServidor,
    servicio: d.servicio ?? clienteServicio,
    marcar: d.marcar ?? marcarInciertaRevisada,
    confirmarSesion: d.confirmarSesion ?? confirmarSesion,
    ahora: d.ahora ?? (() => new Date()),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REVISION_NO_ENCONTRADO: MensajeError = {
  titulo: 'No encontramos el envío',
  detalle: 'Puede que sea de otra organización o que ya no exista. Recarga la página.',
};

export const REVISION_NO_INCIERTO: MensajeError = {
  titulo: 'Este envío no está por verificar',
  detalle: 'Tiene Track ID o una respuesta del SII, así que no hace falta marcarlo.',
};

export const REVISION_SESION_VENCIDA: MensajeError = {
  titulo: 'Tu sesión ya no es válida',
  detalle: 'Por seguridad, vuelve a ingresar y marca el envío otra vez.',
};

export const REVISION_SIN_OPERACION: MensajeError = {
  titulo: 'No pudimos marcar el envío como revisado',
  detalle:
    'No encontramos la operación con el SII que lo dejó por verificar. Escríbenos a soporte con la fecha del envío.',
};

const FALLA: MensajeError = {
  titulo: 'No pudimos marcar el envío como revisado',
  detalle: 'Inténtalo de nuevo en unos minutos.',
};

const LISTO: MensajeError = {
  titulo: 'Marcamos el envío como revisado',
  detalle:
    'Ya no aparece en el Tablero. Si en el SII viste que no llegó, emite de nuevo sus boletas desde Emitir; si llegó, no hagas nada más.',
};

export async function marcarEnvioRevisado(
  ctx: { organizacionId: string; usuarioId: string },
  envioId: string,
  dependencias?: Partial<DependenciasRevision>,
): Promise<ResultadoRevision> {
  if (!UUID.test(envioId)) return { ok: false, mensaje: REVISION_NO_ENCONTRADO };
  const deps = resolver(dependencias);
  try {
    const sesion = await deps.sesion();
    const { data: envio, error } = await sesion
      .from('envios')
      .select('id, incierto')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', envioId)
      .maybeSingle();
    if (error) {
      console.warn(`documentos: no se pudo leer el envío a revisar (código ${error.code})`);
      return { ok: false, mensaje: FALLA };
    }
    if (!envio) return { ok: false, mensaje: REVISION_NO_ENCONTRADO };
    if (!envio.incierto) return { ok: false, mensaje: REVISION_NO_INCIERTO };

    const servicio = deps.servicio();
    const { data: operaciones, error: e2 } = await servicio
      .from('operaciones_sii')
      .select('id, resultado, detalle')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('envio_id', envio.id)
      .in('resultado', [...RESULTADOS_POR_REVISAR])
      .order('iniciada_en', { ascending: false });
    if (e2) {
      console.warn(`documentos: no se pudieron leer las operaciones (código ${e2.code})`);
      return { ok: false, mensaje: FALLA };
    }
    if (operaciones.length === 0) return { ok: false, mensaje: REVISION_SIN_OPERACION };

    // Ya revisado (otra pestaña u otra persona): no se vuelve a marcar.
    const pendientes = operaciones.filter((o) => revisadaEn(o.detalle) === null);
    if (pendientes.length > 0 && !(await deps.confirmarSesion(ctx.usuarioId).catch(() => false))) {
      return { ok: false, mensaje: REVISION_SESION_VENCIDA };
    }
    for (const o of pendientes) {
      const r = await deps.marcar(
        servicio,
        { organizacionId: ctx.organizacionId, operacionId: o.id, usuarioId: ctx.usuarioId },
        deps.ahora,
      );
      if (!r.ok) return { ok: false, mensaje: r.mensaje };
    }
    return { ok: true, mensaje: LISTO };
  } catch (e) {
    console.warn('documentos: falló marcar el envío como revisado', {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    return { ok: false, mensaje: FALLA };
  }
}
