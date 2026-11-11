// Port de tests/Core/CertificateTest.php (winex/certificacion v1.9.1) y casos
// nuevos: errores tipados, cifrados del .pfx, cadenas y tamaños de llave.
// Los tests de `comandoPkcs12` no se portan: Node no invoca el binario openssl.

import { createPrivateKey, createPublicKey, sign, verify, X509Certificate } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCertificado, SiiError } from '../../../src/comun/errores.ts';
import { fechaHoraSii } from '../../../src/comun/reloj.ts';
import { Certificado } from '../../../src/core/certificado.ts';
import * as cripto from '../../soporte/criptografia.ts';
import { leerMaterial } from '../../soporte/paridad.ts';

const CLAVE = 'clave-de-prueba';

function exigirError(accion: () => unknown, mensaje?: RegExp): ErrorCertificado {
  try {
    accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorCertificado);
    expect(error).toBeInstanceOf(SiiError);
    const e = error as ErrorCertificado;
    if (mensaje !== undefined) expect(e.message).toMatch(mensaje);
    expect(e.message).not.toContain('BEGIN');
    expect(e.message).not.toContain(CLAVE);
    return e;
  }
  throw new Error('Se esperaba un ErrorCertificado');
}

function correspondenLlaveYCertificado(c: Certificado): boolean {
  const datos = Buffer.from('prueba');
  const firma = sign('sha256', datos, c.llavePrivada);
  return verify('sha256', datos, createPublicKey(c.certificado), firma);
}

