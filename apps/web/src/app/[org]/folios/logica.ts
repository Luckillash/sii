import type { AmbienteSii, EstadoCaf, EstadoSolicitudFolios } from '@/lib/folios';
import { textoRango } from '@/lib/folios';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { FilaSolicitud, OperacionFolios, VistaFolios } from '@/server/folios';

// Lógica pura de `/[org]/folios` (PLAN-SAAS Fase 6): qué bloquea pedir folios en cada
// ambiente (para explicarlo antes de que el usuario choque con `ejecutarOperacion`), qué
// solicitudes quedaron por verificar y el tono de cada estado. Sin React ni
// `server-only`; se prueba con Vitest. La autoridad sigue siendo el servidor.

/**
 * Una fila `en_curso` más antigua que esto quedó abandonada y cuenta como incierta.
 * SINCRONIZADA con `MINUTOS_EN_CURSO_ABANDONADA` de `server/sii/operacion.ts`.
 */
export const MINUTOS_EN_CURSO_ABANDONADA = 15;

function abandonada(o: Pick<OperacionFolios, 'resultado' | 'iniciadaEn'>, ahora: Date): boolean {
  return (
    o.resultado === 'en_curso' &&
    ahora.getTime() - new Date(o.iniciadaEn).getTime() > MINUTOS_EN_CURSO_ABANDONADA * 60_000
  );
}

/** Solicitud confirmada en curso (no abandonada) de un ambiente, la más reciente. */
export function enCurso(
  operaciones: readonly OperacionFolios[],
  ambiente: AmbienteSii,
  ahora: Date = new Date(),
): OperacionFolios | null {
  return (
    operaciones.find(
      (o) => o.ambiente === ambiente && o.resultado === 'en_curso' && !abandonada(o, ahora),
    ) ?? null
  );
}

export interface InciertaFolios {
  operacion: OperacionFolios;
  /** La solicitud de la operación, con el rango si el SII lo alcanzó a fijar. */
  solicitud: FilaSolicitud | null;
}

/**
 * La solicitud confirmada que bloquea repetir en un ambiente: la última que llegó al SII
 * (como `ejecutarOperacion`: se saltan `uso` y `config`) si quedó incierta o abandonada y
 * nadie la marcó como revisada.
 */
export function inciertaSinRevisar(
  vista: Pick<VistaFolios, 'operaciones' | 'solicitudes'>,
  ambiente: AmbienteSii,
  ahora: Date = new Date(),
): InciertaFolios | null {
  const ultima = vista.operaciones.find(
    (o) => o.ambiente === ambiente && o.resultado !== 'uso' && o.resultado !== 'config',
  );
  if (!ultima || ultima.revisada) return null;
  if (ultima.resultado !== 'incierto' && !abandonada(ultima, ahora)) return null;
  return {
    operacion: ultima,
    solicitud: vista.solicitudes.find((s) => s.id === ultima.solicitudId) ?? null,
  };
}

/** Rango de una solicitud incierta, para la guía («los folios 21 a 40»). */
export function rangoIncierta(i: InciertaFolios): string | null {
  const s = i.solicitud;
  return s && s.desde !== null && s.hasta !== null ? textoRango(s.desde, s.hasta) : null;
}

/** Por qué no se pueden pedir folios en un ambiente ahora, o `null`. El primero que aplique. */
export function bloqueoSolicitud(
  vista: VistaFolios,
  ambiente: AmbienteSii,
  ahora: Date = new Date(),
): string | null {
  if (!vista.empresa.activa) return 'La empresa está desactivada. Actívala en Configuración.';
  if (ambiente === 'produccion' && !vista.empresa.autorizadaProduccion) {
    return 'La empresa aún no está autorizada en producción: termina su certificación o registra su resolución de producción.';
  }
  if (ambiente === 'produccion' && vista.planPermiteProduccion === false) {
    return 'El plan vigente no incluye producción.';
  }
  if (!vista.representante) {
    return 'Falta el certificado de un representante electrónico de la empresa.';
  }
  if (enCurso(vista.operaciones, ambiente, ahora)) {
    return 'Hay una solicitud de folios en curso en este ambiente: espera a que termine.';
  }
  if (inciertaSinRevisar(vista, ambiente, ahora)) {
    return 'Hay una solicitud por verificar en este ambiente: revísala en el SII antes de pedir más.';
  }
  return null;
}

export type TonoEstado = 'exito' | 'info' | 'aviso' | 'error';

export const TONO_SOLICITUD: Readonly<Record<EstadoSolicitudFolios, TonoEstado>> = {
  en_curso: 'info',
  simulada: 'info',
  timbrada: 'exito',
  incierta: 'aviso',
  rechazada: 'error',
  error: 'error',
};

export const TONO_CAF: Readonly<Record<EstadoCaf, TonoEstado>> = {
  activo: 'exito',
  agotado: 'info',
  anulado: 'aviso',
};
