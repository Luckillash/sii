'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clienteNavegador } from '@/lib/supabase/navegador';
import { filtrosRealtime } from '@/stores/enVivo';
import { useEnVivoStore } from '@/stores/ProveedorEnVivo';
import estilos from './documentos.module.css';

/** Espera para juntar varios cambios seguidos (envío + sus documentos) en un refresh. */
const ESPERA_MS = 400;

/**
 * Realtime de `documentos` y `envios` (las dos están en `supabase_realtime`), filtrado
 * por organización (RLS además limita lo que llega a las organizaciones del usuario).
 * Cada evento hace dos cosas:
 *
 *   1. Guarda el estado nuevo en `useEnVivoStore`: el badge cambia en cuanto llega,
 *      sin esperar al servidor.
 *   2. Pide un `router.refresh()` (con espera, para juntar ráfagas) que vuelve a leer la
 *      página con RLS y trae lo demás: glosa, rechazos, bitácora, filas nuevas.
 *
 * Así «un envío pasa de enviado a aceptado sin recargar» aunque uno de los dos caminos
 * falle. Al reconectar se refresca para traer lo que cambió mientras el canal cayó.
 * Mismo patrón que `folios/EnVivo.tsx`.
 */
export function EnVivo({
  organizacionId,
  canal,
  envioId,
}: {
  organizacionId: string;
  canal: string;
  /** En la página de un envío: solo ese envío y sus documentos (no toda la organización). */
  envioId?: string;
}) {
  const router = useRouter();
  const aplicarDocumento = useEnVivoStore((s) => s.aplicarDocumento);
  const aplicarEnvio = useEnVivoStore((s) => s.aplicarEnvio);
  const [desconectado, setDesconectado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase: ReturnType<typeof clienteNavegador>;
    try {
      supabase = clienteNavegador();
    } catch {
      setDesconectado(true);
      return;
    }

    const refrescar = () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => router.refresh(), ESPERA_MS);
    };
    const filtro = filtrosRealtime(organizacionId, envioId);
    let suscritoAntes = false;

    const suscripcion = supabase
      .channel(`${canal}:${envioId ?? organizacionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documentos', filter: filtro.documentos },
        (p) => {
          if (p.eventType !== 'DELETE') aplicarDocumento(p.new);
          refrescar();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'envios', filter: filtro.envios },
        (p) => {
          if (p.eventType !== 'DELETE') aplicarEnvio(p.new);
          refrescar();
        },
      )
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          setDesconectado(false);
          if (suscritoAntes) refrescar();
          suscritoAntes = true;
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
          setDesconectado(true);
        }
      });

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void supabase.removeChannel(suscripcion);
    };
  }, [organizacionId, canal, envioId, router, aplicarDocumento, aplicarEnvio]);

  if (!desconectado) return null;
  return (
    <p className={estilos.nota} role="status">
      No pudimos conectar la actualización en vivo. Recarga la página para ver el estado más
      reciente.
    </p>
  );
}
