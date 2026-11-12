'use client';

import type { ReactElement } from 'react';
import { Alerta, Boton } from '@/components/timbre';
import estilos from '../_compartido/auth.module.css';
import { CampoClave } from '../_compartido/CampoClave';
import {
  esquemaRestablecer,
  LARGO_MINIMO_CLAVE,
  leerCampos,
  validar,
} from '../_compartido/esquemas';
import { SinSesionRecuperacion, Titulos } from '../_compartido/piezas';
import { useFormularioAuth } from '../_compartido/useFormularioAuth';
import { restablecer } from '../acciones';

function validarRestablecer(datos: FormData) {
  const v = validar(esquemaRestablecer, leerCampos(datos, ['clave']));
  return v.ok ? null : v.errores;
}

// Sin Turnstile: `updateUser` no pide captcha (ya hay sesión).
export function FormRestablecer({ correo }: { correo: string }): ReactElement {
  const f = useFormularioAuth(restablecer, validarRestablecer);

  if (f.estado.sinSesion) return <SinSesionRecuperacion />;

  return (
    <>
      <Titulos
        titulo="Crear contraseña nueva"
        nota={
          correo ? (
            <>
              Para <strong>{correo}</strong>. Después seguirás con tu sesión abierta.
            </>
          ) : (
            'Después seguirás con tu sesión abierta.'
          )
        }
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
        {/* Para que el gestor de contraseñas sepa a qué cuenta guardarla. */}
        <input type="email" autoComplete="username" value={correo} readOnly hidden />
        <CampoClave
          etiqueta="Contraseña nueva"
          autoComplete="new-password"
          error={f.errores.clave}
          ayuda={`Al menos ${LARGO_MINIMO_CLAVE} caracteres.`}
          minLength={LARGO_MINIMO_CLAVE}
        />
        <Boton
          type="submit"
          variante="primario"
          className={estilos.botonGrande}
          disabled={f.pendiente}
        >
          {f.pendiente ? 'Guardando…' : 'Guardar contraseña'}
        </Boton>
      </form>
    </>
  );
}
