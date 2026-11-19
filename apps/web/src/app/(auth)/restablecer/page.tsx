import type { Metadata } from 'next';
import { obtenerUsuario } from '@/server/sesion';
import { SinSesionRecuperacion } from '../_compartido/piezas';
import { FormRestablecer } from './FormRestablecer';

// Fuera de los buscadores: solo sirve con la sesión del enlace del correo.
export const metadata: Metadata = {
  title: 'Restablecer contraseña',
  robots: { index: false, follow: false },
};

// Se llega desde el enlace de recuperación: /auth/callback abre la sesión y redirige
// aquí. Sin sesión no hay a quién cambiarle la contraseña.
export default async function PaginaRestablecer() {
  const usuario = await obtenerUsuario();
  if (!usuario) return <SinSesionRecuperacion />;
  return <FormRestablecer correo={usuario.correo} />;
}
