// Deriva de winex/certificacion v1.9.1 (src/Core/Certificate.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript;
// el .pfx se lee con node-forge (incluido el cifrado legacy RC2-40 de los .pfx
// del SII) sin invocar el binario openssl.
//
// Paridad con el PHP: los PEM que entrega (llave, certificado, cadena, aPem)
// son los mismos bytes que los de Certificate en Linux. El PHP tiene dos rutas
// para el .pfx que entregan formatos levemente distintos, y aquí se imitan las dos:
//
// - ruta nativa (openssl_pkcs12_read): la usa el PHP cuando OpenSSL 3 puede
//   descifrar el .pfx sin el proveedor legacy (AES/PBES2 o 3DES). La llave y el
//   certificado terminan en "\n" y los intermedios quedan EN ORDEN INVERSO al del
//   .pfx (PHP los saca con sk_X509_pop).
// - ruta de la CLI (`openssl pkcs12 -legacy`): la usa con RC2-40 y los demás
//   cifrados legacy, que son los de los .pfx del SII. La llave y el certificado
//   no terminan en "\n" y la cadena son todos los certificados en el orden del .pfx.
//
// Diferencia a propósito: en Windows el PHP arma la cadena de la ruta de la CLI
// con CRLF (las tuberías de proc_open) y por eso aPem() repite la hoja. Aquí
// siempre se usa LF, como el PHP en Linux.

import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  type PrivateKeyInput,
  X509Certificate,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import forge from 'node-forge';
import { ErrorCertificado } from '../comun/errores.ts';
import type { IdentidadTls } from '../comun/http/transporte.ts';
import { fechaHoraSii } from '../comun/reloj.ts';

/** CN y vigencia del certificado (como `getInfo()` del PHP), en hora de Chile. */
export interface InfoCertificado {
  readonly cn: string | null;
  /** `YYYY-MM-DD HH:MM:SS` en hora de Chile. */
  readonly vigenteDesde: string | null;
  /** `YYYY-MM-DD HH:MM:SS` en hora de Chile. */
  readonly vigenteHasta: string | null;
}

const BLOQUE_CERTIFICADO = /-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----/gs;
const BLOQUE_LLAVE = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----.*?-----END \1PRIVATE KEY-----/s;

export class Certificado {
  /** Llave privada en PEM, sin cifrar (PKCS#8). */
  readonly llavePrivada: string;
  /** Certificado del titular (la hoja) en PEM. */
  readonly certificado: string;
  /** Hoja + intermedios en PEM; `null` si solo venía la hoja. */
  readonly #cadena: string | null;

  private constructor(llavePrivada: string, certificado: string, cadena: string | null) {
    this.llavePrivada = llavePrivada;
    this.certificado = certificado;
    this.#cadena = cadena;
  }

  /**
   * Carga un certificado desde los bytes de un .pfx/.p12, o desde un PEM con la
   * llave privada y el certificado (y opcionalmente los intermedios).
   *
   * @param contenido bytes del .pfx o texto del PEM. Un string se toma como PEM.
   * @param clave contraseña del .pfx, o passphrase de la llave del PEM si viene cifrada.
   */
  static desdeContenido(contenido: Uint8Array | string, clave = ''): Certificado {
    const texto =
      typeof contenido === 'string' ? contenido : Buffer.from(contenido).toString('latin1');
    if (texto.includes('-----BEGIN ')) {
      return Certificado.#desdePem(texto, clave);
    }
    if (typeof contenido === 'string') {
      throw new ErrorCertificado(
        'El contenido no es un PEM. Para cargar un .pfx, entrega sus bytes (Buffer).',
      );
    }
    return Certificado.#desdePfx(Buffer.from(contenido), clave);
  }

  /**
   * Lee el .pfx o el PEM desde un archivo. El mensaje de error no incluye la ruta
   * (los .pfx del SII suelen llevar el RUT del titular en el nombre); queda en `cause`.
   */
  static async desdeArchivo(ruta: string, clave = ''): Promise<Certificado> {
    let contenido: Buffer;
    try {
      contenido = await readFile(ruta);
    } catch (error) {
      throw new ErrorCertificado(
        'No se pudo leer el archivo del certificado: no existe o no es accesible.',
        {
          cause: error,
        },
      );
    }
    return Certificado.desdeContenido(contenido, clave);
  }

  /**
   * Hoja + intermedios que venían en el .pfx/PEM. Si solo venía la hoja, es lo
   * mismo que `certificado`. Es lo que se presenta en el TLS mutuo.
   */
  get cadena(): string {
    return this.#cadena ?? this.certificado;
  }

  /** Certificado de cliente para el TLS mutuo con el SII (transporte HTTP). */
  identidadTls(): IdentidadTls {
    return { cert: this.cadena, key: this.llavePrivada };
  }

