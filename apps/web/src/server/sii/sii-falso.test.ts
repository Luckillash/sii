import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TransporteFalso, TransporteUndici } from '@winex/certificacion';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PeticionSimulador,
  transporteSiiFalso,
  urlSiiFalso,
  VARIABLE_SII_FALSO,
} from './sii-falso';
import { crearTransporte } from './transporte';

// El SII falso de las e2e (Fase 13) nunca puede activarse en Production: ni en Vercel
// (cualquier ambiente) ni con un build de producción, y solo apunta a loopback.

const URL_OK = 'http://127.0.0.1:3197';

describe('urlSiiFalso', () => {
  it('sin la variable no hay SII falso', () => {
    expect(urlSiiFalso({ NODE_ENV: 'development' })).toBeNull();
    expect(urlSiiFalso({ NODE_ENV: 'development', [VARIABLE_SII_FALSO]: '  ' })).toBeNull();
  });

  it('con next dev y loopback devuelve la URL', () => {
    for (const valor of [URL_OK, 'http://localhost:3197', 'http://[::1]:3197']) {
      expect(urlSiiFalso({ NODE_ENV: 'development', [VARIABLE_SII_FALSO]: valor })?.href).toBe(
        new URL(valor).href,
      );
    }
  });

  it('en Vercel (Production, Preview o cualquier otro) se ignora: nunca se activa', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const entorno of [
      { VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' },
      { VERCEL: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production' },
      { VERCEL_ENV: 'production' },
      { VERCEL: '1', NODE_ENV: 'development' },
    ]) {
      expect(urlSiiFalso({ ...entorno, [VARIABLE_SII_FALSO]: URL_OK })).toBeNull();
      expect(transporteSiiFalso({ ...entorno, [VARIABLE_SII_FALSO]: URL_OK })).toBeNull();
    }
    error.mockRestore();
  });

  it('con un build de producción local falla cerrado (no vuelve al SII real)', () => {
    expect(() => urlSiiFalso({ NODE_ENV: 'production', [VARIABLE_SII_FALSO]: URL_OK })).toThrow(
      /solo se permite con next dev/,
    );
  });

  it.each([
    ['https://127.0.0.1:3197'],
    ['http://10.0.0.5:3197'],
    ['http://sii.cl'],
    ['http://127.0.0.1.nip.io:3197'],
    ['http://usuario:clave@127.0.0.1:3197'],
    ['no es una url'],
  ])('rechaza %s (solo http hacia loopback)', (valor) => {
    expect(() => urlSiiFalso({ NODE_ENV: 'development', [VARIABLE_SII_FALSO]: valor })).toThrow();
  });
});

describe('crearTransporte con el SII falso', () => {
  let servidor: Server | undefined;
  const original = process.env[VARIABLE_SII_FALSO];

  afterEach(async () => {
    if (original === undefined) delete process.env[VARIABLE_SII_FALSO];
    else process.env[VARIABLE_SII_FALSO] = original;
    await new Promise<void>((listo) => (servidor ? servidor.close(() => listo()) : listo()));
    servidor = undefined;
  });

  it('sin la variable sigue creando el TransporteUndici real', async () => {
    delete process.env[VARIABLE_SII_FALSO];
    await using transporte = crearTransporte();
    expect(transporte).toBeInstanceOf(TransporteUndici);
  });

  it('reenvía la petición al simulador, sin el certificado de cliente', async () => {
    const recibidas: PeticionSimulador[] = [];
    servidor = createServer((req, res) => {
      let datos = '';
      req.on('data', (c) => {
        datos += c;
      });
      req.on('end', () => {
        recibidas.push(JSON.parse(datos) as PeticionSimulador);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            status: 200,
            cabeceras: { 'set-cookie': ['A=1', 'B=2'] },
            cuerpo: Buffer.from('<html>falso</html>').toString('base64'),
          }),
        );
      });
    });
    await new Promise<void>((listo) => servidor?.listen(0, '127.0.0.1', listo));
    const { port } = servidor.address() as AddressInfo;
    process.env[VARIABLE_SII_FALSO] = `http://127.0.0.1:${port}`;

    await using transporte = crearTransporte();
    const respuesta = await transporte.enviar({
      metodo: 'POST',
      url: 'https://maullin.sii.cl/cvc_cgi/dte/pe_ingrut',
      cuerpo: { tipo: 'formulario', campos: [['ACEPTAR', 'Aceptar Condiciones']] },
      tls: {
        cert: '-----BEGIN CERTIFICATE-----SECRETO',
        key: '-----BEGIN PRIVATE KEY-----SECRETO',
      },
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.cuerpo.toString()).toBe('<html>falso</html>');
    expect(respuesta.cabecera('set-cookie')).toEqual(['A=1', 'B=2']);
    expect(recibidas).toHaveLength(1);
    const [p] = recibidas;
    expect(p?.url).toBe('https://maullin.sii.cl/cvc_cgi/dte/pe_ingrut');
    expect(p?.metodo).toBe('POST');
    expect(Buffer.from(p?.cuerpo ?? '', 'base64').toString()).toBe('ACEPTAR=Aceptar+Condiciones');
    expect(p?.tls).toBe(true);
    expect(JSON.stringify(p)).not.toContain('SECRETO');
  });

  it('transporteSiiFalso arma un TransporteFalso (nunca TransporteUndici)', () => {
    expect(
      transporteSiiFalso({ NODE_ENV: 'development', [VARIABLE_SII_FALSO]: URL_OK }),
    ).toBeInstanceOf(TransporteFalso);
  });
});
