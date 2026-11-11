// CAF de MENTIRA para los tests, generados al vuelo. Nada de esto es del SII ni
// de ningún contribuyente real.
//
// Deriva de winex/certificacion v1.9.1 (tests/Soporte/Criptografia.php, método caf()),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript, llave
// de tamaño y exponente configurables, y <RSAPK>/<RSAPUBK> como en los CAF reales.

import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface OpcionesCaf {
  rut?: string;
  razonSocial?: string;
  tipoDte?: number;
  desde?: number;
  hasta?: number;
  /** Tamaño de la llave RSA. Los CAF del SII usan 512 bits con exponente 3. */
  bits?: number;
  exponente?: number;
}

export interface CafPrueba {
  /** XML completo del CAF (texto Unicode). */
  xml: string;
  llavePublica: KeyObject;
}

const llaves = new Map<string, { privada: string; publica: KeyObject }>();

function llave(bits: number, exponente: number): { privada: string; publica: KeyObject } {
  const clave = `${bits}/${exponente}`;
  let par = llaves.get(clave);
  if (par === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: bits,
      publicExponent: exponente,
    });
    par = {
      privada: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      publica: publicKey,
    };
    llaves.set(clave, par);
  }
  return par;
}

/**
 * CAF de prueba. La `<RSASK>` va en PKCS#1 (como los del SII); la `<FRMA>` es
 * relleno porque solo el SII podría calcularla. Las llaves se reutilizan entre
 * llamadas con el mismo tamaño y exponente.
 */
export function cafPrueba(opciones: OpcionesCaf = {}): CafPrueba {
  const {
    rut = '76123456-0',
    razonSocial = 'EMPRESA DE PRUEBA SPA',
    tipoDte = 39,
    desde = 1,
    hasta = 10,
    bits = 512,
    exponente = 3,
  } = opciones;
  const { privada, publica } = llave(bits, exponente);
  const jwk = publica.export({ format: 'jwk' });
  const b64 = (valor: string | undefined) =>
    Buffer.from(valor ?? '', 'base64url').toString('base64');

  const xml =
    '<?xml version="1.0"?>\n' +
    '<AUTORIZACION>\n' +
    '<CAF version="1.0">\n' +
    '<DA>\n' +
    `<RE>${rut}</RE>\n<RS>${razonSocial}</RS>\n<TD>${tipoDte}</TD>\n` +
    `<RNG><D>${desde}</D><H>${hasta}</H></RNG>\n` +
    '<FA>2026-09-01</FA>\n' +
    `<RSAPK><M>${b64(jwk.n)}</M><E>${b64(jwk.e)}</E></RSAPK>\n` +
    '<IDK>100</IDK>\n' +
    '</DA>\n' +
    `<FRMA algoritmo="SHA1withRSA">${Buffer.alloc(64, 'x').toString('base64')}</FRMA>\n` +
    '</CAF>\n' +
    `<RSASK>${privada.trimEnd()}\n</RSASK>\n` +
    `<RSAPUBK>${publica.export({ type: 'spki', format: 'pem' }).toString().trimEnd()}\n</RSAPUBK>\n` +
    '</AUTORIZACION>\n';

  return { xml, llavePublica: publica };
}

/** Llave pública que declara el `<RSAPK>` (módulo y exponente en base64) de un CAF. */
export function llavePublicaRsapk(caf: string): KeyObject {
  const m = /<RSAPK>\s*<M>([^<]+)<\/M>\s*<E>([^<]+)<\/E>\s*<\/RSAPK>/.exec(caf);
  if (m?.[1] === undefined || m[2] === undefined) throw new Error('El CAF no trae <RSAPK>');
  const b64url = (valor: string) =>
    Buffer.from(valor.replace(/\s/g, ''), 'base64').toString('base64url');
  return createPublicKey({ key: { kty: 'RSA', n: b64url(m[1]), e: b64url(m[2]) }, format: 'jwk' });
}

/**
 * Separa un TED en el `<DD>` (los bytes exactos que se firmaron) y la firma.
 * Trabaja sobre bytes ISO-8859-1.
 */
export function partesTed(ted: Buffer): { dd: Buffer; firma: Buffer } {
  const texto = ted.toString('latin1');
  const m =
    /^<TED version="1\.0">(<DD>[\s\S]*<\/DD>)<FRMT algoritmo="SHA1withRSA">([^<]+)<\/FRMT><\/TED>$/.exec(
      texto,
    );
  if (m?.[1] === undefined || m[2] === undefined) throw new Error('Estructura de TED inesperada');
  return { dd: Buffer.from(m[1], 'latin1'), firma: Buffer.from(m[2], 'base64') };
}

/** Todos los `<TED>…</TED>` de un DTE o de un sobre, en bytes ISO-8859-1 exactos. */
export function tedsEn(xml: Buffer): Buffer[] {
  const texto = xml.toString('latin1');
  return [...texto.matchAll(/<TED version="1\.0">[\s\S]*?<\/TED>/g)].map((m) =>
    Buffer.from(m[0], 'latin1'),
  );
}
