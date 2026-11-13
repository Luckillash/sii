// Estado de los certificados para la UI (PLAN-SAAS Fase 3, punto 5). Puro, sin
// `server-only`: lo usan la página de certificados, la de la empresa, el Tablero y
// los componentes cliente. El estado lo calcula la vista `v_certificados_estado`:
//
//   revocado    revocado_en no nulo (manda sobre lo demás)
//   vencido     vigente_hasta < now()
//   por_vencer  vigente_hasta < now() + 30 días
//   vigente     el resto

import type { Tono } from '@/components/boleteame';
import { formatearFecha } from '@/lib/formatos';
import type { MensajeError } from './errores';

export type EstadoCertificado = 'vigente' | 'por_vencer' | 'vencido' | 'revocado';

/** Días de aviso antes del vencimiento (igual que la vista). */
export const DIAS_AVISO_VENCIMIENTO = 30;

export const ESTADOS_CERTIFICADO: Readonly<
  Record<EstadoCertificado, { etiqueta: string; tono: Tono | 'neutro' }>
> = {
  vigente: { etiqueta: 'Vigente', tono: 'exito' },
  por_vencer: { etiqueta: 'Por vencer', tono: 'aviso' },
  vencido: { etiqueta: 'Vencido', tono: 'error' },
  revocado: { etiqueta: 'Revocado', tono: 'neutro' },
};

export function esEstadoCertificado(valor: unknown): valor is EstadoCertificado {
  return typeof valor === 'string' && Object.hasOwn(ESTADOS_CERTIFICADO, valor);
}

/** Lo mínimo de una fila de `v_certificados_estado` para avisar. */
export interface FilaEstadoCertificado {
  nombreTitular: string | null;
  estado: EstadoCertificado;
  diasRestantes: number;
  /** ISO. */
  vigenteHasta: string | null;
}

export function textoDias(dias: number): string {
  if (dias <= 0) return 'hoy';
  return dias === 1 ? '1 día' : `${dias} días`;
}

function deQuien(fila: FilaEstadoCertificado): string {
  return fila.nombreTitular?.trim() ? `de ${fila.nombreTitular.trim()}` : 'digital';
}

export interface AlertaCertificados extends MensajeError {
  tono: 'aviso' | 'error';
}

/**
 * Avisos para el Tablero y la página de certificados: uno `error` si hay vencidos y
 * uno `aviso` si hay por vencer. Los revocados no avisan (ya se dejaron de usar).
 */
export function alertasCertificados(filas: readonly FilaEstadoCertificado[]): AlertaCertificados[] {
  const alertas: AlertaCertificados[] = [];
  const vencidos = filas.filter((f) => f.estado === 'vencido');
  const porVencer = filas
    .filter((f) => f.estado === 'por_vencer')
    .sort((a, b) => a.diasRestantes - b.diasRestantes);

  const [unVencido] = vencidos;
  if (unVencido) {
    alertas.push({
      tono: 'error',
      titulo:
        vencidos.length === 1
          ? `El certificado ${deQuien(unVencido)} está vencido`
          : `${vencidos.length} certificados están vencidos`,
      detalle:
        vencidos.length === 1 && unVencido.vigenteHasta
          ? `Venció el ${formatearFecha(unVencido.vigenteHasta)}. Con un certificado vencido no se pueden firmar documentos: carga el nuevo y elimina o revoca el anterior.`
          : 'Con un certificado vencido no se pueden firmar documentos: carga los nuevos y elimina o revoca los anteriores.',
    });
  }

  const [proximo] = porVencer;
  if (proximo) {
    const cuando =
      proximo.diasRestantes <= 0 ? 'vence hoy' : `vence en ${textoDias(proximo.diasRestantes)}`;
    alertas.push({
      tono: 'aviso',
      titulo:
        porVencer.length === 1
          ? `Tu certificado ${deQuien(proximo)} ${cuando}`
          : `${porVencer.length} certificados vencen en los próximos ${DIAS_AVISO_VENCIMIENTO} días`,
      detalle:
        porVencer.length === 1 && proximo.vigenteHasta
          ? `Sin un certificado vigente no podrás firmar documentos. Carga el nuevo antes del ${formatearFecha(proximo.vigenteHasta)}.`
          : `El primero ${cuando}. Sin un certificado vigente no podrás firmar documentos: carga los nuevos antes de que venzan.`,
    });
  }
  return alertas;
}
