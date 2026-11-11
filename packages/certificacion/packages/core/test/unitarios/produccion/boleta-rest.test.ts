// Tests de ClienteBoletaRest (port de src/Produccion/SiiBoletaProduccion.php de
// winex/certificacion v1.9.1, que no tenía tests: pend. 6.1). Todo pasa por el
// TransporteFalso: ninguna petición sale a la red.
//
// Las respuestas de fixtures/ tienen la forma de las reales del SII, pero los RUT,
// trackid, tokens, semillas y fechas son de mentira.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorRespuestaSii, ErrorTransporte, ErrorValidacion } from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import type { TransporteHttp } from '../../../src/comun/http/transporte.ts';
import {
  type PeticionRegistrada,
  type RespuestaFalsa,
  TransporteFalso,
} from '../../../src/comun/http/transporte-falso.ts';
import { type Reloj, relojFijo } from '../../../src/comun/reloj.ts';
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
import {
  ClienteBoletaRest,
  EstadoEnvioRest,
  NOMBRE_ARCHIVO_BOLETA,
  NOMBRE_ARCHIVO_RCOF,
  type OpcionesClienteBoletaRest,
  SEGUNDOS_VIGENCIA_TOKEN,
  URLS_BOLETA_REST,
  USER_AGENT_BOLETA_REST,
} from '../../../src/produccion/boleta-rest.ts';
import {
  certificado as certificadoPrueba,
  llave as llavePrueba,
} from '../../soporte/criptografia.ts';
import { material } from '../../soporte/paridad.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (nombre: string) => readFileSync(join(FIXTURES, nombre));

const SEMILLA_XML = fixture('semilla.xml').toString('utf8');
const TOKEN_XML = fixture('token.xml').toString('utf8');
const TOKEN = 'TOKENFALSO0123456789';
const SEMILLA = '012345678901';

const { llave, certificado } = material('base');
const cert = Certificado.desdeContenido(`${llave}\n${certificado}`);

const EMISOR = '76543210-3';
const ENVIA = '11111111-1';
const BOUNDARY = '------------------------0123456789abcdef';
/** Sobre de mentira en ISO-8859-1, con un byte alto (é = 0xE9) para ver que va tal cual. */
const XML = Buffer.concat([
  Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>\n<EnvioBOLETA>caf', 'latin1'),
  Buffer.from([0xe9]),
  Buffer.from('</EnvioBOLETA>', 'latin1'),
]);

const AUTH_CERT = 'apicert.sii.cl/recursos/v1';
const ENVIO_CERT = 'pangal.sii.cl/recursos/v1';

const RESPUESTAS_AUTH: Record<string, RespuestaFalsa> = {
  [`${AUTH_CERT}/boleta.electronica.semilla`]: SEMILLA_XML,
  [`${AUTH_CERT}/boleta.electronica.token`]: TOKEN_XML,
};

function cliente(
  respuestas: Record<string, RespuestaFalsa> = RESPUESTAS_AUTH,
  opciones: Partial<OpcionesClienteBoletaRest> = {},
): { sii: ClienteBoletaRest; falso: TransporteFalso } {
  const falso = new TransporteFalso(respuestas);
  const sii = new ClienteBoletaRest(cert, {
    ambiente: 'certificacion',
    transporte: falso,
    boundary: () => BOUNDARY,
    ...opciones,
  });
  return { sii, falso };
}

function unica(falso: TransporteFalso): PeticionRegistrada {
  expect(falso.enviadas).toHaveLength(1);
  return falso.enviadas[0] as PeticionRegistrada;
}

async function capturar(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba un error');
}

/** El mensaje y la cadena de causas no pueden nombrar el token. */
function sinToken(error: Error, token = TOKEN): void {
  expect(error.message).not.toContain(token);
  expect(String(error.stack)).not.toContain(token);
}

