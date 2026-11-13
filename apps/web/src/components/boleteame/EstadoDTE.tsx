import type { ReactElement } from 'react';
import estilos from './EstadoDTE.module.css';
import { Glifo } from './Glifo';
import type { EstadoDte, TonoVisual } from './tipos';
import tonos from './tonos.module.css';

export interface EstadoDTEProps {
  estado: EstadoDte;
  /** Texto del tooltip: glosa del SII, Track ID, fecha. */
  detalle?: string;
  className?: string;
}

const ESTADOS: Readonly<Record<EstadoDte, { texto: string; tono: TonoVisual }>> = {
  borrador: { texto: 'Borrador', tono: 'neutro' },
  firmado: { texto: 'Firmado', tono: 'sello' },
  enviado: { texto: 'Enviado', tono: 'info' },
  aceptado: { texto: 'Aceptado', tono: 'exito' },
  reparos: { texto: 'Aceptado con reparos', tono: 'aviso' },
  rechazado: { texto: 'Rechazado', tono: 'error' },
  anulado: { texto: 'Anulado', tono: 'neutro' },
  // D3: envío sin Track ID; no se reintenta sin revisar en el SII.
  incierto: { texto: 'Por verificar', tono: 'aviso' },
};

/** Texto oficial de cada estado (filtros, exportaciones). */
export function textoEstadoDte(estado: EstadoDte): string {
  return ESTADOS[estado]?.texto ?? ESTADOS.borrador.texto;
}

export function EstadoDTE({ estado, detalle, className }: EstadoDTEProps): ReactElement {
  // Un valor desconocido (dato viejo de la base) cae en «Borrador», como el bundle.
  const clave: EstadoDte = Object.hasOwn(ESTADOS, estado) ? estado : 'borrador';
  const { texto, tono } = ESTADOS[clave];
  const clases = [estilos.estado, tonos[tono], clave === 'anulado' && estilos.anulado, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={clases} title={detalle || undefined}>
      <Glifo nombre={clave} size={14} />
      <span>{texto}</span>
    </span>
  );
}
