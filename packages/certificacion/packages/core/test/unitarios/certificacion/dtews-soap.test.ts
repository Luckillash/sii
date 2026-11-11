// Tests del cliente SOAP DTEWS (port de src/Certificacion/SiiSoapClient.php de
// winex/certificacion v1.9.1, Apache-2.0). El PHP no tenía tests de este cliente
// (pend. 6.1): estos son propios del port, con el transporte falso.

import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ClienteDtews,
  type CredencialesDtews,
  decodificarEntidadesHtml,
  sanear,
  USER_AGENT_DTEUPLOAD,
} from '../../../src/certificacion/dtews-soap.ts';
import {
  firmarSemillaDtews,
  sobreGetToken,
} from '../../../src/certificacion/firma-semilla-dtews.ts';
import type { Ambiente } from '../../../src/comun/ambiente.ts';
import { escaparXml } from '../../../src/comun/codificacion.ts';
import {
  ErrorCertificado,
  ErrorFirma,
  ErrorRespuestaSii,
  ErrorTransporte,
  ErrorValidacion,
} from '../../../src/comun/errores.ts';
import { armarMultipart } from '../../../src/comun/http/multipart.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import { type RespuestaFalsa, TransporteFalso } from '../../../src/comun/http/transporte-falso.ts';
import { relojFijo } from '../../../src/comun/reloj.ts';
import { Rut } from '../../../src/comun/rut.ts';
import {
  type ClaveToken,
  huellaCertificado,
  type TokenGuardado,
  type TokenStore,
  TokenStoreMemoria,
} from '../../../src/comun/token-store.ts';
import { Certificado } from '../../../src/core/certificado.ts';
import { FirmaElectronica } from '../../../src/core/firma-electronica.ts';
import { SEGUNDOS_VIGENCIA_TOKEN } from '../../../src/produccion/boleta-rest.ts';
import { certificado } from '../../soporte/criptografia.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const TOKEN = 'TOKENFALSO123';
const SEMILLA = '012345678901';

const cert = certificado();
const credenciales: CredencialesDtews = { llavePrivada: cert.llave.pem, certificado: cert.pem };

