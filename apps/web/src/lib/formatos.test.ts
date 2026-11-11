import { describe, expect, it } from 'vitest';
import {
  calcularDv,
  formatearFecha,
  formatearFechaHora,
  formatearMiles,
  formatearMonto,
  formatearRut,
  limpiarRut,
  nombreTipoDte,
  rutSii,
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
