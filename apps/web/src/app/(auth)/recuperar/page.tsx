import type { Metadata } from 'next';
import { FormRecuperar } from './FormRecuperar';

// Fuera de los buscadores: solo se llega desde «¿Olvidaste tu contraseña?».
export const metadata: Metadata = {
  title: 'Recuperar contraseña',
  robots: { index: false, follow: true },
};

export default function PaginaRecuperar() {
  return <FormRecuperar />;
}
