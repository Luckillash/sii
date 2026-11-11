'use client';

import { useEffect, useState } from 'react';
import estilos from './ds.module.css';

type Tema = 'sistema' | 'light' | 'dark';

const OPCIONES: { valor: Tema; texto: string }[] = [
  { valor: 'sistema', texto: 'Sistema' },
  { valor: 'light', texto: 'Claro' },
  { valor: 'dark', texto: 'Oscuro' },
];

/** Fija `data-theme` en `<html>` para revisar los dos temas sin cambiar el del equipo. */
export function SelectorTema() {
  const [tema, setTema] = useState<Tema>('sistema');

  useEffect(() => {
    const raiz = document.documentElement;
    if (tema === 'sistema') delete raiz.dataset.theme;
    else raiz.dataset.theme = tema;
  }, [tema]);

  return (
    <fieldset className={estilos.tema}>
      <legend className="sr-only">Tema</legend>
      {OPCIONES.map((o) => (
        <label key={o.valor} className={estilos.temaOpcion}>
          <input
            type="radio"
            name="tema"
            value={o.valor}
            checked={tema === o.valor}
            onChange={() => setTema(o.valor)}
          />
          {o.texto}
        </label>
      ))}
    </fieldset>
  );
}
