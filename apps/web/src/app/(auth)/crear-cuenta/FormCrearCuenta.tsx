'use client';

import type { ReactElement } from 'react';
import { Alerta, Boton, Campo, Input } from '@/components/timbre';
import { Turnstile } from '@/components/turnstile/Turnstile';
import estilos from '../_compartido/auth.module.css';
import { CampoClave } from '../_compartido/CampoClave';
import {
  esquemaCrearCuenta,
  LARGO_MINIMO_CLAVE,
  leerCampos,
  validar,
} from '../_compartido/esquemas';
import {
  conSiguiente,
  EnlaceBoton,
  RevisaTuCorreo,
  Separador,
  Titulos,
} from '../_compartido/piezas';
import { useFormularioAuth } from '../_compartido/useFormularioAuth';
import { crearCuenta } from '../acciones';

function validarCrearCuenta(datos: FormData) {
  const v = validar(esquemaCrearCuenta, leerCampos(datos, ['nombre', 'correo', 'clave']));
  return v.ok ? null : v.errores;
}

export function FormCrearCuenta({ siguiente }: { siguiente: string }): ReactElement {
  const f = useFormularioAuth(crearCuenta, validarCrearCuenta);

  if (f.estado.enviado) {
    return (
      <RevisaTuCorreo
        volver={{ texto: 'Volver a ingresar', href: conSiguiente('/ingresar', siguiente) }}
      >
        Te enviamos un enlace a <strong>{f.estado.enviado.correo}</strong> para confirmar tu cuenta.
        Ábrelo para terminar. Si ya tenías una cuenta con ese correo, ingresa o recupera tu
        contraseña.
      </RevisaTuCorreo>
    );
  }

  return (
    <>
      <Titulos
        titulo="Crear cuenta"
        nota="Después podrás registrar tu organización y tus empresas."
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
        <input type="hidden" name="siguiente" value={siguiente} />
        <Campo etiqueta="Nombre" error={f.errores.nombre} anchoCompleto>
          <Input type="text" name="nombre" autoComplete="name" required maxLength={100} />
        </Campo>
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
          autoComplete="new-password"
          error={f.errores.clave}
          ayuda={`Al menos ${LARGO_MINIMO_CLAVE} caracteres.`}
          minLength={LARGO_MINIMO_CLAVE}
        />
        <Turnstile accion="crear-cuenta" {...f.propsTurnstile} />
        <Boton
          type="submit"
          variante="primario"
          className={estilos.botonGrande}
          disabled={f.pendiente}
        >
          {f.pendiente ? 'Creando cuenta…' : 'Crear cuenta'}
        </Boton>
      </form>

      <Separador>¿Ya tienes cuenta?</Separador>
      <EnlaceBoton href={conSiguiente('/ingresar', siguiente)}>Ingresar</EnlaceBoton>
    </>
  );
}
