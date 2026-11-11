// Golden tests de FirmaElectronica::firmarDte. Ver paridad/php/operaciones/firmar-dte.php.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { c14n, elementoPorEtiqueta } from '../../src/comun/c14n.ts';
import { aIso88591 } from '../../src/comun/codificacion.ts';
import { parsearDocumento, parsearXml } from '../../src/comun/xml.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import { casos, esperado, exigirIdentico, material } from '../soporte/paridad.ts';

interface EntradaFirmarDte {
  xml?: string;
  xml_base64?: string;
  bytes?: 'utf-8' | 'iso-8859-1';
  referenciaUri: string;
}

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

const lista = casos<EntradaFirmarDte>('firmarDte');

/** Los mismos bytes que recibe el PHP (ver bytesXml de la operación). */
function bytesEntrada(entrada: EntradaFirmarDte): Buffer {
  if (entrada.xml_base64 !== undefined) return Buffer.from(entrada.xml_base64, 'base64');
  if (entrada.xml === undefined) throw new Error('La entrada no trae xml ni xml_base64');
  return entrada.bytes === 'iso-8859-1' ? aIso88591(entrada.xml) : Buffer.from(entrada.xml, 'utf8');
}

function nodoFirmado(uri: string): string {
  if (uri.includes('SetDoc')) return 'SetDTE';
  if (uri.includes('RCOF')) return 'DocumentoConsumoFolios';
  return 'Documento';
}

/** Última `<Signature>` hija de la raíz: la que agrega firmarDte. */
function firmaAgregada(doc: Document): Element {
  const raiz = doc.documentElement;
  if (raiz === null) throw new Error('documento sin raíz');
  for (let n = raiz.lastChild; n !== null; n = n.previousSibling) {
    if (n.nodeType === 1 && n.nodeName === 'Signature') return n as Element;
  }
  throw new Error('No se encontró la <Signature> agregada');
}

/** Primer descendiente `<nombre>` de `padre` (elementoPorEtiqueta busca en todo el documento). */
function hijo(padre: Element, nombre: string): Element {
  const el = padre.getElementsByTagName(nombre)[0];
  if (el === undefined) throw new Error(`No se encontró <${nombre}>`);
  return el;
}

describe('paridad: firmarDte', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThanOrEqual(9);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { llave, certificado } = material(caso.material ?? 'base');
    const { bytes, meta } = esperado(caso.nombre);
    const entrada = bytesEntrada(caso.entrada);

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    it('Node produce los mismos bytes que el PHP', () => {
      const obtenido = new FirmaElectronica(llave, certificado).firmarDte(
        entrada,
        caso.entrada.referenciaUri,
      );
      exigirIdentico(obtenido, bytes, caso.nombre);
    });

    it('verificación cruzada: Node verifica la firma del PHP', () => {
      // El digest se recalcula sobre el documento ORIGINAL (sin la firma agregada).
      const etiqueta = nodoFirmado(caso.entrada.referenciaUri);
      const original = elementoPorEtiqueta(parsearDocumento(entrada), etiqueta);
      if (original === undefined) throw new Error(`No se encontró <${etiqueta}>`);
      const digest = createHash('sha1').update(c14n(original), 'utf8').digest('base64');

      const firma = firmaAgregada(parsearDocumento(bytes));
      expect(firma.getAttribute('xmlns')).toBe(DSIG);
      expect(hijo(firma, 'DigestValue').textContent).toBe(digest);
      expect(hijo(firma, 'Reference').getAttribute('URI')).toBe(caso.entrada.referenciaUri);

      // Se firmó el SignedInfo con xmlns:xsi (aunque el transmitido no lo declara).
      const signedInfo = hijo(firma, 'SignedInfo');
      const reference = hijo(signedInfo, 'Reference');
      const canonico = c14n(
        parsearXml(
          `<SignedInfo xmlns="${DSIG}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
            `<CanonicalizationMethod Algorithm="${hijo(signedInfo, 'CanonicalizationMethod').getAttribute('Algorithm')}"/>\n` +
            `<SignatureMethod Algorithm="${hijo(signedInfo, 'SignatureMethod').getAttribute('Algorithm')}"/>\n` +
            `<Reference URI="${reference.getAttribute('URI')}">\n<Transforms>\n` +
            `<Transform Algorithm="${hijo(reference, 'Transform').getAttribute('Algorithm')}"/>\n` +
            `</Transforms>\n<DigestMethod Algorithm="${hijo(reference, 'DigestMethod').getAttribute('Algorithm')}"/>\n` +
            `<DigestValue>${digest}</DigestValue>\n</Reference>\n</SignedInfo>`,
        ),
      );
      const valor = Buffer.from(hijo(firma, 'SignatureValue').textContent ?? '', 'base64');
      expect(
        verify('sha1', Buffer.from(canonico, 'utf8'), createPublicKey(certificado), valor),
      ).toBe(true);
    });
  });
});
