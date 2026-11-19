import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import { leerEstadoServicio } from './index';

type Llamada = [metodo: string, argumentos: unknown[]];

interface Consulta {
  tabla: string;
  llamadas: Llamada[];
}

type Responder = (consulta: Consulta) => unknown;

/**
 * Cliente falso: cada método del builder de PostgREST se registra y devuelve el mismo
 * builder; al esperar la consulta, `responder` decide el resultado (o lanza).
 */
function clienteFalso(responder: Responder): { cliente: ClienteServicio; consultas: Consulta[] } {
  const consultas: Consulta[] = [];
  const cliente = {
    from(tabla: string) {
      const consulta: Consulta = { tabla, llamadas: [] };
      consultas.push(consulta);
      const builder: object = new Proxy(
        {},
        {
          get(_objetivo, propiedad) {
            if (propiedad === 'then') {
              return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
                Promise.resolve()
                  .then(() => responder(consulta))
                  .then(ok, ko);
            }
            return (...argumentos: unknown[]) => {
              consulta.llamadas.push([String(propiedad), argumentos]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { cliente: cliente as unknown as ClienteServicio, consultas };
}

function argumentos(consulta: Consulta, metodo: string): unknown[][] {
  return consulta.llamadas.filter(([m]) => m === metodo).map(([, a]) => a);
}

function filtro(consulta: Consulta, metodo: string, columna: string): unknown {
  return argumentos(consulta, metodo).find((a) => a[0] === columna)?.[1];
}

const AHORA = new Date('2026-11-19T15:00:00Z');
const RECIENTE = '2026-11-19T14:57:00Z';

// Lo que devolvería la base con filas de una organización: el módulo no debe dejar salir
// nada de esto, ni siquiera la fecha.
const FILA_CON_DATOS = {
  terminada_en: RECIENTE,
  id: 'op-1111',
  organizacion_id: 'org-secreta',
  mensaje: 'TOKEN=abc123',
};

interface Escenario {
  respondidas?: Partial<Record<'certificacion' | 'produccion', number>>;
  fallas?: Partial<Record<'certificacion' | 'produccion', number>>;
  atrasados?: number;
  /** Última corrida del seguimiento con resultado `ok`. */
  ultimaCorridaOk?: string | null;
}

function responderCon(escenario: Escenario): Responder {
  return (consulta) => {
    if (consulta.tabla === 'planes') return { data: null, error: null, count: null };
    if (consulta.tabla === 'v_envios_por_consultar') {
      return { data: null, error: null, count: escenario.atrasados ?? 0 };
    }
    // operaciones_sii
    const ambiente = filtro(consulta, 'eq', 'ambiente') as 'certificacion' | 'produccion';
    const resultados = filtro(consulta, 'in', 'resultado') as string[] | undefined;
    const esConteo = argumentos(consulta, 'select').some(
      (a) => (a[1] as { head?: boolean } | undefined)?.head === true,
    );
    if (filtro(consulta, 'eq', 'operacion') === 'seguimiento') {
      const fin = escenario.ultimaCorridaOk === undefined ? RECIENTE : escenario.ultimaCorridaOk;
      return { data: fin ? { ...FILA_CON_DATOS, terminada_en: fin } : null, error: null };
    }
    if (esConteo) {
      const fuente = resultados?.includes('transporte') ? escenario.fallas : escenario.respondidas;
      return { data: null, error: null, count: fuente?.[ambiente] ?? 0 };
    }
    return { data: FILA_CON_DATOS, error: null };
  };
}

describe('leerEstadoServicio', () => {
  let aviso: MockInstance<typeof console.warn>;

  beforeEach(() => {
    aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    aviso.mockRestore();
  });

  it('arma las filas con los niveles y solo agregados', async () => {
    const { cliente } = clienteFalso(
      responderCon({
        respondidas: { produccion: 40, certificacion: 0 },
        fallas: { produccion: 0, certificacion: 0 },
        atrasados: 0,
      }),
    );
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });

    expect(estado.medidoEn).toBe(AHORA.toISOString());
    expect(estado.plataforma.nivel).toBe('operativo');
    expect(estado.baseDatos.nivel).toBe('operativo');
    expect(estado.sii.map((f) => [f.ambiente, f.nivel])).toEqual([
      ['certificacion', 'sin_datos'],
      ['produccion', 'operativo'],
    ]);
    expect(estado.sii[0]?.detalle).toBe('Sin mediciones recientes.');
    expect(estado.seguimiento.nivel).toBe('operativo');
    expect(estado.general).toBe('operativo');

    // Solo niveles y frases: ni conteos ni horas de actividad (la única hora es medidoEn).
    const json = JSON.stringify({ ...estado, medidoEn: null });
    expect(json).not.toContain('org-secreta');
    expect(json).not.toContain('op-1111');
    expect(json).not.toContain('TOKEN');
    expect(json).not.toContain('2026-11-19');
    expect(json).not.toMatch(/\b40\b/);
  });

  it('cuenta sin traer filas y mira la ventana de la última hora', async () => {
    const { cliente, consultas } = clienteFalso(responderCon({}));
    await leerEstadoServicio({ cliente, ahora: AHORA });

    const conteos = consultas.filter((c) =>
      argumentos(c, 'select').some((a) => (a[1] as { head?: boolean } | undefined)?.head),
    );
    // base + 2 conteos por ambiente + atrasados
    expect(conteos).toHaveLength(6);
    const siiConteos = conteos.filter((c) => c.tabla === 'operaciones_sii');
    expect(siiConteos).toHaveLength(4);
    for (const c of siiConteos) {
      expect(filtro(c, 'gte', 'terminada_en')).toBe('2026-11-19T14:00:00.000Z');
    }
    const atrasados = consultas.find((c) => c.tabla === 'v_envios_por_consultar');
    expect(atrasados && filtro(atrasados, 'lte', 'enviado_en')).toBe('2026-11-19T14:45:00.000Z');
    expect(atrasados && filtro(atrasados, 'gte', 'enviado_en')).toBe('2026-11-18T15:00:00.000Z');
    // Una sola lectura de fecha: la última corrida del seguimiento con resultado `ok`, y
    // solo `terminada_en`. Ya no se lee la última respuesta del SII.
    const fechas = consultas.filter((c) => argumentos(c, 'maybeSingle').length > 0);
    expect(fechas).toHaveLength(1);
    const [seguimiento] = fechas;
    expect(seguimiento && argumentos(seguimiento, 'select')[0]?.[0]).toBe('terminada_en');
    expect(seguimiento && filtro(seguimiento, 'eq', 'operacion')).toBe('seguimiento');
    expect(seguimiento && filtro(seguimiento, 'eq', 'resultado')).toBe('ok');
    expect(consultas).toHaveLength(7);
    // Todas con tope de tiempo.
    for (const c of consultas) expect(argumentos(c, 'abortSignal')).toHaveLength(1);
  });

  it('refleja fallas del SII y un seguimiento detenido', async () => {
    const { cliente } = clienteFalso(
      responderCon({
        respondidas: { produccion: 1 },
        fallas: { produccion: 5 },
        atrasados: 3,
        ultimaCorridaOk: '2026-11-19T12:00:00Z',
      }),
    );
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });
    expect(estado.sii[1]?.nivel).toBe('problemas');
    expect(estado.seguimiento.nivel).toBe('problemas');
    expect(estado.general).toBe('problemas');
  });

  it('nunca lanza: si todo falla, la base queda con problemas y el resto sin datos', async () => {
    const { cliente } = clienteFalso(() => {
      throw new Error('fetch failed: token=secreto');
    });
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });
    expect(estado.baseDatos.nivel).toBe('problemas');
    expect(estado.sii.every((f) => f.nivel === 'sin_datos')).toBe(true);
    expect(estado.seguimiento.nivel).toBe('sin_datos');
    expect(estado.plataforma.nivel).toBe('operativo');
    // A los logs va el código, nunca el mensaje.
    for (const [texto] of aviso.mock.calls) expect(String(texto)).not.toContain('secreto');
  });

  it('atrasados con una corrida ok reciente: el seguimiento sigue operativo', async () => {
    const { cliente } = clienteFalso(
      responderCon({ respondidas: { produccion: 10 }, atrasados: 12, ultimaCorridaOk: RECIENTE }),
    );
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });
    expect(estado.seguimiento.nivel).toBe('operativo');
    expect(estado.general).toBe('operativo');
  });

  it('atrasados sin ninguna corrida ok: con problemas', async () => {
    const { cliente } = clienteFalso(responderCon({ atrasados: 2, ultimaCorridaOk: null }));
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });
    expect(estado.seguimiento.nivel).toBe('problemas');
  });

  it('sin configuración de la base: todo «Sin datos» y el resumen también (no «Operativo»)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    try {
      const estado = await leerEstadoServicio({ ahora: AHORA });
      expect(estado.plataforma.nivel).toBe('operativo');
      expect(estado.baseDatos.nivel).toBe('sin_datos');
      expect(estado.sii.every((f) => f.nivel === 'sin_datos')).toBe(true);
      expect(estado.seguimiento.nivel).toBe('sin_datos');
      expect(estado.general).toBe('sin_datos');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('un error de PostgREST deja la fila en «Sin datos»', async () => {
    const base = responderCon({ respondidas: { produccion: 10 } });
    const { cliente } = clienteFalso((consulta) =>
      consulta.tabla === 'v_envios_por_consultar'
        ? { data: null, error: { code: '42P01', message: 'detalle interno' }, count: null }
        : base(consulta),
    );
    const estado = await leerEstadoServicio({ cliente, ahora: AHORA });
    expect(estado.seguimiento.nivel).toBe('sin_datos');
    expect(estado.sii[1]?.nivel).toBe('operativo');
    expect(aviso.mock.calls.map(([t]) => String(t))).toContain(
      'estado: lectura fallida (seguimiento atrasados, 42P01)',
    );
  });
});
