import type { BorradorValido, NivelEmision } from '@/lib/emision';

// Tipos públicos de la capa de emisión (contrato de la Fase 7 con la UI). Solo tipos: los
// reexporta `index.ts` y los usan los módulos de la carpeta sin importar `index.ts`.

/** Contexto ya autorizado por el Server Action (membresía y rol `puede_emitir` verificados). */
export interface ContextoEmision {
  organizacionId: string;
  empresaId: string;
  usuarioId: string;
}

export interface EntradaEmision {
  nivel: NivelEmision;
  borrador: BorradorValido;
  /** Borrador ya guardado que se emite (se actualiza con lo del formulario). */
  borradorId?: string;
}
