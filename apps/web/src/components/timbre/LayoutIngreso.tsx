import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import estilos from './LayoutIngreso.module.css';

export interface LayoutIngresoProps {
  /** El formulario (título, campos, acciones), en una columna de 400px. */
  children: ReactNode;
  titular?: ReactNode;
  bajada?: ReactNode;
}

/** Pantallas de acceso (plantilla «Ingreso»): panel `sello` perforado + formulario. */
export function LayoutIngreso({
  children,
  titular = 'Tus documentos tributarios, firmados y en orden.',
  bajada = 'Emisión, envío al SII y certificación en un solo lugar.',
}: LayoutIngresoProps): ReactElement {
  return (
    <div className={estilos.ingreso}>
      <aside className={estilos.panel}>
        {/* Borde perforado, como el de un talonario. */}
        <div className={estilos.perforacion} aria-hidden="true" />
        <Link href="/" className={estilos.marca}>
          Timbre
        </Link>
        <div className={estilos.mensaje}>
          <p className={estilos.titular}>{titular}</p>
          <p className={estilos.bajada}>{bajada}</p>
        </div>
        <div className={estilos.bloques} aria-hidden="true">
          <div className={estilos.bloqueOcre} />
          <div className={estilos.bloqueSuave} />
        </div>
      </aside>

      <main className={estilos.principal}>
        <div className={estilos.columna}>{children}</div>
      </main>
    </div>
  );
}