  /**
   * Todo el material en un solo PEM: llave privada (sin cifrar) + hoja +
   * intermedios, en ese orden y sin repetidos. Sirve para guardar un .pfx ya
   * convertido. La llave va SIN cifrar: quien lo guarde debe cifrarlo en reposo.
   */
  aPem(): string {
    const certificados = [phpTrim(this.certificado)];
    if (this.#cadena !== null) {
      for (const bloque of this.#cadena.match(BLOQUE_CERTIFICADO) ?? []) {
        const certificado = phpTrim(bloque);
        if (!certificados.includes(certificado)) certificados.push(certificado);
      }
    }
    return `${phpTrim(this.llavePrivada)}\n${certificados.join('\n')}\n`;
  }

  /** CN y vigencia del certificado del titular. */
  info(): InfoCertificado {
    let x509: X509Certificate;
    try {
      x509 = new X509Certificate(this.certificado);
    } catch {
      return { cn: null, vigenteDesde: null, vigenteHasta: null };
    }
    const fecha = (d: Date) => fechaHoraSii(d).replace('T', ' ');
    return {
      cn: cnDelSujeto(x509.raw),
      vigenteDesde: fecha(x509.validFromDate),
      vigenteHasta: fecha(x509.validToDate),
    };
  }

  /**
   * Texto apto para un mensaje de error o un log: sin bloques PEM (aunque vengan
   * cortados), sin los atributos de bolsa de `openssl pkcs12` y sin líneas base64.
   */
  static sinMaterialPem(salida: string): string {
    let limpia = salida.replaceAll('\r\n', '\n');
    limpia = limpia.replace(/-----BEGIN [^-]*-----.*?(?:-----END [^-]*-----|$)/gs, '[PEM omitido]');
    limpia = limpia.replace(/^(?:Bag|Key) Attributes.*(?:\n[ \t]+.*)*$/gm, '');
    limpia = limpia.replace(/^[A-Za-z0-9+/=]{40,}$/gm, '');
    return phpTrim(limpia.replace(/\n{2,}/g, '\n'));
  }

  // --- PEM -------------------------------------------------------------------

  static #desdePem(entrada: string, clave: string): Certificado {
    // Un PEM convertido en Windows llega con CRLF: se normaliza para que el
    // material quede idéntico venga de un .pfx o de un .pem.
    const pem = entrada.replaceAll('\r\n', '\n');

    const bloqueLlave = BLOQUE_LLAVE.exec(pem)?.[0];
    if (bloqueLlave === undefined) {
      throw new ErrorCertificado('El PEM no trae la llave privada.');
    }
    let llave: KeyObject;
    try {
      const opciones: PrivateKeyInput = { key: bloqueLlave, format: 'pem' };
      if (clave !== '') opciones.passphrase = clave;
      llave = createPrivateKey(opciones);
    } catch (error) {
      throw new ErrorCertificado(
        'El PEM no tiene una llave privada legible (¿falta la passphrase o es incorrecta?).',
        { cause: error },
      );
    }

