'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo, Tabla, TablaVacia, Td, Th } from '@/components/boleteame';
import { formatearFecha, formatearRut } from '@/lib/formatos';
// Solo el tipo (se borra al compilar): no arrastra `server-only` al bundle.
import type { CertificadoListado as CertificadoFila } from '@/server/certificados/consultas';
import type { MensajeError } from '@/server/certificados/errores';
import { eliminarCertificado, type ResultadoAccion, revocarCertificado } from './acciones';
import estilos from './certificados.module.css';
import { EstadoCertificado } from './EstadoCertificado';

export interface TablaCertificadosProps {
  slug: string;
  /** Si quien mira puede revocar y eliminar (la autoridad está en el servidor). */
  admin: boolean;
  certificados: CertificadoFila[];
}

type Confirmacion = { tipo: 'revocar' | 'eliminar'; certificado: CertificadoFila };

type Aviso = { tono: 'exito'; titulo: string } | { tono: 'error'; error: MensajeError };

export function nombreCertificado(c: CertificadoFila): string {
  return c.nombreTitular?.trim() || c.cn?.trim() || formatearRut(c.rutTitular);
}

export function TablaCertificados({ slug, admin, certificados }: TablaCertificadosProps) {
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();

  function confirmar() {
    if (!confirmacion) return;
    const { tipo, certificado } = confirmacion;
    iniciar(async () => {
      const r: ResultadoAccion =
        tipo === 'revocar'
          ? await revocarCertificado(slug, certificado.id)
          : await eliminarCertificado(slug, certificado.id);
      setConfirmacion(null);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
    });
  }

  const columnas = admin ? 7 : 6;
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

      <Tabla etiqueta="Certificados digitales de la organización">
        <thead>
          <tr>
            <Th>Titular</Th>
            <Th>RUT</Th>
            <Th>CN</Th>
            <Th>Emisor</Th>
            <Th>Vigencia</Th>
            <Th>Estado</Th>
            {admin ? (
              <Th>
                <span className="sr-only">Acciones</span>
              </Th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {certificados.length === 0 ? (
            <TablaVacia columnas={columnas}>
              Todavía no hay certificados.{' '}
              {admin
                ? 'Sube el .pfx de quien firma con el formulario de arriba.'
                : 'Pide a un administrador que suba el .pfx de quien firma.'}
            </TablaVacia>
          ) : (
            certificados.map((c) => {
              const nombre = nombreCertificado(c);
              return (
                <tr key={c.id}>
                  <Td>{c.nombreTitular?.trim() || '—'}</Td>
                  <Td mono>{formatearRut(c.rutTitular)}</Td>
                  <Td>
                    <span className={estilos.secundario}>{c.cn ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className={estilos.secundario}>{c.emisorCa ?? '—'}</span>
                  </Td>
                  <Td mono>
                    {c.vigenteDesde ? formatearFecha(c.vigenteDesde) : '—'} al{' '}
                    {c.vigenteHasta ? formatearFecha(c.vigenteHasta) : '—'}
                  </Td>
                  <Td>
                    <EstadoCertificado estado={c.estado} diasRestantes={c.diasRestantes} />
                  </Td>
                  {admin ? (
                    <Td num>
                      <span className={estilos.accionesFila}>
                        {c.estado !== 'revocado' ? (
                          <Boton
                            tamano="sm"
                            variante="discreto"
                            disabled={pendiente}
                            onClick={() => setConfirmacion({ tipo: 'revocar', certificado: c })}
                            aria-label={`Revocar el certificado de ${nombre}`}
                          >
                            Revocar
                          </Boton>
                        ) : null}
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente}
                          onClick={() => setConfirmacion({ tipo: 'eliminar', certificado: c })}
                          aria-label={`Eliminar el certificado de ${nombre}`}
                        >
                          Eliminar
                        </Boton>
                      </span>
                    </Td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </Tabla>

      <Dialogo
        abierto={confirmacion !== null}
        onCerrar={() => setConfirmacion(null)}
        onConfirmar={confirmar}
        cargando={pendiente}
        variante="peligro"
        titulo={
          confirmacion
            ? `${confirmacion.tipo === 'revocar' ? 'Revocar' : 'Eliminar'} el certificado de ${nombreCertificado(confirmacion.certificado)}`
            : ''
        }
        textoConfirmar={
          confirmacion?.tipo === 'revocar' ? 'Revocar certificado' : 'Eliminar certificado'
        }
      >
        {confirmacion?.tipo === 'revocar' ? (
          <>
            <p>
              Dejará de usarse para firmar documentos y para autenticarse ante el SII. Seguirá en la
              lista como revocado, con su archivo y su contraseña guardados, hasta que lo elimines.
            </p>
            <p>Los documentos ya firmados con él no cambian. Revocar no se puede deshacer.</p>
          </>
        ) : confirmacion?.tipo === 'eliminar' ? (
          <>
            <p>
              Se borran el archivo y la contraseña de la bóveda, sus asociaciones con empresas y las
              sesiones del SII guardadas con este certificado. Los tokens del SII ya obtenidos con
              él vencen solos en menos de una hora.
            </p>
            <p>
              Los documentos ya firmados no cambian. No se puede deshacer: para volver a usarlo
              tendrás que subirlo otra vez.
            </p>
          </>
        ) : null}
      </Dialogo>
    </>
  );
}
