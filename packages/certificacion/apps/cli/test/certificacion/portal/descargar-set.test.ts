// `sii certificacion descargar-set`: descarga el set (el SII la registra).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import { GWT, LOGIN_OK, resumen, SET_DESCARGADO, siiFalso } from './sii-falso.ts';

const DESCARGA = 'www4.sii.cl/certBolElectDteInternet/DownloadFileServlet';
const FACADE = 'POST www4.sii.cl/certBolElectDteInternet/facade';

const transporte = (
  estado: string = GWT.NULO,
  descarga: string | Buffer | RespuestaHttp = SET_DESCARGADO,
) =>
  siiFalso({
    login: LOGIN_OK,
    gwt: { obtenerEstadoAutorizaEmp: estado, obtenerPostulacionSeg: GWT.NULO },
    rutas: { [DESCARGA]: descarga },
  });

describe('certificacion descargar-set', () => {
  it('con --confirmar: login, estado, candado de la librería y GET; guarda sin pisar y sugiere SII_SET_PRUEBAS', async () => {
    const p = proyecto();
    const t = transporte();
    const r = await correr(p, ['certificacion', 'descargar-set', '--confirmar'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t.enviadas)).toEqual([
      'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      `${FACADE} obtenerEstadoAutorizaEmp`,
      `${FACADE} obtenerPostulacionSeg`,
      `${FACADE} obtenerEstadoAutorizaEmp`,
      `GET ${DESCARGA}`,
    ]);
    expect(t.enviadas[4]?.url).toBe(
      `https://${DESCARGA}?rutEmpresa=76123456&dvEmpresa=0&rutRepre=11111111&dvRepre=1&mailProvSw=proveedor%40example.com`,
    );
    // 2026-11-07 en Chile (reloj fijo del arnés).
    const ruta = join(p.dir, 'data', 'set_pruebas', 'set-pruebas-2026-11-07.txt');
    expect(readFileSync(ruta, 'utf8')).toBe(SET_DESCARGADO.toString('latin1'));
    expect(r.stdout).toContain('se leen 1 casos');
    expect(r.stdout).toContain('SII_SET_PRUEBAS=data/set_pruebas/set-pruebas-2026-11-07.txt');

    // Una segunda descarga el mismo día no pisa la primera.
    const r2 = await correr(p, ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: transporte(),
    });
    expect(r2.codigo).toBe(CODIGOS.OK);
    expect(r2.stdout).toContain('set-pruebas-2026-11-07-2.txt');
    expect(readdirSync(join(p.dir, 'data', 'set_pruebas')).sort()).toEqual([
      'set-pruebas-2026-11-07-2.txt',
      'set-pruebas-2026-11-07.txt',
      'set.txt',
    ]);
  });

  it('--correo, --rut y --salida reemplazan al .env', async () => {
    const p = proyecto();
    const t = transporte();
    const r = await correr(
      p,
      [
        'certificacion',
        'descargar-set',
        '--confirmar',
        '--correo',
        'otro@proveedor.cl',
        '--rut',
        '11111111-1',
        '--salida',
        'sets',
      ],
      { transporte: t },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(t.enviadas.at(-1)?.url).toContain('rutEmpresa=11111111&dvEmpresa=1');
    expect(t.enviadas.at(-1)?.url).toContain('mailProvSw=otro%40proveedor.cl');
    expect(existsSync(join(p.dir, 'sets', 'set-pruebas-2026-11-07.txt'))).toBe(true);
  });

  it('sin --confirmar valida todo y no envía nada', async () => {
    const p = proyecto();
    const r = await correr(p, ['certificacion', 'descargar-set'], { transporte: transporte() });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).toContain('NO se envió nada');
    expect(existsSync(join(p.dir, 'data', 'set_pruebas', 'set-pruebas-2026-11-07.txt'))).toBe(
      false,
    );
  });

  it('correo que el SII no acepta, o sin correo: código 3 sin peticiones', async () => {
    const p = proyecto();
    const mas = await correr(p, [
      'certificacion',
      'descargar-set',
      '--confirmar',
      '--correo',
      'a+b@x.cl',
    ]);
    expect(mas.codigo).toBe(CODIGOS.CONFIG);
    expect(mas.stderr).toContain('no lo acepta el SII');
    expect(mas.transporte.enviadas).toHaveLength(0);

    p.escribirEnv({ SII_CORREO_PROVEEDOR: '' });
    const falta = await correr(p, ['certificacion', 'descargar-set', '--confirmar']);
    expect(falta.codigo).toBe(CODIGOS.CONFIG);
    expect(falta.stderr).toContain('SII_CORREO_PROVEEDOR (o --correo): falta');
    expect(falta.transporte.enviadas).toHaveLength(0);
  });

  it('empresa autorizada (P91): se detiene antes de la descarga salvo --aunque-autorizada', async () => {
    const t = transporte(GWT.P91);
    const r = await correr(proyecto(), ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.ERROR);
    expect(r.stderr).toContain('--aunque-autorizada');
    expect(resumen(t.enviadas)).toHaveLength(2);
    expect(t.urls().some((u) => u.includes('DownloadFileServlet'))).toBe(false);

    const t2 = transporte(GWT.P91);
    const r2 = await correr(
      proyecto(),
      ['certificacion', 'descargar-set', '--confirmar', '--aunque-autorizada'],
      { transporte: t2 },
    );
    expect(r2.codigo).toBe(CODIGOS.OK);
    expect(t2.urls().some((u) => u.includes('DownloadFileServlet'))).toBe(true);
  });

  it('empresa en P90: la librería no descarga (código 5)', async () => {
    const t = siiFalso({
      login: LOGIN_OK,
      gwt: { obtenerEstadoAutorizaEmp: GWT.P90, obtenerPostulacionSeg: GWT.POSTULACION_P90 },
      rutas: { [DESCARGA]: SET_DESCARGADO },
    });
    const r = await correr(proyecto(), ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('reiniciaría su certificación');
    expect(t.urls().some((u) => u.includes('DownloadFileServlet'))).toBe(false);
  });

  it('un set que parsearSetPruebas no lee igual se guarda, con aviso', async () => {
    const p = proyecto();
    const raro = 'SET DE PRUEBA\r\nCASO-1\r\n==========\r\nsin items\r\n';
    const r = await correr(p, ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: transporte(GWT.NULO, raro),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('parsearSetPruebas no lo pudo leer');
    expect(
      readFileSync(join(p.dir, 'data', 'set_pruebas', 'set-pruebas-2026-11-07.txt'), 'utf8'),
    ).toBe(raro);
  });

  it('el SII no entrega el set: 200 sin set es código 5, HTTP 500 es código 4', async () => {
    const sinSet = await correr(proyecto(), ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: transporte(GWT.NULO, '<html>No hay set</html>'),
    });
    expect(sinSet.codigo).toBe(CODIGOS.SII);
    const http = await correr(proyecto(), ['certificacion', 'descargar-set', '--confirmar'], {
      transporte: transporte(GWT.NULO, new RespuestaHttp(500)),
    });
    expect(http.codigo).toBe(CODIGOS.TRANSPORTE);
  });
});
