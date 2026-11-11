// Despacho, ayuda, configuración y códigos de salida comunes a todos los comandos.

import { ErrorTransporte, FoliosSinCafError, SesionCaducaError } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { COMANDOS } from '../src/comandos/index.ts';
import {
  cargarConfig,
  configEmisor,
  configResolucion,
  leerVariables,
  rut,
  rutaArchivo,
} from '../src/config.ts';
import type { Contexto } from '../src/contexto.ts';
import { CODIGOS, codigoDeError, ErrorConfig, ErrorUso } from '../src/errores.ts';
import { correr, proyecto, RUT_EMPRESA } from './soporte/cli.ts';

function ctxEn(dir: string, entorno: Record<string, string> = {}): Contexto {
  return {
    cwd: dir,
    entorno,
    reloj: { ahora: () => new Date() },
    imprimir: () => {},
    imprimirError: () => {},
    transporte: () => {
      throw new Error('sin red');
    },
  };
}

describe('despacho', () => {
  it('sin argumentos muestra la ayuda general con código de uso', async () => {
    const r = await correr(proyecto(), []);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.stdout).toContain('Uso: sii <grupo> <comando>');
  });

  it('--ayuda lista todos los comandos registrados', async () => {
    const r = await correr(proyecto(), ['--ayuda']);
    expect(r.codigo).toBe(CODIGOS.OK);
    for (const c of COMANDOS) expect(r.stdout).toContain(c.nombre);
  });

  it('grupo o comando desconocido es error de uso', async () => {
    const p = proyecto();
    expect((await correr(p, ['nada'])).codigo).toBe(CODIGOS.USO);
    const r = await correr(p, ['certificacion', 'nada']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.stderr).toContain('Comando desconocido');
  });

  it('los nombres de comando no se repiten', () => {
    const claves = COMANDOS.map((c) => `${c.grupo} ${c.nombre}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it.each(COMANDOS.map((c) => [c.grupo, c.nombre] as const))(
    '%s %s --ayuda responde sin leer la config',
    async (grupo, nombre) => {
      const p = proyecto();
      p.escribirEnv({ SII_CERT_PATH: 'no-existe.pfx' });
      const r = await correr(p, [grupo, nombre, '--ayuda']);
      expect(r.codigo).toBe(CODIGOS.OK);
      expect(r.stdout).toContain(`sii ${grupo} ${nombre}`);
      expect(r.transporte.enviadas).toHaveLength(0);
    },
  );

  it('una opción desconocida es error de uso y muestra la ayuda del comando', async () => {
    const r = await correr(proyecto(), ['util', 'verificar-ted', '--no-existe']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.stderr).toContain('sii util verificar-ted');
  });
});

describe('configuración', () => {
  it('lee el .env del cwd y el entorno gana sobre el archivo', () => {
    const p = proyecto();
    const c = cargarConfig(ctxEn(p.dir, { EMISOR_COMUNA: 'VALPARAISO' }));
    expect(c.archivoEnv).toBe(`${p.dir}${process.platform === 'win32' ? '\\' : '/'}.env`);
    expect(configEmisor(c).comuna).toBe('VALPARAISO');
    expect(configEmisor(c).rut).toBe(RUT_EMPRESA);
  });

  it('--env inexistente es error de configuración', () => {
    const p = proyecto();
    expect(() => cargarConfig(ctxEn(p.dir), 'otro.env')).toThrow(ErrorConfig);
  });

  it('nombra todas las variables con problemas y nunca sus valores', () => {
    const p = proyecto();
    p.escribirEnv({ SII_RUT_EMPRESA: '76123456-1', EMISOR_GIRO: '' });
    const c = cargarConfig(ctxEn(p.dir));
    let mensaje = '';
    try {
      configEmisor(c);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain('SII_RUT_EMPRESA: no es un RUT válido');
    expect(mensaje).toContain('EMISOR_GIRO: falta');
    expect(mensaje).not.toContain('76123456-1');
  });

  it('una opción de la línea de comandos reemplaza a la variable', () => {
    const p = proyecto();
    const c = cargarConfig(ctxEn(p.dir));
    expect(configResolucion(c, 'certificacion')).toEqual({
      nroResol: '0',
      fchResol: '2026-09-05',
    });
    expect(configResolucion(c, 'certificacion', { fchResol: '2026-10-01' }).fchResol).toBe(
      '2026-10-01',
    );
    expect(() => configResolucion(c, 'certificacion', { fchResol: '2026-02-30' })).toThrow(
      /--fch-resol: debe ser una fecha/,
    );
  });

  it('producción exige su propia resolución, sin valores por defecto', () => {
    const p = proyecto();
    const c = cargarConfig(ctxEn(p.dir));
    expect(() => configResolucion(c, 'produccion')).toThrow(
      /SII_PRODUCCION_NRO_RESOL \(o --nro-resol\): falta[\s\S]*SII_PRODUCCION_FCH_RESOL/,
    );
  });

  it('las rutas del .env son relativas al .env y deben existir', () => {
    const p = proyecto();
    const c = cargarConfig(ctxEn(p.dir));
    expect(rutaArchivo(c, 'SII_CAF_39')).toMatch(/caf-39\.xml$/);
    p.escribirEnv({ SII_CAF_39: 'data/caf/otro.xml' });
    expect(() => rutaArchivo(cargarConfig(ctxEn(p.dir)), 'SII_CAF_39')).toThrow(
      /No existe el archivo indicado en SII_CAF_39/,
    );
  });

  it('normaliza el RUT', () => {
    const c = cargarConfig(ctxEn(proyecto().dir, { X: ' 76.123.456-0 ' }));
    expect(leerVariables(c, { X: rut }).X).toBe('76123456-0');
  });
});

describe('códigos de salida', () => {
  it('clasifica los errores de la librería', () => {
    expect(codigoDeError(new ErrorUso('x'))).toBe(CODIGOS.USO);
    expect(codigoDeError(new ErrorConfig('x'))).toBe(CODIGOS.CONFIG);
    expect(codigoDeError(new ErrorTransporte('x', 'https://x'))).toBe(CODIGOS.TRANSPORTE);
    expect(codigoDeError(new SesionCaducaError('x'))).toBe(CODIGOS.SII);
    expect(codigoDeError(new FoliosSinCafError(1, 5, 'certificacion', 'maullin.sii.cl'))).toBe(
      CODIGOS.INCIERTO,
    );
    expect(codigoDeError(new Error('x'))).toBe(CODIGOS.ERROR);
  });
});
