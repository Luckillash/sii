import type { DetalleRepRechRest, EstadisticaEnvioRest } from '@winex/certificacion';
import type { ClasificacionEnvio } from '@/lib/seguimiento';
import type { Database } from '@/server/supabase/tipos';

// Tipos internos del seguimiento de envíos (Fase 8). Solo tipos: los usan los módulos de
// la carpeta sin importar `index.ts`.

type Enums = Database['public']['Enums'];

/** Contexto ya autorizado por la Server Action (membresía verificada con `exigirMembresia`). */
export interface ContextoConsultaEnvio {
  organizacionId: string;
  envioId: string;
  usuarioId: string;
}

/** Columnas de `envios` (o de `v_envios_por_consultar`) que usa el seguimiento. */
export const COLUMNAS_ENVIO =
  'id, organizacion_id, empresa_id, ambiente, canal, proposito, track_id, incierto, estado_sii, glosa_sii, informados, aceptados, rechazados, reparos, consultas, ultima_consulta_en, enviado_en, clasificacion';

/** Un envío por consultar (no nulos: la vista los devuelve tipados como nullables). */
export interface EnvioSeguimiento {
  id: string;
  organizacion_id: string;
  empresa_id: string;
  ambiente: Enums['ambiente_sii'];
  canal: Enums['canal_sii'];
  proposito: Enums['proposito_envio'];
  track_id: string | null;
  incierto: boolean;
  estado_sii: string | null;
  glosa_sii: string | null;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
  consultas: number;
  ultima_consulta_en: string | null;
  /** Cuándo salió al SII (para el tramo de envíos que nunca cierran). */
  enviado_en: string | null;
  clasificacion: ClasificacionEnvio | null;
}

/**
 * La respuesta del SII normalizada para los dos canales. El REST (`EstadoEnvioRest`) trae
 * la estadística por tipo y el detalle por documento; el SOAP (`EstadoEnvio`, QueryEstUp)
 * solo el estado, la glosa y los conteos sumados (`conDetalle = false`).
 */
export interface RespuestaEstado {
  estado: string;
  glosa: string | null;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
  estadistica: readonly EstadisticaEnvioRest[];
  detalle: readonly DetalleRepRechRest[];
  conDetalle: boolean;
  /** El JSON que respondió el SII (REST) o los campos leídos de QueryEstUp (SOAP). */
  json: Readonly<Record<string, unknown>>;
}
