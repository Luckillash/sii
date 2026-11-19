import type { LookupAddress, LookupOptions } from 'node:dns';
import { describe, expect, it } from 'vitest';
import {
  crearLookupSeguro,
  ErrorDireccionBloqueada,
  esDireccionBloqueada,
  normalizarIp,
} from './ssrf';

describe('esDireccionBloqueada', () => {
  it('bloquea privadas, loopback, link-local, CGNAT, multicast y reservadas (IPv4)', () => {
    for (const ip of [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.1',
      '10.255.255.255',
      '100.64.0.1',
      '100.127.255.254',
      '127.0.0.1',
      '127.8.9.10',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      expect(esDireccionBloqueada(ip), ip).toBe(true);
    }
  });

  it('deja pasar IPv4 públicas (incluidos los bordes de los rangos)', () => {
    for (const ip of [
      '1.1.1.1',
      '8.8.8.8',
      '9.255.255.255',
      '11.0.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.169.0.1',
      '198.17.255.255',
      '198.20.0.0',
      '200.27.10.20',
      '223.255.255.255',
    ]) {
      expect(esDireccionBloqueada(ip), ip).toBe(false);
    }
  });

  it('bloquea IPv6 locales, ULA, link-local, multicast, NAT64 e IPv4 mapeadas o compatibles', () => {
    for (const ip of [
      '::',
      '::1',
      '::127.0.0.1',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'febf::1',
      'ff02::1',
      '64:ff9b::7f00:1',
      '100::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::FFFF:192.168.0.1',
      '::ffff:7f00:1',
    ]) {
      expect(esDireccionBloqueada(ip), ip).toBe(true);
    }
  });

  it('deja pasar IPv6 públicas y bloquea lo que no es una IP', () => {
    expect(esDireccionBloqueada('2606:4700:4700::1111')).toBe(false);
    expect(esDireccionBloqueada('2800:3f0:4002:80a::200e')).toBe(false);
    expect(esDireccionBloqueada('::ffff:8.8.8.8')).toBe(false);
    expect(esDireccionBloqueada('no-es-ip')).toBe(true);
    expect(esDireccionBloqueada('')).toBe(true);
  });

  it('normalizarIp lleva ::ffff:a.b.c.d a IPv4', () => {
    expect(normalizarIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizarIp('2606:4700::1')).toBe('2606:4700::1');
  });
});

type Resolver = Parameters<typeof crearLookupSeguro>[0] & {};

function resolverFijo(direcciones: LookupAddress[] | Error): Resolver {
  return (_host, _opciones, callback) => {
    if (direcciones instanceof Error) callback(direcciones as NodeJS.ErrnoException, []);
    else callback(null, direcciones);
  };
}

function llamar(lookup: ReturnType<typeof crearLookupSeguro>, opciones: LookupOptions) {
  return new Promise<{ error: Error | null; direccion: unknown; familia?: number }>((resolver) => {
    lookup('receptor.example.com', opciones, (error, direccion, familia) =>
      resolver({ error, direccion, familia }),
    );
  });
}

describe('crearLookupSeguro', () => {
  it('con all: true devuelve la lista (lo que usa autoSelectFamily)', async () => {
    const lookup = crearLookupSeguro(
      resolverFijo([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ]),
    );
    const r = await llamar(lookup, { all: true });
    expect(r.error).toBeNull();
    expect(r.direccion).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('sin all devuelve la primera dirección y su familia', async () => {
    const lookup = crearLookupSeguro(resolverFijo([{ address: '93.184.216.34', family: 4 }]));
    const r = await llamar(lookup, {});
    expect(r).toEqual({ error: null, direccion: '93.184.216.34', familia: 4 });
  });

  it('rechaza si ALGUNA dirección está bloqueada (sin alternar entre pública e interna)', async () => {
    const lookup = crearLookupSeguro(
      resolverFijo([
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]),
    );
    for (const opciones of [{ all: true }, {}] as LookupOptions[]) {
      const r = await llamar(lookup, opciones);
      expect(r.error).toBeInstanceOf(ErrorDireccionBloqueada);
    }
  });

  it('una IPv4 mapeada en IPv6 se revisa (y se devuelve) como IPv4', async () => {
    const bloqueada = await llamar(
      crearLookupSeguro(resolverFijo([{ address: '::ffff:127.0.0.1', family: 6 }])),
      { all: true },
    );
    expect(bloqueada.error).toBeInstanceOf(ErrorDireccionBloqueada);
    const publica = await llamar(
      crearLookupSeguro(resolverFijo([{ address: '::ffff:8.8.8.8', family: 6 }])),
      {},
    );
    expect(publica).toEqual({ error: null, direccion: '8.8.8.8', familia: 4 });
  });

  it('propaga el error del DNS y trata una lista vacía como ENOTFOUND', async () => {
    const fallo = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const r1 = await llamar(crearLookupSeguro(resolverFijo(fallo)), { all: true });
    expect(r1.error).toBe(fallo);
    const r2 = await llamar(crearLookupSeguro(resolverFijo([])), { all: true });
    expect((r2.error as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });

  it('pasa la familia pedida al resolver', async () => {
    const vistas: unknown[] = [];
    const lookup = crearLookupSeguro((_h, opciones, cb) => {
      vistas.push(opciones);
      cb(null, [{ address: '2606:4700:4700::1111', family: 6 }]);
    });
    await llamar(lookup, { family: 6 });
    expect(vistas[0]).toMatchObject({ all: true, family: 6 });
  });
});
