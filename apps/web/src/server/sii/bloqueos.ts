import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MensajeError } from '../equipo-errores';
import type { ClienteServicio } from '../supabase/service';
import type { Database } from '../supabase/tipos';

// Bloqueo con arriendo por certificado y ambiente sobre las RPC tomar_bloqueo_certificado /
// liberar_bloqueo_certificado (migración 0007, solo service_role). Serializa entre
// peticiones HTTP las operaciones que abren o reutilizan una sesión AUT2000 del SII con
// el mismo certificado: el SII frena el re-login seguido (error 01.01.215.500.771.52).
// Por qué un arriendo y no advisory locks: ver el encabezado de la migración.
//
// Cada llamada usa un titular aleatorio, así que el bloqueo NO es reentrante: una
// operación que ya lo tiene no debe volver a pedirlo para el mismo certificado y
// ambiente (esperaría hasta rendirse).
//
// Los errores de PostgREST se reportan solo con su código, nunca con el detalle (podría
// traer la fila), igual que token-store-supabase.ts.

type Ambiente = Database['public']['Enums']['ambiente_sii'];

/** Arriendo por defecto: el `maxDuration` más largo de las funciones de Vercel. */
export const SEGUNDOS_ARRIENDO = 300;
/** Cuánto se espera por defecto a que otra operación suelte el bloqueo. */
export const ESPERA_MS = 20_000;
/** Pausa entre intentos. */
export const INTERVALO_MS = 1_000;

export const BLOQUEO_OCUPADO: MensajeError = {
  titulo: 'Hay otra operación con el SII en curso con este certificado',
  detalle:
    'El SII no permite usar el mismo certificado en dos operaciones a la vez. Espera a que termine la otra (puede tardar unos minutos) y vuelve a intentarlo.',
};

/** Otra operación tiene el bloqueo y no lo soltó dentro de la espera. */
export class BloqueoOcupadoError extends Error {
  override name = 'BloqueoOcupadoError';
  /** Mensaje para el usuario (design system: qué pasó y qué hacer). */
  readonly mensajeUsuario: MensajeError = BLOQUEO_OCUPADO;

  constructor() {
    super(`${BLOQUEO_OCUPADO.titulo}. ${BLOQUEO_OCUPADO.detalle}`);
  }
}

/** Falla de Supabase al tomar el bloqueo (no se llegó a ejecutar la operación). */
export class ErrorBloqueo extends Error {
  override name = 'ErrorBloqueo';
}

export interface ClaveBloqueo {
  certificadoId: string;
  ambiente: Ambiente;
}

export interface OpcionesBloqueo {
  /** Duración del arriendo, 1..900 s (por defecto {@link SEGUNDOS_ARRIENDO}). */
  segundos?: number;
  /** Espera total antes de rendirse (por defecto {@link ESPERA_MS}; 0 = un solo intento). */
  esperaMs?: number;
  /** Pausa entre intentos (por defecto {@link INTERVALO_MS}). */
  intervaloMs?: number;
  /** Titular del bloqueo (por defecto un UUID aleatorio por llamada). */
  titular?: string;
  /** Para las pruebas: reemplaza la pausa entre intentos. */
  dormir?: (ms: number) => Promise<void>;
}

const dormirReal = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function codigo(error: { code?: string }): string {
  return error.code ? ` (código ${error.code})` : '';
}

/**
 * Ejecuta `fn` con el bloqueo del certificado en el ambiente tomado. Reintenta hasta
 * `esperaMs`; si no lo obtiene, lanza {@link BloqueoOcupadoError} sin ejecutar `fn`. Suelta
 * el bloqueo siempre al terminar, también si `fn` falla; si soltarlo falla, el error de
 * `fn` (o su resultado) se mantiene y el bloqueo vence solo al terminar el arriendo.
 */
export async function conBloqueoCertificado<T>(
  cliente: ClienteServicio,
  clave: ClaveBloqueo,
  fn: () => Promise<T>,
  opciones: OpcionesBloqueo = {},
): Promise<T> {
  const segundos = opciones.segundos ?? SEGUNDOS_ARRIENDO;
  if (!Number.isInteger(segundos) || segundos < 1 || segundos > 900) {
    throw new RangeError('La duración del bloqueo debe ser un entero entre 1 y 900 segundos.');
  }
  const esperaMs = Math.max(0, opciones.esperaMs ?? ESPERA_MS);
  const intervaloMs = Math.max(1, opciones.intervaloMs ?? INTERVALO_MS);
  const dormir = opciones.dormir ?? dormirReal;
  const titular = opciones.titular ?? randomUUID();
  const argumentos = {
    p_certificado: clave.certificadoId,
    p_ambiente: clave.ambiente,
    p_titular: titular,
  };

  // Un intento ahora y uno por cada intervalo dentro de la espera.
  const intentos = Math.floor(esperaMs / intervaloMs) + 1;
  let tomado = false;
  for (let intento = 1; intento <= intentos; intento++) {
    const { data, error } = await cliente.rpc('tomar_bloqueo_certificado', {
      ...argumentos,
      p_segundos: segundos,
    });
    if (error) {
      throw new ErrorBloqueo(
        `No se pudo tomar el bloqueo del certificado en Supabase${codigo(error)}.`,
      );
    }
    if (data === true) {
      tomado = true;
      break;
    }
    if (intento < intentos) await dormir(intervaloMs);
  }
  if (!tomado) throw new BloqueoOcupadoError();

  try {
    return await fn();
  } finally {
    await liberar(cliente, argumentos);
  }
}

async function liberar(
  cliente: ClienteServicio,
  argumentos: { p_certificado: string; p_ambiente: Ambiente; p_titular: string },
): Promise<void> {
  try {
    const { data, error } = await cliente.rpc('liberar_bloqueo_certificado', argumentos);
    if (error) {
      console.warn(`bloqueos: no se pudo soltar el bloqueo del certificado${codigo(error)}`);
    } else if (data === false) {
      // El arriendo venció antes de terminar y quizás otra operación ya lo tomó: no se le
      // quita, pero hay que revisar si el arriendo es corto para la operación.
      console.warn('bloqueos: el arriendo del bloqueo venció antes de terminar la operación');
    }
  } catch (error) {
    // No tapa el error ni el resultado de la operación: el arriendo vence solo.
    console.warn(
      `bloqueos: no se pudo soltar el bloqueo del certificado (${error instanceof Error ? error.name : 'error desconocido'})`,
    );
  }
}
