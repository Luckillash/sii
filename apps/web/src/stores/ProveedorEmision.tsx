'use client';

import { createContext, type ReactNode, use, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Borrador, Totales } from '@/lib/emision';
import type { AmbienteSii } from '@/lib/folios';
import {
  almacenSesion,
  crearStoreEmision,
  datosIniciales,
  datosVacios,
  desdeBorrador,
  type EstadoEmision,
  leerGuardado,
  persistir,
  type StoreEmision,
  totalesDe,
} from './emision';

// Provider de `useEmisionStore` (PLAN-SAAS §4.3): un store por montaje, creado con
// `useState` (nunca un singleton de módulo). En el servidor y en el primer render del
// navegador parte del borrador pedido con `?borrador=<id>` o del formulario vacío (así el
// HTML calza al hidratar); después, en un efecto, toma lo guardado en `sessionStorage` y
// empieza a guardar cada cambio.

const Contexto = createContext<StoreEmision | null>(null);

export interface ProveedorEmisionProps {
  /** `claveSesion(organizacionId, empresaId)`. */
  clave: string;
  /** Ambiente de un formulario nuevo (el primero habilitado). */
  ambiente: AmbienteSii;
  /** El borrador pedido con `?borrador=<id>`, si existe. */
  borrador: { id: string; datos: Borrador } | null;
  /** Ids de los borradores de la empresa (para soltar uno de la sesión que ya no existe). */
  borradoresIds: readonly string[];
  children: ReactNode;
}

export function ProveedorEmision({
  clave,
  ambiente,
  borrador,
  borradoresIds,
  children,
}: ProveedorEmisionProps) {
  const [store] = useState(() =>
    crearStoreEmision(
      borrador ? desdeBorrador(borrador.datos, borrador.id) : datosVacios(ambiente),
    ),
  );

  // Últimos valores para el efecto de montaje, sin volver a correrlo.
  const inicial = useRef({ borrador, borradoresIds, ambiente });

  useEffect(() => {
    const almacen = almacenSesion();
    const { borrador: b, borradoresIds: ids, ambiente: a } = inicial.current;
    store.getState().reemplazar(
      datosIniciales({
        guardado: leerGuardado(almacen, clave),
        servidor: b,
        borradoresIds: ids,
        ambiente: a,
      }),
    );
    return persistir(store, almacen, clave);
  }, [store, clave]);

  // «Retomar» otro borrador navega a `?borrador=<id>` sin volver a montar el formulario.
  // Solo cuando cambia el id pedido: `borrador` es un objeto nuevo en cada render del
  // servidor (p. ej. tras un `revalidatePath`) y no debe pisar lo que se está escribiendo.
  const idPedido = borrador?.id ?? null;
  const ultimo = useRef(borrador);
  useEffect(() => {
    ultimo.current = borrador;
  });
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const b = ultimo.current;
    if (idPedido && b?.id === idPedido && store.getState().borradorId !== idPedido) {
      store.getState().cargar(b.datos, idPedido);
    }
  }, [idPedido, store]);

  return <Contexto value={store}>{children}</Contexto>;
}

/** El store del formulario (para leer el estado actual en un manejador). */
export function useStoreEmision(): StoreEmision {
  const store = use(Contexto);
  if (!store) throw new Error('useEmisionStore fuera de <ProveedorEmision>');
  return store;
}

/** `useEmisionStore(selector)`: el selector debe devolver un valor estable (no un objeto nuevo). */
export function useEmisionStore<T>(selector: (s: EstadoEmision) => T): T {
  return useStore(useStoreEmision(), selector);
}

/** Totales derivados del borrador, con la misma cuenta que la librería. */
export function useTotalesEmision(): Totales {
  const lineas = useEmisionStore((s) => s.lineas);
  const descuento = useEmisionStore((s) => s.descuento);
  return useMemo(() => totalesDe({ lineas, descuento }), [lineas, descuento]);
}
