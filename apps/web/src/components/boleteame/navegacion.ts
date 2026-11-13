// Menú lateral de la app autenticada (`LayoutApp`). Sin JSX: se puede importar
// desde el servidor y desde el cliente.

import {
  BookOpen,
  FilePlusCorner,
  FileText,
  Hash,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

/** Funciones aún sin respaldo en la librería ni en el esquema (H2). */
export type BanderaFuncion = 'dteRecibidos' | 'libroComprasVentas';

/** Apagadas hasta la Fase 14 (facturas, recibidos y Libro de Compras y Ventas). */
export const BANDERAS_POR_DEFECTO: Readonly<Record<BanderaFuncion, boolean>> = {
  dteRecibidos: false,
  libroComprasVentas: false,
};

export type ClaveNavegacion =
  | 'tablero'
  | 'emitir'
  | 'documentos'
  | 'recibidos'
  | 'libro'
  | 'folios'
  | 'certificacion'
  | 'configuracion';

export interface ItemNavegacion {
  clave: ClaveNavegacion;
  etiqueta: string;
  /** Segmento bajo `/[org]/`. */
  ruta: string;
  icono: LucideIcon;
  /** Si existe, el ítem solo se muestra con esa bandera encendida. */
  bandera?: BanderaFuncion;
}

export const NAVEGACION: readonly ItemNavegacion[] = [
  { clave: 'tablero', etiqueta: 'Tablero', ruta: 'tablero', icono: LayoutDashboard },
  // FilePlusCorner es el antiguo FilePlus2 de Lucide.
  { clave: 'emitir', etiqueta: 'Emitir documento', ruta: 'emitir', icono: FilePlusCorner },
  { clave: 'documentos', etiqueta: 'Documentos emitidos', ruta: 'documentos', icono: FileText },
  {
    clave: 'recibidos',
    etiqueta: 'Documentos recibidos',
    ruta: 'recibidos',
    icono: Inbox,
    bandera: 'dteRecibidos',
  },
  {
    clave: 'libro',
    etiqueta: 'Libro de Compras y Ventas',
    ruta: 'libro',
    icono: BookOpen,
    bandera: 'libroComprasVentas',
  },
  { clave: 'folios', etiqueta: 'Folios (CAF)', ruta: 'folios', icono: Hash },
  { clave: 'certificacion', etiqueta: 'Certificación', ruta: 'certificacion', icono: ShieldCheck },
  {
    clave: 'configuracion',
    etiqueta: 'Configuración',
    ruta: 'configuracion',
    icono: SlidersHorizontal,
  },
];

export function hrefNavegacion(org: string, item: Pick<ItemNavegacion, 'ruta'>): string {
  return `/${encodeURIComponent(org)}/${item.ruta}`;
}

/** Ítems visibles según las banderas (las que no se pasan toman el valor por defecto). */
export function navegacionVisible(
  banderas: Partial<Record<BanderaFuncion, boolean>> = {},
): ItemNavegacion[] {
  const activas = { ...BANDERAS_POR_DEFECTO, ...banderas };
  return NAVEGACION.filter((item) => !item.bandera || activas[item.bandera]);
}
