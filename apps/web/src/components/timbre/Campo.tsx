'use client';

import { createContext, type ReactElement, type ReactNode, use, useId } from 'react';
import estilos from './Campo.module.css';
import { Glifo } from './Glifo';

/** Lo que un control necesita para quedar ligado a su `Campo`. */
export interface ContextoCampo {
  id: string;
  /** id del texto de ayuda o error, si hay. */
  idDescripcion: string | undefined;
  invalido: boolean;
}

const Contexto = createContext<ContextoCampo | null>(null);

/**
 * Para controles propios dentro de un `Campo` (Input y Select ya lo usan).
 * Devuelve `null` fuera de un `Campo`.
 */
export function useCampo(): ContextoCampo | null {
  return use(Contexto);
}

/** Une ids de `aria-describedby` sin dejar espacios ni `undefined`. */
export function unirIds(...ids: (string | undefined)[]): string | undefined {
  const s = ids.filter(Boolean).join(' ');
  return s || undefined;
}

export interface CampoProps {
  etiqueta: ReactNode;
  /** El control: `Input`, `Select` o uno propio que use `useCampo()`. */
  children: ReactNode;
  ayuda?: ReactNode;
  /** Qué pasó y qué hacer. Reemplaza a la ayuda mientras exista. */
  error?: ReactNode;
  /** Junto a la etiqueta, alineado a la derecha (p. ej. «¿Olvidaste tu contraseña?»). */
  accesorio?: ReactNode;
  /** Sin el tope de 280px: ocupa el ancho de su contenedor. */
  anchoCompleto?: boolean;
  /** id del control; por defecto se genera con `useId()`. */
  id?: string;
  className?: string;
}

/** Etiqueta + control + ayuda o error (`.tb-campo`). */
export function Campo({
  etiqueta,
  children,
  ayuda,
  error,
  accesorio,
  anchoCompleto,
  id: idProp,
  className,
}: CampoProps): ReactElement {
  const idGenerado = useId();
  const id = idProp ?? idGenerado;
  const idDescripcion = `${id}-descripcion`;
  const hayError = error != null && error !== false && error !== '';
  const hayAyuda = ayuda != null && ayuda !== false && ayuda !== '';
  const contexto: ContextoCampo = {
    id,
    idDescripcion: hayError || hayAyuda ? idDescripcion : undefined,
    invalido: hayError,
  };

  const label = (
    <label className={estilos.etiqueta} htmlFor={id}>
      {etiqueta}
    </label>
  );

  return (
    <div
      className={[estilos.campo, anchoCompleto && estilos.anchoCompleto, className]
        .filter(Boolean)
        .join(' ')}
    >
      {accesorio ? (
        <div className={estilos.cabecera}>
          {label}
          <span className={estilos.accesorio}>{accesorio}</span>
        </div>
      ) : (
        label
      )}
      <Contexto value={contexto}>{children}</Contexto>
      {hayError ? (
        <p className={`${estilos.ayuda} ${estilos.ayudaError}`} id={idDescripcion}>
          <Glifo nombre="rechazado" size={14} />
          <span>{error}</span>
        </p>
      ) : hayAyuda ? (
        <p className={estilos.ayuda} id={idDescripcion}>
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}
