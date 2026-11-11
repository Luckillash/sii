import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Certificado } from '../../src/core/certificado.ts';
import { casos, esperado, exigirIdentico, leerMaterial } from '../soporte/paridad.ts';

interface EntradaCertificado {
  archivo: string;
  clave: string;
  crlf?: boolean;
  /** El esperado no trae toPem() (ver paridad/php/operaciones/certificado.php). */
  sinPem?: boolean;
}

/** Lo que guarda paridad/php/operaciones/certificado.php. */
interface SalidaPhp {
  llave: string;
  certificado: string;
  cadena: string;
  pem?: string;
  info: { cn: string | null; not_before: string | null; not_after: string | null };
}

const lista = casos<EntradaCertificado>('certificado');

function cargar(entrada: EntradaCertificado): Certificado {
  let contenido = leerMaterial(entrada.archivo);
  if (entrada.crlf === true) {
    contenido = Buffer.from(
      contenido.toString('latin1').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
      'latin1',
    );
  }
  return Certificado.desdeContenido(contenido, entrada.clave);
}

describe('paridad: Certificate', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);
    const php = JSON.parse(bytes.toString('utf8')) as SalidaPhp;

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    it.each([
      ['llave', (c: Certificado) => c.llavePrivada],
      ['certificado', (c: Certificado) => c.certificado],
      ['cadena', (c: Certificado) => c.cadena],
      ['pem', (c: Certificado) => c.aPem()],
    ] as const)('%s: mismos bytes que el PHP', (campo, obtener) => {
      const delPhp = php[campo];
      if (delPhp === undefined) {
        expect(caso.entrada.sinPem).toBe(true);
        return;
      }
      exigirIdentico(
        Buffer.from(obtener(cargar(caso.entrada)), 'utf8'),
        Buffer.from(delPhp, 'utf8'),
        `${caso.nombre}.${campo}`,
      );
    });

    it('info: mismo CN y vigencia que getInfo()', () => {
      const info = cargar(caso.entrada).info();
      expect({
        cn: info.cn,
        not_before: info.vigenteDesde,
        not_after: info.vigenteHasta,
      }).toEqual(php.info);
    });

    it('verificación cruzada: la llave del PHP firma y el certificado de Node verifica', () => {
      const datos = Buffer.from('paridad');
      const firma = sign('sha1', datos, createPrivateKey(php.llave));
      expect(verify('sha1', datos, createPublicKey(cargar(caso.entrada).certificado), firma)).toBe(
        true,
      );
    });
  });
});
