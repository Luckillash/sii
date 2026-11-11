import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aBytea, cifrar, descifrar, desdeBytea, ErrorCifrado, leerLlave } from './cifrado';

const llave = randomBytes(32);

describe('cifrar / descifrar', () => {
  it('ida y vuelta con contexto', () => {
    const cifrado = cifrar('TOKEN-DE-PRUEBA', llave, 'rest|certificacion|76543210-3');
    expect(cifrado.length).toBe(12 + 'TOKEN-DE-PRUEBA'.length + 16);
    expect(cifrado.toString('utf8')).not.toContain('TOKEN-DE-PRUEBA');
    expect(descifrar(cifrado, llave, 'rest|certificacion|76543210-3').toString('utf8')).toBe(
      'TOKEN-DE-PRUEBA',
    );
  });

  it('usa un iv distinto en cada cifrado', () => {
    expect(cifrar('x', llave).equals(cifrar('x', llave))).toBe(false);
  });

  it('falla con otro contexto, otra llave o datos alterados', () => {
    const cifrado = cifrar('TOKEN', llave, 'a');
    expect(() => descifrar(cifrado, llave, 'b')).toThrow(ErrorCifrado);
    expect(() => descifrar(cifrado, randomBytes(32), 'a')).toThrow(ErrorCifrado);
    const alterado = Buffer.from(cifrado);
    alterado[14] = (alterado[14] ?? 0) ^ 0xff;
    expect(() => descifrar(alterado, llave, 'a')).toThrow(ErrorCifrado);
    expect(() => descifrar(Buffer.alloc(10), llave)).toThrow(ErrorCifrado);
  });
});

describe('leerLlave', () => {
  it('exige 32 bytes y no muestra la llave en el error', () => {
    expect(leerLlave(llave.toString('base64')).equals(llave)).toBe(true);
    expect(() => leerLlave(undefined)).toThrow(/SII_TOKENS_KEY/);
    const corta = randomBytes(16).toString('base64');
    try {
      leerLlave(corta);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(corta);
    }
  });
});

describe('bytea', () => {
  it('codifica en hex con prefijo \\x', () => {
    const datos = Buffer.from([0, 1, 254, 255]);
    expect(aBytea(datos)).toBe('\\x0001feff');
    expect(desdeBytea(aBytea(datos)).equals(datos)).toBe(true);
    expect(() => desdeBytea('0001')).toThrow(ErrorCifrado);
  });
});
