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
        url: 'https://boleteame.dev/api/v1/documentos?token=ABCDEF123456TOKENSII&pagina=2',
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

describe('depurarEvento con la carga de un certificado (Server Action, Fase 3)', () => {
  const CLAVE = 'CENTINELA-clave-del-certificado-4c1e';
  // Base64 de un .pfx (empieza con MII, como todo DER de una SEQUENCE larga).
  const PFX_BASE64 = `MIIKaQIBAzCCCi8GCSqGSIb3DQEHAaCCCiAEggocMIIKGDCCBM8GCSqGSIb3DQEHBqCCBMAwggS8AgEAMIIEtQYJKoZIhvcNAQcBMBwGCiqGSIb3DQEMAQYwDgQI${'Ab3x'.repeat(40)}==`;
  const NOMBRE = '12345678-5 Juan Perez.pfx';

  function prohibidos(json: string) {
    expect(json).not.toContain(CLAVE);
    expect(json).not.toContain(PFX_BASE64.slice(0, 60));
    expect(json).not.toContain(NOMBRE);
    expect(json).not.toContain('12345678-5 Juan');
  }

  it('quita el cuerpo multipart, los campos del formulario y los archivos', () => {
    const formulario = new FormData();
    formulario.set('pfx', new File([new Uint8Array([0x30, 0x82, 1, 2])], NOMBRE));
    formulario.set('clave', CLAVE);
    const evento = {
      request: {
        method: 'POST',
        url: 'https://boleteame.dev/mi-org/configuracion/certificados',
        headers: {
          'Next-Action': '7f1c0a',
          'Content-Type': 'multipart/form-data; boundary=----x',
        },
        data: `------x\r\nContent-Disposition: form-data; name="pfx"; filename="${NOMBRE}"\r\n\r\n0\u0082...\r\n------x\r\nContent-Disposition: form-data; name="clave"\r\n\r\n${CLAVE}\r\n`,
      },
      // Lo que agrega withServerActionInstrumentation de Sentry con `formData`.
      extra: {
        'server_action_form_data.clave': CLAVE,
        'server_action_form_data.pfx': '[non-string value]',
        'server_action_form_data.archivo': '[non-string value]',
        'server_action_form_data.rut_titular': '12.345.678-5',
        argumentos: ['mi-org', null, formulario],
        archivo: new File([new Uint8Array([1, 2, 3])], NOMBRE),
        // Un File ya serializado por otro integrador.
        adjunto: { name: NOMBRE, size: 2410, type: 'application/x-pkcs12', lastModified: 1 },
        cuerpo: { clave: CLAVE, pfx: PFX_BASE64, p_pfx_base64: PFX_BASE64, p_clave: CLAVE },
        body: `pfx=${PFX_BASE64}&clave=${CLAVE}`,
        formData: { archivo: PFX_BASE64 },
      },
      contexts: {
        rpc: { args: { contenido: PFX_BASE64 } },
      },
      breadcrumbs: [
        { category: 'console', message: `Content-Disposition: form-data; filename="${NOMBRE}"` },
        { category: 'console', message: 'Leyendo 12345678-5.pfx y firma.P12' },
        { category: 'console', message: `base64 ${PFX_BASE64}` },
      ],
      tags: { organizacion: 'org-1', operacion: 'subir_certificado' },
    };

    const salida = depurarEvento(evento);
    prohibidos(JSON.stringify(salida));
    expect(salida.request).not.toHaveProperty('data');
    expect(salida.request.headers['Next-Action']).toBe('7f1c0a');
    expect(salida.extra['server_action_form_data.rut_titular']).toBe(FILTRADO);
    expect(salida.extra.archivo).toBe(FILTRADO);
    expect(salida.extra.adjunto).toBe(FILTRADO);
    expect(salida.extra.argumentos[2]).toBe(FILTRADO);
    expect(salida.extra.argumentos[0]).toBe('mi-org');
    expect(salida.tags).toEqual({ organizacion: 'org-1', operacion: 'subir_certificado' });
    expect(salida.breadcrumbs[1]?.message).toBe(`Leyendo ${FILTRADO} y ${FILTRADO}`);
    // Los mensajes para el usuario siguen legibles.
    expect(depurarTexto('El archivo no es un certificado .pfx o .p12')).toBe(
      'El archivo no es un certificado .pfx o .p12',
    );
  });

  it('el base64 largo se filtra también en textos libres, y lo corto o sin dígitos no', () => {
    expect(depurarTexto(`falló con ${PFX_BASE64} al final`)).toBe(`falló con ${FILTRADO} al final`);
    const traza = 'a'.repeat(32);
    expect(depurarTexto(`trace ${traza}`)).toBe(`trace ${traza}`);
    const ruta = '/mi-org/configuracion/certificados/0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11';
    expect(depurarTexto(ruta)).toBe(ruta);
  });

  it('los marcos de la traza siguen legibles', () => {
    const evento = {
      exception: {
        values: [
          {
            type: 'ErrorAnalisisCertificado',
            value: 'La contraseña del certificado no es correcta',
            stacktrace: {
              frames: [
                { filename: 'app:///acciones.js', function: 'subirCertificado', lineno: 10 },
              ],
            },
          },
        ],
      },
    };
    const salida = depurarEvento(evento);
    expect(salida.exception.values[0]?.stacktrace.frames[0]?.filename).toBe('app:///acciones.js');
    expect(salida.exception.values[0]?.value).toBe('La contraseña del certificado no es correcta');
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
  it('filtra el token de invitación en rutas, en ?siguiente= y en ?invitacion=', () => {
    const token = 'f'.repeat(64);
    const casos = [
      `https://boleteame.dev/invitacion/${token}`,
      `/invitacion/${token}?x=1`,
      `/ingresar?siguiente=%2Finvitacion%2F${token}`,
      `/ingresar?siguiente=/invitacion/${token}`,
      `/bienvenida?invitacion=${token}`,
      `GET /invitacion/${token} 200`,
    ];
    for (const caso of casos) {
      const depurado = depurarTexto(caso);
      expect(depurado, caso).not.toContain(token);
      expect(depurado, caso).toContain(FILTRADO);
    }
    // La ruta sin token (p. ej. el nombre de la transacción) queda legible.
    expect(depurarTexto('/invitacion/[token]')).toBe(`/invitacion/${FILTRADO}`);
  });

  it('no toca textos sin secretos', () => {
    const texto = 'Boleta 39 folio 1520 aceptada por el SII (Track ID 123456).';
    expect(depurarTexto(texto)).toBe(texto);
  });
});
