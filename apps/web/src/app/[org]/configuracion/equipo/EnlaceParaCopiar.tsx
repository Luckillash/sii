'use client';

import { Check, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { Boton, Input } from '@/components/timbre';
import estilos from './equipo.module.css';

export interface EnlaceParaCopiarProps {
  enlace: string;
  /** Etiqueta accesible del campo. */
  etiqueta: string;
  onCerrar: () => void;
}

/** Enlace de invitación de solo lectura, con «Copiar» y «Listo» (lo descarta). */
export function EnlaceParaCopiar({ enlace, etiqueta, onCerrar }: EnlaceParaCopiarProps) {
  const id = useId();
  const [estado, setEstado] = useState<'inicial' | 'copiado' | 'error'>('inicial');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setEstado('copiado');
    } catch {
      setEstado('error');
    }
  }

  return (
    <div className={estilos.enlace}>
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      <Input
        id={id}
        value={enlace}
        readOnly
        mono
        className={estilos.enlaceCampo}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={estilos.enlaceAcciones}>
        <Boton
          tamano="sm"
          onClick={copiar}
          icono={
            estado === 'copiado' ? (
              <Check size={16} strokeWidth={1.5} />
            ) : (
              <Copy size={16} strokeWidth={1.5} />
            )
          }
        >
          {estado === 'copiado' ? 'Copiado' : 'Copiar enlace'}
        </Boton>
        <Boton tamano="sm" variante="discreto" onClick={onCerrar}>
          Listo, ya lo compartí
        </Boton>
      </div>
      <p className={estilos.nota} aria-live="polite">
        {estado === 'error'
          ? 'No pudimos copiarlo. Selecciona el enlace y cópialo con el teclado.'
          : ''}
      </p>
    </div>
  );
}
