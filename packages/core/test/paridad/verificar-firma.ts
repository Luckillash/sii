// Verificación cruzada de las firmas que agrega firmarDte (DTE, sobre EnvioBOLETA y
// RCOF): Node verifica, con su propio C14N, la firma que produjo el PHP.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { c14n, elementoPorEtiqueta } from '../../src/comun/c14n.ts';
import { parsearDocumento, parsearXml } from '../../src/comun/xml.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N_ALG = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/** Última `<Signature>` hija de la raíz: la que agrega firmarDte. */
function firmaAgregada(doc: Document): Element {
  const raiz = doc.documentElement;
  if (raiz === null) throw new Error('documento sin raíz');
  return ultimaFirmaHija(raiz);
}

/** Última `<Signature>` hija de `elemento` (p. ej. la de cada `<DTE>` dentro del sobre). */
export function ultimaFirmaHija(elemento: Element): Element {
  for (let n = elemento.lastChild; n !== null; n = n.previousSibling) {
    if (n.nodeType === 1 && n.nodeName === 'Signature') return n as Element;
  }
  throw new Error('No se encontró la <Signature> agregada');
}

function texto(padre: Element, nombre: string): string {
  const el = padre.getElementsByTagName(nombre)[0];
  if (el === undefined) throw new Error(`No se encontró <${nombre}>`);
  return el.textContent ?? '';
}

export interface ResultadoVerificacion {
  /** DigestValue que trae la firma. */
  digestFirma: string;
  /** SHA1 del C14N del nodo firmado, calculado por Node. */
  digestCalculado: string;
  uri: string;
  /** La SignatureValue verifica con el certificado sobre el SignedInfo canónico. */
  firmaValida: boolean;
}

/**
 * Recalcula el digest del nodo `<etiqueta>` (el primero del documento; la firma
 * agregada es hermana de él, no lo altera) y verifica la SignatureValue sobre el
 * SignedInfo canónico tal como lo firma el PHP (con `xmlns:xsi`).
 */
export function verificarFirmaAgregada(
  bytes: Buffer,
  etiqueta: string,
  certificadoPem: string,
): ResultadoVerificacion {
  const doc = parsearDocumento(bytes);
  const nodo = elementoPorEtiqueta(doc, etiqueta);
  if (nodo === undefined) throw new Error(`No se encontró <${etiqueta}>`);
  return verificarFirma(nodo, firmaAgregada(doc), certificadoPem);
}

/**
 * Verifica una `<Signature>` cualquiera sobre el nodo que firma: recalcula el
 * digest del C14N de `nodo` (con los namespaces heredados de sus ancestros) y
 * verifica la SignatureValue sobre el SignedInfo canónico tal como lo firma el
 * PHP (con `xmlns:xsi`). Sirve para la firma de cada DTE dentro del sobre.
 */
export function verificarFirma(
  nodo: Element,
  firma: Element,
  certificadoPem: string,
): ResultadoVerificacion {
  const digestCalculado = createHash('sha1').update(c14n(nodo), 'utf8').digest('base64');

  const reference = firma.getElementsByTagName('Reference')[0];
  const uri = reference?.getAttribute('URI') ?? '';
  const digestFirma = texto(firma, 'DigestValue');

  const signedInfo = c14n(
    parsearXml(
      `<SignedInfo xmlns="${DSIG}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
        `<CanonicalizationMethod Algorithm="${C14N_ALG}"/>\n` +
        `<SignatureMethod Algorithm="${DSIG}rsa-sha1"/>\n` +
        `<Reference URI="${uri}">\n<Transforms>\n<Transform Algorithm="${C14N_ALG}"/>\n` +
        `</Transforms>\n<DigestMethod Algorithm="${DSIG}sha1"/>\n` +
        `<DigestValue>${digestFirma}</DigestValue>\n</Reference>\n</SignedInfo>`,
    ),
  );
  const valor = Buffer.from(texto(firma, 'SignatureValue'), 'base64');
  const firmaValida = verify(
    'sha1',
    Buffer.from(signedInfo, 'utf8'),
    createPublicKey(certificadoPem),
    valor,
  );

  return { digestFirma, digestCalculado, uri, firmaValida };
}
