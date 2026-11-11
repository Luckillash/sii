// Comportamientos del constructor, el parser y el serializador fuera de la
// salida byte a byte (esa la cubren los golden tests de test/paridad/xml.test.ts).

import { describe, expect, it } from 'vitest';
import { SiiError } from '../../../src/comun/errores.ts';
import {
  crearDocumento,
  crearElemento,
  declaracionXml,
  fijarAtributo,
  parsearDocumento,
  parsearXml,
  serializarXml,
} from '../../../src/comun/xml.ts';

const texto = (b: Buffer) => b.toString('latin1');

describe('crearElemento (createElement con valor)', () => {
  const doc = crearDocumento('1.0', 'ISO-8859-1');

  it('interpreta las referencias como libxml', () => {
    const tipos = (valor: string) =>
      Array.from(crearElemento(doc, 'X', valor).childNodes, (n) => [
        n.nodeType,
        n.nodeValue ?? n.nodeName,
      ]);
    expect(tipos('a&amp;b&#233;')).toEqual([[3, 'a&bé']]);
    expect(tipos('a&foo;b')).toEqual([
      [3, 'a'],
      [5, 'foo'],
      [3, 'b'],
    ]);
    expect(tipos('a & b')).toEqual([]);
    expect(tipos('')).toEqual([]);
  });

  it('rechaza nombres que no son Name de XML, como PHP', () => {
    expect(() => crearElemento(doc, '1abc')).toThrow(SiiError);
    expect(() => crearElemento(doc, 'a b')).toThrow(SiiError);
    expect(() => crearElemento(doc, 'Raíz')).not.toThrow();
  });
});

describe('fijarAtributo (setAttribute)', () => {
  it('un segundo xmlns se ignora, como en PHP', () => {
    const doc = crearDocumento('1.0', 'ISO-8859-1');
    const raiz = crearElemento(doc, 'R');
    doc.appendChild(raiz);
    expect(fijarAtributo(raiz, 'xmlns', 'urn:a')).toBe(true);
    expect(fijarAtributo(raiz, 'xmlns', 'urn:b')).toBe(false);
    expect(fijarAtributo(raiz, 'a', '1')).toBe(true);
    expect(texto(serializarXml(doc))).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<R xmlns="urn:a" a="1"/>\n',
    );
  });
});

describe('crearDocumento / declaracionXml', () => {
  it('rechaza encodings que el serializador no sabe escribir', () => {
    expect(() => crearDocumento('1.0', 'windows-1252')).toThrow(SiiError);
  });

  it('sin encoding declara solo la versión', () => {
    const doc = crearDocumento();
    doc.appendChild(crearElemento(doc, 'R', 'é'));
    expect(declaracionXml(doc)).toEqual({ version: '1.0' });
    expect(texto(serializarXml(doc))).toBe('<?xml version="1.0"?>\n<R>&#xE9;</R>\n');
  });
});

describe('parsearDocumento', () => {
  it('lee la declaración y decodifica los bytes según ella', () => {
    const iso = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><R>DÍAZ</R>', 'latin1');
    const doc = parsearDocumento(iso);
    expect(declaracionXml(doc)).toEqual({ version: '1.0', encoding: 'ISO-8859-1' });
    expect(doc.documentElement?.textContent).toBe('DÍAZ');
    expect(serializarXml(doc)).toEqual(
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>\n<R>DÍAZ</R>\n', 'latin1'),
    );
  });

  it('un string ya es Unicode: la declaración solo decide la salida', () => {
    const doc = parsearDocumento('<?xml version="1.0" encoding="ISO-8859-1"?><R>€</R>');
    expect(texto(serializarXml(doc))).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<R>&#8364;</R>\n',
    );
  });

  it('conserva U+0085 y U+2028 (XML 1.0), a diferencia del default de xmldom', () => {
    const nel = String.fromCharCode(0x85);
    const ls = String.fromCharCode(0x2028);
    const doc = parsearDocumento(`<R a="${nel}${ls}">${nel}${ls}\r\n\r</R>`);
    expect(doc.documentElement?.getAttribute('a')).toBe(`${nel}${ls}`);
    expect(doc.documentElement?.textContent).toBe(`${nel}${ls}\n\n`);
    expect(parsearXml(`<R>${nel}</R>`).textContent).toBe(nel);
  });

  it('el & de un xmlns queda como &#38;, igual que en libxml', () => {
    const doc = parsearDocumento('<R xmlns:p="urn:a&amp;b" a="x&amp;y"/>');
    expect(doc.documentElement?.getAttribute('xmlns:p')).toBe('urn:a&#38;b');
    expect(doc.documentElement?.getAttribute('a')).toBe('x&y');
  });

  it('lanza SiiError con XML inválido, DOCTYPE, encodings no soportados o bytes no UTF-8', () => {
    expect(() => parsearDocumento('<R>')).toThrow(SiiError);
    expect(() => parsearDocumento('<R>&foo;</R>')).toThrow(SiiError);
    expect(() => parsearDocumento('<!DOCTYPE R><R/>')).toThrow(SiiError);
    expect(() => parsearDocumento('<?xml version="1.0" encoding="UTF-16"?><R/>')).toThrow(SiiError);
    expect(() => parsearDocumento('<?xml encoding="UTF-8"?><R/>')).toThrow(SiiError);
    expect(() => parsearDocumento(' <?xml version="1.0"?><R/>')).toThrow(SiiError);
    expect(() => parsearDocumento(Buffer.from('<R>DÍAZ</R>', 'latin1'))).toThrow(SiiError);
    expect(() => parsearDocumento('')).toThrow(SiiError);
  });
});

describe('serializarXml', () => {
  it('sin encoding declarado, un control C0 en un texto lanza (libxml lo descartaría)', () => {
    const doc = crearDocumento();
    doc.appendChild(crearElemento(doc, 'R', '\u0001'));
    expect(() => serializarXml(doc)).toThrow(SiiError);
  });

  it('con ISO-8859-1 el control C0 sale tal cual, como en PHP', () => {
    const doc = crearDocumento('1.0', 'ISO-8859-1');
    doc.appendChild(crearElemento(doc, 'R', '\u0001'));
    expect(texto(serializarXml(doc))).toContain('<R>\u0001</R>');
  });

  it('un &#xD800; leído por createElement sale como &#55296; en ISO-8859-1, como en PHP', () => {
    const doc = crearDocumento('1.0', 'ISO-8859-1');
    doc.appendChild(crearElemento(doc, 'R', '&#xD800;'));
    expect(texto(serializarXml(doc))).toContain('<R>&#55296;</R>');
  });
});
