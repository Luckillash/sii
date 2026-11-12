import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import type { RolMiembro } from '@/lib/permisos';
import { envAuth } from './env';
import { clienteServidor } from './supabase/servidor';

// Lecturas del equipo de una organización, siempre con la sesión del usuario (RLS):
// `miembros_organizacion` la ve cualquier miembro; `invitaciones` solo los
// administradores (para el resto la consulta devuelve cero filas, sin error).
// No hace falta service_role: `perfiles` es legible entre compañeros
// (`comparte_organizacion`) y los planes y la suscripción, por los miembros.

export interface Miembro {
  usuarioId: string;
  nombre: string | null;
  /** `perfiles.correo` (puede quedar atrasado si la persona cambió su correo en Auth). */
  correo: string | null;
  rol: RolMiembro;
  /** ISO: cuándo se unió. */
  desde: string;
}

export interface InvitacionPendiente {
  id: string;
  correo: string;
  rol: RolMiembro;
  /** ISO. */
  expiraEn: string;
  creadaEn: string;
  vencida: boolean;
}

export interface CupoUsuarios {
  plan: string | null;
  /** `null` = ilimitado (o sin suscripción vigente legible). */
  maximo: number | null;
  usados: number;
}

const ORDEN_ROL: Record<RolMiembro, number> = {
  propietario: 0,
  administrador: 1,
  emisor: 2,
  lector: 3,
};

export const listarMiembros = cache(async (organizacionId: string): Promise<Miembro[]> => {
  const supabase = await clienteServidor();
  const { data: filas, error } = await supabase
    .from('miembros_organizacion')
    .select('usuario_id, rol, creado_en')
    .eq('organizacion_id', organizacionId);
  if (error) throw new Error(`No se pudo leer el equipo: ${error.message}`);
  if (filas.length === 0) return [];

  // Sin FK entre miembros_organizacion y perfiles (ambas apuntan a auth.users), así que
  // PostgREST no puede embeberlas: segunda consulta.
  const { data: perfiles, error: errorPerfiles } = await supabase
    .from('perfiles')
    .select('id, nombre, correo')
    .in(
      'id',
      filas.map((f) => f.usuario_id),
    );
  if (errorPerfiles) throw new Error(`No se pudieron leer los perfiles: ${errorPerfiles.message}`);
  const porId = new Map(perfiles.map((p) => [p.id, p]));

  return filas
    .map((f) => ({
      usuarioId: f.usuario_id,
      nombre: porId.get(f.usuario_id)?.nombre ?? null,
      correo: porId.get(f.usuario_id)?.correo ?? null,
      rol: f.rol,
      desde: f.creado_en,
    }))
    .sort(
      (a, b) =>
        ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] ||
        (a.nombre ?? a.correo ?? '').localeCompare(b.nombre ?? b.correo ?? '', 'es-CL'),
    );
});

/** Invitaciones sin aceptar (vigentes y vencidas). `[]` para quien no es administrador. */
export async function listarInvitaciones(organizacionId: string): Promise<InvitacionPendiente[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('invitaciones')
    .select('id, correo, rol, expira_en, creado_en')
    .eq('organizacion_id', organizacionId)
    .is('aceptada_en', null)
    .order('creado_en', { ascending: false });
  if (error) throw new Error(`No se pudieron leer las invitaciones: ${error.message}`);
  const ahora = Date.now();
  return data.map((i) => ({
    id: i.id,
    correo: i.correo,
    rol: i.rol,
    expiraEn: i.expira_en,
    creadaEn: i.creado_en,
    vencida: new Date(i.expira_en).getTime() <= ahora,
  }));
}

/**
 * Cupo de usuarios del plan vigente (`plan_vigente()`: suscripción en prueba o activa,
 * la más reciente). Solo para avisar antes de invitar: la autoridad es
 * `exigir_cupo_usuarios()` al aceptar.
 */
export async function cupoUsuarios(organizacionId: string): Promise<CupoUsuarios> {
  const supabase = await clienteServidor();
  const [suscripcion, miembros] = await Promise.all([
    supabase
      .from('suscripciones')
      .select('creado_en, planes (nombre, max_usuarios)')
      .eq('organizacion_id', organizacionId)
      .in('estado', ['prueba', 'activa'])
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('miembros_organizacion')
      .select('usuario_id', { count: 'exact', head: true })
      .eq('organizacion_id', organizacionId),
  ]);
  const plan = suscripcion.data?.planes ?? null;
  return {
    plan: plan?.nombre ?? null,
    maximo: plan?.max_usuarios ?? null,
    usados: miembros.count ?? 0,
  };
}

/**
 * Origen público de la app para los enlaces de los correos: `NEXT_PUBLIC_APP_URL`. Si
 * falta (configuración incompleta en desarrollo), el de la petición actual.
 */
export async function urlBaseApp(): Promise<string> {
  try {
    return envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  } catch {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const protocolo =
      h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${protocolo}://${host}`;
  }
}
