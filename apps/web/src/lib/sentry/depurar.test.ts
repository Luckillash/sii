import { describe, expect, it } from 'vitest';
import { depurarBreadcrumb, depurarEvento, depurarTexto, FILTRADO } from './depurar';

const PEM =
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJhLWRlLXBydWViYQ';

/** Todo lo que no puede aparecer en el JSON que llega a Sentry. */
const PROHIBIDOS = [
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
  'ABCDEF123456TOKENSII',
  'clave-del-pfx',
  'sb-access=abc',
  'RSASK-SECRETA',
  JWT,
  'tb_live_123456',
  'whsec_987',
];

describe('depurarEvento', () => {
  it('quita cuerpo, cookies y cabeceras sensibles de la petición', () => {
    const evento = {
      request: {
        url: 'https://app.timbre.cl/api/v1/documentos?token=ABCDEF123456TOKENSII&pagina=2',
        data: { pfx: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', clave: 'clave-del-pfx' },
        cookies: { 'sb-access': 'sb-access=abc' },
        headers: {
          Authorization: `Bearer ${JWT}`,
          Cookie: 'sb-access=abc',
          'X-Api-Key': 'tb_live_123456',
          'User-Agent': 'Mozilla/5.0',
        },
      },
    };
    const salida = depurarEvento(evento);
    const json = JSON.stringify(salida);
    for (const prohibido of PROHIBIDOS) expect(json).not.toContain(prohibido);
    expect(salida.request).not.toHaveProperty('data');
    expect(salida.request).not.toHaveProperty('cookies');
    expect(salida.request.headers.Authorization).toBe(FILTRADO);
    expect(salida.request.headers['User-Agent']).toBe('Mozilla/5.0');
    expect(salida.request.url).toContain('pagina=2');
  });

  it('filtra campos sensibles en extra, contextos y excepciones', () => {
    const evento = {
      message: `Falló la firma con ${PEM}`,
      extra: {
        token: 'ABCDEF123456TOKENSII',
        cookies: ['TOKEN=ABCDEF123456TOKENSII'],
        secreto: 'whsec_987',
        api_key: 'tb_live_123456',
        caf: '<CAF><RSASK>RSASK-SECRETA</RSASK></CAF>',
        anidado: { nivel: { clavePfx: 'clave-del-pfx', folio: 15 } },
      },
      contexts: { sii: { respuesta: '<SII:RESP_HDR><TOKEN>ABCDEF123456TOKENSII</TOKEN>' } },
      exception: {
        values: [{ type: 'ErrorTransporte', value: 'GET con Cookie TOKEN=ABCDEF123456TOKENSII' }],
      },
      tags: { operacion_sii: 'emitir', resultado: 'transporte' },
    };
    const salida = depurarEvento(evento);
    const json = JSON.stringify(salida);
    for (const prohibido of PROHIBIDOS) expect(json).not.toContain(prohibido);
    expect(salida.extra.anidado.nivel.folio).toBe(15);
    expect(salida.tags).toEqual({ operacion_sii: 'emitir', resultado: 'transporte' });
    expect(salida.message).toContain('Falló la firma con');
  });

  it('tolera referencias circulares', () => {
    const extra: Record<string, unknown> = { token: 'ABCDEF123456TOKENSII' };
    extra.yo = extra;
    const salida = depurarEvento({ extra });
    expect(salida.extra.token).toBe(FILTRADO);
  });

  it('depura los atributos de un span (beforeSendSpan)', () => {
    const span = {
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      name: 'GET /api/sii?token=ABCDEF123456TOKENSII',
      start_timestamp: 1,
      status: 'ok' as const,
      is_segment: true,
      attributes: {
        'http.request.header.authorization': `Bearer ${JWT}`,
        'http.request.header.cookie': 'sb-access=abc',
        'url.full': 'https://palena.sii.cl/x?clave=clave-del-pfx',
        'db.statement': 'select 1',
        folio: 1520,
      },
    };
    const salida = depurarEvento(span);
    const json = JSON.stringify(salida);
    for (const prohibido of PROHIBIDOS) expect(json).not.toContain(prohibido);
    expect(salida.attributes['db.statement']).toBe('select 1');
    expect(salida.attributes.folio).toBe(1520);
    expect(salida.trace_id).toBe('a'.repeat(32));
  });
});

describe('depurarBreadcrumb', () => {
  it('limpia URLs y datos de fetch', () => {
    const salida = depurarBreadcrumb({
      category: 'fetch',
      data: {
        url: 'https://apicert.sii.cl/recursos/v1/boleta.electronica.token?clave=clave-del-pfx',
        authorization: `Bearer ${JWT}`,
      },
    });
    const json = JSON.stringify(salida);
    for (const prohibido of PROHIBIDOS) expect(json).not.toContain(prohibido);
  });
});

describe('depurarTexto', () => {
  it('no toca textos sin secretos', () => {
    const texto = 'Boleta 39 folio 1520 aceptada por el SII (Track ID 123456).';
    expect(depurarTexto(texto)).toBe(texto);
  });
});
