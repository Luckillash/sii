// Port de tests/Core/FirmaElectronicaTest.php (winex/certificacion v1.9.1) más
// los casos propios del port (errores tipados, entrada Buffer/string, SHA1).

import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { c14n } from '../../../src/comun/c14n.ts';
import { aIso88591 } from '../../../src/comun/codificacion.ts';
import { ErrorFirma } from '../../../src/comun/errores.ts';
import { parsearDocumento, parsearXml } from '../../../src/comun/xml.ts';
import { FirmaElectronica } from '../../../src/core/firma-electronica.ts';
import { material } from '../../soporte/paridad.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const SII = 'http://www.sii.cl/SiiDte';

const { llave, certificado } = material('base');
const firmador = () => new FirmaElectronica(llave, certificado);

/** DTE como los que arma GeneradorBoleta (formateado, ISO-8859-1). */
const BOLETA = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE xmlns="${SII}" version="1.0" xmlns:xsi="${XSI}">
  <Documento ID="F56T39">
    <Encabezado>
      <IdDoc>
        <TipoDTE>39</TipoDTE>
        <Folio>56</Folio>
      </IdDoc>
      <Emisor>
        <RUTEmisor>76123456-0</RUTEmisor>
        <RznSocEmisor>EMPRESA ÑANDÚ &amp; CÍA SPA</RznSocEmisor>
      </Emisor>
      <Totales>
        <MntTotal>1190</MntTotal>
      </Totales>
    </Encabezado>
  </Documento>
