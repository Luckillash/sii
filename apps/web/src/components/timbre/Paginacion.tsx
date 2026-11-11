import Link from 'next/link';
import type { ReactElement } from 'react';
import { formatearMiles } from '@/lib/formatos';
import { Boton, clasesBoton } from './Boton';
import estilos from './Paginacion.module.css';

export interface PaginacionProps {
  /** Página actual, desde 1. Se ajusta al rango válido. */
  pagina: number;
  porPagina: number;
  total: number;
  /** URL de la página `n` (p. ej. con `?pagina=n` y los filtros actuales). */
  hrefPagina: (n: number) => string;
  /** Nombre del `nav`; por defecto «Paginación». */
  etiqueta?: string;
  className?: string;
}

/** «Mostrando 1–8 de 128» + Anterior / Siguiente, con enlaces (paginación en el servidor). */
export function Paginacion({
  pagina,
  porPagina,
  total,
  hrefPagina,
  etiqueta = 'Paginación',
  className,
}: PaginacionProps): ReactElement {
  const tamano = Math.max(1, Math.trunc(porPagina) || 1);
  const cantidad = Math.max(0, Math.trunc(total) || 0);
  const ultima = Math.max(1, Math.ceil(cantidad / tamano));
  const actual = Math.min(Math.max(1, Math.trunc(pagina) || 1), ultima);
  const desde = cantidad === 0 ? 0 : (actual - 1) * tamano + 1;
  const hasta = Math.min(actual * tamano, cantidad);

  const resumen =
    cantidad === 0
      ? 'Sin resultados'
      : `Mostrando ${formatearMiles(desde)}–${formatearMiles(hasta)} de ${formatearMiles(cantidad)}`;

  return (
    <nav
      aria-label={etiqueta}
      className={[estilos.paginacion, className].filter(Boolean).join(' ')}
    >
      <p className={estilos.resumen}>{resumen}</p>
      <div className={estilos.botones}>
        {actual > 1 ? (
          <Link
            href={hrefPagina(actual - 1)}
            rel="prev"
            className={clasesBoton('secundario', 'sm')}
          >
            Anterior
          </Link>
        ) : (
          <Boton tamano="sm" disabled>
            Anterior
          </Boton>
        )}
        {actual < ultima ? (
          <Link
            href={hrefPagina(actual + 1)}
            rel="next"
            className={clasesBoton('secundario', 'sm')}
          >
            Siguiente
          </Link>
        ) : (
          <Boton tamano="sm" disabled>
            Siguiente
          </Boton>
        )}
      </div>
    </nav>
  );
}
