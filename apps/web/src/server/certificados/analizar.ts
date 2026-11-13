import 'server-only';
import { X509Certificate } from 'node:crypto';
import { Certificado, ErrorCertificado, huellaCertificado } from '@winex/certificacion';
import forge from 'node-forge';
import { rutSii, validarRut } from '@/lib/formatos';
import { ErrorAnalisisCertificado } from './errores';

// Lectura de un .pfx subido por el usuario (PLAN-SAAS Fase 3, punto 2). Abre el
// archivo con `Certificado.desdeContenido` de la librería (principio 4: no se
// reimplementa la lectura del PKCS#12) y saca de ahí lo que guarda la fila de
// `certificados`: titular, RUT, CN, emisor, vigencia, huella y si es legacy.
//
// Reglas (criterio de aceptación de la Fase 3): ni los bytes, ni su base64, ni la
// clave, ni el nombre del archivo salen de esta función por ningún camino. Los
// errores son `ErrorAnalisisCertificado` con mensajes fijos y SIN `cause` (el
// `cause` de la librería trae el error de node-forge, que no se registra).

export interface AnalisisCertificado {
  /** CN del sujeto (como `Certificado.info().cn`). */
  readonly cn: string | null;
  /** Nombre del titular: el CN (en los certificados chilenos es el nombre de la persona). */
  readonly nombreTitular: string | null;
  /** RUT del titular en formato SII (`12345678-9`), o `null` si el certificado no lo trae. */
  readonly rutTitular: string | null;
  /** CN del emisor o, si no tiene, su O. */
  readonly emisorCa: string | null;
  readonly vigenteDesde: Date;
  readonly vigenteHasta: Date;
  /** `huellaCertificado()` de la librería: la misma que usan los tokens del SII. */
  readonly huellaSha256: string;
  /** El PKCS#12 usa un cifrado que OpenSSL 3 solo lee con el proveedor legacy (RC2, RC4, DES...). */
  readonly pfxLegacy: boolean;
}

export interface OpcionesAnalisis {
  /** Reloj para la vigencia (pruebas). */
  readonly ahora?: Date;
}

/** OID del RUT en el subjectAltName (otherName) de los certificados chilenos. */
export const OID_RUT_SAN = '1.3.6.1.4.1.8321.1';

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  encryptedData: '1.2.840.113549.1.7.6',
  pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  pbes2: '1.2.840.113549.1.5.13',
  commonName: '2.5.4.3',
  serialNumber: '2.5.4.5',
  organizationName: '2.5.4.10',
  subjectAltName: '2.5.29.17',
} as const;

// Mismos conjuntos que `PBE_NATIVOS` / `PBES2_NATIVOS` de la librería
// (packages/core/src/core/certificado.ts): lo que OpenSSL 3 descifra sin el
// proveedor legacy. Todo lo demás (RC2-40 de los .pfx del SII, RC4, DES) es legacy.
const PBE_NATIVOS = new Set([
  '1.2.840.113549.1.12.1.3', // pbeWithSHAAnd3-KeyTripleDES-CBC
  '1.2.840.113549.1.12.1.4', // pbeWithSHAAnd2-KeyTripleDES-CBC
]);
const PBES2_NATIVOS = new Set([
  '2.16.840.1.101.3.4.1.2', // aes128-CBC
  '2.16.840.1.101.3.4.1.22', // aes192-CBC
  '2.16.840.1.101.3.4.1.42', // aes256-CBC
  '1.2.840.113549.3.7', // des-EDE3-CBC
]);

type Asn1 = forge.asn1.Asn1;

/** `pki.pbe.getCipher` existe en node-forge pero no en sus tipos (igual que en la librería). */
interface CifradoForge {
  update(datos: forge.util.ByteStringBuffer): void;
  finish(): boolean;
  output: forge.util.ByteStringBuffer;
}

/** `asn1.fromDer` acepta un objeto de opciones, pero sus tipos solo declaran `strict` booleano. */
const fromDerConOpciones = forge.asn1.fromDer as unknown as (
  bytes: string,
  opciones: { strict: boolean; parseAllBytes: boolean; decodeBitStrings: boolean },
) => Asn1;

const pbe = (
  forge.pki as unknown as {
    pbe: { getCipher(oid: string, params: Asn1, clave: string): CifradoForge };
  }
).pbe;

