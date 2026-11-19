import type { BorradorValido, NivelEmision } from '@/lib/emision';

// Tipos públicos de la capa de emisión (contrato de la Fase 7 con la UI). Solo tipos: los
// reexporta `index.ts` y los usan los módulos de la carpeta sin importar `index.ts`.

/**
 * Contexto ya autorizado: por el Server Action (membresía y rol `puede_emitir`
 * verificados, `usuarioId` del usuario) o por la API pública (Fase 11: `usuarioId: null`
 * y `apiKeyId` de la clave ya autenticada, con el alcance `documentos:emitir`).
 */
export interface ContextoEmision {
  organizacionId: string;
  empresaId: string;
  /** `null` = API pública (exige `apiKeyId`). */
  usuarioId: string | null;
  /** API key que emite (Fase 11). Con ella el borrador se guarda con service_role. */
  apiKeyId?: string | null;
}

export interface EntradaEmision {
  nivel: NivelEmision;
  borrador: BorradorValido;
  /** Borrador ya guardado que se emite (se actualiza con lo del formulario). */
  borradorId?: string;
  /** `Idempotency-Key` de la API pública (`documentos.clave_idempotencia`, Fase 11). */
  claveIdempotencia?: string;
}
