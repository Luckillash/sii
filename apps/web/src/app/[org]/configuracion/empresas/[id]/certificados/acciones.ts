'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { puedeAdministrar } from '@/lib/permisos';
import {
  asociarCertificado,
  cambiarOpcionAsociacion,
  fijarPredeterminado,
  quitarAsociacion,
  type ResultadoAsociacion,
} from '@/server/certificados/asociaciones';
import { existeCertificado, obtenerEmpresaBasica } from '@/server/certificados/consultas';
import {
  DATOS_INVALIDOS,
  type MensajeError,
  SIN_EFECTO,
  SIN_PERMISO,
} from '@/server/certificados/errores';
import { exigirMembresia } from '@/server/sesion';

// Certificados de una empresa (PLAN-SAAS Fase 3, punto 3): asociar uno de la
// organización, marcar representante electrónico y predeterminado, quitar la
// asociación. Todo con el cliente de sesión (RLS de administrador en
// `empresa_certificados`); la empresa y el certificado se comprueban contra la
// organización de la membresía antes de escribir.

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };

export type ResultadoAsociar =
  | { ok: true; mensaje: string }
  | { ok: false; error: MensajeError; errores?: { certificado_id?: string } };

const esquemaId = z.uuid();

type Previo = { ok: true; organizacionId: string } | { ok: false; error: MensajeError };

async function preparar(slug: string, empresaId: string, certificadoId: string): Promise<Previo> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!esquemaId.safeParse(empresaId).success || !esquemaId.safeParse(certificadoId).success) {
    return { ok: false, error: DATOS_INVALIDOS };
  }
  const empresa = await obtenerEmpresaBasica(ctx.organizacion.id, empresaId);
  if (!empresa) return { ok: false, error: SIN_EFECTO };
  return { ok: true, organizacionId: ctx.organizacion.id };
}

function rutas(slug: string, empresaId: string) {
  revalidatePath(`/${slug}/configuracion/empresas/${empresaId}/certificados`);
  revalidatePath(`/${slug}/configuracion/empresas/${empresaId}`);
}

function resultado(r: ResultadoAsociacion, mensaje: string): ResultadoAccion {
  return r.ok ? { ok: true, mensaje } : r;
}

export async function asociarCertificadoEmpresa(
  slug: string,
  empresaId: string,
  _anterior: ResultadoAsociar | null,
  formulario: FormData,
): Promise<ResultadoAsociar> {
  const certificadoId = String(formulario.get('certificado_id') ?? '');
  if (!certificadoId) {
    return {
      ok: false,
      error: {
        titulo: 'Elige un certificado',
        detalle: 'Elige uno de la lista y vuelve a intentarlo.',
      },
      errores: { certificado_id: 'Elige un certificado.' },
    };
  }
  const previo = await preparar(slug, empresaId, certificadoId);
  if (!previo.ok) return previo;
  if (!(await existeCertificado(previo.organizacionId, certificadoId))) {
    return {
      ok: false,
      error: SIN_EFECTO,
      errores: { certificado_id: 'Ese certificado ya no está en la organización.' },
    };
  }

  const r = await asociarCertificado(previo.organizacionId, empresaId, certificadoId, {
    representante: formulario.get('representante') === 'on',
    predeterminado: formulario.get('predeterminado') === 'on',
  });
  if (!r.ok) return r;
  rutas(slug, empresaId);
  return { ok: true, mensaje: 'Asociaste el certificado a la empresa.' };
}

export async function cambiarRepresentante(
  slug: string,
  empresaId: string,
  certificadoId: string,
  esRepresentante: boolean,
): Promise<ResultadoAccion> {
  const previo = await preparar(slug, empresaId, certificadoId);
  if (!previo.ok) return previo;
  const r = await cambiarOpcionAsociacion(previo.organizacionId, empresaId, certificadoId, {
    es_representante_electronico: esRepresentante === true,
  });
  if (r.ok) rutas(slug, empresaId);
  return resultado(
    r,
    esRepresentante
      ? 'Marcaste al titular como representante electrónico de la empresa.'
      : 'El titular ya no figura como representante electrónico de la empresa.',
  );
}

export async function usarComoPredeterminado(
  slug: string,
  empresaId: string,
  certificadoId: string,
): Promise<ResultadoAccion> {
  const previo = await preparar(slug, empresaId, certificadoId);
  if (!previo.ok) return previo;
  const r = await fijarPredeterminado(empresaId, certificadoId);
  if (r.ok) rutas(slug, empresaId);
  return resultado(r, 'Ese certificado es ahora el predeterminado de la empresa.');
}

export async function dejarDeSerPredeterminado(
  slug: string,
  empresaId: string,
  certificadoId: string,
): Promise<ResultadoAccion> {
  const previo = await preparar(slug, empresaId, certificadoId);
  if (!previo.ok) return previo;
  const r = await cambiarOpcionAsociacion(previo.organizacionId, empresaId, certificadoId, {
    predeterminado: false,
  });
  if (r.ok) rutas(slug, empresaId);
  return resultado(r, 'La empresa ya no tiene un certificado predeterminado.');
}

export async function quitarCertificadoEmpresa(
  slug: string,
  empresaId: string,
  certificadoId: string,
): Promise<ResultadoAccion> {
  const previo = await preparar(slug, empresaId, certificadoId);
  if (!previo.ok) return previo;
  const r = await quitarAsociacion(previo.organizacionId, empresaId, certificadoId);
  if (r.ok) rutas(slug, empresaId);
  return resultado(
    r,
    'El certificado ya no firma por esta empresa. Sigue cargado en la organización.',
  );
}
