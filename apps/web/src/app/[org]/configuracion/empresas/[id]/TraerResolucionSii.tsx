'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton } from '@/components/boleteame';
import type { ResultadoPaso } from '@/lib/certificacion';
import { verificarAutorizacion } from '../../../certificacion/acciones';
import estilos from '../empresas.module.css';

// «Traer del SII» (PLAN-SAAS Fase 5, «Verificar autorización en el SII»): la misma acción
// del asistente de certificación. Pregunta al SII (palena, con el certificado
// predeterminado) si la empresa está autorizada y, si lo está, registra su resolución de
// producción. Solo lectura en el SII; la página se recarga sola (la acción revalida esta
// ruta).

export interface TraerResolucionSiiProps {
  slug: string;
  empresaId: string;
}

export function TraerResolucionSii({ slug, empresaId }: TraerResolucionSiiProps) {
  const [resultado, setResultado] = useState<Exclude<ResultadoPaso, { tipo: 'ensayo' }> | null>(
    null,
  );
  const [pendiente, iniciar] = useTransition();

  function traer() {
    setResultado(null);
    iniciar(async () => {
      const r = await verificarAutorizacion(slug, empresaId);
      if (r.tipo !== 'ensayo') setResultado(r);
    });
  }

  return (
    <div className={estilos.bloque}>
      <p className={estilos.nota}>
        Si la empresa ya está autorizada a emitir en producción, el SII puede informar su
        resolución: hace falta que el titular del certificado predeterminado sea su representante
        legal. Solo consulta al SII; si confirma la autorización, registra esa resolución.
      </p>
      <div>
        <Boton variante="secundario" onClick={traer} disabled={pendiente}>
          {pendiente ? 'Consultando al SII…' : 'Traer del SII'}
        </Boton>
      </div>
      <div aria-live="polite" className={estilos.avisos}>
        {resultado?.tipo === 'ok' ? (
          <Alerta tono={resultado.tono ?? 'exito'} titulo={resultado.mensaje.titulo}>
            {resultado.mensaje.detalle ? <p>{resultado.mensaje.detalle}</p> : null}
            {resultado.avisos?.map((a) => (
              <p key={a}>{a}</p>
            ))}
            {resultado.sugerencia === 'registrarResolucion' ? (
              <p>Puedes registrarla con el formulario de abajo.</p>
            ) : null}
          </Alerta>
        ) : null}
        {resultado?.tipo === 'error' ? (
          <Alerta tono="error" titulo={resultado.mensaje.titulo}>
            {resultado.mensaje.detalle}
          </Alerta>
        ) : null}
      </div>
    </div>
  );
}
