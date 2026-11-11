// `sii certificacion estado-envio`: consulta por SOAP y REST, salida de texto y JSON,
// y códigos de salida. Siempre contra el TransporteFalso.

import { RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import {
  AUTH_CERT,
  estadoRest,
  estadoSoap,
  faultSoap,
  hacia,
  TOKEN,
  tokenDtews,
  tokenRest,
} from './soporte-envio.ts';

const QUERY = 'maullin.sii.cl/DTEWS/QueryEstUp.jws';
const ESTADO_REST = `${AUTH_CERT}/boleta.electronica.envio/*`;

describe('estado-envio', () => {
  it('consulta cada trackId por los dos canales (por defecto)', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      ...tokenRest(),
      [QUERY]: (p) => estadoSoap(/<TrackId>(\d+)</.exec(p.bytes?.toString() ?? '')?.[1] ?? ''),
      [ESTADO_REST]: (p) => estadoRest(p.url.split('-').at(-1) ?? ''),
    });
    const r = await correr(proyecto(), ['certificacion', 'estado-envio', '111', '222'], {
      transporte,
    });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('TrackID 111');
    expect(r.stdout).toContain('TrackID 222');
    expect(r.stdout).toContain(
      'SOAP: EPR Envio Procesado: 2 informados, 2 aceptados, 0 rechazados, 0 con reparos',
    );
    expect(r.stdout).toContain('REST: EPR | informados 2, aceptados 2, rechazados 0, reparos 0');
    expect(r.stdout).not.toContain(TOKEN);

    // Un token por canal para toda la ejecución.
    expect(hacia(transporte.enviadas, 'CrSeed')).toHaveLength(1);
    expect(hacia(transporte.enviadas, 'boleta.electronica.semilla')).toHaveLength(1);
    expect(hacia(transporte.enviadas, 'QueryEstUp')).toHaveLength(2);
    expect(hacia(transporte.enviadas, 'boleta.electronica.envio/').map((p) => p.url)).toEqual([
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-111',
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-222',
    ]);
  });

  it('explica el -11 de QueryEstUp (trackId de REST o recién subido)', async () => {
    // Lo que respondió el SII real al consultar el trackId de una subida REST (fase 7).
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      ...tokenRest(),
      [QUERY]: estadoSoap('33887260', '-11', ''),
      [ESTADO_REST]: estadoRest('33887260'),
    });
    const r = await correr(proyecto(), ['certificacion', 'estado-envio', '33887260'], {
      transporte,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('SOAP: -11');
    expect(r.stdout).toContain('el SII no tiene este envío por DTEUpload');
    expect(r.stdout).toContain('REST: EPR');
  });

  it('un canal que falla se informa y se sigue con el otro (código 0)', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      ...tokenRest(),
      [QUERY]: estadoSoap('333', 'SOK', 'Schema Validado'),
      // REST no conoce el trackId de DTEUpload: 404 (sin regla).
    });
    const r = await correr(proyecto(), ['certificacion', 'estado-envio', '333'], { transporte });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('SOAP: SOK Schema Validado (en proceso');
    expect(r.stdout).toMatch(/REST: sin respuesta \(ErrorTransporte: .*404/);
    expect(r.stdout).toContain('basta con que responda un canal');
  });

  it('muestra el detalle de rechazos de REST', async () => {
    const transporte = new TransporteFalso({
      ...tokenRest(),
      [ESTADO_REST]: estadoRest('444', {
        estadistica: [{ tipo: 39, informados: 2, aceptados: 1, rechazados: 1, reparos: 0 }],
        detalle_rep_rech: [
          {
            tipo: 39,
            folio: 2,
            estado: 'RCH',
            descripcion: 'Rechazado',
            error: [{ codigo: 302, descripcion: 'Monto Total No Cuadra', detalle: 'MntTotal' }],
          },
        ],
      }),
    });
    const r = await correr(
      proyecto(),
      ['certificacion', 'estado-envio', '444', '--canal', 'rest'],
      {
        transporte,
      },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('folio 2 (tipo 39): RCH Rechazado');
    expect(r.stdout).toContain('[302] Monto Total No Cuadra: MntTotal');
    expect(hacia(transporte.enviadas, 'maullin')).toHaveLength(0);
  });

  it('--json entrega un objeto con el resultado de cada canal', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      ...tokenRest(),
      [QUERY]: estadoSoap('555'),
    });
    const r = await correr(proyecto(), ['certificacion', 'estado-envio', '555', '--json'], {
      transporte,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    const json = JSON.parse(r.stdout);
    expect(json.ambiente).toBe('certificacion');
    expect(json.envios).toHaveLength(1);
    const [envio] = json.envios;
    expect(envio.trackId).toBe('555');
    expect(envio.ok).toBe(true);
    expect(envio.soap).toMatchObject({
      ok: true,
      estado: 'EPR',
      informados: 2,
      aceptados: 2,
      procesado: true,
      limpio: true,
    });
    expect(envio.rest).toMatchObject({ ok: false, codigo: CODIGOS.TRANSPORTE });
    expect(envio.rest.error).toContain('ErrorTransporte');
  });

  it('--canal soap sin respuesta del SII: código del error (5 por un fault)', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      [QUERY]: faultSoap('java.lang.NullPointerException'),
    });
    const r = await correr(
      proyecto(),
      ['certificacion', 'estado-envio', '666', '--canal', 'soap'],
      {
        transporte,
      },
    );
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('Ningún canal respondió por el TrackID 666');
    expect(hacia(transporte.enviadas, 'apicert')).toHaveLength(0);
  });

  it('ningún canal responde: código del primer error (4 por HTTP)', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      [QUERY]: new RespuestaHttp(503, {}, 'Service Unavailable'),
    });
    const r = await correr(proyecto(), ['certificacion', 'estado-envio', '777', '--json'], {
      transporte,
    });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    const json = JSON.parse(r.stdout);
    expect(json.envios[0].ok).toBe(false);
    // El token REST falló una vez y no se volvió a pedir.
    expect(hacia(transporte.enviadas, 'boleta.electronica.semilla')).toHaveLength(1);
  });

  it('basta con que un trackId no responda para salir con error', async () => {
    const transporte = new TransporteFalso({
      ...tokenDtews(),
      [QUERY]: (p) =>
        p.bytes?.toString().includes('<TrackId>1<')
          ? estadoSoap('1')
          : new RespuestaHttp(503, {}, 'x'),
    });
    const r = await correr(
      proyecto(),
      ['certificacion', 'estado-envio', '1', '2', '--canal', 'soap'],
      {
        transporte,
      },
    );
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(r.stderr).toContain('TrackID 2');
  });

  it('trackIds inválidos o demasiados: error de uso sin peticiones', async () => {
    const p = proyecto();
    const veinteYUno = Array.from({ length: 21 }, (_, i) => String(i + 1));
    for (const args of [[], ['12a'], ['-1'], veinteYUno, ['1', '--canal', 'ftp']]) {
      const r = await correr(p, ['certificacion', 'estado-envio', ...args]);
      expect(r.codigo, args.join(' ')).toBe(CODIGOS.USO);
      expect(r.transporte.enviadas).toHaveLength(0);
    }
  });

  it('config inválida: código 3 sin peticiones', async () => {
    const p = proyecto();
    p.escribirEnv({ SII_RUT_EMPRESA: '' });
    const r = await correr(p, ['certificacion', 'estado-envio', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_RUT_EMPRESA');
    expect(r.transporte.enviadas).toHaveLength(0);
  });
});
