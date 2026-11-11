import { describe, expect, it } from 'vitest';
import { ErrorTransporte } from '../../../../src/comun/errores.ts';
import { exigirStatus, RespuestaHttp } from '../../../../src/comun/http/respuesta.ts';

describe('RespuestaHttp', () => {
  it('normaliza nombres a minúsculas y junta valores repetidos', () => {
    const r = new RespuestaHttp(
      200,
      [
        ['Set-Cookie', 'a=1'],
        ['set-cookie', ['b=2', 'c=3']],
        ['Content-Type', 'text/html'],
      ],
      'hola',
    );
    expect(r.cabecera('SET-COOKIE')).toEqual(['a=1', 'b=2', 'c=3']);
    expect(r.cabecera('content-type')).toEqual(['text/html']);
    expect(r.cabecera('location')).toEqual([]);
    expect(r.cuerpo).toEqual(Buffer.from('hola'));
  });

  it('acepta cabeceras como objeto y cuerpo en bytes', () => {
    const r = new RespuestaHttp(200, { Location: '/x' }, new Uint8Array([0xe1]));
    expect(r.cabecera('location')).toEqual(['/x']);
    expect(Buffer.isBuffer(r.cuerpo)).toBe(true);
    expect(r.cuerpo).toEqual(Buffer.from([0xe1]));
    expect(new RespuestaHttp(204).cuerpo.length).toBe(0);
  });

  it('esRedireccion: 301/302/303/307/308 con Location, igual que el PHP', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      expect(new RespuestaHttp(status, { location: '/x' }).esRedireccion()).toBe(true);
      expect(new RespuestaHttp(status).esRedireccion()).toBe(false);
    }
    for (const status of [200, 300, 304, 305, 404]) {
      expect(new RespuestaHttp(status, { location: '/x' }).esRedireccion()).toBe(false);
    }
  });
});

describe('exigirStatus', () => {
  it('devuelve la respuesta si el código es esperado', () => {
    const r = new RespuestaHttp(302, { location: '/x' });
    expect(exigirStatus(r, 'https://a.cl/', [200, 302])).toBe(r);
    expect(exigirStatus(new RespuestaHttp(200), 'https://a.cl/')).toBeInstanceOf(RespuestaHttp);
  });

  it('lanza ErrorTransporte con el código, el host y la URL sin query', () => {
    const url = 'https://rahue.sii.cl/recursos/v1/boleta.electronica.envio?rut=11111111-1';
    let error: unknown;
    try {
      exigirStatus(new RespuestaHttp(503, {}, 'caído'), url, [200, 201]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorTransporte);
    const e = error as ErrorTransporte;
    expect(e.status).toBe(503);
    expect(e.url).toBe('https://rahue.sii.cl/recursos/v1/boleta.electronica.envio');
    expect(e.message).toBe('rahue.sii.cl respondió HTTP 503 (se esperaba 200 o 201).');
  });
});
