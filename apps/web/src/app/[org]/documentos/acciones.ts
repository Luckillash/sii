'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ArchivoDocumento } from '@/lib/emision';
import { puedeEmitir } from '@/lib/permisos';
import type { ResultadoConsultaEnvio } from '@/lib/seguimiento';
import * as documentos from '@/server/documentos';
import { guiaIncierto } from '@/server/documentos/presentacion';
import * as emision from '@/server/emision';
import { MENSAJE_GENERICO, type MensajeError } from '@/server/equipo-errores';
import { consultarEnvio } from '@/server/seguimiento';
import { exigirMembresia } from '@/server/sesion';

// Server Actions de `/[org]/documentos` y `/[org]/envios/[id]` (PLAN-SAAS Fase 8). Finas:
// verifican la membresía (`exigirMembresia`), validan con zod que el documento o el envío
// sea de la organización (lectura con la sesión: RLS) y llaman al backend. La autoridad
// final es RLS / el backend, que vuelve a revisar todo.
//
// Permisos:
//   - Descargar XML/PDF y «Consultar estado en el SII»: cualquier miembro (un lector
//     consulta documentos y envíos; consultar no cambia la boleta, solo trae su estado).
//   - «Reenviar al receptor»: `puede_emitir` (propietario, administrador o emisor), porque
//     manda un correo en nombre de la empresa.

const esquemaId = z.uuid();
const esquemaArchivo = z.enum(['xml', 'pdf_carta', 'pdf_rollo']);

const SIN_PERMISO_REENVIO: MensajeError = {
  titulo: 'No tienes permiso para reenviar boletas',
  detalle:
    'Solo un propietario, un administrador o un emisor puede reenviarlas al receptor. Descarga el PDF si necesitas compartirlo.',
};

const DOCUMENTO_NO_ENCONTRADO: MensajeError = {
  titulo: 'No encontramos la boleta',
  detalle: 'Puede que sea de otra organización o que ya no exista. Recarga la página.',
};

const ENVIO_NO_ENCONTRADO: MensajeError = {
  titulo: 'No encontramos el envío',
  detalle: 'Puede que sea de otra organización o que ya no exista. Recarga la página.',
};

/** Registra el fallo sin el mensaje (podría traer datos de la petición): solo el tipo. */
function registrar(nombre: string, e: unknown) {
  console.error(`Documentos: falló ${nombre}`, { tipo: e instanceof Error ? e.name : null });
}

function revalidar(slug: string, envioId?: string) {
  revalidatePath(`/${slug}/documentos`);
  if (envioId) revalidatePath(`/${slug}/envios/${envioId}`);
}

/**
 * «Consultar estado en el SII» de un envío (a pedido; el cron lo hace cada 5 minutos).
 * Un envío incierto no tiene Track ID: no se consulta y se explica cómo revisarlo en el
 * SII (principio 3).
 */
export async function consultarEstado(
  slug: string,
  envioId: string,
): Promise<ResultadoConsultaEnvio> {
  const { organizacion, usuario } = await exigirMembresia(slug);
  if (!esquemaId.safeParse(envioId).success) return { tipo: 'error', mensaje: ENVIO_NO_ENCONTRADO };
  try {
    const envio = await documentos.leerEnvioMinimo(organizacion.id, envioId);
    if (!envio) return { tipo: 'error', mensaje: ENVIO_NO_ENCONTRADO };
    if (envio.incierto) return { tipo: 'sin_track_id', mensaje: guiaIncierto() };
    const r = await consultarEnvio({
      organizacionId: organizacion.id,
      envioId: envio.id,
      usuarioId: usuario.id,
    });
    if (r.tipo === 'consultado' || r.tipo === 'error') revalidar(slug, envio.id);
    return r;
  } catch (e) {
    registrar('consultarEstado', e);
    revalidar(slug, envioId);
    return { tipo: 'error', mensaje: MENSAJE_GENERICO };
  }
}

export type ResultadoAccion =
  | { ok: true; mensaje: MensajeError }
  | { ok: false; mensaje: MensajeError };

/** «Reenviar al receptor»: el PDF carta al correo guardado en la boleta. */
export async function reenviarAlReceptor(
  slug: string,
  documentoId: string,
): Promise<ResultadoAccion> {
  const { organizacion, rol } = await exigirMembresia(slug);
  if (!puedeEmitir(rol)) return { ok: false, mensaje: SIN_PERMISO_REENVIO };
  if (!esquemaId.safeParse(documentoId).success) {
    return { ok: false, mensaje: DOCUMENTO_NO_ENCONTRADO };
  }
  try {
    const r = await documentos.reenviarAlReceptor({ organizacionId: organizacion.id }, documentoId);
    if (r.ok) revalidar(slug);
    return r;
  } catch (e) {
    registrar('reenviarAlReceptor', e);
    return { ok: false, mensaje: MENSAJE_GENERICO };
  }
}

const SIN_PERMISO_REVISION: MensajeError = {
  titulo: 'No tienes permiso para marcar envíos como revisados',
  detalle:
    'Solo un propietario, un administrador o un emisor puede hacerlo, porque de eso depende si las boletas se emiten de nuevo.',
};

/**
 * «Ya lo revisé» de un envío incierto: deja constancia de que alguien revisó en el SII si
 * llegó (marca revisada su operación incierta, sin migración) y el Tablero deja de
 * avisarlo. No reintenta nada.
 */
export async function marcarRevisado(slug: string, envioId: string): Promise<ResultadoAccion> {
  const { organizacion, usuario, rol } = await exigirMembresia(slug);
  if (!puedeEmitir(rol)) return { ok: false, mensaje: SIN_PERMISO_REVISION };
  if (!esquemaId.safeParse(envioId).success) return { ok: false, mensaje: ENVIO_NO_ENCONTRADO };
  try {
    const r = await documentos.marcarEnvioRevisado(
      { organizacionId: organizacion.id, usuarioId: usuario.id },
      envioId,
    );
    if (r.ok) {
      revalidar(slug, envioId);
      revalidatePath(`/${slug}/tablero`);
    }
    return r;
  } catch (e) {
    registrar('marcarRevisado', e);
    return { ok: false, mensaje: MENSAJE_GENERICO };
  }
}

export type ResultadoEnlace = { ok: true; url: string } | { ok: false; mensaje: MensajeError };

/** URL firmada de corta duración del XML o de un PDF (carta o rollo) de una boleta. */
export async function enlaceArchivo(
  slug: string,
  documentoId: string,
  archivo: ArchivoDocumento,
): Promise<ResultadoEnlace> {
  const { organizacion } = await exigirMembresia(slug);
  const a = esquemaArchivo.safeParse(archivo);
  if (!esquemaId.safeParse(documentoId).success || !a.success) {
    return { ok: false, mensaje: DOCUMENTO_NO_ENCONTRADO };
  }
  try {
    const empresaId = await documentos.empresaDelDocumento(organizacion.id, documentoId);
    if (!empresaId) return { ok: false, mensaje: DOCUMENTO_NO_ENCONTRADO };
    return await emision.enlaceDocumento(
      { organizacionId: organizacion.id, empresaId },
      documentoId,
      a.data,
    );
  } catch (e) {
    registrar('enlaceArchivo', e);
    return { ok: false, mensaje: MENSAJE_GENERICO };
  }
}
