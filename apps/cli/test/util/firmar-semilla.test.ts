// `sii util firmar-semilla`: sin red.

import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { CLAVE_PFX, correr, proyecto } from '../soporte/cli.ts';

describe('sii util firmar-semilla', () => {
  it('imprime el getToken firmado entre las marcas, sin peticiones', async () => {
    const r = await correr(proyecto(), ['util', 'firmar-semilla', ' 012345678901 ']);
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    const lineas = r.stdout.split('\n');
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toBe('===== COPIA DESDE AQUI =====');
    expect(lineas[2]).toBe('===== HASTA AQUI =====');
    const xml = lineas[1] ?? '';
    expect(
      xml.startsWith('<?xml version="1.0"?><getToken><item><Semilla>012345678901</Semilla>'),
    ).toBe(true);
    expect(xml).toContain('<SignatureValue>');
    expect(xml).toContain('<X509Certificate>');
    expect(xml).not.toContain('PRIVATE KEY');
    expect(r.stdout).not.toContain(CLAVE_PFX);
  });

  it('una semilla no numérica es error de uso', async () => {
    const r = await correr(proyecto(), ['util', 'firmar-semilla', '12<34']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect((await correr(proyecto(), ['util', 'firmar-semilla'])).codigo).toBe(CODIGOS.USO);
  });

  it('sin certificado es error de configuración', async () => {
    const p = proyecto();
    p.escribirEnv({ SII_CERT_PATH: 'no-existe.pfx' });
    const r = await correr(p, ['util', 'firmar-semilla', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_CERT_PATH');
  });
});
