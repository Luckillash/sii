// `sii produccion autorizacion [rut]`: login de producción + ad_empresa (solo lectura).
// Páginas de paridad/autorizacion/paginas (grabadas en palena, datos de prueba).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { LOGIN_OK, LOGIN_RECHAZADO } from '../certificacion/portal/sii-falso.ts';
import { CLAVE_PFX, correr, proyecto } from '../soporte/cli.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../paridad');
const pagina = (nombre: string): Buffer =>
  Buffer.from(
    readFileSync(join(PARIDAD, 'autorizacion/paginas', `${nombre}.html`), 'utf8'),
    'latin1',
  );

function sii(ad2: Buffer | RespuestaHttp, login = LOGIN_OK): TransporteFalso {
  return new TransporteFalso([
    ['herculesr.sii.cl/*', Buffer.from(login, 'latin1')],
    ['palena.sii.cl/cvc_cgi/dte/ad_empresa1', pagina('ad-empresa1')],
    ['palena.sii.cl/cvc_cgi/dte/ad_empresa2', ad2],
  ]);
}

const resumen = (t: TransporteFalso) =>
  t.enviadas.map((p) => `${p.metodo} ${new URL(p.url).hostname}${new URL(p.url).pathname}`);

describe('produccion autorizacion', () => {
  it('autorizada: muestra la resolución y las variables del .env', async () => {
    const t = sii(pagina('ad-empresa2-autorizada'));
    const r = await correr(proyecto(), ['produccion', 'autorizacion'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t)).toEqual([
      'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      'GET palena.sii.cl/cvc_cgi/dte/ad_empresa1',
      'POST palena.sii.cl/cvc_cgi/dte/ad_empresa2',
    ]);
    expect(t.enviadas[0]?.url).toContain('?https://palena.sii.cl/');
    expect(r.stdout).toContain('Empresa:     76123456-0 (EMPRESA DE PRUEBA SPA)');
    expect(r.stdout).toContain('Autorizada en producción desde 2026-11-06.');
    expect(r.stdout).toContain('Resolución:  n.º 80 del 2014-08-22');
    expect(r.stdout).toContain('SII_PRODUCCION_NRO_RESOL=80 y SII_PRODUCCION_FCH_RESOL=2014-08-22');
    // Nada de los datos de contacto de la página.
    expect(r.stdout).not.toMatch(/example|Software de prueba/);
  });

  it('--json y rut del argumento', async () => {
    const t = sii(pagina('ad-empresa2-sin-representacion'));
    const r = await correr(proyecto(), ['produccion', 'autorizacion', '11.111.111-1', '--json'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(JSON.parse(r.stdout)).toEqual({ tipo: 'sin_representacion' });
  });

  it('no autorizada: lo dice', async () => {
    const r = await correr(proyecto(), ['produccion', 'autorizacion'], {
      transporte: sii(pagina('ad-empresa2-no-autorizada')),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('NO está autorizada');
  });

  it('página de otro RUT o desconocida: código 7', async () => {
    const otro = await correr(proyecto(), ['produccion', 'autorizacion', '11111111-1'], {
      transporte: sii(pagina('ad-empresa2-autorizada')),
    });
    expect(otro.codigo).toBe(CODIGOS.VERIFICACION);
    expect(otro.stderr).toContain('ErrorVerificacion');
    expect(otro.stderr).not.toContain('EMPRESA DE PRUEBA');

    const rara = await correr(proyecto(), ['produccion', 'autorizacion'], {
      transporte: sii(Buffer.from('<html><body>Mantención</body></html>')),
    });
    expect(rara.codigo).toBe(CODIGOS.VERIFICACION);
  });

  it('rut inválido: código 3 sin peticiones; login rechazado: código 5; HTTP 502: código 4', async () => {
    const malo = await correr(proyecto(), ['produccion', 'autorizacion', '76123456-1']);
    expect(malo.codigo).toBe(CODIGOS.CONFIG);
    expect(malo.transporte.enviadas).toHaveLength(0);

    const rechazado = await correr(proyecto(), ['produccion', 'autorizacion'], {
      transporte: sii(pagina('ad-empresa2-autorizada'), LOGIN_RECHAZADO),
    });
    expect(rechazado.codigo).toBe(CODIGOS.SII);

    const http = await correr(proyecto(), ['produccion', 'autorizacion'], {
      transporte: sii(new RespuestaHttp(502)),
    });
    expect(http.codigo).toBe(CODIGOS.TRANSPORTE);
    for (const r of [malo, rechazado, http]) {
      expect(`${r.stdout}${r.stderr}`).not.toContain('TOKENDEPRUEBA');
      expect(`${r.stdout}${r.stderr}`).not.toContain(CLAVE_PFX);
    }
  });
});
