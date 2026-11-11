import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { formatearRut } from '@/lib/formatos';
import estilos from './LayoutApp.module.css';
import { NavItem } from './NavItem';
import {
  type BanderaFuncion,
  type ClaveNavegacion,
  hrefNavegacion,
  navegacionVisible,
} from './navegacion';

export interface EmpresaActiva {
  razonSocial: string;
  /** En cualquier formato; se muestra como `76.354.771-K`. */
  rut: string;
}

export interface UsuarioActivo {
  nombre: string;
  /** Tal como se muestra («Administradora», «Emisor»). */
  rol: string;
}

export interface LayoutAppProps {
  /** Slug de la organización (`/[org]/…`). */
  org: string;
  /** Sección actual del menú. */
  activo?: ClaveNavegacion;
  empresa?: EmpresaActiva;
  /** Reemplaza la tarjeta de empresa (p. ej. el futuro selector de empresa). */
  selectorEmpresa?: ReactNode;
  usuario?: UsuarioActivo;
  /** Primero dentro de `main`; aquí va `<BannerAmbiente>`. */
  aviso?: ReactNode;
  /** Enciende ítems ocultos por bandera (Fase 14). */
  banderas?: Partial<Record<BanderaFuncion, boolean>>;
  children: ReactNode;
}

const ID_CONTENIDO = 'contenido';

/** Armazón de la app autenticada: menú lateral + `main`, como Tablero y Documentos. */
export function LayoutApp({
  org,
  activo,
  empresa,
  selectorEmpresa,
  usuario,
  aviso,
  banderas,
  children,
}: LayoutAppProps): ReactElement {
  const items = navegacionVisible(banderas);
  return (
    <div className={estilos.app}>
      <a href={`#${ID_CONTENIDO}`} className={estilos.saltar}>
        Ir al contenido
      </a>
      <aside className={estilos.lateral} aria-label="Menú lateral">
        <Link href={hrefNavegacion(org, { ruta: 'tablero' })} className={estilos.marca}>
          Timbre
        </Link>

        {selectorEmpresa ??
          (empresa ? (
            <div className={estilos.empresa}>
              <span className={estilos.razonSocial}>{empresa.razonSocial}</span>
              <span className={estilos.rut}>{formatearRut(empresa.rut)}</span>
            </div>
          ) : null)}

        <nav aria-label="Aplicación">
          <ul className={estilos.menu}>
            {items.map((item) => (
              <li key={item.clave}>
                <NavItem
                  href={hrefNavegacion(org, item)}
                  icono={item.icono}
                  activo={item.clave === activo}
                >
                  {item.etiqueta}
                </NavItem>
              </li>
            ))}
          </ul>
        </nav>

        {usuario ? (
          <div className={estilos.usuario}>
            <span className={estilos.nombre}>{usuario.nombre}</span>
            <span className={estilos.rol}>{usuario.rol}</span>
          </div>
        ) : null}
      </aside>

      <main id={ID_CONTENIDO} tabIndex={-1} className={estilos.principal}>
        {aviso}
        {children}
      </main>
    </div>
  );
}
