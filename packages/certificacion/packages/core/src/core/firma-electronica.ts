// Deriva de winex/certificacion v1.9.1 (src/Core/FirmaElectronica.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Firma XML-DSig (RSA-SHA1, C14N 1.0 inclusivo) tal como la arma el core PHP:
// las dos salidas son byte a byte iguales a las del PHP (golden tests
// paridad/casos/firmar-semilla-* y firmar-dte-*).

import { createHash, createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { c14n, elementoPorEtiqueta } from '../comun/c14n.ts';
import { ErrorFirma } from '../comun/errores.ts';
import { parsearDocumento, parsearXml, serializarXml } from '../comun/xml.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N_ALG = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

/** Bytes `\r` y `\n`, que el PHP quita del final con `rtrim($xml, "\r\n")`. */
const CR = 0x0d;
const LF = 0x0a;

export class FirmaElectronica {
  readonly #llave: KeyObject;
  /** Certificado limpio: sin BEGIN/END ni saltos de línea, como lo exige el SII. */
  readonly #certificado: string;

  /**
   * @param llavePrivadaPem llave privada RSA en PEM (PKCS#1 o PKCS#8, sin cifrar)
   * @param certificadoPem certificado X.509 en PEM
   */
  constructor(llavePrivadaPem: string, certificadoPem: string) {
    try {
      this.#llave = createPrivateKey(llavePrivadaPem);
    } catch (error) {
      // Sin el PEM en el mensaje: termina en logs.
      throw new ErrorFirma('La llave privada no es un PEM legible.', { cause: error });
    }
    // Igual que el PHP: solo quita los encabezados y los saltos de línea.
    this.#certificado = certificadoPem
      .replaceAll('-----BEGIN CERTIFICATE-----', '')
      .replaceAll('-----END CERTIFICATE-----', '')
      .replaceAll('\r', '')
      .replaceAll('\n', '');
  }

  /**
   * Firma `<getToken><item><Semilla>…</Semilla></item></getToken>` para el canje
   * de semilla por token (SOAP DTEWS y API REST de boleta).
   *
   * La `<Signature>` queda DENTRO del nodo firmado y la Reference apunta a
   * `URI=""`, por lo que el SII exige el transform enveloped-signature (con el
   * transform C14N responde ESTADO 11 "elemento 'Certificate' no existe").
   */
  firmarSemilla(semilla: string): string {
    const doc = `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
    const digestValue = sha1Base64(c14n(parsearXml(doc)));

    const signedInfo =
      `<SignedInfo xmlns="${DSIG}">` +
      `<CanonicalizationMethod Algorithm="${C14N_ALG}"/>` +
      `<SignatureMethod Algorithm="${DSIG}rsa-sha1"/>` +
      '<Reference URI="">' +
      `<Transforms><Transform Algorithm="${DSIG}enveloped-signature"/></Transforms>` +
      `<DigestMethod Algorithm="${DSIG}sha1"/>` +
      `<DigestValue>${digestValue}</DigestValue>` +
      '</Reference></SignedInfo>';

    const signatureValue = this.#firmarRsaSha1(c14n(parsearXml(signedInfo)));
    const { modulus, exponent } = this.#rsaKeyValue();

    return (
      '<?xml version="1.0"?>' +
      `<getToken><item><Semilla>${semilla}</Semilla></item>` +
      `<Signature xmlns="${DSIG}">` +
      signedInfo +
      `<SignatureValue>${signatureValue}</SignatureValue>` +
      '<KeyInfo><KeyValue><RSAKeyValue>' +
      `<Modulus>${modulus}</Modulus><Exponent>${exponent}</Exponent>` +
      '</RSAKeyValue></KeyValue>' +
      `<X509Data><X509Certificate>${this.#certificado}</X509Certificate></X509Data>` +
      '</KeyInfo></Signature></getToken>'
    );
  }

  /**
   * Firma un DTE, el sobre `EnvioBOLETA` o el RCOF, como `firmarDte()` del PHP.
   *
   * Según `referenciaUri` se elige el nodo firmado (el primero con ese nombre
   * local en el documento):
   *
   * - contiene `SetDoc` → `<SetDTE>` (sobre EnvioBOLETA);
   * - contiene `RCOF` → `<DocumentoConsumoFolios>` (consumo de folios);
   * - cualquier otra (`#F{folio}T39`, `#F{folio}T41`...) → `<Documento>`.
   *
   * El DigestValue es el SHA1 del C14N inclusivo de ese nodo (con los
   * namespaces heredados de sus ancestros). La `<Signature>`, con sus saltos de
   * línea, se agrega al final del **elemento raíz** (no del nodo firmado) y el
   * documento se reserializa como `DOMDocument::saveXML()`, sin formatear y en
   * su codificación declarada, sin el salto de línea final (el SII exige que
   * el archivo termine justo en la etiqueta de cierre).
   *
   * @param xml el documento. Como `Buffer`, son sus bytes exactos y se decodifican
   *   según la declaración (ISO-8859-1 o UTF-8, como libxml). Como `string`, ya es
   *   texto Unicode y la declaración solo define la codificación de la salida.
   * @param referenciaUri URI de la `<Reference>`, p. ej. `#F12T39`, `#SetDoc`, `#RCOF`.
   *   Va tal cual dentro del atributo, como en el PHP.
   * @returns los bytes listos para enviar al SII (ISO-8859-1 si el documento lo declara).
   * @throws ErrorFirma si el XML no es válido, falta el nodo a firmar o la firma falla.
   */
  firmarDte(xml: Buffer | Uint8Array | string, referenciaUri = '#F1T33'): Buffer {
    const etiqueta = nodoAFirmar(referenciaUri);

    let doc: Document;
    try {
      doc = parsearDocumento(xml);
    } catch (error) {
      // PHP: loadXML falla y luego no encuentra el nodo.
      throw new ErrorFirma(`No se encontró el nodo ${etiqueta} para aplicar la firma.`, {
        cause: error,
      });
    }

    const nodo = elementoPorEtiqueta(doc, etiqueta);
    const raiz = doc.documentElement;
    if (nodo === undefined || raiz === null) {
      throw new ErrorFirma(`No se encontró el nodo ${etiqueta} para aplicar la firma.`);
    }
    // El PHP marca el atributo ID como tipo ID (setIdAttribute); eso no cambia
    // el C14N, así que aquí no hace falta.
    const digestValue = sha1Base64(c14n(nodo));

    const signedInfoParaFirma = `<SignedInfo xmlns="${DSIG}" xmlns:xsi="${XSI}">
<CanonicalizationMethod Algorithm="${C14N_ALG}"/>
<SignatureMethod Algorithm="${DSIG}rsa-sha1"/>
<Reference URI="${referenciaUri}">
<Transforms>
<Transform Algorithm="${C14N_ALG}"/>
</Transforms>
<DigestMethod Algorithm="${DSIG}sha1"/>
<DigestValue>${digestValue}</DigestValue>
</Reference>
</SignedInfo>`;
    const signatureValue = this.#firmarRsaSha1(c14n(parsearFirma(signedInfoParaFirma)));
    const { modulus, exponent } = this.#rsaKeyValue();

    // Ojo: el SignedInfo que se transmite NO declara xmlns:xsi (el firmado sí).
    // El SII lo acepta así; cambiarlo cambia bytes enviados (PLAN §1, principio 3).
    const signatureCompleta = `<Signature xmlns="${DSIG}">
<SignedInfo>
<CanonicalizationMethod Algorithm="${C14N_ALG}"/>
<SignatureMethod Algorithm="${DSIG}rsa-sha1"/>
<Reference URI="${referenciaUri}">
<Transforms>
<Transform Algorithm="${C14N_ALG}"/>
</Transforms>
<DigestMethod Algorithm="${DSIG}sha1"/>
<DigestValue>${digestValue}</DigestValue>
</Reference>
</SignedInfo>
<SignatureValue>${signatureValue}</SignatureValue>
<KeyInfo>
<KeyValue>
<RSAKeyValue>
<Modulus>${modulus}</Modulus>
<Exponent>${exponent}</Exponent>
</RSAKeyValue>
</KeyValue>
<X509Data>
<X509Certificate>${this.#certificado}</X509Certificate>
</X509Data>
</KeyInfo>
</Signature>`;

    raiz.appendChild(doc.importNode(parsearFirma(signatureCompleta), true));

    const salida = serializarXml(doc);
    let fin = salida.length;
    while (fin > 0 && (salida[fin - 1] === LF || salida[fin - 1] === CR)) fin--;
    return salida.subarray(0, fin);
  }

  /** SignatureValue: RSA PKCS#1 v1.5 con SHA1 sobre el UTF-8 del texto, en base64. */
  #firmarRsaSha1(texto: string): string {
    try {
      return sign('sha1', Buffer.from(texto, 'utf8'), this.#llave).toString('base64');
    } catch (error) {
      // PHP ignoraba el resultado de openssl_sign (pend. 1.7); aquí se reporta.
      throw new ErrorFirma(
        'No se pudo firmar con RSA-SHA1. Si el OpenSSL del sistema bloquea SHA1, use el binario oficial de Node.',
        { cause: error },
      );
    }
  }

  /** Módulo y exponente en base64 (big-endian sin cero inicial, como openssl_pkey_get_details). */
  #rsaKeyValue(): { modulus: string; exponent: string } {
    const jwk = this.#llave.export({ format: 'jwk' });
    if (jwk.kty !== 'RSA' || jwk.n === undefined || jwk.e === undefined) {
      throw new ErrorFirma('La llave privada no es RSA');
    }
    return {
      modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
      exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
    };
  }
}

