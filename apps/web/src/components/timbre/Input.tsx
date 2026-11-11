'use client';

import type { ComponentProps, ReactElement } from 'react';
import { unirIds, useCampo } from './Campo';
import estilos from './Input.module.css';

export interface InputProps extends ComponentProps<'input'> {
  /** IBM Plex Mono con cifras tabulares: RUT, folios, montos. */
  mono?: boolean;
}

/**
 * Campo de texto (`.tb-input`). Dentro de un `Campo` toma de ahí `id`,
 * `aria-describedby` y `aria-invalid`; suelto, pásale `aria-label` o tu propio `id`.
 */
export function Input({ mono, className, ref, ...resto }: InputProps): ReactElement {
  const campo = useCampo();
  return (
    <input
      {...resto}
      ref={ref}
      id={resto.id ?? campo?.id}
      aria-describedby={unirIds(campo?.idDescripcion, resto['aria-describedby'])}
      aria-invalid={resto['aria-invalid'] ?? (campo?.invalido ? true : undefined)}
      className={[estilos.control, mono && estilos.mono, className].filter(Boolean).join(' ')}
    />
  );
}
