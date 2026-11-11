// `sii certificacion solicitar-revision <trackId>`: pide la revisión del set.

import { RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import { GWT, LOGIN_OK, resumen, siiFalso } from './sii-falso.ts';

const FACADE = 'POST www4.sii.cl/certBolElectDteInternet/facade';
const TRACK = '123456789012';

const transporte = (respuesta: string | RespuestaHttp = GWT.texto('1')) =>
  siiFalso({
    login: LOGIN_OK,
    gwt: { recuperarNroActividadesVigAfecIva: GWT.entero(3), ingresarTrackId: respuesta },
  });

describe('certificacion solicitar-revision', () => {
  it('con --confirmar: login, actividades e ingresarTrackId con el trackId', async () => {
    const t = transporte();
    const r = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--confirmar'],
      {
        transporte: t,
      },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t.enviadas)).toEqual([
      'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      `${FACADE} recuperarNroActividadesVigAfecIva`,
      `${FACADE} ingresarTrackId`,
    ]);
    const cuerpo = t.enviadas[2]?.bytes?.toString('utf8') ?? '';
    expect(cuerpo).toContain(`|${TRACK}|`);
    expect(cuerpo).toContain('|76123456|');
    expect(r.stdout).toContain('El SII recibió la solicitud de revisión');
  });

  it('--rut reemplaza a SII_RUT_EMPRESA', async () => {
    const t = transporte();
    const r = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--rut', '11111111-1', '--confirmar'],
      { transporte: t },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(t.enviadas[2]?.bytes?.toString('utf8')).toContain('|11111111|');
  });

  it('sin --confirmar no envía nada', async () => {
    const r = await correr(proyecto(), ['certificacion', 'solicitar-revision', TRACK], {
      transporte: transporte(),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).toContain(`sii certificacion solicitar-revision ${TRACK} --confirmar`);
  });

  it.each([['abc'], ['1234567890123456'], ['12 3']])(
    'trackId inválido (%j): código 2 sin peticiones',
    async (track) => {
      const r = await correr(
        proyecto(),
        ['certificacion', 'solicitar-revision', track, '--confirmar'],
        {
          transporte: transporte(),
        },
      );
      expect(r.codigo).toBe(CODIGOS.USO);
      expect(r.transporte.enviadas).toHaveLength(0);
    },
  );

  it('sin trackId: código 2', async () => {
    const r = await correr(proyecto(), ['certificacion', 'solicitar-revision', '--confirmar']);
    expect(r.codigo).toBe(CODIGOS.USO);
  });

  it('rut inválido: código 3 sin peticiones', async () => {
    const r = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--rut', '1-2', '--confirmar'],
      { transporte: transporte() },
    );
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('--rut: no es un RUT válido');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('set sin descargar (errorEstado): código 5 y explica qué hacer', async () => {
    const r = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--confirmar'],
      {
        transporte: transporte(GWT.texto('errorEstado')),
      },
    );
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('SetSinDescargarError');
    expect(r.stderr).toContain('primero hay que descargar el set');
    expect(r.stderr).toContain('sii certificacion descargar-set --confirmar');
    expect(r.stderr).toContain('sii certificacion enviar-set');
  });

  it('otra respuesta: código 5; HTTP 502: código 4', async () => {
    const otra = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--confirmar'],
      {
        transporte: transporte(GWT.texto('0')),
      },
    );
    expect(otra.codigo).toBe(CODIGOS.SII);
    expect(otra.stderr).toContain('no recibió la solicitud');
    const http = await correr(
      proyecto(),
      ['certificacion', 'solicitar-revision', TRACK, '--confirmar'],
      {
        transporte: transporte(new RespuestaHttp(502)),
      },
    );
    expect(http.codigo).toBe(CODIGOS.TRANSPORTE);
  });
});
