// Casos de codificación que los golden tests no pueden expresar (surrogates
// sueltos no caben en el JSON que lee PHP). La equivalencia con PHP está en
// test/paridad/codificacion.test.ts y test/paridad/xml.test.ts.

import { describe, expect, it } from 'vitest';
import {
  aIso88591,
  decodificarUtf8OIso,
  desdeIso88591,
  escaparXml,
  esUtf8Valido,
  largoCodePoints,
  truncarCodePoints,
} from '../../../src/comun/codificacion.ts';

const SURROGATE_ALTO = String.fromCharCode(0xd83d);
const SURROGATE_BAJO = String.fromCharCode(0xde00);

describe('aIso88591', () => {
  it('pone un ? por code point fuera de rango, no el byte bajo como latin1', () => {
    expect(aIso88591('Ñ€😀a')).toEqual(Buffer.from([0xd1, 0x3f, 0x3f, 0x61]));
    expect(Buffer.from('€', 'latin1')).toEqual(Buffer.from([0xac])); // lo que NO se hace
  });

  it('un surrogate suelto es un code point inválido más', () => {
    expect(aIso88591(`a${SURROGATE_ALTO}b${SURROGATE_BAJO}`).toString('latin1')).toBe('a?b?');
  });

  it('ida y vuelta con desdeIso88591 para todo el rango 0x00-0xFF', () => {
    const todos = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect(aIso88591(desdeIso88591(todos))).toEqual(todos);
  });
});

describe('esUtf8Valido / decodificarUtf8OIso', () => {
  it('UTF-8 estricto como mb_check_encoding', () => {
    expect(esUtf8Valido(Buffer.from('Ñandú 😀'))).toBe(true);
    expect(esUtf8Valido(Buffer.alloc(0))).toBe(true);
    expect(esUtf8Valido(Buffer.from([0xef, 0xbf, 0xbe]))).toBe(true); // U+FFFE
    expect(esUtf8Valido(Buffer.from([0xed, 0xa0, 0x80]))).toBe(false); // surrogate
    expect(esUtf8Valido(Buffer.from([0xc0, 0x80]))).toBe(false); // sobrelargo
    expect(esUtf8Valido(Buffer.from([0xd1]))).toBe(false);
  });

  it('si no es UTF-8 válido lo lee como ISO-8859-1', () => {
    expect(decodificarUtf8OIso(Buffer.from('DÍAZ', 'utf8'))).toBe('DÍAZ');
    expect(decodificarUtf8OIso(Buffer.from('DÍAZ', 'latin1'))).toBe('DÍAZ');
  });

  it('acepta un Uint8Array que es vista parcial de otro buffer', () => {
    const base = Buffer.from('xxDÍAZxx', 'latin1');
    expect(decodificarUtf8OIso(new Uint8Array(base.buffer, base.byteOffset + 2, 4))).toBe('DÍAZ');
  });
});

describe('truncarCodePoints / largoCodePoints', () => {
  it('cuenta code points, no unidades UTF-16', () => {
    expect(largoCodePoints('a😀b')).toBe(3);
    expect(truncarCodePoints('a😀b', 2)).toBe('a😀');
    expect(truncarCodePoints('abc', 0)).toBe('');
    expect(truncarCodePoints('abc', 10)).toBe('abc');
  });

  it('un surrogate suelto cuenta como uno', () => {
    expect(largoCodePoints(`a${SURROGATE_ALTO}b`)).toBe(3);
  });
});

describe('escaparXml', () => {
  it('ENT_XML1 sin ENT_QUOTES no toca las comillas', () => {
    expect(escaparXml(`"'&<>`, 'xml1-iso-8859-1')).toBe(`"'&amp;&lt;&gt;`);
    expect(escaparXml(`"'&<>`, 'xml1-sustituir')).toBe(`"'&amp;&lt;&gt;`);
    expect(escaparXml(`"'&<>`, 'defecto')).toBe('&quot;&#039;&amp;&lt;&gt;');
  });

  it('ENT_SUBSTITUTE reemplaza los surrogates sueltos por U+FFFD', () => {
    const texto = `a${SURROGATE_ALTO}b`;
    expect(escaparXml(texto, 'xml1-sustituir')).toBe('a\u{FFFD}b');
    expect(escaparXml(texto, 'defecto')).toBe('a\u{FFFD}b');
    expect(escaparXml(texto, 'xml1-iso-8859-1')).toBe(texto);
    expect(escaparXml('😀', 'defecto')).toBe('😀');
  });
});
