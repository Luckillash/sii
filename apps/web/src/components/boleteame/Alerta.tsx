import type { ReactElement, ReactNode } from 'react';
import estilos from './Alerta.module.css';
import { Glifo, type NombreGlifo } from './Glifo';
import type { Tono } from './tipos';
import tonos from './tonos.module.css';

export interface AlertaProps {
  tono?: Tono;
  titulo?: ReactNode;
  children?: ReactNode;
  /** Un Boton secundario o discreto, alineado a la derecha. */
  accion?: ReactNode;
  className?: string;
}

const GLIFO_TONO: Readonly<Record<Tono, NombreGlifo>> = {
  info: 'info',
  exito: 'aceptado',
  aviso: 'reparos',
  error: 'rechazado',
};

export function Alerta({
  tono: tonoProp = 'info',
  titulo,
  children,
  accion,
  className,
}: AlertaProps): ReactElement {
  const tono: Tono = Object.hasOwn(GLIFO_TONO, tonoProp) ? tonoProp : 'info';
  return (
    <div
      className={[estilos.alerta, tonos[tono], className].filter(Boolean).join(' ')}
      role={tono === 'error' ? 'alert' : 'status'}
    >
      <Glifo nombre={GLIFO_TONO[tono]} size={18} className={estilos.glifo} />
      <div className={estilos.cuerpo}>
        {titulo ? <p className={estilos.titulo}>{titulo}</p> : null}
        {children ? <div className={estilos.texto}>{children}</div> : null}
      </div>
      {accion ? <div className={estilos.accion}>{accion}</div> : null}
    </div>
  );
}