/**
 * Abre el .pfx con su clave y devuelve los datos públicos del certificado.
 *
 * @throws ErrorAnalisisCertificado (`no_es_pfx`, `clave_incorrecta`, `danado`,
 *   `vencido`, `no_vigente`). Nunca otro tipo de error.
 */
export function analizarCertificado(
  bytes: Uint8Array,
  clave: string,
  opciones: OpcionesAnalisis = {},
): AnalisisCertificado {
  // 1. ¿Es un PKCS#12? Sin esto, la librería tomaría un PEM como certificado válido.
  const pfx = leerEstructuraPfx(bytes);

  // 2. La librería valida el MAC (clave), descifra y empareja llave y certificado.
  let certificado: Certificado;
  try {
    certificado = Certificado.desdeContenido(bytes, clave);
  } catch (error) {
    if (error instanceof ErrorCertificado && /contraseña/i.test(error.message)) {
      throw new ErrorAnalisisCertificado('clave_incorrecta');
    }
    throw new ErrorAnalisisCertificado('danado');
  }

  // 3. Datos del certificado del titular (la hoja).
  let x509: X509Certificate;
  let huellaSha256: string;
  let pfxLegacy: boolean;
  let cn: string | null;
  let rutTitular: string | null;
  let emisorCa: string | null;
  try {
    x509 = new X509Certificate(certificado.certificado);
    huellaSha256 = huellaCertificado(certificado.certificado);
    cn = certificado.info().cn;
    const tbs = camposTbs(forge.asn1.fromDer(Buffer.from(x509.raw).toString('binary'), false));
    rutTitular = rutDelSan(tbs.extensiones) ?? rutDelSerialNumber(tbs.sujeto);
    emisorCa =
      atributoDeNombre(tbs.emisor, OID.commonName) ??
      atributoDeNombre(tbs.emisor, OID.organizationName);
    pfxLegacy = esPfxLegacy(pfx, clave);
  } catch {
    throw new ErrorAnalisisCertificado('danado');
  }

  // 4. Vigencia.
  const ahora = opciones.ahora ?? new Date();
  const vigenteDesde = x509.validFromDate;
  const vigenteHasta = x509.validToDate;
  if (ahora.getTime() > vigenteHasta.getTime()) {
    throw new ErrorAnalisisCertificado('vencido', { vigenteHasta });
  }
  if (ahora.getTime() < vigenteDesde.getTime()) {
    throw new ErrorAnalisisCertificado('no_vigente', { vigenteDesde });
  }

  return {
    cn,
    nombreTitular: cn,
    rutTitular,
    emisorCa,
    vigenteDesde,
    vigenteHasta,
    huellaSha256,
    pfxLegacy,
  };
}

// --- PKCS#12 -------------------------------------------------------------------

function hijos(nodo: Asn1 | undefined): Asn1[] {
  if (nodo === undefined || !Array.isArray(nodo.value)) {
    throw new Error('Estructura ASN.1 inesperada');
  }
  return nodo.value;
}

function oid(nodo: Asn1 | undefined): string {
  if (
    nodo === undefined ||
    nodo.tagClass !== forge.asn1.Class.UNIVERSAL ||
    nodo.type !== forge.asn1.Type.OID ||
    typeof nodo.value !== 'string'
  ) {
    throw new Error('Se esperaba un OID');
  }
  return forge.asn1.derToOid(nodo.value);
}

/** Bytes de un OCTET STRING, también si viene partido en trozos (BER constructed). */
function octetos(nodo: Asn1 | undefined): string {
  if (nodo === undefined) throw new Error('Estructura ASN.1 inesperada');
  if (typeof nodo.value === 'string') return nodo.value;
  return nodo.value.map(octetos).join('');
}

/** Contenido `[0] EXPLICIT`. */
function explicito(nodo: Asn1 | undefined): Asn1 {
  const [contenido] = hijos(nodo);
  if (contenido === undefined) throw new Error('Estructura ASN.1 inesperada');
  return contenido;
}

/**
 * PFX ::= SEQUENCE { version INTEGER (3), authSafe ContentInfo, macData OPTIONAL }.
 * Si no calza, no es un .pfx (o está tan dañado que da igual).
 */
