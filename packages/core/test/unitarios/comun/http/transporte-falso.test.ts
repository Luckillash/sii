import { describe, expect, it } from 'vitest';
import { ErrorTransporte } from '../../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../../src/comun/http/respuesta.ts';
import { TransporteFalso } from '../../../../src/comun/http/transporte-falso.ts';

const texto = async (p: Promise<RespuestaHttp>) => (await p).cuerpo.toString('utf8');

describe('TransporteFalso', () => {
  it('calza host+ruta sin esquema, puerto ni query, con comodín y sin distinguir mayúsculas', async () => {
    const falso = new TransporteFalso({
      'herculesr.sii.cl/cgi_AUT2000/*': 'login',
      'MAULLIN.sii.cl/cvc_cgi/dte/of_solicita_folios': 'folios',
    });
    const login = falso.enviar({
      metodo: 'POST',
      url: 'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://maullin.sii.cl/x',
    });
    expect(await texto(login)).toBe('login');
    const folios = falso.enviar({
      metodo: 'GET',
      url: 'https://maullin.sii.cl:8443/cvc_cgi/dte/of_solicita_folios?a=1',
    });
    expect(await texto(folios)).toBe('folios');
  });

  it('gana el primer patrón que calce; sin patrón responde 404 vacío', async () => {
    const falso = new TransporteFalso([
      ['a.cl/x/*', 'primero'],
      ['a.cl/*', 'segundo'],
    ]);
    expect(await texto(falso.enviar({ metodo: 'GET', url: 'https://a.cl/x/y' }))).toBe('primero');
    expect(await texto(falso.enviar({ metodo: 'GET', url: 'https://a.cl/z' }))).toBe('segundo');
    const nada = await falso.enviar({ metodo: 'GET', url: 'https://b.cl/' });
    expect(nada.status).toBe(404);
    expect(nada.cuerpo.length).toBe(0);
  });

  it('el patrón no trata los puntos ni otros símbolos como regex', async () => {
    const falso = new TransporteFalso({ 'a.cl/x.cgi': 'ok', 'a.cl/(y)+': 'ok' });
    expect((await falso.enviar({ metodo: 'GET', url: 'https://aXcl/xYcgi' })).status).toBe(404);
    expect((await falso.enviar({ metodo: 'GET', url: 'https://a.cl/yy' })).status).toBe(404);
  });

  it('responde con string, bytes, RespuestaHttp o función sync/async', async () => {
    const falso = new TransporteFalso({
      'a.cl/texto': 'hola',
      'a.cl/bytes': Buffer.from([0xe1]),
      'a.cl/redir': new RespuestaHttp(302, { Location: '/otra' }),
      'a.cl/sync': (p) => `eco ${p.metodo} ${p.bytes?.toString('latin1') ?? ''}`,
      'a.cl/async': async () => new RespuestaHttp(201, {}, 'creado'),
    });
    expect(await texto(falso.enviar({ metodo: 'GET', url: 'https://a.cl/texto' }))).toBe('hola');
    const bytes = await falso.enviar({ metodo: 'GET', url: 'https://a.cl/bytes' });
    expect(bytes.status).toBe(200);
    expect(bytes.cuerpo).toEqual(Buffer.from([0xe1]));
    const redir = await falso.enviar({ metodo: 'GET', url: 'https://a.cl/redir' });
    expect(redir.esRedireccion()).toBe(true);
    const eco = falso.enviar({
      metodo: 'POST',
      url: 'https://a.cl/sync',
      cuerpo: { tipo: 'formulario', campos: { a: 'b c' } },
    });
    expect(await texto(eco)).toBe('eco POST a=b+c');
    const asincrona = await falso.enviar({ metodo: 'GET', url: 'https://a.cl/async' });
    expect(asincrona.status).toBe(201);
  });

  it('una función que lanza simula una falla de red', async () => {
    const falso = new TransporteFalso({
      '*': () => {
        throw new ErrorTransporte('No se pudo conectar con a.cl.', 'https://a.cl/');
      },
    });
    await expect(falso.enviar({ metodo: 'GET', url: 'https://a.cl/' })).rejects.toBeInstanceOf(
      ErrorTransporte,
    );
    expect(falso.enviadas).toHaveLength(1);
  });

  it('registra cada petición (si llevó TLS, sin guardar la llave) y expone urls()', async () => {
    const falso = new TransporteFalso();
    await falso.enviar({
      metodo: 'POST',
      url: 'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?ref',
      cabeceras: { Referer: 'r' },
      cuerpo: { tipo: 'formulario', campos: { referencia: 'x' } },
      tls: { cert: 'CERT-PEM', key: 'LLAVE-SECRETA' },
      msRespuesta: 45_000,
      conexionNueva: true,
    });
    const gwt = {
      tipo: 'crudo',
      datos: '7|0|',
      contentType: 'text/x-gwt-rpc; charset=UTF-8',
    } as const;
    await falso.enviar({
      metodo: 'POST',
      url: 'https://www4.sii.cl/facade',
      cuerpo: gwt,
      descomprimir: false,
    });

    expect(falso.urls()).toEqual([
      'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?ref',
      'https://www4.sii.cl/facade',
    ]);
    const [primera, segunda] = falso.enviadas;
    expect(primera?.tls).toBe(true);
    expect(primera?.msRespuesta).toBe(45_000);
    expect(primera?.conexionNueva).toBe(true);
    expect(primera?.cabeceras).toEqual({
      Referer: 'r',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'gzip, deflate',
    });
    expect(primera?.bytes?.toString('latin1')).toBe('referencia=x');
    expect(JSON.stringify(falso.enviadas)).not.toContain('LLAVE-SECRETA');
    expect(JSON.stringify(falso.enviadas)).not.toContain('CERT-PEM');
    expect(segunda?.tls).toBe(false);
    expect(segunda?.conexionNueva).toBe(false);
    expect(segunda?.cabeceras).toEqual({ 'Content-Type': 'text/x-gwt-rpc; charset=UTF-8' });
    expect(segunda?.cuerpo).toEqual(gwt);
  });
});
