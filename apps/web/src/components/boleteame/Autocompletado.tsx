'use client';

import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import estilos from './Autocompletado.module.css';
import { unirIds, useCampo } from './Campo';
import inputs from './Input.module.css';

export interface AutocompletadoProps<T>
  extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onSelect' | 'role' | 'type'> {
  value: string;
  /** Cada cambio del texto (también lo que se escribe sin elegir una opción). */
  onChange: (texto: string) => void;
  /** Busca opciones para el texto; los errores se tratan como «sin resultados». */
  buscar: (texto: string) => Promise<readonly T[]>;
  onElegir: (opcion: T) => void;
  claveOpcion: (opcion: T) => string;
  /** Contenido de la opción en la lista. */
  renderOpcion: (opcion: T) => ReactNode;
  /** Letras desde las que se busca. Por defecto 2. */
  minimo?: number;
  /** Espera tras la última tecla antes de buscar (ms). Por defecto 250. */
  espera?: number;
  /** Texto cuando no hay coincidencias. */
  sinResultados?: string;
  mono?: boolean;
}

/**
 * Campo de texto con sugerencias (patrón *combobox* de ARIA 1.2 con lista): las flechas
 * recorren las opciones, Enter elige, Escape cierra. Las sugerencias son opcionales: lo
 * escrito vale aunque no se elija nada. Dentro de un `Campo` toma su `id` y su ayuda;
 * suelto, pásale `aria-label`.
 */
export function Autocompletado<T>({
  value,
  onChange,
  buscar,
  onElegir,
  claveOpcion,
  renderOpcion,
  minimo = 2,
  espera = 250,
  sinResultados = 'Sin coincidencias. Puedes seguir escribiendo.',
  mono,
  className,
  onKeyDown,
  onBlur,
  ...resto
}: AutocompletadoProps<T>): ReactElement {
  const campo = useCampo();
  const idLista = useId();
  const idEstado = useId();
  const [opciones, setOpciones] = useState<readonly T[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [activa, setActiva] = useState(-1);
  // Solo la respuesta de la última búsqueda cuenta (las anteriores pueden llegar después).
  const turno = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La búsqueda la dispara lo que escribe la persona, no un `value` que cambió por fuera.
  const escrito = useRef(false);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  function programarBusqueda(texto: string) {
    if (temporizador.current) clearTimeout(temporizador.current);
    const t = texto.trim();
    if (t.length < minimo) {
      turno.current++;
      setOpciones([]);
      setAbierto(false);
      setBuscando(false);
      return;
    }
    temporizador.current = setTimeout(async () => {
      const mio = ++turno.current;
      setBuscando(true);
      let r: readonly T[] = [];
      try {
        r = await buscar(t);
      } catch {
        r = [];
      }
      if (mio !== turno.current || !escrito.current) return;
      setBuscando(false);
      setOpciones(r);
      setActiva(-1);
      setAbierto(true);
    }, espera);
  }

  function cerrar() {
    turno.current++;
    if (temporizador.current) clearTimeout(temporizador.current);
    setAbierto(false);
    setBuscando(false);
    setActiva(-1);
  }

  function elegir(o: T) {
    escrito.current = false;
    cerrar();
    setOpciones([]);
    onElegir(o);
  }

  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const hay = abierto && opciones.length > 0;
    if (e.key === 'ArrowDown') {
      if (!hay) return;
      e.preventDefault();
      setActiva((i) => (i + 1) % opciones.length);
    } else if (e.key === 'ArrowUp') {
      if (!hay) return;
      e.preventDefault();
      setActiva((i) => (i <= 0 ? opciones.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      const o = hay && activa >= 0 ? opciones[activa] : undefined;
      if (o !== undefined) {
        e.preventDefault();
        elegir(o);
      }
    } else if (e.key === 'Escape') {
      if (abierto) {
        e.preventDefault();
        cerrar();
      }
    }
  }

  const id = resto.id ?? campo?.id;
  // La lista solo se abre con opciones (un listbox vacío no es válido para ARIA); sin
  // coincidencias se muestra un aviso aparte y se anuncia en la región viva.
  const expandido = abierto && opciones.length > 0;
  const idOpcion = (i: number) => `${idLista}-${i}`;
  const estado = buscando
    ? 'Buscando…'
    : abierto
      ? opciones.length === 0
        ? sinResultados
        : opciones.length === 1
          ? '1 sugerencia. Usa las flechas para elegirla.'
          : `${opciones.length} sugerencias. Usa las flechas para elegir una.`
      : '';

  return (
    <div className={[estilos.contenedor, className].filter(Boolean).join(' ')}>
      <input
        autoComplete="off"
        spellCheck={false}
        {...resto}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expandido}
        aria-controls={idLista}
        aria-activedescendant={expandido && activa >= 0 ? idOpcion(activa) : undefined}
        aria-describedby={unirIds(campo?.idDescripcion, resto['aria-describedby'])}
        aria-invalid={resto['aria-invalid'] ?? (campo?.invalido ? true : undefined)}
        className={[inputs.control, estilos.input, mono && inputs.mono].filter(Boolean).join(' ')}
        value={value}
        onChange={(e) => {
          escrito.current = true;
          onChange(e.target.value);
          programarBusqueda(e.target.value);
        }}
        onKeyDown={teclas}
        onBlur={(e) => {
          onBlur?.(e);
          cerrar();
        }}
      />
      <div
        id={idLista}
        role="listbox"
        aria-label="Sugerencias"
        className={estilos.lista}
        hidden={!expandido}
      >
        {expandido
          ? opciones.map((o, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: patrón combobox de ARIA: el foco se queda en el campo y la opción activa se indica con aria-activedescendant
              // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado se maneja en el campo (flechas, Enter, Escape)
              <div
                key={claveOpcion(o)}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activa}
                className={[estilos.opcion, i === activa && estilos.activa]
                  .filter(Boolean)
                  .join(' ')}
                // Sin perder el foco del campo antes del clic.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(o)}
                onMouseEnter={() => setActiva(i)}
              >
                {renderOpcion(o)}
              </div>
            ))
          : null}
      </div>
      {abierto && !buscando && opciones.length === 0 ? (
        <p className={`${estilos.lista} ${estilos.vacio}`}>{sinResultados}</p>
      ) : null}
      <span id={idEstado} className={estilos.sr} aria-live="polite">
        {estado}
      </span>
    </div>
  );
}
