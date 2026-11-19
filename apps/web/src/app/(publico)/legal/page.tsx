import type { Metadata } from 'next';
import Link from 'next/link';
import { Tarjeta } from '@/components/boleteame';
import { formatearFecha } from '@/lib/formatos';
import { VIGENCIA_PRIVACIDAD, VIGENCIA_TERMINOS } from '@/lib/legal';
import { ID_CONTENIDO } from '../_compartido/enlaces';
import estilos from './legal.module.css';

// Índice de los documentos legales (PLAN-SAAS Fase 12).

export const metadata: Metadata = {
  title: 'Legal',
  description: 'Términos y condiciones y política de privacidad de Boletéame.',
};

const DOCUMENTOS = [
  {
    href: '/legal/terminos',
    titulo: 'Términos y condiciones',
    texto:
      'Qué hace el servicio, qué te corresponde ante el SII, planes y pagos, API, disponibilidad y responsabilidades.',
    vigencia: VIGENCIA_TERMINOS,
  },
  {
    href: '/legal/privacidad',
    titulo: 'Política de privacidad',
    texto:
      'Qué datos tratamos, cómo protegemos tu certificado digital y tus documentos, con quién los compartimos y tus derechos.',
    vigencia: VIGENCIA_PRIVACIDAD,
  },
];

export default function PaginaLegal() {
  return (
    <main id={ID_CONTENIDO} tabIndex={-1}>
      <div className={estilos.contenedor}>
        <header className={estilos.cabecera}>
          <p className={estilos.antetitulo}>Legal</p>
          <h1 className={estilos.titulo}>Documentos legales</h1>
          <p className={estilos.bajada}>
            Las condiciones para usar Boletéame y cómo tratamos tus datos.
          </p>
        </header>
        <ul className={estilos.documentos}>
          {DOCUMENTOS.map((d) => (
            <li key={d.href}>
              <Tarjeta as="article" className={estilos.documento}>
                <h2 className={estilos.documentoTitulo}>
                  <Link className={estilos.enlace} href={d.href}>
                    {d.titulo}
                  </Link>
                </h2>
                <p>{d.texto}</p>
                <p className={estilos.vigencia}>
                  Vigente desde el <time dateTime={d.vigencia}>{formatearFecha(d.vigencia)}</time>
                </p>
              </Tarjeta>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
