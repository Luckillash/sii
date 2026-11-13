import { randomUUID } from 'node:crypto';
import {
  ErrorCertificado,
  ErrorRespuestaSii,
  ErrorTransporte,
  exigirStatus,
  FoliosSinCafError,
  TransporteFalso,
} from '@winex/certificacion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import { ErrorIncierto, ErrorUso, ErrorVerificacion, type ResultadoFinal } from './errores';
import {
  type ContextoOperacion,
  ejecutarOperacion,
  marcarInciertaRevisada,
  OPERACIONES_EFECTO_GLOBAL,
  OPERACIONES_QUE_GRABAN,
  type RegistroOperacion,
} from './operacion';

// --- Cliente falso de Supabase ------------------------------------------------------

type Fila = Record<string, unknown>;
type Filtro = (fila: Fila) => boolean;

/** Predicado del índice único parcial de la migración 0007 (efecto global en curso). */
const EFECTO_GLOBAL = ['solicitar_folios', 'postular', 'declarar'];
function enIndice(f: Fila) {
  return (
    f.resultado === 'en_curso' &&
    f.confirmada === true &&
    f.empresa_id != null &&
    EFECTO_GLOBAL.includes(String(f.operacion))
  );
}

/**
 * Imita lo que usa operacion.ts del query builder (select / insert / update, eq, neq,
 * is, not in, order, limit, single, maybeSingle) sobre un arreglo en memoria, guarda
 * lo que llega en insert y update tal cual, y aplica como la base: `iniciada_en`
 * por defecto (un reloj de base que avanza 1 s por insert) y el índice único parcial
 * `operaciones_sii_efecto_global_en_curso` (23505).
 */
function clienteFalso() {
  const filas: Fila[] = [];
  const insertados: unknown[] = [];
  const actualizados: unknown[] = [];
  const fallas = { insert: null as unknown, update: null as unknown, select: null as unknown };
  /** Se llama justo antes de cada insert: simula lo que otra petición hizo entremedio. */
  const ganchos: { antesDeInsertar?: () => void } = {};
  let relojBase = AHORA.getTime();

  function from(tabla: string) {
    expect(tabla).toBe('operaciones_sii');
    let accion: 'select' | 'insert' | 'update' = 'select';
    let datos: Fila = {};
    const filtros: Filtro[] = [];
    let orden: { columna: string; asc: boolean } | undefined;
    let limite: number | undefined;
    const cumple = (f: Fila) => filtros.every((filtro) => filtro(f));

    async function ejecutar(): Promise<{ data: Fila[] | null; error: unknown }> {
      if (accion === 'insert') {
        ganchos.antesDeInsertar?.();
        ganchos.antesDeInsertar = undefined;
        insertados.push(structuredClone(datos));
        if (fallas.insert) return { data: null, error: fallas.insert };
        const fila: Fila = {
          id: randomUUID(),
          detalle: {},
          terminada_en: null,
          mensaje: null,
          iniciada_en: new Date(relojBase).toISOString(),
          ...datos,
        };
        relojBase += 1000;
        const choca = (o: Fila) =>
          enIndice(o) &&
          o.empresa_id === fila.empresa_id &&
          o.operacion === fila.operacion &&
          o.ambiente === fila.ambiente;
        if (enIndice(fila) && filas.some(choca)) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "operaciones_sii_efecto_global_en_curso"',
            },
          };
        }
        filas.push(fila);
        return { data: [{ id: fila.id }], error: null };
      }
      if (accion === 'update') {
        actualizados.push(structuredClone(datos));
        if (fallas.update) return { data: null, error: fallas.update };
        for (const fila of filas.filter(cumple)) Object.assign(fila, datos);
        return { data: null, error: null };
      }
      if (fallas.select) return { data: null, error: fallas.select };
      let resultado = filas.filter(cumple);
      if (orden) {
        const { columna, asc } = orden;
        resultado = [...resultado].sort(
          (a, b) => String(a[columna]).localeCompare(String(b[columna])) * (asc ? 1 : -1),
        );
      }
      if (limite !== undefined) resultado = resultado.slice(0, limite);
      return { data: resultado.map((f) => structuredClone(f)), error: null };
    }

    const builder = {
      select: () => builder,
      insert(d: Fila) {
        accion = 'insert';
        datos = d;
        return builder;
      },
      update(d: Fila) {
        accion = 'update';
        datos = d;
        return builder;
      },
      eq(c: string, v: unknown) {
        filtros.push((f) => f[c] === v);
        return builder;
      },
      neq(c: string, v: unknown) {
        filtros.push((f) => f[c] !== v);
        return builder;
      },
      is(c: string, v: unknown) {
        filtros.push((f) => (v === null ? f[c] == null : f[c] === v));
        return builder;
      },
      not(c: string, operador: string, valor: string) {
        expect(operador).toBe('in');
        const lista = valor.replace(/^\(|\)$/g, '').split(',');
        filtros.push((f) => !lista.includes(String(f[c])));
        return builder;
      },
      order(columna: string, o: { ascending: boolean }) {
        orden = { columna, asc: o.ascending };
        return builder;
      },
      limit(n: number) {
        limite = n;
        return builder;
      },
      async single() {
        const r = await ejecutar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      async maybeSingle() {
        const r = await ejecutar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el builder thenable de supabase-js.
      then<A, B>(ok: (v: { data: Fila[] | null; error: unknown }) => A, mal?: (e: unknown) => B) {
        return ejecutar().then(ok, mal);
      },
    };
    return builder;
  }

  return {
    cliente: { from } as unknown as ClienteServicio,
    filas,
    insertados,
    actualizados,
    fallas,
    ganchos,
  };
}

