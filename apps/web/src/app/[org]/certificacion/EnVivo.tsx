'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clienteNavegador } from '@/lib/supabase/navegador';
import estilos from './certificacion.module.css';

/** Espera para juntar varios cambios seguidos (fila de operación + proceso) en un refresh. */
const ESPERA_MS = 400;

/**
 * Escucha por Realtime los cambios de `procesos_certificacion` y `operaciones_sii` de la
 * empresa y vuelve a pedir la página al servidor (`router.refresh()`), que lee con RLS.
 * No guarda las filas: la fuente de verdad es el RSC. RLS limita lo que llega a las
 * filas de las organizaciones del usuario; el filtro por `empresa_id` reduce el tráfico.
 */
export function EnVivo({ empresaId }: { empresaId: string }) {
  const router = useRouter();
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
    const filtro = `empresa_id=eq.${empresaId}`;
    let suscritoAntes = false;

    const canal = supabase
      .channel(`certificacion:${empresaId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'procesos_certificacion', filter: filtro },
        refrescar,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'operaciones_sii', filter: filtro },
        refrescar,
      )
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          setDesconectado(false);
          // Al reconectar, trae lo que cambió mientras el canal estuvo caído.
          if (suscritoAntes) refrescar();
          suscritoAntes = true;
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
          setDesconectado(true);
        }
      });

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void supabase.removeChannel(canal);
    };
  }, [empresaId, router]);

  if (!desconectado) return null;
  return (
    <p className={estilos.nota}>
      No pudimos conectar la actualización en vivo. Recarga la página para ver el estado más
      reciente.
    </p>
  );
}
