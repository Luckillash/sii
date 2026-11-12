import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { RolMiembro } from '@/lib/permisos';
import { esTema, type Tema } from '@/lib/preferencias';
import { urlIngresar } from '@/lib/rutas';
import { clienteServidor } from './supabase/servidor';

// Capa de acceso a la sesión (DAL, guía de autenticación de Next). Todo con el
// cliente de sesión, así que cada lectura pasa por RLS.
//
// `cache` de React evita repetir la misma consulta dentro de un render (layout +
// página + componentes). En Server Actions y Route Handlers no hay render: ahí cada
// llamada consulta de nuevo, lo que está bien porque son puntuales.

export type Usuario = { id: string; correo: string };

export type Membresia = {
  organizacionId: string;
  slug: string;
  nombre: string;
  rol: RolMiembro;
};

export type OrganizacionActual = { id: string; slug: string; nombre: string };

export type ContextoOrganizacion = {
  usuario: Usuario;
  organizacion: OrganizacionActual;
  rol: RolMiembro;
};

export type Perfil = {
  nombre: string | null;
  /** Correo de Auth (fuente de verdad; `perfiles.correo` puede quedar atrasado). */
  correo: string;
  tema: Tema;
  /**
   * Última organización abierta: solo una pista para `/bienvenida`. Puede apuntar a una
   * organización de la que ya no es miembro: confirmar con `obtenerMembresias()`.
   */
  ultimaOrganizacion: string | null;
  /** Última empresa abierta (misma advertencia). */
  ultimaEmpresa: string | null;
};

/**
 * Usuario de la sesión actual, o `null` si no hay sesión válida.
 *
 * Usa `getClaims()`, que verifica el JWT (con las llaves asimétricas del proyecto o,
 * con la clave simétrica, preguntando a Auth). Nunca `getSession()` en el servidor.
 */
export const obtenerUsuario = cache(async (): Promise<Usuario | null> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return { id: data.claims.sub, correo: data.claims.email ?? '' };
});

/**
 * Igual que `obtenerUsuario()`, pero sin sesión redirige a `/ingresar` (sin
 * `siguiente`: el proxy ya lo agrega al proteger la ruta; aquí no se conoce la URL).
 */
export async function exigirUsuario(): Promise<Usuario> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect(urlIngresar());
  return usuario;
}

/**
 * Organizaciones del usuario con su rol, ordenadas por nombre. `[]` sin sesión.
 * RLS (`es_miembro`) ya limita `organizaciones` a las propias; el filtro por
 * `usuario_id` deja fuera las filas de los compañeros de equipo.
 */
export const obtenerMembresias = cache(async (): Promise<Membresia[]> => {
  const usuario = await obtenerUsuario();
  if (!usuario) return [];

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('miembros_organizacion')
    .select('rol, organizaciones!inner (id, slug, nombre)')
    .eq('usuario_id', usuario.id);
  if (error) throw new Error(`No se pudieron leer las organizaciones: ${error.message}`);

  return data
    .map((fila) => ({
      organizacionId: fila.organizaciones.id,
      slug: fila.organizaciones.slug,
      nombre: fila.organizaciones.nombre,
      rol: fila.rol,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-CL'));
});

/**
 * Para las páginas de `/[org]/*`: exige sesión y que el usuario sea miembro de la
 * organización `slug`. Si no lo es, `notFound()` (404), igual que si no existiera:
 * no se revela qué organizaciones existen.
 */
export async function exigirMembresia(slug: string): Promise<ContextoOrganizacion> {
  const usuario = await exigirUsuario();
  const membresia = (await obtenerMembresias()).find((m) => m.slug === slug);
  if (!membresia) notFound();
  return {
    usuario,
    organizacion: { id: membresia.organizacionId, slug: membresia.slug, nombre: membresia.nombre },
    rol: membresia.rol,
  };
}

/**
 * Perfil y preferencias del usuario, o `null` sin sesión. Si la fila de `perfiles`
 * no existe (la crea `tg_nuevo_usuario` al registrarse), devuelve valores por omisión.
 *
 * Requiere la migración 0003_preferencias (columnas `tema`, `ultima_organizacion`,
 * `ultima_empresa`): sin ella la consulta falla y lanza.
 */
export const obtenerPerfil = cache(async (): Promise<Perfil | null> => {
  const usuario = await obtenerUsuario();
  if (!usuario) return null;

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('perfiles')
    .select('nombre, tema, ultima_organizacion, ultima_empresa')
    .eq('id', usuario.id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el perfil: ${error.message}`);

  const tema = data?.tema;
  return {
    nombre: data?.nombre ?? null,
    correo: usuario.correo,
    tema: esTema(tema) ? tema : 'sistema',
    ultimaOrganizacion: data?.ultima_organizacion ?? null,
    ultimaEmpresa: data?.ultima_empresa ?? null,
  };
});
