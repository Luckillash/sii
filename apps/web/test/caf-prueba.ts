// CAF de MENTIRA para las pruebas de la certificación, generados al vuelo. Nada de esto es
// del SII ni de un contribuyente real.
//
// Sigue a packages/certificacion/packages/core/test/soporte/caf.ts (no se importa: es
// material de pruebas de la librería). La `<RSASK>` va en PKCS#1 como en los del SII; la
// `<FRMA>` es relleno (solo el SII podría calcularla y `Timbre` no la verifica).

import { generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface OpcionesCaf {
  rut?: string;
  razonSocial?: string;
  tipoDte?: number;
  desde?: number;
  hasta?: number;
  idk?: number;
}

let llave: { privada: string; publica: KeyObject } | undefined;

function par() {
  if (!llave) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 512,
      publicExponent: 3,
    });
    llave = {
      privada: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      publica: publicKey,
    };
  }
  return llave;
}

/** XML completo de un CAF de prueba (texto Unicode) y la llave privada que trae. */
export function cafPrueba(opciones: OpcionesCaf = {}): { xml: string; rsask: string } {
  const {
    rut = '76123456-0',
    razonSocial = 'EMPRESA DE PRUEBA SPA',
    tipoDte = 39,
    desde = 1,
    hasta = 10,
    idk = 100,
  } = opciones;
  const { privada, publica } = par();
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
    '<FA>2026-11-13</FA>\n' +
    `<RSAPK><M>${b64(jwk.n)}</M><E>${b64(jwk.e)}</E></RSAPK>\n` +
    `<IDK>${idk}</IDK>\n` +
    '</DA>\n' +
    `<FRMA algoritmo="SHA1withRSA">${Buffer.alloc(64, 'x').toString('base64')}</FRMA>\n` +
    '</CAF>\n' +
    `<RSASK>${privada.trimEnd()}\n</RSASK>\n` +
    `<RSAPUBK>${publica.export({ type: 'spki', format: 'pem' }).toString().trimEnd()}\n</RSAPUBK>\n` +
    '</AUTORIZACION>\n';
  return { xml, rsask: privada };
}
