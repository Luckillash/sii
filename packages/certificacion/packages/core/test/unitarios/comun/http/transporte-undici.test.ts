// Transporte real contra servidores HTTPS locales (127.0.0.1) con material TLS
// generado al vuelo. No sale a la red externa y cierra todos los sockets al final.

import { once } from 'node:events';
import { createServer as crearHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as crearHttps, type Server as ServidorHttps } from 'node:https';
import type { AddressInfo } from 'node:net';
import { createServer as crearTcp, type Server as ServidorTcp, type Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorTransporte } from '../../../../src/comun/errores.ts';
import { TransporteUndici } from '../../../../src/comun/http/transporte-undici.ts';
import { generarMaterialTls, type MaterialTls } from './soporte-tls.ts';

interface Eco {
  metodo: string;
  ruta: string;
  cabeceras: string[];
  cuerpo: string;
}

let material: MaterialTls;
let principal: ServidorHttps;
let mtls: ServidorHttps;
let noConfiable: ServidorHttps;
let plano: ReturnType<typeof crearHttp>;
let mudo: ServidorTcp;
const socketsMudos = new Set<Socket>();
let transporte: TransporteUndici;
let destinoVisitado = 0;

const base = (servidor: { address(): AddressInfo | string | null }, esquema = 'https') =>
  `${esquema}://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

async function leer(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  return Buffer.concat(partes);
}

async function rutas(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cuerpo = await leer(req);
  const ruta = req.url ?? '/';
  if (ruta.startsWith('/eco')) {
    const eco: Eco = {
      metodo: req.method ?? '',
      ruta,
      cabeceras: req.rawHeaders,
      cuerpo: cuerpo.toString('base64'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(eco));
  } else if (ruta === '/redireccion') {
    res.writeHead(302, { Location: '/destino' }).end('moved');
  } else if (ruta === '/destino') {
    destinoVisitado++;
    res.end('destino');
  } else if (ruta === '/cookies') {
    res.setHeader('Set-Cookie', ['TOKEN=abc; Path=/', 'NETSCAPE_LIVEWIRE.rut=1; Domain=.sii.cl']);
    res.setHeader('X-Varios', ['uno', 'dos']);
    res.end('ok');
  } else if (ruta === '/gzip') {
    const acepta = String(req.headers['accept-encoding'] ?? '');
    if (acepta.includes('gzip')) {
      res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync('comprimido ñ'));
    } else {
      res.end('sin comprimir');
    }
  } else if (ruta === '/gzip-siempre') {
    res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync('siempre'));
  } else if (ruta === '/deflate-crudo') {
    res.writeHead(200, { 'Content-Encoding': 'deflate' }).end(deflateRawSync('deflate crudo'));
  } else if (ruta === '/gzip-roto') {
    res.writeHead(200, { 'Content-Encoding': 'gzip' }).end('esto no es gzip');
  } else if (ruta === '/iso') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=ISO-8859-1' });
    res.end(Buffer.from('Díaz', 'latin1'));
  } else if (ruta === '/colgado') {
    // Nunca responde.
  } else {
    res.writeHead(404).end();
  }
}

async function escuchar<T extends { listen(port: number, host: string): unknown }>(
  servidor: T,
): Promise<T> {
  servidor.listen(0, '127.0.0.1');
  await once(servidor as unknown as NodeJS.EventEmitter, 'listening');
  return servidor;
}

async function cerrarHttp(servidor: ServidorHttps | ReturnType<typeof crearHttp> | undefined) {
  if (servidor === undefined) return;
  servidor.closeAllConnections();
  await new Promise<void>((listo) => servidor.close(() => listo()));
}

beforeAll(async () => {
  material = generarMaterialTls();

  const manejar = (req: IncomingMessage, res: ServerResponse) => {
    void rutas(req, res);
  };
  principal = await escuchar(crearHttps(material.servidor, manejar));
  noConfiable = await escuchar(crearHttps(material.servidorNoConfiable, manejar));
  plano = await escuchar(crearHttp(manejar));
  mtls = await escuchar(
    crearHttps(
      { ...material.servidor, ca: material.ca, requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        const cn = (req.socket as TLSSocket).getPeerCertificate().subject?.CN;
        res.end(`hola ${String(cn)}`);
      },
    ),
  );
  mudo = await escuchar(
    crearTcp((socket) => {
      // Acepta la conexión TCP y nunca contesta el handshake TLS.
      socketsMudos.add(socket);
      socket.on('close', () => socketsMudos.delete(socket));
      socket.on('error', () => {});
    }),
  );

  transporte = new TransporteUndici({ ca: material.ca });
});

afterAll(async () => {
  await transporte?.close();
  for (const socket of socketsMudos) socket.destroy();
  await Promise.all([
    cerrarHttp(principal),
    cerrarHttp(mtls),
    cerrarHttp(noConfiable),
    cerrarHttp(plano),
    mudo === undefined ? undefined : new Promise<void>((listo) => mudo.close(() => listo())),
  ]);
});

async function falla(promesa: Promise<unknown>): Promise<ErrorTransporte> {
  try {
    await promesa;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorTransporte);
    return error as ErrorTransporte;
  }
  throw new Error('se esperaba un ErrorTransporte');
}

function eco(cuerpo: Buffer): Eco {
  return JSON.parse(cuerpo.toString('utf8')) as Eco;
}

describe('TransporteUndici: TLS', () => {
  it('conecta con un servidor firmado por la CA de prueba (opción ca)', async () => {
    const r = await transporte.enviar({ metodo: 'GET', url: `${base(principal)}/destino` });
    expect(r.status).toBe(200);
    expect(r.cuerpo.toString()).toBe('destino');
  });

  it('sin la CA de prueba, el servidor local no es confiable', async () => {
    const solo = new TransporteUndici();
    try {
      const e = await falla(solo.enviar({ metodo: 'GET', url: `${base(principal)}/destino` }));
      expect(e.message).toBe(
        `No se pudo verificar el certificado TLS de 127.0.0.1:${(principal.address() as AddressInfo).port}; se cortó la conexión por seguridad.`,
      );
      expect(e.status).toBeUndefined();
      expect(e.cause).toBeDefined();
    } finally {
      await solo.close();
    }
  });

  it('rechaza un servidor emitido por otra CA', async () => {
    const e = await falla(
      transporte.enviar({ metodo: 'GET', url: `${base(noConfiable)}/destino` }),
    );
    expect(e.message).toContain('No se pudo verificar el certificado TLS de 127.0.0.1:');
  });

  it('TLS mutuo: el servidor verifica el certificado de cliente (cadena completa)', async () => {
    const r = await transporte.enviar({
      metodo: 'GET',
      url: `${base(mtls)}/quien`,
      tls: material.cliente,
    });
    expect(r.cuerpo.toString()).toBe('hola Titular de Prueba');
  });

  it('TLS mutuo: sin certificado, sin la intermedia o con uno no confiable, el servidor rechaza', async () => {
    const url = `${base(mtls)}/quien`;
    for (const tls of [undefined, material.clienteSinCadena, material.clienteNoConfiable]) {
      const e = await falla(
        transporte.enviar({ metodo: 'GET', url, ...(tls === undefined ? {} : { tls }) }),
      );
      expect(e.message).toContain('127.0.0.1:');
      expect(e.message).not.toContain('BEGIN');
    }
  });

  it('un certificado de cliente ilegible da un error claro sin material PEM', async () => {
    const e = await falla(
      transporte.enviar({
        metodo: 'GET',
        url: `${base(mtls)}/quien`,
        tls: { cert: material.cliente.cert, key: material.clienteNoConfiable.key },
      }),
    );
    expect(e.message).toContain('No se pudo cargar el certificado de cliente');
    expect(e.message).not.toContain('BEGIN');
    expect(String(e.cause)).not.toContain('BEGIN');
  });

  it('con un tope de identidades, cerrar la menos usada no rompe las siguientes', async () => {
    const limitado = new TransporteUndici({ ca: material.ca, maxIdentidadesTls: 1 });
    try {
      const url = `${base(mtls)}/quien`;
      const otra = {
        cert: material.cliente.cert,
        key: material.cliente.key.replace(/\r?\n/g, '\r\n'),
      };
      for (const tls of [material.cliente, otra, material.cliente]) {
        const r = await limitado.enviar({ metodo: 'GET', url, tls });
        expect(r.status).toBe(200);
      }
    } finally {
      await limitado.close();
    }
  });
});

describe('TransporteUndici: conexiones', () => {
  /** Cuenta los handshakes TLS que recibe `servidor` mientras corre `accion`. */
  async function contarConexiones(
    servidor: ServidorHttps,
    accion: () => Promise<void>,
  ): Promise<number> {
    let conexiones = 0;
    const contar = () => {
      conexiones++;
    };
    servidor.on('secureConnection', contar);
    try {
      await accion();
    } finally {
      servidor.off('secureConnection', contar);
    }
    return conexiones;
  }

  it('por defecto reutiliza la conexión (keep-alive)', async () => {
    const url = `${base(principal)}/destino`;
    const conexiones = await contarConexiones(principal, async () => {
      for (let i = 0; i < 3; i++) await transporte.enviar({ metodo: 'GET', url });
    });
    expect(conexiones).toBeLessThanOrEqual(1);
  });

  it('conexionNueva: cada petición abre su propia conexión y pide cerrarla', async () => {
    const url = `${base(principal)}/eco`;
    // Deja una conexión del pool abierta: conexionNueva no debe usarla.
    await transporte.enviar({ metodo: 'GET', url });

    const ecos: Eco[] = [];
    const conexiones = await contarConexiones(principal, async () => {
      for (let i = 0; i < 2; i++) {
        const r = await transporte.enviar({ metodo: 'POST', url, conexionNueva: true });
        ecos.push(eco(r.cuerpo));
      }
    });

    expect(conexiones).toBe(2);
    for (const { cabeceras } of ecos) {
      const i = cabeceras.findIndex((c) => c.toLowerCase() === 'connection');
      expect(cabeceras[i + 1]?.toLowerCase()).toBe('close');
    }
  });

  it('conexionNueva con TLS mutuo presenta el certificado de cliente', async () => {
    const conexiones = await contarConexiones(mtls, async () => {
      const r = await transporte.enviar({
        metodo: 'POST',
        url: `${base(mtls)}/quien`,
        tls: material.cliente,
        conexionNueva: true,
      });
      expect(r.cuerpo.toString()).toBe('hola Titular de Prueba');
    });
    expect(conexiones).toBe(1);
  });

  it('conexionNueva valida el certificado de cliente antes de conectar', async () => {
    const e = await falla(
      transporte.enviar({
        metodo: 'POST',
        url: `${base(mtls)}/quien`,
        tls: { cert: material.cliente.cert, key: material.clienteNoConfiable.key },
        conexionNueva: true,
      }),
    );
    expect(e.message).toContain('No se pudo cargar el certificado de cliente');
  });

  it('conexionNueva: una falla de red sigue siendo ErrorTransporte', async () => {
    const e = await falla(
      transporte.enviar({
        metodo: 'POST',
        url: `${base(principal)}/colgado`,
        msRespuesta: 200,
        conexionNueva: true,
      }),
    );
    expect(e.message).toContain('no respondió');
  });
});

describe('TransporteUndici: peticiones y respuestas', () => {
  it('no sigue redirecciones', async () => {
    const antes = destinoVisitado;
    const r = await transporte.enviar({ metodo: 'POST', url: `${base(principal)}/redireccion` });
    expect(r.status).toBe(302);
    expect(r.esRedireccion()).toBe(true);
    expect(r.cabecera('location')).toEqual(['/destino']);
    expect(destinoVisitado).toBe(antes);
  });

  it('entrega cabeceras multivalor (set-cookie repetida)', async () => {
    const r = await transporte.enviar({ metodo: 'GET', url: `${base(principal)}/cookies` });
    expect(r.cabecera('Set-Cookie')).toEqual([
      'TOKEN=abc; Path=/',
      'NETSCAPE_LIVEWIRE.rut=1; Domain=.sii.cl',
    ]);
    expect(r.cabecera('x-varios')).toEqual(['uno', 'dos']);
  });

  it('el cuerpo llega en bytes, sin decodificar', async () => {
    const r = await transporte.enviar({ metodo: 'GET', url: `${base(principal)}/iso` });
    expect(r.cuerpo).toEqual(Buffer.from([0x44, 0xed, 0x61, 0x7a]));
  });

  it('formulario: Content-Type, bytes de http_build_query y cabeceras en orden', async () => {
    const r = await transporte.enviar({
      metodo: 'POST',
      url: `${base(principal)}/eco?referencia=https://maullin.sii.cl/x`,
      cabeceras: { Referer: 'https://zeusr.sii.cl/', 'User-Agent': 'Mozilla/5.0', Cookie: 'A=1' },
      cuerpo: {
        tipo: 'formulario',
        campos: [
          ['ACEPTAR', Buffer.from('Confirmar Postulación', 'latin1')],
          ['correo', 'a+b@c.cl'],
        ],
      },
    });
    const visto = eco(r.cuerpo);
    expect(visto.metodo).toBe('POST');
    expect(visto.ruta).toBe('/eco?referencia=https://maullin.sii.cl/x');
    expect(Buffer.from(visto.cuerpo, 'base64').toString('latin1')).toBe(
      'ACEPTAR=Confirmar+Postulaci%F3n&correo=a%2Bb%40c.cl',
    );
    // Lo que agrega undici: host, connection y content-length; nada más.
    const nombres = visto.cabeceras.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
    expect(nombres).toEqual([
      'host',
      'connection',
      'referer',
      'user-agent',
      'cookie',
      'content-type',
      'accept-encoding',
      'content-length',
    ]);
    expect(visto.cabeceras).toContain('application/x-www-form-urlencoded');
    expect(visto.cabeceras).toContain('gzip, deflate');
  });

  it('cuerpo crudo: string en UTF-8 y bytes tal cual, con su Content-Type', async () => {
    const xml = '<soapenv:Envelope><getSeed/>ñ</soapenv:Envelope>';
    const r = await transporte.enviar({
      metodo: 'POST',
      url: `${base(principal)}/eco`,
      cabeceras: { SOAPAction: '""' },
      cuerpo: { tipo: 'crudo', datos: xml, contentType: 'text/xml; charset=utf-8' },
      descomprimir: false,
    });
    const visto = eco(r.cuerpo);
    expect(Buffer.from(visto.cuerpo, 'base64').toString('utf8')).toBe(xml);
    expect(visto.cabeceras).toContain('text/xml; charset=utf-8');
    expect(visto.cabeceras.map((c) => c.toLowerCase())).not.toContain('accept-encoding');

    const bytes = Buffer.from([0x37, 0x7c, 0xe1, 0x00, 0xff]);
    const crudo = await transporte.enviar({
      metodo: 'POST',
      url: `${base(principal)}/eco`,
      cuerpo: { tipo: 'crudo', datos: bytes, contentType: 'text/x-gwt-rpc; charset=UTF-8' },
    });
    expect(Buffer.from(eco(crudo.cuerpo).cuerpo, 'base64')).toEqual(bytes);
  });

  it('descomprime gzip y deflate crudo, como CURLOPT_ENCODING', async () => {
    const gzip = await transporte.enviar({ metodo: 'GET', url: `${base(principal)}/gzip` });
    expect(gzip.cuerpo.toString('utf8')).toBe('comprimido ñ');
    expect(gzip.cabecera('content-encoding')).toEqual(['gzip']);

    const deflate = await transporte.enviar({
      metodo: 'GET',
      url: `${base(principal)}/deflate-crudo`,
    });
    expect(deflate.cuerpo.toString('utf8')).toBe('deflate crudo');
  });

  it('con descomprimir: false no pide compresión ni descomprime', async () => {
    const pedida = await transporte.enviar({
      metodo: 'GET',
      url: `${base(principal)}/gzip`,
      descomprimir: false,
    });
    expect(pedida.cuerpo.toString('utf8')).toBe('sin comprimir');

    const forzada = await transporte.enviar({
      metodo: 'GET',
      url: `${base(principal)}/gzip-siempre`,
      descomprimir: false,
    });
    expect(forzada.cuerpo).toEqual(gzipSync('siempre'));
  });

  it('una respuesta gzip corrupta es ErrorTransporte con el status', async () => {
    const e = await falla(
      transporte.enviar({ metodo: 'GET', url: `${base(principal)}/gzip-roto` }),
    );
    expect(e.status).toBe(200);
    expect(e.message).toContain('no se pudo descomprimir');
  });
});

