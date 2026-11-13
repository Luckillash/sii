'use client';

import { useEffect } from 'react';
import { Alerta } from '@/components/boleteame';

// Aviso que se ve una sola vez tras crear la empresa (`crearEmpresa` redirige con
// `?creada=1`). Al montarse quita el parámetro con `history.replaceState`, que Next
// integra en su router: el siguiente render del servidor (p. ej. tras guardar la
// edición, por revalidatePath) ya no lo recibe y el aviso desaparece; al recargar,
// tampoco vuelve.

export function AvisoEmpresaCreada() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('creada')) return;
    url.searchParams.delete('creada');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <Alerta tono="exito" titulo="Agregaste la empresa">
      Ahora registra su resolución del SII y asocia el certificado digital que firmará sus
      documentos.
    </Alerta>
  );
}