// --- Contexto de prueba ---------------------------------------------------------

const ORG = '11111111-1111-4111-8111-111111111111';
const EMPRESA = '22222222-2222-4222-8222-222222222222';
const USUARIO = '33333333-3333-4333-8333-333333333333';
const AHORA = new Date('2026-11-13T15:00:00Z');

function preparar(
  extra: Partial<Omit<ContextoOperacion, 'cliente' | 'dependencias'>> & {
    sesionValida?: boolean;
  } = {},
) {
  const falso = clienteFalso();
  const registros: RegistroOperacion[] = [];
  const confirmarSesion = vi.fn(async () => extra.sesionValida ?? true);
  const registrar = vi.fn((r: RegistroOperacion) => {
    registros.push(r);
  });
  const { sesionValida: _s, ...resto } = extra;
  const ctx: ContextoOperacion = {
    cliente: falso.cliente,
    organizacionId: ORG,
    empresaId: EMPRESA,
    usuarioId: USUARIO,
    operacion: 'enviar_set',
    ambiente: 'certificacion',
    canal: 'soap',
    confirmada: true,
    ...resto,
    dependencias: { confirmarSesion, registrar, reloj: () => AHORA },
  };
  return { ...falso, ctx, registros, confirmarSesion, registrar };
}

async function errorTransporteReal(url: string): Promise<ErrorTransporte> {
  const respuesta = await new TransporteFalso().enviar({ metodo: 'POST', url });
  try {
    exigirStatus(respuesta, url);
  } catch (error) {
    return error as ErrorTransporte;
  }
  throw new Error('exigirStatus no lanzó');
}

function filaPrevia(datos: Fila): Fila {
  return {
    id: randomUUID(),
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    operacion: 'solicitar_folios',
    ambiente: 'certificacion',
    confirmada: true,
    resultado: 'incierto',
    detalle: {},
    iniciada_en: '2026-11-13T14:00:00.000Z',
    terminada_en: '2026-11-13T14:01:00.000Z',
    ...datos,
  };
}

// --- Los 8 resultados -----------------------------------------------------------

