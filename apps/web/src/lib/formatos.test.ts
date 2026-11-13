import { describe, expect, it } from 'vitest';
import {
  cabeEnIso88591,
  calcularDv,
  caracteresFueraDeIso88591,
  correoSiiValido,
  formatearFecha,
  formatearFechaHora,
  formatearMiles,
  formatearMonto,
  formatearRut,
  hoyEnChile,
  limpiarRut,
  nombreTipoDte,
  rutSii,
  rutValidoSii,
  validarRut,
} from './formatos';

describe('formatearMonto', () => {
  it('CLP con punto de miles y sin decimales', () => {
    expect(formatearMonto(1190000)).toBe('$ 1.190.000');
    expect(formatearMonto(0)).toBe('$ 0');
    expect(formatearMonto(999)).toBe('$ 999');
    expect(formatearMonto(1000.6)).toBe('$ 1.001');
  });
  it('negativos con signo menos tipográfico', () => {
    expect(formatearMonto(-220150)).toBe('−$ 220.150');
  });
  it('otras monedas con dos decimales y coma', () => {
    expect(formatearMonto(1250.5, 'USD')).toBe('US$ 1.250,50');
    expect(formatearMonto(12.345, 'UF')).toBe('UF 12,35');
    expect(formatearMonto(9.999, 'EUR')).toBe('EUR 10,00');
  });
});

describe('RUT', () => {
  it('calcula el dígito verificador', () => {
    expect(calcularDv('76354771')).toBe('K');
    expect(calcularDv('11111111')).toBe('1');
    expect(calcularDv('66666666')).toBe('6');
    expect(calcularDv('12865430')).toBe('5');
  });
  it('formatea con puntos y guion', () => {
    expect(formatearRut('76354771k')).toBe('76.354.771-K');
    expect(formatearRut('7.7104.562-6')).toBe('77.104.562-6');
    expect(formatearRut('0012345678-5')).toBe('12.345.678-5');
    expect(formatearRut('1')).toBe('1');
  });
  it('formato del SII sin puntos', () => {
    expect(rutSii('76.354.771-k')).toBe('76354771-K');
  });
  it('valida', () => {
    expect(validarRut('76.354.771-K')).toBe(true);
    expect(validarRut('76354771-0')).toBe(false);
    expect(validarRut('K1-1')).toBe(false);
    expect(validarRut('')).toBe(false);
    expect(validarRut(null)).toBe(false);
  });
  it('limpia', () => {
    expect(limpiarRut(' 76.354.771-k ')).toBe('76354771K');
  });
});

describe('otros formatos', () => {
  it('miles', () => {
    expect(formatearMiles(18244)).toBe('18.244');
  });
  it('fechas en dd-mm-aaaa y 24 h, hora de Chile', () => {
    expect(formatearFecha('2026-11-10')).toBe('10-11-2026');
    // 2026-11-10T19:18Z = 16:18 en Chile (UTC−3 en horario de verano)
    expect(formatearFecha(new Date('2026-11-10T19:18:00Z'))).toBe('10-11-2026');
    expect(formatearFechaHora('2026-11-10T19:18:00Z')).toBe('10-11-2026 16:18');
  });
  it('nombres de tipos de DTE', () => {
    expect(nombreTipoDte(39)).toBe('Boleta electrónica');
    expect(nombreTipoDte(41, true)).toBe('Boleta exenta');
    expect(nombreTipoDte(999)).toBe('Documento tributario');
  });
});

