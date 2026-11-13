import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Alerta } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import {
  listarAsociaciones,
  listarCertificados,
  obtenerEmpresaBasica,
} from '@/server/certificados/consultas';
import { exigirMembresia } from '@/server/sesion';
import org from '../../../../organizacion.module.css';
import { CertificadosEmpresa } from './CertificadosEmpresa';

export const metadata: Metadata = { title: 'Certificados de la empresa · Boletéame' };

const esquemaId = z.uuid();

export default async function PaginaCertificadosEmpresa({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  if (!esquemaId.safeParse(id).success) notFound();
  // Solo si la empresa es de esta organización (RLS además la oculta si es de otra).
  const empresa = await obtenerEmpresaBasica(organizacion.id, id);
  if (!empresa) notFound();

  const admin = puedeAdministrar(rol);
  const certificados = await listarCertificados(organizacion.id);
  const asociaciones = await listarAsociaciones(organizacion.id, empresa.id, certificados);
  const asociados = new Set(asociaciones.map((a) => a.certificado.id));
  const disponibles = certificados.filter(
    (c) => !asociados.has(c.id) && c.estado !== 'revocado' && c.estado !== 'vencido',
  );
  const rutaEmpresa = `/${slug}/configuracion/empresas/${empresa.id}`;

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> ·{' '}
          <Link href={`/${slug}/configuracion/empresas`}>Empresas</Link> ·{' '}
          <Link href={rutaEmpresa}>{empresa.razonSocial}</Link>
        </p>
        <h1 className={org.titulo}>Certificados de {empresa.razonSocial}</h1>
        <p className={org.texto}>
          RUT {formatearRut(empresa.rut)}. Qué certificados digitales firman los documentos de esta
          empresa y cuál se usa por omisión. Los certificados se suben en{' '}
          <Link href={`/${slug}/configuracion/certificados`}>Certificados</Link>.
        </p>
      </header>

      <Alerta tono="info" titulo="Para pedir folios, el titular debe ser representante electrónico">
        El SII solo entrega folios (CAF) si quien firma está registrado como representante
        electrónico de la empresa en sii.cl. Marca esa opción solo cuando el registro ya esté hecho:
        aquí no se hace ningún trámite ante el SII.
      </Alerta>

      <CertificadosEmpresa
        slug={slug}
        empresaId={empresa.id}
        razonSocial={empresa.razonSocial}
        admin={admin}
        asociaciones={asociaciones}
        disponibles={disponibles}
      />
    </>
  );
}
