// `sii certificacion estado-declaracion [rut]`: login + consulta (solo lectura).

import { RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { CLAVE_PFX, correr, proyecto } from '../../soporte/cli.ts';
import { GWT, LOGIN_CADUCADO, LOGIN_OK, LOGIN_RECHAZADO, resumen, siiFalso } from './sii-falso.ts';

const LOGIN = 'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi';
const ESTADO = 'POST www4.sii.cl/certBolElectDteInternet/facade obtenerEstadoAutorizaEmp';

describe('certificacion estado-declaracion', () => {
  it('P90: login con el certificado y una consulta; muestra que corresponde declarar', async () => {
    const t = siiFalso({ login: LOGIN_OK, gwt: { obtenerEstadoAutorizaEmp: GWT.P90 } });
    const r = await correr(proyecto(), ['certificacion', 'estado-declaracion'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t.enviadas)).toEqual([LOGIN, ESTADO]);
    expect(t.enviadas[0]?.tls).toBe(true);
    // El RUT de SII_RUT_EMPRESA (76123456-0) va en la llamada GWT.
    expect(t.enviadas[1]?.bytes?.toString('utf8')).toContain('|76123456|');
    expect(r.stdout).toContain('Empresa: 76123456-0');
    expect(r.stdout).toContain('Estado:  P90 PENDIENTE DECLARACION DE CUMPLIMIENTO (paso 90)');
    expect(r.stdout).toContain('Declarar cumplimiento: SÍ, pendiente (P90)');
  });

  it('el rut del argumento gana sobre SII_RUT_EMPRESA (y se normaliza)', async () => {
    const t = siiFalso({ login: LOGIN_OK, gwt: { obtenerEstadoAutorizaEmp: GWT.P91 } });
    const r = await correr(proyecto(), ['certificacion', 'estado-declaracion', '11.111.111-1'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Empresa: 11111111-1');
    expect(r.stdout).toContain('Declarar cumplimiento: no corresponde. Autorizada en producción');
    expect(t.enviadas[1]?.bytes?.toString('utf8')).toContain('|11111111|');
  });

  it('sin trámite: lo dice como el PHP', async () => {
    const t = siiFalso({ login: LOGIN_OK, gwt: { obtenerEstadoAutorizaEmp: GWT.NULO } });
    const r = await correr(proyecto(), ['certificacion', 'estado-declaracion'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Estado:  (sin trámite pendiente');
    expect(r.stdout).toContain('Declarar cumplimiento: no corresponde');
  });

  it('rut inválido o certificado ilegible: código 3 sin peticiones', async () => {
    const p = proyecto();
    const malo = await correr(p, ['certificacion', 'estado-declaracion', '76123456-1']);
    expect(malo.codigo).toBe(CODIGOS.CONFIG);
    expect(malo.stderr).toContain('el argumento rut: no es un RUT válido');
    expect(malo.transporte.enviadas).toHaveLength(0);

    p.escribirEnv({ SII_CERT_PASS: 'otra-clave' });
    const cert = await correr(p, ['certificacion', 'estado-declaracion']);
    expect(cert.codigo).toBe(CODIGOS.CONFIG);
    expect(cert.transporte.enviadas).toHaveLength(0);
    expect(cert.stderr).not.toContain('otra-clave');
    expect(cert.stderr).not.toContain(CLAVE_PFX);
  });

  it('certificado rechazado en el login: código 5', async () => {
    const t = siiFalso({ login: LOGIN_RECHAZADO });
    const r = await correr(proyecto(), ['certificacion', 'estado-declaracion'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(resumen(t.enviadas)).toEqual([LOGIN]);
  });

  it('sesión caducada: código 5; HTTP 502: código 4; nunca muestra el token', async () => {
    const caducada = await correr(proyecto(), ['certificacion', 'estado-declaracion'], {
      transporte: siiFalso({ login: LOGIN_OK, gwt: { obtenerEstadoAutorizaEmp: LOGIN_CADUCADO } }),
    });
    expect(caducada.codigo).toBe(CODIGOS.SII);
    const http = await correr(proyecto(), ['certificacion', 'estado-declaracion'], {
      transporte: siiFalso({
        login: LOGIN_OK,
        gwt: { obtenerEstadoAutorizaEmp: new RespuestaHttp(502) },
      }),
    });
    expect(http.codigo).toBe(CODIGOS.TRANSPORTE);
    for (const r of [caducada, http]) {
      expect(`${r.stdout}${r.stderr}`).not.toContain('TOKENDEPRUEBA');
    }
  });
});
