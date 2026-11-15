// `sii util situacion-tributaria <rut>`: consulta pública, sin .env ni certificado.
// Respuestas de paridad/autorizacion/stc (grabadas en www2.sii.cl, nombre de prueba).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransporteFalso } from '@winex/certificacion';
import { afterEach, describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { correr } from '../soporte/cli.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../paridad');
const stc = (nombre: string): string =>
  readFileSync(join(PARIDAD, 'autorizacion/stc', `${nombre}.json`), 'utf8');

function sii(consulta: string, clave = stc('recaptcha-apagado')): TransporteFalso {
  return new TransporteFalso([
    ['www2.sii.cl/app/stc/recurso/v1/recaptcha/key', clave],
    ['www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/', consulta],
  ]);
}

// Carpeta sin .env: el comando no lo necesita.
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});
function vacia(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sii-cli-stc-'));
  carpetas.push(dir);
  return { dir };
}

describe('util situacion-tributaria', () => {
  it('con boleta electrónica: la lista y lo dice', async () => {
    const r = await correr(vacia(), ['util', 'situacion-tributaria', '76.123.456-0'], {
      transporte: sii(stc('consulta-boleta')),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Contribuyente: 76123456-0');
    expect(r.stdout).toContain(' 39 boleta electrónica: último timbraje 2026, último folio 5');
    expect(r.stdout).toContain('Boleta electrónica: SÍ (último timbraje 2026)');
    expect(r.stdout).not.toContain('EMPRESA DE PRUEBA');
  });

  it('solo facturas: no prueba nada de boletas', async () => {
    const r = await correr(vacia(), ['util', 'situacion-tributaria', '76123456-0'], {
      transporte: sii(stc('consulta-factura')),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain(
      ' 33 factura electrónica: último timbraje 2026, último folio 1171827',
    );
    expect(r.stdout).toContain('sin timbrajes de 39 ni 41 (no prueba que no esté autorizada)');
  });

  it('--json', async () => {
    const r = await correr(vacia(), ['util', 'situacion-tributaria', '76123456-0', '--json'], {
      transporte: sii(stc('consulta-sin-timbrajes')),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(JSON.parse(r.stdout)).toEqual({ tipo: 'ok', timbrajes: [] });
  });

  it('captcha activo: código 5 y una sola petición', async () => {
    const r = await correr(vacia(), ['util', 'situacion-tributaria', '76123456-0'], {
      transporte: sii(stc('consulta-boleta'), stc('recaptcha-encendido')),
    });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('captcha');
    expect(r.transporte.enviadas).toHaveLength(1);
  });

  it('forma desconocida: código 7; RUT inválido: código 2 sin peticiones', async () => {
    const rara = await correr(vacia(), ['util', 'situacion-tributaria', '76123456-0'], {
      transporte: sii('{"captchaInvalido":false}'),
    });
    expect(rara.codigo).toBe(CODIGOS.VERIFICACION);

    const malo = await correr(vacia(), ['util', 'situacion-tributaria', '76123456-1']);
    expect(malo.codigo).toBe(CODIGOS.USO);
    expect(malo.transporte.enviadas).toHaveLength(0);
  });
});