/**
 * Nodo que firma `firmarDte` según la URI, con la misma prioridad que el PHP.
 *
 * Las ramas `Libro` (→ `EnvioLibro`) y URI vacía (→ `getToken`) del PHP no se
 * portan: ningún script ni clase del core las usa (PLAN §8, pend. 3; el token
 * se firma con `firmarSemilla`). Se rechazan para no firmar en silencio otra cosa.
 */
function nodoAFirmar(referenciaUri: string): string {
  if (referenciaUri.includes('SetDoc')) return 'SetDTE';
  if (referenciaUri.includes('Libro')) {
    throw new ErrorFirma('firmarDte no firma libros (EnvioLibro): no está portado.');
  }
  if (referenciaUri.includes('RCOF')) return 'DocumentoConsumoFolios';
  if (referenciaUri === '') {
    throw new ErrorFirma(
      'firmarDte requiere una URI de referencia; para el token use firmarSemilla.',
    );
  }
  return 'Documento';
}

/** Parsea un fragmento armado aquí (SignedInfo / Signature): solo falla si la URI rompe el XML. */
function parsearFirma(xml: string): Element {
  try {
    return parsearXml(xml);
  } catch (error) {
    throw new ErrorFirma('La URI de referencia no es válida dentro de un atributo XML.', {
      cause: error,
    });
  }
}

function sha1Base64(texto: string): string {
  return createHash('sha1').update(texto, 'utf8').digest('base64');
}