function leerEstructuraPfx(bytes: Uint8Array): Asn1 {
  try {
    if (bytes.byteLength < 16) throw new Error('muy corto');
    // Estricto con los largos: un archivo truncado no llega a la librería (que lo
    // informaría como contraseña incorrecta). Admite BER de largo indefinido.
    const asn1 = fromDerConOpciones(Buffer.from(bytes).toString('binary'), {
      strict: true,
      parseAllBytes: false,
      decodeBitStrings: false,
    });
    const [version, authSafe] = hijos(asn1);
    if (
      version?.type !== forge.asn1.Type.INTEGER ||
      typeof version.value !== 'string' ||
      version.value.charCodeAt(0) !== 3
    ) {
      throw new Error('versión');
    }
    const tipo = oid(hijos(authSafe)[0]);
    if (tipo !== OID.data && tipo !== OID.signedData) throw new Error('authSafe');
    return asn1;
  } catch {
    throw new ErrorAnalisisCertificado('no_es_pfx');
  }
}

function esCifradoNativo(algoritmo: Asn1): boolean {
  const [id, parametros] = hijos(algoritmo);
  const alg = oid(id);
  if (PBE_NATIVOS.has(alg)) return true;
  if (alg === OID.pbes2) {
    const [, esquema] = hijos(parametros);
    return PBES2_NATIVOS.has(oid(hijos(esquema)[0]));
  }
  return false;
}

/** ¿Alguna llave cifrada (pkcs8ShroudedKeyBag) de estas SafeBags usa un cifrado legacy? */
function bolsasConLlaveLegacy(bolsas: string): boolean {
  for (const bolsa of hijos(forge.asn1.fromDer(bolsas, false))) {
    const [id, valor] = hijos(bolsa);
    if (oid(id) !== OID.pkcs8ShroudedKeyBag) continue;
    const [algoritmo] = hijos(explicito(valor));
    if (algoritmo === undefined || !esCifradoNativo(algoritmo)) return true;
  }
  return false;
}

/**
 * Mismo criterio que `ContenidoPfx.legacy` de la librería (privado allí): legacy si
 * algún EncryptedData o alguna llave cifrada usa un algoritmo fuera de los nativos de
 * OpenSSL 3. Se leen los OID con node-forge; las SafeBags de un EncryptedData nativo
 * se descifran solo para mirar el algoritmo de sus llaves (la clave ya se validó).
 */
function esPfxLegacy(pfx: Asn1, clave: string): boolean {
  const [, authSafe] = hijos(pfx);
  if (oid(hijos(authSafe)[0]) !== OID.data) return false;
  const seguros = hijos(forge.asn1.fromDer(octetos(explicito(hijos(authSafe)[1])), false));

  for (const seguro of seguros) {
    const [tipo, envoltorio] = hijos(seguro);
    const tipoSeguro = oid(tipo);
    if (tipoSeguro === OID.data) {
      if (bolsasConLlaveLegacy(octetos(explicito(envoltorio)))) return true;
    } else if (tipoSeguro === OID.encryptedData) {
      const [, info] = hijos(explicito(envoltorio));
      const [, algoritmo, cifrado] = hijos(info);
      if (algoritmo === undefined) throw new Error('EncryptedContentInfo sin algoritmo');
      if (!esCifradoNativo(algoritmo)) return true;
      const [id, parametros] = hijos(algoritmo);
      if (parametros === undefined) throw new Error('Cifrado sin parámetros');
      const descifrador = pbe.getCipher(oid(id), parametros, clave);
      descifrador.update(forge.util.createBuffer(octetos(cifrado)));
      if (!descifrador.finish()) throw new Error('No se pudo descifrar');
      if (bolsasConLlaveLegacy(descifrador.output.getBytes())) return true;
    }
  }
  return false;
}

// --- X.509 -----------------------------------------------------------------------

interface CamposTbs {
  readonly emisor: Asn1 | undefined;
  readonly sujeto: Asn1 | undefined;
  /** `Extensions` (SEQUENCE), si el certificado es v3. */
  readonly extensiones: Asn1 | undefined;
}

