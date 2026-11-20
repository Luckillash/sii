'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  type ArchivoDocumento,
  esquemaBorrador,
  type ProductoCatalogo,
  type ReceptorCatalogo,
  type ResultadoEmision,
} from '@/lib/emision';
import { MENSAJE_GENERICO, type MensajeError } from '@/lib/equipo-errores';
import { puedeEmitir } from '@/lib/permisos';
import * as emision from '@/server/emision';
import { obtenerEmpresa } from '@/server/empresas';
import { exigirMembresia } from '@/server/sesion';
import { erroresDelBorrador } from './logica';

// Server Actions de `/[org]/emitir` (PLAN-SAAS Fase 7). Finas: verifican la membresía y el
// rol (`puede_emitir`: propietario, administrador o emisor), que la empresa sea de la
// organización, validan con `esquemaBorrador` y llaman a `server/emision`, que valida de
// nuevo, asigna el folio, firma, sube al SII y persiste. La autoridad final es RLS / las
// RPC. `maxDuration = 60` lo fija `page.tsx`: en Next 16 el valor de la página aplica a
// todas las Server Actions que se usan en ella.
//
// La emisión tiene dos niveles (`nivel`): `ensayo` (valida y resume, sin folio ni red) y
// `emitir` (⚠️). La UI muestra el ensayo en un `Dialogo` y solo emite al confirmar.

const esquemaId = z.uuid();
const esquemaArchivo = z.enum(['xml', 'pdf_carta', 'pdf_rollo']);
const esquemaEntrada = z.object({
  nivel: z.enum(['ensayo', 'emitir']),
  borrador: z.unknown(),
  borradorId: z.uuid().nullish(),
});
const esquemaGuardar = z.object({ borrador: z.unknown(), borradorId: z.uuid().nullish() });

/** Letras mínimas y máximas de una búsqueda del autocompletado. */
const BUSQUEDA_MINIMA = 2;
const BUSQUEDA_MAXIMA = 100;

const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para emitir',
  detalle:
    'Solo un propietario, un administrador o un emisor puede emitir boletas. Pide a un administrador que cambie tu rol.',
};

const EMPRESA_NO_ENCONTRADA: MensajeError = {
  titulo: 'No encontramos la empresa',
  detalle: 'Puede que la hayan quitado de la organización. Recarga la página y elige otra.',
};

const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Revisa la boleta',
  detalle: 'Hay campos con errores. Corrígelos y vuelve a intentarlo.',
};

function fallo(mensaje: MensajeError, errores?: Record<string, string>): ResultadoEmision {
  return {
    tipo: 'error',
    mensaje,
    operacionId: null,
    motivo: 'no_ejecutada',
    ...(errores ? { errores } : {}),
  };
}

type Previo = { ok: true; ctx: emision.ContextoEmision } | { ok: false; mensaje: MensajeError };

async function preparar(slug: string, empresaId: string): Promise<Previo> {
  const { organizacion, usuario, rol } = await exigirMembresia(slug);
  if (!puedeEmitir(rol)) return { ok: false, mensaje: SIN_PERMISO };
  if (!esquemaId.safeParse(empresaId).success) return { ok: false, mensaje: EMPRESA_NO_ENCONTRADA };
  // La empresa tiene que ser de esta organización (RLS además oculta las de otras).
  const empresa = await obtenerEmpresa(organizacion.id, empresaId);
  if (!empresa) return { ok: false, mensaje: EMPRESA_NO_ENCONTRADA };
  return {
    ok: true,
    ctx: { organizacionId: organizacion.id, empresaId: empresa.id, usuarioId: usuario.id },
  };
}

function revalidar(slug: string) {
  revalidatePath(`/${slug}/emitir`);
}

/** Registra el fallo sin el mensaje (podría traer datos de la petición): solo el tipo. */
function registrar(nombre: string, e: unknown) {
  console.error(`Emisión: falló ${nombre}`, { tipo: e instanceof Error ? e.name : null });
}

/**
 * Ensayo (`nivel: 'ensayo'`) o emisión ⚠️ (`nivel: 'emitir'`) de una boleta. Un error
 * inesperado vuelve como mensaje genérico; si fue al emitir, no se sabe si la boleta
 * alcanzó a salir, y así se dice (no se reintenta a ciegas).
 */
