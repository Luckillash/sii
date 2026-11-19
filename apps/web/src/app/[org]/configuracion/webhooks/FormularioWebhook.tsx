'use client';

import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { Alerta, Boton } from '@/components/boleteame';
import { RUTA_DOCS_API } from '@/lib/api-publica';
import estilos from '../api/api.module.css';
import { SecretoParaCopiar } from '../api/SecretoParaCopiar';
import { crearWebhook, type ResultadoFormularioWebhook } from './acciones';
import { CamposWebhook } from './CamposWebhook';

/** Eventos marcados al crear: los que cuentan qué pasó con cada boleta. */
const EVENTOS_POR_DEFECTO = [
  'documento.aceptado',
  'documento.aceptado_con_reparos',
  'documento.rechazado',
  'documento.incierto',
] as const;

export interface FormularioWebhookProps {
  slug: string;
  /** El plan no incluye webhooks: el formulario se ve, pero no se puede enviar. */
  deshabilitado: boolean;
}

export function FormularioWebhook({ slug, deshabilitado }: FormularioWebhookProps) {
  const crear = useMemo(() => crearWebhook.bind(null, slug), [slug]);
  const [estado, accion, enviando] = useActionState<ResultadoFormularioWebhook | null, FormData>(
    crear,
    null,
  );
  // El secreto se muestra una sola vez: se descarta al cerrarlo o al crear otro webhook.
  const [secretoVisible, setSecretoVisible] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setSecretoVisible(Boolean(estado?.ok && estado.secreto));
    if (estado?.ok) setVersion((v) => v + 1);
  }, [estado]);

  const fallo = estado && !estado.ok ? estado : null;

  return (
    <div className={estilos.bloque}>
      {estado?.ok && estado.secreto && secretoVisible ? (
        <Alerta tono="exito" titulo="Creaste el webhook">
          <p>
            Copia el secreto ahora: con él verificas la firma de cada entrega (cabecera
            Boleteame-Firma). No lo volveremos a mostrar; si lo pierdes, rótalo desde el detalle del
            webhook. <Link href={`${RUTA_DOCS_API}#webhooks`}>Cómo verificar la firma</Link>.
          </p>
          <SecretoParaCopiar
            valor={estado.secreto}
            etiqueta="Secreto del webhook"
            textoCopiar="Copiar secreto"
            textoListo="Listo, ya lo guardé"
            onCerrar={() => setSecretoVisible(false)}
          />
          {estado.webhookId ? (
            <p>
              <Link href={`/${slug}/configuracion/webhooks/${estado.webhookId}`}>
                Ver el webhook y enviar una prueba
              </Link>
            </p>
          ) : null}
        </Alerta>
      ) : null}
      {fallo ? (
        <Alerta tono="error" titulo={fallo.error.titulo}>
          {fallo.error.detalle}
        </Alerta>
      ) : null}

      <form
        key={version}
        action={accion}
        className={estilos.formulario}
        noValidate
        onSubmit={() => setSecretoVisible(false)}
      >
        <CamposWebhook
          url={fallo?.valores?.url ?? ''}
          eventos={fallo?.valores?.eventos ?? EVENTOS_POR_DEFECTO}
          errores={fallo?.errores}
        />
        <div className={estilos.acciones}>
          <Boton type="submit" variante="primario" disabled={enviando || deshabilitado}>
            {enviando ? 'Creando el webhook…' : 'Crear webhook'}
          </Boton>
        </div>
      </form>
    </div>
  );
}
