import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstadoDocumentoBd } from '@/lib/documentos-presentacion';
import type { MensajeError } from '@/lib/equipo-errores';
import type { TipoFolio } from '@/lib/folios';
import { formatearMiles } from '@/lib/formatos';
import { enviarBoletaPorCorreo } from '../correo/boleta';
import { leerMetadata } from '../emision/borradores';
import { enlaceDocumento } from '../emision/enlaces';
import { clienteServicio } from '../supabase/service';
import { clienteServidor } from '../supabase/servidor';
import type { Database, Json } from '../supabase/tipos';

// «Reenviar al receptor» (PLAN-SAAS Fase 8, punto 3). Reutiliza lo de la Fase 7: el PDF
// carta se obtiene con `enlaceDocumento` (URL firmada; lo regenera si falta) y sale por
// `enviarBoletaPorCorreo` (Resend). El documento se lee con la SESIÓN (RLS) filtrado por
// organización; el resultado del correo queda en `metadata.correo` con service_role
// (`documentos` solo admite `update` con sesión en borradores). Quién puede reenviar lo
// decide la Server Action (`puede_emitir`). Nunca lanza.

export type ResultadoReenvio =
  | { ok: true; mensaje: MensajeError }
  | { ok: false; mensaje: MensajeError };

/** Estados en que la boleta existe para el SII y tiene sentido mandarla al receptor. */
export const ESTADOS_REENVIABLES: readonly EstadoDocumentoBd[] = [
  'enviado',
  'aceptado',
  'aceptado_con_reparos',
];

/** Ventana de la clave de idempotencia: dos clics seguidos no mandan dos correos. */
export const VENTANA_REENVIO_MS = 60_000;

export interface DependenciasReenvio {
  sesion: () => Promise<SupabaseClient<Database>>;
  servicio: () => SupabaseClient<Database>;
  enlace: typeof enlaceDocumento;
  correo: typeof enviarBoletaPorCorreo;
  /** Baja el PDF de la URL firmada de Storage. */
  descargar: (url: string) => Promise<Buffer>;
  ahora: () => Date;
}

