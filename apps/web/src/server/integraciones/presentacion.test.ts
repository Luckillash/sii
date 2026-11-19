import { describe, expect, it } from 'vitest';
import {
  type EntregaVista,
  estadoClave,
  expiracionDesde,
  fallasSeguidas,
  prefijoVisible,
  sePuedeReenviar,
} from './presentacion';

function entrega(estado: EntregaVista['estado'], id = 1): EntregaVista {
  return {
    id,
    evento: 'documento.aceptado',
    estado,
    intentos: estado === 'pendiente' ? 0 : 1,
    ultimoStatusHttp: null,
    ultimaRespuesta: null,
    siguienteIntentoEn: '2026-11-18T12:00:00Z',
    entregadoEn: null,
    reenviadaEn: null,
    creadoEn: '2026-11-18T12:00:00Z',
  };
}

describe('estadoClave', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');

  it('activa sin revocar ni vencer', () => {
    expect(estadoClave({ revocadaEn: null, expiraEn: null }, ahora)).toBe('activa');
    expect(estadoClave({ revocadaEn: null, expiraEn: '2026-12-01T00:00:00Z' }, ahora)).toBe(
      'activa',
    );
  });

  it('vencida justo al llegar su fecha (como autenticar_api_key: expira_en <= now())', () => {
    expect(estadoClave({ revocadaEn: null, expiraEn: '2026-11-18T12:00:00Z' }, ahora)).toBe(
      'vencida',
    );
  });

  it('revocada gana a vencida', () => {
    expect(
      estadoClave({ revocadaEn: '2026-11-01T00:00:00Z', expiraEn: '2026-11-02T00:00:00Z' }, ahora),
    ).toBe('revocada');
  });
});

describe('expiracionDesde', () => {
  it('sin plazo es null y con plazo suma días', () => {
    const ahora = new Date('2026-11-18T12:00:00Z');
    expect(expiracionDesde('', ahora)).toBeNull();
    expect(expiracionDesde('30', ahora)).toBe('2026-12-18T12:00:00.000Z');
    expect(expiracionDesde('365', ahora)).toBe('2027-11-18T12:00:00.000Z');
  });
});

describe('fallasSeguidas', () => {
  it('necesita 3 entregas con resultado, todas fallidas o descartadas', () => {
    expect(fallasSeguidas([entrega('fallido'), entrega('descartado')])).toBe(false);
    expect(fallasSeguidas([entrega('fallido'), entrega('descartado'), entrega('fallido')])).toBe(
      true,
    );
    expect(fallasSeguidas([entrega('fallido'), entrega('entregado'), entrega('fallido')])).toBe(
      false,
    );
  });

  it('las que siguen en cola no cuentan', () => {
    expect(
      fallasSeguidas([
        entrega('pendiente'),
        entrega('fallido'),
        entrega('fallido'),
        entrega('descartado'),
      ]),
    ).toBe(true);
  });
});

describe('otros', () => {
  it('prefijo visible y reenvío', () => {
    expect(prefijoVisible('sk_test_ab12')).toBe('sk_test_ab12…');
    expect(sePuedeReenviar({ estado: 'pendiente' })).toBe(false);
    for (const estado of ['fallido', 'entregado', 'descartado'] as const) {
      expect(sePuedeReenviar({ estado })).toBe(true);
    }
  });
});
