import type {
  ReactElement,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import estilos from './Tabla.module.css';

export interface TablaProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Va como `<caption>` (17px, 600). */
  titulo?: ReactNode;
  /**
   * Nombre de la zona desplazable. Con él, el marco es una región enfocable para
   * desplazarla con el teclado cuando la tabla no cabe (p. ej. a 375px).
   */
  etiqueta?: string;
  /** Clase del marco (borde, sombra, desplazamiento horizontal). */
  classNameMarco?: string;
}

/**
 * Tabla de datos con el aspecto de TablaDTE (`.tb-tabla-marco` + `.tb-tabla`).
 * Se compone con `thead`/`tbody`/`tr` nativos y `Th`/`Td` (o `th`/`td` tal cual).
 */
export function Tabla({
  titulo,
  etiqueta,
  classNameMarco,
  className,
  children,
  ...resto
}: TablaProps): ReactElement {
  return (
    <div
      className={[estilos.marco, classNameMarco].filter(Boolean).join(' ')}
      {...(etiqueta ? { role: 'region', 'aria-label': etiqueta, tabIndex: 0 } : {})}
    >
      <table {...resto} className={[estilos.tabla, className].filter(Boolean).join(' ')}>
        {titulo ? <caption>{titulo}</caption> : null}
        {children}
      </table>
    </div>
  );
}

interface Celda {
  /** Alineada a la derecha (montos, cantidades). */
  num?: boolean;
  /** IBM Plex Mono 13px con cifras tabulares (folios, RUT, Track ID). */
  mono?: boolean;
}

function clases(c: Celda, className?: string): string | undefined {
  return (
    [c.num && estilos.num, c.mono && estilos.mono, className].filter(Boolean).join(' ') || undefined
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement>, Celda {}

/** Encabezado de columna; `scope="col"` por defecto. */
export function Th({ num, mono, className, scope = 'col', ...resto }: ThProps): ReactElement {
  return <th {...resto} scope={scope} className={clases({ num, mono }, className)} />;
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement>, Celda {}

export function Td({ num, mono, className, ...resto }: TdProps): ReactElement {
  return <td {...resto} className={clases({ num, mono }, className)} />;
}

export interface TablaVaciaProps {
  /** Cantidad de columnas que cubre la fila. */
  columnas: number;
  children: ReactNode;
}

/** Fila única para cuando no hay datos: qué pasa y qué hacer. */
export function TablaVacia({ columnas, children }: TablaVaciaProps): ReactElement {
  return (
    <tr>
      <td colSpan={columnas} className={estilos.vacia}>
        {children}
      </td>
    </tr>
  );
}
