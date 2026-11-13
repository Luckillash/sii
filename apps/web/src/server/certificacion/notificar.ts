import 'server-only';
import { correoCertificacion } from '@sii/correos';
import { ETIQUETA_ETAPA, type EtapaCertificacion } from '@/lib/certificacion';
import { formatearRut } from '@/lib/formatos';
import type { ClienteServicio } from '../supabase/service';
import type { CambioEtapa } from './comun';
import type { DependenciasCertificacion } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// Correo a los propietarios y administradores de la organización en cada cambio de
// etapa de la certificación (PLAN-SAAS Fase 5 y §4.6). El webhook
// `certificacion.actualizada` ya lo encola el trigger `tg_certificacion_autorizada`.
//
// - Idempotente por operación: `Idempotency-Key` = `certificacion/<operación>/<etapa>`
//   (la misma operación no avisa dos veces la misma etapa).
// - Nunca falla la operación: cualquier error queda en un aviso de consola sin datos
//   (ni correos ni contenido) y la función termina normalmente.
// - Lee con service_role filtrando por organización: los correos de los miembros no
//   los expone RLS a quien no es de la organización.

export const SIGUIENTE_PASO: Readonly<Record<EtapaCertificacion, string>> = Object.freeze({
  borrador: 'Completa los datos de la postulación en el asistente.',
  postulada: 'El siguiente paso es descargar el set de pruebas desde el asistente.',
  set_descargado: 'Pide los folios del set y envíalo al SII desde el asistente.',
  set_enviado: 'Consulta el estado del envío en unos minutos: el SII tarda en validarlo.',
  set_aceptado: 'El SII aceptó el set. Pide la revisión del set desde el asistente.',
  revision_solicitada:
    'El SII responde por correo. Cuando apruebe la revisión, consulta el estado de la declaración en el asistente.',
  por_declarar:
    'La empresa está lista para declarar el cumplimiento. Hazlo desde el asistente para quedar autorizada en producción.',
  autorizada: 'La empresa quedó autorizada en producción: ya puede emitir boletas electrónicas.',
});

export async function notificarCambioEtapa(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  cambio: CambioEtapa,
  operacionId: string,
): Promise<void> {
  if (cambio.anterior === cambio.nueva) return;
  try {
    const urlApp = deps.correo.urlApp();
    if (!urlApp) {
      console.warn('certificacion: sin NEXT_PUBLIC_APP_URL, no se envía el aviso de etapa');
      return;
    }
    const [organizacion, empresa, miembros] = await Promise.all([
      cliente
        .from('organizaciones')
        .select('nombre, slug')
        .eq('id', ctx.organizacionId)
        .maybeSingle(),
      cliente
        .from('empresas')
        .select('razon_social, rut')
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', ctx.empresaId)
        .maybeSingle(),
      cliente
        .from('miembros_organizacion')
        .select('usuario_id')
        .eq('organizacion_id', ctx.organizacionId)
        .in('rol', ['propietario', 'administrador']),
    ]);
    if (organizacion.error || empresa.error || miembros.error) {
      console.warn('certificacion: no se pudieron leer los datos del aviso de etapa');
      return;
    }
    if (!organizacion.data || !empresa.data || miembros.data.length === 0) return;

    const perfiles = await cliente
      .from('perfiles')
      .select('correo')
      .in(
        'id',
        miembros.data.map((m) => m.usuario_id),
      );
    if (perfiles.error) {
      console.warn('certificacion: no se pudieron leer los correos del aviso de etapa');
      return;
    }
    const para = [
      ...new Set(
        perfiles.data
          .map((p) => p.correo?.trim().toLowerCase() ?? '')
          .filter((correo) => correo.includes('@')),
      ),
    ];
    if (para.length === 0) return;

    const correo = correoCertificacion({
      organizacion: organizacion.data.nombre,
      empresa: empresa.data.razon_social,
      rut: formatearRut(empresa.data.rut),
      etapa: ETIQUETA_ETAPA[cambio.nueva],
      siguientePaso: SIGUIENTE_PASO[cambio.nueva],
      enlace: `${urlApp}/${encodeURIComponent(organizacion.data.slug)}/certificacion`,
    });
    const envio = await deps.correo.enviar({
      para,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: `certificacion/${operacionId}/${cambio.nueva}`,
    });
    if (!envio.ok) {
      console.warn(`certificacion: el aviso de etapa no salió (${envio.motivo})`);
    }
  } catch (error) {
    console.warn('certificacion: falló el aviso de etapa', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
}
