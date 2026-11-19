'use client';

import { useId } from 'react';
import { Campo, Input } from '@/components/boleteame';
import { DESCRIPCION_EVENTO, EVENTOS_WEBHOOK, MAXIMO_URL_WEBHOOK } from '@/lib/api-publica';
import estilos from '../api/api.module.css';

export interface CamposWebhookProps {
  url: string;
  eventos: readonly string[];
  errores?: { url?: string; eventos?: string };
}

/** URL y eventos de un webhook: los comparten el alta y la edición. */
export function CamposWebhook({ url, eventos, errores }: CamposWebhookProps) {
  const idEventos = useId();
  return (
    <>
      <Campo
        etiqueta="URL"
        anchoCompleto
        ayuda="Un endpoint https público de tu sistema, en el puerto 443. No seguimos redirecciones."
        error={errores?.url}
      >
        <Input
          name="url"
          type="url"
          inputMode="url"
          required
          maxLength={MAXIMO_URL_WEBHOOK}
          autoComplete="off"
          spellCheck={false}
          mono
          placeholder="https://tu-sistema.cl/webhooks/boleteame"
          defaultValue={url}
        />
      </Campo>
      <fieldset
        className={estilos.opciones}
        aria-describedby={errores?.eventos ? `${idEventos}-error` : undefined}
      >
        <legend>Eventos</legend>
        {EVENTOS_WEBHOOK.map((evento) => (
          <label key={evento} className={estilos.casilla}>
            <input
              type="checkbox"
              name="eventos"
              value={evento}
              defaultChecked={eventos.includes(evento)}
            />
            <span className={estilos.casillaTexto}>
              <span className={estilos.mono}>{evento}</span>
              <span className={estilos.casillaAyuda}>{DESCRIPCION_EVENTO[evento]}</span>
            </span>
          </label>
        ))}
        {errores?.eventos ? (
          <p id={`${idEventos}-error`} className={estilos.errorCampo}>
            {errores.eventos}
          </p>
        ) : null}
      </fieldset>
    </>
  );
}
