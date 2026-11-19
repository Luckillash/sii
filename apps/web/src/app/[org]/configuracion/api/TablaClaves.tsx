'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo, Tabla, TablaVacia, Td, Th } from '@/components/boleteame';
import { formatearFecha, formatearFechaHora, formatearRut } from '@/lib/formatos';
import type { MensajeError } from '@/server/integraciones/errores';
import {
  type ClaveApiVista,
  type EstadoClave,
  ETIQUETA_AMBIENTE,
  ETIQUETA_ESTADO_CLAVE,
  estadoClave,
  prefijoVisible,
} from '@/server/integraciones/presentacion';
import { revocarClaveApi } from './acciones';
import estilos from './api.module.css';

export interface TablaClavesProps {
  slug: string;
  claves: ClaveApiVista[];
}

type Aviso = { tono: 'exito'; titulo: string } | { tono: 'error'; error: MensajeError };

const CLASE_ESTADO: Record<EstadoClave, string | undefined> = {
  activa: estilos.estadoActivo,
  revocada: estilos.estadoInactivo,
  vencida: estilos.estadoAviso,
};

export function TablaClaves({ slug, claves }: TablaClavesProps) {
  const [porRevocar, setPorRevocar] = useState<ClaveApiVista | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();

  function revocar() {
    if (!porRevocar) return;
    const clave = porRevocar;
    iniciar(async () => {
      const r = await revocarClaveApi(slug, clave.id);
      setPorRevocar(null);
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

      <Tabla etiqueta="API keys de la organización">
        <thead>
          <tr>
            <Th>Nombre</Th>
            <Th>Clave</Th>
            <Th>Ambiente</Th>
            <Th>Empresa</Th>
            <Th>Permisos</Th>
            <Th>Vence</Th>
            <Th>Último uso</Th>
            <Th>Estado</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {claves.length === 0 ? (
            <TablaVacia columnas={9}>
              Aún no hay API keys. Crea una con el formulario de arriba para conectar tu sistema.
            </TablaVacia>
          ) : (
            claves.map((c) => {
              const estado = estadoClave(c);
              return (
                <tr key={c.id}>
                  <Td>{c.nombre}</Td>
                  <Td mono>{prefijoVisible(c.prefijo)}</Td>
                  <Td>{ETIQUETA_AMBIENTE[c.ambiente]}</Td>
                  <Td>
                    {c.empresa
                      ? `${c.empresa.razonSocial} (${formatearRut(c.empresa.rut)})`
                      : 'Todas'}
                  </Td>
                  <Td>
                    <ul className={estilos.etiquetas} aria-label={`Permisos de ${c.nombre}`}>
                      {c.alcances.map((a) => (
                        <li key={a} className={estilos.etiqueta}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td mono>{c.expiraEn ? formatearFecha(c.expiraEn) : 'Sin plazo'}</Td>
                  <Td mono>{c.ultimoUsoEn ? formatearFechaHora(c.ultimoUsoEn) : 'Nunca'}</Td>
                  <Td>
                    <span className={CLASE_ESTADO[estado]}>{ETIQUETA_ESTADO_CLAVE[estado]}</span>
                    {estado === 'revocada' && c.revocadaEn ? (
                      <span className={estilos.nota}> el {formatearFecha(c.revocadaEn)}</span>
                    ) : null}
                  </Td>
                  <Td num>
                    {estado === 'revocada' ? null : (
                      <Boton
                        tamano="sm"
                        variante="discreto"
                        disabled={pendiente}
                        onClick={() => setPorRevocar(c)}
                        aria-label={`Revocar la API key ${c.nombre}`}
                      >
                        Revocar
                      </Boton>
                    )}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </Tabla>

      <Dialogo
        abierto={porRevocar !== null}
        onCerrar={() => setPorRevocar(null)}
        onConfirmar={revocar}
        cargando={pendiente}
        variante="peligro"
        titulo={porRevocar ? `Revocar la API key «${porRevocar.nombre}»` : ''}
        textoConfirmar="Revocar API key"
      >
        <p>
          La clave {porRevocar ? prefijoVisible(porRevocar.prefijo) : ''} dejará de servir de
          inmediato: las peticiones que la usen recibirán un error 401. No se puede deshacer.
        </p>
        <p>Si tu sistema todavía la usa, crea otra clave y cámbiala antes de revocar esta.</p>
      </Dialogo>
    </>
  );
}
