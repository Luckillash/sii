'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { obtenerUsuario } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';
import { traducirErrorOrganizacion, validarNombre, validarSlug } from './slug';

// Onboarding (PLAN-SAAS Fase 2, punto 3): crear la organización con
// `crear_organizacion(nombre, slug)`, que deja al usuario como propietario y suscribe
// la organización al plan Certificación en prueba (30 días).

export interface EstadoCrearOrganizacion {
  /** Error general (qué pasó y qué hacer). */
  error?: string;
  errores?: { nombre?: string; slug?: string };
}

const esquema = z
  .object({
    nombre: z.string().trim(),
    slug: z.string().trim().toLowerCase(),
  })
  .superRefine((datos, ctx) => {
    const errorNombre = validarNombre(datos.nombre);
    if (errorNombre) ctx.addIssue({ code: 'custom', path: ['nombre'], message: errorNombre });
    const errorSlug = validarSlug(datos.slug);
    if (errorSlug) ctx.addIssue({ code: 'custom', path: ['slug'], message: errorSlug });
  });

export async function crearOrganizacion(
  _anterior: EstadoCrearOrganizacion | null,
  formulario: FormData,
): Promise<EstadoCrearOrganizacion> {
  // Toda Server Action verifica la sesión por su cuenta (el proxy no la cubre).
  const usuario = await obtenerUsuario();
  if (!usuario) {
    return { error: 'Tu sesión expiró. Vuelve a ingresar y crea la organización de nuevo.' };
  }

  const resultado = esquema.safeParse({
    nombre: formulario.get('nombre') ?? '',
    slug: formulario.get('slug') ?? '',
  });
  if (!resultado.success) {
    const errores: EstadoCrearOrganizacion['errores'] = {};
    for (const issue of resultado.error.issues) {
      const campo = issue.path[0];
      if ((campo === 'nombre' || campo === 'slug') && !errores[campo]) {
        errores[campo] = issue.message;
      }
    }
    return { errores };
  }

  const { nombre, slug } = resultado.data;
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc('crear_organizacion', { p_nombre: nombre, p_slug: slug });
  if (error) {
    const traducido = traducirErrorOrganizacion(error);
    if (traducido.campo === null) {
      console.error('crear_organizacion falló', { codigo: error.code, mensaje: error.message });
      return { error: traducido.mensaje };
    }
    return { errores: { slug: traducido.mensaje } };
  }

  // Fuera de cualquier try/catch: redirect() lanza.
  redirect(`/${slug}/tablero`);
}
