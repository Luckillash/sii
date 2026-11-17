import { FECHA_ISO, type Tabla, type TipoColumna, type Valor } from './tabla';

// CSV de las exportaciones (PLAN-SAAS Fase 9), pensado para abrirlo con doble clic en
// Excel con configuración regional de Chile:
// - UTF-8 con BOM: sin él, Excel lo lee como Windows-1252 y rompe tildes y eñes.
// - Separador `;`: en es-CL la coma es el separador decimal, así que Excel espera `;`.
// - CRLF y comillas según RFC 4180 (comillas dobles duplicadas dentro de un campo).
// - Montos como enteros sin formato (sumables en Excel); fechas `DD-MM-AAAA`.
// - Inyección de fórmulas (OWASP «CSV Injection»): una razón social que empieza con `=`,
//   `+`, `-`, `@`, tabulación o retorno de carro Excel la evaluaría como fórmula. Las
//   celdas de TEXTO que empiezan así llevan un `'` delante; las numéricas no se tocan
//   (un monto negativo sigue siendo número).
// Puro: se prueba con Vitest.

export const SEPARADOR = ';';
const BOM = '﻿';
const FIN_DE_LINEA = '\r\n';
const INICIO_PELIGROSO = /^[=+\-@\t\r]/;

/** Antepone `'` a un texto que Excel tomaría como fórmula. */
export function neutralizarFormula(texto: string): string {
  return INICIO_PELIGROSO.test(texto) ? `'${texto}` : texto;
}

/** Comillas solo si hacen falta (separador, comillas, saltos de línea o espacios en los bordes). */
function citar(texto: string): string {
  if (/[";\r\n]/.test(texto) || texto !== texto.trim()) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function celda(valor: Valor, tipo: TipoColumna): string {
  if (valor === null || valor === '') return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    // Los montos y folios son enteros; si llegara un decimal, sin separador de miles.
    return String(valor);
  }
  if (tipo === 'fecha') {
    const m = FECHA_ISO.exec(valor);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return citar(neutralizarFormula(valor));
}

/** El CSV completo (con BOM) listo para responder. */
export function generarCsv(tabla: Tabla): Buffer {
  const lineas = [
    tabla.columnas.map((c) => citar(neutralizarFormula(c.titulo))).join(SEPARADOR),
    ...tabla.filas.map((f) =>
      tabla.columnas.map((c, i) => celda(f.celdas[i] ?? null, c.tipo)).join(SEPARADOR),
    ),
  ];
  return Buffer.from(BOM + lineas.join(FIN_DE_LINEA) + FIN_DE_LINEA, 'utf8');
}