/** Respuesta SOAP como las de DTEWS: el XML del SII va escapado dentro de `<…Return>`. */
function sobre(operacion: string, interior: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soapenv:Body><ns1:${operacion}Response><ns1:${operacion}Return>` +
    escaparXml(interior, 'xml1-sustituir') +
    `</ns1:${operacion}Return></ns1:${operacion}Response></soapenv:Body></soapenv:Envelope>`
  );
}

const respuestaSemilla = (semilla = SEMILLA) =>
  sobre(
    'getSeed',
    `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>${semilla}</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`,
  );
const respuestaToken = (token = TOKEN) =>
  sobre(
    'getToken',
    `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>${token}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`,
  );
const respuestaEstado = (trackId: string) =>
  sobre(
    'getEstUp',
    '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TIPO_DOCTO>39</TIPO_DOCTO>' +
      '<INFORMADOS>5</INFORMADOS><ACEPTADOS>4</ACEPTADOS><RECHAZADOS>1</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>' +
      `<SII:RESP_HDR><TRACKID>${trackId}</TRACKID><ESTADO>EPR</ESTADO><GLOSA>Envio Procesado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`,
  );
const faultSoap = (codigo: string, texto: string) =>
  '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
  `<soapenv:Fault><faultcode>${codigo}</faultcode><faultstring>${texto}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
const respuestaUpload = (cuerpo: string) =>
  `<?xml version="1.0"?>\n<RECEPCIONDTE>\n<RUTSENDER>11111111-1</RUTSENDER>\n<RUTCOMPANY>76543210-3</RUTCOMPANY>\n<FILE>envio.xml</FILE>\n<TIMESTAMP>2026-11-06 10:00:00</TIMESTAMP>\n${cuerpo}\n</RECEPCIONDTE>`;

function cliente(
  respuestas: Record<string, RespuestaFalsa>,
  opciones: { ambiente?: Ambiente; urlBase?: string } = {},
): { cliente: ClienteDtews; transporte: TransporteFalso } {
  const transporte = new TransporteFalso(respuestas);
  return {
    transporte,
    cliente: new ClienteDtews(credenciales, {
      ambiente: opciones.ambiente ?? 'certificacion',
      transporte,
      ...(opciones.urlBase !== undefined ? { urlBase: opciones.urlBase } : {}),
    }),
  };
}

const RESPUESTAS_TOKEN = {
  '*/DTEWS/CrSeed.jws': respuestaSemilla(),
  '*/DTEWS/GetTokenFromSeed.jws': respuestaToken(),
};

async function capturar(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba un error');
}

function extraer(xml: string, etiqueta: string): string {
  const m = new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`).exec(xml);
  if (m?.[1] === undefined) throw new Error(`No se encontró <${etiqueta}>`);
  return m[1];
}

// --- Firma de la semilla ------------------------------------------------------

describe('firmarSemillaDtews (firma propia del PHP, no canónica)', () => {
  const xml = firmarSemillaDtews(SEMILLA, cert.llave.pem, cert.pem);
  const signedInfo = /<SignedInfo[\s\S]*?<\/SignedInfo>/.exec(xml)?.[0] ?? '';

  it('arma el XML con el layout exacto del PHP', () => {
    const jwk = cert.llave.objeto.export({ format: 'jwk' });
    const modulus = Buffer.from(jwk.n ?? '', 'base64url').toString('base64');
    const exponent = Buffer.from(jwk.e ?? '', 'base64url').toString('base64');
    const firma = extraer(xml, 'SignatureValue');

    expect(xml).toBe(
      '<?xml version="1.0"?>\n<getToken>\n<item>\n' +
        `<Semilla>${SEMILLA}</Semilla>\n</item>\n<Signature xmlns="${DSIG}">\n` +
        `${signedInfo}\n<SignatureValue>${firma}</SignatureValue>\n<KeyInfo>\n<KeyValue>\n<RSAKeyValue>\n` +
        `<Modulus>${modulus}</Modulus>\n<Exponent>${exponent}</Exponent>\n</RSAKeyValue>\n</KeyValue>\n` +
        `<X509Data>\n<X509Certificate>${cert.pem}</X509Certificate>\n</X509Data>\n</KeyInfo>\n</Signature>\n</getToken>`,
    );
  });

  it('el SignedInfo va en una línea, con los elementos vacíos cerrados con />', () => {
    const digest = createHash('sha1')
      .update(`<getToken><item><Semilla>${SEMILLA}</Semilla></item></getToken>`)
      .digest('base64');
    expect(signedInfo).toBe(
      `<SignedInfo xmlns="${DSIG}"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `<SignatureMethod Algorithm="${DSIG}rsa-sha1"/><Reference URI=""><Transforms>` +
        `<Transform Algorithm="${DSIG}enveloped-signature"/></Transforms>` +
        `<DigestMethod Algorithm="${DSIG}sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`,
    );
  });

  it('firma el SignedInfo tal como está escrito, no su forma C14N', () => {
    const firma = Buffer.from(extraer(xml, 'SignatureValue'), 'base64');
    const clave = createPublicKey(cert.pem);
    expect(verify('sha1', Buffer.from(signedInfo, 'utf8'), clave, firma)).toBe(true);
    const canonico = signedInfo.replace(/<(\w+)([^<>]*)\/>/g, '<$1$2></$1>');
    expect(verify('sha1', Buffer.from(canonico, 'utf8'), clave, firma)).toBe(false);
  });

  it('pone el certificado tal cual (PEM con encabezados y saltos), a diferencia de firmarSemilla', () => {
    expect(extraer(xml, 'X509Certificate')).toBe(cert.pem);
    expect(cert.pem.startsWith('-----BEGIN CERTIFICATE-----\n')).toBe(true);

    const rest = new FirmaElectronica(cert.llave.pem, cert.pem).firmarSemilla(SEMILLA);
    expect(extraer(rest, 'X509Certificate')).not.toContain('BEGIN');
    // El mismo digest (semilla numérica), distinta firma (C14N vs. string literal).
    expect(extraer(rest, 'DigestValue')).toBe(extraer(xml, 'DigestValue'));
    expect(extraer(rest, 'SignatureValue')).not.toBe(extraer(xml, 'SignatureValue'));
  });

  it('acepta un KeyObject', () => {
    expect(firmarSemillaDtews(SEMILLA, cert.llave.objeto, cert.pem)).toBe(xml);
  });

  it.each(['', '12a', ' 123', '123\n', '<x/>'])('rechaza la semilla %j', (semilla) => {
    expect(() => firmarSemillaDtews(semilla, cert.llave.pem, cert.pem)).toThrow(ErrorValidacion);
  });

  it('una llave ilegible o que no es RSA lanza ErrorFirma (sin el PEM en el mensaje)', () => {
    const malo = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----';
    const error = (() => {
      try {
        firmarSemillaDtews(SEMILLA, malo, cert.pem);
      } catch (e) {
        return e as Error;
      }
      throw new Error('no lanzó');
    })();
    expect(error).toBeInstanceOf(ErrorFirma);
    expect(error.message).not.toContain('BEGIN');

    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => firmarSemillaDtews(SEMILLA, privateKey, cert.pem)).toThrow(ErrorFirma);
  });

  it('sobreGetToken escapa con htmlspecialchars por defecto dentro de <pszXml>', () => {
    expect(sobreGetToken(`<a b="1">'&'</a>`)).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/>' +
        '<soapenv:Body><getToken><pszXml>&lt;a b=&quot;1&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;</pszXml>' +
        '</getToken></soapenv:Body></soapenv:Envelope>',
    );
  });
});

// --- Constructor y URLs -------------------------------------------------------

