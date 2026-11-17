'use client';

import { useEffect } from 'react';

/**
 * Lleva el foco (y la vista, en pantallas angostas donde el panel queda bajo la tabla) al
 * elemento `id` al montarse. Con `key` = id del documento, corre cada vez que se abre otro
 * y no cuando el panel solo se refresca por Realtime.
 */
export function Enfocar({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [id]);
  return null;
}