function camposTbs(certificado: Asn1): CamposTbs {
  const [tbs] = hijos(certificado);
  const campos = hijos(tbs);
  // version [0] EXPLICIT es opcional (v1 no la trae).
  const d = campos[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  // serial, signature, issuer, validity, subject, spki, luego [1] [2] [3] opcionales.
  const extensiones = campos
    .slice(d + 6)
    .find((c) => c.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && c.type === 3);
  return {
    emisor: campos[d + 2],
    sujeto: campos[d + 4],
    extensiones: extensiones ? explicito(extensiones) : undefined,
  };
}

const TIPOS_TEXTO = new Set<number>([
  forge.asn1.Type.UTF8,
  forge.asn1.Type.PRINTABLESTRING,
  forge.asn1.Type.IA5STRING,
  20, // T61String (TeletexString)
  forge.asn1.Type.BMPSTRING,
  26, // VisibleString
  28, // UniversalString (raro; se lee byte a byte)
]);

function decodificarTexto(nodo: Asn1): string {
  const buffer = Buffer.from(nodo.value as string, 'binary');
  switch (nodo.type) {
    case forge.asn1.Type.UTF8:
      return buffer.toString('utf8');
    case forge.asn1.Type.BMPSTRING:
      return Buffer.from(buffer).swap16().toString('utf16le');
    default:
      return buffer.toString('latin1');
  }
}

/** Primer string ASN.1 dentro del nodo (busca en profundidad, p. ej. `[0] EXPLICIT IA5String`). */
function primerTexto(nodo: Asn1 | undefined, profundidad = 0): string | null {
  if (nodo === undefined || profundidad > 4) return null;
  if (
    nodo.tagClass === forge.asn1.Class.UNIVERSAL &&
    TIPOS_TEXTO.has(nodo.type) &&
    typeof nodo.value === 'string'
  ) {
    return decodificarTexto(nodo);
  }
  if (Array.isArray(nodo.value)) {
    for (const hijo of nodo.value) {
      const texto = primerTexto(hijo, profundidad + 1);
      if (texto !== null) return texto;
    }
  }
  return null;
}

/** Valor del primer atributo `oidBuscado` de un Name (RDNSequence). */
function atributoDeNombre(nombre: Asn1 | undefined, oidBuscado: string): string | null {
  if (nombre === undefined) return null;
  for (const rdn of hijos(nombre)) {
    for (const atributo of hijos(rdn)) {
      const [id, valor] = hijos(atributo);
      if (oid(id) === oidBuscado) {
        const texto = primerTexto(valor)?.trim();
        if (texto) return texto;
      }
    }
  }
  return null;
}

/** Normaliza a `12345678-9` si el texto es un RUT válido; si no, `null`. */
function normalizarRut(texto: string): string | null {
  return validarRut(texto) ? rutSii(texto) : null;
}

/**
 * RUT del subjectAltName: GeneralName `otherName` ([0] IMPLICIT) con type-id
 * 1.3.6.1.4.1.8321.1 y el valor en `[0] EXPLICIT` (IA5String en E-Certchile y
 * otras CA chilenas).
 */
function rutDelSan(extensiones: Asn1 | undefined): string | null {
  if (extensiones === undefined) return null;
  for (const extension of hijos(extensiones)) {
    const campos = hijos(extension);
    if (oid(campos[0]) !== OID.subjectAltName) continue;
    const valor = campos[campos.length - 1];
    const nombres = forge.asn1.fromDer(octetos(valor), false);
    for (const nombre of hijos(nombres)) {
      if (nombre.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || nombre.type !== 0) continue;
      if (!Array.isArray(nombre.value)) continue;
      const [tipo, contenido] = nombre.value;
      let tipoId: string;
      try {
        tipoId = oid(tipo);
      } catch {
        continue;
      }
      if (tipoId !== OID_RUT_SAN) continue;
      const texto = primerTexto(contenido);
      const rut = texto === null ? null : normalizarRut(texto);
      if (rut !== null) return rut;
    }
  }
  return null;
}

// Con guion obligatorio: sin él, cualquier número de serie de 8–9 dígitos con un DV
// que calce por azar (1 de 11) pasaría por RUT.
const PATRON_RUT = /(?<!\d)\d{1,2}\.?\d{3}\.?\d{3}-[\dkK](?![\dkK])/;

/** Algunas CA ponen el RUT en el `serialNumber` del sujeto (a veces con prefijo). */
function rutDelSerialNumber(sujeto: Asn1 | undefined): string | null {
  const serie = atributoDeNombre(sujeto, OID.serialNumber);
  if (serie === null) return null;
  const candidato = PATRON_RUT.exec(serie)?.[0];
  return candidato === undefined ? null : normalizarRut(candidato);
}
