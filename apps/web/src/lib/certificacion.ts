import type { MensajeError } from '@/server/equipo-errores';
import type { Database } from '@/server/supabase/tipos';

// Contrato compartido de la Fase 5 (PLAN-SAAS §7, «Certificación ante el SII»):
// los pasos visibles del asistente, su relación con `etapa_certificacion` y la forma
// de lo que devuelven las acciones. Puro (sin `server-only`): lo importan los
// componentes cliente de `/[org]/certificacion` y la capa `server/certificacion/`.
//
// `Database` y `MensajeError` llegan con `import type` (se borran al compilar).

export type EtapaCertificacion = Database['public']['Enums']['etapa_certificacion'];
export type OperacionSii = Database['public']['Enums']['operacion_sii'];
export type ResultadoOperacion = Database['public']['Enums']['resultado_operacion'];

/** Las 8 etapas en el orden del enum (el mismo orden en que avanza el proceso). */
export const ETAPAS = [
  'borrador',
  'postulada',
  'set_descargado',
  'set_enviado',
  'set_aceptado',
  'revision_solicitada',
  'por_declarar',
  'autorizada',
] as const satisfies readonly EtapaCertificacion[];

export const ETIQUETA_ETAPA: Readonly<Record<EtapaCertificacion, string>> = {
  borrador: 'Sin postular',
  postulada: 'Postulada',
  set_descargado: 'Set de pruebas descargado',
  set_enviado: 'Set enviado al SII',
  set_aceptado: 'Set aceptado',
  revision_solicitada: 'Revisión solicitada',
  por_declarar: 'Lista para declarar (P90)',
  autorizada: 'Autorizada en producción (P91)',
};

export type NumeroPaso = 1 | 2 | 3 | 4 | 5;

export interface PasoCertificacion {
  numero: NumeroPaso;
  titulo: string;
  /** Etapas que pertenecen a este paso (el paso está en curso si la etapa es una de ellas). */
  etapas: readonly EtapaCertificacion[];
}

/** Los 5 pasos visibles (PLAN-SAAS H3 y tabla de la Fase 5). */
export const PASOS: readonly PasoCertificacion[] = [
  { numero: 1, titulo: 'Postulación', etapas: ['borrador'] },
  { numero: 2, titulo: 'Set de pruebas', etapas: ['postulada'] },
  { numero: 3, titulo: 'Folios y envío del set', etapas: ['set_descargado', 'set_enviado'] },
  { numero: 4, titulo: 'Revisión', etapas: ['set_aceptado', 'revision_solicitada'] },
  { numero: 5, titulo: 'Declaración de cumplimiento', etapas: ['por_declarar', 'autorizada'] },
];

export function indiceEtapa(etapa: EtapaCertificacion): number {
  return ETAPAS.indexOf(etapa);
}

/** Paso en curso para una etapa (`autorizada` queda en el 5, ya completo). */
export function pasoDeEtapa(etapa: EtapaCertificacion): NumeroPaso {
  const paso = PASOS.find((p) => p.etapas.includes(etapa));
  return paso ? paso.numero : 1;
}

export type EstadoPaso = 'completo' | 'en_curso' | 'pendiente';

export function estadoPaso(numero: NumeroPaso, etapa: EtapaCertificacion): EstadoPaso {
  if (etapa === 'autorizada') return 'completo';
  const actual = pasoDeEtapa(etapa);
  if (numero < actual) return 'completo';
  return numero === actual ? 'en_curso' : 'pendiente';
}

// --- Resultado de las acciones del asistente ----------------------------------------

/** Una fila del resumen del ensayo («qué se enviará»). */
export interface FilaResumen {
  etiqueta: string;
  valor: string;
}

/**
 * Ensayo de una operación ⚠️ (equivale a correr la CLI sin `--confirmar`): no sale
 * nada al SII. La UI lo muestra en un `Dialogo` y pide confirmar.
 */
export interface ResumenEnsayo {
  operacion: OperacionSii;
  /** Título del diálogo, p. ej. «Postular a boleta electrónica». */
  titulo: string;
  /** Siempre certificación en la Fase 5. */
  ambiente: 'certificacion';
  /** Con qué certificado se firma o se inicia sesión (nunca la huella completa ni secretos). */
  certificado: { titular: string; rut: string; vigenteHasta: string };
  /** Qué se enviará (datos de la postulación, folios, casos, trackId...). */
  filas: FilaResumen[];
  /** Advertencias que el usuario debe leer antes de confirmar (en el tono del design system). */
  avisos: string[];
  /** Texto del botón de confirmar, p. ej. «Postular». */
  textoConfirmar: string;
}

/** Datos que la acción necesita para poder repetirse (p. ej. el folio inicial que pide el SII). */
export interface Requerimiento {
  folioInicial?: { sugerido: string };
}

export type ResultadoPaso =
  | { tipo: 'ensayo'; resumen: ResumenEnsayo }
  | {
      tipo: 'ok';
      /** Qué pasó, para un `Alerta` de tono `exito`. */
      mensaje: { titulo: string; detalle: string };
      /** Avisos que devolvió el SII (p. ej. los de la postulación). */
      avisos?: string[];
      operacionId: string | null;
    }
  | {
      tipo: 'error';
      mensaje: MensajeError;
      /** Resultado de `operaciones_sii` cuando la operación se ejecutó. */
      resultado?: Exclude<ResultadoOperacion, 'en_curso' | 'ok'>;
      /** Por qué no se ejecutó (sesión, incierto sin revisar, en curso, datos inválidos...). */
      motivo?: string;
      operacionId: string | null;
      /** La operación incierta que bloquea (para «Marcar como revisada»). */
      operacionPendienteId?: string;
      /** Errores por campo de un formulario. */
      errores?: Record<string, string>;
      requiere?: Requerimiento;
    };
