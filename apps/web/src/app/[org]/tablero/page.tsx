import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, clasesBoton, Tarjeta } from '@/components/boleteame';
import { puedeAdministrar } from '@/lib/permisos';
import { estadosCertificados } from '@/server/certificados/consultas';
import { type AlertaCertificados, alertasCertificados } from '@/server/certificados/estado';
import { exigirMembresia } from '@/server/sesion';
import org from '../organizacion.module.css';
import estilos from './tablero.module.css';

export const metadata: Metadata = { title: 'Tablero · Boletéame' };

/** Avisos de vencimiento (Fase 3, punto 5). Si la lectura falla, el Tablero se muestra igual. */
async function avisosCertificados(organizacionId: string): Promise<AlertaCertificados[]> {
  try {
    return alertasCertificados(await estadosCertificados(organizacionId));
  } catch (error) {
    console.error('Tablero: no se pudo leer el estado de los certificados', {
      mensaje: error instanceof Error ? error.message : null,
    });
    return [];
  }
}

// Provisorio: los avisos de certificados llegan en la Fase 3; los indicadores, en la
// Fase 9.
export default async function Tablero({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const avisos = await avisosCertificados(organizacion.id);
  const admin = puedeAdministrar(rol);

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>{organizacion.nombre}</p>
        <h1 className={org.titulo}>Tablero</h1>
      </header>

      {avisos.map((a) => (
        <Alerta key={a.tono} tono={a.tono} titulo={a.titulo}>
          <p>{a.detalle}</p>
          <p className={estilos.accionAviso}>
            <Link
              href={`/${slug}/configuracion/certificados`}
              className={clasesBoton('secundario', 'sm')}
            >
              {admin ? 'Cargar certificado' : 'Ver certificados'}
            </Link>
          </p>
        </Alerta>
      ))}

      <Tarjeta as="section" aria-labelledby="t-proximo" className={org.tarjeta}>
        <h2 id="t-proximo" className={org.subtitulo}>
          Lo que viene
        </h2>
        <p className={org.texto}>
          Tu organización ya está creada. Para emitir, cada empresa necesita:
        </p>
        <ul className={org.lista}>
          <li>
            el RUT, la razón social y el giro, en{' '}
            <Link href={`/${slug}/configuracion/empresas`}>Empresas</Link>
            {';'}
          </li>
          <li>
            el certificado digital (.pfx) de quien firma, en{' '}
            <Link href={`/${slug}/configuracion/certificados`}>Certificados</Link>
            {';'}
          </li>
          <li>la resolución del SII que autoriza a emitir, en la página de cada empresa.</li>
        </ul>
        <p className={org.texto}>
          Más adelante, aquí verás el estado de tus documentos y folios.
          {admin ? (
            <>
              {' '}
              Mientras tanto, puedes{' '}
              <Link href={`/${slug}/configuracion/equipo`}>invitar a tu equipo</Link>.
            </>
          ) : null}
        </p>
      </Tarjeta>
    </>
  );
}
