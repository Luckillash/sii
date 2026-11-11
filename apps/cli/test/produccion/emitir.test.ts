// `sii produccion emitir`: todo contra el TransporteFalso; nada sale a la red.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type PeticionRegistrada,
  type RespuestaFalsa,
  RespuestaHttp,
  TransporteFalso,
} from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { CLAVE_PFX, correr, type Proyecto, proyecto } from '../soporte/cli.ts';
import { fixture, SII_FALSO, TOKEN } from './soporte.ts';

const BOLETA = {
  detalles: [
    { nombre: 'Producto de prueba', cantidad: 2, precio: 1000 },
    { nombre: 'Servicio exento', cantidad: 1, precio: 500, exento: true, unidad: 'Hr' },
  ],
};

/** Proyecto con la configuración de producción y el JSON de la boleta en `boleta.json`. */
function proyectoProduccion(boleta: unknown = BOLETA): Proyecto {
  const p = proyecto();
  p.escribirEnv({
    SII_PRODUCCION_CAF_39: 'data/caf/caf-39.xml',
    SII_PRODUCCION_NRO_RESOL: '80',
    SII_PRODUCCION_FCH_RESOL: '2014-08-22',
  });
  p.escribir('boleta.json', typeof boleta === 'string' ? boleta : JSON.stringify(boleta));
  return p;
}

const salida = (p: Proyecto, nombre: string) => join(p.dir, 'data', 'output', nombre);

/** El SII falso de un ambiente: semilla, token y envío. */
function siiFalso(
  ambiente: keyof typeof SII_FALSO,
  envio: RespuestaFalsa = fixture('envio-recibido.json'),
): TransporteFalso {
  const { auth, envio: hostEnvio } = SII_FALSO[ambiente];
  return new TransporteFalso({
    [`${auth}/boleta.electronica.semilla`]: fixture('semilla.xml'),
    [`${auth}/boleta.electronica.token`]: fixture('token.xml'),
    [`${hostEnvio}/boleta.electronica.envio`]: envio,
  });
}

function sinSecretos(r: { stdout: string; stderr: string }): void {
  for (const texto of [r.stdout, r.stderr]) {
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(TOKEN.slice(0, 6));
    expect(texto).not.toContain(CLAVE_PFX);
    expect(texto).not.toContain('PRIVATE KEY');
  }
}

