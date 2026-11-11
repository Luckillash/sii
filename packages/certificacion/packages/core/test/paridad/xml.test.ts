// Golden tests del serializador estilo libxml (DOMDocument::saveXML) y del
// escape (htmlspecialchars). Ver paridad/php/operaciones/xml.php.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { escaparXml, type ModoEscape } from '../../src/comun/codificacion.ts';
import {
  crearDocumento,
  crearElemento,
  fijarAtributo,
  parsearDocumento,
  serializarXml,
} from '../../src/comun/xml.ts';
import { type CasoParidad, casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

interface NodoCaso {
  elemento?: string;
  valor?: string;
  escapar?: ModoEscape;
  atributos?: [string, string][];
  hijos?: NodoCaso[];
  texto?: string;
  comentario?: string;
  cdata?: string;
  pi?: string;
  datos?: string;
}

interface EntradaSerializar {
  version?: string;
  encoding?: string;
  formatOutput?: boolean;
  documento: NodoCaso[];
}

interface EntradaReserializar {
  xml?: string;
  xml_base64?: string;
  bytes?: 'utf-8' | 'iso-8859-1';
  agregar?: string;
}

interface EntradaEscapar {
  modo: ModoEscape;
  textos: string[];
}

/** Arma el nodo como lo hace la operación PHP (createElement, setAttribute, appendChild...). */
function construir(doc: Document, nodo: NodoCaso): Node {
  if (nodo.elemento !== undefined) {
    const valor = nodo.valor ?? '';
    const elemento = crearElemento(
      doc,
      nodo.elemento,
      nodo.escapar === undefined ? valor : escaparXml(valor, nodo.escapar),
    );
    for (const [nombre, valorAtributo] of nodo.atributos ?? []) {
      fijarAtributo(elemento, nombre, valorAtributo);
    }
    for (const hijo of nodo.hijos ?? []) elemento.appendChild(construir(doc, hijo));
    return elemento;
  }
  if (nodo.texto !== undefined) return doc.createTextNode(nodo.texto);
  if (nodo.comentario !== undefined) return doc.createComment(nodo.comentario);
  if (nodo.cdata !== undefined) {
    // xmldom rechaza `]]>` en createCDATASection (PHP no); appendData no valida.
    const cdata = doc.createCDATASection('');
    cdata.appendData(nodo.cdata);
    return cdata;
  }
  if (nodo.pi !== undefined) return doc.createProcessingInstruction(nodo.pi, nodo.datos ?? '');
  throw new Error(`Nodo desconocido: ${JSON.stringify(nodo)}`);
}

function bytesXml(entrada: EntradaReserializar): Buffer {
  if (entrada.xml_base64 !== undefined) return Buffer.from(entrada.xml_base64, 'base64');
  if (entrada.xml === undefined) throw new Error('El caso no trae xml ni xml_base64');
  if (entrada.bytes === 'iso-8859-1') {
    if ([...entrada.xml].some((c) => (c.codePointAt(0) ?? 0) > 0xff)) {
      throw new Error('xml tiene caracteres fuera de ISO-8859-1');
    }
    return Buffer.from(entrada.xml, 'latin1');
  }
  return Buffer.from(entrada.xml, 'utf8');
}

function verificarMeta(caso: CasoParidad<unknown>): Buffer {
  const { bytes, meta } = esperado(caso.nombre);
  expect(bytes.length).toBe(meta.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
  return bytes;
}

describe('paridad: serializarXml (DOMDocument construido + saveXML)', () => {
  const lista = casos<EntradaSerializar>('serializarXml');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const { version, encoding, formatOutput, documento } = caso.entrada;
      const doc = crearDocumento(version ?? '1.0', encoding);
      for (const nodo of documento) doc.appendChild(construir(doc, nodo));
      exigirIdentico(serializarXml(doc, { formatear: formatOutput === true }), bytes, caso.nombre);
    });
  });
});

describe('paridad: reserializarXml (loadXML + saveXML, como firmarDte)', () => {
  const lista = casos<EntradaReserializar>('reserializarXml');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const doc = parsearDocumento(bytesXml(caso.entrada));
      if (caso.entrada.agregar !== undefined) {
        const fragmento = parsearDocumento(Buffer.from(caso.entrada.agregar, 'utf8'));
        const raizFragmento = fragmento.documentElement;
        const raiz = doc.documentElement;
        if (raizFragmento === null || raiz === null) throw new Error('documento sin raíz');
        raiz.appendChild(doc.importNode(raizFragmento, true));
      }
      exigirIdentico(serializarXml(doc), bytes, caso.nombre);
    });
  });
});

describe('paridad: escaparXml (htmlspecialchars)', () => {
  const lista = casos<EntradaEscapar>('escaparXml');

  it('hay un caso por modo', () => {
    expect(new Set(lista.map((caso) => caso.entrada.modo))).toEqual(
      new Set(['xml1-iso-8859-1', 'xml1-sustituir', 'defecto']),
    );
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const { modo, textos } = caso.entrada;
      const obtenido = textos.map((texto) => `${escaparXml(texto, modo)}\n`).join('');
      exigirIdentico(Buffer.from(obtenido, 'utf8'), bytes, caso.nombre);
    });
  });
});
