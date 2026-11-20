// Revisión de un envío `incierto` (PLAN-SAAS Fase 8, punto 2). Sin migración: reutiliza
// la marca de la capa SII (`marcarInciertaRevisada` de `server/sii/operacion.ts`), que
// guarda `detalle.revisada_en` en la operación incierta de `operaciones_sii`. La emisión
// enlaza su operación al envío (`enlazarOperacion` → `operaciones_sii.envio_id`), así que
// un envío está revisado cuando todas sus operaciones inciertas lo están. Puro: lo usan la
// lectura, la acción y Vitest.

import 'server-only';

/** Resultados de una operación que dejan el envío por verificar. */
export const RESULTADOS_POR_REVISAR = ['incierto', 'en_curso'] as const;

export interface OperacionEnlazada {
  resultado: string;
  detalle: unknown;
}

/** `detalle.revisada_en` de una operación, o `null`. */
export function revisadaEn(detalle: unknown): string | null {
  if (detalle === null || typeof detalle !== 'object' || Array.isArray(detalle)) return null;
  const v = (detalle as Record<string, unknown>).revisada_en;
  return typeof v === 'string' && v !== '' ? v : null;
}

function porRevisar(o: OperacionEnlazada): boolean {
  return (RESULTADOS_POR_REVISAR as readonly string[]).includes(o.resultado);
}

/**
 * Cuándo se revisó el envío: la marca más reciente si TODAS sus operaciones inciertas (o en
 * curso) están revisadas; `null` si falta alguna o si no hay ninguna enlazada.
 */
export function revisionEnvio(operaciones: readonly OperacionEnlazada[]): string | null {
  const pendientes = operaciones.filter(porRevisar);
  if (pendientes.length === 0) return null;
  let ultima: string | null = null;
  for (const o of pendientes) {
    const r = revisadaEn(o.detalle);
    if (!r) return null;
    if (!ultima || Date.parse(r) > Date.parse(ultima)) ultima = r;
  }
  return ultima;
}