async function descargarPdf(url: string): Promise<Buffer> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function resolver(d: Partial<DependenciasReenvio> = {}): DependenciasReenvio {
  return {
    sesion: d.sesion ?? clienteServidor,
    servicio: d.servicio ?? clienteServicio,
    enlace: d.enlace ?? enlaceDocumento,
    correo: d.correo ?? enviarBoletaPorCorreo,
    descargar: d.descargar ?? descargarPdf,
    ahora: d.ahora ?? (() => new Date()),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REENVIO_NO_ENCONTRADO: MensajeError = {
  titulo: 'No encontramos la boleta',
  detalle: 'Puede que sea de otra organización o que ya no exista. Recarga la página.',
};

export const REENVIO_SIN_CORREO: MensajeError = {
  titulo: 'La boleta no tiene correo del receptor',
  detalle:
    'Se emitió sin correo, así que no hay a quién reenviarla. Descarga el PDF y compártelo por otro medio.',
};

const NO_SALIO: MensajeError = {
  titulo: 'No pudimos reenviar la boleta',
  detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
};

function noReenviable(estado: EstadoDocumentoBd): MensajeError {
  switch (estado) {
    case 'incierto':
      return {
        titulo: 'Primero revisa la boleta en el SII',
        detalle:
          'No sabemos si el SII la recibió. Revisa en el sitio del SII si el folio quedó recibido antes de mandarla al receptor.',
      };
    case 'rechazado':
      return {
        titulo: 'El SII rechazó esta boleta',
        detalle: 'No es válida, así que no la envíes al receptor. Emite una boleta nueva.',
      };
    case 'anulado':
      return {
        titulo: 'La boleta quedó anulada',
        detalle: 'El SII no la recibió, así que no es válida para el receptor.',
      };
    default:
      return {
        titulo: 'La boleta todavía no llega al SII',
        detalle: 'Podrás reenviarla cuando el SII la reciba.',
      };
  }
}

/** Agrega `metadata.correo` sobre la `metadata` actual de la boleta (service_role). */
async function guardarCorreo(
  deps: DependenciasReenvio,
  organizacionId: string,
  documentoId: string,
  correo: { id: string; enviado_en: string },
): Promise<void> {
  const servicio = deps.servicio();
  const actual = await servicio
    .from('documentos')
    .select('metadata')
    .eq('organizacion_id', organizacionId)
    .eq('id', documentoId)
    .maybeSingle();
  if (actual.error || !actual.data) {
    console.warn(
      `documentos: no se releyó la boleta para guardar el reenvío (código ${actual.error?.code ?? 'sin fila'})`,
    );
    return;
  }
  const base =
    actual.data.metadata !== null &&
    typeof actual.data.metadata === 'object' &&
    !Array.isArray(actual.data.metadata)
      ? actual.data.metadata
      : {};
  const { error } = await servicio
    .from('documentos')
    .update({ metadata: { ...base, correo } as Json })
    .eq('organizacion_id', organizacionId)
    .eq('id', documentoId);
  if (error) console.warn(`documentos: no se guardó el reenvío (código ${error.code})`);
}

export async function reenviarAlReceptor(
  ctx: { organizacionId: string },
  documentoId: string,
  dependencias?: Partial<DependenciasReenvio>,
): Promise<ResultadoReenvio> {
  if (!UUID.test(documentoId)) return { ok: false, mensaje: REENVIO_NO_ENCONTRADO };
  const deps = resolver(dependencias);
  try {
    const sesion = await deps.sesion();
    const { data: doc, error } = await sesion
      .from('documentos')
      .select('id, empresa_id, tipo_dte, folio, estado, fecha_emision, mnt_total, metadata')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', documentoId)
      .maybeSingle();
    if (error) {
      console.warn(`documentos: no se pudo leer el documento a reenviar (código ${error.code})`);
      return { ok: false, mensaje: NO_SALIO };
    }
    if (!doc || doc.folio === null) return { ok: false, mensaje: REENVIO_NO_ENCONTRADO };
    if (!ESTADOS_REENVIABLES.includes(doc.estado)) {
      return { ok: false, mensaje: noReenviable(doc.estado) };
    }
    const metadata = leerMetadata(doc.metadata);
    const para = metadata.receptor_correo?.trim();
    if (!para) return { ok: false, mensaje: REENVIO_SIN_CORREO };

    const { data: empresa, error: e2 } = await sesion
      .from('empresas')
      .select('rut, razon_social')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', doc.empresa_id)
      .maybeSingle();
    if (e2 || !empresa) return { ok: false, mensaje: NO_SALIO };

    const enlace = await deps.enlace(
      { organizacionId: ctx.organizacionId, empresaId: doc.empresa_id },
      doc.id,
      'pdf_carta',
    );
    if (!enlace.ok) return { ok: false, mensaje: enlace.mensaje };

    let pdf: Buffer;
    try {
      pdf = await deps.descargar(enlace.url);
    } catch (e) {
      console.warn('documentos: no se pudo bajar el PDF para reenviar', {
        tipo: e instanceof Error ? e.name : typeof e,
      });
      return { ok: false, mensaje: NO_SALIO };
    }

    const ahora = deps.ahora();
    const tipoDte = (doc.tipo_dte === 41 ? 41 : 39) as TipoFolio;
    const envio = await deps.correo({
      para,
      emisor: { rut: empresa.rut, razonSocial: empresa.razon_social },
      tipoDte,
      folio: doc.folio,
      fechaEmision: doc.fecha_emision,
      total: doc.mnt_total,
      pdf,
      claveIdempotencia: `reenvio-${doc.id}-${Math.floor(ahora.getTime() / VENTANA_REENVIO_MS)}`,
    });
    if (!envio.ok) {
      console.warn(`documentos: el reenvío de la boleta no salió (${envio.motivo})`);
      if (envio.motivo === 'sin_configuracion') {
        return {
          ok: false,
          mensaje: {
            titulo: 'El envío de correos todavía no está configurado',
            detalle: 'No enviamos la boleta. Escríbenos a soporte para activarlo.',
          },
        };
      }
      if (envio.motivo === 'rechazado') {
        return {
          ok: false,
          mensaje: {
            titulo: 'No pudimos enviar la boleta a ese correo',
            detalle: `Revisa que ${para} esté bien escrito. Si no, descarga el PDF y compártelo por otro medio.`,
          },
        };
      }
      return { ok: false, mensaje: NO_SALIO };
    }

    // Lo que salió queda en la boleta (como en la emisión). Se relee `metadata` justo antes:
    // `enlaceDocumento` pudo regenerar el PDF y guardar `metadata.pdf` mientras tanto, y solo
    // se agrega `correo` sobre lo que haya ahora. Si falla, el correo igual salió.
    await guardarCorreo(deps, ctx.organizacionId, doc.id, {
      id: envio.id,
      enviado_en: ahora.toISOString(),
    });

    return {
      ok: true,
      mensaje: {
        titulo: 'Reenviamos la boleta',
        detalle: `La boleta N.º ${formatearMiles(doc.folio)} va en camino a ${para}, con su PDF adjunto.`,
      },
    };
  } catch (e) {
    console.warn('documentos: falló el reenvío al receptor', {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    return { ok: false, mensaje: NO_SALIO };
  }
}
