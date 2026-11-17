import Link from 'next/link';
import { Alerta, Monto, PanelDetalle, Tabla, Td, Th, TipoDTE } from '@/components/boleteame';
import { formatearFecha, formatearFechaHora, formatearMiles, formatearRut } from '@/lib/formatos';
import type { DetalleDocumento } from '@/server/documentos/lectura';
import {
  guiaIncierto,
  guiaObservacion,
  mensajeRechazoEnvio,
  nombreAmbiente,
  textoEstadoSii,
} from '@/server/documentos/presentacion';
import { AccionesDocumento, ConsultarEstado } from './AccionesPanel';
import estilos from './documentos.module.css';
import { Enfocar } from './Enfocar';
import { EstadoDocumentoEnVivo } from './EstadoEnVivo';
import { Observaciones } from './Observaciones';

// Panel de detalle de una boleta (plantilla «Documentos emitidos», adaptada a boleta: sin
// «Anular con nota de crédito», que queda para la Fase 14). Server Component: los datos
// llegan con RLS; las acciones y el badge de estado son clientes (Realtime).

const ID_TITULO = 't-detalle';

export function Detalle({
  slug,
  doc,
  hrefCerrar,
  puedeReenviar,
}: {
  slug: string;
  doc: DetalleDocumento;
  hrefCerrar: string;
  puedeReenviar: boolean;
}) {
  const folio = doc.folio !== null ? `N.º ${formatearMiles(doc.folio)}` : 'Sin folio';
  const rechazos = doc.observaciones.filter((o) => o.tipo === 'rechazo');
  const reparos = doc.observaciones.filter((o) => o.tipo === 'reparo');
  const estadoSii = doc.envio ? textoEstadoSii(doc.envio.estadoSii, doc.envio.glosaSii) : null;

  return (
    <PanelDetalle aria-labelledby={ID_TITULO} hrefCerrar={hrefCerrar} className={estilos.panel}>
      <Enfocar key={doc.id} id={ID_TITULO} />
      <div className={estilos.cabeceraDetalle}>
        <TipoDTE codigo={doc.tipoDte} />
        <h2 id={ID_TITULO} tabIndex={-1} className={estilos.tituloDetalle}>
          {folio}
        </h2>
        <EstadoDocumentoEnVivo
          id={doc.id}
          estado={doc.estado}
          actualizadoEn={doc.actualizadoEn}
          detalle={doc.envio?.trackId ? `Track ID ${doc.envio.trackId}` : undefined}
        />
      </div>

      {doc.estado === 'incierto' ? (
        <Alerta tono="aviso" titulo={guiaIncierto(doc.folio).titulo}>
          <p>{guiaIncierto(doc.folio).detalle}</p>
        </Alerta>
      ) : null}
      {doc.estado === 'rechazado' ? (
        rechazos.length > 0 ? (
          <Alerta tono="error" titulo="El SII rechazó la boleta">
            <Observaciones observaciones={rechazos} />
            <p>{guiaObservacion('rechazo')}</p>
          </Alerta>
        ) : (
          <Alerta
            tono="error"
            titulo={
              mensajeRechazoEnvio(doc.envio?.estadoSii ?? null, doc.envio?.glosaSii ?? null).titulo
            }
          >
            <p>
              {
                mensajeRechazoEnvio(doc.envio?.estadoSii ?? null, doc.envio?.glosaSii ?? null)
                  .detalle
              }
            </p>
          </Alerta>
        )
      ) : null}
      {reparos.length > 0 ? (
        <Alerta tono="aviso" titulo="Aceptada con reparos">
          <Observaciones observaciones={reparos} />
          <p>{guiaObservacion('reparo')}</p>
        </Alerta>
      ) : null}
      {doc.estado === 'anulado' ? (
        <Alerta tono="info" titulo="La boleta quedó anulada">
          <p>
            El SII no la recibió y su folio no se vuelve a usar. Emite una boleta nueva si hace
            falta.
          </p>
        </Alerta>
      ) : null}

      <dl className={estilos.datos}>
        <dt>Receptor</dt>
        <dd>{doc.receptor.razonSocial ?? 'Sin razón social'}</dd>
        <dt>RUT</dt>
        <dd className={estilos.mono}>{formatearRut(doc.receptor.rut)}</dd>
        {doc.receptor.correo ? (
          <>
            <dt>Correo</dt>
            <dd className={estilos.quiebre}>{doc.receptor.correo}</dd>
          </>
        ) : null}
        <dt>Emisión</dt>
        <dd className={estilos.cifras}>{formatearFecha(doc.fechaEmision)}</dd>
        <dt>Ambiente</dt>
        <dd>{nombreAmbiente(doc.ambiente)}</dd>
        <dt>Track ID</dt>
        <dd className={estilos.mono}>
          {doc.envio?.trackId ? (
            <Link href={`/${slug}/envios/${doc.envio.id}`}>{doc.envio.trackId}</Link>
          ) : doc.envio ? (
            <Link href={`/${slug}/envios/${doc.envio.id}`}>Ver envío (sin Track ID)</Link>
          ) : (
            'Sin envío'
          )}
        </dd>
        {estadoSii ? (
          <>
            <dt>Estado en el SII</dt>
            <dd>{estadoSii}</dd>
          </>
        ) : null}
        {doc.envio?.ultimaConsultaEn ? (
          <>
            <dt>Última consulta</dt>
            <dd className={estilos.cifras}>{formatearFechaHora(doc.envio.ultimaConsultaEn)}</dd>
          </>
        ) : null}
        {doc.correoEnviadoEn ? (
          <>
            <dt>Enviada al receptor</dt>
            <dd className={estilos.cifras}>{formatearFechaHora(doc.correoEnviadoEn)}</dd>
          </>
        ) : null}
      </dl>

      <div className={estilos.totales}>
        {doc.totales.descuento > 0 ? (
          <>
            <span>Descuento</span>
            <Monto valor={-doc.totales.descuento} tenue />
          </>
        ) : null}
        {doc.tipoDte !== 41 ? (
          <>
            <span>Neto</span>
            <Monto valor={doc.totales.neto} tenue />
            <span>IVA (19 %)</span>
            <Monto valor={doc.totales.iva} tenue />
          </>
        ) : null}
        {doc.totales.exento > 0 ? (
          <>
            <span>Exento</span>
            <Monto valor={doc.totales.exento} tenue />
          </>
        ) : null}
        <span className={estilos.total}>Total</span>
        <div className={estilos.totalMonto}>
          <Monto valor={doc.totales.total} destacado />
        </div>
      </div>

      {doc.lineas.length > 0 ? (
        <Tabla titulo="Detalle" etiqueta="Detalle de la boleta" className={estilos.tablaLineas}>
          <thead>
            <tr>
              <Th>Producto o servicio</Th>
              <Th num>Cantidad</Th>
              <Th num>Total</Th>
            </tr>
          </thead>
          <tbody>
            {doc.lineas.map((l) => (
              <tr key={l.nroLinea}>
                <Td>
                  {l.nombre}
                  {l.exento ? <span className={estilos.nota}> (exento)</span> : null}
                </Td>
                <Td num mono>
                  {l.cantidad.toLocaleString('es-CL', { maximumFractionDigits: 3 })}
                  {l.unidad ? ` ${l.unidad}` : ''}
                </Td>
                <Td num>
                  <Monto valor={l.monto} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}

      <AccionesDocumento
        slug={slug}
        puedeReenviar={puedeReenviar}
        documento={{
          id: doc.id,
          estado: doc.estado,
          actualizadoEn: doc.actualizadoEn,
          conXml: doc.conXml,
          correo: doc.receptor.correo,
        }}
      />
      <ConsultarEstado
        slug={slug}
        documento={{ id: doc.id, estado: doc.estado, actualizadoEn: doc.actualizadoEn }}
        envio={doc.envio}
      />
    </PanelDetalle>
  );
}
