// Material TLS de prueba generado al vuelo: CA raíz, certificado de servidor para
// 127.0.0.1, certificado de cliente emitido por una CA intermedia, y una segunda
// CA (no confiable) con su propio servidor y cliente. Nunca se usa material real.
//
// Las llaves las genera node:crypto (rápido); node-forge arma y firma los X.509.

import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export interface ParPem {
  readonly cert: string;
  readonly key: string;
}

interface Emisor {
  readonly certificado: forge.pki.Certificate;
  readonly llave: forge.pki.rsa.PrivateKey;
}

interface Emitido extends Emisor, ParPem {}

let serie = 1;

function llaves(): {
  llave: forge.pki.rsa.PrivateKey;
  publica: forge.pki.rsa.PublicKey;
  pem: string;
} {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const llave = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  const publica = forge.pki.setRsaPublicKey(llave.n, llave.e);
  return { llave, publica, pem: privateKey };
}

function emitir(cn: string, emisor: Emisor | undefined, extensiones: object[]): Emitido {
  const { llave, publica, pem } = llaves();
  const cert = forge.pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = (serie++).toString(16).padStart(2, '0');
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const sujeto = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'Material de prueba certificacion-node' },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(emisor === undefined ? sujeto : emisor.certificado.subject.attributes);
  cert.setExtensions(extensiones);
  cert.sign(emisor?.llave ?? llave, forge.md.sha256.create());
  return { certificado: cert, llave, cert: forge.pki.certificateToPem(cert), key: pem };
}

function ca(cn: string, emisor?: Emisor): Emitido {
  return emitir(cn, emisor, [
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);
}

function servidor(emisor: Emisor): Emitido {
  return emitir('127.0.0.1', emisor, [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
  ]);
}

function cliente(cn: string, emisor: Emisor): Emitido {
  return emitir(cn, emisor, [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
  ]);
}

export interface MaterialTls {
  /** CA raíz confiable (PEM). */
  readonly ca: string;
  /** Servidor emitido por la CA confiable. */
  readonly servidor: ParPem;
  /** Cliente emitido por una intermedia: `cert` trae la cadena completa (hoja + intermedia). */
  readonly cliente: ParPem;
  /** Cliente con solo la hoja, sin la intermedia. */
  readonly clienteSinCadena: ParPem;
  /** Servidor emitido por una CA que nadie configura como confiable. */
  readonly servidorNoConfiable: ParPem;
  /** Cliente emitido por esa misma CA no confiable. */
  readonly clienteNoConfiable: ParPem;
}

export function generarMaterialTls(): MaterialTls {
  const raiz = ca('CA raíz de prueba');
  const intermedia = ca('CA intermedia de prueba', raiz);
  const otra = ca('CA no confiable de prueba');

  const hoja = cliente('Titular de Prueba', intermedia);
  const ajeno = cliente('Titular no confiable', otra);

  return {
    ca: raiz.cert,
    servidor: servidor(raiz),
    cliente: { cert: hoja.cert + intermedia.cert, key: hoja.key },
    clienteSinCadena: { cert: hoja.cert, key: hoja.key },
    servidorNoConfiable: servidor(otra),
    clienteNoConfiable: { cert: ajeno.cert, key: ajeno.key },
  };
}
