import { describe, expect, it } from 'vitest';
import { codificarCursor, condicionCursor, decodificarCursor } from './cursor';
import {
  exigirClaveIdempotencia,
  huella,
  jsonCanonico,
  leerClaveIdempotencia,
} from './idempotencia';
import { ErrorApi } from './respuestas';

function codigo(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (error instanceof ErrorApi) return error.codigo;
    throw error;
  }
}

describe('Idempotency-Key', () => {
  it('lee la cabecera (sin distinguir mayúsculas en el nombre)', () => {
    expect(leerClaveIdempotencia(new Headers({ 'idempotency-key': 'pedido-123' }))).toBe(
      'pedido-123',
    );
    expect(leerClaveIdempotencia(new Headers())).toBeNull();
  });

  it('400 idempotencia_requerida si falta y idempotencia_invalida si no tiene la forma', () => {
    expect(codigo(() => exigirClaveIdempotencia(new Headers()))).toBe('idempotencia_requerida');
    for (const mala of ['con espacio', 'ñandú', 'x'.repeat(201)]) {
      expect(codigo(() => exigirClaveIdempotencia(new Headers({ 'Idempotency-Key': mala })))).toBe(
        'idempotencia_invalida',
      );
    }
    expect(
      exigirClaveIdempotencia(new Headers({ 'Idempotency-Key': 'x'.repeat(200) })),
    ).toHaveLength(200);
  });
});

describe('huella', () => {
  it('no depende del orden de las llaves, sí del de los arreglos', () => {
    expect(jsonCanonico({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(huella({ a: 1, b: 2 })).toBe(huella({ b: 2, a: 1 }));
    expect(huella({ l: [1, 2] })).not.toBe(huella({ l: [2, 1] }));
    expect(huella({ a: 1, b: undefined })).toBe(huella({ a: 1 }));
    expect(huella({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cursor', () => {
  const c = {
    creadoEn: '2026-11-18T12:00:00.123456+00:00',
    id: '22222222-2222-4222-8222-222222222222',
  };

  it('ida y vuelta, opaco (base64url)', () => {
    const texto = codificarCursor(c);
    expect(texto).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificarCursor(texto)).toEqual(c);
  });

  it('400 cursor_invalido si se alteró (nunca llega a PostgREST)', () => {
    const inyectado = Buffer.from(
      JSON.stringify(['2026-11-18T12:00:00Z),id.gt.(0', c.id]),
    ).toString('base64url');
    for (const malo of ['@@@', 'abc', inyectado, Buffer.from('{}').toString('base64url')]) {
      expect(codigo(() => decodificarCursor(malo))).toBe('cursor_invalido');
    }
  });

  it('arma el keyset descendente con valores entre comillas', () => {
    expect(condicionCursor(c)).toBe(
      `creado_en.lt."${c.creadoEn}",and(creado_en.eq."${c.creadoEn}",id.lt."${c.id}")`,
    );
  });
});