describe('ClienteDtews: ambiente y URLs', () => {
  it.each([
    ['certificacion', 'maullin.sii.cl'],
    ['produccion', 'palena.sii.cl'],
  ] as const)('%s usa %s', async (ambiente, host) => {
    const { cliente: c, transporte } = cliente(RESPUESTAS_TOKEN, { ambiente });
    await c.solicitarToken();
    expect(transporte.urls()).toEqual([
      `https://${host}/DTEWS/CrSeed.jws`,
      `https://${host}/DTEWS/GetTokenFromSeed.jws`,
    ]);
  });

  it('urlBase (solo pruebas) reemplaza el host, con o sin / final', async () => {
    const { cliente: c, transporte } = cliente(RESPUESTAS_TOKEN, {
      urlBase: 'https://127.0.0.1:8443/',
    });
    await c.solicitarToken();
    expect(transporte.urls()[0]).toBe('https://127.0.0.1:8443/DTEWS/CrSeed.jws');
  });

  it.each(['no es url', 'ftp://captura.local'])(
    'urlBase inválida %j lanza ErrorValidacion',
    (u) => {
      expect(() => cliente({}, { urlBase: u })).toThrow(ErrorValidacion);
    },
  );

  it('un ambiente desconocido lanza', () => {
    expect(() => cliente({}, { ambiente: 'pruebas' as Ambiente })).toThrow(TypeError);
  });

  it('una llave ilegible lanza ErrorFirma al construir', () => {
    expect(
      () =>
        new ClienteDtews(
          { llavePrivada: 'nada', certificado: cert.pem },
          { ambiente: 'certificacion', transporte: new TransporteFalso() },
        ),
    ).toThrow(ErrorFirma);
  });
});

// --- Semilla y token ----------------------------------------------------------

describe('ClienteDtews: semilla y token', () => {
  it('pide la semilla con las cabeceras de file_get_contents del PHP', async () => {
    const { cliente: c, transporte } = cliente(RESPUESTAS_TOKEN);
    expect(await c.obtenerSemilla()).toBe(SEMILLA);

    const [p] = transporte.enviadas;
    expect(p?.metodo).toBe('POST');
    expect(p?.cabeceras).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    });
    expect(Object.keys(p?.cabeceras ?? {})).toEqual(['Content-Type', 'SOAPAction']);
    expect(p?.conexionNueva).toBe(false);
    expect(p?.tls).toBe(false);
    expect(p?.bytes?.toString('utf8')).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/>' +
        '<soapenv:Body><getSeed/></soapenv:Body></soapenv:Envelope>',
    );
  });

  it('canjea el token con la semilla firmada como el PHP', async () => {
    const { cliente: c, transporte } = cliente(RESPUESTAS_TOKEN);
    expect(await c.solicitarToken()).toBe(TOKEN);

    const p = transporte.enviadas[1];
    expect(p?.cabeceras).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    });
    expect(p?.conexionNueva).toBe(false);
    expect(p?.bytes?.toString('utf8')).toBe(
      sobreGetToken(firmarSemillaDtews(SEMILLA, cert.llave.pem, cert.pem)),
    );
  });

  it('solicitarToken no cachea: cada llamada pide semilla y token', async () => {
    const { cliente: c, transporte } = cliente(RESPUESTAS_TOKEN);
    await c.solicitarToken();
    await c.solicitarToken();
    expect(transporte.enviadas).toHaveLength(4);
  });

  it('decodifica entidades como html_entity_decode antes de buscar (numéricas y con nombre)', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': '<x>&#60;SEMILLA&#x3E;0042&lt;/SEMILLA&gt;</x>',
      '*/DTEWS/GetTokenFromSeed.jws': '&lt;TOKEN&gt;AB&amp;C&eacute;&lt;/TOKEN&gt;',
    });
    expect(await c.obtenerSemilla()).toBe('0042');
    // `é` no es ASCII: el token se rechaza (el PHP lo habría usado en la cookie).
    expect(await capturar(c.solicitarToken())).toBeInstanceOf(ErrorRespuestaSii);
  });

  it('toma el primer <TOKEN> y no cruza saltos de línea (el . de PCRE)', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': respuestaSemilla(),
      '*/DTEWS/GetTokenFromSeed.jws':
        '<TOKEN>A\nB</TOKEN><TOKEN>&amp;OK&#33;</TOKEN><TOKEN>OTRO</TOKEN>',
    });
    expect(await c.solicitarToken()).toBe('&OK!');
  });

  it('sin <SEMILLA> numérica: ErrorRespuestaSii con el ESTADO y la GLOSA', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': sobre(
        'getSeed',
        '<SII:RESPUESTA><SII:RESP_BODY><SEMILLA>12a</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>-1</ESTADO><GLOSA>Error interno</GLOSA></SII:RESP_HDR></SII:RESPUESTA>',
      ),
    });
    const error = await capturar(c.obtenerSemilla());
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error).toMatchObject({ estado: '-1', glosa: 'Error interno' });
    expect(error.message).toBe('El SII no entregó la semilla (ESTADO -1: Error interno).');
  });

  it('respuesta vacía o irreconocible: lo dice sin volcarla entera', async () => {
    const { cliente: c } = cliente({ '*/DTEWS/CrSeed.jws': '' });
    expect((await capturar(c.obtenerSemilla())).message).toBe(
      'El SII no entregó la semilla: respuesta vacía.',
    );

    const largo = `<html><body>${'Mantención '.repeat(50)}</body></html>`;
    const { cliente: c2 } = cliente({ '*/DTEWS/CrSeed.jws': largo });
    const error = await capturar(c2.obtenerSemilla());
    expect(error.message).not.toContain('<html>');
    expect(error.message.length).toBeLessThan(260);
    expect(error.message).toMatch(/^El SII no entregó la semilla: Mantención .*…\.$/);
  });

  it('sin <TOKEN>: ErrorRespuestaSii con el ESTADO (p. ej. 11, firma rechazada) y sin el XML firmado', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': respuestaSemilla(),
      '*/DTEWS/GetTokenFromSeed.jws': sobre(
        'getToken',
        "<SII:RESPUESTA><SII:RESP_HDR><ESTADO>11</ESTADO><GLOSA>ERROR DE FIRMA (elemento 'Certificate' no existe)</GLOSA></SII:RESP_HDR></SII:RESPUESTA>",
      ),
    });
    const error = await capturar(c.solicitarToken());
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error).toMatchObject({
      estado: '11',
      glosa: "ERROR DE FIRMA (elemento 'Certificate' no existe)",
    });
    expect(error.message).not.toContain('Signature');
  });

  it('un <TOKEN> vacío es un error (el PHP lo devolvía)', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': respuestaSemilla(),
      '*/DTEWS/GetTokenFromSeed.jws': respuestaToken(''),
    });
    const error = await capturar(c.solicitarToken());
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.message).toBe('El SII entregó un token vacío o con caracteres inesperados.');
  });

  it('fault SOAP con HTTP 500: ErrorRespuestaSii con faultcode y faultstring', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': new RespuestaHttp(
        500,
        {},
        faultSoap('soapenv:Server.userException', 'java.lang.NullPointerException'),
      ),
    });
    const error = await capturar(c.obtenerSemilla());
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error).toMatchObject({
      estado: 'soapenv:Server.userException',
      glosa: 'java.lang.NullPointerException',
    });
    expect(error.message).toBe(
      'El SII respondió con un error SOAP (HTTP 500) al pedir la semilla: java.lang.NullPointerException.',
    );
  });

  it.each([500, 502, 404, 302])(
    'HTTP %i sin fault: ErrorTransporte con el status',
    async (status) => {
      const { cliente: c } = cliente({
        '*/DTEWS/CrSeed.jws': new RespuestaHttp(status, { location: '/otra' }, respuestaSemilla()),
      });
      const error = await capturar(c.obtenerSemilla());
      expect(error).toBeInstanceOf(ErrorTransporte);
      expect(error).toMatchObject({ status, url: 'https://maullin.sii.cl/DTEWS/CrSeed.jws' });
    },
  );

  it('falla de red: ErrorTransporte con el paso, la URL y la causa', async () => {
    const original = new ErrorTransporte(
      'maullin.sii.cl: tiempo agotado',
      'https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws',
    );
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': respuestaSemilla(),
      '*/DTEWS/GetTokenFromSeed.jws': () => {
        throw original;
      },
    });
    const error = await capturar(c.solicitarToken());
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.message).toBe(
      'No se pudo conectar con maullin.sii.cl para canjear el token: maullin.sii.cl: tiempo agotado',
    );
    expect(error).toMatchObject({ status: undefined, url: original.url });
    expect(error.cause).toBe(original);
  });

  it('otros errores del transporte pasan tal cual', async () => {
    const otro = new TypeError('roto');
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': () => {
        throw otro;
      },
    });
    expect(await capturar(c.obtenerSemilla())).toBe(otro);
  });

  it('acepta un cuerpo en ISO-8859-1', async () => {
    const { cliente: c } = cliente({
      '*/DTEWS/CrSeed.jws': Buffer.from(
        '<x>&lt;GLOSA&gt;Semilla inválida&lt;/GLOSA&gt;&lt;ESTADO&gt;-2&lt;/ESTADO&gt;</x>',
        'latin1',
      ),
    });
    expect(await capturar(c.obtenerSemilla())).toMatchObject({
      estado: '-2',
      glosa: 'Semilla inválida',
    });
  });
});

