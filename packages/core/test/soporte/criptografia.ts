// Material criptográfico de MENTIRA para los tests: llaves RSA de cualquier
// tamaño, certificados autofirmados o emitidos por una CA de prueba, y .pfx.
// Nada de esto es del SII ni de ningún contribuyente real.
//
// Deriva de winex/certificacion v1.9.1 (tests/Soporte/Criptografia.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript; el
// tamaño de la llave es configurable (pend. 6.2) y no hace falta openssl.cnf.
//
// Las llaves las genera node:crypto (rápido); node-forge arma y firma los X.509
// y los .pfx. node-forge no sabe crear .pfx legacy (RC2-40): para esos se usa
// el material versionado en paridad/material/ (cert-legacy*.pfx).

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import forge from 'node-forge';

export interface LlavePrueba {
  /** PKCS#8 sin cifrar. */
  readonly pem: string;
  readonly objeto: KeyObject;
  readonly forge: forge.pki.rsa.PrivateKey;
}

export interface CertificadoPrueba {
  readonly llave: LlavePrueba;
  /** Certificado en PEM (64 columnas, LF). */
  readonly pem: string;
  readonly forge: forge.pki.Certificate;
}

const llaves = new Map<number, LlavePrueba>();

/** Llave RSA nueva del tamaño pedido (sin caché: cada llamada genera otra). */
export function generarLlave(bits = 2048): LlavePrueba {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    pem,
    objeto: privateKey,
    forge: forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey,
  };
}

/** Llave RSA reutilizable por tamaño (generar una de 4096 bits toma segundos). */
export function llave(bits = 2048): LlavePrueba {
  let existente = llaves.get(bits);
  if (existente === undefined) {
    existente = generarLlave(bits);
    llaves.set(bits, existente);
  }
  return existente;
}

let serie = 1;

export interface OpcionesCertificado {
  /** CN del sujeto. Por omisión, "Titular de Prueba" (como el PHP). */
  readonly cn?: string;
  /** Quién lo firma; sin emisor queda autofirmado. */
  readonly emisor?: CertificadoPrueba;
  /** Llave del certificado; por omisión una de 2048 bits reutilizada. */
  readonly llave?: LlavePrueba;
  /** true para una CA (puede firmar otros certificados). */
  readonly ca?: boolean;
  /** Días de vigencia desde ayer. */
  readonly dias?: number;
}

/** Certificado X.509 de prueba. */
export function certificado(opciones: OpcionesCertificado = {}): CertificadoPrueba {
  const propia = opciones.llave ?? llave();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(propia.forge.n, propia.forge.e);
  cert.serialNumber = (serie++).toString(16).padStart(2, '0');
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + (opciones.dias ?? 30) * 24 * 3600 * 1000);
  const sujeto = [
    { name: 'commonName', value: opciones.cn ?? 'Titular de Prueba' },
    { name: 'organizationName', value: 'Material de prueba certificacion-node' },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(opciones.emisor?.forge.subject.attributes ?? sujeto);
  cert.setExtensions([
    { name: 'basicConstraints', cA: opciones.ca === true, critical: true },
    opciones.ca === true
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
  ]);
  cert.sign((opciones.emisor?.llave ?? propia).forge, forge.md.sha256.create());
  return {
    llave: propia,
    forge: cert,
    pem: forge.pki.certificateToPem(cert).replaceAll('\r\n', '\n'),
  };
}

/** Hoja emitida por una CA intermedia, que a su vez emite una CA raíz. */
export function cadena(): {
  raiz: CertificadoPrueba;
  intermedia: CertificadoPrueba;
  hoja: CertificadoPrueba;
} {
  const raiz = certificado({ cn: 'CA Raiz de Prueba', ca: true, llave: generarLlave() });
  const intermedia = certificado({
    cn: 'CA Intermedia de Prueba',
    ca: true,
    emisor: raiz,
    llave: generarLlave(),
  });
  const hoja = certificado({ emisor: intermedia });
  return { raiz, intermedia, hoja };
}

export interface OpcionesPfx {
  /** Certificados adicionales (intermedios), en el orden en que van al .pfx. */
  readonly intermedios?: readonly CertificadoPrueba[];
  /** Cifrado de la llave: AES (PBES2) o 3DES. Por omisión AES-256. */
  readonly algoritmo?: 'aes128' | 'aes192' | 'aes256' | '3des';
}

/** Bytes de un .pfx con la llave y el certificado (y los intermedios) indicados. */
export function pfx(titular: CertificadoPrueba, clave: string, opciones: OpcionesPfx = {}): Buffer {
  const certificados = [titular.forge, ...(opciones.intermedios ?? []).map((c) => c.forge)];
  const asn1 = forge.pkcs12.toPkcs12Asn1(titular.llave.forge, certificados, clave, {
    algorithm: opciones.algoritmo ?? 'aes256',
    friendlyName: 'Titular de Prueba',
    generateLocalKeyId: true,
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