export async function emitir(
  slug: string,
  empresaId: string,
  entrada: unknown,
): Promise<ResultadoEmision> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return fallo(previo.mensaje);
  const e = esquemaEntrada.safeParse(entrada);
  if (!e.success) return fallo(DATOS_INVALIDOS);
  const v = esquemaBorrador.safeParse(e.data.borrador);
  if (!v.success) return fallo(DATOS_INVALIDOS, erroresDelBorrador(v.error));

  const { nivel, borradorId } = e.data;
  let r: ResultadoEmision;
  try {
    r = await emision.emitirDocumento(previo.ctx, {
      nivel,
      borrador: v.data,
      ...(borradorId ? { borradorId } : {}),
    });
  } catch (error) {
    registrar(`emitir(${nivel})`, error);
    if (nivel === 'ensayo') return fallo(MENSAJE_GENERICO);
    revalidar(slug);
    revalidatePath(`/${slug}/folios`);
    // La excepción pudo saltar después de asignar el folio o de enviar al SII.
    return {
      tipo: 'error',
      resultado: 'incierto',
      mensaje: {
        titulo: 'No sabemos si la boleta se emitió',
        detalle:
          'Algo falló mientras la emitíamos y no podemos confirmar si llegó al SII. No la vuelvas a emitir hasta revisarlo: búscala en Documentos emitidos o en el SII.',
      },
      operacionId: null,
    };
  }
  // El ensayo no cambia nada; lo demás puede haber dejado filas nuevas (folio, documento).
  if (r.tipo !== 'ensayo') {
    revalidar(slug);
    revalidatePath(`/${slug}/folios`);
  }
  return r;
}

/** «Guardar borrador» (RLS directo con la sesión). */
export async function guardarBorrador(
  slug: string,
  empresaId: string,
  entrada: unknown,
): Promise<ResultadoEmision> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return fallo(previo.mensaje);
  const e = esquemaGuardar.safeParse(entrada);
  if (!e.success) return fallo(DATOS_INVALIDOS);
  const v = esquemaBorrador.safeParse(e.data.borrador);
  if (!v.success) return fallo(DATOS_INVALIDOS, erroresDelBorrador(v.error));
  try {
    const r = await emision.guardarBorrador(previo.ctx, v.data, e.data.borradorId ?? undefined);
    revalidar(slug);
    return r;
  } catch (error) {
    registrar('guardarBorrador', error);
    return fallo(MENSAJE_GENERICO);
  }
}

export type ResultadoBorrar =
  | { ok: true }
  | { ok: false; mensaje: { titulo: string; detalle: string } };

/** Borra un borrador guardado de la empresa. */
export async function borrarBorrador(
  slug: string,
  empresaId: string,
  borradorId: string,
): Promise<ResultadoBorrar> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return { ok: false, mensaje: previo.mensaje };
  if (!esquemaId.safeParse(borradorId).success) return { ok: false, mensaje: DATOS_INVALIDOS };
  try {
    const r = await emision.borrarBorrador(previo.ctx, borradorId);
    revalidar(slug);
    return r;
  } catch (error) {
    registrar('borrarBorrador', error);
    return { ok: false, mensaje: MENSAJE_GENERICO };
  }
}

function textoBusqueda(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  return t.length < BUSQUEDA_MINIMA ? null : t.slice(0, BUSQUEDA_MAXIMA);
}

/** Autocompletado de receptores. Ante cualquier problema, sin sugerencias. */
export async function buscarReceptores(
  slug: string,
  empresaId: string,
  texto: string,
): Promise<ReceptorCatalogo[]> {
  const t = textoBusqueda(texto);
  if (t === null) return [];
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return [];
  try {
    return await emision.buscarReceptores(
      { organizacionId: previo.ctx.organizacionId, empresaId: previo.ctx.empresaId },
      t,
    );
  } catch (error) {
    registrar('buscarReceptores', error);
    return [];
  }
}

/** Autocompletado de productos. Ante cualquier problema, sin sugerencias. */
export async function buscarProductos(
  slug: string,
  empresaId: string,
  texto: string,
): Promise<ProductoCatalogo[]> {
  const t = textoBusqueda(texto);
  if (t === null) return [];
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return [];
  try {
    return await emision.buscarProductos(
      { organizacionId: previo.ctx.organizacionId, empresaId: previo.ctx.empresaId },
      t,
    );
  } catch (error) {
    registrar('buscarProductos', error);
    return [];
  }
}

export type ResultadoEnlace =
  | { ok: true; url: string }
  | { ok: false; mensaje: { titulo: string; detalle: string } };

/** URL firmada de corta duración del XML o de un PDF de un documento emitido. */
export async function enlaceDocumento(
  slug: string,
  empresaId: string,
  documentoId: string,
  archivo: ArchivoDocumento,
): Promise<ResultadoEnlace> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return { ok: false, mensaje: previo.mensaje };
  const a = esquemaArchivo.safeParse(archivo);
  if (!esquemaId.safeParse(documentoId).success || !a.success) {
    return { ok: false, mensaje: DATOS_INVALIDOS };
  }
  try {
    return await emision.enlaceDocumento(
      { organizacionId: previo.ctx.organizacionId, empresaId: previo.ctx.empresaId },
      documentoId,
      a.data,
    );
  } catch (error) {
    registrar('enlaceDocumento', error);
    return { ok: false, mensaje: MENSAJE_GENERICO };
  }
}
