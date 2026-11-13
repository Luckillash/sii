'use client';

import type { ComponentProps, ReactElement } from 'react';
import { unirIds, useCampo } from './Campo';
import estilos from './Input.module.css';

export interface SelectProps extends ComponentProps<'select'> {
  mono?: boolean;
}

/** `<select>` nativo con el aspecto de `Input`; se liga a su `Campo` igual que él. */
export function Select({ mono, className, ref, children, ...resto }: SelectProps): ReactElement {
  const campo = useCampo();
  return (
    <select
      {...resto}
      ref={ref}
      id={resto.id ?? campo?.id}
      aria-describedby={unirIds(campo?.idDescripcion, resto['aria-describedby'])}
      aria-invalid={resto['aria-invalid'] ?? (campo?.invalido ? true : undefined)}
      className={[estilos.control, estilos.select, mono && estilos.mono, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </select>
  );
}
