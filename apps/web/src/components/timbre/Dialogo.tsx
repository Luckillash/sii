'use client';

import { type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react';
import { Boton } from './Boton';
import estilos from './Dialogo.module.css';

export interface DialogoProps {
  abierto: boolean;
  /** Escape o «Cancelar». El padre pone `abierto` en `false`. */
  onCerrar: () => void;
  onConfirmar: () => void;
  titulo: ReactNode;
  /** Resumen de la simulación: qué se enviará, a qué ambiente y con qué certificado. */
  children: ReactNode;
  textoConfirmar: string;
  /** Por defecto «Cancelar». */
  textoCancelar?: string;
  /** peligro: la operación no se puede deshacer (consume folios, declara, anula). */
  variante?: 'primario' | 'peligro';
  /** Operación en curso: botones deshabilitados, Escape no cierra y `aria-busy`. */
  cargando?: boolean;
  className?: string;
}

/**
 * Confirmación de operaciones ⚠️ ante el SII, después de mostrar la simulación.
 * `<dialog>` nativo con `showModal()`: atrapa el foco y lo devuelve a quien lo abrió.
 * El foco inicial va a «Cancelar», la opción segura.
 */
export function Dialogo({
  abierto,
  onCerrar,
  onConfirmar,
  titulo,
  children,
  textoConfirmar,
  textoCancelar = 'Cancelar',
  variante = 'primario',
  cargando = false,
  className,
}: DialogoProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idCuerpo = useId();

  // Últimos valores para los manejadores nativos, sin volver a suscribirlos.
  const actual = useRef({ abierto, cargando, onCerrar });
  useEffect(() => {
    actual.current = { abierto, cargando, onCerrar };
  });

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialogo.showModal();
      dialogo.querySelector<HTMLElement>('[data-foco-inicial]')?.focus();
    } else if (!abierto && dialogo.open) {
      dialogo.close();
    }
  }, [abierto]);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;

    // Escape: lo decide el padre (y no se cierra mientras la operación corre).
    function alCancelar(e: Event) {
      e.preventDefault();
      if (!actual.current.cargando) actual.current.onCerrar();
    }
    // Cierre por fuera de React (p. ej. el navegador fuerza el cierre): sincroniza y
    // devuelve el foco.
    function alCerrar() {
      const o = opener.current;
      opener.current = null;
      if (o?.isConnected) o.focus();
      if (actual.current.abierto) actual.current.onCerrar();
    }

    dialogo.addEventListener('cancel', alCancelar);
    dialogo.addEventListener('close', alCerrar);
    return () => {
      dialogo.removeEventListener('cancel', alCancelar);
      dialogo.removeEventListener('close', alCerrar);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={[estilos.dialogo, className].filter(Boolean).join(' ')}
      aria-labelledby={idTitulo}
      aria-describedby={idCuerpo}
      aria-busy={cargando || undefined}
    >
      <h2 id={idTitulo} className={estilos.titulo}>
        {titulo}
      </h2>
      <div id={idCuerpo} className={estilos.cuerpo}>
        {children}
      </div>
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={onCerrar} disabled={cargando} data-foco-inicial="">
          {textoCancelar}
        </Boton>
        <Boton variante={variante} onClick={onConfirmar} disabled={cargando}>
          {textoConfirmar}
        </Boton>
      </div>
    </dialog>
  );
}
