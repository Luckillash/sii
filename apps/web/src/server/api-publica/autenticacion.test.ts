import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { autenticar, exigirAlcance, hashClave } from './autenticacion';
import {
  CLAVE_LIVE,
  CLAVE_TEST,
  claveCompleta,
  HEX,
  repositorioMemoria,
} from './repositorio-memoria.test-util';
import { ErrorApi } from './respuestas';

function cabeceras(autorizacion?: string): Headers {
  return new Headers(autorizacion ? { authorization: autorizacion } : {});
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'ok';
  } catch (error) {
    if (error instanceof ErrorApi) return error.codigo;
    throw error;
  }
}

describe('hashClave', () => {
  it('es el sha256 hex de la clave en UTF-8, como crear_api_key (0001)', () => {
    expect(hashClave(CLAVE_TEST)).toBe(createHash('sha256').update(CLAVE_TEST).digest('hex'));
    expect(hashClave(CLAVE_TEST)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('autenticar', () => {
  it('acepta Bearer con una clave válida y devuelve su organización, alcances y ambiente', async () => {
    const m = repositorioMemoria();
    const clave = await autenticar(cabeceras(`Bearer ${CLAVE_TEST}`), m.repo);
    expect(clave).toEqual(claveCompleta());
    // El esquema no distingue mayúsculas (RFC 6750).
    await expect(autenticar(cabeceras(`bearer ${CLAVE_TEST}`), m.repo)).resolves.toBeTruthy();
  });

  it('401 no_autenticado sin cabecera, con otro esquema o sin clave', async () => {
    const m = repositorioMemoria();
    const autenticarRepo = vi.spyOn(m.repo, 'autenticar');
    for (const valor of [undefined, `Basic ${CLAVE_TEST}`, 'Bearer', 'Bearer   ']) {
      expect(await codigoDe(autenticar(cabeceras(valor), m.repo))).toBe('no_autenticado');
    }
    expect(autenticarRepo).not.toHaveBeenCalled();
  });

  it('401 clave_invalida si no tiene la forma de una clave (sin consultar la base)', async () => {
    const m = repositorioMemoria();
    const autenticarRepo = vi.spyOn(m.repo, 'autenticar');
    for (const valor of [
      'sk_test_123',
      `sk_prod_${HEX}`,
      `sk_test_${HEX.toUpperCase()}`,
      'eyJhbGciOi',
    ]) {
      expect(await codigoDe(autenticar(cabeceras(`Bearer ${valor}`), m.repo))).toBe(
        'clave_invalida',
      );
    }
    expect(autenticarRepo).not.toHaveBeenCalled();
  });

  it('traduce los motivos de autenticar_api_key', async () => {
    const m = repositorioMemoria({
      claves: {
        [`sk_test_${'1'.repeat(64)}`]: 'revocada',
        [`sk_test_${'2'.repeat(64)}`]: 'vencida',
        [`sk_test_${'3'.repeat(64)}`]: 'plan_sin_api',
      },
    });
    const probar = (c: string) => codigoDe(autenticar(cabeceras(`Bearer ${c}`), m.repo));
    expect(await probar(`sk_test_${'1'.repeat(64)}`)).toBe('clave_revocada');
    expect(await probar(`sk_test_${'2'.repeat(64)}`)).toBe('clave_vencida');
    expect(await probar(`sk_test_${'3'.repeat(64)}`)).toBe('plan_sin_api');
    expect(await probar(`sk_test_${'4'.repeat(64)}`)).toBe('clave_invalida');
  });

  it('rechaza una clave cuyo prefijo no calza con el ambiente de la fila', async () => {
    const m = repositorioMemoria({ claves: { [CLAVE_LIVE]: { ambiente: 'certificacion' } } });
    expect(await codigoDe(autenticar(cabeceras(`Bearer ${CLAVE_LIVE}`), m.repo))).toBe(
      'clave_invalida',
    );
  });

  it('el mensaje de error nunca lleva la clave', async () => {
    const m = repositorioMemoria({ claves: {} });
    try {
      await autenticar(cabeceras(`Bearer ${CLAVE_TEST}`), m.repo);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(HEX);
    }
  });
});

describe('exigirAlcance', () => {
  it('403 alcance_insuficiente si la clave no tiene el alcance, nombrándolo', () => {
    const clave = claveCompleta({ alcances: ['documentos:leer'] });
    expect(() => exigirAlcance(clave, 'documentos:leer')).not.toThrow();
    try {
      exigirAlcance(clave, 'documentos:emitir');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).codigo).toBe('alcance_insuficiente');
      expect((error as ErrorApi).message).toContain('documentos:emitir');
    }
  });
});
