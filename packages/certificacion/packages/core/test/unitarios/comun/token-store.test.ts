// Tests del caché de tokens (pend. 1.4): reemplaza el archivo global
// data/output/token_cache_boleta_produccion.txt del PHP.

import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCertificado, SiiError } from '../../../src/comun/errores.ts';
import {
  type ClaveToken,
  huellaCertificado,
  type TokenStore,
  TokenStoreArchivo,
  TokenStoreMemoria,
} from '../../../src/comun/token-store.ts';
import { material } from '../../soporte/paridad.ts';

const CLAVE: ClaveToken = {
  canal: 'rest',
  ambiente: 'certificacion',
  rutEmpresa: '76543210-3',
  huellaCertificado: 'a'.repeat(64),
};
const VENCE = new Date('2026-11-06T12:50:00.000Z');

/** Variantes que difieren de CLAVE en un solo campo. */
const OTRAS: ClaveToken[] = [
  { ...CLAVE, canal: 'soap' },
  { ...CLAVE, ambiente: 'produccion' },
  { ...CLAVE, rutEmpresa: '76000006-K' },
  { ...CLAVE, huellaCertificado: 'b'.repeat(64) },
];

/** Pruebas comunes a las dos implementaciones. */
function contrato(nombre: string, crear: () => TokenStore): void {
  describe(`${nombre}: contrato de TokenStore`, () => {
    it('obtener de una clave sin token → undefined', async () => {
      expect(await crear().obtener(CLAVE)).toBeUndefined();
    });

    it('guardar y obtener devuelven el mismo token y vencimiento', async () => {
      const store = crear();
      await store.guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
      const guardado = await store.obtener(CLAVE);
      expect(guardado?.token).toBe('TOK1');
      expect(guardado?.venceEn.getTime()).toBe(VENCE.getTime());
    });

    it('no valida la vigencia: un token vencido se devuelve igual', async () => {
      const store = crear();
      await store.guardar(CLAVE, { token: 'VIEJO', venceEn: new Date(0) });
      expect((await store.obtener(CLAVE))?.token).toBe('VIEJO');
    });

    it('guardar de nuevo reemplaza', async () => {
      const store = crear();
      await store.guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
      await store.guardar(CLAVE, { token: 'TOK2', venceEn: VENCE });
      expect((await store.obtener(CLAVE))?.token).toBe('TOK2');
    });

    it('aísla por cada campo de la clave', async () => {
      const store = crear();
      await store.guardar(CLAVE, { token: 'BASE', venceEn: VENCE });
      for (const [i, otra] of OTRAS.entries()) {
        expect(await store.obtener(otra)).toBeUndefined();
        await store.guardar(otra, { token: `OTRO${i}`, venceEn: VENCE });
      }
      expect((await store.obtener(CLAVE))?.token).toBe('BASE');
      for (const [i, otra] of OTRAS.entries()) {
        expect((await store.obtener(otra))?.token).toBe(`OTRO${i}`);
      }
    });

    it('borrar olvida solo esa clave (y no falla si no había nada)', async () => {
      const store = crear();
      await store.borrar(CLAVE);
      await store.guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
      await store.guardar(OTRAS[0] as ClaveToken, { token: 'TOK2', venceEn: VENCE });
      await store.borrar(CLAVE);
      expect(await store.obtener(CLAVE)).toBeUndefined();
      expect((await store.obtener(OTRAS[0] as ClaveToken))?.token).toBe('TOK2');
    });

    it('la fecha devuelta es una copia: modificarla no cambia lo guardado', async () => {
      const store = crear();
      const vence = new Date(VENCE);
      await store.guardar(CLAVE, { token: 'TOK1', venceEn: vence });
      vence.setTime(0);
      const primero = await store.obtener(CLAVE);
      primero?.venceEn.setTime(0);
      expect((await store.obtener(CLAVE))?.venceEn.getTime()).toBe(VENCE.getTime());
    });

    it('rechaza guardar un token vacío o una fecha inválida', async () => {
      const store = crear();
      await expect(store.guardar(CLAVE, { token: '', venceEn: VENCE })).rejects.toThrow(TypeError);
      await expect(
        store.guardar(CLAVE, { token: 'X', venceEn: new Date(Number.NaN) }),
      ).rejects.toThrow(TypeError);
      expect(await store.obtener(CLAVE)).toBeUndefined();
    });
  });
}

