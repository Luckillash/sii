import type { ReactElement } from 'react';
import { nivelCuota, textoLimite } from '@/lib/planes';
import estilos from './plan.module.css';

// Uso de un cupo del plan: «640 de 1.000» con una barra que cambia de tono al 80 % y al
// 100 % (PLAN-SAAS D5). Sin límite, solo el número.

export function BarraUso({
  etiqueta,
  usadas,
  maximo,
  nota,
}: {
  etiqueta: string;
  usadas: number;
  maximo: number | null;
  nota?: string;
}): ReactElement {
  const nivel = nivelCuota(usadas, maximo);
  const porcentaje =
    maximo === null || maximo === 0
      ? maximo === 0
        ? 100
        : 0
      : Math.min(100, (usadas / maximo) * 100);
  return (
    <div className={estilos.uso}>
      <div className={estilos.usoCabecera}>
        <span className={estilos.usoEtiqueta}>{etiqueta}</span>
        <span className={estilos.usoCifra}>
          {usadas.toLocaleString('es-CL')}
          {maximo === null ? ' · sin límite' : ` de ${textoLimite(maximo)}`}
        </span>
      </div>
      {/* Cupo 0 (plan sin producción): sin barra, la nota lo explica. */}
      {maximo !== null && maximo > 0 ? (
        <div className={estilos.barra} aria-hidden="true">
          <div className={estilos.relleno} data-nivel={nivel} style={{ width: `${porcentaje}%` }} />
        </div>
      ) : null}
      {nota ? <p className={estilos.usoNota}>{nota}</p> : null}
    </div>
  );
}
