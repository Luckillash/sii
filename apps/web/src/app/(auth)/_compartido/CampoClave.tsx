'use client';

import { Eye, EyeOff } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { Campo, Input } from '@/components/timbre';
import estilos from './auth.module.css';

export interface CampoClaveProps {
  etiqueta?: ReactNode;
  name?: string;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  ayuda?: ReactNode;
  accesorio?: ReactNode;
  minLength?: number;
  maxLength?: number;
}

/**
 * Contraseña con botón para mostrarla u ocultarla. El botón es un interruptor
 * (`aria-pressed`) con nombre fijo, ligado al campo con `aria-controls`.
 */
export function CampoClave({
  etiqueta = 'Contraseña',
  name = 'clave',
  autoComplete,
  error,
  ayuda,
  accesorio,
  minLength,
  maxLength,
}: CampoClaveProps): ReactElement {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const Icono = visible ? EyeOff : Eye;

  return (
    <Campo
      etiqueta={etiqueta}
      id={id}
      error={error}
      ayuda={ayuda}
      accesorio={accesorio}
      anchoCompleto
    >
      <div className={estilos.envolturaClave}>
        <Input
          type={visible ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={maxLength}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={estilos.inputClave}
        />
        <button
          type="button"
          className={estilos.botonClave}
          aria-label="Mostrar contraseña"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          <Icono size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </Campo>
  );
}
