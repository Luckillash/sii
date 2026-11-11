import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifrado de tokens del SII y cookies AUT2000 (PLAN-SAAS §4.4).
//
// Formato: iv (12 bytes) || ciphertext || tag (16 bytes), AES-256-GCM, que es lo
// que esperan las columnas `tokens_sii.token_cifrado` y `sesiones_sii.cookies_cifradas`.
// La llave vive en la variable SII_TOKENS_KEY (32 bytes en base64), nunca en la base.
//
// `contexto` va como datos autenticados (AAD): ata el texto cifrado a su fila, así
// que un token copiado a otra empresa o ambiente no descifra.

const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_LLAVE = 32;

export class ErrorCifrado extends Error {
  override name = 'ErrorCifrado';
}

/** Lee la llave en base64 y exige 32 bytes. No incluye la llave en los mensajes. */
export function leerLlave(base64: string | undefined): Buffer {
  if (!base64) {
    throw new ErrorCifrado('Falta SII_TOKENS_KEY (32 bytes en base64).');
  }
  const llave = Buffer.from(base64, 'base64');
  if (llave.length !== LARGO_LLAVE) {
    throw new ErrorCifrado(
      `SII_TOKENS_KEY debe tener ${LARGO_LLAVE} bytes en base64 (tiene ${llave.length}).`,
    );
  }
  return llave;
}

export function cifrar(texto: string | Uint8Array, llave: Buffer, contexto = ''): Buffer {
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv('aes-256-gcm', llave, iv, { authTagLength: LARGO_TAG });
  cifrador.setAAD(Buffer.from(contexto, 'utf8'));
  const datos = typeof texto === 'string' ? Buffer.from(texto, 'utf8') : texto;
  const cuerpo = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  return Buffer.concat([iv, cuerpo, cifrador.getAuthTag()]);
}

export function descifrar(cifrado: Uint8Array, llave: Buffer, contexto = ''): Buffer {
  const datos = Buffer.from(cifrado);
  if (datos.length < LARGO_IV + LARGO_TAG) {
    throw new ErrorCifrado('El texto cifrado es demasiado corto.');
  }
  const iv = datos.subarray(0, LARGO_IV);
  const tag = datos.subarray(datos.length - LARGO_TAG);
  const cuerpo = datos.subarray(LARGO_IV, datos.length - LARGO_TAG);
  const descifrador = createDecipheriv('aes-256-gcm', llave, iv, { authTagLength: LARGO_TAG });
  descifrador.setAAD(Buffer.from(contexto, 'utf8'));
  descifrador.setAuthTag(tag);
  try {
    return Buffer.concat([descifrador.update(cuerpo), descifrador.final()]);
  } catch (error) {
    throw new ErrorCifrado('No se pudo descifrar: llave, contexto o datos no coinciden.', {
      cause: error,
    });
  }
}

/** `bytea` para PostgREST: texto hexadecimal con prefijo `\x`. */
export function aBytea(datos: Uint8Array): string {
  return `\\x${Buffer.from(datos).toString('hex')}`;
}

/** Lee un `bytea` que devolvió PostgREST (`\x...`). */
export function desdeBytea(valor: string): Buffer {
  if (!valor.startsWith('\\x')) {
    throw new ErrorCifrado('Valor bytea con formato inesperado (se esperaba \\x...).');
  }
  return Buffer.from(valor.slice(2), 'hex');
}
