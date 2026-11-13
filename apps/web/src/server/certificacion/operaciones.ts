import 'server-only';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearFechaHora } from '@/lib/formatos';
import type { MensajeError } from '../sii/errores';
import { MINUTOS_EN_CURSO_ABANDONADA, marcarInciertaRevisada } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import { AMBIENTE, fallaBase, ok } from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// Operaciones inciertas del asistente.
//
// `enviar_set` no es de «efecto global» en `ejecutarOperacion` (allí solo lo son
// solicitar_folios, postular y declarar, sincronizado con el índice de la 0007), así que
// el bloqueo de reintento del envío del set se hace aquí: si el último envío confirmado
// quedó `incierto` (sin Track ID: pudo haber llegado) y nadie lo marcó como revisado, o
// hay otro en curso, no se reenvía (principio 3). Se mira `operaciones_sii` para que
// «Marcar como revisada» lo desbloquee igual que a las demás.

function revisada(detalle: unknown): boolean {
  return (
    detalle !== null &&
    typeof detalle === 'object' &&
    !Array.isArray(detalle) &&
    typeof (detalle as Record<string, unknown>).revisada_en === 'string'
  );
}

export interface BloqueoEnvio {
  motivo: 'incierto_sin_revisar' | 'en_curso';
  mensaje: MensajeError;
  operacionPendienteId: string;
}

/** `null` si se puede enviar el set; si no, por qué no. */
export async function bloqueoEnvioSet(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  ahora: Date,
): Promise<BloqueoEnvio | null> {
  const { data, error } = await cliente
    .from('operaciones_sii')
    .select('id, resultado, detalle, iniciada_en')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('operacion', 'enviar_set')
    .eq('ambiente', AMBIENTE)
    .eq('confirmada', true)
    .not('resultado', 'in', '(uso,config)')
    .order('iniciada_en', { ascending: false })
    .limit(1);
  if (error) throw fallaBase('consultar el envío anterior del set', error);
  const fila = data[0];
  if (!fila || revisada(fila.detalle)) return null;
  const abandonada =
    ahora.getTime() - new Date(fila.iniciada_en).getTime() > MINUTOS_EN_CURSO_ABANDONADA * 60_000;
  const cuando = formatearFechaHora(fila.iniciada_en);
  if (fila.resultado === 'incierto' || (fila.resultado === 'en_curso' && abandonada)) {
    return {
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: fila.id,
      mensaje: {
        titulo: 'El envío anterior del set no está confirmado',
        detalle: `El envío del set del ${cuando} quedó con resultado incierto: pudo haber llegado al SII y usar sus folios. Revisa los envíos de la empresa en el portal del SII antes de reenviar; cuando lo hayas revisado, márcalo como revisado para poder enviar otra vez.`,
      },
    };
  }
  if (fila.resultado === 'en_curso') {
    return {
      motivo: 'en_curso',
      operacionPendienteId: fila.id,
      mensaje: {
        titulo: 'Ya hay un envío del set en curso',
        detalle: `Hay un envío del set en curso desde ${cuando}. Espera a que termine y revisa su resultado antes de enviarlo otra vez.`,
      },
    };
  }
  return null;
}

/**
 * Marca como revisada una operación incierta de la empresa (envuelve
 * `marcarInciertaRevisada`; quien llama ya verificó que es administrador).
 */
export async function marcarRevisada(
  ctx: ContextoCertificacion,
  operacionId: string,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const noEncontrada: ResultadoPaso = {
    tipo: 'error',
    mensaje: {
      titulo: 'No encontramos la operación',
      detalle: 'Puede que ya no exista o que sea de otra empresa. Recarga la página.',
    },
    operacionId: null,
    motivo: 'no_encontrada',
  };
  const { data, error } = await cliente
    .from('operaciones_sii')
    .select('id, empresa_id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', operacionId)
    .maybeSingle();
  if (error) {
    return error.code === '22P02'
      ? noEncontrada
      : {
          tipo: 'error',
          mensaje: {
            titulo: 'No pudimos marcar la operación',
            detalle: 'Inténtalo de nuevo en unos minutos.',
          },
          operacionId: null,
          motivo: 'error',
        };
  }
  if (!data || data.empresa_id !== ctx.empresaId) return noEncontrada;

  const r = await marcarInciertaRevisada(
    cliente,
    { organizacionId: ctx.organizacionId, operacionId, usuarioId: ctx.usuarioId },
    () => deps.reloj.ahora(),
  );
  if (!r.ok) return { tipo: 'error', mensaje: r.mensaje, operacionId, motivo: 'no_revisable' };
  return ok(
    {
      titulo: 'Marcamos la operación como revisada',
      detalle: 'Si confirmaste en el SII que no quedó hecha, ya puedes repetirla.',
    },
    operacionId,
  );
}
