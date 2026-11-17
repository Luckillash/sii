import { ErrorTransporte, EstadoEnvio, EstadoEnvioRest } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { TOKEN_SII } from '../../../test/certificacion-prueba';
import { ErrorCredenciales } from '../sii/credenciales';
import {
  desdeRest,
  desdeSoap,
  ErrorPersistencia,
  huboCambio,
  jsonSeguro,
  textoDeError,
  tipoObservacion,
} from './persistencia';
import type { EnvioSeguimiento } from './tipos';

describe('jsonSeguro', () => {
  it('quita claves sensibles y el token literal, y conserva el resto', () => {
    const json = jsonSeguro(
      {
        estado: 'EPR',
        token: TOKEN_SII,
        Cookie: `TOKEN=${TOKEN_SII}`,
        detalle_rep_rech: [{ folio: 1, descripcion: `eco ${TOKEN_SII}`, error: [] }],
        n: Number.NaN,
      },
      [TOKEN_SII],
    );
    expect(json).toEqual({
      estado: 'EPR',
      detalle_rep_rech: [{ folio: 1, descripcion: 'eco [FILTRADO]', error: [] }],
      n: null,
    });
    expect(JSON.stringify(json)).not.toContain(TOKEN_SII);
  });

  it('corta la profundidad', () => {
    let anidado: Record<string, unknown> = { fin: true };
    for (let i = 0; i < 12; i++) anidado = { a: anidado };
    expect(JSON.stringify(jsonSeguro(anidado))).toContain('[FILTRADO]');
  });
});

describe('textoDeError', () => {
  it('de la librería: nombre y mensaje saneados, sin el token', () => {
    const error = new ErrorTransporte(
      `api.sii.cl respondió HTTP 500. Respuesta: ${TOKEN_SII}`,
      'https://api.sii.cl/x',
      500,
    );
    const texto = textoDeError(error, [TOKEN_SII]);
    expect(texto).toContain('ErrorTransporte: api.sii.cl respondió HTTP 500.');
    expect(texto).not.toContain(TOKEN_SII);
  });

  it('con mensaje propio (credenciales): solo el título', () => {
    expect(textoDeError(new ErrorCredenciales('sin_certificado', { ambito: 'empresa' }))).toMatch(
      /^ErrorCredenciales: /,
    );
  });

  it('desconocido: solo el nombre', () => {
    expect(textoDeError(new TypeError(`algo con ${TOKEN_SII}`))).toBe('TypeError (sin detalle)');
    expect(textoDeError('texto suelto')).toBe('Error (sin detalle)');
  });

  it('de la base: el mensaje propio, sin datos de la fila', () => {
    expect(
      textoDeError(new ErrorPersistencia('guardar el estado del envío', { code: '23514' })),
    ).toBe('No se pudo guardar el estado del envío (código 23514).');
  });
});

describe('tipoObservacion', () => {
  it('RPR, REP y RLV son reparos; RCH es rechazo', () => {
    const r = { rechazados: 1, reparos: 1 };
    expect(tipoObservacion({ estado: 'RPR' }, r)).toBe('reparo');
    expect(tipoObservacion({ estado: 'rlv ' }, r)).toBe('reparo');
    expect(tipoObservacion({ estado: 'REP' }, r)).toBe('reparo');
    expect(tipoObservacion({ estado: 'RCH' }, r)).toBe('rechazo');
  });

  it('sin rechazos y con reparos en el envío, todo el detalle es reparo', () => {
    expect(tipoObservacion({ estado: 'XYZ' }, { rechazados: 0, reparos: 2 })).toBe('reparo');
  });
});

describe('normalización y cambio', () => {
  const envio = {
    estado_sii: 'REC',
    informados: 0,
    aceptados: 0,
    rechazados: 0,
    reparos: 0,
  } as EnvioSeguimiento;

  it('REST trae estadística y detalle', () => {
    const r = desdeRest(
      EstadoEnvioRest.desdeJson(
        {
          estado: 'EPR',
          estadistica: [{ tipo: 39, informados: 2, aceptados: 1, rechazados: 1, reparos: 0 }],
          detalle_rep_rech: [{ tipo: 39, folio: 5, estado: 'RCH', error: [] }],
        },
        '7',
      ),
    );
    expect(r).toMatchObject({
      estado: 'EPR',
      informados: 2,
      rechazados: 1,
      conDetalle: true,
      glosa: null,
    });
    expect(r.detalle).toHaveLength(1);
    expect(huboCambio(envio, r)).toBe(true);
  });

  it('SOAP no trae detalle por documento', () => {
    const r = desdeSoap(new EstadoEnvio({ trackId: '7', estado: 'REC', glosa: ' Recibido ' }));
    expect(r).toMatchObject({ estado: 'REC', glosa: 'Recibido', conDetalle: false, detalle: [] });
    expect(huboCambio(envio, r)).toBe(false);
  });
});
