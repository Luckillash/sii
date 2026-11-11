// Tests de SesionSii (port de src/Folios/SesionSii.php, sin tests en el PHP:
// pend. 6.1). Las reglas de dominio también se comparan contra el PHP en el caso
// de paridad sesion-sii-cookies; aquí va lo que la paridad no puede fijar
// (reloj inyectable) y lo propio de Node (no mostrar la credencial).

import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import { relojFijo } from '../../../src/comun/reloj.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';

const respuesta = (...setCookie: string[]): RespuestaHttp =>
  new RespuestaHttp(200, { 'set-cookie': setCookie });

describe('SesionSii', () => {
  it('Expires se compara con el reloj inyectado', () => {
    const s = new SesionSii({ reloj: relojFijo('2030-01-01T00:00:00Z') });
    s.recibir(
      'https://maullin.sii.cl/',
      respuesta(
        'A=1; Domain=sii.cl; Expires=Tue, 31 Dec 2029 23:59:59 GMT',
        'B=1; Domain=sii.cl; Expires=Wed, 02 Jan 2030 00:00:00 GMT',
      ),
    );
    expect(s.tiene('A')).toBe(false);
    expect(s.tiene('B')).toBe(true);
  });

  it('una cookie host-only no viaja a otros hosts; una de dominio sí', () => {
    const s = new SesionSii();
    s.recibir('https://herculesr.sii.cl/x', respuesta('H=1', 'D=2; Domain=.sii.cl'));
    expect(s.cabeceraPara('https://herculesr.sii.cl/y')).toBe('H=1; D=2');
    expect(s.cabeceraPara('https://maullin.sii.cl/y')).toBe('D=2');
    expect(s.cabeceraPara('https://evil.example/')).toBeNull();
  });

  it('el reemplazo conserva la posición y el borrado la quita', () => {
    const s = new SesionSii();
    s.recibir('https://maullin.sii.cl/', respuesta('A=1; Domain=sii.cl', 'B=2; Domain=sii.cl'));
    s.recibir('https://maullin.sii.cl/', respuesta('A=3; Domain=sii.cl'));
    expect(s.cabeceraPara('https://maullin.sii.cl/')).toBe('A=3; B=2');
    s.recibir('https://maullin.sii.cl/', respuesta('A=x; Domain=sii.cl; Max-Age=0'));
    expect(s.cabeceraPara('https://maullin.sii.cl/')).toBe('B=2');
  });

  it('aArreglo / desdeArreglo hacen ida y vuelta con el formato del PHP', () => {
    const s = new SesionSii();
    s.recibirDesdeHtml('<script>document.cookie = "TOKEN=T; domain=.sii.cl";</script>');
    s.recibir('https://maullin.sii.cl/', respuesta('J=1'));
    const arreglo = s.aArreglo();
    expect(arreglo).toEqual([
      { name: 'TOKEN', value: 'T', domain: 'sii.cl', host_only: false },
      { name: 'J', value: '1', domain: 'maullin.sii.cl', host_only: true },
    ]);
    expect(SesionSii.desdeArreglo(arreglo).aArreglo()).toEqual(arreglo);
  });

  it('no muestra los valores al inspeccionarla ni al serializarla (es una credencial)', () => {
    const s = SesionSii.desdeArreglo([
      { name: 'TOKEN', value: 'SECRETO', domain: 'sii.cl', host_only: false },
    ]);
    expect(inspect(s)).not.toContain('SECRETO');
    expect(inspect(s)).toContain('TOKEN@sii.cl');
    expect(JSON.stringify(s)).toBe('{"cookies":1}');
    expect(`${s}`).not.toContain('SECRETO');
  });
});
