import type { ReactNode } from 'react';
import { Cabecera } from './_compartido/Cabecera';
import { ID_CONTENIDO } from './_compartido/enlaces';
import { Pie } from './_compartido/Pie';
import estilos from './_compartido/publico.module.css';

// Sitio público (PLAN-SAAS Fase 12): cabecera y pie compartidos por la landing, la
// documentación de ayuda, el estado del servicio, el contacto y las páginas legales.
//
// Contrato con las páginas de `(publico)`: el layout NO pone `<main>`. Cada página
// renderiza solo su `<main id="contenido" tabIndex={-1}>`, destino del enlace «Saltar al
// contenido» (el layout le da `flex: 1` para que el pie quede abajo).

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <div className={estilos.pagina}>
      <a href={`#${ID_CONTENIDO}`} className={estilos.saltar}>
        Saltar al contenido
      </a>
      <Cabecera />
      {children}
      <Pie />
    </div>
  );
}
