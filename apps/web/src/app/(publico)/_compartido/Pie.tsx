import Link from 'next/link';
import type { ReactElement } from 'react';
import { GRUPOS_PIE } from './enlaces';
import estilos from './publico.module.css';

/** Pie del sitio público: leyenda de independencia del SII y enlaces. */
export function Pie(): ReactElement {
  return (
    <footer className={estilos.pie}>
      <div className={estilos.pieInterior}>
        <div className={estilos.pieMarca}>
          <p className={estilos.pieNombre}>Boletéame</p>
          <p className={estilos.leyenda}>
            Boletéame es un servicio independiente y no está afiliado al Servicio de Impuestos
            Internos.
          </p>
        </div>
        <nav aria-label="Pie de página" className={estilos.pieNav}>
          {GRUPOS_PIE.map((g) => (
            <div key={g.titulo} className={estilos.pieGrupo}>
              <p className={estilos.pieTitulo}>{g.titulo}</p>
              <ul className={estilos.pieLista}>
                {g.enlaces.map((e) => (
                  <li key={e.href}>
                    <Link href={e.href} className={estilos.pieEnlace}>
                      {e.texto}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
