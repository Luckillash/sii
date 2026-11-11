import { describe, expect, it } from 'vitest';
import { codificarFormulario, codificarUrl } from '../../../../src/comun/http/formulario.ts';
import { prepararPeticion } from '../../../../src/comun/http/transporte.ts';

describe('codificarUrl (urlencode de PHP)', () => {
  it('deja sin codificar solo letras, dígitos, guion, punto y guion bajo', () => {
    expect(codificarUrl('AZaz09-._')).toBe('AZaz09-._');
    expect(codificarUrl('~*')).toBe('%7E%2A');
    expect(codificarUrl('a b')).toBe('a+b');
    expect(codificarUrl('+&=%')).toBe('%2B%26%3D%25');
  });

  it('codifica los bytes: UTF-8 para texto, tal cual para Buffer', () => {
    expect(codificarUrl('ñ')).toBe('%C3%B1');
    expect(codificarUrl(Buffer.from([0xf1]))).toBe('%F1');
    expect(codificarUrl(new Uint8Array([0x00, 0xff]))).toBe('%00%FF');
  });
});

describe('codificarFormulario (http_build_query de PHP)', () => {
  it('une pares con & y = en el orden entregado', () => {
    expect(
      codificarFormulario([
        ['b', '1'],
        ['a', '2'],
      ]),
    ).toBe('b=1&a=2');
    expect(codificarFormulario(new Map([['x', 'y z']]))).toBe('x=y+z');
    expect(codificarFormulario({ referencia: 'https://maullin.sii.cl/a?b' })).toBe(
      'referencia=https%3A%2F%2Fmaullin.sii.cl%2Fa%3Fb',
    );
  });

  it('formulario vacío: cadena vacía', () => {
    expect(codificarFormulario([])).toBe('');
    expect(codificarFormulario({})).toBe('');
  });

  it('una lista de pares admite claves repetidas', () => {
    expect(
      codificarFormulario([
        ['a', '1'],
        ['a', '2'],
      ]),
    ).toBe('a=1&a=2');
  });

  it('un objeto de JS reordena las claves numéricas; una lista no', () => {
    expect(codificarFormulario({ b: 'x', '2': 'y' })).toBe('2=y&b=x');
    expect(
      codificarFormulario([
        ['b', 'x'],
        ['2', 'y'],
      ]),
    ).toBe('b=x&2=y');
  });
});

describe('prepararPeticion', () => {
  it('formulario: fija Content-Type reemplazando el que venía, en su lugar', () => {
    const { cabeceras, cuerpo } = prepararPeticion({
      metodo: 'POST',
      url: 'https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios',
      cabeceras: { Referer: 'r', 'content-type': 'text/plain', 'User-Agent': 'ua' },
      cuerpo: { tipo: 'formulario', campos: { RUT_EMP: '11111111', DV_EMP: '1' } },
    });
    expect(Object.entries(cabeceras)).toEqual([
      ['Referer', 'r'],
      ['Content-Type', 'application/x-www-form-urlencoded'],
      ['User-Agent', 'ua'],
      ['Accept-Encoding', 'gzip, deflate'],
    ]);
    expect(cuerpo?.toString('latin1')).toBe('RUT_EMP=11111111&DV_EMP=1');
  });

  it('crudo: string en UTF-8, bytes tal cual, con su Content-Type', () => {
    const texto = prepararPeticion({
      metodo: 'POST',
      url: 'https://maullin.sii.cl/DTEWS/CrSeed.jws',
      cuerpo: { tipo: 'crudo', datos: '<a>ñ</a>', contentType: 'text/xml; charset=utf-8' },
      descomprimir: false,
    });
    expect(texto.cuerpo).toEqual(Buffer.from('<a>ñ</a>', 'utf8'));
    expect(texto.cabeceras).toEqual({ 'Content-Type': 'text/xml; charset=utf-8' });

    const bytes = prepararPeticion({
      metodo: 'POST',
      url: 'https://maullin.sii.cl/x',
      cuerpo: { tipo: 'crudo', datos: Buffer.from([0xf1]), contentType: 'text/plain' },
    });
    expect(bytes.cuerpo).toEqual(Buffer.from([0xf1]));
  });

  it('respeta un Accept-Encoding propio y no agrega uno sin descomprimir', () => {
    const propio = prepararPeticion({
      metodo: 'GET',
      url: 'https://a.cl/',
      cabeceras: { 'accept-encoding': 'identity' },
    });
    expect(propio.cabeceras).toEqual({ 'accept-encoding': 'identity' });
    const sin = prepararPeticion({ metodo: 'GET', url: 'https://a.cl/', descomprimir: false });
    expect(sin.cabeceras).toEqual({});
    expect(sin.cuerpo).toBeUndefined();
  });
});
