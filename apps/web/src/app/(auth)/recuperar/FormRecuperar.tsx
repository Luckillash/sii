'use client';

import Link from 'next/link';
import { type ReactElement, useState } from 'react';
import { Alerta, Boton, Campo, Input } from '@/components/timbre';
import { Turnstile } from '@/components/turnstile/Turnstile';
import estilos from '../_compartido/auth.module.css';
import { esquemaRecuperar, leerCampos, validar } from '../_compartido/esquemas';
import type { EstadoAuth } from '../_compartido/estado';
import { RevisaTuCorreo, Titulos } from '../_compartido/piezas';
import { useFormularioAuth } from '../_compartido/useFormularioAuth';
import { recuperar } from '../acciones';

function validarRecuperar(datos: FormData) {
  const v = validar(esquemaRecuperar, leerCampos(datos, ['correo']));
  return v.ok ? null : v.errores;
}

export function FormRecuperar(): ReactElement {
  const f = useFormularioAuth(recuperar, validarRecuperar);
  const [descartado, setDescartado] = useState<EstadoAuth | null>(null);

  if (f.estado.enviado && f.estado !== descartado) {
    return (
      <RevisaTuCorreo
        volver={{ texto: 'Usar otro correo', alPulsar: () => setDescartado(f.estado) }}
      >
        Si hay una cuenta con <strong>{f.estado.enviado.correo}</strong>, te enviamos un enlace para
        crear una contraseña nueva. Sirve una sola vez y vence en poco tiempo.
      </RevisaTuCorreo>
    );
  }

  return (
    <>
      <Titulos
        titulo="Recuperar contraseña"
        nota="Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva."
      />
      {f.mensaje ? <Alerta tono="error">{f.mensaje}</Alerta> : null}

      <form
        ref={f.formulario}
        action={f.despachar}
        onSubmit={f.alEnviar}
        noValidate
        aria-busy={f.pendiente}
        className={estilos.formulario}
      >
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
        <Turnstile accion="recuperar" {...f.propsTurnstile} />
        <Boton
          type="submit"
          variante="primario"
          className={estilos.botonGrande}
          disabled={f.pendiente}
        >
          {f.pendiente ? 'Enviando…' : 'Enviar enlace'}
        </Boton>
      </form>

      <Link href="/ingresar" className={estilos.enlace}>
        Volver a ingresar
      </Link>
    </>
  );
}
