'use client';

import { useActionState, useState } from 'react';
import { Alerta, Boton, Campo, Input } from '@/components/timbre';
import { crearOrganizacion, type EstadoCrearOrganizacion } from './acciones';
import estilos from './bienvenida.module.css';
import { LARGO_MAXIMO_NOMBRE, LARGO_MAXIMO_SLUG, sugerirSlug, validarSlug } from './slug';

export function FormularioOrganizacion() {
  const [estado, accion, enviando] = useActionState<EstadoCrearOrganizacion | null, FormData>(
    crearOrganizacion,
    null,
  );
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  // Mientras no se edite a mano, la dirección sigue al nombre.
  const [slugEditado, setSlugEditado] = useState(false);

  const errorSlugLocal = slug.length > 0 ? validarSlug(slug) : null;
  const errorSlug = estado?.errores?.slug ?? errorSlugLocal;

  return (
    <form action={accion} className={estilos.formulario} noValidate>
      {estado?.error ? <Alerta tono="error" titulo={estado.error} /> : null}

      <Campo etiqueta="Nombre de la organización" error={estado?.errores?.nombre} anchoCompleto>
        <Input
          name="nombre"
          value={nombre}
          onChange={(e) => {
            const valor = e.target.value;
            setNombre(valor);
            if (!slugEditado) setSlug(sugerirSlug(valor));
          }}
          required
          maxLength={LARGO_MAXIMO_NOMBRE}
          autoComplete="organization"
          placeholder="Servicios Andinos"
        />
      </Campo>

      <Campo
        etiqueta="Dirección"
        ayuda={`Tu tablero quedará en /${slug || 'tu-organizacion'}/tablero. Solo minúsculas, números y guiones.`}
        error={errorSlug}
        anchoCompleto
      >
        <Input
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugEditado(true);
            setSlug(e.target.value.toLowerCase());
          }}
          required
          mono
          maxLength={LARGO_MAXIMO_SLUG}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="servicios-andinos"
        />
      </Campo>

      <Boton
        type="submit"
        variante="primario"
        className={estilos.botonGrande}
        disabled={enviando}
        aria-disabled={enviando || undefined}
      >
        {enviando ? 'Creando la organización…' : 'Crear organización'}
      </Boton>
    </form>
  );
}
