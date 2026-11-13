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

/** Largo máximo de un correo para el SII (`correo_sii_valido`). */
export const LARGO_MAXIMO_CORREO_SII = 50;

/** Caracteres que el SII no acepta en un correo: ] ! " # $ % & / ( ) = ? + * | < > [ ; */
const CARACTERES_PROHIBIDOS_CORREO = /[\]!"#$%&/()=?+*|<>[;]/;

/**
 * Regla `esValidoMail2` del SII, igual que `public.correo_sii_valido()` del esquema
 * (dominio `correo_sii`): hasta 50 caracteres, ASCII imprimible sin espacios, sin
 * ] ! " # $ % & / ( ) = ? + * | < > [ ;, un solo @ que no esté al inicio ni al final,
 * sin `@.`, sin empezar ni terminar en punto y con un punto después del @. No recorta
 * espacios: quien llama decide (un espacio la hace fallar).
 */
export function correoSiiValido(correo: string): boolean {
  const dominio = correo.split('@')[1] ?? '';
  return (
    correo.length <= LARGO_MAXIMO_CORREO_SII &&
    /^[!-~]+$/.test(correo) &&
    !CARACTERES_PROHIBIDOS_CORREO.test(correo) &&
    /^[^@]+@[^@]+$/.test(correo) &&
    !correo.includes('@.') &&
    !correo.startsWith('.') &&
    !correo.endsWith('.') &&
    dominio.includes('.')
  );
}

/**
 * Caracteres de `texto` que no caben en un byte ISO-8859-1 (code point mayor que
 * U+00FF: emoji, €, comillas tipográficas “ ”, rayas – —, etc.), sin repetir y en
 * orden de aparición. Es la regla de `@winex/certificacion` (`FUERA_DE_ISO` en
 * `core/envio-boleta.ts`, `aIso88591` en `comun/codificacion.ts`), que no exporta un
 * validador: el DTE se firma en ISO-8859-1 y el generador escribe lo que no cabe como
 * `&#N;`. Un surrogate suelto también cuenta como fuera.
 */
export function caracteresFueraDeIso88591(texto: string): string[] {
  const fuera = new Set<string>();
  for (const caracter of texto) {
    if ((caracter.codePointAt(0) ?? 0) > 0xff) fuera.add(caracter);
  }
  return [...fuera];
}

/** ¿Cabe todo `texto` en ISO-8859-1? (Ver `caracteresFueraDeIso88591`.) */
export function cabeEnIso88591(texto: string): boolean {
  return caracteresFueraDeIso88591(texto).length === 0;
}

/** Formato del dominio `rut` del esquema (`rut_valido`): hasta 8 dígitos, guion y DV. */
const PATRON_RUT_SII = /^[0-9]{1,8}-[0-9K]$/;

/**
 * Igual que `public.rut_valido()`: formato `12345678-5` (sin puntos, K mayúscula,
 * cuerpo de 1 a 8 dígitos) y dígito verificador módulo 11. Para normalizar lo que
 * escribe el usuario, primero `rutSii()`.
 */
export function rutValidoSii(rut: string): boolean {
  if (!PATRON_RUT_SII.test(rut)) return false;
  const [cuerpo = '', dv] = rut.split('-');
  return calcularDv(cuerpo) === dv;
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

/** Fecha de hoy en Chile como `AAAA-MM-DD` (el formato de una columna `date` y de `<input type="date">`). */
export function hoyEnChile(ahora: Date = new Date()): string {
  const p = partes(ahora, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p('year')}-${p('month')}-${p('day')}`;
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
