import { textoError, ubicacionError } from '@/lib/documentos-presentacion';
import { formatearMiles, nombreTipoDte } from '@/lib/formatos';
import type { ObservacionSii } from '@/server/documentos/lectura';
import estilos from './documentos.module.css';

// Rechazos y reparos del SII con sus errores (`seccion`, `linea`, `codigo`, `descripcion`)
// en el lenguaje del design system: dónde, qué dice el SII y su código. Lo usan el panel
// de detalle y la página del envío.

export function Observaciones({
  observaciones,
  conDocumento = false,
}: {
  observaciones: ObservacionSii[];
  /** Muestra a qué boleta corresponde cada una (página del envío). */
  conDocumento?: boolean;
}) {
  return (
    <ul className={estilos.observaciones}>
      {observaciones.map((o) => (
        <li key={o.id} className={estilos.observacion}>
          <p className={estilos.observacionTitulo}>
            {conDocumento ? `${nombreTipoDte(o.tipoDte)} N.º ${formatearMiles(o.folio)}: ` : null}
            {o.tipo === 'rechazo' ? 'Rechazo' : 'Reparo'}
            <span className={estilos.codigo}> ({o.estado})</span>
          </p>
          {o.descripcion ? <p>{o.descripcion}</p> : null}
          {o.errores.length > 0 ? (
            <ul className={estilos.errores}>
              {o.errores.map((e, i) => {
                const donde = ubicacionError(e);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: los errores del SII no traen id y su orden es fijo.
                  <li key={i}>
                    {donde ? <span className={estilos.donde}>{donde}: </span> : null}
                    {textoError(e)}
                    {e.codigo ? <span className={estilos.codigo}> Código {e.codigo}.</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={estilos.nota}>El SII no detalló los errores.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
