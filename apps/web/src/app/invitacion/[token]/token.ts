// Forma del token de invitación: `token_aleatorio()` en 0001_esquema_inicial.sql son
// dos uuid v4 sin guiones (64 caracteres hex en minúsculas). Lo que no calza ni se
// consulta en la base: es una invitación inválida.
export const FORMA_TOKEN_INVITACION = /^[0-9a-f]{64}$/;

export function esTokenInvitacion(token: unknown): token is string {
  return typeof token === 'string' && FORMA_TOKEN_INVITACION.test(token);
}

/** Ruta de la invitación (para `?siguiente=`). */
export function rutaInvitacion(token: string): string {
  return `/invitacion/${token}`;
}
