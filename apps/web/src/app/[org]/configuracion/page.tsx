import { Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tarjeta } from '@/components/timbre';
import { exigirMembresia } from '@/server/sesion';
import org from '../organizacion.module.css';

export const metadata: Metadata = { title: 'Configuración · Timbre' };

// Por ahora solo Equipo; empresa, certificados, plan, API y webhooks llegan en las
// fases siguientes (PLAN-SAAS §3.1).
export default async function PaginaConfiguracion({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const { organizacion } = await exigirMembresia(slug);

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>{organizacion.nombre}</p>
        <h1 className={org.titulo}>Configuración</h1>
      </header>

      <Tarjeta as="section" aria-labelledby="t-equipo" className={org.tarjeta}>
        <h2 id="t-equipo" className={org.subtitulo}>
          <Users size={20} strokeWidth={1.5} aria-hidden="true" /> Equipo
        </h2>
        <p className={org.texto}>
          Invita a tu equipo, asigna roles y revisa las invitaciones pendientes.
        </p>
        <p>
          <Link href={`/${slug}/configuracion/equipo`}>Ir a Equipo</Link>
        </p>
      </Tarjeta>
    </>
  );
}
