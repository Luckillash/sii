import 'server-only';
import type { FiltrosDocumentos } from '../documentos/filtros';
import { generarCsv } from './csv';
import { type Formato, nombreArchivo, type Reporte, tablaDocumentos, tablaResumen } from './filas';
import {
  type ContextoExportacion,
  type DependenciasLectura,
  leerDocumentosExportacion,
  leerResumenDiario,
} from './lectura';
import { generarXlsx, MIME_XLSX } from './xlsx';

// Exportaciones del período (PLAN-SAAS Fase 9, punto 2): documentos y resumen diario por
// tipo, en CSV o Excel. La ruta `app/[org]/reportes/exportar/route.ts` autentica y elige
// empresa y ambiente; esto lee (sesión, RLS) y arma el archivo.
//
//   filas.ts    pedido de la URL, columnas y filas, nombre del archivo, enlace (puro)
//   lectura.ts  documentos (paginados) y `v_ventas_diarias` (sesión, RLS)
//   csv.ts      CSV para Excel es-CL (puro)
//   xlsx.ts     .xlsx mínimo (puro) sobre zip.ts

export { type Formato, hrefExportar, leerPedido, MAXIMO_FILAS, type Reporte } from './filas';
export { ExportacionDemasiadoGrande } from './lectura';

export interface ArchivoExportado {
  cuerpo: Buffer;
  nombre: string;
  tipoContenido: string;
}

export const MIME_CSV = 'text/csv; charset=utf-8';

export async function generarExportacion(
  pedido: {
    reporte: Reporte;
    formato: Formato;
    ctx: ContextoExportacion;
    rutEmpresa: string;
    filtros: Pick<FiltrosDocumentos, 'periodo' | 'tipo' | 'estado' | 'q'>;
  },
  dependencias?: Partial<DependenciasLectura>,
): Promise<ArchivoExportado> {
  const { reporte, formato, ctx, filtros } = pedido;
  const tabla =
    reporte === 'documentos'
      ? tablaDocumentos(await leerDocumentosExportacion(ctx, filtros, dependencias))
      : tablaResumen(await leerResumenDiario(ctx, filtros.periodo, dependencias));
  return {
    cuerpo: formato === 'csv' ? generarCsv(tabla) : generarXlsx(tabla),
    nombre: nombreArchivo(reporte, pedido.rutEmpresa, ctx.ambiente, filtros.periodo, formato),
    tipoContenido: formato === 'csv' ? MIME_CSV : MIME_XLSX,
  };
}
