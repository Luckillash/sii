// Formatos chilenos del design system «Boletéame» (puerto de `Boleteame.utils` del bundle).
// Sin dependencias de React ni del navegador: se usan en el servidor y en el cliente.

export type CodigoDte = 33 | 34 | 39 | 41 | 43 | 46 | 52 | 56 | 61 | 110 | 111 | 112;

/** Código → [nombre oficial del SII, nombre corto]. */
export const TIPOS_DTE: Readonly<Record<number, readonly [string, string]>> = {
  33: ['Factura electrónica', 'Factura'],
  34: ['Factura no afecta o exenta electrónica', 'Factura exenta'],
  39: ['Boleta electrónica', 'Boleta'],
  41: ['Boleta exenta electrónica', 'Boleta exenta'],
  43: ['Liquidación factura electrónica', 'Liquidación'],
  46: ['Factura de compra electrónica', 'Factura de compra'],
  52: ['Guía de despacho electrónica', 'Guía de despacho'],
  56: ['Nota de débito electrónica', 'Nota de débito'],
  61: ['Nota de crédito electrónica', 'Nota de crédito'],
  110: ['Factura de exportación electrónica', 'Factura exportación'],
  111: ['Nota de débito de exportación electrónica', 'N. débito exportación'],
  112: ['Nota de crédito de exportación electrónica', 'N. crédito exportación'],
};

const TIPO_DESCONOCIDO = ['Documento tributario', 'Documento'] as const;

export function nombreTipoDte(codigo: number, corto = false): string {
  const t = TIPOS_DTE[codigo] ?? TIPO_DESCONOCIDO;
  return corto ? t[1] : t[0];
}

/** Separador de miles con punto: 1190000 → "1.190.000". Solo enteros no negativos. */
export function formatearMiles(n: number): string {
  let s = String(Math.trunc(Math.abs(n)));
  let out = '';
  while (s.length > 3) {
    out = `.${s.slice(-3)}${out}`;
    s = s.slice(0, -3);
  }
  return s + out;
}

/**
 * `$ 1.190.000` en CLP (sin decimales). Otras monedas con dos decimales y coma:
 * `US$ 1.250,50`, `UF 12,35`. Negativos con signo menos tipográfico (−).
 */
export function formatearMonto(valor: number, moneda = 'CLP'): string {
  let v = Number(valor) || 0;
  const negativo = v < 0;
  v = Math.abs(v);
  let texto: string;
  if (!moneda || moneda === 'CLP') {
    texto = `$ ${formatearMiles(Math.round(v))}`;
  } else {
    let entero = Math.floor(v);
    let dec = Math.round((v - entero) * 100);
    if (dec === 100) {
      entero += 1;
      dec = 0;
    }
    const prefijo = moneda === 'USD' ? 'US$ ' : moneda === 'UF' ? 'UF ' : `${moneda} `;
    texto = `${prefijo}${formatearMiles(entero)},${String(dec).padStart(2, '0')}`;
  }
  return (negativo && v !== 0 ? '−' : '') + texto;
}

/** Deja solo dígitos y K (en mayúscula). */
export function limpiarRut(rut: string | null | undefined): string {
  return String(rut ?? '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
}

/** Dígito verificador (módulo 11) del cuerpo del RUT. */
export function calcularDv(cuerpo: string): string {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number.parseInt(cuerpo.charAt(i), 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

/** `76354771k` → `76.354.771-K`. Con menos de 2 caracteres devuelve lo limpio. */
export function formatearRut(rut: string | null | undefined): string {
  const c = limpiarRut(rut);
  if (c.length < 2) return c;
  const cuerpo = c.slice(0, -1).replace(/^0+/, '') || '0';
  return `${formatearMiles(Number(cuerpo))}-${c.slice(-1)}`;
}

/** RUT sin puntos con guion, como lo pide el SII: `76354771-K`. */
export function rutSii(rut: string | null | undefined): string {
  const c = limpiarRut(rut);
  if (c.length < 2) return c;
  return `${c.slice(0, -1).replace(/^0+/, '') || '0'}-${c.slice(-1)}`;
}

export function validarRut(rut: string | null | undefined): boolean {
  const c = limpiarRut(rut);
  if (c.length < 2) return false;
  const cuerpo = c.slice(0, -1);
  if (cuerpo.includes('K')) return false;
  return calcularDv(cuerpo) === c.slice(-1);
}

const ZONA_CHILE = 'America/Santiago';

function partes(fecha: Date | string, opciones: Intl.DateTimeFormatOptions) {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const p = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA_CHILE, ...opciones }).formatToParts(
    d,
  );
  return (tipo: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === tipo)?.value ?? '';
}

/**
 * `10-11-2026`, en hora de Chile. Una fecha sola `AAAA-MM-DD` (columna `date`) se
 * formatea tal cual, sin pasar por zonas horarias.
 */
export function formatearFecha(fecha: Date | string): string {
  if (typeof fecha === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const p = partes(fecha, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p('day')}-${p('month')}-${p('year')}`;
}

/** `10-11-2026 16:18`, 24 h, en hora de Chile. */
export function formatearFechaHora(fecha: Date | string): string {
  const p = partes(fecha, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${p('day')}-${p('month')}-${p('year')} ${p('hour')}:${p('minute')}`;
}
