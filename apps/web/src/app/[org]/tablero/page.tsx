import type { Metadata } from 'next';
import Link from 'next/link';
import { Tarjeta } from '@/components/boleteame';
import { puedeAdministrar } from '@/lib/permisos';
import { exigirMembresia } from '@/server/sesion';
import org from '../organizacion.module.css';

export const metadata: Metadata = { title: 'Tablero · Boletéame' };

// Provisorio (Fase 2): sin datos todavía. Las empresas emisoras, sus certificados y
// resoluciones llegan en la Fase 3; los indicadores, en la Fase 9.
export default async function Tablero({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>{organizacion.nombre}</p>
        <h1 className={org.titulo}>Tablero</h1>
      </header>

      <Tarjeta as="section" aria-labelledby="t-proximo" className={org.tarjeta}>
        <h2 id="t-proximo" className={org.subtitulo}>
          Lo que viene
        </h2>
        <p className={org.texto}>
          Tu organización ya está creada. El siguiente paso será agregar tus empresas emisoras:
        </p>
        <ul className={org.lista}>
          <li>el RUT, la razón social y el giro de cada empresa;</li>
          <li>el certificado digital (.pfx) de quien firma;</li>
          <li>la resolución del SII que autoriza a emitir.</li>
        </ul>
        <p className={org.texto}>
          Esa sección aún no está disponible. Cuando lo esté, aquí verás el estado de tus documentos
          y folios.
          {puedeAdministrar(rol) ? (
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
