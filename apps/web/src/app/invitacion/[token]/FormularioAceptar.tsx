'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { Alerta, Boton } from '@/components/boleteame';
import {
  type ControlTurnstile,
  Turnstile,
  turnstileConfigurado,
} from '@/components/turnstile/Turnstile';
import { aceptarInvitacion, type EstadoAceptar } from './acciones';
import estilos from './invitacion.module.css';

export interface FormularioAceptarProps {
  token: string;
  organizacion: string;
}

export function FormularioAceptar({ token, organizacion }: FormularioAceptarProps) {
  const aceptar = useMemo(() => aceptarInvitacion.bind(null, token), [token]);
  const [estado, accion, enviando] = useActionState<EstadoAceptar | null, FormData>(aceptar, null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<ControlTurnstile>(null);
  const exigeCaptcha = turnstileConfigurado();

  // Cada token de Turnstile sirve una vez: tras un error se pide otro.
  useEffect(() => {
    if (estado?.error) turnstile.current?.reiniciar();
  }, [estado]);

  return (
    <form action={accion} className={estilos.formulario}>
      {estado?.error ? (
        <Alerta tono="error" titulo={estado.error.titulo}>
          {estado.error.detalle}
        </Alerta>
      ) : null}
      <Turnstile ref={turnstile} onToken={setCaptcha} accion="invitacion" />
      <input type="hidden" name="captcha" value={captcha ?? ''} />
      <Boton
        type="submit"
        variante="primario"
        className={estilos.botonGrande}
        disabled={enviando || (exigeCaptcha && !captcha)}
      >
        {enviando ? 'Uniéndote…' : `Unirme a ${organizacion}`}
      </Boton>
    </form>
  );
}
