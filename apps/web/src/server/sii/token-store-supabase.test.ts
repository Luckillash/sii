import { randomBytes } from 'node:crypto';
import type { ClaveToken } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import { ErrorTokenStore, TokenStoreSupabase } from './token-store-supabase';

const CLAVE: ClaveToken = {
  canal: 'rest',
  ambiente: 'certificacion',
  rutEmpresa: '76543210-3',
  huellaCertificado: 'a'.repeat(64),
};

/** Imita las tres RPC del esquema sobre un Map, guardando lo que llega tal cual. */
function clienteFalso() {
  const filas = new Map<string, { token_cifrado: string; vence_en: string }>();
  const llamadas: { funcion: string; argumentos: Record<string, unknown> }[] = [];
  const id = (a: Record<string, unknown>) => [a.p_canal, a.p_ambiente, a.p_rut, a.p_huella].join();
  let fallar: string | null = null;
  const falso = {
    async rpc(funcion: string, argumentos: Record<string, unknown>) {
      llamadas.push({ funcion, argumentos });
      if (fallar === funcion) {
        return { data: null, error: { code: '42501', message: 'detalle con datos de la fila' } };
      }
      if (funcion === 'token_obtener') {
        const fila = filas.get(id(argumentos));
        return { data: fila ? [fila] : [], error: null };
      }
      if (funcion === 'token_guardar') {
        filas.set(id(argumentos), {
          token_cifrado: String(argumentos.p_token_cifrado),
          vence_en: String(argumentos.p_vence_en),
        });
        return { data: null, error: null };
      }
      filas.delete(id(argumentos));
      return { data: null, error: null };
    },
  };
  return {
    // Solo implementa rpc(): el store no usa nada más del cliente.
    cliente: falso as unknown as ClienteServicio,
    filas,
    llamadas,
    fallarEn: (f: string) => {
      fallar = f;
    },
  };
}

describe('TokenStoreSupabase', () => {
  const llave = randomBytes(32);

  it('guarda cifrado y lo recupera', async () => {
    const { cliente, filas, llamadas } = clienteFalso();
    const store = new TokenStoreSupabase(cliente, llave);
    const venceEn = new Date('2026-11-10T20:00:00Z');

    await store.guardar(CLAVE, { token: 'TOKENSII123456', venceEn });

    const guardar = llamadas.find((l) => l.funcion === 'token_guardar');
    expect(guardar?.argumentos).toMatchObject({
      p_canal: 'rest',
      p_ambiente: 'certificacion',
      p_rut: '76543210-3',
      p_huella: 'a'.repeat(64),
      p_vence_en: '2026-11-10T20:00:00.000Z',
    });
    const fila = [...filas.values()][0];
    expect(fila?.token_cifrado).toMatch(/^\\x[0-9a-f]+$/);
    expect(Buffer.from(fila?.token_cifrado.slice(2) ?? '', 'hex').toString('latin1')).not.toContain(
      'TOKENSII123456',
    );

    expect(await store.obtener(CLAVE)).toEqual({ token: 'TOKENSII123456', venceEn });
  });

  it('devuelve undefined si no hay token o si la fila es de otra clave', async () => {
    const falso = clienteFalso();
    const store = new TokenStoreSupabase(falso.cliente, llave);
    expect(await store.obtener(CLAVE)).toBeUndefined();

    // Un token copiado a otra empresa no descifra (AAD) y se trata como ausente.
    await store.guardar(CLAVE, { token: 'TOKENSII123456', venceEn: new Date() });
    const otra = { ...CLAVE, rutEmpresa: '11111111-1' };
    const [fila] = [...falso.filas.values()];
    if (fila) falso.filas.set(['rest', 'certificacion', '11111111-1', 'a'.repeat(64)].join(), fila);
    expect(await store.obtener(otra)).toBeUndefined();
  });

  it('con otra llave el token se ignora (llave rotada)', async () => {
    const falso = clienteFalso();
    await new TokenStoreSupabase(falso.cliente, llave).guardar(CLAVE, {
      token: 'TOKENSII123456',
      venceEn: new Date(),
    });
    expect(await new TokenStoreSupabase(falso.cliente, randomBytes(32)).obtener(CLAVE)).toBe(
      undefined,
    );
  });

  it('borra', async () => {
    const falso = clienteFalso();
    const store = new TokenStoreSupabase(falso.cliente, llave);
    await store.guardar(CLAVE, { token: 'TOKENSII123456', venceEn: new Date() });
    await store.borrar(CLAVE);
    expect(falso.filas.size).toBe(0);
  });

  it('los errores no incluyen el token ni el detalle de PostgREST', async () => {
    const falso = clienteFalso();
    falso.fallarEn('token_guardar');
    const store = new TokenStoreSupabase(falso.cliente, llave);
    const error = await store
      .guardar(CLAVE, { token: 'TOKENSII123456', venceEn: new Date() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorTokenStore);
    expect((error as Error).message).not.toContain('TOKENSII123456');
    expect((error as Error).message).not.toContain('detalle con datos');
    expect((error as Error).message).toContain('42501');
  });
});
