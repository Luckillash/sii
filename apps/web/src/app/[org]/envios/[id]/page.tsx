import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alerta,
  BannerAmbiente,
  Tabla,
  TablaVacia,
  Tarjeta,
  Td,
  Th,
  TipoDTE,
} from '@/components/boleteame';
import {
  guiaIncierto,
  mensajeRechazoEnvio,
  nombreAmbiente,
  textoBitacora,
  textoClasificacion,
  textoEstadoSii,
  textoRevisado,
} from '@/lib/documentos-presentacion';
import { formatearFecha, formatearFechaHora, formatearMiles, formatearRut } from '@/lib/formatos';
import { puedeEmitir } from '@/lib/permisos';
import { leerEnvio } from '@/server/documentos';
import { hrefDocumentos, leerFiltros, TODOS_LOS_PERIODOS } from '@/server/documentos/filtros';
import { exigirMembresia } from '@/server/sesion';
import type { Json } from '@/server/supabase/tipos';
import { ProveedorEnVivo } from '@/stores/ProveedorEnVivo';
import { ConsultarEstado } from '../../documentos/AccionesPanel';
import docs from '../../documentos/documentos.module.css';
import { EnVivo } from '../../documentos/EnVivo';
import { EstadoEnvioEnVivo } from '../../documentos/EstadoEnVivo';
import { ListaDocumentos } from '../../documentos/ListaDocumentos';
import { Observaciones } from '../../documentos/Observaciones';
import org from '../../organizacion.module.css';
import estilos from './envio.module.css';
import { MarcarRevisado } from './MarcarRevisado';

export const metadata: Metadata = { title: 'Envío al SII' };

// «Consultar estado en el SII» sale al SII: token (con renovación) y consulta, hasta 45 s
// por petición según `TransporteUndici`, así que puede pasar de 2 minutos. En Next 16 el
// `maxDuration` de la página aplica a sus Server Actions: 300 s, como Folios. La capa SII
// solo corre en Node.js (H7).
export const maxDuration = 300;
export const runtime = 'nodejs';

const CANAL = { rest: 'REST (API de boletas)', soap: 'SOAP' } as const;
const PROPOSITO = { emision: 'Emisión', set_pruebas: 'Set de pruebas', rcof: 'RCOF' } as const;

