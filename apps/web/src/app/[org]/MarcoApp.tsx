'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  type ClaveNavegacion,
  LayoutApp,
  NAVEGACION,
  type UsuarioActivo,
} from '@/components/boleteame';

// `LayoutApp` necesita saber qué sección está activa, y un layout de servidor no lo sabe
// (no se vuelve a renderizar al navegar). Este envoltorio cliente lo toma del primer
// segmento bajo /[org] con `useSelectedLayoutSegment()`.

export interface MarcoAppProps {
  org: string;
  usuario: UsuarioActivo;
  selectorOrganizacion: ReactNode;
  aviso: ReactNode;
  children: ReactNode;
}

// Secciones sin ítem propio en el menú que pertenecen a otra: `/envios/[id]` se abre
// desde el Track ID de un documento, así que marca «Documentos emitidos».
const SECCION_PADRE: Readonly<Record<string, string>> = { envios: 'documentos' };

function claveActiva(segmento: string | null): ClaveNavegacion | undefined {
  const ruta = segmento ? (SECCION_PADRE[segmento] ?? segmento) : segmento;
  return NAVEGACION.find((item) => item.ruta === ruta)?.clave;
}

export function MarcoApp({ org, usuario, selectorOrganizacion, aviso, children }: MarcoAppProps) {
  const segmento = useSelectedLayoutSegment();
  return (
    <LayoutApp
      org={org}
      activo={claveActiva(segmento)}
      usuario={usuario}
      selectorEmpresa={selectorOrganizacion}
      aviso={aviso}
    >
      {children}
    </LayoutApp>
  );
}