describe('Certificado', () => {
  const titular = cripto.certificado();
  const pfx = cripto.pfx(titular, CLAVE);

  describe('carga de un .pfx', () => {
    it('desde sus bytes', () => {
      const c = Certificado.desdeContenido(pfx, CLAVE);
      expect(c.llavePrivada).toContain('PRIVATE KEY');
      expect(c.certificado).toContain('BEGIN CERTIFICATE');
    });

    it('la llave cargada es la del certificado', () => {
      const c = Certificado.desdeContenido(pfx, CLAVE);
      expect(
        new X509Certificate(c.certificado).checkPrivateKey(createPrivateKey(c.llavePrivada)),
      ).toBe(true);
      expect(correspondenLlaveYCertificado(c)).toBe(true);
    });

    it('acepta un Uint8Array además de un Buffer', () => {
      const c = Certificado.desdeContenido(new Uint8Array(pfx), CLAVE);
      expect(c.certificado).toBe(titular.pem);
    });

    it('entrega la llave en PKCS#8 sin cifrar y el certificado con sus bytes originales', () => {
      const c = Certificado.desdeContenido(pfx, CLAVE);
      expect(c.llavePrivada).toBe(titular.llave.pem);
      expect(c.certificado).toBe(titular.pem);
    });

    it.each(['aes128', 'aes192', 'aes256', '3des'] as const)(
      'con la llave cifrada en %s',
      (algoritmo) => {
        const c = Certificado.desdeContenido(cripto.pfx(titular, CLAVE, { algoritmo }), CLAVE);
        expect(correspondenLlaveYCertificado(c)).toBe(true);
      },
    );

    it('lee un .pfx legacy (RC2-40) sin el binario openssl', () => {
      const c = Certificado.desdeContenido(leerMaterial('cert-legacy.pfx'), CLAVE);
      expect(correspondenLlaveYCertificado(c)).toBe(true);
      expect(c.info().cn).toBe('Titular de Prueba Ñuñoa');
    });

    it.each([1024, 2048, 4096])(
      'con una llave RSA de %i bits',
      (bits) => {
        const propio = cripto.certificado({ llave: cripto.llave(bits) });
        const c = Certificado.desdeContenido(cripto.pfx(propio, CLAVE), CLAVE);
        expect(createPublicKey(c.certificado).asymmetricKeyDetails?.modulusLength).toBe(bits);
        expect(correspondenLlaveYCertificado(c)).toBe(true);
      },
      30_000,
    );
  });

  describe('desde un archivo', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'certificado-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('lee el .pfx', async () => {
      const ruta = join(dir, 'prueba.pfx');
      await writeFile(ruta, pfx);
      const c = await Certificado.desdeArchivo(ruta, CLAVE);
      expect(c.certificado).toContain('BEGIN CERTIFICATE');
    });

    it('archivo inexistente: el mensaje no incluye la ruta (puede llevar el RUT)', async () => {
      const ruta = join(dir, '76123456-0.pfx');
      const error = await Certificado.desdeArchivo(ruta, 'x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorCertificado);
      expect((error as Error).message).toMatch(/no existe/);
      expect((error as Error).message).not.toContain('76123456');
    });
  });

  describe('carga de un PEM', () => {
    const pem = titular.llave.pem + titular.pem;

    it('con la llave y el certificado', () => {
      const c = Certificado.desdeContenido(pem);
      expect(correspondenLlaveYCertificado(c)).toBe(true);
    });

    it('acepta el PEM como string o como bytes', () => {
      expect(Certificado.desdeContenido(Buffer.from(pem)).aPem()).toBe(
        Certificado.desdeContenido(pem).aPem(),
      );
    });

    it('un PEM con saltos de línea de Windows queda idéntico', () => {
      const unix = Certificado.desdeContenido(pem);
      const windows = Certificado.desdeContenido(pem.replaceAll('\n', '\r\n'));
      expect(windows.certificado).toBe(unix.certificado);
      expect(windows.llavePrivada).toBe(unix.llavePrivada);
      expect(windows.aPem()).not.toContain('\r');
    });

    it('con la llave en PKCS#1 la entrega en PKCS#8', () => {
      const pkcs1 = titular.llave.objeto.export({ type: 'pkcs1', format: 'pem' }).toString();
      const c = Certificado.desdeContenido(pkcs1 + titular.pem);
      expect(c.llavePrivada).toBe(titular.llave.pem);
    });

    it('con la llave cifrada y su passphrase', () => {
      const cifrada = titular.llave.objeto
        .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: CLAVE })
        .toString();
      const c = Certificado.desdeContenido(cifrada + titular.pem, CLAVE);
      expect(c.llavePrivada).toBe(titular.llave.pem);
    });

    it('con la llave cifrada sin passphrase o con una incorrecta', () => {
      const cifrada = titular.llave.objeto
        .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: CLAVE })
        .toString();
      exigirError(() => Certificado.desdeContenido(cifrada + titular.pem), /passphrase/);
      exigirError(() => Certificado.desdeContenido(cifrada + titular.pem, 'otra'), /passphrase/);
    });

    it('sin llave privada', () => {
      exigirError(() => Certificado.desdeContenido(titular.pem), /llave privada/);
    });

    it('sin certificado', () => {
      exigirError(() => Certificado.desdeContenido(titular.llave.pem), /CERTIFICATE/);
    });

    it('la hoja es el primer certificado, aunque venga antes de la llave', () => {
      const { raiz, intermedia, hoja } = cripto.cadena();
      const c = Certificado.desdeContenido(hoja.pem + hoja.llave.pem + intermedia.pem + raiz.pem);
      expect(c.certificado).toBe(hoja.pem.trimEnd());
      expect(c.cadena).toBe(
        `${[hoja.pem, intermedia.pem, raiz.pem].map((p) => p.trimEnd()).join('\n')}\n`,
      );
    });
  });

  describe('aPem', () => {
    it('se puede volver a cargar', () => {
      const original = Certificado.desdeContenido(pfx, CLAVE);
      const recargado = Certificado.desdeContenido(original.aPem());
      expect(recargado.certificado.trim()).toBe(original.certificado.trim());
      expect(correspondenLlaveYCertificado(recargado)).toBe(true);
    });

    it('pone la llave primero y luego el certificado', () => {
      const pem = Certificado.desdeContenido(pfx, CLAVE).aPem();
      expect(pem.indexOf('PRIVATE KEY')).toBeLessThan(pem.indexOf('BEGIN CERTIFICATE'));
    });

    it('no repite certificados', () => {
      const { raiz, intermedia, hoja } = cripto.cadena();
      const pem = hoja.llave.pem + hoja.pem + intermedia.pem + intermedia.pem + raiz.pem;
      const bloques = Certificado.desdeContenido(pem)
        .aPem()
        .match(/BEGIN CERTIFICATE/g);
      expect(bloques).toHaveLength(3);
    });

    it('.pfx legacy con cadena: LF y sin repetir la hoja (el PHP en Windows la repetía)', () => {
      const c = Certificado.desdeContenido(leerMaterial('cert-legacy-cadena.pfx'), CLAVE);
      const pem = c.aPem();
      expect(pem).not.toContain('\r');
      expect(pem.match(/BEGIN CERTIFICATE/g)).toHaveLength(3);
      expect(pem.indexOf(c.certificado)).toBeGreaterThan(pem.indexOf('PRIVATE KEY'));
    });
  });

  describe('cadena', () => {
    it('sin intermedios es la propia hoja', () => {
      const c = Certificado.desdeContenido(pfx, CLAVE);
      expect(c.cadena).toBe(c.certificado);
    });

    it('.pfx legacy: hoja e intermedios en el orden del .pfx', () => {
      const c = Certificado.desdeContenido(leerMaterial('cert-legacy-cadena.pfx'), CLAVE);
      const cns = (
        c.cadena.match(/-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----/gs) ?? []
      ).map((b) => new X509Certificate(b).subject.split('\n')[0]);
      expect(cns).toEqual([
        'CN=Titular de Prueba Ñuñoa',
        'CN=CA Intermedia de Prueba',
        'CN=CA Raiz de Prueba',
      ]);
    });

    it('.pfx moderno: los intermedios quedan en orden inverso, igual que openssl_pkcs12_read', () => {
      const { raiz, intermedia, hoja } = cripto.cadena();
      const c = Certificado.desdeContenido(
        cripto.pfx(hoja, CLAVE, { intermedios: [intermedia, raiz] }),
        CLAVE,
      );
      expect(c.cadena).toBe(`${hoja.pem}${raiz.pem.trim()}\n${intermedia.pem.trim()}\n`);
    });

    it('sirve para el TLS mutuo', () => {
      const { raiz, intermedia, hoja } = cripto.cadena();
      const c = Certificado.desdeContenido(
        cripto.pfx(hoja, CLAVE, { intermedios: [intermedia, raiz] }),
        CLAVE,
      );
      const identidad = c.identidadTls();
      expect(identidad).toEqual({ cert: c.cadena, key: c.llavePrivada });
      expect(() => createSecureContext(identidad)).not.toThrow();
    });
  });

  describe('info', () => {
    it('entrega CN y vigencia en hora de Chile', () => {
      const info = Certificado.desdeContenido(pfx, CLAVE).info();
      expect(info.cn).toBe('Titular de Prueba');
      expect(info.vigenteDesde).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect((info.vigenteHasta ?? '') > (info.vigenteDesde ?? '')).toBe(true);
      const desde = titular.forge.validity.notBefore;
      desde.setMilliseconds(0);
      expect(info.vigenteDesde).toBe(fechaHoraSii(desde).replace('T', ' '));
    });

    it('decodifica un CN con tildes', () => {
      const propio = cripto.certificado({ cn: 'Ñandú Pérez' });
      expect(Certificado.desdeContenido(propio.llave.pem + propio.pem).info().cn).toBe(
        'Ñandú Pérez',
      );
    });
  });

  describe('errores', () => {
    it('contraseña incorrecta', () => {
      const e = exigirError(() => Certificado.desdeContenido(pfx, 'otra'), /contraseña/);
      expect(e.cause).toBeDefined();
    });

    it('la contraseña nunca aparece en el mensaje', () => {
      exigirError(() => Certificado.desdeContenido(pfx, `${CLAVE}x`));
    });

    it('.pfx corrupto o truncado', () => {
      exigirError(() => Certificado.desdeContenido(Buffer.from('no es un pfx'), CLAVE), /dañado/);
      exigirError(() => Certificado.desdeContenido(pfx.subarray(0, pfx.length / 2), CLAVE));
    });

    it('un string que no es PEM', () => {
      exigirError(() => Certificado.desdeContenido('MIIK...', CLAVE), /Buffer/);
    });
  });

  describe('sinMaterialPem', () => {
    it('oculta llaves y certificados', () => {
      const salida =
        'Error al leer\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\nfin';
      const limpia = Certificado.sinMaterialPem(salida);
      expect(limpia).not.toContain('MIIEvQ');
      expect(limpia).toContain('[PEM omitido]');
      expect(limpia).toContain('Error al leer');
      expect(limpia).toContain('fin');
    });

    it('oculta un bloque cortado', () => {
      const limpia = Certificado.sinMaterialPem(
        'x\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      );
      expect(limpia).not.toContain('MIIEvQ');
    });

    it('quita los atributos de bolsa y las líneas base64 sueltas', () => {
      const salida = [
        'Bag Attributes',
        '    localKeyID: 01 02 03',
        '    friendlyName: Titular',
        'Key Attributes: <No Attributes>',
        'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ',
        'Mac verify error: invalid password?',
      ].join('\r\n');
      expect(Certificado.sinMaterialPem(salida)).toBe('Mac verify error: invalid password?');
    });
  });
});
