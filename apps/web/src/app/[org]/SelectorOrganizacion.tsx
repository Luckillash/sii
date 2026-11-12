import { ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { ETIQUETA_ROL } from '@/lib/permisos';
import type { Membresia } from '@/server/sesion';
import estilos from './organizacion.module.css';

// Organización actual y, si el usuario tiene varias, la lista para cambiar. Sin JS:
// `<details>` nativo (teclado y lector de pantalla incluidos) con enlaces a
// `/[slug]/tablero`. Va en el lugar de la tarjeta de empresa del menú lateral hasta
// que exista el selector de empresa (Fase 3).

export interface SelectorOrganizacionProps {
  actual: Membresia;
  membresias: Membresia[];
}

export function SelectorOrganizacion({ actual, membresias }: SelectorOrganizacionProps) {
  if (membresias.length <= 1) {
    return (
      <div className={`${estilos.organizacion} ${estilos.organizacionFija}`}>
        <span className={estilos.etiquetaOrganizacion}>Organización</span>
        <span className={estilos.nombreOrganizacion}>{actual.nombre}</span>
      </div>
    );
  }

  return (
    <details className={estilos.organizacion}>
      <summary className={estilos.resumen}>
        <span className={estilos.resumenTextos}>
          <span className={estilos.etiquetaOrganizacion}>Organización</span>
          <span className={estilos.nombreOrganizacion}>{actual.nombre}</span>
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.5} aria-hidden="true" className={estilos.icono} />
        <span className="sr-only">Cambiar de organización</span>
      </summary>
      <nav aria-label="Tus organizaciones">
        <ul className={estilos.opciones}>
          {membresias.map((m) => (
            <li key={m.organizacionId}>
              <Link
                href={`/${m.slug}/tablero`}
                className={estilos.opcion}
                aria-current={m.slug === actual.slug ? 'true' : undefined}
              >
                <span className={estilos.nombreOrganizacion}>{m.nombre}</span>
                <span className={estilos.opcionRol}>{ETIQUETA_ROL[m.rol]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
