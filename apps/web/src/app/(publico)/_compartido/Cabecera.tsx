import Link from 'next/link';
import type { ReactElement } from 'react';
import { MenuPublico } from './MenuPublico';
import estilos from './publico.module.css';

/** Cabecera del sitio público: marca, navegación e ingreso. */
export function Cabecera(): ReactElement {
  return (
    <header className={estilos.cabecera}>
      <div className={estilos.barra}>
        <Link href="/" className={estilos.marca}>
          Boletéame
        </Link>
        <MenuPublico />
      </div>
    </header>
  );
}
