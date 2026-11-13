// Material criptográfico de MENTIRA para las pruebas de certificados: llaves RSA,
// certificados X.509 (autofirmados o emitidos por una CA de prueba, con o sin el RUT
// en el subjectAltName) y .pfx. Nada de esto es de un contribuyente real.
//
// Sigue a packages/certificacion/packages/core/test/soporte/criptografia.ts (no se
// importa porque es material de pruebas de la librería y no arma subjectAltName).
// node-forge no sabe crear .pfx legacy (RC2-40): para eso está el material versionado
// en packages/certificacion/paridad/material/ (clave `clave-de-prueba`).

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';

export const OID_RUT = '1.3.6.1.4.1.8321.1';

export interface CertificadoPrueba {
  readonly llave: forge.pki.rsa.PrivateKey;
  readonly forge: forge.pki.Certificate;
}

let llaveCompartida: forge.pki.rsa.PrivateKey | undefined;

function nuevaLlave(): forge.pki.rsa.PrivateKey {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
}

/** Llave reutilizada entre certificados (generar RSA toma tiempo). */
function llave(): forge.pki.rsa.PrivateKey {
  llaveCompartida ??= nuevaLlave();
  return llaveCompartida;
}

const DIA = 86_400_000;
let serie = 1;

export interface OpcionesCertificado {
  readonly cn?: string;
  /** Quién lo firma; sin emisor queda autofirmado. */
  readonly emisor?: CertificadoPrueba;
  readonly ca?: boolean;
  /** Llave propia nueva (para CA distintas de la hoja). */
  readonly llaveNueva?: boolean;
  /** RUT en el subjectAltName (otherName 1.3.6.1.4.1.8321.1, IA5String). */
  readonly rutSan?: string;
  /** otherName con otro OID (debe ignorarse). */
  readonly otroOtherName?: { oid: string; valor: string };
  /** `serialNumber` del sujeto. */
  readonly serialNumberSujeto?: string;
  /** Inicio de la vigencia (por omisión, ayer). */
  readonly desde?: Date;
  /** Fin de la vigencia (por omisión, en 365 días). */
  readonly hasta?: Date;
  /** O del emisor cuando es autofirmado sin CN (para probar el respaldo a O). */
  readonly sinCn?: boolean;
}

function otherName(tipoOid: string, valor: string): forge.asn1.Asn1 {
  const { asn1 } = forge;
  return asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(tipoOid).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.IA5STRING, false, valor),
    ]),
  ]);
}

export function certificado(opciones: OpcionesCertificado = {}): CertificadoPrueba {
  const propia = opciones.llaveNueva ? nuevaLlave() : llave();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(propia.n, propia.e);
  cert.serialNumber = (serie++).toString(16).padStart(2, '0');
  cert.validity.notBefore = opciones.desde ?? new Date(Date.now() - DIA);
  cert.validity.notAfter = opciones.hasta ?? new Date(Date.now() + 365 * DIA);

  const sujeto: forge.pki.CertificateField[] = [];
  if (!opciones.sinCn)
    sujeto.push({ name: 'commonName', value: opciones.cn ?? 'Titular de Prueba' });
  sujeto.push({ name: 'organizationName', value: 'Material de prueba Boleteame' });
  if (opciones.serialNumberSujeto) {
    sujeto.push({ type: '2.5.4.5', value: opciones.serialNumberSujeto });
  }
  cert.setSubject(sujeto);
  cert.setIssuer(opciones.emisor?.forge.subject.attributes ?? sujeto);

  const extensiones: Record<string, unknown>[] = [
    { name: 'basicConstraints', cA: opciones.ca === true, critical: true },
    opciones.ca === true
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
  ];
  const nombres: forge.asn1.Asn1[] = [];
  if (opciones.otroOtherName) {
    nombres.push(otherName(opciones.otroOtherName.oid, opciones.otroOtherName.valor));
  }
  if (opciones.rutSan) nombres.push(otherName(OID_RUT, opciones.rutSan));
  if (nombres.length > 0) {
    // rfc822Name, como los certificados reales, antes del otherName.
    nombres.unshift(
      forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 1, false, 'titular@example.com'),
    );
    extensiones.push({
      id: '2.5.29.17',
      value: forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, nombres),
    });
  }
  cert.setExtensions(extensiones);
  cert.sign(opciones.emisor?.llave ?? propia, forge.md.sha256.create());
  return { llave: propia, forge: cert };
}

/** CA raíz de prueba con su propia llave. */
export function caPrueba(cn = 'CA de Prueba Boleteame'): CertificadoPrueba {
  return certificado({ cn, ca: true, llaveNueva: true });
}

export interface OpcionesPfx {
  readonly intermedios?: readonly CertificadoPrueba[];
  readonly algoritmo?: 'aes128' | 'aes192' | 'aes256' | '3des';
}

/** Bytes de un .pfx con la llave y el certificado (y los intermedios). */
export function pfx(titular: CertificadoPrueba, clave: string, opciones: OpcionesPfx = {}): Buffer {
  const certificados = [titular.forge, ...(opciones.intermedios ?? []).map((c) => c.forge)];
  const asn1 = forge.pkcs12.toPkcs12Asn1(titular.llave, certificados, clave, {
    algorithm: opciones.algoritmo ?? 'aes256',
    friendlyName: 'Titular de Prueba',
    generateLocalKeyId: true,
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

/** Material versionado de la paridad con el PHP (clave `clave-de-prueba`). */
export const CLAVE_MATERIAL = 'clave-de-prueba';

export function leerMaterial(nombre: string): Buffer {
  return readFileSync(
    new URL(`../../../packages/certificacion/paridad/material/${nombre}`, import.meta.url),
  );
}
