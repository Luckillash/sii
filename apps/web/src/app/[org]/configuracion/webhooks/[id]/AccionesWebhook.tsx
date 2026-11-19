'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo } from '@/components/boleteame';
import type { MensajeError } from '@/server/integraciones/errores';
import estilos from '../../api/api.module.css';
import { SecretoParaCopiar } from '../../api/SecretoParaCopiar';
import {
  borrarWebhook,
  cambiarEstadoWebhook,
  probarWebhook,
  rotarSecretoWebhook,
} from '../acciones';

export interface AccionesWebhookProps {
  slug: string;
  webhookId: string;
  url: string;
  activo: boolean;
  /** El plan incluye webhooks: sin él, la prueba se rechaza en la base. */
  planConWebhooks: boolean;
}

type Confirmacion = 'pausar' | 'rotar' | 'borrar';

type Aviso =
  | { tono: 'exito'; titulo: string }
  | { tono: 'error'; error: MensajeError }
  | { tono: 'secreto'; secreto: string };

/** Probar, pausar o activar, rotar el secreto y borrar. Las peligrosas piden confirmación. */
export function AccionesWebhook({
  slug,
  webhookId,
  url,
  activo,
  planConWebhooks,
}: AccionesWebhookProps) {
  const router = useRouter();
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();

  function resultado(r: { ok: true; mensaje: string } | { ok: false; error: MensajeError }) {
    setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
  }

  function probar() {
    iniciar(async () => resultado(await probarWebhook(slug, webhookId)));
  }

  function activar() {
    iniciar(async () => resultado(await cambiarEstadoWebhook(slug, webhookId, true)));
  }

  function confirmar() {
    const accion = confirmacion;
    if (!accion) return;
    iniciar(async () => {
      if (accion === 'pausar') {
        resultado(await cambiarEstadoWebhook(slug, webhookId, false));
      } else if (accion === 'rotar') {
        const r = await rotarSecretoWebhook(slug, webhookId);
        setAviso(
          r.ok ? { tono: 'secreto', secreto: r.secreto } : { tono: 'error', error: r.error },
        );
      } else {
        const r = await borrarWebhook(slug, webhookId);
        if (r.ok) {
          router.push(`/${slug}/configuracion/webhooks`);
          return;
        }
        setAviso({ tono: 'error', error: r.error });
      }
      setConfirmacion(null);
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
        {aviso?.tono === 'secreto' ? (
          <Alerta tono="exito" titulo="Cambiaste el secreto del webhook">
            <p>
              Desde ahora firmamos las entregas con este secreto y el anterior ya no sirve. Cópialo
              y actualízalo en tu sistema: no lo volveremos a mostrar.
            </p>
            <SecretoParaCopiar
              valor={aviso.secreto}
              etiqueta="Nuevo secreto del webhook"
              textoCopiar="Copiar secreto"
              textoListo="Listo, ya lo guardé"
              onCerrar={() => setAviso(null)}
            />
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.acciones}>
        <Boton
          disabled={pendiente || !activo || !planConWebhooks}
          onClick={probar}
          title={
            !planConWebhooks
              ? 'Tu plan no incluye webhooks'
              : !activo
                ? 'Activa el webhook para enviar una prueba'
                : undefined
          }
        >
          Enviar prueba
        </Boton>
        {activo ? (
          <Boton disabled={pendiente} onClick={() => setConfirmacion('pausar')}>
            Pausar
          </Boton>
        ) : (
          <Boton disabled={pendiente} onClick={activar}>
            Activar
          </Boton>
        )}
        <Boton disabled={pendiente} onClick={() => setConfirmacion('rotar')}>
          Rotar secreto
        </Boton>
        <Boton variante="peligro" disabled={pendiente} onClick={() => setConfirmacion('borrar')}>
          Borrar webhook
        </Boton>
      </div>

      <Dialogo
        abierto={confirmacion !== null}
        onCerrar={() => setConfirmacion(null)}
        onConfirmar={confirmar}
        cargando={pendiente}
        variante={confirmacion === 'pausar' ? 'primario' : 'peligro'}
        titulo={
          confirmacion === 'pausar'
            ? 'Pausar el webhook'
            : confirmacion === 'rotar'
              ? 'Rotar el secreto'
              : 'Borrar el webhook'
        }
        textoConfirmar={
          confirmacion === 'pausar'
            ? 'Pausar webhook'
            : confirmacion === 'rotar'
              ? 'Rotar secreto'
              : 'Borrar webhook'
        }
      >
        {confirmacion === 'pausar' ? (
          <p>
            Mientras esté pausado, {url} no recibirá eventos y las entregas pendientes se
            descartarán. Puedes activarlo de nuevo cuando quieras.
          </p>
        ) : null}
        {confirmacion === 'rotar' ? (
          <p>
            El secreto actual dejará de servir de inmediato: tu sistema rechazará las entregas hasta
            que guardes el nuevo. Ten lista la configuración antes de rotarlo.
          </p>
        ) : null}
        {confirmacion === 'borrar' ? (
          <p>
            Se borrarán el webhook, su secreto y todo su historial de entregas. {url} dejará de
            recibir eventos. No se puede deshacer.
          </p>
        ) : null}
      </Dialogo>
    </div>
  );
}
