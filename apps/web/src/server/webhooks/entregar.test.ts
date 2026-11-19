import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { crearEnviarHttp, mensajeFalla, type OpcionesEnviarHttp } from './entregar';
import { ErrorDireccionBloqueada, MENSAJE_DIRECCION_BLOQUEADA } from './ssrf';

// El POST con `node:https`, con un `request` falso (sin red): qué opciones se pasan, cómo
// se lee la respuesta y cómo se traducen las fallas.

type Guion =
  | { tipo: 'respuesta'; status: number; trozos?: (string | Buffer)[]; cortar?: boolean }
  | { tipo: 'error'; error: Error }
  | { tipo: 'timeout' }
  | { tipo: 'lanzar'; error: Error };

interface Llamada {
  opciones: RequestOptions;
  cuerpo: Buffer | undefined;
  destruida: Error | undefined;
  respuestaDestruida: boolean;
}

function solicitarFalso(guion: Guion) {
  const llamadas: Llamada[] = [];
  const solicitar: NonNullable<OpcionesEnviarHttp['solicitar']> = (opciones, alResponder) => {
    if (guion.tipo === 'lanzar') throw guion.error;
    const req = new EventEmitter() as EventEmitter & {
      end: (b?: Buffer) => void;
      destroy: (e?: Error) => void;
    };
    const llamada: Llamada = {
      opciones,
      cuerpo: undefined,
      destruida: undefined,
      respuestaDestruida: false,
    };
    llamadas.push(llamada);
    req.destroy = (e?: Error) => {
      llamada.destruida = e;
      if (e) queueMicrotask(() => req.emit('error', e));
    };
    req.end = (b?: Buffer) => {
      llamada.cuerpo = b;
      queueMicrotask(() => {
        if (guion.tipo === 'error') {
          req.emit('error', guion.error);
          return;
        }
        if (guion.tipo === 'timeout') {
          req.emit('timeout');
          return;
        }
        const respuesta = new PassThrough() as PassThrough & { statusCode?: number };
        respuesta.statusCode = guion.status;
        const destruirOriginal = respuesta.destroy.bind(respuesta);
        respuesta.destroy = ((e?: Error) => {
          llamada.respuestaDestruida = true;
          return destruirOriginal(e);
        }) as typeof respuesta.destroy;
        alResponder(respuesta as unknown as IncomingMessage);
        for (const t of guion.trozos ?? []) respuesta.write(t);
        if (guion.cortar) respuesta.emit('aborted');
        else respuesta.end();
      });
    };
    return req as unknown as ClientRequest;
  };
  return { solicitar, llamadas };
}

const lookup: LookupFunction = (_h, _o, cb) => cb(null, '93.184.216.34', 4);
const PETICION = {
  url: 'https://receptor.example.com/webhooks/boleteame?cliente=7',
  cuerpo: '{"id":"5","evento":"documento.aceptado","nombre":"Ñuñoa"}',
  cabeceras: { 'Content-Type': 'application/json; charset=utf-8', 'Boleteame-Entrega': '5' },
};

