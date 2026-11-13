import type { ReactElement } from 'react';
import {
  ESTADOS_CERTIFICADO,
  type EstadoCertificado as Estado,
  textoDias,
} from '@/server/certificados/estado';
import estilos from './certificados.module.css';

export interface EstadoCertificadoProps {
  estado: Estado;
  diasRestantes: number;
}

/** Insignia con el estado de `v_certificados_estado` y, si sigue vigente, los días que le quedan. */
export function EstadoCertificado({ estado, diasRestantes }: EstadoCertificadoProps): ReactElement {
  const { etiqueta, tono } = ESTADOS_CERTIFICADO[estado];
  const dias =
    estado === 'vigente' || estado === 'por_vencer'
      ? diasRestantes <= 0
        ? 'Vence hoy'
        : `Quedan ${textoDias(diasRestantes)}`
      : null;
  return (
    <span className={estilos.celdaEstado}>
      <span className={`${estilos.estado} ${estilos[tono]}`}>{etiqueta}</span>
      {dias ? <span className={estilos.secundario}>{dias}</span> : null}
    </span>
  );
}