    const certificados = pem.match(BLOQUE_CERTIFICADO);
    if (certificados === null) {
      throw new ErrorCertificado('El PEM no contiene el bloque CERTIFICATE.');
    }
    // Como el PHP: los bloques CERTIFICATE se toman tal cual (sin reserializar).
    const [hoja] = certificados as [string, ...string[]];
    const cadena = certificados.length > 1 ? `${certificados.join('\n')}\n` : null;
    return new Certificado(llavePem(llave), hoja, cadena);
  }

  // --- PKCS#12 ---------------------------------------------------------------

  static #desdePfx(der: Buffer, clave: string): Certificado {
    let pfx: ContenidoPfx;
    try {
      const asn1 = forge.asn1.fromDer(der.toString('binary'), false);
      // forge valida la estructura y el MAC (contraseña) y descifra todo.
      forge.pkcs12.pkcs12FromAsn1(asn1, false, clave);
      pfx = leerPfx(asn1, clave);
    } catch (error) {
      if (error instanceof ErrorCertificado) throw error;
      const mensaje = error instanceof Error ? error.message : '';
      throw new ErrorCertificado(
        /MAC|password/i.test(mensaje)
          ? 'No se pudo abrir el .pfx: la contraseña es incorrecta.'
          : 'No se pudo leer el .pfx: el archivo está dañado o usa un cifrado no soportado.',
        { cause: error },
      );
    }

    const [derLlave] = pfx.llaves;
    if (derLlave === undefined) {
      throw new ErrorCertificado('El .pfx no trae la llave privada.');
    }
    let llave: KeyObject;
    try {
      llave = createPrivateKey({ key: derLlave, format: 'der', type: 'pkcs8' });
    } catch (error) {
      throw new ErrorCertificado('La llave privada del .pfx no es legible.', { cause: error });
    }

    const publica = createPublicKey(llave).export({ type: 'spki', format: 'der' });
    const correspondeALaLlave = (c: CertificadoPfx) => {
      try {
        return new X509Certificate(c.der).publicKey
          .export({ type: 'spki', format: 'der' })
          .equals(publica);
      } catch {
        return false;
      }
    };

    if (pfx.legacy) {
      // Ruta de la CLI: hoja = primer certificado con localKeyID (`-clcerts`);
      // cadena = todos los certificados en el orden del .pfx (`-nokeys`). El PHP
      // fallaba si ningún certificado traía localKeyID; aquí se busca por la llave.
      const hoja =
        pfx.certificados.find((c) => c.conLocalKeyId) ?? pfx.certificados.find(correspondeALaLlave);
      if (hoja === undefined) {
        throw new ErrorCertificado('El .pfx no trae el certificado del titular.');
      }
      const bloques = pfx.certificados.map((c) => certificadoPem(c.der).trimEnd());
      return new Certificado(
        llavePem(llave).trimEnd(),
        certificadoPem(hoja.der).trimEnd(),
        bloques.length > 1 ? `${bloques.join('\n')}\n` : null,
      );
    }

    // Ruta nativa: hoja = primer certificado que corresponde a la llave; los demás
    // son los intermedios, en orden inverso (ver el encabezado).
    const hoja = pfx.certificados.find(correspondeALaLlave);
    if (hoja === undefined) {
      throw new ErrorCertificado(
        'El .pfx no trae el certificado que corresponde a la llave privada.',
      );
    }
    const certificado = certificadoPem(hoja.der);
    const intermedios = pfx.certificados.filter((c) => c !== hoja).reverse();
    const cadena =
      intermedios.length > 0
        ? `${certificado.trimEnd()}\n${intermedios.map((c) => certificadoPem(c.der).trim()).join('\n')}\n`
        : null;
    return new Certificado(llavePem(llave), certificado, cadena);
  }
}

// --- Lectura del PKCS#12 -------------------------------------------------------

interface CertificadoPfx {
  readonly der: Buffer;
  /** Trae el atributo localKeyID (lo que `openssl pkcs12 -clcerts` toma como hoja). */
  readonly conLocalKeyId: boolean;
}

interface ContenidoPfx {
  /** Llaves privadas (PrivateKeyInfo en DER), en el orden del .pfx. */
  readonly llaves: Buffer[];
  /** Certificados X.509 en DER, en el orden del .pfx. */
  readonly certificados: CertificadoPfx[];
  /** Usa algún cifrado que OpenSSL 3 solo lee con el proveedor legacy (RC2, RC4, DES...). */
  readonly legacy: boolean;
}

type Asn1 = forge.asn1.Asn1;

/** `pki.pbe.getCipher` existe en node-forge pero no en sus tipos. */
interface CifradoForge {
  update(datos: forge.util.ByteStringBuffer): void;
  finish(): boolean;
  output: forge.util.ByteStringBuffer;
}
const pbe = (
  forge.pki as unknown as {
    pbe: { getCipher(oid: string, params: Asn1, clave: string): CifradoForge };
  }
).pbe;

const OID = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  localKeyId: '1.2.840.113549.1.9.21',
  pbes2: '1.2.840.113549.1.5.13',
} as const;

/** Cifrados de PKCS#12 que OpenSSL 3 lee con su proveedor por omisión. */
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

function hijos(nodo: Asn1 | undefined): Asn1[] {
  if (nodo === undefined || !Array.isArray(nodo.value)) {
    throw new Error('Estructura PKCS#12 inesperada');
  }
  return nodo.value;
}

function oid(nodo: Asn1 | undefined): string {
  if (nodo === undefined || typeof nodo.value !== 'string') {
    throw new Error('Estructura PKCS#12 inesperada');
  }
  return forge.asn1.derToOid(nodo.value);
}

/** Bytes de un OCTET STRING, también si viene partido en trozos (BER constructed). */
function octetos(nodo: Asn1 | undefined): string {
  if (nodo === undefined) throw new Error('Estructura PKCS#12 inesperada');
  if (typeof nodo.value === 'string') return nodo.value;
  return nodo.value.map(octetos).join('');
}

