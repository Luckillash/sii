import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Tarjeta } from '@/components/boleteame';
import { puedeAdministrar } from '@/lib/permisos';
import { listarCertificados, listarEmpresasBasicas } from '@/server/certificados/consultas';
import { alertasCertificados } from '@/server/certificados/estado';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import estilos from './certificados.module.css';
import { FormularioCertificado } from './FormularioCertificado';
import { TablaCertificados } from './TablaCertificados';

export const metadata: Metadata = { title: 'Certificados · Boletéame' };

// La carga abre el .pfx con la librería (node-forge, node:crypto): nada de Edge.
export const runtime = 'nodejs';

export default async function PaginaCertificados({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [certificados, empresas] = await Promise.all([
    listarCertificados(organizacion.id),
    admin ? listarEmpresasBasicas(organizacion.id) : Promise.resolve([]),
  ]);
  const alertas = alertasCertificados(certificados);

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
        </p>
        <h1 className={org.titulo}>Certificados digitales</h1>
        <p className={org.texto}>
          Los certificados (.pfx) de quienes firman los documentos de la organización. Para
          asociarlos a una empresa, entra a la empresa desde{' '}
          <Link href={`/${slug}/configuracion/empresas`}>Empresas</Link>.
          {admin
            ? null
            : ' Solo un propietario o un administrador puede subir o quitar certificados.'}
        </p>
      </header>

      {alertas.length > 0 ? (
        <div className={estilos.avisos}>
          {alertas.map((a) => (
            <Alerta key={a.tono} tono={a.tono} titulo={a.titulo}>
              {a.detalle}
            </Alerta>
          ))}
        </div>
      ) : null}

      {admin ? (
        <Tarjeta as="section" aria-labelledby="t-subir" className={estilos.bloque}>
          <h2 id="t-subir" className={estilos.subtitulo}>
            Subir un certificado
          </h2>
          <FormularioCertificado slug={slug} empresas={empresas} />
        </Tarjeta>
      ) : null}

      <section aria-labelledby="t-certificados" className={estilos.seccion}>
        <h2 id="t-certificados" className={estilos.subtitulo}>
          Certificados cargados
        </h2>
        <TablaCertificados slug={slug} admin={admin} certificados={certificados} />
      </section>
    </>
  );
}
