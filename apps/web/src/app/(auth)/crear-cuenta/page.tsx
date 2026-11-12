import type { Metadata } from 'next';
import { destinoSeguro } from '@/lib/redireccion';
import { primerValor } from '../_compartido/piezas';
import { FormCrearCuenta } from './FormCrearCuenta';

export const metadata: Metadata = { title: 'Crear cuenta · Timbre' };

type Parametros = Record<string, string | string[] | undefined>;

export default async function PaginaCrearCuenta({
  searchParams,
}: {
  searchParams: Promise<Parametros>;
}) {
  const parametros = await searchParams;
  const siguiente = destinoSeguro(primerValor(parametros.siguiente), '');
  return <FormCrearCuenta siguiente={siguiente} />;
}