function multipartEsperado(
  rutSender: string,
  dvSender: string,
  rutCompany: string,
  dvCompany: string,
  nombre: string,
  xml: Buffer,
): Buffer {
  const campo = (n: string, v: string) =>
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  return Buffer.concat([
    Buffer.from(
      campo('rutSender', rutSender) +
        campo('dvSender', dvSender) +
        campo('rutCompany', rutCompany) +
        campo('dvCompany', dvCompany) +
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\n` +
        'Content-Type: text/xml\r\n\r\n',
      'latin1',
    ),
    xml,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1'),
  ]);
}

describe('ClienteBoletaRest: construcción', () => {
  it('URLs por ambiente: api/rahue en producción, apicert/pangal en certificación', () => {
    const falso = new TransporteFalso();
    const prod = new ClienteBoletaRest(cert, { ambiente: 'produccion', transporte: falso });
    expect(prod.urls).toEqual({
      auth: 'https://api.sii.cl/recursos/v1',
      envio: 'https://rahue.sii.cl/recursos/v1',
    });
    const certif = new ClienteBoletaRest(cert, { ambiente: 'certificacion', transporte: falso });
    expect(certif.urls).toEqual({
      auth: 'https://apicert.sii.cl/recursos/v1',
      envio: 'https://pangal.sii.cl/recursos/v1',
    });
    expect(Object.isFrozen(URLS_BOLETA_REST.produccion)).toBe(true);
  });

  it('acepta URLs propias (tests) y les quita la / final', () => {
    const { sii } = cliente(
      {},
      { urls: { auth: 'http://127.0.0.1:8080/auth/', envio: 'http://127.0.0.1:8080/envio//' } },
    );
    expect(sii.urls).toEqual({
      auth: 'http://127.0.0.1:8080/auth',
      envio: 'http://127.0.0.1:8080/envio',
    });
  });

  it('rechaza un ambiente desconocido o URLs inválidas', () => {
    const transporte = new TransporteFalso();
    expect(
      () =>
        new ClienteBoletaRest(cert, {
          ambiente: 'prod' as unknown as 'produccion',
          transporte,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new ClienteBoletaRest(cert, {
          ambiente: 'certificacion',
          transporte,
          urls: { auth: 'no es url', envio: 'https://x.cl' },
        }),
    ).toThrow(TypeError);
  });
});

describe('ClienteBoletaRest.obtenerSemilla', () => {
  it('GET a la semilla con solo Accept: */*, sin Accept-Encoding ni conexión propia', async () => {
    const { sii, falso } = cliente();
    expect(await sii.obtenerSemilla()).toBe(SEMILLA);
    const p = unica(falso);
    expect(p.metodo).toBe('GET');
    expect(p.url).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla');
    expect(p.cabeceras).toEqual({ Accept: '*/*' });
    expect(p.bytes).toBeUndefined();
    expect(p.conexionNueva).toBe(false);
    expect(p.tls).toBe(false);
  });

  it('en producción va a api.sii.cl', async () => {
    const falso = new TransporteFalso({
      'api.sii.cl/recursos/v1/boleta.electronica.semilla': SEMILLA_XML,
    });
    const sii = new ClienteBoletaRest(cert, { ambiente: 'produccion', transporte: falso });
    expect(await sii.obtenerSemilla()).toBe(SEMILLA);
    expect(falso.urls()).toEqual(['https://api.sii.cl/recursos/v1/boleta.electronica.semilla']);
  });

  it('toma la primera <SEMILLA> sin cruzar saltos de línea (como el preg_match del PHP)', async () => {
    const { sii } = cliente({
      [`${AUTH_CERT}/boleta.electronica.semilla`]:
        '<SEMILLA>11\n22</SEMILLA><SEMILLA>333</SEMILLA><SEMILLA>444</SEMILLA>',
    });
    expect(await sii.obtenerSemilla()).toBe('333');
  });

  it('HTTP distinto de 200 → ErrorTransporte con el status', async () => {
    const { sii } = cliente({
      [`${AUTH_CERT}/boleta.electronica.semilla`]: new RespuestaHttp(503, {}, SEMILLA_XML),
    });
    const error = await capturar(sii.obtenerSemilla());
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect((error as ErrorTransporte).status).toBe(503);
    expect((error as ErrorTransporte).url).toBe(
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla',
    );
  });

  it('sin <SEMILLA> → ErrorRespuestaSii con el ESTADO y la GLOSA del SII', async () => {
    const { sii } = cliente({
      [`${AUTH_CERT}/boleta.electronica.semilla`]:
        '<SII:RESPUESTA><SII:RESP_HDR><ESTADO>-1</ESTADO><GLOSA> Servicio  no\ndisponible </GLOSA></SII:RESP_HDR></SII:RESPUESTA>',
    });
    const error = (await capturar(sii.obtenerSemilla())) as ErrorRespuestaSii;
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.estado).toBe('-1');
    expect(error.glosa).toBe('Servicio no disponible');
    expect(error.message).toBe('El SII no entregó la semilla (ESTADO -1: Servicio no disponible).');
  });

  it('semilla vacía o respuesta sin nada reconocible → ErrorRespuestaSii', async () => {
    for (const cuerpo of ['<SEMILLA></SEMILLA>', '<html>error</html>', '']) {
      const { sii } = cliente({ [`${AUTH_CERT}/boleta.electronica.semilla`]: cuerpo });
      const error = (await capturar(sii.obtenerSemilla())) as ErrorRespuestaSii;
      expect(error).toBeInstanceOf(ErrorRespuestaSii);
      expect(error.message).toBe('El SII no entregó la semilla.');
      expect(error.estado).toBeUndefined();
    }
  });

  it('una falla de red del transporte sale tal cual', async () => {
    const { sii } = cliente({
      [`${AUTH_CERT}/boleta.electronica.semilla`]: () => {
        throw new ErrorTransporte('No se pudo conectar con apicert.sii.cl.', 'x');
      },
    });
    await expect(sii.obtenerSemilla()).rejects.toThrow('No se pudo conectar con apicert.sii.cl.');
  });
});

describe('ClienteBoletaRest.solicitarToken', () => {
  it('POST de la semilla firmada (bytes de firmarSemilla) con Content-Type application/xml', async () => {
    const { sii, falso } = cliente();
    expect(await sii.solicitarToken()).toBe(TOKEN);
    expect(falso.urls()).toEqual([
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.token',
    ]);
    const p = falso.enviadas[1] as PeticionRegistrada;
    expect(p.metodo).toBe('POST');
    expect(p.cabeceras).toEqual({ Accept: '*/*', 'Content-Type': 'application/xml' });
    expect(Object.keys(p.cabeceras)).toEqual(['Accept', 'Content-Type']);
    const esperado = new FirmaElectronica(llave, certificado).firmarSemilla(SEMILLA);
    expect(p.bytes?.equals(Buffer.from(esperado, 'utf8'))).toBe(true);
    expect(p.conexionNueva).toBe(false);
  });

  it('no usa caché: cada llamada pide semilla y token', async () => {
    const { sii, falso } = cliente();
    await sii.solicitarToken();
    await sii.solicitarToken();
    expect(falso.enviadas).toHaveLength(4);
  });

  it('HTTP distinto de 200 en el token → ErrorTransporte sin extracto del cuerpo', async () => {
    const { sii } = cliente({
      ...RESPUESTAS_AUTH,
      [`${AUTH_CERT}/boleta.electronica.token`]: new RespuestaHttp(500, {}, TOKEN_XML),
    });
    const error = (await capturar(sii.solicitarToken())) as ErrorTransporte;
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.status).toBe(500);
    expect(error.message).toBe('apicert.sii.cl respondió HTTP 500 (se esperaba 200).');
    sinToken(error);
  });

  it('sin <TOKEN> → ErrorRespuestaSii con ESTADO y GLOSA', async () => {
    const { sii } = cliente({
      ...RESPUESTAS_AUTH,
      [`${AUTH_CERT}/boleta.electronica.token`]: fixture('token-error.xml'),
    });
    const error = (await capturar(sii.solicitarToken())) as ErrorRespuestaSii;
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.estado).toBe('-07');
    expect(error.glosa).toBe('Error en Firma');
    expect(error.message).toBe('El SII no entregó el token (ESTADO -07: Error en Firma).');
  });

  it('un <TOKEN> que no se puede leer nunca aparece en el mensaje', async () => {
    // Partido por un salto de línea: la regex no lo toma, pero el texto está en el cuerpo.
    const cuerpo = `<TOKEN>${TOKEN}\n</TOKEN><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA>`;
    const { sii } = cliente({
      ...RESPUESTAS_AUTH,
      [`${AUTH_CERT}/boleta.electronica.token`]: cuerpo,
    });
    const error = await capturar(sii.solicitarToken());
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.message).toBe('El SII no entregó el token (ESTADO 00: Token Creado).');
    sinToken(error);
  });

  it('un token con espacios, ; o controles → ErrorRespuestaSii sin el token', async () => {
    for (const malo of ['ABC DEF', 'ABC;x=1', 'ABC\rDEF', 'ÁBC']) {
      const { sii } = cliente({
        ...RESPUESTAS_AUTH,
        [`${AUTH_CERT}/boleta.electronica.token`]: Buffer.from(`<TOKEN>${malo}</TOKEN>`, 'latin1'),
      });
      const error = await capturar(sii.solicitarToken());
      expect(error).toBeInstanceOf(ErrorRespuestaSii);
      expect(error.message).toBe('El SII entregó un token con un formato inesperado.');
      sinToken(error, malo);
    }
  });

  it('el error de la semilla corta antes de pedir el token', async () => {
    const { sii, falso } = cliente({
      [`${AUTH_CERT}/boleta.electronica.semilla`]: new RespuestaHttp(404),
    });
    await expect(sii.solicitarToken()).rejects.toBeInstanceOf(ErrorTransporte);
    expect(falso.enviadas).toHaveLength(1);
  });
});

describe('ClienteBoletaRest.obtenerToken (caché)', () => {
  const T0 = new Date('2026-11-06T12:00:00Z');

  /** Reloj que se puede mover. */
  function relojMovil(inicio: Date): Reloj & { avanzar(segundos: number): void } {
    let ms = inicio.getTime();
    return {
      ahora: () => new Date(ms),
      avanzar: (segundos) => {
        ms += segundos * 1000;
      },
    };
  }

  /** Transporte que entrega un token distinto en cada canje. */
  function contador(): { respuestas: Record<string, RespuestaFalsa>; canjes: () => number } {
    let n = 0;
    return {
      respuestas: {
        [`${AUTH_CERT}/boleta.electronica.semilla`]: SEMILLA_XML,
        [`${AUTH_CERT}/boleta.electronica.token`]: () => {
          n++;
          return `<TOKEN>TOKEN${n}</TOKEN>`;
        },
      },
      canjes: () => n,
    };
  }

  it('miss → pide uno y lo guarda con vencimiento a 3000 s; hit → lo reutiliza', async () => {
    const store = new TokenStoreMemoria();
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { tokenStore: store, reloj: relojFijo(T0) });

    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    expect(canjes()).toBe(1);

    const guardado = await store.obtener(sii.claveToken(EMISOR));
    expect(guardado?.token).toBe('TOKEN1');
    expect(guardado?.venceEn.getTime()).toBe(T0.getTime() + SEGUNDOS_VIGENCIA_TOKEN * 1000);
    expect(SEGUNDOS_VIGENCIA_TOKEN).toBe(3000);
  });

  it('vence a los 3000 s exactos, como el `< 3000` del PHP', async () => {
    const reloj = relojMovil(T0);
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { reloj });

    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    reloj.avanzar(2999);
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    reloj.avanzar(1);
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN2');
    expect(canjes()).toBe(2);
  });

  it('la vigencia corre desde que llegó el token', async () => {
    const reloj = relojMovil(T0);
    const store = new TokenStoreMemoria();
    const falso = new TransporteFalso({
      [`${AUTH_CERT}/boleta.electronica.semilla`]: () => {
        reloj.avanzar(5);
        return SEMILLA_XML;
      },
      [`${AUTH_CERT}/boleta.electronica.token`]: TOKEN_XML,
    });
    const sii = new ClienteBoletaRest(cert, {
      ambiente: 'certificacion',
      transporte: falso,
      tokenStore: store,
      reloj,
    });
    await sii.obtenerToken(EMISOR);
    const guardado = await store.obtener(sii.claveToken(EMISOR));
    expect(guardado?.venceEn.getTime()).toBe(T0.getTime() + 5000 + 3_000_000);
  });

  it('la clave es canal+ambiente+RUT normalizado+huella del certificado', () => {
    const { sii } = cliente();
    const clave = sii.claveToken('76.000.006-k');
    expect(clave).toEqual({
      canal: 'rest',
      ambiente: 'certificacion',
      rutEmpresa: '76000006-K',
      huellaCertificado: huellaCertificado(certificado),
    });
    expect(clave.huellaCertificado).toMatch(/^[0-9a-f]{64}$/);
    expect(sii.claveToken(Rut.de('76000006-K'))).toEqual(clave);
    expect(() => sii.claveToken('76000006-1')).toThrow(ErrorValidacion);
  });

  it('aísla por empresa: otra empresa pide su propio token', async () => {
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { reloj: relojFijo(T0) });
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    expect(await sii.obtenerToken('76000006-K')).toBe('TOKEN2');
    expect(await sii.obtenerToken('76.543.210-3')).toBe('TOKEN1');
    expect(canjes()).toBe(2);
  });

  it('aísla por ambiente y por certificado aunque compartan el store', async () => {
    const store = new TokenStoreMemoria();
    const reloj = relojFijo(T0);
    const otroCert = certificadoPrueba({ llave: llavePrueba(1024), cn: 'Otro Titular' });
    const otro = Certificado.desdeContenido(`${otroCert.llave.pem}\n${otroCert.pem}`);
    let n = 0;
    const falso = new TransporteFalso({
      '*/boleta.electronica.semilla': SEMILLA_XML,
      '*/boleta.electronica.token': () => `<TOKEN>T${++n}</TOKEN>`,
    });
    const base = { transporte: falso, tokenStore: store, reloj };
    const certif = new ClienteBoletaRest(cert, { ...base, ambiente: 'certificacion' });
    const prod = new ClienteBoletaRest(cert, { ...base, ambiente: 'produccion' });
    const otroTitular = new ClienteBoletaRest(otro, { ...base, ambiente: 'certificacion' });
    const otraInstancia = new ClienteBoletaRest(cert, { ...base, ambiente: 'certificacion' });

    expect(await certif.obtenerToken(EMISOR)).toBe('T1');
    expect(await prod.obtenerToken(EMISOR)).toBe('T2');
    expect(await otroTitular.obtenerToken(EMISOR)).toBe('T3');
    // Mismo certificado, ambiente y empresa: comparte el token aunque sea otro cliente.
    expect(await otraInstancia.obtenerToken(EMISOR)).toBe('T1');
    expect(store.tamano).toBe(3);
    expect(falso.urls().filter((u) => u.includes('api.sii.cl'))).toHaveLength(2);
  });

  it('dos llamadas simultáneas para la misma empresa comparten un solo canje', async () => {
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { reloj: relojFijo(T0) });
    const [a, b] = await Promise.all([sii.obtenerToken(EMISOR), sii.obtenerToken(EMISOR)]);
    expect([a, b]).toEqual(['TOKEN1', 'TOKEN1']);
    expect(canjes()).toBe(1);
  });

  it('olvidarToken obliga a pedir uno nuevo', async () => {
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { reloj: relojFijo(T0) });
    await sii.obtenerToken(EMISOR);
    await sii.olvidarToken(EMISOR);
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN2');
    expect(canjes()).toBe(2);
  });

  it('un token guardado con formato inválido se ignora y se pide otro', async () => {
    const store = new TokenStoreMemoria();
    const { respuestas, canjes } = contador();
    const { sii } = cliente(respuestas, { tokenStore: store, reloj: relojFijo(T0) });
    await store.guardar(sii.claveToken(EMISOR), {
      token: 'MAL O',
      venceEn: new Date(T0.getTime() + 60_000),
    });
    expect(await sii.obtenerToken(EMISOR)).toBe('TOKEN1');
    expect(canjes()).toBe(1);
  });

  it('si el canje falla no guarda nada, y el siguiente intento vuelve a pedir', async () => {
    const store = new TokenStoreMemoria();
    let falla = true;
    const { sii } = cliente(
      {
        [`${AUTH_CERT}/boleta.electronica.semilla`]: SEMILLA_XML,
        [`${AUTH_CERT}/boleta.electronica.token`]: () =>
          falla ? new RespuestaHttp(500) : TOKEN_XML,
      },
      { tokenStore: store, reloj: relojFijo(T0) },
    );
    await expect(sii.obtenerToken(EMISOR)).rejects.toBeInstanceOf(ErrorTransporte);
    expect(store.tamano).toBe(0);
    falla = false;
    expect(await sii.obtenerToken(EMISOR)).toBe(TOKEN);
  });

  it('acepta cualquier TokenStore (p. ej. uno de una app web) y le pasa la clave completa', async () => {
    const llamadas: string[] = [];
    const mapa = new Map<string, TokenGuardado>();
    const store: TokenStore = {
      async obtener(clave: ClaveToken) {
        llamadas.push(`obtener ${clave.canal} ${clave.ambiente} ${clave.rutEmpresa}`);
        return mapa.get(clave.rutEmpresa);
      },
      async guardar(clave: ClaveToken, guardado: TokenGuardado) {
        llamadas.push(`guardar ${clave.rutEmpresa}`);
        mapa.set(clave.rutEmpresa, guardado);
      },
      async borrar() {},
    };
    const { sii } = cliente(RESPUESTAS_AUTH, { tokenStore: store, reloj: relojFijo(T0) });
    await sii.obtenerToken(EMISOR);
    await sii.obtenerToken(EMISOR);
    expect(llamadas).toEqual([
      'obtener rest certificacion 76543210-3',
      'guardar 76543210-3',
      'obtener rest certificacion 76543210-3',
    ]);
  });
});

describe('ClienteBoletaRest.enviarBoleta', () => {
  const URL_ENVIO = `${ENVIO_CERT}/boleta.electronica.envio`;

  it('multipart con los campos en el orden del PHP, cabeceras y conexión propia', async () => {
    const { sii, falso } = cliente({ [URL_ENVIO]: fixture('envio-recibido.json') });
    const respuesta = await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML);

    const p = unica(falso);
    expect(p.metodo).toBe('POST');
    expect(p.url).toBe('https://pangal.sii.cl/recursos/v1/boleta.electronica.envio');
    expect(p.cabeceras).toEqual({
      Accept: '*/*',
      Cookie: `TOKEN=${TOKEN}`,
      'User-Agent': 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)',
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
    });
    expect(Object.keys(p.cabeceras)).toEqual(['Accept', 'Cookie', 'User-Agent', 'Content-Type']);
    expect(p.cabeceras['Accept-Encoding']).toBeUndefined();
    expect(p.conexionNueva).toBe(true);
    expect(p.tls).toBe(false);
    expect(
      p.bytes?.equals(multipartEsperado('11111111', '1', '76543210', '3', 'envio.xml', XML)),
    ).toBe(true);

    expect(respuesta).toEqual({
      trackId: '1234567890',
      estado: 'REC',
      fechaRecepcion: '2026-11-06 10:15:30',
      rutEmisor: '76543210-3',
      rutEnvia: '11111111-1',
      archivo: 'envio.xml',
      json: JSON.parse(fixture('envio-recibido.json').toString('utf8')),
    });
    expect(Object.isFrozen(respuesta)).toBe(true);
    expect(USER_AGENT_BOLETA_REST).toBe('Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)');
    expect(NOMBRE_ARCHIVO_BOLETA).toBe('envio.xml');
  });

  it('en producción sube a rahue.sii.cl', async () => {
    const falso = new TransporteFalso({
      'rahue.sii.cl/recursos/v1/boleta.electronica.envio': fixture('envio-recibido.json'),
    });
    const sii = new ClienteBoletaRest(cert, { ambiente: 'produccion', transporte: falso });
    await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML);
    expect(falso.urls()).toEqual(['https://rahue.sii.cl/recursos/v1/boleta.electronica.envio']);
  });

  it('normaliza los RUT con Rut (puntos fuera, k → K) y acepta Rut ya construidos', async () => {
    const { sii, falso } = cliente({ [URL_ENVIO]: fixture('envio-recibido.json') });
    await sii.enviarBoleta(TOKEN, '76.000.006-k', Rut.de(ENVIA), XML, { nombreArchivo: 'x.xml' });
    expect(
      unica(falso).bytes?.equals(multipartEsperado('11111111', '1', '76000006', 'K', 'x.xml', XML)),
    ).toBe(true);
  });

  it('acepta un Uint8Array además de un Buffer', async () => {
    const { sii, falso } = cliente({ [URL_ENVIO]: fixture('envio-recibido.json') });
    const copia = new Uint8Array(XML);
    await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, copia);
    expect(unica(falso).bytes?.includes(XML)).toBe(true);
  });

  it('trackid como texto de dígitos también sirve', async () => {
    const { sii } = cliente({ [URL_ENVIO]: '{"trackid":"987","estado":"REC"}' });
    const r = await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML);
    expect(r.trackId).toBe('987');
    expect(r.fechaRecepcion).toBe('');
    expect(r.archivo).toBe('');
  });

  it('valida token, RUT, XML y nombre de archivo antes de enviar', async () => {
    const { sii, falso } = cliente({ [URL_ENVIO]: fixture('envio-recibido.json') });
    const casos: Promise<unknown>[] = [
      sii.enviarBoleta('', EMISOR, ENVIA, XML),
      sii.enviarBoleta('A B', EMISOR, ENVIA, XML),
      sii.enviarBoleta('A;B', EMISOR, ENVIA, XML),
      sii.enviarBoleta(TOKEN, '76543210-4', ENVIA, XML),
      sii.enviarBoleta(TOKEN, EMISOR, 'x', XML),
      sii.enviarBoleta(TOKEN, EMISOR, ENVIA, Buffer.alloc(0)),
      sii.enviarBoleta(TOKEN, EMISOR, ENVIA, '<xml/>' as unknown as Buffer),
      sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML, { nombreArchivo: '' }),
      sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML, { nombreArchivo: 'a"b.xml' }),
    ];
    for (const caso of casos) {
      const error = await capturar(caso);
      expect(error).toBeInstanceOf(ErrorValidacion);
      sinToken(error);
    }
    expect(falso.enviadas).toHaveLength(0);
  });

  it('HTTP distinto de 200 → ErrorTransporte con status y un extracto sin el token', async () => {
    const cuerpo = `{"error":"No autorizado","cookie":"TOKEN=${TOKEN}; path=/","eco":"${TOKEN}"}`;
    const { sii } = cliente({ [URL_ENVIO]: new RespuestaHttp(401, {}, cuerpo) });
    const error = (await capturar(sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML))) as ErrorTransporte;
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.status).toBe(401);
    expect(error.url).toBe('https://pangal.sii.cl/recursos/v1/boleta.electronica.envio');
    expect(error.message).toBe(
      'pangal.sii.cl respondió HTTP 401 (se esperaba 200). Respuesta del SII: ' +
        '{"error":"No autorizado","cookie":"TOKEN=[omitido]; path=/","eco":"[omitido]"}',
    );
    sinToken(error);
  });

  it('el extracto se recorta y se omite si trae material de firma', async () => {
    const largo = new RespuestaHttp(500, {}, `<html>${'x'.repeat(500)}</html>`);
    const { sii } = cliente({ [URL_ENVIO]: largo });
    const error = await capturar(sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML));
    expect(error.message).toMatch(/Respuesta del SII: <html>x+…$/);
    expect(error.message.length).toBeLessThan(300);

    for (const eco of [
      '<EnvioBOLETA><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
      '<ds:Signature>',
      '<X509Certificate>MIIB</X509Certificate>',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      const { sii: otro } = cliente({ [URL_ENVIO]: new RespuestaHttp(400, {}, eco) });
      const e = await capturar(otro.enviarBoleta(TOKEN, EMISOR, ENVIA, XML));
      expect(e.message).toBe('pangal.sii.cl respondió HTTP 400 (se esperaba 200).');
    }
  });

  it('200 sin JSON, con JSON vacío o con un arreglo → ErrorRespuestaSii (como `!$data` del PHP)', async () => {
    for (const cuerpo of ['', 'no es json', '{}', '[]', 'null', '0', '"texto"', '[1]']) {
      const { sii } = cliente({ [URL_ENVIO]: cuerpo });
      const error = await capturar(sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML));
      expect(error).toBeInstanceOf(ErrorRespuestaSii);
      expect(error.message.startsWith('El SII no confirmó la recepción de la boleta')).toBe(true);
    }
  });

  it('200 con HTML (p. ej. sesión vencida) → ErrorRespuestaSii con extracto saneado', async () => {
    const { sii } = cliente({
      [URL_ENVIO]: `<html>\n<body>Sesion   expirada TOKEN=${TOKEN}</body></html>`,
    });
    const error = await capturar(sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML));
    expect(error.message).toBe(
      'El SII no confirmó la recepción de la boleta. Respuesta del SII: ' +
        '<html> <body>Sesion expirada TOKEN=[omitido]</body></html>',
    );
  });

  it('JSON sin trackid → ErrorRespuestaSii con el estado del SII', async () => {
    const { sii } = cliente({ [URL_ENVIO]: '{"estado":"RCT","trackid":0}' });
    const error = (await capturar(
      sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML),
    )) as ErrorRespuestaSii;
    expect(error).toBeInstanceOf(ErrorRespuestaSii);
    expect(error.estado).toBe('RCT');
    expect(error.message).toBe('El SII no devolvió el trackid de la boleta (estado RCT).');

    const { sii: otro } = cliente({ [URL_ENVIO]: '{"mensaje":"x"}' });
    const sinEstado = (await capturar(
      otro.enviarBoleta(TOKEN, EMISOR, ENVIA, XML),
    )) as ErrorRespuestaSii;
    expect(sinEstado.message).toBe('El SII no devolvió el trackid de la boleta.');
    expect(sinEstado.estado).toBeUndefined();
  });

  it('la falla de red del POST sale como ErrorTransporte del transporte', async () => {
    const transporte: TransporteHttp = {
      enviar: async () => {
        throw new ErrorTransporte('La conexión con pangal.sii.cl se cortó.', 'x');
      },
    };
    const sii = new ClienteBoletaRest(cert, { ambiente: 'certificacion', transporte });
    await expect(sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML)).rejects.toThrow(
      'La conexión con pangal.sii.cl se cortó.',
    );
  });

  it('sin boundary fijo usa el aleatorio de armarMultipart, distinto en cada envío', async () => {
    const falso = new TransporteFalso({ [URL_ENVIO]: fixture('envio-recibido.json') });
    const sii = new ClienteBoletaRest(cert, { ambiente: 'certificacion', transporte: falso });
    await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML);
    await sii.enviarBoleta(TOKEN, EMISOR, ENVIA, XML);
    const [a, b] = falso.enviadas.map((p) => p.cabeceras['Content-Type']);
    expect(a).toMatch(/^multipart\/form-data; boundary=-{24}[0-9A-Za-z]+$/);
    expect(a).not.toBe(b);
  });
});

describe('ClienteBoletaRest.enviarConsumoFolios', () => {
  const URL_RCOF = `${ENVIO_CERT}/boleta.electronica.consumo`;

  it('mismo multipart y cabeceras que la boleta, a boleta.electronica.consumo', async () => {
    const { sii, falso } = cliente({
      [URL_RCOF]: '{"trackid":555,"estado":"REC","file":"rcof.xml"}',
    });
    const r = await sii.enviarConsumoFolios(TOKEN, EMISOR, ENVIA, XML);
    expect(r.trackId).toBe('555');
    const p = unica(falso);
    expect(p.url).toBe('https://pangal.sii.cl/recursos/v1/boleta.electronica.consumo');
    expect(p.cabeceras).toEqual({
      Accept: '*/*',
      Cookie: `TOKEN=${TOKEN}`,
      'User-Agent': USER_AGENT_BOLETA_REST,
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
    });
    expect(p.conexionNueva).toBe(true);
    expect(
      p.bytes?.equals(multipartEsperado('11111111', '1', '76543210', '3', 'rcof.xml', XML)),
    ).toBe(true);
    expect(NOMBRE_ARCHIVO_RCOF).toBe('rcof.xml');
  });

  it('en producción sube a rahue.sii.cl; los errores nombran el RCOF', async () => {
    const falso = new TransporteFalso({
      'rahue.sii.cl/recursos/v1/boleta.electronica.consumo': '{}',
    });
    const sii = new ClienteBoletaRest(cert, { ambiente: 'produccion', transporte: falso });
    await expect(sii.enviarConsumoFolios(TOKEN, EMISOR, ENVIA, XML)).rejects.toThrow(
      'El SII no confirmó la recepción del RCOF.',
    );
    expect(falso.urls()).toEqual(['https://rahue.sii.cl/recursos/v1/boleta.electronica.consumo']);
  });

  it('HTTP distinto de 200 → ErrorTransporte', async () => {
    const { sii } = cliente({ [URL_RCOF]: new RespuestaHttp(502) });
    const error = (await capturar(
      sii.enviarConsumoFolios(TOKEN, EMISOR, ENVIA, XML),
    )) as ErrorTransporte;
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.status).toBe(502);
    expect(error.message).toBe('pangal.sii.cl respondió HTTP 502 (se esperaba 200).');
  });
});

describe('ClienteBoletaRest.consultarEnvio', () => {
  const URL_ESTADO = `${AUTH_CERT}/boleta.electronica.envio/*`;

  it('GET al host de autenticación (como el PHP) con la cookie del token', async () => {
    const { sii, falso } = cliente({ [URL_ESTADO]: fixture('estado-procesado.json') });
    const estado = await sii.consultarEnvio(TOKEN, '76.543.210-3', '1234567890');
    const p = unica(falso);
    expect(p.metodo).toBe('GET');
    expect(p.url).toBe(
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76543210-3-1234567890',
    );
    expect(p.cabeceras).toEqual({ Accept: '*/*', Cookie: `TOKEN=${TOKEN}` });
    expect(p.conexionNueva).toBe(false);
    expect(p.bytes).toBeUndefined();

    expect(estado).toBeInstanceOf(EstadoEnvioRest);
    expect(estado.trackId).toBe('1234567890');
    expect(estado.estado).toBe('EPR');
    expect(estado.rutEmisor).toBe('76543210-3');
    expect(estado.rutEnvia).toBe('11111111-1');
    expect(estado.fechaRecepcion).toBe('2026-11-06 10:15:30');
    expect(estado.estadistica).toEqual([
      { tipo: 39, informados: 5, aceptados: 5, rechazados: 0, reparos: 0 },
    ]);
    expect(estado.detalleRepRech).toEqual([]);
    expect(estado.procesado()).toBe(true);
    expect(estado.enProceso()).toBe(false);
    expect(estado.limpio()).toBe(true);
    expect(estado.json.estado).toBe('EPR');
  });

  it('en producción consulta en api.sii.cl; acepta el trackId como número', async () => {
    const falso = new TransporteFalso({
      'api.sii.cl/recursos/v1/boleta.electronica.envio/*': fixture('estado-procesado.json'),
    });
    const sii = new ClienteBoletaRest(cert, { ambiente: 'produccion', transporte: falso });
    await sii.consultarEnvio(TOKEN, '76000006-k', 42);
    expect(falso.urls()).toEqual([
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76000006-K-42',
    ]);
  });

  it('tipa estadística y rechazos con errores (pend. 1.6)', async () => {
    const { sii } = cliente({ [URL_ESTADO]: fixture('estado-con-rechazos.json') });
    const estado = await sii.consultarEnvio(TOKEN, EMISOR, '1234567891');
    expect(estado.informados).toBe(5);
    expect(estado.aceptados).toBe(3);
    expect(estado.rechazados).toBe(1);
    expect(estado.reparos).toBe(1);
    expect(estado.procesado()).toBe(true);
    expect(estado.limpio()).toBe(false);
    expect(estado.detalleRepRech).toEqual([
      {
        tipo: 39,
        folio: 57,
        estado: 'RCH',
        descripcion: 'Rechazado',
        errores: [
          {
            seccion: 'DTE',
            linea: 12,
            nivel: 1,
            codigo: 302,
            descripcion: 'Monto Total No Cuadra',
            detalle: 'MntTotal distinto de la suma de los ítems',
          },
        ],
      },
      { tipo: 39, folio: 58, estado: 'RPR', descripcion: 'Aceptado con Reparos', errores: [] },
    ]);
    expect(Object.isFrozen(estado)).toBe(true);
    expect(Object.isFrozen(estado.detalleRepRech[0])).toBe(true);
  });

  it('valida token, RUT y trackId antes de enviar', async () => {
    const { sii, falso } = cliente({ [URL_ESTADO]: fixture('estado-procesado.json') });
    for (const caso of [
      sii.consultarEnvio('', EMISOR, '1'),
      sii.consultarEnvio(TOKEN, '1-1', '1'),
      sii.consultarEnvio(TOKEN, EMISOR, ''),
      sii.consultarEnvio(TOKEN, EMISOR, '12/../34'),
      sii.consultarEnvio(TOKEN, EMISOR, -1),
      sii.consultarEnvio(TOKEN, EMISOR, 1.5),
    ]) {
      await expect(caso).rejects.toBeInstanceOf(ErrorValidacion);
    }
    expect(falso.enviadas).toHaveLength(0);
  });

  it('HTTP distinto de 200 → ErrorTransporte con extracto sin el token', async () => {
    const { sii } = cliente({
      [URL_ESTADO]: new RespuestaHttp(404, {}, `{"mensaje":"no existe","t":"${TOKEN}"}`),
    });
    const error = (await capturar(sii.consultarEnvio(TOKEN, EMISOR, '9'))) as ErrorTransporte;
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(error.status).toBe(404);
    expect(error.message).toBe(
      'apicert.sii.cl respondió HTTP 404 (se esperaba 200). Respuesta del SII: {"mensaje":"no existe","t":"[omitido]"}',
    );
    sinToken(error);
  });

  it('200 sin JSON o sin estado → ErrorRespuestaSii', async () => {
    for (const [cuerpo, mensaje] of [
      [
        '<html>login</html>',
        'El SII no devolvió el estado del envío 9. Respuesta del SII: <html>login</html>',
      ],
      ['{}', 'El SII no devolvió el estado del envío 9. Respuesta del SII: {}'],
      ['{"trackid":9}', 'El SII no devolvió el estado del envío 9.'],
      ['{"estado":""}', 'El SII no devolvió el estado del envío 9.'],
    ] as const) {
      const { sii } = cliente({ [URL_ESTADO]: cuerpo });
      const error = await capturar(sii.consultarEnvio(TOKEN, EMISOR, '9'));
      expect(error).toBeInstanceOf(ErrorRespuestaSii);
      expect(error.message).toBe(mensaje);
    }
  });

  it('JSON en ISO-8859-1 (glosas con tildes) también se lee', async () => {
    const { sii } = cliente({
      [URL_ESTADO]: Buffer.from(
        '{"estado":"RCT","detalle_rep_rech":[{"descripcion":"Carátula"}]}',
        'latin1',
      ),
    });
    const estado = await sii.consultarEnvio(TOKEN, EMISOR, '9');
    expect(estado.detalleRepRech[0]?.descripcion).toBe('Carátula');
  });
});