// Cada regla de `public.correo_sii_valido()` (supabase/migrations/0001_esquema_inicial.sql §2).
describe('correoSiiValido', () => {
  it('acepta correos comunes', () => {
    expect(correoSiiValido('dte@empresa.cl')).toBe(true);
    expect(correoSiiValido('facturacion.electronica@sub.empresa.cl')).toBe(true);
    expect(correoSiiValido('a_b-c~d@x.y')).toBe(true);
  });
  it('hasta 50 caracteres', () => {
    const local = 'a'.repeat(50 - '@x.cl'.length);
    expect(correoSiiValido(`${local}@x.cl`)).toBe(true);
    expect(correoSiiValido(`a${local}@x.cl`)).toBe(false);
  });
  it('solo ASCII imprimible, sin espacios ni tildes', () => {
    expect(correoSiiValido('dte @empresa.cl')).toBe(false);
    expect(correoSiiValido(' dte@empresa.cl')).toBe(false);
    expect(correoSiiValido('dte\t@empresa.cl')).toBe(false);
    expect(correoSiiValido('pañol@empresa.cl')).toBe(false);
    expect(correoSiiValido('')).toBe(false);
  });
  it('sin ] ! " # $ % & / ( ) = ? + * | < > [ ;', () => {
    for (const c of ']!"#$%&/()=?+*|<>[;') {
      expect(correoSiiValido(`dte${c}x@empresa.cl`), c).toBe(false);
    }
    // Otros signos imprimibles sí pasan: la regla no los prohíbe.
    for (const c of "-_'`{}^~,:\\") {
      expect(correoSiiValido(`dte${c}x@empresa.cl`), c).toBe(true);
    }
  });
  it('un solo @, ni al inicio ni al final', () => {
    expect(correoSiiValido('dteempresa.cl')).toBe(false);
    expect(correoSiiValido('dte@@empresa.cl')).toBe(false);
    expect(correoSiiValido('dte@a@empresa.cl')).toBe(false);
    expect(correoSiiValido('@empresa.cl')).toBe(false);
    expect(correoSiiValido('dte.cl@')).toBe(false);
  });
  it("sin '@.'", () => {
    expect(correoSiiValido('dte@.empresa.cl')).toBe(false);
  });
  it('sin empezar ni terminar en punto', () => {
    expect(correoSiiValido('.dte@empresa.cl')).toBe(false);
    expect(correoSiiValido('dte@empresa.cl.')).toBe(false);
    // Un punto justo antes del @ sí pasa: la regla no lo prohíbe.
    expect(correoSiiValido('dte.@empresa.cl')).toBe(true);
  });
  it('con un punto después del @', () => {
    expect(correoSiiValido('dte@empresa')).toBe(false);
    expect(correoSiiValido('d.te@empresa')).toBe(false);
  });
});

// `public.rut_valido()`: formato del dominio `rut` y DV módulo 11.
describe('rutValidoSii', () => {
  it('sin puntos, con guion y K mayúscula', () => {
    expect(rutValidoSii('76354771-K')).toBe(true);
    expect(rutValidoSii('12345678-5')).toBe(true);
    expect(rutValidoSii('1-9')).toBe(true);
    expect(rutValidoSii('76354771-k')).toBe(false);
    expect(rutValidoSii('76.354.771-K')).toBe(false);
    expect(rutValidoSii('76354771K')).toBe(false);
  });
  it('cuerpo de 1 a 8 dígitos', () => {
    expect(rutValidoSii('-5')).toBe(false);
    expect(rutValidoSii('123456789-2')).toBe(false);
  });
  it('dígito verificador', () => {
    expect(rutValidoSii('76354771-1')).toBe(false);
    expect(rutValidoSii('12345678-K')).toBe(false);
  });
});

describe('caracteresFueraDeIso88591', () => {
  it('acepta todo ISO-8859-1: ASCII, tildes, ñ, ü, º, ª, °, «», ¿¡', () => {
    const texto = 'Ñuñoa Pingüino Nº 1 1ª piso 20° «A» ¿sí? ¡no! ÿ';
    expect(caracteresFueraDeIso88591(texto)).toEqual([]);
    expect(cabeEnIso88591(texto)).toBe(true);
    expect(cabeEnIso88591(String.fromCodePoint(0xff))).toBe(true);
  });
  it('detecta lo que no cabe, sin repetir y en orden', () => {
    expect(caracteresFueraDeIso88591('Café 😀 “Andes” – 50 € 😀')).toEqual([
      '😀',
      '“',
      '”',
      '–',
      '€',
    ]);
    expect(cabeEnIso88591(String.fromCodePoint(0x100))).toBe(false);
  });
  it('un surrogate suelto cuenta como fuera', () => {
    expect(cabeEnIso88591('a\uD83Db')).toBe(false);
  });
});

describe('hoyEnChile', () => {
  it('fecha de Chile, no la UTC', () => {
    // 02:30 UTC del 11 = 23:30 del 10 en Chile (UTC−3 en horario de verano).
    expect(hoyEnChile(new Date('2026-11-11T02:30:00Z'))).toBe('2026-11-10');
    expect(hoyEnChile(new Date('2026-11-11T03:30:00Z'))).toBe('2026-11-11');
  });
});
