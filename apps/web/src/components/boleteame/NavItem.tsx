import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import estilos from './NavItem.module.css';

export interface NavItemProps {
  href: string;
  /** Ícono Lucide; se dibuja a 20px con trazo 1,5. */
  icono?: LucideIcon;
  /** Sección actual: estilo activo y `aria-current="page"`. */
  activo?: boolean;
  children: ReactNode;
  className?: string;
}

/** Enlace del menú lateral (`.tb-nav-item`). Quien lo usa decide cuál está activo. */
export function NavItem({
  href,
  icono: Icono,
  activo,
  children,
  className,
}: NavItemProps): ReactElement {
  return (
    <Link
      href={href}
      aria-current={activo ? 'page' : undefined}
      className={[estilos.item, activo && estilos.activo, className].filter(Boolean).join(' ')}
    >
      {Icono ? <Icono size={20} strokeWidth={1.5} aria-hidden="true" focusable="false" /> : null}
      <span>{children}</span>
    </Link>
  );
}
