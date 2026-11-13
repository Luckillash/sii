'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo } from '@/components/boleteame';
import type { MensajeError } from '@/server/empresas-errores';
import { cambiarEstadoEmpresa } from '../acciones';
import estilos from '../empresas.module.css';

// Activar o desactivar la empresa (solo administradores). No hay «eliminar»: borrar la
// fila arrastraría en cascada documentos, folios, envíos y resoluciones.

export interface EstadoEmpresaProps {
  slug: string;
  empresaId: string;
  razonSocial: string;
  activa: boolean;
}

type Aviso = { tono: 'exito'; titulo: string } | { tono: 'error'; error: MensajeError };

export function EstadoEmpresa({ slug, empresaId, razonSocial, activa }: EstadoEmpresaProps) {
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();

  function cambiar(nueva: boolean) {
    iniciar(async () => {
      const r = await cambiarEstadoEmpresa(slug, empresaId, nueva);
      setConfirmando(false);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
    });
  }

  const cerrar = (
    <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
      Cerrar
    </Boton>
  );

  return (
    <div className={estilos.bloque}>
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

      <p className={estilos.nota}>
        {activa
          ? 'Una empresa desactivada no se puede elegir para emitir ni pedir folios. Sus documentos, folios, resoluciones y certificados se conservan, y puedes volver a activarla cuando quieras. No se puede eliminar, porque se perderían sus documentos.'
          : 'Esta empresa está desactivada: no se puede elegir para emitir ni pedir folios. Actívala para volver a usarla.'}
      </p>
      <div>
        {activa ? (
          <Boton variante="peligro" disabled={pendiente} onClick={() => setConfirmando(true)}>
            Desactivar empresa
          </Boton>
        ) : (
          <Boton disabled={pendiente} onClick={() => cambiar(true)}>
            {pendiente ? 'Activando…' : 'Activar empresa'}
          </Boton>
        )}
      </div>

      <Dialogo
        abierto={confirmando}
        onCerrar={() => setConfirmando(false)}
        onConfirmar={() => cambiar(false)}
        cargando={pendiente}
        variante="peligro"
        titulo={`Desactivar ${razonSocial}`}
        textoConfirmar="Desactivar empresa"
      >
        <p>
          Mientras esté desactivada no se podrá elegir para emitir ni pedir folios. Sus documentos,
          folios, resoluciones y certificados se conservan.
        </p>
        <p>
          Sigue contando para el límite de empresas de tu plan. Puedes volver a activarla cuando
          quieras.
        </p>
      </Dialogo>
    </div>
  );
}
