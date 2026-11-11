// `sii certificacion enviar-set`: armado del set, revisión del CAF y envío por
// DTEUpload o REST, siempre contra el TransporteFalso.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { CLAVE_PFX, correr } from '../../soporte/cli.ts';
import {
  ENVIO_CERT,
  hacia,
  proyectoEnvio,
  TOKEN,
  tokenDtews,
  tokenRest,
  upload,
} from './soporte-envio.ts';

const SOBRE = join('data', 'output', 'envio-set-boletas.xml');

function transporteSoap(
  respuestaUpload: string | RespuestaHttp = upload(
    '<STATUS>0</STATUS>\n<TRACKID>0123456789</TRACKID>',
  ),
) {
  return new TransporteFalso({
    ...tokenDtews(),
    'maullin.sii.cl/cgi_dte/UPL/DTEUpload': respuestaUpload,
  });
}

describe('enviar-set', () => {
  it('arma, guarda y envía por DTEUpload (por defecto)', async () => {
    const p = proyectoEnvio();
    const transporte = transporteSoap();
    const r = await correr(p, ['certificacion', 'enviar-set'], { transporte });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('CASO-1:');
    expect(r.stdout).toContain('Cambio de aceite | cantidad=1 | precio=19900');
    expect(r.stdout).toContain('Papel de regalo | cantidad=17 | precio=120');
    expect(r.stdout).toContain('CASO-1 -> folio 1');
    expect(r.stdout).toContain('CASO-2 -> folio 2');
    expect(r.stdout).toContain('TrackID: 0123456789');
    expect(r.stdout).toContain('sii certificacion estado-envio 0123456789');
    expect(r.stdout).toContain('SII_FOLIO_INICIAL=3');

    expect(transporte.urls()).toEqual([
      'https://maullin.sii.cl/DTEWS/CrSeed.jws',
      'https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws',
      'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload',
    ]);
    const subida = transporte.enviadas[2];
    expect(subida?.metodo).toBe('POST');
    expect(subida?.cabeceras.Cookie).toBe(`TOKEN=${TOKEN}`);
    expect(subida?.conexionNueva).toBe(true);
    const sobre = readFileSync(join(p.dir, SOBRE));
    expect(subida?.bytes?.includes(sobre)).toBe(true);
    expect(subida?.bytes?.toString('latin1')).toContain('filename="envio_set_boletas.xml"');

    // Sobre ISO-8859-1 con los dos casos y la resolución del .env.
    const xml = sobre.toString('latin1');
    expect(xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    expect(xml).toContain('<FchResol>2026-09-05</FchResol>');
    expect(xml).toContain('<NroDTE>2</NroDTE>');
    expect(xml).toContain('<RazonRef>CASO-2</RazonRef>');

    // Nunca el token ni la clave del .pfx.
    for (const salida of [r.stdout, r.stderr]) {
      expect(salida).not.toContain(TOKEN);
      expect(salida).not.toContain(CLAVE_PFX);
    }
  });

  it('las opciones reemplazan al .env (--caf, --folio-inicial, --set, --fch-resol, --salida)', async () => {
    const p = proyectoEnvio({ caf: { desde: 50, hasta: 60 } });
    p.escribir('otro/caf.xml', p.caf);
    p.escribir(
      'otro/set.txt',
      [
        'CASO-7',
        '======',
        'Item\t\tCantidad\t\tPrecio Unitario',
        'Arroz\t\t2\t\t1000',
        'Bebida\t\t1\t\t500',
        '',
        'OBSERVACION: "El item 2 es exento. Unidad de medida en Kg"',
        '',
      ].join('\n'),
    );
    p.escribirEnv({ SII_CAF_39: 'no-existe.xml', SII_SET_PRUEBAS: 'no-existe.txt' });
    const transporte = transporteSoap();
    const r = await correr(
      p,
      [
        'certificacion',
        'enviar-set',
        '--caf',
        'otro/caf.xml',
        '--folio-inicial',
        '55',
        '--set',
        'otro/set.txt',
        '--fch-resol',
        '2026-10-01',
        '--salida',
        'salida',
        '--solo-armar',
      ],
      { transporte },
    );

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Bebida | cantidad=1 | precio=500 [exento');
    expect(r.stdout).toContain('unidad=Kg');
    expect(r.stdout).toContain('CASO-7 -> folio 55');
    const xml = readFileSync(join(p.dir, 'salida', 'envio-set-boletas.xml'), 'latin1');
    expect(xml).toContain('<Folio>55</Folio>');
    expect(xml).toContain('<FchResol>2026-10-01</FchResol>');
  });

  it('--solo-armar guarda el sobre sin pedir token ni enviar nada', async () => {
    const p = proyectoEnvio();
    const r = await correr(p, ['certificacion', 'enviar-set', '--solo-armar']);

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(existsSync(join(p.dir, SOBRE))).toBe(true);
    expect(r.stdout).toContain('No se envió nada al SII');
    expect(r.stdout).not.toContain('TrackID');
  });

  it('--canal rest sube el sobre a pangal', async () => {
    const p = proyectoEnvio();
    const transporte = new TransporteFalso({
      ...tokenRest(),
      [`${ENVIO_CERT}/boleta.electronica.envio`]:
        '{"trackid":987654,"estado":"REC","rut_emisor":"76123456-0","rut_envia":"11111111-1"}',
    });
    const r = await correr(p, ['certificacion', 'enviar-set', '--canal', 'rest'], { transporte });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('TrackID: 987654 (estado REC)');
    expect(r.stdout).toContain('sii certificacion estado-envio 987654');
    const [envio] = hacia(transporte.enviadas, 'boleta.electronica.envio');
    expect(envio?.metodo).toBe('POST');
    expect(envio?.cabeceras.Cookie).toBe(`TOKEN=${TOKEN}`);
    expect(envio?.bytes?.includes(readFileSync(join(p.dir, SOBRE)))).toBe(true);
    expect(hacia(transporte.enviadas, 'maullin')).toHaveLength(0);
  });

  it('si los folios no caben en el CAF se detiene antes de pedir nada (código 3)', async () => {
    const p = proyectoEnvio();
    const r = await correr(p, ['certificacion', 'enviar-set', '--folio-inicial', '10']);

    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('necesita los folios 10 a 11');
    expect(r.stderr).toContain('del 1 al 10');
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(existsSync(join(p.dir, SOBRE))).toBe(false);
  });

  it('un CAF de otro tipo o de otra empresa es error de configuración', async () => {
    for (const caf of [{ tipoDte: 41 }, { rut: '76543210-3' }]) {
      const p = proyectoEnvio({ caf });
      const r = await correr(p, ['certificacion', 'enviar-set']);
      expect(r.codigo).toBe(CODIGOS.CONFIG);
      expect(r.transporte.enviadas).toHaveLength(0);
    }
  });

  it('config incompleta: nombra las variables y no envía nada (código 3)', async () => {
    const p = proyectoEnvio();
    p.escribirEnv({ SII_FCH_RESOL: '', SII_FOLIO_INICIAL: '' });
    const r1 = await correr(p, ['certificacion', 'enviar-set']);
    expect(r1.codigo).toBe(CODIGOS.CONFIG);
    expect(r1.stderr).toContain('SII_FCH_RESOL (o --fch-resol): falta');
    expect(r1.transporte.enviadas).toHaveLength(0);

    p.escribirEnv({ SII_FCH_RESOL: '2026-09-05', SII_FOLIO_INICIAL: '1', SII_CERT_PASS: 'mala' });
    const r2 = await correr(p, ['certificacion', 'enviar-set']);
    expect(r2.codigo).toBe(CODIGOS.CONFIG);
    expect(r2.transporte.enviadas).toHaveLength(0);
    expect(r2.stderr).not.toContain('mala');
  });

  it('un set ilegible es error de configuración', async () => {
    const p = proyectoEnvio();
    p.escribir('data/set_pruebas/set.txt', 'sin casos');
    const r = await correr(p, ['certificacion', 'enviar-set', '--solo-armar']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('No se encontraron casos');
  });

  it('opciones mal escritas son error de uso (código 2)', async () => {
    const p = proyectoEnvio();
    for (const args of [
      ['--canal', 'ftp'],
      ['--folio-inicial', '0'],
      ['--folio-inicial', 'x'],
    ]) {
      const r = await correr(p, ['certificacion', 'enviar-set', ...args]);
      expect(r.codigo).toBe(CODIGOS.USO);
      expect(r.transporte.enviadas).toHaveLength(0);
    }
  });

  it('el SII rechaza la subida (STATUS 7): código 5', async () => {
    const p = proyectoEnvio();
    const transporte = transporteSoap(upload('<STATUS>7</STATUS>'));
    const r = await correr(p, ['certificacion', 'enviar-set'], { transporte });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('STATUS 7');
    expect(r.stderr).not.toContain('ATENCIÓN');
  });

  it('la subida falla por HTTP: código 4 y aviso de que pudo haber llegado', async () => {
    const p = proyectoEnvio();
    const transporte = transporteSoap(new RespuestaHttp(502, {}, 'Bad Gateway'));
    const r = await correr(p, ['certificacion', 'enviar-set'], { transporte });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(r.stderr).toContain('[ATENCIÓN]');
    expect(r.stderr).toContain('folios 1 a 2');
  });

  it('si falla el token no se sube nada', async () => {
    const p = proyectoEnvio();
    const transporte = new TransporteFalso(); // todo responde 404
    const r = await correr(p, ['certificacion', 'enviar-set'], { transporte });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(hacia(transporte.enviadas, 'DTEUpload')).toHaveLength(0);
    expect(r.stderr).not.toContain('ATENCIÓN');
  });
});