</DTE>
`;

function elementos(raiz: Document | Element, nombre: string, ns = DSIG): Element[] {
  return Array.from(raiz.getElementsByTagNameNS(ns, nombre));
}

function unico(raiz: Document | Element, nombre: string, ns = DSIG): Element {
  const lista = elementos(raiz, nombre, ns);
  expect(lista).toHaveLength(1);
  return lista[0] as Element;
}

function sha1(texto: string): string {
  return createHash('sha1').update(texto, 'utf8').digest('base64');
}

/**
 * Verifica la SignatureValue. El SignedInfo de firmarDte se firma declarando
 * xmlns:xsi (aunque el transmitido no lo lleva), así que se le agrega antes de
 * canonicalizar, igual que hace el SII al validar contra la raíz del documento.
 */
function firmaValida(doc: Document, conXsi: boolean): boolean {
  const signedInfo = unico(doc, 'SignedInfo');
  if (conXsi) signedInfo.setAttribute('xmlns:xsi', XSI);
  const canonico = c14n(signedInfo);
  const valor = Buffer.from(unico(doc, 'SignatureValue').textContent ?? '', 'base64');
  return verify('sha1', Buffer.from(canonico, 'utf8'), createPublicKey(certificado), valor);
}

describe('FirmaElectronica.firmarDte', () => {
  it('genera una firma verificable', () => {
    const doc = parsearDocumento(firmador().firmarDte(aIso88591(BOLETA), '#F56T39'));
    expect(elementos(doc, 'Signature')).toHaveLength(1);
    expect(firmaValida(doc, true)).toBe(true);
  });

  it('el digest corresponde al documento firmado', () => {
    const doc = parsearDocumento(firmador().firmarDte(aIso88591(BOLETA), '#F56T39'));
    const documento = unico(doc, 'Documento', SII);
    expect(unico(doc, 'DigestValue').textContent).toBe(sha1(c14n(documento)));
    expect(unico(doc, 'Reference').getAttribute('URI')).toBe('#F56T39');
  });

  it('alterar el documento después de firmar cambia el digest', () => {
    const firmado = firmador().firmarDte(aIso88591(BOLETA), '#F56T39').toString('latin1');
    const alterado = firmado.replace('<MntTotal>1190</MntTotal>', '<MntTotal>1</MntTotal>');
    expect(alterado).not.toBe(firmado);

    const doc = parsearDocumento(Buffer.from(alterado, 'latin1'));
    expect(sha1(c14n(unico(doc, 'Documento', SII)))).not.toBe(
      unico(doc, 'DigestValue').textContent,
    );
  });

  it('incluye el certificado limpio y la clave pública', () => {
    const doc = parsearDocumento(firmador().firmarDte(aIso88591(BOLETA), '#F56T39'));

    const cert = unico(doc, 'X509Certificate').textContent ?? '';
    expect(cert).not.toContain('BEGIN CERTIFICATE');
    expect(cert).not.toContain('\n');
    const pem = `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;
    expect(() => createPublicKey(pem)).not.toThrow();

    const jwk = createPublicKey(certificado).export({ format: 'jwk' });
    expect(unico(doc, 'Modulus').textContent).toBe(
      Buffer.from(jwk.n ?? '', 'base64url').toString('base64'),
    );
    expect(unico(doc, 'Exponent').textContent).toBe(
      Buffer.from(jwk.e ?? '', 'base64url').toString('base64'),
    );
  });

  it('firmar el sobre del set apunta al SetDTE', () => {
    const sobre = `<?xml version="1.0"?><EnvioBOLETA xmlns="${SII}" xmlns:xsi="${XSI}"><SetDTE ID="SetDoc"><x>1</x></SetDTE></EnvioBOLETA>`;
    const doc = parsearDocumento(firmador().firmarDte(sobre, '#SetDoc'));
    expect(unico(doc, 'DigestValue').textContent).toBe(sha1(c14n(unico(doc, 'SetDTE', SII))));
    expect(firmaValida(doc, true)).toBe(true);
  });

  it('firmar el RCOF apunta al documento de consumo', () => {
    const rcof = `<?xml version="1.0"?><ConsumoFolios xmlns="${SII}" xmlns:xsi="${XSI}"><DocumentoConsumoFolios ID="RCOF"><x>1</x></DocumentoConsumoFolios></ConsumoFolios>`;
    const doc = parsearDocumento(firmador().firmarDte(rcof, '#RCOF'));
    expect(unico(doc, 'DigestValue').textContent).toBe(
      sha1(c14n(unico(doc, 'DocumentoConsumoFolios', SII))),
    );
    expect(firmaValida(doc, true)).toBe(true);
  });

  it('sin el nodo esperado lanza ErrorFirma', () => {
    expect(() => firmador().firmarDte('<otra><cosa/></otra>', '#SetDoc')).toThrow(ErrorFirma);
    expect(() => firmador().firmarDte('<otra><cosa/></otra>', '#SetDoc')).toThrow(
      'No se encontró el nodo SetDTE',
    );
  });

  it('un XML mal formado lanza ErrorFirma', () => {
    expect(() => firmador().firmarDte('<DTE><Documento></DTE>', '#F1T39')).toThrow(ErrorFirma);
    expect(() => firmador().firmarDte(Buffer.from([0x3c, 0x61, 0xff, 0x3e]), '#F1T39')).toThrow(
      ErrorFirma,
    );
  });

  it('rechaza las ramas no portadas (Libro y URI vacía)', () => {
    expect(() => firmador().firmarDte('<EnvioLibro/>', '#Libro1')).toThrow(ErrorFirma);
    expect(() => firmador().firmarDte('<getToken/>', '')).toThrow(/firmarSemilla/);
  });

  it('una URI que rompe el XML lanza ErrorFirma', () => {
    expect(() => firmador().firmarDte(BOLETA, '#F1"T39')).toThrow(ErrorFirma);
  });

  it('agrega la Signature al final de la raíz y no al nodo firmado', () => {
    const doc = parsearDocumento(firmador().firmarDte(BOLETA, '#F56T39'));
    const raiz = doc.documentElement as Element;
    const ultimo = raiz.lastChild as Element;
    expect(ultimo.nodeName).toBe('Signature');
    expect(elementos(unico(doc, 'Documento', SII), 'Signature')).toHaveLength(0);
  });

  it('termina justo en la etiqueta de cierre de la raíz, sin salto de línea', () => {
    const salida = firmador().firmarDte(BOLETA, '#F56T39').toString('latin1');
    expect(salida.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>\n<DTE ')).toBe(true);
    expect(salida.endsWith('</Signature></DTE>')).toBe(true);
  });

  it('sale en ISO-8859-1 si el documento lo declara', () => {
    const salida = firmador().firmarDte(aIso88591(BOLETA), '#F56T39');
    expect(salida.includes(Buffer.from([0xd1]))).toBe(true); // Ñ
    expect(salida.includes(Buffer.from('Ñ', 'utf8'))).toBe(false);
  });

  it('un string Unicode y sus bytes ISO-8859-1 dan la misma salida', () => {
    const f = firmador();
    expect(f.firmarDte(BOLETA, '#F56T39').equals(f.firmarDte(aIso88591(BOLETA), '#F56T39'))).toBe(
      true,
    );
  });

  it('la URI por defecto es #F1T33', () => {
    const doc = parsearDocumento(firmador().firmarDte(BOLETA));
    expect(unico(doc, 'Reference').getAttribute('URI')).toBe('#F1T33');
  });

  it('es determinista', () => {
    expect(
      firmador().firmarDte(BOLETA, '#F56T39').equals(firmador().firmarDte(BOLETA, '#F56T39')),
    ).toBe(true);
  });
});

