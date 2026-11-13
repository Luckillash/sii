'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import {
  Alerta,
  Boton,
  Campo,
  Dialogo,
  Select,
  Tabla,
  TablaVacia,
  Td,
  Th,
} from '@/components/boleteame';
import { formatearFecha, formatearRut } from '@/lib/formatos';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { AsociacionEmpresa, CertificadoListado } from '@/server/certificados/consultas';
import type { MensajeError } from '@/server/certificados/errores';
import estilos from '../../../certificados/certificados.module.css';
import { EstadoCertificado } from '../../../certificados/EstadoCertificado';
import {
  asociarCertificadoEmpresa,
  cambiarRepresentante,
  dejarDeSerPredeterminado,
  quitarCertificadoEmpresa,
  type ResultadoAccion,
  type ResultadoAsociar,
  usarComoPredeterminado,
} from './acciones';

export interface CertificadosEmpresaProps {
  slug: string;
  empresaId: string;
  razonSocial: string;
  admin: boolean;
  asociaciones: AsociacionEmpresa[];
  /** Certificados de la organización que todavía no están asociados (y siguen vigentes). */
  disponibles: CertificadoListado[];
}

type Aviso = { tono: 'exito'; titulo: string } | { tono: 'error'; error: MensajeError };

function nombre(c: CertificadoListado): string {
  return c.nombreTitular?.trim() || c.cn?.trim() || formatearRut(c.rutTitular);
}