describe('crearEnviarHttp', () => {
  it('POST a 443 con el lookup fijado, servername, sin agente, timeout y Content-Length en bytes', async () => {
    const { solicitar, llamadas } = solicitarFalso({
      tipo: 'respuesta',
      status: 200,
      trozos: ['ok'],
    });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r).toEqual({ tipo: 'respuesta', status: 200, cuerpo: 'ok' });
    const [llamada] = llamadas;
    expect(llamada?.opciones).toMatchObject({
      protocol: 'https:',
      hostname: 'receptor.example.com',
      port: 443,
      path: '/webhooks/boleteame?cliente=7',
      method: 'POST',
      servername: 'receptor.example.com',
      agent: false,
      timeout: 10_000,
      lookup,
    });
    expect(llamada?.opciones.signal).toBeInstanceOf(AbortSignal);
    const bytes = Buffer.byteLength(PETICION.cuerpo, 'utf8');
    expect(llamada?.opciones.headers).toMatchObject({
      'Boleteame-Entrega': '5',
      'Content-Length': String(bytes),
    });
    expect(llamada?.cuerpo?.toString('utf8')).toBe(PETICION.cuerpo);
  });

  it('usa el lookup seguro por defecto (no el del sistema)', async () => {
    const { solicitar, llamadas } = solicitarFalso({ tipo: 'respuesta', status: 204 });
    await crearEnviarHttp({ solicitar })(PETICION);
    expect(typeof llamadas[0]?.opciones.lookup).toBe('function');
  });

  it('un 3xx es una respuesta más: no sigue redirecciones', async () => {
    const { solicitar, llamadas } = solicitarFalso({
      tipo: 'respuesta',
      status: 301,
      trozos: ['movido'],
    });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r).toEqual({ tipo: 'respuesta', status: 301, cuerpo: 'movido' });
    expect(llamadas).toHaveLength(1);
  });

  it('lee como máximo 64 KB (o lo configurado) y corta la conexión', async () => {
    const { solicitar, llamadas } = solicitarFalso({
      tipo: 'respuesta',
      status: 500,
      trozos: ['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)],
    });
    const r = await crearEnviarHttp({ solicitar, lookup, maximoBytes: 10 })(PETICION);
    expect(r).toEqual({ tipo: 'respuesta', status: 500, cuerpo: 'aaaaaabbbb' });
    expect(llamadas[0]?.respuestaDestruida).toBe(true);
  });

  it('un corte en medio del cuerpo conserva el status recibido', async () => {
    const { solicitar } = solicitarFalso({
      tipo: 'respuesta',
      status: 202,
      trozos: ['parc'],
      cortar: true,
    });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r).toEqual({ tipo: 'respuesta', status: 202, cuerpo: 'parc' });
  });

  it('timeout: destruye la petición y responde una falla reintentable', async () => {
    const { solicitar, llamadas } = solicitarFalso({ tipo: 'timeout' });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r).toEqual({ tipo: 'falla', mensaje: expect.stringContaining('no respondió en 10 s') });
    expect(llamadas[0]?.destruida?.name).toBe('TimeoutError');
  });

  it('una IP bloqueada por el lookup se descarta (bloqueada), no se reintenta', async () => {
    const { solicitar } = solicitarFalso({
      tipo: 'error',
      error: new ErrorDireccionBloqueada('x'),
    });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r).toEqual({ tipo: 'bloqueada', mensaje: MENSAJE_DIRECCION_BLOQUEADA });
  });

  it('errores de red y TLS: falla con un texto sin detalles internos', async () => {
    for (const [code, texto] of [
      ['ENOTFOUND', 'resolver el dominio'],
      ['ECONNREFUSED', 'rechazó la conexión'],
      ['ECONNRESET', 'cortó la conexión'],
      ['CERT_HAS_EXPIRED', 'certificado TLS'],
      ['EOTRO', 'No pudimos conectarnos'],
    ] as const) {
      const error = Object.assign(new Error(`connect ${code} 10.0.0.1:443`), { code });
      const { solicitar } = solicitarFalso({ tipo: 'error', error });
      const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
      expect(r.tipo).toBe('falla');
      expect(r.tipo === 'falla' && r.mensaje).toContain(texto);
      expect(r.tipo === 'falla' && r.mensaje).not.toContain('10.0.0.1');
    }
  });

  it('si request lanza al armar la petición, es una falla', async () => {
    const { solicitar } = solicitarFalso({ tipo: 'lanzar', error: new Error('boom') });
    const r = await crearEnviarHttp({ solicitar, lookup })(PETICION);
    expect(r.tipo).toBe('falla');
  });

  it('URL que no pasa la validación o con IP literal: bloqueada sin abrir conexión', async () => {
    for (const url of [
      'http://receptor.example.com/x',
      'https://receptor.example.com:8443/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://usuario:clave@receptor.example.com/x',
      'https://servicio.internal/x',
    ]) {
      const { solicitar, llamadas } = solicitarFalso({ tipo: 'respuesta', status: 200 });
      const r = await crearEnviarHttp({ solicitar, lookup })({ ...PETICION, url });
      expect(r.tipo, url).toBe('bloqueada');
      expect(llamadas, url).toHaveLength(0);
    }
  });
});

describe('mensajeFalla', () => {
  it('AbortError (AbortSignal.timeout) se informa como timeout', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(mensajeFalla(e)).toContain('no respondió');
    expect(mensajeFalla(undefined)).toContain('No pudimos conectarnos');
  });
});