describe('FirmaElectronica.firmarSemilla', () => {
  it('usa el transform enveloped-signature', () => {
    // Regresión del ESTADO 11 "elemento 'Certificate' no existe".
    const doc = parsearDocumento(firmador().firmarSemilla('123456789012'));
    expect(unico(doc, 'Reference').getAttribute('URI')).toBe('');
    expect(elementos(doc, 'Transform').map((t) => t.getAttribute('Algorithm'))).toEqual([
      `${DSIG}enveloped-signature`,
    ]);
  });

  it('es verificable y el digest es del documento sin la firma', () => {
    const doc = parsearDocumento(firmador().firmarSemilla('123456789012'));
    expect(firmaValida(doc, false)).toBe(true);
    expect(unico(doc, 'DigestValue').textContent).toBe(
      sha1(c14n(parsearXml('<getToken><item><Semilla>123456789012</Semilla></item></getToken>'))),
    );
  });

  it('mantiene la semilla y el certificado', () => {
    const xml = firmador().firmarSemilla('987654321098');
    const doc = parsearDocumento(xml);
    expect(doc.getElementsByTagName('Semilla')[0]?.textContent).toBe('987654321098');
    expect(elementos(doc, 'X509Certificate')).toHaveLength(1);
    expect(xml.startsWith('<?xml version="1.0"?><getToken>')).toBe(true);
    expect(xml.endsWith('</getToken>')).toBe(true);
  });
});

describe('FirmaElectronica: construcción', () => {
  it('una llave ilegible lanza ErrorFirma sin incluir el PEM en el mensaje', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nNOESUNALLAVE\n-----END PRIVATE KEY-----\n';
    expect(() => new FirmaElectronica(pem, certificado)).toThrow(ErrorFirma);
    try {
      new FirmaElectronica(pem, certificado);
    } catch (error) {
      expect((error as Error).message).not.toContain('NOESUNALLAVE');
      expect((error as Error).message).not.toContain('BEGIN');
    }
  });

  it('una llave que no es RSA lanza ErrorFirma al firmar', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => new FirmaElectronica(pem, certificado).firmarDte(BOLETA, '#F56T39')).toThrow(
      ErrorFirma,
    );
  });
});

describe('arranque: SHA1 disponible en este runtime', () => {
  // El SII exige RSA-SHA1. Algunas builds de Node con el OpenSSL del sistema
  // (p. ej. RHEL 9 con la política DEFAULT) bloquean SHA1 para firmar: hay que
  // usar el binario oficial de Node o su imagen Docker (PLAN §9).
  it('firma y verifica RSA-SHA1', () => {
    const datos = Buffer.from('prueba de arranque', 'utf8');
    let firma: Buffer;
    try {
      firma = sign('sha1', datos, llave);
    } catch (error) {
      throw new Error(
        `Este runtime de Node no permite firmar con RSA-SHA1 (${String(error)}). ` +
          'El SII lo exige: use el binario oficial de Node o la imagen Docker oficial.',
      );
    }
    expect(firma).toHaveLength(256);
    expect(verify('sha1', datos, createPublicKey(certificado), firma)).toBe(true);
  });
});
