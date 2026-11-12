'use client';

import { type FormEvent, useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { type ControlTurnstile, turnstileConfigurado } from '@/components/turnstile/Turnstile';
import type { ErroresCampos } from './esquemas';
import { ESTADO_INICIAL, type EstadoAuth } from './estado';

type Accion = (previo: EstadoAuth, datos: FormData) => Promise<EstadoAuth>;

/** Valida en el cliente; `null` si todo está bien. */
type ValidarCliente = (datos: FormData) => ErroresCampos | null;

export const MENSAJE_ESPERAR_VERIFICACION =
  'Espera a que termine la verificación de seguridad y vuelve a enviar el formulario.';

/**
 * Estado común de los formularios de acceso:
 *
 * - `useActionState` con la Server Action; el envío pasa por `onSubmit` para validar
 *   antes con el mismo esquema zod y para que React no limpie los campos al responder.
 *   Sin JavaScript el `<form action>` igual funciona (la acción valida de nuevo).
 * - Token de Turnstile: se agrega como `captchaToken`; si el widget está activo y aún
 *   no hay token, no se envía. Tras cada respuesta se pide uno nuevo (son de un uso).
 * - Foco al primer campo con error, tanto del cliente como del servidor.
 */
export function useFormularioAuth(accion: Accion, validarCliente: ValidarCliente) {
  const [estado, despachar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [, iniciarTransicion] = useTransition();
  const [erroresLocales, setErroresLocales] = useState<ErroresCampos | null>(null);
  const [mensajeLocal, setMensajeLocal] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const turnstile = useRef<ControlTurnstile>(null);

  // Cada respuesta del servidor es un objeto nuevo: el token ya se gastó.
  const estadoAnterior = useRef(estado);
  useEffect(() => {
    if (estadoAnterior.current === estado) return;
    estadoAnterior.current = estado;
    turnstile.current?.reiniciar();
  }, [estado]);

  // Foco al primer campo inválido cuando llegan errores nuevos.
  useEffect(() => {
    if (!erroresLocales && !estado.errores) return;
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [erroresLocales, estado]);

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const boton = (evento.nativeEvent as SubmitEvent).submitter;
    const datos = new FormData(
      evento.currentTarget,
      boton instanceof HTMLButtonElement ? boton : null,
    );

    const errores = validarCliente(datos);
    if (errores) {
      setMensajeLocal(null);
      setErroresLocales(errores);
      return;
    }
    if (turnstileConfigurado() && !token) {
      setErroresLocales(null);
      setMensajeLocal(MENSAJE_ESPERAR_VERIFICACION);
      return;
    }
    if (token) datos.set('captchaToken', token);
    setErroresLocales(null);
    setMensajeLocal(null);
    iniciarTransicion(() => despachar(datos));
  }

  // Mientras se envía no se muestran los errores de la respuesta anterior.
  const errores: ErroresCampos = erroresLocales ?? (pendiente ? {} : (estado.errores ?? {}));
  const mensaje = mensajeLocal ?? (pendiente ? undefined : estado.mensaje);

  return {
    estado,
    errores,
    mensaje,
    pendiente,
    /** Para `<form action>` (sin JavaScript). */
    despachar,
    alEnviar,
    formulario,
    propsTurnstile: { ref: turnstile, onToken: setToken },
  };
}
