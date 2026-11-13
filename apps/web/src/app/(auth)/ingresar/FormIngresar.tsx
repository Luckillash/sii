'use client';

import Link from 'next/link';
import { type FormEvent, type ReactElement, useState } from 'react';
import { Alerta, Boton, Campo, Input } from '@/components/boleteame';
import { Turnstile } from '@/components/turnstile/Turnstile';
import estilos from '../_compartido/auth.module.css';
import { CampoClave } from '../_compartido/CampoClave';
import { esquemaEnlace, esquemaIngresar, leerCampos, validar } from '../_compartido/esquemas';
import type { EstadoAuth } from '../_compartido/estado';
import {
  conSiguiente,
  EnlaceBoton,
  RevisaTuCorreo,
  Separador,
  Titulos,
} from '../_compartido/piezas';
import { useFormularioAuth } from '../_compartido/useFormularioAuth';
import { ingresar } from '../acciones';

function validarIngreso(datos: FormData) {
  const v =
    datos.get('modo') === 'enlace'
      ? validar(esquemaEnlace, leerCampos(datos, ['correo']))
      : validar(esquemaIngresar, leerCampos(datos, ['correo', 'clave']));
  return v.ok ? null : v.errores;
}

export function FormIngresar({
  siguiente,
  errorEnlace,
}: {
  siguiente: string;
  errorEnlace: boolean;
}): ReactElement {
  const f = useFormularioAuth(ingresar, validarIngreso);
  const [modo, setModo] = useState<'clave' | 'enlace'>('clave');
  // «Usar otro correo» vuelve al formulario sin perder el estado de la acción.
  const [descartado, setDescartado] = useState<EstadoAuth | null>(null);

  if (f.estado.enviado && f.estado !== descartado) {
    return (
      <RevisaTuCorreo volver={{ texto: 'Volver', alPulsar: () => setDescartado(f.estado) }}>
        Si hay una cuenta con <strong>{f.estado.enviado.correo}</strong>, te enviamos un enlace para
        ingresar. Sirve una sola vez y vence en poco tiempo.
      </RevisaTuCorreo>
    );
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    const boton = (evento.nativeEvent as SubmitEvent).submitter;
    setModo(boton instanceof HTMLButtonElement && boton.value === 'enlace' ? 'enlace' : 'clave');
    f.alEnviar(evento);
  }

  return (
    <>
      <Titulos titulo="Ingresar" nota="Usa el correo con el que creaste tu cuenta." />

      {errorEnlace ? (
        <Alerta tono="aviso" titulo="El enlace venció o ya se usó.">
          Los enlaces de los correos sirven una sola vez y por poco tiempo. Pide uno nuevo o ingresa
          con tu contraseña.
        </Alerta>
      ) : null}
      {f.mensaje ? <Alerta tono="error">{f.mensaje}</Alerta> : null}

      <form
        ref={f.formulario}
        action={f.despachar}
        onSubmit={alEnviar}
        noValidate
        aria-busy={f.pendiente}
        className={estilos.formulario}
      >
        <input type="hidden" name="siguiente" value={siguiente} />
        <Campo etiqueta="Correo electrónico" error={f.errores.correo} anchoCompleto>
          <Input
            type="email"
            name="correo"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nombre@empresa.cl"
            required
          />
        </Campo>
        <CampoClave
          autoComplete="current-password"
          error={f.errores.clave}
          accesorio={<Link href="/recuperar">¿Olvidaste tu contraseña?</Link>}
        />
        <Turnstile accion="ingresar" {...f.propsTurnstile} />
        <Boton
          type="submit"
          name="modo"
          value="clave"
          variante="primario"
          className={estilos.botonGrande}
          disabled={f.pendiente}
        >
          {f.pendiente && modo === 'clave' ? 'Ingresando…' : 'Ingresar'}
        </Boton>
        <Boton type="submit" name="modo" value="enlace" variante="discreto" disabled={f.pendiente}>
          {f.pendiente && modo === 'enlace' ? 'Enviando enlace…' : 'Recibir un enlace por correo'}
        </Boton>
      </form>

      <Separador>¿Aún no tienes cuenta?</Separador>
      <EnlaceBoton href={conSiguiente('/crear-cuenta', siguiente)}>Crear cuenta</EnlaceBoton>

      <p className={estilos.notaPequena}>
        Para emitir necesitarás tu certificado digital (.pfx) y el RUT de la empresa. Puedes
        cargarlos después de ingresar.
      </p>
    </>
  );
}
