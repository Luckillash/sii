import 'server-only';
import { clienteServidor } from '../supabase/servidor';
import {
  type MensajeError,
  type OperacionCertificado,
  SIN_EFECTO,
  traducirErrorCertificado,
} from './errores';

// Asociación certificado ↔ empresa (`empresa_certificados`, PLAN-SAAS Fase 3, punto
// 3). Todo con el cliente de sesión: la tabla la escriben los administradores por RLS
// y `fijar_certificado_predeterminado()` es `security invoker`. Quien llama ya
// comprobó que la empresa es de la organización; igual, `organizacion_id` lo fija
// `tg_heredar_organizacion` desde la empresa y la FK compuesta exige que el
// certificado sea de la misma organización.

export type ResultadoAsociacion = { ok: true } | { ok: false; error: MensajeError };

function fallo(
  error: { code?: string | null },
  operacion: OperacionCertificado,
): { ok: false; error: MensajeError } {
  const traducido = traducirErrorCertificado(error, operacion);
  // Solo el código de Postgres: el mensaje podría arrastrar valores de la fila.
  console.error(`Certificados: ${operacion} falló`, { codigo: error.code ?? null });
  return { ok: false, error: traducido };
}

export async function asociarCertificado(
  organizacionId: string,
  empresaId: string,
  certificadoId: string,
  opciones: { representante: boolean; predeterminado: boolean },
): Promise<ResultadoAsociacion> {
  const supabase = await clienteServidor();
  const { error } = await supabase.from('empresa_certificados').insert({
    organizacion_id: organizacionId,
    empresa_id: empresaId,
    certificado_id: certificadoId,
    es_representante_electronico: opciones.representante,
    predeterminado: false,
  });
  if (error) return fallo(error, 'asociar');
  if (opciones.predeterminado) return fijarPredeterminado(empresaId, certificadoId);
  return { ok: true };
}

/** Deja este certificado como el predeterminado de la empresa (apaga el anterior). */
export async function fijarPredeterminado(
  empresaId: string,
  certificadoId: string,
): Promise<ResultadoAsociacion> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc('fijar_certificado_predeterminado', {
    p_empresa: empresaId,
    p_certificado: certificadoId,
  });
  if (error) return fallo(error, 'predeterminado');
  return { ok: true };
}

export async function cambiarOpcionAsociacion(
  organizacionId: string,
  empresaId: string,
  certificadoId: string,
  cambio: { es_representante_electronico: boolean } | { predeterminado: false },
): Promise<ResultadoAsociacion> {
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('empresa_certificados')
    .update(cambio, { count: 'exact' })
    .eq('organizacion_id', organizacionId)
    .eq('empresa_id', empresaId)
    .eq('certificado_id', certificadoId);
  if (error) return fallo(error, 'editar_asociacion');
  if (!count) return { ok: false, error: SIN_EFECTO };
  return { ok: true };
}

export async function quitarAsociacion(
  organizacionId: string,
  empresaId: string,
  certificadoId: string,
): Promise<ResultadoAsociacion> {
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from('empresa_certificados')
    .delete({ count: 'exact' })
    .eq('organizacion_id', organizacionId)
    .eq('empresa_id', empresaId)
    .eq('certificado_id', certificadoId);
  if (error) return fallo(error, 'quitar_asociacion');
  if (!count) return { ok: false, error: SIN_EFECTO };
  return { ok: true };
}