function json(valor: Json | null): string {
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

/**
 * Detalle de un envío al SII (PLAN-SAAS Fase 8, punto 4): carátula, Track ID, estado,
 * estadísticas por tipo, rechazos y reparos con sus errores, documentos y bitácora de
 * consultas. El JSON crudo del SII va solo en detalles plegables. `notFound()` si el envío
 * no es de la organización (RLS además lo oculta).
 */
export default async function PaginaEnvio({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const envio = await leerEnvio(organizacion.id, id);
  if (!envio) notFound();

  const hrefLista = hrefDocumentos(slug, {
    ...leerFiltros({}),
    empresa: envio.empresa?.id ?? null,
    ambiente: envio.ambiente,
    periodo: TODOS_LOS_PERIODOS,
  });
  const estadoSii = textoEstadoSii(envio.estadoSii, envio.glosaSii);
  const rechazoSobre =
    envio.clasificacion === 'rechazado' && envio.estadoSii?.toUpperCase() !== 'EPR';
  const sinSalir = !envio.trackId && !envio.incierto;
  // Solo lo que necesitan los componentes cliente (no la bitácora ni el JSON crudo).
  const paraCliente = {
    id: envio.id,
    clasificacion: envio.clasificacion,
    incierto: envio.incierto,
    trackId: envio.trackId,
    estadoSii: envio.estadoSii,
    glosaSii: envio.glosaSii,
    actualizadoEn: envio.actualizadoEn,
  };

  return (
    <ProveedorEnVivo>
      <EnVivo organizacionId={organizacion.id} canal="envio" envioId={envio.id} />
      <BannerAmbiente ambiente={envio.ambiente} />
      <p>
        <Link href={hrefLista} className={estilos.volver}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          Documentos emitidos
        </Link>
      </p>
      <header className={estilos.cabecera}>
        <p className={org.nota}>
          {envio.empresa
            ? `${envio.empresa.razonSocial} (${formatearRut(envio.empresa.rut)})`
            : organizacion.nombre}
        </p>
        <h1 className={org.titulo}>
          {envio.trackId ? (
            <>
              Envío <span className={estilos.track}>{envio.trackId}</span>
            </>
          ) : (
            'Envío sin Track ID'
          )}
        </h1>
        <EstadoEnvioEnVivo envio={paraCliente} />
      </header>

      {envio.incierto && envio.revisadoEn ? (
        <Alerta tono="info" titulo={textoRevisado(envio.revisadoEn)}>
          <p>
            Alguien de tu equipo confirmó que revisó en el SII si este envío llegó. Si no llegó,
            emite de nuevo sus boletas desde Emitir.
          </p>
        </Alerta>
      ) : null}
      {envio.incierto && !envio.revisadoEn ? (
        <Alerta tono="aviso" titulo={guiaIncierto().titulo}>
          <p>{guiaIncierto().detalle}</p>
          {puedeEmitir(rol) ? (
            <p>Cuando lo hayas revisado, márcalo para que deje de aparecer en el Tablero.</p>
          ) : null}
        </Alerta>
      ) : null}
      {envio.incierto && !envio.revisadoEn && puedeEmitir(rol) ? (
        <MarcarRevisado slug={slug} envioId={envio.id} />
      ) : null}
      {sinSalir ? (
        <Alerta tono="error" titulo="El envío no llegó al SII">
          <p>
            Falló antes de que el SII lo recibiera, así que no tiene Track ID ni estado que
            consultar. Sus boletas no son válidas: emítelas de nuevo desde Emitir.
          </p>
        </Alerta>
      ) : null}
      {rechazoSobre ? (
        <Alerta tono="error" titulo={mensajeRechazoEnvio(envio.estadoSii, envio.glosaSii).titulo}>
          <p>{mensajeRechazoEnvio(envio.estadoSii, envio.glosaSii).detalle}</p>
        </Alerta>
      ) : null}
      {envio.clasificacion === 'inconsistente' ? (
        <Alerta tono="aviso" titulo="La respuesta del SII no cuadra">
          <p>
            El SII procesó el envío, pero sus cifras no calzan con lo enviado. Revisa el envío en el
            sitio del SII antes de volver a emitir.
          </p>
        </Alerta>
      ) : null}

      <div className={estilos.columnas}>
        <Tarjeta aria-labelledby="t-estado" className={estilos.tarjeta}>
          <h2 id="t-estado" className={org.subtitulo}>
            Estado en el SII
          </h2>
          <dl className={docs.datos}>
            <dt>Track ID</dt>
            <dd className={docs.mono}>{envio.trackId ?? 'Sin Track ID'}</dd>
            <dt>Estado</dt>
            <dd>{textoClasificacion(envio.clasificacion)}</dd>
            <dt>Respuesta del SII</dt>
            <dd>{estadoSii ?? 'Todavía sin respuesta'}</dd>
            <dt>Enviado</dt>
            <dd className={docs.cifras}>
              {envio.enviadoEn ? formatearFechaHora(envio.enviadoEn) : 'No salió'}
            </dd>
            {envio.fechaRecepcion ? (
              <>
                <dt>Recibido por el SII</dt>
                <dd className={docs.cifras}>{formatearFechaHora(envio.fechaRecepcion)}</dd>
              </>
            ) : null}
            <dt>Última consulta</dt>
            <dd className={docs.cifras}>
              {envio.ultimaConsultaEn ? formatearFechaHora(envio.ultimaConsultaEn) : 'Ninguna'}
            </dd>
            <dt>Consultas</dt>
            <dd className={docs.cifras}>{formatearMiles(envio.consultas)}</dd>
          </dl>
          <ConsultarEstado slug={slug} envio={paraCliente} />
        </Tarjeta>

        <Tarjeta aria-labelledby="t-caratula" className={estilos.tarjeta}>
          <h2 id="t-caratula" className={org.subtitulo}>
            Carátula
          </h2>
          <dl className={docs.datos}>
            {envio.empresa ? (
              <>
                <dt>RUT emisor</dt>
                <dd className={docs.mono}>{formatearRut(envio.empresa.rut)}</dd>
              </>
            ) : null}
            <dt>RUT que envía</dt>
            <dd className={docs.mono}>{formatearRut(envio.rutEnvia)}</dd>
            <dt>Resolución</dt>
            <dd className={docs.cifras}>
              N.º {formatearMiles(envio.nroResol)} del {formatearFecha(envio.fchResol)}
            </dd>
            <dt>Firma</dt>
            <dd className={docs.cifras}>
              {envio.tmstFirma ? formatearFechaHora(envio.tmstFirma) : 'Sin firmar'}
            </dd>
            {envio.certificado ? (
              <>
                <dt>Certificado</dt>
                <dd className={docs.quiebre}>{envio.certificado}</dd>
              </>
            ) : null}
            <dt>Canal</dt>
            <dd>{CANAL[envio.canal]}</dd>
            <dt>Ambiente</dt>
            <dd>{nombreAmbiente(envio.ambiente)}</dd>
            <dt>Propósito</dt>
            <dd>{PROPOSITO[envio.proposito]}</dd>
            {envio.nombreArchivo ? (
              <>
                <dt>Archivo</dt>
                <dd className={docs.mono}>{envio.nombreArchivo}</dd>
              </>
            ) : null}
          </dl>
        </Tarjeta>
      </div>

      <section aria-labelledby="t-estadisticas" className={estilos.seccion}>
        <h2 id="t-estadisticas" className={org.subtitulo}>
          Estadísticas por tipo
        </h2>
        <Tabla etiqueta="Estadísticas por tipo de documento">
          <thead>
            <tr>
              <Th>Tipo</Th>
              <Th num>Informados</Th>
              <Th num>Aceptados</Th>
              <Th num>Con reparos</Th>
              <Th num>Rechazados</Th>
            </tr>
          </thead>
          <tbody>
            {envio.estadisticas.length === 0 ? (
              <TablaVacia columnas={5}>
                El SII todavía no informa cifras de este envío. Aparecen cuando termina de
                procesarlo.
              </TablaVacia>
            ) : (
              envio.estadisticas.map((s) => (
                <tr key={s.tipoDte}>
                  <Td>
                    <TipoDTE codigo={s.tipoDte} corto />
                  </Td>
                  <Td num mono>
                    {formatearMiles(s.informados)}
                  </Td>
                  <Td num mono>
                    {formatearMiles(s.aceptados)}
                  </Td>
                  <Td num mono>
                    {formatearMiles(s.reparos)}
                  </Td>
                  <Td num mono>
                    {formatearMiles(s.rechazados)}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Tabla>
      </section>

      {envio.observaciones.length > 0 ? (
        <section aria-labelledby="t-observaciones" className={estilos.seccion}>
          <h2 id="t-observaciones" className={org.subtitulo}>
            Rechazos y reparos
          </h2>
          <p className={org.texto}>
            Un rechazo invalida la boleta: corrige lo que indica el SII y emite una nueva. Un reparo
            no la invalida: corrígelo en las próximas emisiones.
          </p>
          <Tarjeta>
            <Observaciones observaciones={envio.observaciones} conDocumento />
          </Tarjeta>
        </section>
      ) : null}

      <section aria-labelledby="t-documentos" className={estilos.seccion}>
        <h2 id="t-documentos" className={org.subtitulo}>
          Documentos del envío
        </h2>
        <ListaDocumentos
          titulo={`${formatearMiles(envio.documentos.length)} ${envio.documentos.length === 1 ? 'documento' : 'documentos'}`}
          filas={envio.documentos}
          seleccionado={null}
          hrefBase={hrefLista}
          vacio="Este envío no tiene documentos asociados."
        />
      </section>

      <section aria-labelledby="t-bitacora" className={estilos.seccion}>
        <h2 id="t-bitacora" className={org.subtitulo}>
          Bitácora de consultas
        </h2>
        <Tabla etiqueta="Bitácora de consultas al SII">
          <thead>
            <tr>
              <Th>Fecha y hora</Th>
              <Th>Respuesta del SII</Th>
              <Th num>Informados</Th>
              <Th num>Aceptados</Th>
              <Th num>Con reparos</Th>
              <Th num>Rechazados</Th>
            </tr>
          </thead>
          <tbody>
            {envio.bitacora.length === 0 ? (
              <TablaVacia columnas={6}>
                Aún no consultamos este envío. El seguimiento lo consulta cada 5 minutos mientras el
                SII lo procesa.
              </TablaVacia>
            ) : (
              envio.bitacora.map((c) => (
                <tr key={c.id}>
                  <Td className={docs.cifras}>{formatearFechaHora(c.consultadoEn)}</Td>
                  <Td>
                    {(() => {
                      const t = textoBitacora(c);
                      return (
                        <>
                          {t.fallo ? (
                            <span className={estilos.error}>{t.respuesta}</span>
                          ) : (
                            t.respuesta
                          )}
                          {t.nota ? <p className={docs.nota}>{t.nota}</p> : null}
                        </>
                      );
                    })()}
                    {c.respuesta !== null ? (
                      <details className={estilos.crudo}>
                        <summary>Respuesta completa</summary>
                        <pre>{json(c.respuesta)}</pre>
                      </details>
                    ) : null}
                  </Td>
                  <Td num mono>
                    {c.informados === null ? '—' : formatearMiles(c.informados)}
                  </Td>
                  <Td num mono>
                    {c.aceptados === null ? '—' : formatearMiles(c.aceptados)}
                  </Td>
                  <Td num mono>
                    {c.reparos === null ? '—' : formatearMiles(c.reparos)}
                  </Td>
                  <Td num mono>
                    {c.rechazados === null ? '—' : formatearMiles(c.rechazados)}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Tabla>
      </section>

      {envio.respuestaSubida !== null || envio.respuestaEstado !== null ? (
        <section aria-labelledby="t-crudo" className={estilos.seccion}>
          <h2 id="t-crudo" className={org.subtitulo}>
            Respuestas del SII
          </h2>
          {envio.respuestaSubida !== null ? (
            <details className={estilos.crudo}>
              <summary>Respuesta a la subida del envío</summary>
              <pre>{json(envio.respuestaSubida)}</pre>
            </details>
          ) : null}
          {envio.respuestaEstado !== null ? (
            <details className={estilos.crudo}>
              <summary>Última respuesta de estado</summary>
              <pre>{json(envio.respuestaEstado)}</pre>
            </details>
          ) : null}
        </section>
      ) : null}
    </ProveedorEnVivo>
  );
}
