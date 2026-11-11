import { X } from 'lucide-react';
import Link from 'next/link';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { Boton, clasesBoton } from './Boton';
import estilos from './PanelDetalle.module.css';

export interface PanelDetalleProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Cierre por URL (p. ej. quitar `?doc=`): sirve desde un Server Component. */
  hrefCerrar?: string;
  /** Cierre en un componente cliente (estado local). */
  onCerrar?: () => void;
}

const ETIQUETA_CERRAR = 'Cerrar detalle';

/**
 * Panel de detalle a la derecha de «Documentos emitidos»: aspecto de `Tarjeta`,
 * relleno 20px y separación 16px. Nómbralo con `aria-labelledby` (id de su título).
 */
export function PanelDetalle({
  children,
  hrefCerrar,
  onCerrar,
  className,
  ...resto
}: PanelDetalleProps): ReactElement {
  const icono = <X size={16} strokeWidth={1.5} aria-hidden="true" focusable="false" />;
  const conCierre = Boolean(hrefCerrar || onCerrar);
  return (
    <section
      {...resto}
      className={[estilos.panel, conCierre && estilos.conCierre, className]
        .filter(Boolean)
        .join(' ')}
    >
      {onCerrar ? (
        <Boton
          variante="discreto"
          tamano="sm"
          className={estilos.cerrar}
          onClick={onCerrar}
          aria-label={ETIQUETA_CERRAR}
          icono={icono}
        />
      ) : hrefCerrar ? (
        <Link
          href={hrefCerrar}
          scroll={false}
          className={clasesBoton('discreto', 'sm', estilos.cerrar)}
          aria-label={ETIQUETA_CERRAR}
        >
          {icono}
        </Link>
      ) : null}
      {children}
    </section>
  );
}
