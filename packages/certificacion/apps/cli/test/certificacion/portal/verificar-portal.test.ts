// `sii certificacion verificar-portal`: GET público, sin login ni certificado.

import { ErrorTransporte, RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import { PORTAL_VIGENTE, resumen, siiFalso } from './sii-falso.ts';

const CACHE = 'www4.sii.cl/certBolElectDteInternet/0FC3D987613537E6E13E9BB93A406F13.cache.html';

describe('certificacion verificar-portal', () => {
  it('portal vigente: un solo GET público, sin cookies, código 0', async () => {
    const t = siiFalso({ rutas: { [CACHE]: PORTAL_VIGENTE } });
    const r = await correr(proyecto(), ['certificacion', 'verificar-portal'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Portal vigente');
    expect(resumen(t.enviadas)).toEqual([`GET ${CACHE}`]);
    expect(t.enviadas[0]?.cabeceras.Cookie).toBeUndefined();
    expect(t.enviadas[0]?.tls).toBe(false);
  });

  it('no lee el .env ni el certificado', async () => {
    const p = proyecto();
    p.escribirEnv({ SII_CERT_PATH: 'no-existe.pfx', SII_RUT_EMPRESA: 'malo' });
    const t = siiFalso({ rutas: { [CACHE]: PORTAL_VIGENTE } });
    const r = await correr(p, ['certificacion', 'verificar-portal', '--env', 'no-existe.env'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
  });

  it('portal cambiado: código 5 con lo que falta', async () => {
    const cuerpo = PORTAL_VIGENTE.replace("'ingresarTrackId'", '');
    const t = siiFalso({ rutas: { [CACHE]: cuerpo } });
    const r = await correr(proyecto(), ['certificacion', 'verificar-portal'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('falta método ingresarTrackId');
    expect(r.stderr).toContain('actualizar la librería');
  });

  it('404 (otra versión publicada): código 5', async () => {
    const r = await correr(proyecto(), ['certificacion', 'verificar-portal'], {
      transporte: siiFalso(),
    });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('publicó otra versión');
  });

  it('HTTP inesperado o red caída: código 4', async () => {
    const t500 = siiFalso({ rutas: { [CACHE]: new RespuestaHttp(500) } });
    expect(
      (await correr(proyecto(), ['certificacion', 'verificar-portal'], { transporte: t500 }))
        .codigo,
    ).toBe(CODIGOS.TRANSPORTE);
    const red = siiFalso({
      rutas: {
        [CACHE]: () => {
          throw new ErrorTransporte('Se agotó el tiempo de espera.', `https://${CACHE}`);
        },
      },
    });
    expect(
      (await correr(proyecto(), ['certificacion', 'verificar-portal'], { transporte: red })).codigo,
    ).toBe(CODIGOS.TRANSPORTE);
  });

  it('no recibe argumentos', async () => {
    const r = await correr(proyecto(), ['certificacion', 'verificar-portal', 'x']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.transporte.enviadas).toHaveLength(0);
  });
});
