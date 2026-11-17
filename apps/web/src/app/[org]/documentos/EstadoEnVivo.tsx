'use client';

import { EstadoDTE } from '@/components/boleteame';
import type { ClasificacionEnvio } from '@/lib/seguimiento';
import {
  type EstadoDocumentoBd,
  estadoDeEnvio,
  estadoUi,
  textoEstadoSii,
} from '@/server/documentos/presentacion';
import { envioVigente, estadoVigente } from '@/stores/enVivo';
import { useEnVivoStore } from '@/stores/ProveedorEnVivo';

// Badges `EstadoDTE` que cambian solos (PLAN-SAAS Fase 8, punto 5): muestran el estado más
// nuevo entre el que trajo el servidor y el que llegó por Realtime (`useEnVivoStore`).

export function EstadoDocumentoEnVivo({
  id,
  estado,
  actualizadoEn,
  detalle,
}: {
  id: string;
  estado: EstadoDocumentoBd;
  actualizadoEn: string;
  detalle?: string;
}) {
  const enVivo = useEnVivoStore((s) => s.documentos[id]);
  return (
    <EstadoDTE
      estado={estadoUi(estadoVigente({ estado, actualizadoEn }, enVivo))}
      detalle={detalle}
    />
  );
}

export interface EnvioParaEstado {
  id: string;
  clasificacion: ClasificacionEnvio | null;
  incierto: boolean;
  trackId: string | null;
  estadoSii: string | null;
  glosaSii: string | null;
  actualizadoEn: string;
}

/** El envío vigente (servidor o Realtime) para quien lo necesite completo. */
export function useEnvioVigente<T extends EnvioParaEstado>(envio: T): T;
export function useEnvioVigente<T extends EnvioParaEstado>(envio: T | null): T | null;
export function useEnvioVigente<T extends EnvioParaEstado>(envio: T | null): T | null {
  const enVivo = useEnVivoStore((s) => (envio ? s.envios[envio.id] : undefined));
  return envio ? envioVigente(envio, enVivo) : null;
}

export function EstadoEnvioEnVivo({ envio }: { envio: EnvioParaEstado }) {
  const vigente = useEnvioVigente(envio);
  return (
    <EstadoDTE
      estado={estadoDeEnvio(vigente)}
      detalle={textoEstadoSii(vigente.estadoSii, vigente.glosaSii) ?? undefined}
    />
  );
}
