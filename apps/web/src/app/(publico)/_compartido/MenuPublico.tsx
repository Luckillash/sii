'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { type KeyboardEvent, type ReactElement, useId, useRef, useState } from 'react';
import { clasesBoton } from '@/components/boleteame';
import { NAV_PRINCIPAL, RUTA_CREAR_CUENTA, RUTA_INGRESAR } from './enlaces';
import estilos from './publico.module.css';

// Navegación de la cabecera pública. En pantallas anchas se ve completa y el botón
// «Menú» no aparece; en móvil el botón (con `aria-expanded`) la abre y la cierra. Se
// cierra al elegir un enlace o con Escape (el foco vuelve al botón).

export function MenuPublico(): ReactElement {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const cerrar = () => setAbierto(false);

  function teclado(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && abierto) {
      setAbierto(false);
      boton.current?.focus();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: solo escucha Escape dentro del menú
    <div className={estilos.menuContenedor} onKeyDown={teclado}>
      <button
        ref={boton}
        type="button"
        className={estilos.botonMenu}
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => setAbierto((v) => !v)}
      >
        {abierto ? (
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
        )}
        Menú
      </button>
      <div id={idMenu} className={estilos.menu} data-abierto={abierto ? 'true' : undefined}>
        <nav aria-label="Principal" className={estilos.nav}>
          <ul className={estilos.navLista}>
            {NAV_PRINCIPAL.map((e) => (
              <li key={e.href}>
                <Link href={e.href} className={estilos.navEnlace} onClick={cerrar}>
                  {e.texto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={estilos.acciones}>
          <Link href={RUTA_INGRESAR} className={clasesBoton('discreto')} onClick={cerrar}>
            Ingresar
          </Link>
          <Link href={RUTA_CREAR_CUENTA} className={clasesBoton('secundario')} onClick={cerrar}>
            Crear cuenta
          </Link>
        </div>
      </div>
    </div>
  );
}
