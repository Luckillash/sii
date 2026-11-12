import type { Metadata } from 'next';
import { FormRecuperar } from './FormRecuperar';

export const metadata: Metadata = { title: 'Recuperar contraseña · Timbre' };

export default function PaginaRecuperar() {
  return <FormRecuperar />;
}
