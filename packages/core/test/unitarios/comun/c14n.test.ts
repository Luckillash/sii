// Comportamientos de C14N fuera de la salida canónica en sí (esa la cubren los
// golden tests de test/paridad/c14n.test.ts). Los resultados esperados de los
// casos de error se observaron con PHP 8.3 / libxml 2.10 (`DOMNode::C14N()`).

import { describe, expect, it } from 'vitest';
import { c14n, c14nPorEtiqueta, elementoPorEtiqueta } from '../../../src/comun/c14n.ts';
import { ErrorFirma } from '../../../src/comun/errores.ts';
import { parsearDocumento } from '../../../src/comun/xml.ts';

const parsear = (xml: string) => parsearDocumento(Buffer.from(xml, 'utf8'));

describe('elementoPorEtiqueta (getElementsByTagName de PHP 8.3)', () => {
  const doc = parsear(
    '<Documento n="0"><a><Documento n="1"/></a><p:Documento xmlns:p="urn:p" n="2"/></Documento>',
  );

  it('recorre en orden de documento e incluye la raíz', () => {
    expect(elementoPorEtiqueta(doc, 'Documento')?.getAttribute('n')).toBe('0');
    expect(elementoPorEtiqueta(doc, 'Documento', 1)?.getAttribute('n')).toBe('1');
  });

  it('compara el nombre local: p:Documento calza con "Documento"', () => {
    expect(elementoPorEtiqueta(doc, 'Documento', 2)?.getAttribute('n')).toBe('2');
    expect(elementoPorEtiqueta(doc, 'p:Documento')).toBeUndefined();
  });

  it('acepta un elemento y busca en todo su documento', () => {
    const a = elementoPorEtiqueta(doc, 'a');
    if (a === undefined) throw new Error('falta <a>');
    expect(elementoPorEtiqueta(a, 'Documento')?.getAttribute('n')).toBe('0');
  });

  it('devuelve undefined si no hay tantos', () => {
    expect(elementoPorEtiqueta(doc, 'Documento', 3)).toBeUndefined();
    expect(elementoPorEtiqueta(doc, 'SetDTE')).toBeUndefined();
  });

  it('c14nPorEtiqueta lanza ErrorFirma si no encuentra el nodo', () => {
    expect(() => c14nPorEtiqueta(doc, 'SetDTE')).toThrow(ErrorFirma);
    expect(() => c14nPorEtiqueta(doc, 'SetDTE')).toThrow(
      'No se encontró el nodo SetDTE para aplicar la firma.',
    );
  });
});

describe('c14n: namespaces con URI relativa o inválida (libxml falla)', () => {
  it('falla aunque la declaración esté fuera del subárbol', () => {
    const doc = parsear('<r><a/><b xmlns:x="relativa"/></r>');
    expect(() => c14nPorEtiqueta(doc, 'a')).toThrow(ErrorFirma);
  });

  it('falla si la declaración está en un ancestro', () => {
    const doc = parsear('<r xmlns:x="relativa"><a/></r>');
    expect(() => c14nPorEtiqueta(doc, 'a')).toThrow(ErrorFirma);
  });

  it('xmlns="" no es una URI relativa', () => {
    const doc = parsear('<r xmlns="urn:a"><a xmlns=""/></r>');
    expect(c14nPorEtiqueta(doc, 'a')).toBe('<a></a>');
  });

  // Observado con PHP 8.3 / libxml 2.10.
  const validas = [
    'urn:a%20b',
    'a+b.c-d:x',
    'http://[::1]/',
    'x:',
    'urn:',
    'urn:/',
    'urn:?',
    'x:#f',
    'urn:a:',
    'http://',
    'http:///a',
    'x://a@b:12/c?d#e',
    'x:a/b/../c',
    'http://a%41/',
    'http://a_b~c/',
    'http://[v1.x]/',
    'x:a@b',
    'x::',
    'http://www.sii.cl/SiiDte',
    'http://www.w3.org/2000/09/xmldsig#',
  ];
  const invalidas = [
    'relativa',
    'rel/x',
    '#frag',
    'http://a b',
    'http://a/b c',
    'urn:ñ',
    'urn:a|b',
    'urn:a{b}',
    'urn:a"b',
    'urn:a^b',
    'urn:a`b',
    'urn:a\\b',
    'urn:%zz',
    'urn:\u007f',
    '1a:x',
    'urn:a#b#c',
    'http://a:b:c/',
    'urn:[x]',
  ];
  const escapar = (uri: string) => uri.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

  it.each(validas)('acepta %j', (uri) => {
    const doc = parsear(`<r xmlns:p="${escapar(uri)}"/>`);
    expect(c14nPorEtiqueta(doc, 'r')).toBe(`<r xmlns:p="${escapar(uri)}"></r>`);
  });

  it.each(invalidas)('rechaza %j', (uri) => {
    const doc = parsear(`<r xmlns:p="${escapar(uri)}"/>`);
    expect(() => c14nPorEtiqueta(doc, 'r')).toThrow(ErrorFirma);
  });
});

describe('c14n: casos borde', () => {
  it('no emite una declaración explícita de xmlns:xml', () => {
    const doc = parsear(
      '<r><a xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:lang="x"/></r>',
    );
    expect(c14nPorEtiqueta(doc, 'a')).toBe('<a xml:lang="x"></a>');
  });

  it('un elemento creado con la API del DOM usa sus atributos xmlns como declaraciones', () => {
    const doc = parsear('<DTE xmlns="http://www.sii.cl/SiiDte"/>');
    const raiz = doc.documentElement;
    if (raiz === null) throw new Error('sin raíz');
    const documento = doc.createElement('Documento');
    documento.setAttribute('ID', 'F1T39');
    raiz.appendChild(documento);
    expect(c14n(documento)).toBe(
      '<Documento xmlns="http://www.sii.cl/SiiDte" ID="F1T39"></Documento>',
    );
  });

  it('canonicalizar dos veces da lo mismo (no modifica el DOM)', () => {
    const doc = parsear('<r xmlns:a="urn:a" xml:lang="es"><m b="1" a:c="2"><h/></m></r>');
    const primera = c14nPorEtiqueta(doc, 'm');
    expect(c14nPorEtiqueta(doc, 'm')).toBe(primera);
    expect(primera).toBe('<m xmlns:a="urn:a" b="1" xml:lang="es" a:c="2"><h></h></m>');
  });
});