contrato('TokenStoreMemoria', () => new TokenStoreMemoria());

describe('TokenStoreMemoria', () => {
  it('cuenta los tokens guardados', async () => {
    const store = new TokenStoreMemoria();
    expect(store.tamano).toBe(0);
    await store.guardar(CLAVE, { token: 'A', venceEn: VENCE });
    await store.guardar(OTRAS[0] as ClaveToken, { token: 'B', venceEn: VENCE });
    expect(store.tamano).toBe(2);
  });

  it('las claves no chocan aunque un campo tenga separadores', async () => {
    const store = new TokenStoreMemoria();
    const a: ClaveToken = { ...CLAVE, rutEmpresa: '1|2', huellaCertificado: '3' };
    const b: ClaveToken = { ...CLAVE, rutEmpresa: '1', huellaCertificado: '2|3' };
    await store.guardar(a, { token: 'A', venceEn: VENCE });
    expect(await store.obtener(b)).toBeUndefined();
  });
});

describe('TokenStoreArchivo', () => {
  let carpeta: string;
  let ruta: string;

  beforeEach(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'token-store-'));
    ruta = join(carpeta, 'tokens.json');
  });

  afterEach(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  contrato('TokenStoreArchivo', () => new TokenStoreArchivo(join(carpeta, 'contrato.json')));

  it('no crea el archivo hasta guardar; obtener sin archivo → undefined', async () => {
    const store = new TokenStoreArchivo(ruta);
    expect(await store.obtener(CLAVE)).toBeUndefined();
    await store.borrar(CLAVE);
    expect(await readdir(carpeta)).toEqual([]);
  });

  it('escribe un JSON versionado con la clave completa', async () => {
    await new TokenStoreArchivo(ruta).guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
    expect(JSON.parse(await readFile(ruta, 'utf8'))).toEqual({
      version: 1,
      tokens: [
        {
          canal: 'rest',
          ambiente: 'certificacion',
          rutEmpresa: '76543210-3',
          huellaCertificado: 'a'.repeat(64),
          token: 'TOK1',
          venceEn: '2026-11-06T12:50:00.000Z',
        },
      ],
    });
  });

  it('persiste entre instancias (como el caché de la CLI)', async () => {
    await new TokenStoreArchivo(ruta).guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
    expect((await new TokenStoreArchivo(ruta).obtener(CLAVE))?.token).toBe('TOK1');
  });

  it('no deja temporales después de escribir', async () => {
    const store = new TokenStoreArchivo(ruta);
    await store.guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
    await store.guardar(CLAVE, { token: 'TOK2', venceEn: VENCE });
    await store.borrar(CLAVE);
    expect(await readdir(carpeta)).toEqual(['tokens.json']);
  });

  it.skipIf(process.platform === 'win32')('el archivo queda con permisos 0600', async () => {
    const store = new TokenStoreArchivo(ruta);
    await store.guardar(CLAVE, { token: 'TOK1', venceEn: VENCE });
    expect((await stat(ruta)).mode & 0o777).toBe(0o600);
    // También al reemplazar un archivo previo con permisos abiertos.
    await writeFile(ruta, '{}', { mode: 0o644 });
    await store.guardar(CLAVE, { token: 'TOK2', venceEn: VENCE });
    expect((await stat(ruta)).mode & 0o777).toBe(0o600);
  });

  it('operaciones concurrentes de una instancia no pierden escrituras', async () => {
    const store = new TokenStoreArchivo(ruta);
    await Promise.all(
      [CLAVE, ...OTRAS].map((clave, i) => store.guardar(clave, { token: `T${i}`, venceEn: VENCE })),
    );
    const contenido = JSON.parse(await readFile(ruta, 'utf8')) as { tokens: unknown[] };
    expect(contenido.tokens).toHaveLength(5);
  });

  it('un archivo corrupto o con otra forma se trata como vacío y se reescribe', async () => {
    for (const corrupto of [
      'no es json',
      '',
      'null',
      '[]',
      '{"version":2,"tokens":[]}',
      '{"version":1,"tokens":"x"}',
    ]) {
      await writeFile(ruta, corrupto);
      const store = new TokenStoreArchivo(ruta);
      expect(await store.obtener(CLAVE)).toBeUndefined();
      await store.guardar(CLAVE, { token: 'NUEVO', venceEn: VENCE });
      expect((await store.obtener(CLAVE))?.token).toBe('NUEVO');
    }
  });

  it('descarta entradas mal formadas y conserva las buenas', async () => {
    const buena = { ...CLAVE, token: 'BUENO', venceEn: VENCE.toISOString() };
    await writeFile(
      ruta,
      JSON.stringify({
        version: 1,
        tokens: [
          null,
          { ...buena, canal: 'otro' },
          { ...buena, ambiente: 'prod' },
          { ...buena, token: '' },
          { ...buena, venceEn: 'mañana' },
          { ...buena, rutEmpresa: 7 },
          buena,
        ],
      }),
    );
    const store = new TokenStoreArchivo(ruta);
    expect((await store.obtener(CLAVE))?.token).toBe('BUENO');
    await store.guardar(OTRAS[0] as ClaveToken, { token: 'OTRO', venceEn: VENCE });
    const contenido = JSON.parse(await readFile(ruta, 'utf8')) as { tokens: unknown[] };
    expect(contenido.tokens).toHaveLength(2);
  });

  it('error de lectura distinto de "no existe" → SiiError sin la ruta en el mensaje', async () => {
    // Una carpeta en lugar del archivo: EISDIR al leer.
    const store = new TokenStoreArchivo(carpeta);
    const error = await store.obtener(CLAVE).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(SiiError);
    expect((error as Error).message).toBe('No se pudo leer el archivo de tokens.');
    expect((error as Error).message).not.toContain(carpeta);
    expect((error as Error).cause).toBeDefined();
  });

  it('error de escritura (carpeta inexistente) → SiiError sin el token ni la ruta', async () => {
    const store = new TokenStoreArchivo(join(carpeta, 'no-existe', 'tokens.json'));
    const error = await store
      .guardar(CLAVE, { token: 'SECRETO123', venceEn: VENCE })
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(SiiError);
    expect((error as Error).message).toBe('No se pudo escribir el archivo de tokens.');
    expect((error as Error).message).not.toContain('SECRETO123');
    // Una falla no bloquea las operaciones siguientes de la misma instancia.
    expect(await store.obtener(CLAVE)).toBeUndefined();
  });

  it('rechaza una ruta vacía', () => {
    expect(() => new TokenStoreArchivo('')).toThrow(TypeError);
    expect(() => new TokenStoreArchivo('  ')).toThrow(TypeError);
  });
});

describe('huellaCertificado', () => {
  const { certificado } = material('base');

  it('sha256 en hex del DER del certificado', () => {
    const der = new X509Certificate(certificado).raw;
    expect(huellaCertificado(certificado)).toBe(createHash('sha256').update(der).digest('hex'));
  });

  it('con una cadena, usa el primer certificado (la hoja)', () => {
    expect(huellaCertificado(`${certificado}\n${certificado}`)).toBe(
      huellaCertificado(certificado),
    );
  });

  it('PEM ilegible → ErrorCertificado sin el contenido en el mensaje', () => {
    expect(() => huellaCertificado('basura')).toThrow(ErrorCertificado);
    expect(() => huellaCertificado('basura')).toThrow(
      'No se pudo leer el certificado para calcular su huella.',
    );
  });
});
