import 'server-only';
import { clienteServidor } from '../supabase/servidor';

/**
 * Confirma contra Auth que la sesión sigue viva y es de `usuarioId`, antes de una
 * operación sensible (subir, revocar o eliminar un certificado).
 *
 * `exigirMembresia()` usa `getClaims()`, que verifica el JWT localmente: un token de
 * una sesión revocada o de un usuario baneado sigue valiendo hasta su `exp`.
 * `getUser()` le pregunta a Auth (documentación/01-fundamentos/ambientes-y-credenciales.md,
 * «Sesiones de usuario y revocación», regla 2).
 */
export async function confirmarSesion(usuarioId: string): Promise<boolean> {
  try {
    const supabase = await clienteServidor();
    const { data, error } = await supabase.auth.getUser();
    return !error && data.user?.id === usuarioId;
  } catch {
    return false;
  }
}
