// Tests de SituacionTributaria (nuevo en Node). Todo pasa por el TransporteFalso:
// ninguna petición sale a la red.
//
// Las respuestas de paridad/autorizacion/stc/ son las de www2.sii.cl grabadas el
// 2026-11-13, con el nombre reemplazado. `consulta-captcha.json` es sintética (el
// SII no tenía el captcha activo): la misma forma con `captchaInvalido: true`.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorTransporte, ErrorValidacion, ErrorVerificacion } from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import { type RespuestaFalsa, TransporteFalso } from '../../../src/comun/http/transporte-falso.ts';
import { SituacionTributaria } from '../../../src/folios/situacion-tributaria.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');
const stc = (nombre: string): string =>
  readFileSync(join(PARIDAD, 'autorizacion/stc', `${nombre}.json`), 'utf8');

const KEY = 'www2.sii.cl/app/stc/recurso/v1/recaptcha/key';
const CONSULTA = 'www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/';

function transporte(consulta: RespuestaFalsa, clave: RespuestaFalsa = stc('recaptcha-apagado')) {
  return new TransporteFalso([
    [KEY, clave],
    [CONSULTA, consulta],
  ]);
}

const conTimbrajes = (timbrajes: unknown): string =>
  JSON.stringify({ ...JSON.parse(stc('consulta-boleta')), timbrajes });

describe('SituacionTributaria.timbrajes', () => {
  it('devuelve solo los timbrajes, con los números limpios', async () => {
    const t = transporte(stc('consulta-boleta'));
    const r = await new SituacionTributaria({ transporte: t }).timbrajes('76.123.456-0');
    expect(r).toEqual({
      tipo: 'ok',
      timbrajes: [{ tipoDte: 39, ultimoAnio: 2026, folioFinal: 5 }],
    });
    expect(JSON.stringify(r)).not.toMatch(/EMPRESA|giro|PROGRAMAS/i);
  });

  it('GET de la clave y POST JSON con rut, dv, reAction y reToken " " (como la SPA)', async () => {
    const t = transporte(stc('consulta-boleta'));
    await new SituacionTributaria({ transporte: t }).timbrajes('76123456-0');

    const [clave, consulta] = t.enviadas;
    expect(clave?.metodo).toBe('GET');
    expect(clave?.url).toBe('https://www2.sii.cl/app/stc/recurso/v1/recaptcha/key');
    expect(clave?.cuerpo).toBeUndefined();
    expect(consulta?.metodo).toBe('POST');
    expect(consulta?.url).toBe('https://www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/');
    expect(consulta?.cabeceras['Content-Type']).toBe('application/json');
    expect(consulta?.cabeceras.Origin).toBe('https://www2.sii.cl');
    expect(consulta?.cabeceras.Referer).toBe('https://www2.sii.cl/stc/noauthz');
    expect(JSON.parse(consulta?.bytes?.toString('utf8') ?? '')).toEqual({
      rut: '76123456',
      dv: '0',
      reAction: 'consultaSTC',
      reToken: ' ',
    });
    // Sin certificado ni cookies.
    expect(t.enviadas.every((p) => !p.tls && p.cabeceras.Cookie === undefined)).toBe(true);
  });

  it('empresa con facturas y sin boletas', async () => {
    const t = transporte(stc('consulta-factura'));
    const r = await new SituacionTributaria({ transporte: t }).timbrajes('76123456-0');
    expect(r.tipo === 'ok' && r.timbrajes.map((x) => x.tipoDte)).toEqual([30, 33, 34, 56, 61, 110]);
    expect(r.tipo === 'ok' && r.timbrajes[1]).toEqual({
      tipoDte: 33,
      ultimoAnio: 2026,
      folioFinal: 1171827,
    });
  });

  it('sin timbrajes: lista vacía', async () => {
    const t = transporte(stc('consulta-sin-timbrajes'));
    const r = await new SituacionTributaria({ transporte: t }).timbrajes('76123456-0');
    expect(r).toEqual({ tipo: 'ok', timbrajes: [] });
  });

  it('captcha activo (enable: true): no consulta', async () => {
    const t = transporte(stc('consulta-boleta'), stc('recaptcha-encendido'));
    const r = await new SituacionTributaria({ transporte: t }).timbrajes('76123456-0');
    expect(r).toEqual({ tipo: 'captcha' });
    expect(t.enviadas).toHaveLength(1);
  });

  it('captchaInvalido en la respuesta: captcha', async () => {
    const t = transporte(stc('consulta-captcha'));
    const r = await new SituacionTributaria({ transporte: t }).timbrajes('76123456-0');
    expect(r).toEqual({ tipo: 'captcha' });
  });

  it('una clave sin `enable` booleano: ErrorVerificacion y no consulta', async () => {
    const t = transporte(stc('consulta-boleta'), '{"key":"x"}');
    await expect(
      new SituacionTributaria({ transporte: t }).timbrajes('76123456-0'),
    ).rejects.toThrow(ErrorVerificacion);
    expect(t.enviadas).toHaveLength(1);
  });

  it('una respuesta con otra forma: ErrorVerificacion sin copiar la respuesta', async () => {
    const formas = [
      '<html>Mantención</html>',
      '[]',
      JSON.stringify({ captchaInvalido: false }),
      JSON.stringify({ timbrajes: [] }),
      conTimbrajes(null),
      conTimbrajes([{ codigo: '0039', fechaTimbraje: '2026', folioFinal: null }]),
      conTimbrajes([{ codigo: 'BOLETA', fechaTimbraje: '2026', folioFinal: '5' }]),
      conTimbrajes([{ codigo: '0039', fechaTimbraje: '26', folioFinal: '5' }]),
      conTimbrajes(['0039']),
    ];
    for (const forma of formas) {
      const t = transporte(forma);
      const error = await new SituacionTributaria({ transporte: t })
        .timbrajes('76123456-0')
        .catch((e: unknown) => e);
      expect(error, forma).toBeInstanceOf(ErrorVerificacion);
      expect((error as Error).message).not.toMatch(/Mantenci|EMPRESA/);
    }
  });

  it('HTTP distinto de 200 (el SII rechaza el RUT con 400): ErrorTransporte', async () => {
    const t = transporte(
      new RespuestaHttp(
        400,
        {},
        '{"httpStatusCode":"400","message":"El RUT ingresado no es válido."}',
      ),
    );
    await expect(
      new SituacionTributaria({ transporte: t }).timbrajes('76123456-0'),
    ).rejects.toThrow(ErrorTransporte);
  });

  it('RUT inválido: ErrorValidacion sin salir al SII', async () => {
    const t = transporte(stc('consulta-boleta'));
    await expect(
      new SituacionTributaria({ transporte: t }).timbrajes('76123456-1'),
    ).rejects.toThrow(ErrorValidacion);
    expect(t.enviadas).toHaveLength(0);
  });
});
