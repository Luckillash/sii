'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { urlIngresar } from '@/lib/rutas';
import { type MensajeError, traducirErrorEquipo } from '@/server/equipo-errores';
import { obtenerUsuario } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';
import { ipCliente, verificarTurnstile } from '@/server/turnstile';
import { esTokenInvitacion, rutaInvitacion } from './token';

// Aceptar una invitación (PLAN-SAAS Fase 2, punto 4; §4.7). Turnstile se verifica en
// el servidor porque este formulario no pasa por Supabase Auth. `aceptar_invitacion()`
// exige que el correo de la sesión calce con el invitado y revisa el cupo del plan.
// El token no se registra en ningún log.

export interface EstadoAceptar {
  error: MensajeError;
}

const INVALIDA: MensajeError = {
  titulo: 'La invitación venció, ya se usó o no existe',
  detalle: 'Pide a quien te invitó que te envíe una nueva invitación.',
};

export async function aceptarInvitacion(
  token: string,
  _anterior: EstadoAceptar | null,
  formulario: FormData,
): Promise<EstadoAceptar> {
  if (!esTokenInvitacion(token)) return { error: INVALIDA };

  const usuario = await obtenerUsuario();
  if (!usuario) redirect(urlIngresar(rutaInvitacion(token)));

  const captcha = formulario.get('captcha');
  const verificacion = await verificarTurnstile(
    typeof captcha === 'string' ? captcha : null,
    ipCliente(await headers()),
  );
  if (!verificacion.ok) {
    return {
      error: { titulo: 'Falta la verificación de seguridad', detalle: verificacion.motivo },
    };
  }

  const supabase = await clienteServidor();
  const { data: organizacionId, error } = await supabase.rpc('aceptar_invitacion', {
    p_token: token,
  });
  if (error || !organizacionId) {
    const traducido = traducirErrorEquipo(error ?? {}, 'aceptar');
    // Sin el token: solo el código de Postgres.
    console.warn('aceptar_invitacion falló', { codigo: error?.code });
    return { error: traducido };
  }

  // Ya es miembro: RLS le deja leer el slug.
  const { data: organizacion } = await supabase
    .from('organizaciones')
    .select('slug')
    .eq('id', organizacionId)
    .maybeSingle();

  redirect(organizacion ? `/${organizacion.slug}/tablero` : '/bienvenida');
}