describe('sii produccion emitir', () => {
  it('sin --confirmar arma, guarda el XML y no hace ninguna petición', async () => {
    const p = proyectoProduccion();
    const r = await correr(p, ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '3']);
    expect(r.stderr).toContain('PRODUCCIÓN');
    expect(r.stderr).toContain('REAL');
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);

    expect(r.stdout).toContain('EMPRESA DE PRUEBA SPA (76123456-0)');
    expect(r.stdout).toContain('Cliente General (66666666-6)');
    expect(r.stdout).toContain('Folio:       3');
    expect(r.stdout).toContain('folios 1 a 10');
    expect(r.stdout).toContain('N° 80 del 2014-08-22');
    expect(r.stdout).toContain('Servicio exento: 1 Hr x $500 (exento)');
    expect(r.stdout).toContain('Total:       $2500');
    expect(r.stdout).toContain('--confirmar');
    expect(r.stdout).toContain('No se envió nada al SII');

    const xml = readFileSync(salida(p, 'boleta-produccion-3.xml'));
    const texto = xml.toString('latin1');
    expect(texto.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    expect(texto).toContain('<Folio>3</Folio>');
    expect(texto).toContain('<NroResol>80</NroResol>');
    expect(texto).toContain('<FchResol>2014-08-22</FchResol>');
    expect(texto).toContain('<FchEmis>2026-11-07</FchEmis>');
    expect(existsSync(salida(p, 'boleta-produccion-3.envio.json'))).toBe(false);
    sinSecretos(r);
  });

  it('con --confirmar en certificación pide token y envía a apicert/pangal', async () => {
    const p = proyectoProduccion();
    const transporte = siiFalso('certificacion');
    const r = await correr(
      p,
      [
        'produccion',
        'emitir',
        '--ambiente',
        'certificacion',
        '--boleta',
        'boleta.json',
        '--folio',
        '4',
        '--confirmar',
      ],
      { transporte },
    );
    expect(r.stderr).toBe('');
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls()).toEqual([
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.token',
      'https://pangal.sii.cl/recursos/v1/boleta.electronica.envio',
    ]);
    // El sobre que se sube es, byte a byte, el que quedó guardado.
    const xml = readFileSync(salida(p, 'boleta-certificacion-4.xml'));
    const envio = transporte.enviadas[2] as PeticionRegistrada;
    expect(envio.bytes?.includes(xml)).toBe(true);
    expect(envio.cabeceras.Cookie).toBe(`TOKEN=${TOKEN}`);
    // Certificación usa SII_NRO_RESOL / SII_FCH_RESOL.
    expect(xml.toString('latin1')).toContain('<FchResol>2026-09-05</FchResol>');

    expect(r.stdout).toContain('TrackID:   1234567890');
    expect(r.stdout).toContain('Estado:    REC');
    expect(r.stdout).toContain('sii produccion consultar 1234567890 --ambiente certificacion');
    const registro = JSON.parse(
      readFileSync(salida(p, 'boleta-certificacion-4.envio.json'), 'utf8'),
    );
    expect(registro).toMatchObject({
      ambiente: 'certificacion',
      folio: 4,
      tipoDte: 39,
      trackId: '1234567890',
      estado: 'REC',
      incierto: false,
    });
    expect(JSON.stringify(registro)).not.toContain(TOKEN);
    sinSecretos(r);
  });

  it('con --confirmar en producción va a api.sii.cl y rahue.sii.cl', async () => {
    const p = proyectoProduccion();
    const transporte = siiFalso('produccion');
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '5', '--confirmar'],
      { transporte },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stderr).toContain('REAL y consume el folio 5');
    expect(transporte.urls()).toEqual([
      'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://api.sii.cl/recursos/v1/boleta.electronica.token',
      'https://rahue.sii.cl/recursos/v1/boleta.electronica.envio',
    ]);
    expect(r.stdout).toContain(
      'Siguiente paso, en unos minutos: sii produccion consultar 1234567890',
    );
    expect(r.stdout).not.toContain('--ambiente');
    sinSecretos(r);
  });

  it('con SII_CACHE_TOKENS reutiliza el token en la siguiente ejecución', async () => {
    const p = proyectoProduccion();
    p.escribirEnv({ SII_CACHE_TOKENS: 'data/tokens.json' });
    const args = ['produccion', 'emitir', '--boleta', 'boleta.json', '--confirmar'];
    const primero = siiFalso('produccion');
    expect((await correr(p, [...args, '--folio', '1'], { transporte: primero })).codigo).toBe(0);
    expect(primero.enviadas).toHaveLength(3);

    const segundo = siiFalso('produccion');
    expect((await correr(p, [...args, '--folio', '2'], { transporte: segundo })).codigo).toBe(0);
    expect(segundo.urls()).toEqual(['https://rahue.sii.cl/recursos/v1/boleta.electronica.envio']);
  });

  it('un folio ya enviado no se vuelve a armar ni a enviar', async () => {
    const p = proyectoProduccion();
    const args = ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '6'];
    expect(
      (await correr(p, [...args, '--confirmar'], { transporte: siiFalso('produccion') })).codigo,
    ).toBe(0);
    const xmlEnviado = readFileSync(salida(p, 'boleta-produccion-6.xml'));

    for (const extra of [['--confirmar'], []]) {
      const r = await correr(p, [...args, ...extra], { transporte: siiFalso('produccion') });
      expect(r.codigo).toBe(CODIGOS.CONFIG);
      expect(r.stderr).toContain('El folio 6 ya se envió al SII');
      expect(r.stderr).toContain('trackId 1234567890');
      expect(r.transporte.enviadas).toHaveLength(0);
    }
    // El XML enviado no se pisó.
    expect(readFileSync(salida(p, 'boleta-produccion-6.xml')).equals(xmlEnviado)).toBe(true);
  });

  it('si el envío se corta, sale con 6 (incierto) y bloquea el folio', async () => {
    const p = proyectoProduccion();
    const transporte = siiFalso('produccion', () => {
      throw new Error('socket hang up');
    });
    const args = ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '7', '--confirmar'];
    const r = await correr(p, args, { transporte });
    expect(r.codigo).toBe(CODIGOS.INCIERTO);
    expect(r.stderr).toContain('No se sabe si el SII recibió la boleta');
    const registro = JSON.parse(readFileSync(salida(p, 'boleta-produccion-7.envio.json'), 'utf8'));
    expect(registro).toMatchObject({ folio: 7, incierto: true });

    const otra = await correr(p, args, { transporte: siiFalso('produccion') });
    expect(otra.codigo).toBe(CODIGOS.CONFIG);
    expect(otra.stderr).toContain('envío incierto');
    expect(otra.transporte.enviadas).toHaveLength(0);
  });

  it('un HTTP 5xx en el envío también es incierto', async () => {
    const p = proyectoProduccion();
    const transporte = siiFalso('produccion', new RespuestaHttp(503, {}, 'no disponible'));
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '8', '--confirmar'],
      { transporte },
    );
    expect(r.codigo).toBe(CODIGOS.INCIERTO);
  });

  it('un HTTP 4xx en el envío no deja registro (el SII no lo recibió)', async () => {
    const p = proyectoProduccion();
    const transporte = siiFalso('produccion', new RespuestaHttp(401, {}, 'no autorizado'));
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '8', '--confirmar'],
      { transporte },
    );
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(existsSync(salida(p, 'boleta-produccion-8.envio.json'))).toBe(false);
    sinSecretos(r);
  });

  it('un folio fuera del rango del CAF es error y no sale nada', async () => {
    const p = proyectoProduccion();
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '11', '--confirmar'],
      { transporte: siiFalso('produccion') },
    );
    expect(r.codigo).toBe(CODIGOS.ERROR);
    expect(r.stderr).toContain('El folio 11 está fuera del rango del CAF (1–10)');
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(existsSync(salida(p, 'boleta-produccion-11.xml'))).toBe(false);
  });

  it('producción exige su propia configuración (código 3, sin peticiones)', async () => {
    const p = proyecto();
    p.escribir('boleta.json', JSON.stringify(BOLETA));
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1', '--confirmar'],
      { transporte: siiFalso('produccion') },
    );
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_PRODUCCION_NRO_RESOL');
    expect(r.stderr).toContain('SII_PRODUCCION_FCH_RESOL');
    expect(r.transporte.enviadas).toHaveLength(0);

    p.escribirEnv({ SII_PRODUCCION_NRO_RESOL: '80', SII_PRODUCCION_FCH_RESOL: '2014-08-22' });
    const sinCaf = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'boleta.json',
      '--folio',
      '1',
    ]);
    expect(sinCaf.codigo).toBe(CODIGOS.CONFIG);
    expect(sinCaf.stderr).toContain('SII_PRODUCCION_CAF_39 (o --caf): falta');

    const conCaf = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'boleta.json',
      '--folio',
      '1',
      '--caf',
      'data/caf/caf-39.xml',
    ]);
    expect(conCaf.codigo).toBe(CODIGOS.OK);
  });

  it('un certificado ilegible es error de configuración sin peticiones', async () => {
    const p = proyectoProduccion();
    p.escribirEnv({ SII_CERT_PASS: 'otra-clave' });
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1', '--confirmar'],
      { transporte: siiFalso('produccion') },
    );
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stderr).not.toContain('otra-clave');
  });

  it('SII_CACHE_TOKENS en una carpeta que no existe falla antes de armar', async () => {
    const p = proyectoProduccion();
    p.escribirEnv({ SII_CACHE_TOKENS: 'no-existe/tokens.json' });
    const r = await correr(
      p,
      ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1', '--confirmar'],
      { transporte: siiFalso('produccion') },
    );
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_CACHE_TOKENS');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('faltan --boleta o --folio: error de uso', async () => {
    const p = proyectoProduccion();
    const sinFolio = await correr(p, ['produccion', 'emitir', '--boleta', 'boleta.json']);
    expect(sinFolio.codigo).toBe(CODIGOS.USO);
    expect(sinFolio.stderr).toContain('Falta --folio');
    const sinBoleta = await correr(p, ['produccion', 'emitir', '--folio', '1']);
    expect(sinBoleta.codigo).toBe(CODIGOS.USO);
    expect(sinBoleta.stderr).toContain('Falta --boleta');
    const folioMalo = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'b.json',
      '--folio',
      '0',
    ]);
    expect(folioMalo.codigo).toBe(CODIGOS.USO);
    const ambienteMalo = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'boleta.json',
      '--folio',
      '1',
      '--ambiente',
      'pruebas',
    ]);
    expect(ambienteMalo.codigo).toBe(CODIGOS.USO);
  });

  it('un archivo de boleta que no existe es error de configuración', async () => {
    const p = proyectoProduccion();
    const r = await correr(p, ['produccion', 'emitir', '--boleta', 'otra.json', '--folio', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('otra.json');
  });

  it('un JSON mal escrito es error de configuración', async () => {
    const p = proyectoProduccion('{ "detalles": [ ');
    const r = await correr(p, ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('no es un JSON válido');
  });

  it.each([
    [{ detalles: [] }, 'detalles: debe tener al menos un ítem'],
    [{}, 'detalles: falta'],
    [
      { detalles: [{ nombre: 'X', cantidad: 1, precio: '1000' }] },
      'detalles[0].precio: debe ser un número',
    ],
    [
      { detalles: [{ nombre: 'X', cantidad: 0, precio: 1 }] },
      'detalles[0].cantidad: debe ser mayor que 0',
    ],
    [
      { detalles: [{ nombre: ' ', cantidad: 1, precio: 1 }] },
      'detalles[0].nombre: no puede estar vacío',
    ],
    [{ detalles: [{ nombre: 'X', cantidad: 1, precios: 1 }] }, 'campo desconocido "precios"'],
    [{ ...BOLETA, folio: 3 }, '(raíz): campo desconocido "folio"'],
    [{ ...BOLETA, tipoDte: 33 }, 'tipoDte: debe ser 39 o 41'],
    [
      { ...BOLETA, receptor: { rut: '12345678-0', razonSocial: 'X' } },
      'receptor.rut: no es un RUT válido',
    ],
    [{ ...BOLETA, receptor: { rut: '66666666-6' } }, 'receptor.razonSocial: falta'],
    [
      { ...BOLETA, descuento: { tipo: 'otro', valor: 1 } },
      'descuento.tipo: debe ser "monto" o "porcentaje"',
    ],
    [[1, 2], '(raíz): debe ser un objeto'],
  ])('JSON de boleta inválido %j', async (boleta, mensaje) => {
    const p = proyectoProduccion(boleta);
    const r = await correr(p, ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain(mensaje);
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('respeta receptor, descuento y las opciones de resolución y salida', async () => {
    const p = proyectoProduccion({
      receptor: { rut: '12.345.678-5', razonSocial: 'Juan Pérez' },
      detalles: [{ nombre: 'Producto', cantidad: 1, precio: 10000 }],
      descuento: { tipo: 'porcentaje', valor: 10 },
    });
    const r = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'boleta.json',
      '--folio',
      '9',
      '--nro-resol',
      '99',
      '--fch-resol',
      '2020-01-02',
      '--salida',
      'otra-salida',
    ]);
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('Juan Pérez (12345678-5)');
    expect(r.stdout).toContain('Descuento:   10% (sobre lo afecto)');
    expect(r.stdout).toContain('Total:       $9000');
    const xml = readFileSync(join(p.dir, 'otra-salida', 'boleta-produccion-9.xml')).toString(
      'latin1',
    );
    expect(xml).toContain('<RUTRecep>12345678-5</RUTRecep>');
    expect(xml).toContain('<RznSocRecep>Juan Pérez</RznSocRecep>');
    expect(xml).toContain('<NroResol>99</NroResol>');
    expect(xml).toContain('<FchResol>2020-01-02</FchResol>');
  });

  it('una boleta exenta (41) usa la variable del CAF 41', async () => {
    const p = proyectoProduccion({ ...BOLETA, tipoDte: 41 });
    const r = await correr(p, ['produccion', 'emitir', '--boleta', 'boleta.json', '--folio', '1']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_PRODUCCION_CAF_41');

    // Con el CAF del 39, el armador lo rechaza por tipo.
    p.escribirEnv({ SII_PRODUCCION_CAF_41: 'data/caf/caf-39.xml' });
    const otro = await correr(p, [
      'produccion',
      'emitir',
      '--boleta',
      'boleta.json',
      '--folio',
      '1',
    ]);
    expect(otro.codigo).toBe(CODIGOS.ERROR);
    expect(otro.stderr).toContain('El CAF es del tipo de documento 39, no del 41');
  });
});