describe('EstadoEnvioRest.desdeJson', () => {
  it('usa el trackId consultado si el JSON no lo trae; campos ausentes quedan vacíos', () => {
    const estado = EstadoEnvioRest.desdeJson({ estado: 'REC' }, '77');
    expect(estado.trackId).toBe('77');
    expect(estado.rutEmisor).toBe('');
    expect(estado.fechaRecepcion).toBe('');
    expect(estado.estadistica).toEqual([]);
    expect(estado.informados).toBe(0);
    expect(estado.enProceso()).toBe(true);
    expect(estado.procesado()).toBe(false);
    expect(estado.limpio()).toBe(false);
  });

  it('tolera números como texto y descarta entradas que no son objetos', () => {
    const estado = EstadoEnvioRest.desdeJson(
      {
        estado: 'EPR',
        trackid: '123',
        estadistica: [
          { tipo: '39', informados: '2', aceptados: 2, rechazados: 'x', reparos: -1 },
          null,
          7,
        ],
        detalle_rep_rech: 'no es lista',
      },
      '1',
    );
    expect(estado.trackId).toBe('123');
    expect(estado.estadistica).toEqual([
      { tipo: 39, informados: 2, aceptados: 2, rechazados: 0, reparos: 0 },
    ]);
    expect(estado.detalleRepRech).toEqual([]);
    expect(estado.limpio()).toBe(true);
  });

  it('errores en campos ausentes quedan en null / vacío', () => {
    const estado = EstadoEnvioRest.desdeJson(
      { estado: 'EPR', detalle_rep_rech: [{ error: [{ descripcion: 'x' }] }] },
      '1',
    );
    expect(estado.detalleRepRech[0]).toEqual({
      tipo: 0,
      folio: 0,
      estado: '',
      descripcion: '',
      errores: [
        { seccion: '', linea: null, nivel: null, codigo: null, descripcion: 'x', detalle: '' },
      ],
    });
  });

  it('lanza si no es un objeto o no trae estado', () => {
    for (const json of [null, [], 'EPR', { estado: null }, { estado: '' }]) {
      expect(() => EstadoEnvioRest.desdeJson(json, '1')).toThrow(ErrorRespuestaSii);
    }
  });
});