describe('TransporteUndici: tiempos, cancelación y esquemas', () => {
  it('timeout de respuesta → ErrorTransporte que nombra el host', async () => {
    const e = await falla(
      transporte.enviar({ metodo: 'GET', url: `${base(principal)}/colgado`, msRespuesta: 300 }),
    );
    expect(e.message).toMatch(/^127\.0\.0\.1:\d+ no respondió dentro de 0\.3 s\.$/);
    expect(e.url).toBe(`${base(principal)}/colgado`);
  });

  it('timeout de conexión (el servidor nunca termina el handshake)', async () => {
    const lento = new TransporteUndici({ ca: material.ca, msConexion: 300 });
    try {
      const e = await falla(lento.enviar({ metodo: 'GET', url: `${base(mudo)}/` }));
      expect(e.message).toContain('se agotó el tiempo de conexión (0.3 s)');
    } finally {
      await lento.close();
    }
  });

  it('cancelación con AbortSignal', async () => {
    const control = new AbortController();
    const promesa = transporte.enviar({
      metodo: 'GET',
      url: `${base(principal)}/colgado`,
      signal: control.signal,
    });
    setTimeout(() => control.abort(), 50);
    const e = await falla(promesa);
    expect(e.message).toMatch(/^Se canceló la petición a 127\.0\.0\.1:\d+\.$/);
  });

  it('una falla de red no expone cookies ni la query en el mensaje', async () => {
    const e = await falla(
      transporte.enviar({
        metodo: 'GET',
        url: 'https://127.0.0.1:1/x?rut=11111111-1',
        cabeceras: { Cookie: 'TOKEN=SECRETO' },
      }),
    );
    expect(e.message).toBe('No se pudo conectar con 127.0.0.1:1: la conexión fue rechazada.');
    expect(e.url).toBe('https://127.0.0.1:1/x');
  });

  it('rechaza http: salvo con permitirHttp', async () => {
    const url = `${base(plano, 'http')}/destino`;
    const e = await falla(transporte.enviar({ metodo: 'GET', url }));
    expect(e.message).toMatch(/^Solo se permiten conexiones https/);

    const permisivo = new TransporteUndici({ permitirHttp: true });
    try {
      const r = await permisivo.enviar({ metodo: 'GET', url });
      expect(r.cuerpo.toString()).toBe('destino');
      await falla(permisivo.enviar({ metodo: 'GET', url: 'ftp://127.0.0.1/x' }));
    } finally {
      await permisivo.close();
    }
  });

  it('después de close() no envía más', async () => {
    const t = new TransporteUndici({ ca: material.ca });
    await t.enviar({ metodo: 'GET', url: `${base(principal)}/destino` });
    await t[Symbol.asyncDispose]();
    const e = await falla(t.enviar({ metodo: 'GET', url: `${base(principal)}/destino` }));
    expect(e.message).toContain('ya se cerró');
  });
});
