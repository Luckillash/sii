'use client';

import { Check, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { Boton, Input } from '@/components/boleteame';
import estilos from './api.module.css';

export interface SecretoParaCopiarProps {
  /** La API key o el secreto del webhook: existe solo en esta vista. */
  valor: string;
  /** Etiqueta accesible del campo. */
  etiqueta: string;
  /** «Copiar API key», «Copiar secreto». */
  textoCopiar: string;
  /** Por defecto «Listo, ya la guardé» (API key); para el secreto, «Listo, ya lo guardé». */
  textoListo?: string;
  /** Lo descarta de la pantalla (no se puede volver a ver). */
  onCerrar: () => void;
}

/**
 * Valor secreto de solo lectura con «Copiar» y «Listo». Se muestra UNA vez: al cerrarlo
 * desaparece del estado del componente y no hay forma de volver a pedirlo.
 */
export function SecretoParaCopiar({
  valor,
  etiqueta,
  textoCopiar,
  textoListo = 'Listo, ya la guardé',
  onCerrar,
}: SecretoParaCopiarProps) {
  const id = useId();
  const [estado, setEstado] = useState<'inicial' | 'copiado' | 'error'>('inicial');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setEstado('copiado');
    } catch {
      setEstado('error');
    }
  }

  return (
    <div className={estilos.secreto}>
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      <Input
        id={id}
        value={valor}
        readOnly
        mono
        spellCheck={false}
        autoComplete="off"
        className={estilos.secretoCampo}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={estilos.secretoAcciones}>
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
          {estado === 'copiado' ? 'Copiado' : textoCopiar}
        </Boton>
        <Boton tamano="sm" variante="discreto" onClick={onCerrar}>
          {textoListo}
        </Boton>
      </div>
      <p className={estilos.nota} aria-live="polite">
        {estado === 'error'
          ? 'No pudimos copiar el texto. Selecciónalo y cópialo con el teclado.'
          : ''}
      </p>
    </div>
  );
}
