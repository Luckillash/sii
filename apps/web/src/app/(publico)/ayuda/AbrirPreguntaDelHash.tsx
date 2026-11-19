'use client';

import { useEffect } from 'react';

// Abre la pregunta de /ayuda que nombra el hash (`/ayuda#por-verificar`). Las preguntas
// son `<details>` nativos y el navegador no los abre al saltar a su `id`: este componente
// lo hace al cargar la página y en cada `hashchange`. No dibuja nada; sin JavaScript la
// página sigue funcionando igual (el enlace lleva a la pregunta, cerrada).

/** El `<details>` con el `id` del hash (o el que lo contiene), o `null`. */
function preguntaDelHash(hash: string): HTMLDetailsElement | null {
  const crudo = hash.replace(/^#/, '');
  if (!crudo) return null;
  let id: string;
  try {
    id = decodeURIComponent(crudo);
  } catch {
    return null;
  }
  const elemento = document.getElementById(id);
  if (!elemento) return null;
  if (elemento instanceof HTMLDetailsElement) return elemento;
  return elemento.closest('details');
}

function abrirDelHash(): void {
  const pregunta = preguntaDelHash(window.location.hash);
  if (pregunta && !pregunta.open) pregunta.open = true;
}

export function AbrirPreguntaDelHash(): null {
  useEffect(() => {
    abrirDelHash();
    window.addEventListener('hashchange', abrirDelHash);
    return () => window.removeEventListener('hashchange', abrirDelHash);
  }, []);
  return null;
}