// --- Caché de token -----------------------------------------------------------

class StoreMemoria implements TokenStore {
  readonly datos = new Map<string, TokenGuardado>();
  readonly claves: ClaveToken[] = [];
  borrados = 0;
  async obtener(clave: ClaveToken) {
    this.claves.push(clave);
    return this.datos.get(JSON.stringify(clave));
  }
  async guardar(clave: ClaveToken, guardado: TokenGuardado) {
    this.datos.set(JSON.stringify(clave), guardado);
  }
  async borrar(clave: ClaveToken) {
    this.borrados++;
    this.datos.delete(JSON.stringify(clave));
  }
}

describe('ClienteDtews: obtenerToken con caché (misma regla que la API REST)', () => {
  function conStore(store: TokenStore | undefined, reloj: () => Date, transporte: TransporteFalso) {
    return new ClienteDtews(credenciales, {
      ambiente: 'certificacion',
      transporte,
      reloj: { ahora: reloj },
      ...(store !== undefined ? { tokenStore: store } : {}),
    });
  }
  const huella = huellaCertificado(cert.pem);

  it('guarda el token con clave soap + ambiente + empresa + huella y lo reutiliza mientras vence', async () => {
    const store = new StoreMemoria();
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const ahora = new Date('2026-11-06T12:00:00Z');
    const c = conStore(store, () => ahora, transporte);

    expect(await c.obtenerToken('76.543.210-3')).toBe(TOKEN);
    expect(await c.obtenerToken(Rut.de('76543210-3'))).toBe(TOKEN);
    expect(transporte.enviadas).toHaveLength(2);

    expect(store.claves[0]).toEqual({
      canal: 'soap',
      ambiente: 'certificacion',
      rutEmpresa: '76543210-3',
      huellaCertificado: huella,
    });
    expect(c.claveToken('76543210-3')).toEqual(store.claves[0]);
    const [guardado] = store.datos.values();
    expect(guardado?.venceEn.getTime()).toBe(ahora.getTime() + SEGUNDOS_VIGENCIA_TOKEN * 1000);
  });

  it('la vigencia corre desde que se recibió el token', async () => {
    const store = new StoreMemoria();
    let ms = Date.parse('2026-11-06T12:00:00Z');
    const transporte = new TransporteFalso({
      ...RESPUESTAS_TOKEN,
      '*/DTEWS/GetTokenFromSeed.jws': () => {
        ms += 5000;
        return respuestaToken();
      },
    });
    const c = conStore(store, () => new Date(ms), transporte);
    await c.obtenerToken('76543210-3');
    const [guardado] = store.datos.values();
    expect(guardado?.venceEn.getTime()).toBe(ms + SEGUNDOS_VIGENCIA_TOKEN * 1000);
  });

  it('pide otro cuando el guardado venció o no sirve para la cookie', async () => {
    const store = new StoreMemoria();
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const ahora = new Date('2026-11-06T12:00:00Z');
    const c = conStore(store, () => ahora, transporte);
    const clave = c.claveToken('76543210-3');

    await store.guardar(clave, { token: 'VIEJO', venceEn: ahora });
    expect(await c.obtenerToken('76543210-3')).toBe(TOKEN);
    await store.guardar(clave, { token: 'CON;PUNTOYCOMA', venceEn: new Date(ahora.getTime() + 1) });
    expect(await c.obtenerToken('76543210-3')).toBe(TOKEN);
    expect(transporte.enviadas).toHaveLength(4);
  });

  it('dos llamadas simultáneas para la misma empresa comparten un pedido', async () => {
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const c = conStore(undefined, () => new Date(), transporte);
    const [a, b] = await Promise.all([c.obtenerToken('76543210-3'), c.obtenerToken('76543210-3')]);
    expect([a, b]).toEqual([TOKEN, TOKEN]);
    expect(transporte.enviadas).toHaveLength(2);
  });

  it('por defecto usa un TokenStoreMemoria propio, separado por empresa', async () => {
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const c = conStore(undefined, () => new Date(), transporte);
    await c.obtenerToken('76543210-3');
    await c.obtenerToken('76543210-3');
    expect(transporte.enviadas).toHaveLength(2);
    await c.obtenerToken('76000006-K');
    expect(transporte.enviadas).toHaveLength(4);
  });

  it('olvidarToken borra el de esa empresa', async () => {
    const store = new StoreMemoria();
    const c = conStore(store, () => new Date(), new TransporteFalso(RESPUESTAS_TOKEN));
    await c.obtenerToken('76543210-3');
    await c.olvidarToken('76543210-3');
    expect(store.borrados).toBe(1);
    expect(store.datos.size).toBe(0);
  });

  it('funciona con un TokenStoreMemoria y con un Certificado', async () => {
    const certificado = Certificado.desdeContenido(`${cert.llave.pem}${cert.pem}`);
    const store = new TokenStoreMemoria();
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const c = new ClienteDtews(certificado, {
      ambiente: 'produccion',
      transporte,
      tokenStore: store,
      reloj: relojFijo('2026-11-06T12:00:00Z'),
    });
    expect(await c.obtenerToken('76543210-3')).toBe(TOKEN);
    expect(store.tamano).toBe(1);
    expect(c.claveToken('76543210-3')).toMatchObject({
      ambiente: 'produccion',
      huellaCertificado: huella,
    });
    // El <X509Certificate> lleva el PEM del Certificado tal cual.
    const enviado = transporte.enviadas[1]?.bytes?.toString('utf8') ?? '';
    expect(enviado).toContain(escaparXml(certificado.certificado, 'defecto'));
  });

  it('la huella también sale de un certificado en base64 limpio (la misma)', () => {
    const limpio = cert.pem.replace(/-----[^-]+-----|\s/g, '');
    const c = new ClienteDtews(
      { llavePrivada: cert.llave.pem, certificado: limpio },
      { ambiente: 'certificacion', transporte: new TransporteFalso() },
    );
    expect(c.claveToken('76543210-3').huellaCertificado).toBe(huella);
  });

  it('un certificado ilegible lanza ErrorCertificado y un RUT inválido ErrorValidacion (sin red)', async () => {
    const transporte = new TransporteFalso(RESPUESTAS_TOKEN);
    const malo = new ClienteDtews(
      { llavePrivada: cert.llave.pem, certificado: 'no es un certificado' },
      { ambiente: 'certificacion', transporte },
    );
    expect(await capturar(malo.obtenerToken('76543210-3'))).toBeInstanceOf(ErrorCertificado);
    const c = conStore(undefined, () => new Date(), transporte);
    expect(await capturar(c.obtenerToken('76543210-4'))).toBeInstanceOf(ErrorValidacion);
    expect(transporte.enviadas).toHaveLength(0);
  });
});

