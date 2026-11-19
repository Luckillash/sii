import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { formatearFecha } from '@/lib/formatos';
import { canalContacto, type MotivoContacto } from '@/lib/legal';
import { ID_CONTENIDO } from '../_compartido/enlaces';
import estilos from './legal.module.css';

// Piezas de las páginas legales (PLAN-SAAS Fase 12): cabecera con la vigencia, índice
// con anclas y secciones numeradas. Server Components sin estado.

export interface SeccionLegal {
  /** Ancla (`#id`): minúsculas y guiones, estable entre versiones. */
  id: string;
  titulo: string;
  contenido: ReactNode;
}

export interface DocumentoLegalProps {
  titulo: string;
  bajada: ReactNode;
  /** `AAAA-MM-DD`. */
  vigencia: string;
  secciones: readonly SeccionLegal[];
  /** Enlace al otro documento legal, al pie. */
  otro: { href: string; texto: string };
}

export function DocumentoLegal({
  titulo,
  bajada,
  vigencia,
  secciones,
  otro,
}: DocumentoLegalProps): ReactElement {
  return (
    <main id={ID_CONTENIDO} tabIndex={-1}>
      <div className={estilos.contenedor}>
        <header className={estilos.cabecera}>
          <p className={estilos.antetitulo}>Legal</p>
          <h1 className={estilos.titulo}>{titulo}</h1>
          <p className={estilos.bajada}>{bajada}</p>
          <p className={estilos.vigencia}>
            Vigente desde el <time dateTime={vigencia}>{formatearFecha(vigencia)}</time>
          </p>
        </header>
        <div className={estilos.cuerpo}>
          <nav className={estilos.indice} aria-labelledby="indice-titulo">
            <h2 id="indice-titulo" className={estilos.indiceTitulo}>
              En esta página
            </h2>
            <ol>
              {secciones.map((s) => (
                <li key={s.id}>
                  <a className={estilos.enlace} href={`#${s.id}`}>
                    {s.titulo}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className={estilos.contenido}>
            {secciones.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className={estilos.seccion}
                aria-labelledby={`${s.id}-titulo`}
              >
                <h2 id={`${s.id}-titulo`}>
                  {i + 1}. {s.titulo}
                </h2>
                {s.contenido}
              </section>
            ))}
            <p className={estilos.otros}>
              <Link className={estilos.enlace} href={otro.href}>
                {otro.texto}
              </Link>
              <Link className={estilos.enlace} href="/ayuda">
                Ayuda
              </Link>
              <Link className={estilos.enlace} href="/contacto">
                Contacto
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Enlace con el estilo de las páginas legales (interno con `Link`, externo con `<a>`). */
export function Enlace({ href, children }: { href: string; children: ReactNode }): ReactElement {
  if (href.startsWith('/')) {
    return (
      <Link className={estilos.enlace} href={href}>
        {children}
      </Link>
    );
  }
  return (
    <a className={estilos.enlace} href={href}>
      {children}
    </a>
  );
}

/**
 * «escríbenos a <correo>» o «escríbenos desde <la página de contacto>», según lo que haya
 * en `RESPONSABLE` (`lib/legal.ts`).
 */
export function Contacto({
  motivo = 'general',
  inicio = false,
}: {
  motivo?: MotivoContacto;
  inicio?: boolean;
}): ReactElement {
  const canal = canalContacto(motivo, undefined, { inicio });
  return (
    <>
      {canal.antes}
      <Enlace href={canal.href}>{canal.texto}</Enlace>
    </>
  );
}

/** Tabla con marco desplazable en pantallas angostas (región con nombre, enfocable). */
export function TablaLegal({
  etiqueta,
  columnas,
  filas,
}: {
  etiqueta: string;
  columnas: readonly string[];
  filas: readonly (readonly ReactNode[])[];
}): ReactElement {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: región desplazable; axe exige que se pueda enfocar para desplazarla con el teclado
    <section className={estilos.tablaContenedor} aria-label={etiqueta} tabIndex={0}>
      <table className={estilos.tabla}>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filas fijas, nunca se reordenan
            <tr key={i}>
              {fila.map((celda, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas
                <td key={j}>{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
