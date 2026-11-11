// `sii certificacion enviar-rcof`: RCOF desde un sobre guardado, solo para períodos
// hasta julio de 2022 y solo por DTEUpload. Siempre contra el TransporteFalso.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relojFijo, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, type Proyecto } from '../../soporte/cli.ts';
import { hacia, proyectoEnvio, TOKEN, tokenDtews, upload } from './soporte-envio.ts';

const SOBRE = 'data/output/envio-set-boletas.xml';
const RCOF = join('data', 'output', 'rcof.xml');

/** Proyecto con un sobre armado por `enviar-set --solo-armar` en la fecha indicada. */
async function conSobre(instante = '2022-07-15T15:00:00Z'): Promise<Proyecto> {
  const p = proyectoEnvio();
  const r = await correr(p, ['certificacion', 'enviar-set', '--solo-armar'], {
    reloj: relojFijo(instante),
  });
  expect(r.codigo).toBe(CODIGOS.OK);
  return p;
}

function transporteSoap(host = 'maullin.sii.cl') {
  return new TransporteFalso({
    ...tokenDtews(host),
    [`${host}/cgi_dte/UPL/DTEUpload`]: upload('<STATUS>0</STATUS>\n<TRACKID>0222333444</TRACKID>'),
  });
}

describe('enviar-rcof', () => {
  it('arma el RCOF desde el sobre y lo envía por DTEUpload', async () => {
    const p = await conSobre();
    const transporte = transporteSoap();
    const r = await correr(p, ['certificacion', 'enviar-rcof', '--sobre', SOBRE], { transporte });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('RCOF del 2022-07-15 al 2022-07-15 (SecEnvio 1)');
    expect(r.stdout).toContain('Tipo 39, folios 1-2');
    expect(r.stdout).toContain('TrackID: 0222333444');
    expect(r.stdout).toContain('estado-envio --canal soap 0222333444');
    expect(r.stdout).not.toContain(TOKEN);

    expect(transporte.urls()).toEqual([
      'https://maullin.sii.cl/DTEWS/CrSeed.jws',
      'https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws',
      'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload',
    ]);
    const rcof = readFileSync(join(p.dir, RCOF));
    const subida = transporte.enviadas[2];
    expect(subida?.bytes?.includes(rcof)).toBe(true);
    expect(subida?.bytes?.toString('latin1')).toContain('filename="rcof.xml"');

    const xml = rcof.toString('latin1');
    expect(xml).toContain('<FchResol>2026-09-05</FchResol>');
    expect(xml).toContain('<FchInicio>2022-07-15</FchInicio>');
    expect(xml).toContain('<SecEnvio>1</SecEnvio>');
    // 19900 + 9900 + 17 × 120 = 31840.
    expect(xml).toContain('<MntTotal>31840</MntTotal>');
    expect(xml).toContain('<Inicial>1</Inicial>');
    expect(xml).toContain('<Final>2</Final>');
    expect(xml).toContain('URI="#RCOF"');
  });

  it('se niega para períodos desde el 2022-08-01 sin --aunque-no-obligatorio', async () => {
    const p = await conSobre('2026-11-07T13:00:00Z');
    const r = await correr(p, ['certificacion', 'enviar-rcof', '--sobre', SOBRE]);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.stderr).toContain('termina el 2026-11-07');
    expect(r.stderr).toContain('--aunque-no-obligatorio');
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(existsSync(join(p.dir, RCOF))).toBe(false);

    const transporte = transporteSoap();
    const r2 = await correr(
      p,
      ['certificacion', 'enviar-rcof', '--sobre', SOBRE, '--aunque-no-obligatorio'],
      { transporte },
    );
    expect(r2.codigo).toBe(CODIGOS.OK);
    expect(hacia(transporte.enviadas, 'DTEUpload')).toHaveLength(1);
  });

  it('--solo-armar guarda el RCOF sin red; --sec-envio y --fch-resol reemplazan al .env', async () => {
    const p = await conSobre();
    const r = await correr(p, [
      'certificacion',
      'enviar-rcof',
      '--sobre',
      SOBRE,
      '--solo-armar',
      '--sec-envio',
      '3',
      '--fch-resol',
      '2022-01-10',
      '--salida',
      'rcof',
    ]);
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    const xml = readFileSync(join(p.dir, 'rcof', 'rcof.xml'), 'latin1');
    expect(xml).toContain('<SecEnvio>3</SecEnvio>');
    expect(xml).toContain('<FchResol>2022-01-10</FchResol>');
  });

  it('producción: sin --confirmar arma y se detiene antes de pedir token', async () => {
    const p = await conSobre();
    p.escribirEnv({ SII_PRODUCCION_NRO_RESOL: '80', SII_PRODUCCION_FCH_RESOL: '2014-08-22' });
    const r = await correr(p, [
      'certificacion',
      'enviar-rcof',
      '--sobre',
      SOBRE,
      '--ambiente',
      'produccion',
    ]);
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('No se envió nada al SII');
    expect(r.transporte.enviadas).toHaveLength(0);
    const xml = readFileSync(join(p.dir, RCOF), 'latin1');
    expect(xml).toContain('<NroResol>80</NroResol>');
    expect(xml).toContain('<FchResol>2014-08-22</FchResol>');

    const transporte = transporteSoap('palena.sii.cl');
    const r2 = await correr(
      p,
      ['certificacion', 'enviar-rcof', '--sobre', SOBRE, '--ambiente', 'produccion', '--confirmar'],
      { transporte },
    );
    expect(r2.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls().every((u) => u.startsWith('https://palena.sii.cl/'))).toBe(true);
    expect(hacia(transporte.enviadas, 'DTEUpload')).toHaveLength(1);
  });

  it('producción sin su resolución en el .env: código 3 y nada sale', async () => {
    const p = await conSobre();
    const r = await correr(p, [
      'certificacion',
      'enviar-rcof',
      '--sobre',
      SOBRE,
      '--ambiente',
      'produccion',
      '--confirmar',
    ]);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_PRODUCCION_FCH_RESOL');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('errores de uso y de configuración no envían nada', async () => {
    const p = await conSobre();
    const casos: [string[], number][] = [
      [[], CODIGOS.USO],
      [['--sobre', SOBRE, '--ambiente', 'pruebas'], CODIGOS.USO],
      [['--sobre', SOBRE, '--sec-envio', '0'], CODIGOS.USO],
      [['--sobre', 'no-existe.xml'], CODIGOS.CONFIG],
      [['--sobre', 'data/set_pruebas/set.txt'], CODIGOS.CONFIG],
    ];
    for (const [args, codigo] of casos) {
      const r = await correr(p, ['certificacion', 'enviar-rcof', ...args]);
      expect(r.codigo, args.join(' ')).toBe(codigo);
      expect(r.transporte.enviadas).toHaveLength(0);
    }
  });

  it('un sobre de otra empresa es error de configuración', async () => {
    const p = await conSobre();
    p.escribirEnv({ SII_RUT_EMPRESA: '76543210-3' });
    const r = await correr(p, ['certificacion', 'enviar-rcof', '--sobre', SOBRE]);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('del emisor 76123456-0');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('el SII rechaza la subida: código 5', async () => {
    const p = await conSobre();
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      'maullin.sii.cl/cgi_dte/UPL/DTEUpload': upload('<STATUS>8</STATUS>'),
    });
    const r = await correr(p, ['certificacion', 'enviar-rcof', '--sobre', SOBRE], { transporte });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('STATUS 8');
  });
});
