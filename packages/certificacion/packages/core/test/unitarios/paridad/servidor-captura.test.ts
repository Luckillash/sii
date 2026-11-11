// El servidor de captura de la paridad HTTP (paridad/http/servidor-captura.mjs):
// reglas de normalización, respuestas grabadas y protocolo de control.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CABECERAS_EXCLUIDAS,
  type Captura,
  iniciarServidorCaptura,
  normalizarCapturas,
  type ServidorCaptura,
} from '../../../../../paridad/http/servidor-captura.mjs';
import { TransporteUndici } from '../../../src/comun/http/transporte-undici.ts';

function captura(parcial: Partial<Captura>): Captura {
  return {
    origen: 'https',
    puerto: 4443,
    metodo: 'POST',
    ruta: '/x',
    version: '1.1',
    cabeceras: [],
    cuerpo: Buffer.alloc(0),
    sinRespuesta: false,
    ...parcial,
  };
}

describe('normalizarCapturas', () => {
  it('sin peticiones', () => {
    expect(normalizarCapturas([]).toString('latin1')).toBe('=== sin peticiones ===\n');
  });

  it('nombres en minúsculas y ordenados (estable), sin connection, host del servidor como <origen>', () => {
    const salida = normalizarCapturas([
      captura({
        cabeceras: [
          ['host', 'localhost:4443'],
          ['connection', 'keep-alive'],
          ['X-B', '2'],
          ['Accept', '*/*'],
          ['x-b', '1'],
        ],
      }),
    ]).toString('latin1');
    expect(salida).toBe(
      '=== peticion 1 de 1 (https) ===\n' +
        'POST /x HTTP/1.1\n' +
        'accept: */*\n' +
        'host: <https>\n' +
        'x-b: 2\n' +
        'x-b: 1\n' +
        '\n' +
        '\n=== fin de la peticion 1 ===\n',
    );
  });

  it('solo excluye connection', () => {
    expect([...CABECERAS_EXCLUIDAS.keys()]).toEqual(['connection']);
  });

  it('un host ajeno o con otro puerto queda tal cual', () => {
    for (const host of ['localhost:9999', 'maullin.sii.cl', '127.0.0.1:4443']) {
      const salida = normalizarCapturas([captura({ cabeceras: [['Host', host]] })]).toString(
        'latin1',
      );
      expect(salida).toContain(`host: ${host === '127.0.0.1:4443' ? '<https>' : host}\n`);
    }
  });

  it('reemplaza el boundary en Content-Type y cuerpo, y reescribe content-length', () => {
    const b = '------------------------abcdefghijklmnopqrstuv';
    const cuerpo = Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${b}--\r\n`,
    );
    const salida = normalizarCapturas([
      captura({
        cabeceras: [
          ['Content-Type', `multipart/form-data; boundary=${b}`],
          ['Content-Length', String(cuerpo.length)],
        ],
        cuerpo,
      }),
    ]).toString('latin1');
    const normalizado =
      '--<boundary>\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--<boundary>--\r\n';
    expect(salida).toContain('content-type: multipart/form-data; boundary=<boundary>\n');
    expect(salida).toContain(`content-length: ${normalizado.length}\n`);
    expect(salida).toContain(`\n\n${normalizado}\n=== fin`);
  });

  it('boundary entre comillas', () => {
    const cuerpo = Buffer.from('--xyz\r\n\r\n--xyz--\r\n');
    const salida = normalizarCapturas([
      captura({ cabeceras: [['content-type', 'multipart/form-data; boundary="xyz"']], cuerpo }),
    ]).toString('latin1');
    expect(salida).toContain('boundary="<boundary>"');
    expect(salida).toContain('--<boundary>--');
  });

  it('content-length que no calza queda con una nota', () => {
    const salida = normalizarCapturas([
      captura({ cabeceras: [['Content-Length', '99']], cuerpo: Buffer.from('abc') }),
    ]).toString('latin1');
    expect(salida).toContain('content-length: 99 (no calza con el cuerpo recibido: 3 bytes)\n');
  });

  it('nombresArchivo: solo con la opción, conserva la extensión', () => {
    const b = 'B0';
    const cuerpo = Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="archivo"; filename="bolC7E.tmp.xml"\r\n` +
        `Content-Type: text/xml\r\n\r\nfilename="no-se-toca"\r\n--${b}--\r\n`,
    );
    const c = captura({
      cabeceras: [['Content-Type', `multipart/form-data; boundary=${b}`]],
      cuerpo,
    });
    expect(normalizarCapturas([c]).toString('latin1')).toContain('filename="bolC7E.tmp.xml"');
    const con = normalizarCapturas([c], { nombresArchivo: true }).toString('latin1');
    expect(con).toContain('filename="<archivo>.xml"');
    expect(con).toContain('\r\n\r\nfilename="no-se-toca"\r\n');
  });

  it('el cuerpo va en bytes exactos y se marca la petición sin respuesta', () => {
    const cuerpo = Buffer.from([0xd1, 0x00, 0xff, 0x0a]);
    const salida = normalizarCapturas([
      captura({ metodo: 'GET', ruta: '/a?b=%C3%B1', cuerpo: Buffer.alloc(0) }),
      captura({ origen: 'https2', cuerpo, sinRespuesta: true }),
    ]);
    const texto = salida.toString('latin1');
    expect(texto).toContain('=== peticion 1 de 2 (https) ===\nGET /a?b=%C3%B1 HTTP/1.1\n');
    expect(texto).toContain(
      '=== peticion 2 de 2 (https2) [sin respuesta configurada: se respondio 500] ===\n',
    );
    expect(
      salida.includes(Buffer.concat([Buffer.from('\n\n'), cuerpo, Buffer.from('\n=== fin')])),
    ).toBe(true);
  });
});

