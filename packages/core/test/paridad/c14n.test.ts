import { createHash } from 'node:crypto';
import { DOMImplementation } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { c14n, c14nPorEtiqueta } from '../../src/comun/c14n.ts';
import { parsearDocumento } from '../../src/comun/xml.ts';
import { bytesEntradaXml, casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

interface EntradaC14n {
  xml?: string;
  xmlBase64?: string;
  etiqueta?: string;
  indice?: number;
}

const lista = casos<EntradaC14n>('c14n');

/**
 * @xmldom/xmldom 0.8 no acepta nombres XML fuera del BMP (U+10000 en adelante),
 * así que estos casos se arman con la API del DOM, con los mismos nodos que el
 * XML de entrada. Lo que se valida es el orden de C14N, no el parser.
 */
const CONSTRUIDOS: Record<string, () => Document> = {
  'c14n-orden-astral': () => {
    const doc = new DOMImplementation().createDocument(null, 'r', null);
    const r = doc.documentElement;
    if (r === null) throw new Error('documento sin raíz');
    const ff = 'ﬀ'; // ligadura "ff": UTF-8 EF AC 80, UTF-16 FB00
    const a = '\u{1d49c}'; // 𝒜: UTF-8 F0 9D 92 9C, UTF-16 D835 DC9C
    r.setAttribute(`xmlns:${ff}`, 'urn:p1');
    r.setAttribute(`xmlns:${a}`, 'urn:p2');
    r.setAttribute('xmlns:é', 'urn:p3');
    const e = doc.createElement('e');
    e.setAttribute(a, '1');
    e.setAttribute(ff, '2');
    e.setAttribute('é', '3');
    e.setAttribute('e', '4');
    e.setAttribute(`${a}:x`, '5');
    e.setAttribute(`${ff}:x`, '6');
    r.appendChild(e);
    return doc;
  },
};

const sha1Base64 = (bytes: Buffer) => createHash('sha1').update(bytes).digest('base64');

describe('paridad: C14N (DOMNode::C14N de libxml)', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    it('Node produce los mismos bytes y el mismo DigestValue que el PHP', () => {
      const { etiqueta, indice } = caso.entrada;
      const doc = CONSTRUIDOS[caso.nombre]?.() ?? parsearDocumento(bytesEntradaXml(caso.entrada));
      const raiz = doc.documentElement;
      if (raiz === null) throw new Error('documento sin raíz');

      const canonico =
        etiqueta === undefined ? c14n(raiz) : c14nPorEtiqueta(doc, etiqueta, indice ?? 0);
      const obtenido = Buffer.from(canonico, 'utf8');

      exigirIdentico(obtenido, bytes, caso.nombre);
      expect(sha1Base64(obtenido)).toBe(sha1Base64(bytes));
    });
  });
});
