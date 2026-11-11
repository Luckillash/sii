// `sii produccion consultar`: todo contra el TransporteFalso; nada sale a la red.

import { RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { correr, proyecto } from '../soporte/cli.ts';
import { fixture, SII_FALSO, TOKEN } from './soporte.ts';

function siiFalso(
  ambiente: keyof typeof SII_FALSO,
  estado: Buffer | string | RespuestaHttp,
): TransporteFalso {
  const { auth } = SII_FALSO[ambiente];
  return new TransporteFalso({
    [`${auth}/boleta.electronica.semilla`]: fixture('semilla.xml'),
    [`${auth}/boleta.electronica.token`]: fixture('token.xml'),
    [`${auth}/boleta.electronica.envio/*`]: estado,
  });
}

describe('sii produccion consultar', () => {
  it('--json imprime el JSON completo del SII (producción por defecto)', async () => {
    const transporte = siiFalso('produccion', fixture('estado-procesado.json'));
    const r = await correr(proyecto(), ['produccion', 'consultar', '1234567890', '--json'], {
      transporte,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls()).toEqual([
      'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://api.sii.cl/recursos/v1/boleta.electronica.token',
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-1234567890',
    ]);
    expect(transporte.enviadas[2]?.metodo).toBe('GET');
    expect(JSON.parse(r.stdout)).toEqual(JSON.parse(fixture('estado-procesado.json').toString()));
    expect(r.stdout).toContain('\n    "rut_emisor"');
    expect(r.stdout).not.toContain(TOKEN);
  });

  it('el resumen muestra totales y el detalle de rechazos y reparos', async () => {
    const transporte = siiFalso('certificacion', fixture('estado-con-rechazos.json'));
    const r = await correr(
      proyecto(),
      ['produccion', 'consultar', '1234567891', '--ambiente', 'certificacion'],
      { transporte },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls()[2]).toBe(
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-1234567891',
    );
    expect(r.stdout).toContain('Estado:      EPR (envío procesado)');
    expect(r.stdout).toContain('informados 5 · aceptados 3 · rechazados 1 · reparos 1');
    expect(r.stdout).toContain('tipo 41: informados 1');
    expect(r.stdout).toContain('Tipo 39 folio 57: RCH (Rechazado)');
    expect(r.stdout).toContain(
      '- [302] Monto Total No Cuadra: MntTotal distinto de la suma de los ítems (sección DTE, línea 12)',
    );
    expect(r.stdout).toContain('Tipo 39 folio 58: RPR (Aceptado con Reparos)');
    expect(r.stdout).toContain('Procesado con rechazos o reparos');
    expect(r.stdout).not.toContain(TOKEN);
  });

  it('un envío limpio y uno en proceso', async () => {
    const limpio = await correr(proyecto(), ['produccion', 'consultar', '1234567890'], {
      transporte: siiFalso('produccion', fixture('estado-procesado.json')),
    });
    expect(limpio.stdout).toContain('todos los documentos aceptados');

    const enProceso = await correr(
      proyecto(),
      ['produccion', 'consultar', '55', '--ambiente', 'certificacion'],
      { transporte: siiFalso('certificacion', JSON.stringify({ trackid: 55, estado: 'REC' })) },
    );
    expect(enProceso.codigo).toBe(CODIGOS.OK);
    expect(enProceso.stdout).toContain('Estado:      REC (recibido)');
    expect(enProceso.stdout).toContain(
      'vuelve a consultar en unos minutos con `sii produccion consultar 55 --ambiente certificacion`',
    );
  });

  it('un trackId no numérico es error de uso, sin peticiones', async () => {
    const r = await correr(proyecto(), ['produccion', 'consultar', '12a']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect((await correr(proyecto(), ['produccion', 'consultar'])).codigo).toBe(CODIGOS.USO);
  });

  it('sin SII_RUT_EMPRESA es error de configuración, sin peticiones', async () => {
    const p = proyecto();
    p.escribirEnv({ SII_RUT_EMPRESA: '' });
    const r = await correr(p, ['produccion', 'consultar', '1'], {
      transporte: siiFalso('produccion', fixture('estado-procesado.json')),
    });
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_RUT_EMPRESA: falta');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('un HTTP inesperado es error de transporte (4)', async () => {
    const r = await correr(proyecto(), ['produccion', 'consultar', '1'], {
      transporte: siiFalso('produccion', new RespuestaHttp(500, {}, 'error')),
    });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(r.stderr).not.toContain(TOKEN);
  });

  it('una respuesta sin estado es error del SII (5)', async () => {
    const r = await correr(proyecto(), ['produccion', 'consultar', '1'], {
      transporte: siiFalso('produccion', '{"trackid": 1}'),
    });
    expect(r.codigo).toBe(CODIGOS.SII);
  });
});