export function CertificadosEmpresa({
  slug,
  empresaId,
  razonSocial,
  admin,
  asociaciones,
  disponibles,
}: CertificadosEmpresaProps) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [quitar, setQuitar] = useState<CertificadoListado | null>(null);
  const [pendiente, iniciar] = useTransition();

  function ejecutar(accion: () => Promise<ResultadoAccion>) {
    iniciar(async () => {
      const r = await accion();
      setQuitar(null);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
    });
  }

  const cerrar = (
    <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
      Cerrar
    </Boton>
  );
  const columnas = admin ? 6 : 5;

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

      <section aria-labelledby="t-asociados" className={estilos.seccion}>
        <h2 id="t-asociados" className={estilos.subtitulo}>
          Certificados que firman por {razonSocial}
        </h2>
        <Tabla etiqueta={`Certificados de ${razonSocial}`}>
          <thead>
            <tr>
              <Th>Titular</Th>
              <Th>Vigencia</Th>
              <Th>Estado</Th>
              <Th>Representante electrónico</Th>
              <Th>Predeterminado</Th>
              {admin ? (
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {asociaciones.length === 0 ? (
              <TablaVacia columnas={columnas}>
                Esta empresa todavía no tiene certificados.{' '}
                {admin
                  ? 'Asocia uno de la organización con el formulario de abajo.'
                  : 'Pide a un administrador que asocie uno.'}
              </TablaVacia>
            ) : (
              asociaciones.map(({ certificado: c, esRepresentanteElectronico, predeterminado }) => {
                const quien = nombre(c);
                return (
                  <tr key={c.id}>
                    <Td>
                      <span className={estilos.titular}>
                        <span>{quien}</span>
                        <span className={estilos.secundario}>{formatearRut(c.rutTitular)}</span>
                      </span>
                    </Td>
                    <Td mono>
                      {c.vigenteHasta ? `Hasta el ${formatearFecha(c.vigenteHasta)}` : '—'}
                    </Td>
                    <Td>
                      <EstadoCertificado estado={c.estado} diasRestantes={c.diasRestantes} />
                    </Td>
                    <Td>
                      {admin ? (
                        <label className={estilos.casilla}>
                          <input
                            type="checkbox"
                            checked={esRepresentanteElectronico}
                            disabled={pendiente}
                            onChange={(e) => {
                              const valor = e.target.checked;
                              ejecutar(() => cambiarRepresentante(slug, empresaId, c.id, valor));
                            }}
                          />
                          <span>{esRepresentanteElectronico ? 'Sí' : 'No'}</span>
                        </label>
                      ) : esRepresentanteElectronico ? (
                        'Sí'
                      ) : (
                        'No'
                      )}
                    </Td>
                    <Td>
                      {predeterminado ? (
                        <span className={estilos.titular}>
                          <span className={`${estilos.estado} ${estilos.info}`}>
                            Predeterminado
                          </span>
                          {admin ? (
                            <Boton
                              tamano="sm"
                              variante="discreto"
                              disabled={pendiente}
                              onClick={() =>
                                ejecutar(() => dejarDeSerPredeterminado(slug, empresaId, c.id))
                              }
                              aria-label={`Quitar el certificado de ${quien} como predeterminado`}
                            >
                              Quitar predeterminado
                            </Boton>
                          ) : null}
                        </span>
                      ) : admin ? (
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente || c.estado === 'revocado' || c.estado === 'vencido'}
                          onClick={() =>
                            ejecutar(() => usarComoPredeterminado(slug, empresaId, c.id))
                          }
                          aria-label={`Usar el certificado de ${quien} como predeterminado`}
                        >
                          Usar como predeterminado
                        </Boton>
                      ) : (
                        '—'
                      )}
                    </Td>
                    {admin ? (
                      <Td num>
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente}
                          onClick={() => setQuitar(c)}
                          aria-label={`Quitar el certificado de ${quien} de la empresa`}
                        >
                          Quitar
                        </Boton>
                      </Td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </Tabla>
      </section>

      {admin ? (
        <FormularioAsociar
          slug={slug}
          empresaId={empresaId}
          disponibles={disponibles}
          alAsociar={(mensaje) => setAviso({ tono: 'exito', titulo: mensaje })}
        />
      ) : null}

      <Dialogo
        abierto={quitar !== null}
        onCerrar={() => setQuitar(null)}
        onConfirmar={() => {
          if (quitar) ejecutar(() => quitarCertificadoEmpresa(slug, empresaId, quitar.id));
        }}
        cargando={pendiente}
        variante="peligro"
        titulo={quitar ? `Quitar el certificado de ${nombre(quitar)}` : ''}
        textoConfirmar="Quitar de la empresa"
      >
        <p>
          Dejará de firmar los documentos de {razonSocial}. El certificado sigue cargado en la
          organización y puedes volver a asociarlo cuando quieras.
        </p>
      </Dialogo>
    </>
  );
}

function FormularioAsociar({
  slug,
  empresaId,
  disponibles,
  alAsociar,
}: {
  slug: string;
  empresaId: string;
  disponibles: CertificadoListado[];
  alAsociar: (mensaje: string) => void;
}) {
  const accion = useMemo(
    () => asociarCertificadoEmpresa.bind(null, slug, empresaId),
    [slug, empresaId],
  );
  const [estado, despachar, enviando] = useActionState<ResultadoAsociar | null, FormData>(
    accion,
    null,
  );
  const idRepresentante = useId();
  const idPredeterminado = useId();
  const avisado = useRef<ResultadoAsociar | null>(null);

  useEffect(() => {
    if (estado?.ok && avisado.current !== estado) {
      avisado.current = estado;
      alAsociar(estado.mensaje);
    }
  }, [estado, alAsociar]);

  return (
    <section aria-labelledby="t-asociar" className={estilos.seccion}>
      <h2 id="t-asociar" className={estilos.subtitulo}>
        Asociar un certificado
      </h2>
      {estado && !estado.ok ? (
        <Alerta tono="error" titulo={estado.error.titulo}>
          {estado.error.detalle}
        </Alerta>
      ) : null}
      {disponibles.length === 0 ? (
        <p className={estilos.nota}>
          No hay otros certificados vigentes en la organización.{' '}
          <Link href={`/${slug}/configuracion/certificados`}>Sube uno en Certificados</Link> y
          vuelve aquí para asociarlo.
        </p>
      ) : (
        <form action={despachar} className={estilos.formulario}>
          <div className={estilos.filaCampos}>
            <Campo
              etiqueta="Certificado"
              error={estado && !estado.ok ? estado.errores?.certificado_id : undefined}
              anchoCompleto
            >
              <Select name="certificado_id" required defaultValue="">
                <option value="" disabled>
                  Elige un certificado
                </option>
                {disponibles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombre(c)} ({formatearRut(c.rutTitular)})
                    {c.vigenteHasta ? `, vence el ${formatearFecha(c.vigenteHasta)}` : ''}
                  </option>
                ))}
              </Select>
            </Campo>
            <fieldset className={estilos.opciones}>
              <legend>Opciones</legend>
              <label className={estilos.casilla} htmlFor={idRepresentante}>
                <input id={idRepresentante} type="checkbox" name="representante" />
                <span>El titular es representante electrónico</span>
              </label>
              <label className={estilos.casilla} htmlFor={idPredeterminado}>
                <input id={idPredeterminado} type="checkbox" name="predeterminado" />
                <span>Usar como certificado predeterminado</span>
              </label>
            </fieldset>
          </div>
          <div className={estilos.acciones}>
            <Boton type="submit" variante="primario" disabled={enviando}>
              {enviando ? 'Asociando…' : 'Asociar certificado'}
            </Boton>
          </div>
        </form>
      )}
    </section>
  );
}
