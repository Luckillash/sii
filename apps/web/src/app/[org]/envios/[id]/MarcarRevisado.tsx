'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Alerta, Boton, Dialogo } from '@/components/boleteame';
import type { MensajeError } from '@/lib/equipo-errores';
import { marcarRevisado } from '../../documentos/acciones';

// «Ya lo revisé» de un envío incierto (PLAN-SAAS Fase 8, punto 2), con confirmación: no
// reintenta nada, solo deja constancia de que se revisó en el SII y saca el envío de la
// alerta del Tablero.

export function MarcarRevisado({ slug, envioId }: { slug: string; envioId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: MensajeError } | null>(null);
  const corriendo = useRef(false);

  function confirmar() {
    if (corriendo.current) return;
    corriendo.current = true;
    setCargando(true);
    marcarRevisado(slug, envioId)
      .then((r) => {
        setResultado(r);
        if (r.ok) router.refresh();
      })
      .catch(() =>
        setResultado({
          ok: false,
          mensaje: {
            titulo: 'No pudimos marcar el envío como revisado',
            detalle: 'Revisa tu conexión y vuelve a intentarlo.',
          },
        }),
      )
      .finally(() => {
        corriendo.current = false;
        setCargando(false);
        setAbierto(false);
      });
  }

  return (
    <>
      <div>
        <Boton
          tamano="sm"
          onClick={() => {
            setResultado(null);
            setAbierto(true);
          }}
        >
          Ya lo revisé
        </Boton>
      </div>
      {resultado ? (
        <Alerta tono={resultado.ok ? 'exito' : 'error'} titulo={resultado.mensaje.titulo}>
          <p>{resultado.mensaje.detalle}</p>
        </Alerta>
      ) : null}
      <Dialogo
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onConfirmar={confirmar}
        cargando={cargando}
        titulo="Marcar el envío como revisado"
        textoConfirmar={cargando ? 'Marcando…' : 'Sí, ya lo revisé'}
      >
        <p>
          Confírmalo solo si ya buscaste sus folios en el sitio del SII (Boleta electrónica,
          consulta de boletas emitidas).
        </p>
        <ul>
          <li>Si llegaron, no hagas nada más: las boletas son válidas.</li>
          <li>Si no llegaron, emítelas de nuevo desde Emitir.</li>
        </ul>
        <p>
          Marcarlo no reenvía nada al SII: solo deja constancia de la revisión y lo saca de los
          avisos del Tablero.
        </p>
      </Dialogo>
    </>
  );
}