/** Contenido `[0] EXPLICIT` de un ContentInfo o de un SafeBag. */
function explicito(nodo: Asn1 | undefined): Asn1 {
  const [contenido] = hijos(nodo);
  if (contenido === undefined) throw new Error('Estructura PKCS#12 inesperada');
  return contenido;
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

/**
 * Recorre el PKCS#12 y devuelve las llaves y los certificados con sus bytes
 * originales (forge reserializa los certificados que parsea; aquí no se toca el DER).
 */
function leerPfx(pfx: Asn1, clave: string): ContenidoPfx {
  const llaves: Buffer[] = [];
  const certificados: CertificadoPfx[] = [];
  let legacy = false;

  const [, authSafe] = hijos(pfx);
  if (oid(hijos(authSafe)[0]) !== OID.data) throw new Error('authSafe no es Data');
  const seguros = hijos(forge.asn1.fromDer(octetos(explicito(hijos(authSafe)[1])), false));

  for (const seguro of seguros) {
    const [tipo, envoltorio] = hijos(seguro);
    let bolsas: string;
    if (oid(tipo) === OID.data) {
      bolsas = octetos(explicito(envoltorio));
    } else if (oid(tipo) === OID.encryptedData) {
      const [, info] = hijos(explicito(envoltorio));
      const [, algoritmo, cifrado] = hijos(info);
      if (algoritmo === undefined) throw new Error('EncryptedContentInfo sin algoritmo');
      legacy ||= !esCifradoNativo(algoritmo);
      const [id, parametros] = hijos(algoritmo);
      if (parametros === undefined) throw new Error('Cifrado sin parámetros');
      const descifrador = pbe.getCipher(oid(id), parametros, clave);
      descifrador.update(forge.util.createBuffer(octetos(cifrado)));
      if (!descifrador.finish()) throw new Error('No se pudo descifrar el contenido del .pfx');
      bolsas = descifrador.output.getBytes();
    } else {
      continue;
    }

    for (const bolsa of hijos(forge.asn1.fromDer(bolsas, false))) {
      const [id, valor, atributos] = hijos(bolsa);
      const tipoBolsa = oid(id);
      if (tipoBolsa === OID.keyBag || tipoBolsa === OID.pkcs8ShroudedKeyBag) {
        let info = explicito(valor);
        if (tipoBolsa === OID.pkcs8ShroudedKeyBag) {
          const [algoritmo] = hijos(info);
          if (algoritmo === undefined) throw new Error('Llave cifrada sin algoritmo');
          legacy ||= !esCifradoNativo(algoritmo);
          info = forge.pki.decryptPrivateKeyInfo(info, clave);
          if (info === null)
            throw new Error('No se pudo descifrar la llave privada (wrong password?)');
        }
        llaves.push(Buffer.from(forge.asn1.toDer(info).getBytes(), 'binary'));
      } else if (tipoBolsa === OID.certBag) {
        const [tipoCert, contenido] = hijos(explicito(valor));
        if (oid(tipoCert) !== OID.x509Certificate) continue;
        const conLocalKeyId =
          atributos !== undefined &&
          hijos(atributos).some((a) => oid(hijos(a)[0]) === OID.localKeyId);
        certificados.push({
          der: Buffer.from(octetos(explicito(contenido)), 'binary'),
          conLocalKeyId,
        });
      }
    }
  }

  return { llaves, certificados, legacy };
}

// --- Utilidades ------------------------------------------------------------------

/** PKCS#8 sin cifrar, como `openssl_pkey_export` / `openssl pkcs12 -nodes`. */
function llavePem(llave: KeyObject): string {
  return llave.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** PEM de 64 columnas con "\n" final, como PEM_write_bio_X509. */
function certificadoPem(der: Buffer): string {
  const lineas = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lineas.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** `trim()` de PHP: solo espacio, \t, \n, \r, \0 y \v. */
function phpTrim(texto: string): string {
  return texto.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
}

/**
 * CN del sujeto (como `openssl_x509_parse()['subject']['CN']`), decodificado a
 * texto según el tipo de string ASN.1. `null` si no tiene.
 */
function cnDelSujeto(der: Buffer): string | null {
  try {
    const certificado = forge.asn1.fromDer(der.toString('binary'), false);
    const [tbs] = hijos(certificado);
    const campos = hijos(tbs);
    // El primer campo es la versión ([0] EXPLICIT) si el certificado es v2/v3.
    const desplazamiento = campos[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
    const sujeto = campos[desplazamiento + 4];
    for (const rdn of hijos(sujeto)) {
      for (const atributo of hijos(rdn)) {
        const [id, valor] = hijos(atributo);
        if (oid(id) === '2.5.4.3' && valor !== undefined && typeof valor.value === 'string') {
          return decodificarString(valor.type, valor.value);
        }
      }
    }
  } catch {
    // Sujeto ilegible: se informa sin CN.
  }
  return null;
}

function decodificarString(tipo: number, bytes: string): string {
  const buffer = Buffer.from(bytes, 'binary');
  switch (tipo) {
    case forge.asn1.Type.UTF8:
      return buffer.toString('utf8');
    case forge.asn1.Type.BMPSTRING:
      return buffer.swap16().toString('utf16le');
    default:
      // PrintableString, IA5String, T61String: OpenSSL los pasa a UTF-8 byte a byte.
      return buffer.toString('latin1');
  }
}
