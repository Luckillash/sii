'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton, Tabla, TablaVacia, Td, Th } from '@/components/boleteame';
import { ETIQUETA_ESTADO_ENTREGA, MAX_INTENTOS_WEBHOOK } from '@/lib/api-publica';
import { formatearFechaHora } from '@/lib/formatos';
import type { MensajeError } from '@/server/integraciones/errores';
import { type EntregaVista, sePuedeReenviar } from '@/server/integraciones/presentacion';
import estilos from '../../api/api.module.css';
import { reenviarEntrega } from '../acciones';
import { claseEstadoEntrega } from '../estilosEntrega';

export interface HistorialEntregasProps {
  slug: string;
  webhookId: string;
  entregas: EntregaVista[];
  /** Webhook activo y plan con webhooks: si no, la base rechaza el reenvío. */
  puedeReenviar: boolean;
}

type Aviso = { tono: 'exito'; titulo: string } | { tono: 'error'; error: MensajeError };

function proximoIntento(e: EntregaVista): string {
  if (e.estado === 'fallido' || e.estado === 'pendiente') {
    return formatearFechaHora(e.siguienteIntentoEn);
  }
  return '—';
}

export function HistorialEntregas({
  slug,
  webhookId,
  entregas,
  puedeReenviar,
}: HistorialEntregasProps) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const [pendiente, iniciar] = useTransition();

  function reenviar(entrega: EntregaVista) {
    setEnCurso(entrega.id);
    iniciar(async () => {
      const r = await reenviarEntrega(slug, webhookId, entrega.id);
      setEnCurso(null);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
    });
  }

  const cerrar = (
    <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
      Cerrar
    </Boton>
  );

  return (
    <>
      <div aria-live="polite" className={estilos.avisos}>
        {aviso?.tono === 'exito' ? (
          <Alerta tono="exito" titulo={aviso.titulo} accion={cerrar} />
        ) : null}
        {aviso?.tono === 'error' ? (
          <Alerta tono="error" titulo={aviso.error.titulo} accion={cerrar}>
            {aviso.error.detalle}
          </Alerta>
        ) : null}
      </div>

      <Tabla etiqueta="Historial de entregas del webhook">
        <thead>
          <tr>
            <Th>N.º</Th>
            <Th>Evento</Th>
            <Th>Creada</Th>
            <Th>Estado</Th>
            <Th>Intentos</Th>
            <Th>Último HTTP</Th>
            <Th>Próximo intento</Th>
            <Th>Respuesta</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {entregas.length === 0 ? (
            <TablaVacia columnas={9}>
              Aún no hay entregas. Envía una prueba para comprobar que tu endpoint responde.
            </TablaVacia>
          ) : (
            entregas.map((e) => (
              <tr key={e.id}>
                <Td mono>{e.id}</Td>
                <Td mono>{e.evento}</Td>
                <Td mono>{formatearFechaHora(e.creadoEn)}</Td>
                <Td>
                  <span className={claseEstadoEntrega(e.estado)}>
                    {ETIQUETA_ESTADO_ENTREGA[e.estado]}
                  </span>
                  {e.estado === 'entregado' && e.entregadoEn ? (
                    <span className={estilos.nota}> {formatearFechaHora(e.entregadoEn)}</span>
                  ) : null}
                  {e.reenviadaEn ? (
                    <span className={estilos.nota}>
                      {' '}
                      · reenviada el {formatearFechaHora(e.reenviadaEn)}
                    </span>
                  ) : null}
                </Td>
                <Td num>
                  {e.intentos} de {MAX_INTENTOS_WEBHOOK}
                </Td>
                <Td mono>{e.ultimoStatusHttp ?? '—'}</Td>
                <Td mono>{proximoIntento(e)}</Td>
                <Td>
                  {e.ultimaRespuesta ? (
                    <details className={estilos.respuesta}>
                      <summary>Ver respuesta</summary>
                      <pre>{e.ultimaRespuesta}</pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td num>
                  {sePuedeReenviar(e) ? (
                    <Boton
                      tamano="sm"
                      variante="discreto"
                      disabled={pendiente || !puedeReenviar}
                      onClick={() => reenviar(e)}
                      aria-label={`Reenviar la entrega N.º ${e.id}`}
                    >
                      {enCurso === e.id ? 'Reenviando…' : 'Reenviar'}
                    </Boton>
                  ) : null}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </>
  );
}
