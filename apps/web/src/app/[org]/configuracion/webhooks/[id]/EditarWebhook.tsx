'use client';

import { useActionState, useMemo } from 'react';
import { Alerta, Boton } from '@/components/boleteame';
import estilos from '../../api/api.module.css';
import { actualizarWebhook, type ResultadoFormularioWebhook } from '../acciones';
import { CamposWebhook } from '../CamposWebhook';

export interface EditarWebhookProps {
  slug: string;
  webhookId: string;
  url: string;
  eventos: readonly string[];
}

/** URL y eventos del webhook. El secreto no cambia al editar (se rota aparte). */
export function EditarWebhook({ slug, webhookId, url, eventos }: EditarWebhookProps) {
  const actualizar = useMemo(
    () => actualizarWebhook.bind(null, slug, webhookId),
    [slug, webhookId],
  );
  const [estado, accion, enviando] = useActionState<ResultadoFormularioWebhook | null, FormData>(
    actualizar,
    null,
  );
  const fallo = estado && !estado.ok ? estado : null;

  return (
    <div className={estilos.bloque}>
      <div aria-live="polite" className={estilos.avisos}>
        {estado?.ok ? <Alerta tono="exito" titulo={estado.mensaje} /> : null}
        {fallo ? (
          <Alerta tono="error" titulo={fallo.error.titulo}>
            {fallo.error.detalle}
          </Alerta>
        ) : null}
      </div>
      <form action={accion} className={estilos.formulario} noValidate>
        <CamposWebhook
          url={fallo?.valores?.url ?? url}
          eventos={fallo?.valores?.eventos ?? eventos}
          errores={fallo?.errores}
        />
        <div className={estilos.acciones}>
          <Boton type="submit" variante="primario" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Guardar cambios'}
          </Boton>
        </div>
      </form>
    </div>
  );
}
