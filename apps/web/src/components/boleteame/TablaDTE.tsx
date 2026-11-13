'use client';

import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { formatearMiles, formatearRut } from '@/lib/formatos';
import { EstadoDTE } from './EstadoDTE';
import { Monto } from './Monto';
import estilos from './TablaDTE.module.css';
import { TipoDTE } from './TipoDTE';
import type { DocumentoFila } from './tipos';

export interface TablaDTEProps {
  documentos: DocumentoFila[];
  titulo?: string;
  seleccionado?: string | null;
  onSeleccionar?: (id: string) => void;
  vacio?: ReactNode;
  className?: string;
}

const ENCABEZADOS = ['Tipo', 'Folio', 'Receptor', 'Emisión', 'Total', 'Estado'] as const;
const COLUMNA_TOTAL = 4;

export function TablaDTE({
  documentos,
  titulo,
  seleccionado,
  onSeleccionar,
  vacio,
  className,
}: TablaDTEProps): ReactElement {
  const docs = documentos ?? [];
  return (
    <div className={[estilos.marco, className].filter(Boolean).join(' ')}>
      <table className={estilos.tabla}>
        {titulo ? <caption>{titulo}</caption> : null}
        <thead>
          <tr>
            {ENCABEZADOS.map((t, i) => (
              <th key={t} scope="col" className={i === COLUMNA_TOTAL ? estilos.num : undefined}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 ? (
            <tr>
              <td colSpan={ENCABEZADOS.length} className={estilos.vacia}>
                {vacio || 'Aún no hay documentos emitidos en este período.'}
              </td>
            </tr>
          ) : (
            docs.map((d) => {
              const activo = seleccionado != null && seleccionado === d.id;
              const clases = [activo && estilos.filaActiva, onSeleccionar && estilos.filaClic]
                .filter(Boolean)
                .join(' ');
              const seleccionar = onSeleccionar ? () => onSeleccionar(d.id) : undefined;
              const teclado = onSeleccionar
                ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSeleccionar(d.id);
                    }
                  }
                : undefined;
              return (
                <tr
                  key={d.id}
                  className={clases || undefined}
                  aria-selected={onSeleccionar ? activo : undefined}
                  tabIndex={onSeleccionar ? 0 : undefined}
                  onClick={seleccionar}
                  onKeyDown={teclado}
                >
                  <td>
                    <TipoDTE codigo={d.tipo} corto />
                  </td>
                  <td className={estilos.mono}>{formatearMiles(d.folio)}</td>
                  <td>
                    <div className={estilos.receptor}>{d.receptor}</div>
                    <div className={estilos.rut}>{formatearRut(d.rut)}</div>
                  </td>
                  <td className={estilos.fecha}>{d.fecha}</td>
                  <td className={estilos.num}>
                    <Monto valor={d.total} moneda={d.moneda} />
                  </td>
                  <td>
                    <EstadoDTE estado={d.estado} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
