'use client';

import { type ChangeEvent, type ReactElement, useId, useState } from 'react';
import { formatearRut, limpiarRut, validarRut } from '@/lib/formatos';
import estilos from './CampoRut.module.css';
import { Glifo } from './Glifo';

export interface CampoRutProps {
  etiqueta?: string;
  value?: string;
  defaultValue?: string;
  /** Recibe el texto y si el dígito verificador es válido. */
  onChange?: (valor: string, valido: boolean) => void;
  ayuda?: string;
  /** Error externo (p. ej. "El receptor no está inscrito como contribuyente"). */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const ERROR_DV = 'El dígito verificador no corresponde a este RUT.';

function CampoRutBase({
  etiqueta = 'RUT',
  value,
  defaultValue = '',
  onChange,
  ayuda,
  error: errorExterno,
  placeholder = '12.345.678-5',
  disabled,
  id: idProp,
  className,
}: CampoRutProps): ReactElement {
  const idGenerado = useId();
  const id = idProp ?? idGenerado;
  const idAyuda = `${id}-ayuda`;
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue);
  // Se valida al salir del campo, no mientras se escribe.
  const [tocado, setTocado] = useState(false);
  const valor = value !== undefined ? value : interno;

  const lleno = limpiarRut(valor).length >= 2;
  const invalido = tocado && lleno && !validarRut(valor);
  const error = errorExterno || (invalido ? ERROR_DV : undefined);

  function cambiar(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/[^0-9kK.-]/g, '');
    if (!controlado) setInterno(v);
    onChange?.(v, validarRut(v));
  }

  function salir() {
    setTocado(true);
    const f = formatearRut(valor);
    if (!controlado) setInterno(f);
    if (onChange && f !== valor) onChange(f, validarRut(f));
  }

  return (
    <div className={[estilos.campo, error && estilos.error, className].filter(Boolean).join(' ')}>
      <label className={estilos.etiqueta} htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        className={estilos.input}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={12}
        placeholder={placeholder}
        value={valor}
        disabled={disabled}
        onChange={cambiar}
        onBlur={salir}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || ayuda ? idAyuda : undefined}
      />
      {error ? (
        <p className={`${estilos.ayuda} ${estilos.ayudaError}`} id={idAyuda}>
          <Glifo nombre="rechazado" size={14} />
          {error}
        </p>
      ) : ayuda ? (
        <p className={estilos.ayuda} id={idAyuda}>
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Campo de RUT chileno: acepta cualquier formato, normaliza a `12.345.678-5` al salir
 * y valida el dígito verificador (módulo 11).
 *
 * `CampoRut.formatear` y `CampoRut.validar` sirven solo en código cliente: las
 * propiedades estáticas no cruzan la frontera de `'use client'`. En el servidor
 * importa `formatearRut` / `validarRut` desde `@/lib/formatos`.
 */
export const CampoRut = Object.assign(CampoRutBase, {
  formatear: (rut: string): string => formatearRut(rut),
  validar: (rut: string): boolean => validarRut(rut),
});