// --- DTEUpload ----------------------------------------------------------------

describe('ClienteDtews: enviarDte (DTEUpload)', () => {
  const xml = Buffer.from(
    '<?xml version="1.0" encoding="ISO-8859-1"?><EnvioBOLETA>Ñuñoa</EnvioBOLETA>',
    'latin1',
  );
  const archivo = {
    rutEmisor: '76543210-3',
    rutEnvia: '11111111-1',
    xml,
    nombreArchivo: 'envio_set_boletas.xml',
  };
  const ok = respuestaUpload('<STATUS>0</STATUS>\n<TRACKID>0123456789</TRACKID>');

  it('sube el multipart con las cabeceras del cURL del PHP y devuelve el TrackID', async () => {
    const { cliente: c, transporte } = cliente({ 'maullin.sii.cl/cgi_dte/UPL/DTEUpload': ok });
    expect(await c.enviarDte(TOKEN, archivo)).toBe('0123456789');

    const [p] = transporte.enviadas;
    expect(p?.url).toBe('https://maullin.sii.cl/cgi_dte/UPL/DTEUpload');
    expect(p?.metodo).toBe('POST');
    expect(p?.conexionNueva).toBe(true);
    const contentType = p?.cabeceras['Content-Type'] ?? '';
    const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(contentType)?.[1] ?? '';
    expect(boundary).not.toBe('');
    expect(p?.cabeceras).toEqual({
      Accept: '*/*',
      Cookie: `TOKEN=${TOKEN}`,
      'User-Agent': 'Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.1)',
      'Content-Type': contentType,
    });
    expect(USER_AGENT_DTEUPLOAD).toBe('Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.1)');

    const esperado = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="rutSender"\r\n\r\n11111111\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="dvSender"\r\n\r\n1\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="rutCompany"\r\n\r\n76543210\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="dvCompany"\r\n\r\n3\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="envio_set_boletas.xml"\r\n` +
          'Content-Type: text/xml\r\n\r\n',
        'latin1',
      ),
      xml,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
    ]);
    expect(p?.bytes?.equals(esperado)).toBe(true);
    // Lo mismo que arma el helper compartido con ese boundary.
    expect(
      p?.bytes?.equals(
        armarMultipart(
          [
            { nombre: 'rutSender', valor: '11111111' },
            { nombre: 'dvSender', valor: '1' },
            { nombre: 'rutCompany', valor: '76543210' },
            { nombre: 'dvCompany', valor: '3' },
            {
              nombre: 'archivo',
              archivo: xml,
              nombreArchivo: 'envio_set_boletas.xml',
              contentType: 'text/xml',
            },
          ],
          boundary,
        ).datos,
      ),
    ).toBe(true);
  });

  it('en producción sube a palena', async () => {
    const { cliente: c, transporte } = cliente(
      { '*/cgi_dte/UPL/DTEUpload': ok },
      { ambiente: 'produccion' },
    );
    await c.enviarDte(TOKEN, archivo);
    expect(transporte.urls()).toEqual(['https://palena.sii.cl/cgi_dte/UPL/DTEUpload']);
  });

  it('normaliza los RUT (puntos, k minúscula) y acepta Rut', async () => {
    const { cliente: c, transporte } = cliente({ '*/cgi_dte/UPL/DTEUpload': ok });
    await c.enviarDte(TOKEN, {
      ...archivo,
      rutEmisor: '76.000.006-k',
      rutEnvia: Rut.de('11.111.111-1'),
    });
    const cuerpo = transporte.enviadas[0]?.bytes?.toString('latin1') ?? '';
    expect(cuerpo).toContain('name="rutCompany"\r\n\r\n76000006\r\n');
    expect(cuerpo).toContain('name="dvCompany"\r\n\r\nK\r\n');
    expect(cuerpo).toContain('name="rutSender"\r\n\r\n11111111\r\n');
  });

  it.each([
    [{ rutEmisor: '76543210-4' }, 'RUT del emisor'],
    [{ rutEnvia: 'abc' }, 'RUT de quien envía'],
    [{ nombreArchivo: '' }, 'nombre del archivo'],
    [{ nombreArchivo: 'data/output/envio.xml' }, 'nombre del archivo'],
    [{ nombreArchivo: 'C:\\envio.xml' }, 'nombre del archivo'],
  ])('entrada inválida %j: ErrorValidacion y no envía nada', async (cambio, texto) => {
    const { cliente: c, transporte } = cliente({ '*': ok });
    const error = await capturar(c.enviarDte(TOKEN, { ...archivo, ...cambio }));
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect(error.message).toContain(texto);
    expect(transporte.enviadas).toHaveLength(0);
  });

  it.each(['', 'TOKEN\r\nX-Inyectada: 1', 'con espacio', 'ñ'])(
    'token inválido %j: ErrorValidacion sin el token en el mensaje',
    async (token) => {
      const { cliente: c, transporte } = cliente({ '*': ok });
      const error = await capturar(c.enviarDte(token, archivo));
      expect(error).toBeInstanceOf(ErrorValidacion);
      if (token !== '') expect(error.message).not.toContain(token);
      expect(transporte.enviadas).toHaveLength(0);
    },
  );

  it('STATUS distinto de 0: ErrorRespuestaSii con el STATUS y su glosa', async () => {
    const { cliente: c } = cliente({ '*': respuestaUpload('<STATUS>5</STATUS>') });
    const error = await capturar(c.enviarDte(TOKEN, archivo));
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error).toMatchObject({
      estado: '5',
      glosa: 'no está autenticado (token inválido o vencido)',
    });
    expect(error.message).toBe(
      'El SII no devolvió el TrackID del archivo subido (STATUS 5: no está autenticado (token inválido o vencido)).',
    );
  });

  it('con <DETAIL>, la glosa son los <ERROR> del SII', async () => {
    const { cliente: c } = cliente({
      '*': respuestaUpload(
        '<STATUS>7</STATUS>\n<DETAIL>\n<ERROR>Error en linea 3</ERROR>\n<ERROR>Elemento TmstFirma</ERROR>\n</DETAIL>',
      ),
    });
    expect(await capturar(c.enviarDte(TOKEN, archivo))).toMatchObject({
      estado: '7',
      glosa: 'Error en linea 3; Elemento TmstFirma',
    });
  });

  it('un STATUS desconocido queda sin glosa', async () => {
    const { cliente: c } = cliente({ '*': respuestaUpload('<STATUS>99</STATUS>') });
    const error = await capturar(c.enviarDte(TOKEN, archivo));
    expect(error).toMatchObject({ estado: '99', glosa: undefined });
    expect(error.message).toBe('El SII no devolvió el TrackID del archivo subido (STATUS 99).');
  });

  it('un TrackID no numérico es un error (el PHP lo devolvía)', async () => {
    const { cliente: c } = cliente({ '*': '<TRACKID>abc</TRACKID>' });
    expect((await capturar(c.enviarDte(TOKEN, archivo))).message).toBe(
      'El SII no devolvió el TrackID del archivo subido (el TrackID no es numérico).',
    );
  });

  it('una respuesta HTML no vuelca el token, el PEM ni el HTML', async () => {
    const html =
      `<html><head><title>Error</title></head><body>Sesión inválida para TOKEN=${TOKEN}` +
      `<pre>${cert.pem}</pre><p>${'A'.repeat(60)}</p></body></html>`;
    const { cliente: c } = cliente({ '*': html });
    const error = await capturar(c.enviarDte(TOKEN, archivo));
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.message).toBe(
      'El SII no devolvió el TrackID del archivo subido: Error Sesión inválida para TOKEN=[omitido] [PEM omitido] [omitido].',
    );
  });

  it.each([500, 503, 302])('HTTP %i: ErrorTransporte con el status', async (status) => {
    const { cliente: c } = cliente({ '*': new RespuestaHttp(status, {}, ok) });
    expect(await capturar(c.enviarDte(TOKEN, archivo))).toMatchObject({
      name: 'ErrorTransporte',
      status,
    });
  });

  it('falla de red: ErrorTransporte con el paso', async () => {
    const { cliente: c } = cliente({
      '*': () => {
        throw new ErrorTransporte('maullin.sii.cl: conexión rechazada', 'https://maullin.sii.cl/x');
      },
    });
    const error = await capturar(c.enviarDte(TOKEN, archivo));
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.message).toContain('para subir el archivo');
  });
});

// --- Estado del envío ---------------------------------------------------------

describe('ClienteDtews: estadoEnvio (QueryEstUp)', () => {
  const sobreEstado = (rut: string, dv: string, trackId: string, token: string) =>
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
    '<ns:getEstUp xmlns:ns="http://DefaultNamespace">' +
    `<RutCompania>${rut}</RutCompania><DvCompania>${dv}</DvCompania>` +
    `<TrackId>${trackId}</TrackId><Token>${token}</Token>` +
    '</ns:getEstUp></soapenv:Body></soapenv:Envelope>';

  it('consulta con el sobre exacto del PHP y lee el estado', async () => {
    const { cliente: c, transporte } = cliente({
      'maullin.sii.cl/DTEWS/QueryEstUp.jws': respuestaEstado('987'),
    });
    const estado = await c.estadoEnvio(TOKEN, '76000006-k', '987');

    expect(estado).toMatchObject({
      trackId: '987',
      estado: 'EPR',
      informados: 5,
      aceptados: 4,
      rechazados: 1,
    });
    const [p] = transporte.enviadas;
    expect(p?.url).toBe('https://maullin.sii.cl/DTEWS/QueryEstUp.jws');
    expect(p?.cabeceras).toEqual({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    });
    expect(p?.conexionNueva).toBe(false);
    expect(p?.bytes?.toString('utf8')).toBe(sobreEstado('76000006', 'K', '987', TOKEN));
  });

  it('escapa el token con htmlspecialchars por defecto', async () => {
    const { cliente: c, transporte } = cliente({ '*': respuestaEstado('1') });
    await c.estadoEnvio(`A&B<C>"D'E`, Rut.de('76543210-3'), '1');
    expect(transporte.enviadas[0]?.bytes?.toString('utf8')).toBe(
      sobreEstado('76543210', '3', '1', 'A&amp;B&lt;C&gt;&quot;D&#039;E'),
    );
  });

  it.each(['', 'abc', '12 3', '1234567890123456', '123\n', '-1'])(
    'TrackID inválido %j: ErrorValidacion y no consulta',
    async (trackId) => {
      const { cliente: c, transporte } = cliente({ '*': respuestaEstado('1') });
      expect(await capturar(c.estadoEnvio(TOKEN, '76543210-3', trackId))).toBeInstanceOf(
        ErrorValidacion,
      );
      expect(transporte.enviadas).toHaveLength(0);
    },
  );

  it('RUT o token inválidos: ErrorValidacion y no consulta', async () => {
    const { cliente: c, transporte } = cliente({ '*': respuestaEstado('1') });
    expect(await capturar(c.estadoEnvio(TOKEN, '76543210-0', '1'))).toBeInstanceOf(ErrorValidacion);
    expect(await capturar(c.estadoEnvio('', '76543210-3', '1'))).toBeInstanceOf(ErrorValidacion);
    expect(transporte.enviadas).toHaveLength(0);
  });

  it('503 (maullin ocupado): ErrorTransporte con status 503 para reintentar', async () => {
    const { cliente: c } = cliente({
      '*': new RespuestaHttp(503, {}, '<html><body>Service Unavailable</body></html>'),
    });
    const error = await capturar(c.estadoEnvio(TOKEN, '76543210-3', '1'));
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error).toMatchObject({
      status: 503,
      url: 'https://maullin.sii.cl/DTEWS/QueryEstUp.jws',
    });
  });

  it('fault SOAP: ErrorRespuestaSii sin el token aunque el fault lo repita', async () => {
    const { cliente: c } = cliente({
      '*': new RespuestaHttp(500, {}, faultSoap('soapenv:Server', `Token ${TOKEN} no existe`)),
    });
    const error = await capturar(c.estadoEnvio(TOKEN, '76543210-3', '1'));
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error).toMatchObject({ estado: 'soapenv:Server', glosa: 'Token [omitido] no existe' });
    expect(error.message).not.toContain(TOKEN);
  });

  it('200 sin getEstUpReturn: ErrorRespuestaSii con un extracto sin etiquetas ni token', async () => {
    const { cliente: c } = cliente({
      '*': `<html><body><h1>Error</h1>\n<p>TOKEN ${TOKEN} &eacute;rr&oacute;neo</p></body></html>`,
    });
    const error = await capturar(c.estadoEnvio(TOKEN, '76543210-3', '42'));
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.message).toBe(
      'El SII no respondió el estado del envío 42: Error TOKEN [omitido] érróneo.',
    );
  });

  it('getEstUpReturn sin ESTADO: el error tipado de EstadoEnvio', async () => {
    const { cliente: c } = cliente({ '*': sobre('getEstUp', '<SII:RESPUESTA/>') });
    const error = await capturar(c.estadoEnvio(TOKEN, '76543210-3', '42'));
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.message).toBe('El SII no devolvió el estado del envío 42.');
  });
});