describe('ejecutarOperacion: los 8 resultados', () => {
  const casos: {
    resultado: ResultadoFinal;
    lanzar: () => Promise<unknown> | unknown;
    sentry: Pick<RegistroOperacion, 'tipo' | 'nivel'>;
  }[] = [
    { resultado: 'ok', lanzar: () => undefined, sentry: { tipo: 'breadcrumb', nivel: 'info' } },
    {
      resultado: 'error',
      lanzar: () => new TypeError('x is undefined'),
      sentry: { tipo: 'excepcion', nivel: 'error' },
    },
    {
      resultado: 'uso',
      lanzar: () => new ErrorUso('Falta el RUT del receptor.'),
      sentry: { tipo: 'breadcrumb', nivel: 'warning' },
    },
    {
      resultado: 'config',
      lanzar: () => new ErrorCertificado('No se pudo leer el certificado.'),
      sentry: { tipo: 'breadcrumb', nivel: 'warning' },
    },
    {
      resultado: 'transporte',
      lanzar: () => errorTransporteReal('https://maullin.sii.cl/cgi_dte/UPL/DTEUpload'),
      sentry: { tipo: 'evento', nivel: 'warning' },
    },
    {
      resultado: 'rechazo_sii',
      lanzar: () => new ErrorRespuestaSii('El SII rechazó el envío.', { estado: 'RCT' }),
      sentry: { tipo: 'breadcrumb', nivel: 'warning' },
    },
    {
      resultado: 'incierto',
      lanzar: () => new FoliosSinCafError(1, 10, 'certificacion', 'maullin.sii.cl'),
      sentry: { tipo: 'evento', nivel: 'error' },
    },
    {
      resultado: 'verificacion_fallida',
      lanzar: () => new ErrorVerificacion('El TED no calza con el CAF.'),
      sentry: { tipo: 'evento', nivel: 'error' },
    },
  ];

  it.each(casos)('$resultado', async ({ resultado, lanzar, sentry }) => {
    const p = preparar();
    const error = await lanzar();
    const fn = vi.fn(async ({ agregarDetalle }) => {
      agregarDetalle({ track_id: 123 });
      if (error !== undefined) throw error;
      return 'hecho';
    });

    const r = await ejecutarOperacion(p.ctx, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(p.insertados).toEqual([
      expect.objectContaining({
        organizacion_id: ORG,
        empresa_id: EMPRESA,
        usuario_id: USUARIO,
        operacion: 'enviar_set',
        ambiente: 'certificacion',
        canal: 'soap',
        confirmada: true,
        resultado: 'en_curso',
      }),
    ]);
    const [fila] = p.filas;
    expect(fila?.resultado).toBe(resultado);
    expect(fila?.terminada_en).toBe(AHORA.toISOString());
    expect(fila?.detalle).toMatchObject({ track_id: 123 });

    if (resultado === 'ok') {
      expect(r).toEqual({ ok: true, valor: 'hecho', operacionId: fila?.id });
      expect(fila?.mensaje).toBeNull();
    } else {
      expect(r).toMatchObject({ ok: false, ejecutada: true, resultado, operacionId: fila?.id });
      expect(typeof fila?.mensaje).toBe('string');
      expect(fila?.detalle).toMatchObject({ error: { nombre: (error as Error).name } });
    }

    const final = p.registros.at(-1);
    expect(final).toMatchObject({
      ...sentry,
      etiquetas: {
        organizacion: ORG,
        empresa: EMPRESA,
        ambiente: 'certificacion',
        operacion_sii: 'enviar_set',
        resultado,
      },
      usuarioId: USUARIO,
    });
    if (resultado === 'transporte') expect(final?.etiquetas.host_sii).toBe('maullin.sii.cl');
    if (resultado === 'error') {
      expect(final?.error?.name).toBe('TypeError');
      expect(final?.error?.cause).toBeUndefined();
    }
  });

  it('un error desconocido muestra un mensaje genérico', async () => {
    const p = preparar();
    const r = await ejecutarOperacion(p.ctx, async () => {
      throw new Error('relation "x" does not exist');
    });
    expect(r).toMatchObject({ ok: false, resultado: 'error' });
    expect(JSON.stringify(r)).not.toContain('relation');
    expect(p.filas[0]?.mensaje).not.toContain('relation');
  });
});

// --- Patrones de secretos ---------------------------------------------------------

describe('ningún secreto llega a operaciones_sii, Sentry ni la consola', () => {
  const TOKEN = 'TKNSII9988776655';
  const COOKIE = 'LW9x8c7v6b5nQ';
  const PEM_CUERPO = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7';
  const PEM = `-----BEGIN PRIVATE KEY-----\n${PEM_CUERPO}\n-----END PRIVATE KEY-----`;
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJhLWZhbHNhLWRlLXBydWViYQ';
  const CLAVE = 'Hunter2-Clave';
  const SECRETOS = [TOKEN, COOKIE, PEM_CUERPO, JWT, CLAVE];

  const texto =
    `falló con TOKEN=${TOKEN} y <TOKEN>${TOKEN}</TOKEN>; Cookie: NETSCAPE_LIVEWIRE.rut=${COOKIE}; TOKEN=${TOKEN}\n` +
    `llave ${PEM} Authorization: Bearer ${JWT} clave=${CLAVE} jwt ${JWT}`;
  const causa = new Error(texto);

  const consola: unknown[][] = [];
  beforeEach(() => {
    consola.length = 0;
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        consola.push(args);
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Serializa todo, incluidos message, stack y cause de los Error (JSON.stringify los omite). */
  function volcar(valor: unknown): string {
    return JSON.stringify(valor, (_k, v: unknown) =>
      v instanceof Error
        ? { ...v, name: v.name, message: v.message, stack: v.stack, cause: v.cause }
        : v,
    );
  }

  const errores: [string, () => Promise<unknown>][] = [
    ['desconocido', async () => new Error(texto, { cause: causa })],
    [
      'de la librería con secretos en el mensaje',
      async () => new ErrorRespuestaSii(texto, { estado: TOKEN, glosa: texto }, { cause: causa }),
    ],
    [
      'de transporte con token en la query',
      async () =>
        new ErrorTransporte(texto, `https://maullin.sii.cl/x?TOKEN=${TOKEN}&clave=${CLAVE}`, 500, {
          cause: causa,
        }),
    ],
    ['de la app', async () => new ErrorIncierto(texto, { cause: causa })],
    ['valor que no es Error', async () => ({ token: TOKEN, texto })],
  ];

  it.each(errores)('error %s, con detalle sucio y cierre fallido', async (_n, crear) => {
    const p = preparar({ operacion: 'emitir' });
    p.fallas.update = { code: '57014', message: texto, details: texto };
    const error = await crear();

    const r = await ejecutarOperacion(p.ctx, async ({ agregarDetalle }) => {
      agregarDetalle({
        token: TOKEN,
        clave: CLAVE,
        pfx: PEM,
        cookies: [`NETSCAPE_LIVEWIRE.rut=${COOKIE}`],
        secreto: JWT,
        RSASK: PEM,
        api_key: JWT,
        authorization: `Bearer ${JWT}`,
        respuesta: texto,
        anidado: { lista: [texto, { sesion: TOKEN }], cert: PEM },
        jwt_suelto: JWT,
        set_cookie_header: `Set-Cookie: s=${COOKIE}`,
      });
      throw error;
    });

    const volcado = volcar({
      r,
      filas: p.filas,
      insertados: p.insertados,
      actualizados: p.actualizados,
      sentry: p.registrar.mock.calls,
      consola,
    });
    for (const secreto of SECRETOS) expect(volcado).not.toContain(secreto);
    // El cierre falló, pero se reportó a Sentry y a la consola, y manda el resultado original.
    expect(r.ok).toBe(false);
    expect(p.registros.some((x) => x.error?.name === 'ErrorRegistroOperacion')).toBe(true);
    expect(consola.length).toBeGreaterThan(0);
    expect(p.actualizados).toHaveLength(1);
  });

  it('también en un ok con detalle sucio', async () => {
    const p = preparar();
    await ejecutarOperacion(p.ctx, async ({ agregarDetalle }) => {
      agregarDetalle({ respuesta: texto, token: TOKEN });
      return { cookie: COOKIE };
    });
    const volcado = volcar({ filas: p.filas, sentry: p.registrar.mock.calls, consola });
    for (const secreto of SECRETOS) expect(volcado).not.toContain(secreto);
  });
});

// --- Sesión con getUser() -------------------------------------------------------

describe('confirmación de sesión', () => {
  it('las listas exportadas', () => {
    expect(OPERACIONES_QUE_GRABAN).toEqual([
      'postular',
      'descargar_set',
      'solicitar_folios',
      'enviar_set',
      'solicitar_revision',
      'declarar',
      'enviar_rcof',
      'emitir',
    ]);
    expect(OPERACIONES_EFECTO_GLOBAL).toEqual(['solicitar_folios', 'postular', 'declarar']);
  });

  it('una sesión revocada no inserta ni ejecuta', async () => {
    const p = preparar({ sesionValida: false, operacion: 'declarar' });
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    expect(p.confirmarSesion).toHaveBeenCalledWith(USUARIO);
    expect(fn).not.toHaveBeenCalled();
    expect(p.insertados).toEqual([]);
    expect(r).toMatchObject({
      ok: false,
      ejecutada: false,
      motivo: 'sesion_invalida',
      operacionId: null,
      mensaje: { titulo: 'Tu sesión ya no es válida' },
    });
  });

  it('si confirmarSesion lanza, se trata como sesión no válida', async () => {
    const p = preparar();
    p.confirmarSesion.mockRejectedValueOnce(new Error('Auth caído'));
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ motivo: 'sesion_invalida' });
  });

  it('un ensayo (confirmada: false) no llama a getUser', async () => {
    const p = preparar({ confirmada: false, operacion: 'solicitar_folios' });
    const r = await ejecutarOperacion(p.ctx, async () => 'ensayo');
    expect(p.confirmarSesion).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(p.insertados[0]).toMatchObject({ confirmada: false });
  });

  it('una operación que no graba no llama a getUser', async () => {
    const p = preparar({ operacion: 'estado_envio' });
    await ejecutarOperacion(p.ctx, async () => 1);
    expect(p.confirmarSesion).not.toHaveBeenCalled();
  });

  it('sin usuario (cron o API) no llama a getUser y guarda la API key', async () => {
    const apiKeyId = randomUUID();
    const p = preparar({ usuarioId: null, apiKeyId, operacion: 'emitir' });
    await ejecutarOperacion(p.ctx, async () => 1);
    expect(p.confirmarSesion).not.toHaveBeenCalled();
    expect(p.insertados[0]).toMatchObject({ usuario_id: null, api_key_id: apiKeyId });
  });
});

// --- Un incierto bloquea el reintento ---------------------------------------------

describe('bloqueo por incierto', () => {
  it('un incierto previo bloquea y explica cómo revisar', async () => {
    const p = preparar({ operacion: 'solicitar_folios' });
    const previa = filaPrevia({});
    p.filas.push(previa);
    const fn = vi.fn(async () => 'x');

    const r = await ejecutarOperacion(p.ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(p.insertados).toEqual([]);
    expect(r).toMatchObject({
      ok: false,
      ejecutada: false,
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: previa.id,
    });
    if (!r.ok) {
      expect(r.mensaje.detalle).toContain('13-11-2026 11:00');
      expect(r.mensaje.detalle).toContain('Folios ya autorizados');
      expect(r.mensaje.detalle).toContain('márcala como revisada');
    }
  });

  it('solo mira la última confirmada de la misma empresa, operación y ambiente', async () => {
    const p = preparar({ operacion: 'declarar' });
    p.filas.push(
      filaPrevia({ operacion: 'declarar', empresa_id: randomUUID() }),
      filaPrevia({ operacion: 'declarar', ambiente: 'produccion' }),
      filaPrevia({ operacion: 'solicitar_folios' }),
      filaPrevia({ operacion: 'declarar', confirmada: false }),
      filaPrevia({ operacion: 'declarar', iniciada_en: '2026-11-12T10:00:00.000Z' }),
      filaPrevia({
        operacion: 'declarar',
        resultado: 'ok',
        iniciada_en: '2026-11-13T12:00:00.000Z',
      }),
    );
    const r = await ejecutarOperacion(p.ctx, async () => 'x');
    expect(r.ok).toBe(true);
  });

  it('un ensayo no se bloquea', async () => {
    const p = preparar({ operacion: 'postular', confirmada: false });
    p.filas.push(filaPrevia({ operacion: 'postular' }));
    expect((await ejecutarOperacion(p.ctx, async () => 'x')).ok).toBe(true);
  });

  it('emitir no se bloquea aquí (lo hace envios.incierto en la Fase 7)', async () => {
    const p = preparar({ operacion: 'emitir' });
    p.filas.push(filaPrevia({ operacion: 'emitir' }));
    expect((await ejecutarOperacion(p.ctx, async () => 'x')).ok).toBe(true);
  });

  it('marcada como revisada, desbloquea', async () => {
    const p = preparar({ operacion: 'solicitar_folios' });
    const previa = filaPrevia({ detalle: { error: { nombre: 'FoliosSinCafError' } } });
    p.filas.push(previa);

    const marca = await marcarInciertaRevisada(
      p.cliente,
      { organizacionId: ORG, operacionId: String(previa.id), usuarioId: USUARIO },
      () => AHORA,
    );
    expect(marca).toEqual({ ok: true });
    expect(previa.detalle).toEqual({
      error: { nombre: 'FoliosSinCafError' },
      revisada_en: AHORA.toISOString(),
      revisada_por: USUARIO,
    });

    const fn = vi.fn(async () => 'x');
    expect((await ejecutarOperacion(p.ctx, fn)).ok).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('no marca una operación de otra organización ni una que no es incierta', async () => {
    const p = preparar();
    const ajena = filaPrevia({ organizacion_id: randomUUID() });
    const buena = filaPrevia({ resultado: 'ok' });
    p.filas.push(ajena, buena);
    const otra = await marcarInciertaRevisada(p.cliente, {
      organizacionId: ORG,
      operacionId: String(ajena.id),
      usuarioId: USUARIO,
    });
    expect(otra).toMatchObject({ ok: false, mensaje: { titulo: 'No encontramos la operación' } });
    const ok = await marcarInciertaRevisada(p.cliente, {
      organizacionId: ORG,
      operacionId: String(buena.id),
      usuarioId: USUARIO,
    });
    expect(ok).toMatchObject({ ok: false });
    expect(p.actualizados).toEqual([]);
  });

  it('una igual en curso bloquea; abandonada, cuenta como incierta y se puede revisar', async () => {
    const p = preparar({ operacion: 'declarar' });
    const reciente = filaPrevia({
      operacion: 'declarar',
      resultado: 'en_curso',
      terminada_en: null,
      iniciada_en: '2026-11-13T14:55:00.000Z',
    });
    p.filas.push(reciente);
    expect(await ejecutarOperacion(p.ctx, async () => 'x')).toMatchObject({
      motivo: 'en_curso',
      operacionPendienteId: reciente.id,
    });
    // Sin terminar hace menos de 15 minutos: todavía no se puede marcar.
    expect(
      await marcarInciertaRevisada(
        p.cliente,
        { organizacionId: ORG, operacionId: String(reciente.id), usuarioId: USUARIO },
        () => AHORA,
      ),
    ).toMatchObject({ ok: false });

    reciente.iniciada_en = '2026-11-13T14:30:00.000Z';
    expect(await ejecutarOperacion(p.ctx, async () => 'x')).toMatchObject({
      motivo: 'incierto_sin_revisar',
    });
    await marcarInciertaRevisada(
      p.cliente,
      { organizacionId: ORG, operacionId: String(reciente.id), usuarioId: USUARIO },
      () => AHORA,
    );
    expect(reciente).toMatchObject({
      resultado: 'incierto',
      terminada_en: AHORA.toISOString(),
      detalle: { abandonada: true, revisada_por: USUARIO },
    });
    expect((await ejecutarOperacion(p.ctx, async () => 'x')).ok).toBe(true);
  });

  it('si no se puede consultar la anterior, no ejecuta', async () => {
    const p = preparar({ operacion: 'declarar' });
    p.fallas.select = { code: '57014', message: 'timeout' };
    const fn = vi.fn(async () => 'x');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await ejecutarOperacion(p.ctx, fn);
    vi.restoreAllMocks();
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ejecutada: false, motivo: 'sin_registro' });
  });

  it('una operación de efecto global sin empresa es uso: no inserta ni ejecuta', async () => {
    for (const confirmada of [true, false]) {
      const p = preparar({ operacion: 'solicitar_folios', empresaId: null, confirmada });
      const fn = vi.fn(async () => 'x');
      const r = await ejecutarOperacion(p.ctx, fn);
      expect(fn).not.toHaveBeenCalled();
      expect(p.insertados).toEqual([]);
      expect(p.confirmarSesion).not.toHaveBeenCalled();
      expect(r).toMatchObject({
        ok: false,
        ejecutada: false,
        motivo: 'uso',
        operacionId: null,
        mensaje: { titulo: 'Falta la empresa de la operación' },
      });
      expect(p.registros.at(-1)).toMatchObject({ tipo: 'excepcion', nivel: 'error' });
    }
  });
});

// --- Carrera entre dos peticiones iguales -----------------------------------------

describe('carrera entre el control previo y el insert', () => {
  it('23505 del índice único: no ejecuta y apunta a la otra en curso', async () => {
    const p = preparar({ operacion: 'solicitar_folios' });
    const otra = filaPrevia({
      resultado: 'en_curso',
      terminada_en: null,
      iniciada_en: '2026-11-13T14:59:59.000Z',
    });
    // La otra petición insertó su fila después de nuestro control previo.
    p.ganchos.antesDeInsertar = () => p.filas.push(otra);
    const fn = vi.fn(async () => 'x');

    const r = await ejecutarOperacion(p.ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(p.insertados).toHaveLength(1);
    expect(p.filas).toEqual([otra]);
    expect(r).toMatchObject({
      ok: false,
      ejecutada: false,
      motivo: 'en_curso',
      operacionId: null,
      operacionPendienteId: otra.id,
      mensaje: { titulo: 'Ya hay una operación igual en curso' },
    });
  });

  it('23505 contra una en curso abandonada: cuenta como incierta sin revisar', async () => {
    const p = preparar({ operacion: 'declarar' });
    const abandonada = filaPrevia({
      operacion: 'declarar',
      resultado: 'en_curso',
      terminada_en: null,
      iniciada_en: '2026-11-13T14:00:00.000Z',
    });
    p.ganchos.antesDeInsertar = () => p.filas.push(abandonada);
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: abandonada.id,
    });
  });

  it('23505 sin la otra fila a la vista (ya terminó): en curso, sin id', async () => {
    const p = preparar({ operacion: 'postular' });
    p.fallas.insert = { code: '23505', message: 'duplicate key' };
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ejecutada: false, motivo: 'en_curso', operacionId: null });
    expect(r).not.toHaveProperty('operacionPendienteId');
  });

  it('un incierto aparecido entre el control previo y el insert: cierra la fila propia como uso', async () => {
    const p = preparar({ operacion: 'solicitar_folios' });
    const incierta = filaPrevia({
      iniciada_en: '2026-11-13T14:59:00.000Z',
      terminada_en: '2026-11-13T14:59:58.000Z',
    });
    // La otra entró, quedó incierta y soltó el índice antes de nuestro insert.
    p.ganchos.antesDeInsertar = () => p.filas.push(incierta);
    const fn = vi.fn(async () => 'x');

    const r = await ejecutarOperacion(p.ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    const propia = p.filas.find((f) => f.id !== incierta.id);
    expect(propia).toMatchObject({
      resultado: 'uso',
      confirmada: true,
      terminada_en: AHORA.toISOString(),
      detalle: { motivo: 'incierto_sin_revisar', operacion_pendiente_id: incierta.id },
    });
    expect(String(propia?.mensaje)).toContain('Folios ya autorizados');
    expect(r).toMatchObject({
      ok: false,
      ejecutada: false,
      motivo: 'incierto_sin_revisar',
      operacionId: propia?.id,
      operacionPendienteId: incierta.id,
    });

    // La fila propia (uso, no llegó al SII) no tapa el incierto: el siguiente intento
    // sigue bloqueado en el control previo, sin insertar.
    const otraVez = await ejecutarOperacion(p.ctx, fn);
    expect(otraVez).toMatchObject({ motivo: 'incierto_sin_revisar', operacionId: null });
    expect(p.insertados).toHaveLength(1);

    await marcarInciertaRevisada(p.cliente, {
      organizacionId: ORG,
      operacionId: String(incierta.id),
      usuarioId: USUARIO,
    });
    expect((await ejecutarOperacion(p.ctx, fn)).ok).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('si el control posterior no puede consultar, cierra la fila propia y no ejecuta', async () => {
    const p = preparar({ operacion: 'postular' });
    p.ganchos.antesDeInsertar = () => {
      p.fallas.select = { code: '57014', message: 'timeout' };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    vi.restoreAllMocks();
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ejecutada: false, motivo: 'sin_registro' });
    expect(p.filas[0]).toMatchObject({ resultado: 'uso', detalle: { motivo: 'sin_registro' } });
  });

  it('ensayos y operaciones fuera de la lista no chocan con una en curso', async () => {
    const ensayo = preparar({ operacion: 'solicitar_folios', confirmada: false });
    ensayo.filas.push(filaPrevia({ resultado: 'en_curso', terminada_en: null, confirmada: false }));
    expect((await ejecutarOperacion(ensayo.ctx, async () => 'x')).ok).toBe(true);

    const emitir = preparar({ operacion: 'emitir' });
    emitir.ganchos.antesDeInsertar = () =>
      emitir.filas.push(
        filaPrevia({ operacion: 'emitir', resultado: 'en_curso', terminada_en: null }),
      );
    expect((await ejecutarOperacion(emitir.ctx, async () => 'x')).ok).toBe(true);
  });
});

// --- Fallas de la base ----------------------------------------------------------

describe('fallas de operaciones_sii', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin fila no se llama al SII', async () => {
    const p = preparar();
    p.fallas.insert = { code: '42501', message: 'permiso' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn(async () => 'x');
    const r = await ejecutarOperacion(p.ctx, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, ejecutada: false, motivo: 'sin_registro' });
    expect(p.registros.at(-1)).toMatchObject({ tipo: 'excepcion', nivel: 'error' });
    expect(p.registros.at(-1)?.mensaje).toContain('42501');
  });

  it('si el cierre falla, devuelve el resultado de la operación y lo reporta', async () => {
    const p = preparar();
    p.fallas.update = { code: '57014', message: 'timeout' };
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await ejecutarOperacion(p.ctx, async () => 'hecho');
    expect(r).toMatchObject({ ok: true, valor: 'hecho' });
    expect(espia).toHaveBeenCalledOnce();
    expect(p.registros.map((x) => x.error?.name ?? x.tipo)).toEqual([
      'ErrorRegistroOperacion',
      'breadcrumb',
    ]);
  });

  it('si registrar (Sentry) lanza, no tapa el resultado', async () => {
    const p = preparar();
    p.registrar.mockImplementation(() => {
      throw new Error('Sentry caído');
    });
    const r = await ejecutarOperacion(p.ctx, async () => {
      throw new ErrorUso('Falta el RUT.');
    });
    expect(r).toMatchObject({ ok: false, resultado: 'uso' });
    expect(p.filas[0]?.resultado).toBe('uso');
  });
});
