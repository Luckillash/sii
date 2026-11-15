'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clienteNavegador } from '@/lib/supabase/navegador';
import estilos from './folios.module.css';

/** Espera para juntar varios cambios seguidos (operación + solicitud + CAF) en un refresh. */
const ESPERA_MS = 400;

/**
 * Escucha por Realtime los cambios de `solicitudes_folios` y `operaciones_sii` (0006) y de
 * `cafs` y `folios_anulados` (0011) y vuelve a pedir la página al servidor
 * (`router.refresh()`), que lee con RLS. No guarda las filas: la fuente de verdad es el
 * RSC. RLS limita lo que llega a las organizaciones del usuario; los filtros reducen el
 * tráfico: por empresa, salvo `folios_anulados` (no tiene `empresa_id`), por organización.
 * Así también se ve lo que cambia otra persona o la emisión (`asignar_folio` mueve
 * `siguiente_folio`).
 */
export function EnVivo({
  empresaId,
  organizacionId,
}: {
  empresaId: string;
  organizacionId: string;
}) {
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
    const porEmpresa = `empresa_id=eq.${empresaId}`;
    const porOrganizacion = `organizacion_id=eq.${organizacionId}`;
    let suscritoAntes = false;

    let canal = supabase.channel(`folios:${empresaId}`);
    for (const [tabla, filtro] of [
      ['solicitudes_folios', porEmpresa],
      ['operaciones_sii', porEmpresa],
      ['cafs', porEmpresa],
      ['folios_anulados', porOrganizacion],
    ] as const) {
      canal = canal.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla, filter: filtro },
        refrescar,
      );
    }
    canal.subscribe((estado) => {
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
  }, [empresaId, organizacionId, router]);

  if (!desconectado) return null;
  return (
    <p className={estilos.nota}>
      No pudimos conectar la actualización en vivo. Recarga la página para ver el estado más
      reciente.
    </p>
  );
}
