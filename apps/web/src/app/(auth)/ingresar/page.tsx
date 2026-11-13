import type { Metadata } from 'next';
import { destinoSeguro } from '@/lib/redireccion';
import { primerValor } from '../_compartido/piezas';
import { FormIngresar } from './FormIngresar';

export const metadata: Metadata = { title: 'Ingresar · Boletéame' };

type Parametros = Record<string, string | string[] | undefined>;

export default async function PaginaIngresar({
  searchParams,
}: {
  searchParams: Promise<Parametros>;
}) {
  const parametros = await searchParams;
  // Solo rutas internas; si no, no se propaga (y la acción irá a /bienvenida).
  const siguiente = destinoSeguro(primerValor(parametros.siguiente), '');
  const errorEnlace = primerValor(parametros.error) === 'enlace';
  return <FormIngresar siguiente={siguiente} errorEnlace={errorEnlace} />;
}
