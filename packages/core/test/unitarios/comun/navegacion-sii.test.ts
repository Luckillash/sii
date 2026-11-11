// Tests de la navegación compartida por folios y postulación (pend. 2.2 y 6.1).
// resolverUrl también se compara contra el PHP (caso de paridad resolver-url).

import { describe, expect, it } from 'vitest';
import { SesionCaducaError } from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import { TransporteFalso } from '../../../src/comun/http/transporte-falso.ts';
import {
  exigirSesionVigente,
  navegar,
  USER_AGENT_NAVEGADOR,
} from '../../../src/comun/navegacion-sii.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';

const ok = (url: string, error: (m: string) => Error = (m) => new Error(m)) => ({
  metodo: 'POST' as const,
  url,
  cuerpo: { tipo: 'formulario' as const, campos: { a: '1' } },
  cabeceras: { Referer: 'https://maullin.sii.cl/inicio' },
  msRespuesta: 1000,
  revisar: () => {},
  errorRedirecciones: error,
});

describe('navegar', () => {
  it('agrega User-Agent, Accept y la Cookie de la sesión; guarda Set-Cookie de cada salto', async () => {
    const transporte = new TransporteFalso([
      ['maullin.sii.cl/a', new RespuestaHttp(302, { location: '/b', 'set-cookie': 'X=1' })],
      ['maullin.sii.cl/b', 'fin'],
    ]);
    const sesion = new SesionSii();
    const r = await navegar(transporte, sesion, ok('https://maullin.sii.cl/a'));
    expect(r.cuerpo.toString()).toBe('fin');
    const [a, b] = transporte.enviadas;
    expect(a?.cabeceras['User-Agent']).toBe(USER_AGENT_NAVEGADOR);
    expect(a?.cabeceras.Accept).toBe('*/*');
    expect(a?.cabeceras.Cookie).toBeUndefined();
    expect(b?.cabeceras.Cookie).toBe('X=1');
    expect(b?.cabeceras.Referer).toBe('https://maullin.sii.cl/a');
    expect(b?.metodo).toBe('GET');
    expect(b?.cuerpo).toBeUndefined();
  });

  it('307 y 308 repiten el método y el cuerpo (y la conexión propia)', async () => {
    for (const status of [307, 308]) {
      const transporte = new TransporteFalso([
        ['maullin.sii.cl/a', new RespuestaHttp(status, { location: 'b' })],
        ['maullin.sii.cl/b', 'fin'],
      ]);
      await navegar(transporte, new SesionSii(), {
        ...ok('https://maullin.sii.cl/a'),
        conexionNueva: true,
      });
      expect(transporte.enviadas.map((p) => [p.metodo, p.conexionNueva])).toEqual([
        ['POST', true],
        ['POST', true],
      ]);
    }
  });

  it('revisa cada destino ANTES de enviarle nada', async () => {
    const transporte = new TransporteFalso([
      ['maullin.sii.cl/a', new RespuestaHttp(302, { location: 'https://evil.example/' })],
    ]);
    const revisados: string[] = [];
    await expect(
      navegar(transporte, new SesionSii(), {
        ...ok('https://maullin.sii.cl/a'),
        revisar: (url) => {
          revisados.push(url);
          if (!url.startsWith('https://maullin.sii.cl/')) throw new Error('fuera');
        },
      }),
    ).rejects.toThrow('fuera');
    expect(revisados).toEqual(['https://maullin.sii.cl/a', 'https://evil.example/']);
    expect(transporte.enviadas).toHaveLength(1);
  });

  it('respeta un User-Agent propio y usa el error de quien llama tras 10 redirecciones', async () => {
    const transporte = new TransporteFalso([['*', new RespuestaHttp(302, { location: 'x' })]]);
    class Mio extends Error {}
    await expect(
      navegar(transporte, new SesionSii(), {
        ...ok('https://maullin.sii.cl/a', (m) => new Mio(m)),
        cabeceras: { 'user-agent': 'propio' },
      }),
    ).rejects.toBeInstanceOf(Mio);
    expect(transporte.enviadas).toHaveLength(11);
    expect(transporte.enviadas[0]?.cabeceras['user-agent']).toBe('propio');
    expect(transporte.enviadas[0]?.cabeceras['User-Agent']).toBeUndefined();
  });
});

describe('exigirSesionVigente', () => {
  it.each([
    'autInicioDTE',
    'IngresoCertificado',
    'InicioAutenticacion',
    'CAutInicio.cgi',
    'CAutValida',
  ])('lanza con %s', (marcador) => {
    expect(() => exigirSesionVigente(`<a href="/${marcador}">`)).toThrow(SesionCaducaError);
  });

  it('no lanza con una página normal', () => {
    expect(() => exigirSesionVigente('<form action="of_genera_folio">')).not.toThrow();
  });
});
