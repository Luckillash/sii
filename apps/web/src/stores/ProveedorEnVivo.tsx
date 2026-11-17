'use client';

import { createContext, type ReactNode, use, useState } from 'react';
import { useStore } from 'zustand';
import { crearStoreEnVivo, type EstadoEnVivo, type StoreEnVivo } from './enVivo';

// Provider de `useEnVivoStore` (PLAN-SAAS §4.3): un store por montaje, creado con
// `useState`. Lo llena `EnVivo` (`app/[org]/documentos/EnVivo.tsx`) con los eventos de
// Realtime; lo leen los badges de estado de la lista, el panel y la página del envío.

const Contexto = createContext<StoreEnVivo | null>(null);

export function ProveedorEnVivo({ children }: { children: ReactNode }) {
  const [store] = useState(crearStoreEnVivo);
  return <Contexto value={store}>{children}</Contexto>;
}

/**
 * Lee el store en vivo. Fuera de un `ProveedorEnVivo` usa uno propio y vacío: el
 * componente muestra lo del servidor, sin romperse.
 */
export function useEnVivoStore<T>(selector: (s: EstadoEnVivo) => T): T {
  const contexto = use(Contexto);
  const [propio] = useState(() => (contexto ? null : crearStoreEnVivo()));
  return useStore((contexto ?? propio) as StoreEnVivo, selector);
}
