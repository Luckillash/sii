// Contrato de URL de las descargas del período (PLAN-SAAS Fase 9, punto 2). El Tablero
// enlaza aquí y la ruta `/[org]/reportes/exportar` lee los mismos parámetros. Puro: lo
// usan el servidor y las pruebas.

export const REPORTES = ['documentos', 'resumen'] as const;
export type Reporte = (typeof REPORTES)[number];

export const FORMATOS_REPORTE = ['csv', 'xlsx'] as const;
export type FormatoReporte = (typeof FORMATOS_REPORTE)[number];

export interface ParametrosExportacion {
  empresa: string;
  ambiente: 'certificacion' | 'produccion';
  /** `AAAA-MM`. */
  periodo: string;
  reporte: Reporte;
  formato: FormatoReporte;
}

/**
 * `/<slug>/reportes/exportar?empresa=…&ambiente=…&periodo=…&reporte=…&formato=…`, con
 * los parámetros siempre en ese orden (así el enlace es estable y se puede comparar).
 */
export function hrefExportacion(slug: string, p: ParametrosExportacion): string {
  const q = new URLSearchParams();
  q.set('empresa', p.empresa);
  q.set('ambiente', p.ambiente);
  q.set('periodo', p.periodo);
  q.set('reporte', p.reporte);
  q.set('formato', p.formato);
  return `/${encodeURIComponent(slug)}/reportes/exportar?${q.toString()}`;
}