// --- Utilidades ---------------------------------------------------------------

describe('decodificarEntidadesHtml (html_entity_decode de PHP 8.3)', () => {
  // Salidas tomadas de PHP 8.3.
  it.each([
    ['&apos;|&#39;|&#039;|&quot;|&AMP;', "&apos;|'|'|\"|&AMP;"],
    ['&nbsp;|&eacute;|&Eacute;|&euro;|&diams;', '\u00a0|é|É|€|♦'],
    ['&#x0x41;|&#0065;|&#X42;', 'A|A|B'],
    ['&#128;|&#159;|&#127;|&#1;|&#0;|&#xD800;', '&#128;|&#159;|&#127;|&#1;|&#0;|&#xD800;'],
    [
      '&#13;|&#9;|&#160;|&#xFDD0;|&#xFFFE;|&#x10FFFF;|&#x110000;',
      '\r|\t|\u00a0|\ufdd0|\ufffe|\u{10ffff}|&#x110000;',
    ],
    ['&lt;TOKEN&gt;|&#60;|&amp;lt;|&&lt;|&#12a;|&lt|&foo;', '<TOKEN>|<|&lt;|&<|&#12a;|&lt|&foo;'],
    ['&thetasym;&ETH;&eth;&sup1;&sup;&lang;', 'ϑÐð¹⊃〈'],
  ])('%j', (entrada, salida) => {
    expect(decodificarEntidadesHtml(entrada)).toBe(salida);
  });
});

describe('sanear', () => {
  it('quita secretos, PEM, etiquetas y tiras base64; colapsa blancos y trunca a 200', () => {
    expect(sanear('  <b>hola</b>\n\n  SECRETO  mundo ', ['SECRETO', ''])).toBe(
      'hola [omitido] mundo',
    );
    expect(sanear('x -----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE----- y', [])).toBe(
      'x [PEM omitido] y',
    );
    expect(sanear('x -----BEGIN PRIVATE KEY-----\nAAA cortado', [])).toBe('x [PEM omitido]');
    expect(sanear(`firma ${'Ab+/'.repeat(10)}= fin`, [])).toBe('firma [omitido] fin');
    const largo = sanear('ñ'.repeat(300), []);
    expect([...largo]).toHaveLength(201);
    expect(largo.endsWith('…')).toBe(true);
  });
});
