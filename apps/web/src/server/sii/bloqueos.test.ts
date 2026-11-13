import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import {
  BLOQUEO_OCUPADO,
  BloqueoOcupadoError,
  conBloqueoCertificado,
  ErrorBloqueo,
  SEGUNDOS_ARRIENDO,
} from './bloqueos';

const CLAVE = {
  certificadoId: '11111111-1111-4111-8111-111111111111',
  ambiente: 'certificacion' as const,
};

type Argumentos = Record<string, unknown>;

/**
 * Imita las dos RPC de la migración 0007 sobre un Map, con la misma regla: se toma si
 * no hay fila, si es del mismo titular o (aquí) si alguien la marcó como vencida.
 */
function clienteFalso() {
  const filas = new Map<string, { titular: string; vencido: boolean }>();
  const llamadas: { funcion: string; argumentos: Argumentos }[] = [];
  const id = (a: Argumentos) => [a.p_certificado, a.p_ambiente].join();
  const fallar = new Map<string, 'error' | 'excepcion'>();
  const falso = {
    async rpc(funcion: string, argumentos: Argumentos) {
      llamadas.push({ funcion, argumentos });
      const modo = fallar.get(funcion);
      if (modo === 'excepcion') throw new TypeError('fetch failed: detalle de red');
      if (modo === 'error') {
        return { data: null, error: { code: '42501', message: 'detalle con datos de la fila' } };
      }
      const fila = filas.get(id(argumentos));
      const titular = String(argumentos.p_titular);
      if (funcion === 'tomar_bloqueo_certificado') {
        if (!fila || fila.vencido || fila.titular === titular) {
          filas.set(id(argumentos), { titular, vencido: false });
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (fila?.titular === titular) {
        filas.delete(id(argumentos));
        return { data: true, error: null };
      }
      return { data: false, error: null };
    },
  };
  return {
    // Solo implementa rpc(): bloqueos.ts no usa nada más del cliente.
    cliente: falso as unknown as ClienteServicio,
    filas,
    llamadas,
    fallarEn: (funcion: string, modo: 'error' | 'excepcion' = 'error') => fallar.set(funcion, modo),
    ocupar: (titular = 'otra-operacion') =>
      filas.set(id({ p_certificado: CLAVE.certificadoId, p_ambiente: CLAVE.ambiente }), {
        titular,
        vencido: false,
      }),
  };
}

const sinPausa = () => Promise.resolve();

describe('conBloqueoCertificado', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toma el bloqueo, ejecuta y lo suelta', async () => {
    const falso = clienteFalso();
    let tomadoDurante = false;

    const resultado = await conBloqueoCertificado(falso.cliente, CLAVE, async () => {
      tomadoDurante = falso.filas.size === 1;
      return 'listo';
    });

    expect(resultado).toBe('listo');
    expect(tomadoDurante).toBe(true);
    expect(falso.filas.size).toBe(0);
    const [tomar, liberar] = falso.llamadas;
    expect(tomar?.funcion).toBe('tomar_bloqueo_certificado');
    expect(tomar?.argumentos).toMatchObject({
      p_certificado: CLAVE.certificadoId,
      p_ambiente: 'certificacion',
      p_segundos: SEGUNDOS_ARRIENDO,
    });
    expect(String(tomar?.argumentos.p_titular)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(liberar?.funcion).toBe('liberar_bloqueo_certificado');
    expect(liberar?.argumentos).toEqual({
      p_certificado: CLAVE.certificadoId,
      p_ambiente: 'certificacion',
      p_titular: tomar?.argumentos.p_titular,
    });
  });

  it('cada llamada usa un titular distinto', async () => {
    const falso = clienteFalso();
    await conBloqueoCertificado(falso.cliente, CLAVE, async () => 1);
    await conBloqueoCertificado(falso.cliente, CLAVE, async () => 2);
    const titulares = falso.llamadas
      .filter((l) => l.funcion === 'tomar_bloqueo_certificado')
      .map((l) => l.argumentos.p_titular);
    expect(new Set(titulares).size).toBe(2);
  });

  it('respeta el titular y los segundos que se le pasan', async () => {
    const falso = clienteFalso();
    await conBloqueoCertificado(falso.cliente, CLAVE, async () => null, {
      titular: 'titular-fijo',
      segundos: 60,
    });
    expect(falso.llamadas[0]?.argumentos).toMatchObject({
      p_titular: 'titular-fijo',
      p_segundos: 60,
    });
  });

  it('reintenta mientras otro lo tiene y entra cuando lo sueltan', async () => {
    const falso = clienteFalso();
    falso.ocupar();
    const pausas: number[] = [];
    const dormir = async (ms: number) => {
      pausas.push(ms);
      if (pausas.length === 3) falso.filas.clear(); // la otra operación terminó
    };

    const resultado = await conBloqueoCertificado(falso.cliente, CLAVE, async () => 'ok', {
      esperaMs: 10_000,
      intervaloMs: 500,
      dormir,
    });

    expect(resultado).toBe('ok');
    expect(pausas).toEqual([500, 500, 500]);
    expect(falso.llamadas.filter((l) => l.funcion === 'tomar_bloqueo_certificado')).toHaveLength(4);
  });

  it('si no lo obtiene dentro de la espera, lanza BloqueoOcupadoError sin ejecutar ni liberar', async () => {
    const falso = clienteFalso();
    falso.ocupar();
    const fn = vi.fn(async () => 'no debería correr');
    const pausas: number[] = [];

    const error = await conBloqueoCertificado(falso.cliente, CLAVE, fn, {
      esperaMs: 3_000,
      intervaloMs: 1_000,
      dormir: async (ms) => {
        pausas.push(ms);
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BloqueoOcupadoError);
    expect((error as BloqueoOcupadoError).mensajeUsuario).toEqual(BLOQUEO_OCUPADO);
    expect((error as Error).message).not.toMatch(/!|¡/);
    expect(fn).not.toHaveBeenCalled();
    // Un intento ahora y uno por segundo durante 3 s: 4 intentos, 3 pausas.
    expect(falso.llamadas.map((l) => l.funcion)).toEqual(
      Array(4).fill('tomar_bloqueo_certificado'),
    );
    expect(pausas).toEqual([1_000, 1_000, 1_000]);
    expect(falso.filas.get([CLAVE.certificadoId, CLAVE.ambiente].join())?.titular).toBe(
      'otra-operacion',
    );
  });

  it('con esperaMs 0 hace un solo intento', async () => {
    const falso = clienteFalso();
    falso.ocupar();
    const dormir = vi.fn(sinPausa);
    await expect(
      conBloqueoCertificado(falso.cliente, CLAVE, async () => 1, { esperaMs: 0, dormir }),
    ).rejects.toBeInstanceOf(BloqueoOcupadoError);
    expect(falso.llamadas).toHaveLength(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('suelta el bloqueo aunque la operación falle, y relanza su error', async () => {
    const falso = clienteFalso();
    const original = new Error('el SII rechazó el envío');

    const error = await conBloqueoCertificado(falso.cliente, CLAVE, async () => {
      throw original;
    }).catch((e: unknown) => e);

    expect(error).toBe(original);
    expect(falso.filas.size).toBe(0);
    expect(falso.llamadas.at(-1)?.funcion).toBe('liberar_bloqueo_certificado');
  });

  it('si soltar falla (error de PostgREST o excepción), no tapa el error ni el resultado', async () => {
    for (const modo of ['error', 'excepcion'] as const) {
      const falso = clienteFalso();
      falso.fallarEn('liberar_bloqueo_certificado', modo);
      const original = new Error('falla de la operación');

      const error = await conBloqueoCertificado(falso.cliente, CLAVE, async () => {
        throw original;
      }).catch((e: unknown) => e);
      expect(error).toBe(original);

      falso.filas.clear(); // el arriendo que no se soltó vence solo
      const resultado = await conBloqueoCertificado(falso.cliente, CLAVE, async () => 'ok', {
        esperaMs: 0,
      }).catch((e: unknown) => e);
      expect(resultado).toBe('ok');
    }
    const avisos = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(avisos).toContain('42501');
    expect(avisos).not.toContain('detalle con datos');
    expect(avisos).not.toContain('detalle de red');
  });

  it('avisa si al soltar el arriendo ya había vencido y era de otro', async () => {
    const falso = clienteFalso();
    await conBloqueoCertificado(falso.cliente, CLAVE, async () => {
      falso.ocupar('otra-operacion'); // venció y otra operación lo tomó
    });
    expect(falso.filas.get([CLAVE.certificadoId, CLAVE.ambiente].join())?.titular).toBe(
      'otra-operacion',
    );
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('venció');
  });

  it('un error al tomar el bloqueo lanza ErrorBloqueo sin el detalle de PostgREST ni ejecutar', async () => {
    const falso = clienteFalso();
    falso.fallarEn('tomar_bloqueo_certificado');
    const fn = vi.fn(async () => 1);

    const error = await conBloqueoCertificado(falso.cliente, CLAVE, fn).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorBloqueo);
    expect((error as Error).message).toContain('42501');
    expect((error as Error).message).not.toContain('detalle con datos');
    expect(fn).not.toHaveBeenCalled();
    expect(falso.llamadas).toHaveLength(1);
  });

  it('rechaza una duración fuera de 1..900 s sin llamar a Supabase', async () => {
    const falso = clienteFalso();
    for (const segundos of [0, 901, 1.5]) {
      await expect(
        conBloqueoCertificado(falso.cliente, CLAVE, async () => 1, { segundos }),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(falso.llamadas).toHaveLength(0);
  });

  it('el mismo certificado en otro ambiente es otro bloqueo', async () => {
    const falso = clienteFalso();
    falso.ocupar();
    const resultado = await conBloqueoCertificado(
      falso.cliente,
      { ...CLAVE, ambiente: 'produccion' },
      async () => 'producción',
      { esperaMs: 0 },
    );
    expect(resultado).toBe('producción');
  });
});
