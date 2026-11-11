import { createHash, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { c14n } from '../../src/comun/c14n.ts';
import { parsearXml } from '../../src/comun/xml.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import { casos, esperado, exigirIdentico, material } from '../soporte/paridad.ts';

const lista = casos<{ semilla: string }>('firmarSemilla');

function extraer(xml: string, etiqueta: string): string {
  const m = new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`).exec(xml);
  if (m?.[1] === undefined) throw new Error(`No se encontró <${etiqueta}>`);
  return m[1];
}

describe('paridad: firmarSemilla', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { llave, certificado } = material(caso.material ?? 'base');
    const { bytes, meta } = esperado(caso.nombre);

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    it('Node produce los mismos bytes que el PHP', () => {
      const obtenido = new FirmaElectronica(llave, certificado).firmarSemilla(caso.entrada.semilla);
      exigirIdentico(Buffer.from(obtenido, 'utf8'), bytes, caso.nombre);
    });

    it('verificación cruzada: Node verifica la firma del PHP', () => {
      const xml = bytes.toString('utf8');
      const signedInfo = /<SignedInfo[\s\S]*?<\/SignedInfo>/.exec(xml)?.[0];
      if (signedInfo === undefined) throw new Error('No se encontró <SignedInfo>');

      const firma = Buffer.from(extraer(xml, 'SignatureValue'), 'base64');
      const canonico = Buffer.from(c14n(parsearXml(signedInfo)), 'utf8');
      expect(verify('sha1', canonico, createPublicKey(certificado), firma)).toBe(true);
    });
  });
});