describe('servidor de captura', () => {
  let servidor: ServidorCaptura;
  let transporte: TransporteUndici;

  beforeAll(async () => {
    servidor = await iniciarServidorCaptura();
    transporte = new TransporteUndici({ ca: servidor.ca, permitirHttp: true });
  });
  afterAll(async () => {
    await transporte.close();
    await servidor.cerrar();
  });

  it('responde las respuestas grabadas en orden, por http y https, y graba todo', async () => {
    servidor.cargarCaso({
      respuestas: [
        { status: 201, cabeceras: [['X-Uno', 'a']], cuerpo: 'Ñ' },
        { cuerpo: { base64: Buffer.from([1, 2, 3]).toString('base64') } },
      ],
    });
    const r1 = await transporte.enviar({
      metodo: 'POST',
      url: `${servidor.origenes.https}/uno?q=1`,
      cuerpo: { tipo: 'crudo', datos: 'hola', contentType: 'text/plain' },
      descomprimir: false,
    });
    const r2 = await transporte.enviar({ metodo: 'GET', url: `${servidor.origenes.https2}/dos` });
    const r3 = await transporte.enviar({ metodo: 'GET', url: `${servidor.origenes.http}/tres` });

    expect(r1.status).toBe(201);
    expect(r1.cabecera('x-uno')).toEqual(['a']);
    expect(r1.cuerpo.toString('utf8')).toBe('Ñ');
    expect([...r2.cuerpo]).toEqual([1, 2, 3]);
    expect(r3.status).toBe(500);

    const capturas = servidor.capturas();
    expect(capturas.map((c) => [c.origen, c.metodo, c.ruta, c.sinRespuesta])).toEqual([
      ['https', 'POST', '/uno?q=1', false],
      ['https2', 'GET', '/dos', false],
      ['http', 'GET', '/tres', true],
    ]);
    expect(capturas[0]?.cuerpo.toString()).toBe('hola');
    const texto = servidor.normalizado().toString('latin1');
    expect(texto).toContain('host: <https>\n');
    expect(texto).toContain('host: <https2>\n');
    expect(texto).toContain('host: <http>\n');
  });

  it('cargarCaso borra lo grabado', async () => {
    servidor.cargarCaso({ respuestas: [{}] });
    await transporte.enviar({ metodo: 'GET', url: `${servidor.origenes.https}/a` });
    servidor.cargarCaso();
    expect(servidor.capturas()).toEqual([]);
    expect(servidor.normalizado().toString()).toBe('=== sin peticiones ===\n');
  });

  it('protocolo de control por http (lo que usa el PHP), sin grabarse a sí mismo', async () => {
    const caso = await transporte.enviar({
      metodo: 'POST',
      url: `${servidor.origenes.http}/__captura/caso`,
      cuerpo: {
        tipo: 'crudo',
        datos: JSON.stringify({
          respuestas: [{ cuerpo: 'x' }],
          normalizar: { nombresArchivo: true },
        }),
        contentType: 'application/json',
      },
    });
    expect(caso.status).toBe(204);
    await transporte.enviar({ metodo: 'GET', url: `${servidor.origenes.https}/b` });

    const normalizado = await transporte.enviar({
      metodo: 'GET',
      url: `${servidor.origenes.http}/__captura/normalizado`,
      descomprimir: false,
    });
    expect(normalizado.cuerpo.equals(servidor.normalizado())).toBe(true);
    expect(normalizado.cuerpo.toString('latin1')).toContain(
      '=== peticion 1 de 1 (https) ===\nGET /b HTTP/1.1\n',
    );

    const crudas = await transporte.enviar({
      metodo: 'GET',
      url: `${servidor.origenes.http}/__captura/capturas`,
    });
    expect(JSON.parse(crudas.cuerpo.toString('utf8'))).toHaveLength(1);

    const mala = await transporte.enviar({
      metodo: 'POST',
      url: `${servidor.origenes.http}/__captura/caso`,
      cuerpo: {
        tipo: 'crudo',
        datos: '{"respuestas":[{"status":7}]}',
        contentType: 'application/json',
      },
    });
    expect(mala.status).toBe(400);
    expect(mala.cuerpo.toString('utf8')).toContain('status inválido');
  });

  it('valida el caso', () => {
    expect(() => servidor.cargarCaso({ normalizar: { otra: true } as never })).toThrow(
      /desconocida: otra/,
    );
    expect(() => servidor.cargarCaso({ respuestas: [{ cabeceras: [['a']] as never }] })).toThrow(
      /pares/,
    );
  });
});
