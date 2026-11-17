'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { type DocumentoFila, TablaDTE } from '@/components/boleteame';
import type { FilaDocumento } from '@/server/documentos/lectura';
import { estadoUi } from '@/server/documentos/presentacion';
import { esMasNuevo } from '@/stores/enVivo';
import { useEnVivoStore } from '@/stores/ProveedorEnVivo';

// `TablaDTE` de «Documentos emitidos». Elegir una fila abre el panel de detalle con
// `?doc=<id>` (la URL manda: se puede copiar o volver atrás). Los estados se sobrescriben
// con lo que llegue por Realtime si es más nuevo que lo que trajo el servidor.

export function ListaDocumentos({
  filas,
  seleccionado,
  hrefBase,
  vacio,
  titulo,
}: {
  filas: FilaDocumento[];
  seleccionado: string | null;
  /** URL de la lista con los filtros, sin `doc`. */
  hrefBase: string;
  vacio: string;
  titulo: string;
}) {
  const router = useRouter();
  const enVivo = useEnVivoStore((s) => s.documentos);

  const documentos = useMemo<DocumentoFila[]>(
    () =>
      filas.map((f) => {
        const c = enVivo[f.id];
        return {
          id: f.id,
          tipo: f.tipo,
          folio: f.folio,
          receptor: f.receptor,
          rut: f.rut,
          fecha: f.fecha,
          total: f.total,
          estado: c && esMasNuevo(c.actualizadoEn, f.actualizadoEn) ? estadoUi(c.estado) : f.estado,
        };
      }),
    [filas, enVivo],
  );

  function seleccionar(id: string) {
    const separador = hrefBase.includes('?') ? '&' : '?';
    router.push(`${hrefBase}${separador}doc=${encodeURIComponent(id)}`, { scroll: false });
  }

  return (
    <TablaDTE
      titulo={titulo}
      documentos={documentos}
      seleccionado={seleccionado}
      onSeleccionar={seleccionar}
      vacio={vacio}
    />
  );
}
