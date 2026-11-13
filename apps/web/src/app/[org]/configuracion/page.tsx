import { Building2, KeyRound, type LucideIcon, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tarjeta } from '@/components/boleteame';
import { exigirMembresia } from '@/server/sesion';
import org from '../organizacion.module.css';

export const metadata: Metadata = { title: 'Configuración · Boletéame' };

// Empresas, certificados y equipo (Fases 2 y 3); plan, API y webhooks llegan en las
// fases siguientes (PLAN-SAAS §3.1).

type Seccion = {
  id: string;
  ruta: string;
  titulo: string;
  texto: string;
  enlace: string;
  icono: LucideIcon;
};

const SECCIONES: readonly Seccion[] = [
  {
    id: 'empresas',
    ruta: 'configuracion/empresas',
    titulo: 'Empresas',
    texto:
      'Registra las empresas que emiten, con sus datos tributarios y las resoluciones del SII.',
    enlace: 'Ir a Empresas',
    icono: Building2,
  },
  {
    id: 'certificados',
    ruta: 'configuracion/certificados',
    titulo: 'Certificados digitales',
    texto: 'Sube los certificados (.pfx) que firman tus documentos y revisa su vigencia.',
    enlace: 'Ir a Certificados',
    icono: KeyRound,
  },
  {
    id: 'equipo',
    ruta: 'configuracion/equipo',
    titulo: 'Equipo',
    texto: 'Invita a tu equipo, asigna roles y revisa las invitaciones pendientes.',
    enlace: 'Ir a Equipo',
    icono: Users,
  },
];

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

      {SECCIONES.map(({ id, ruta, titulo, texto, enlace, icono: Icono }) => (
        <Tarjeta key={id} as="section" aria-labelledby={`t-${id}`} className={org.tarjeta}>
          <h2 id={`t-${id}`} className={org.subtitulo}>
            <Icono size={20} strokeWidth={1.5} aria-hidden="true" /> {titulo}
          </h2>
          <p className={org.texto}>{texto}</p>
          <p>
            <Link href={`/${slug}/${ruta}`}>{enlace}</Link>
          </p>
        </Tarjeta>
      ))}
    </>
  );
}
