import { EstadoEnvio, EstadoEnvioRest } from '@winex/certificacion';
import { describe, expect, it, vi } from 'vitest';

// Solo para «sin registrar inyectado»: el resto de las pruebas inyecta su propio
// `registrar`, así que este doble no las afecta.
const { registrarEnSentry } = vi.hoisted(() => ({ registrarEnSentry: vi.fn() }));
vi.mock('../sii/operacion', async (original) => ({
  ...(await original<typeof import('../sii/operacion')>()),
  registrarEnSentry,
}));

import {
  cerrarAbandonadas,
  debeConsultar,
  ejecutarSeguimiento,
  filtroPorConsultar,
  LIMITE_MS,
  MS_EMPEZAR_GRUPO,
} from './cron';
import {
  AHORA,
  EMPRESA,
  type EscenarioSeguimiento,
  escenarioSeguimiento,
  evaluarFiltro,
  filaDocumento,
  filaEnvio,
  jsonEstado,
  ORG,
} from './escenario-prueba';
import { desdeRest, guardarRespuesta } from './persistencia';

// Correcciones de la revisión de código de la Fase 8 (una sección por hallazgo).

function correr(e: EscenarioSeguimiento, opciones?: Parameters<typeof ejecutarSeguimiento>[1]) {
  return ejecutarSeguimiento(e.deps, opciones);
}

function operaciones(e: EscenarioSeguimiento) {
  return e.falso.tabla('operaciones_sii');
}

const haceMin = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

describe('1. tiempo de la corrida (maxDuration)', () => {
  it('cada consulta empieza solo si su peor caso (45 s) termina antes del límite', async () => {
    let t = AHORA.getTime();
    const envios = ['101', '102', '103', '104', '105'].map((track_id) => filaEnvio({ track_id }));
    // Cada consulta tarda 60 s: a los 240 s ya no cabe otra (240 + 45 > 280).
    const e = escenarioSeguimiento({
      envios,
      alConsultar: () => {
        t += 60_000;
      },
      reloj: { ahora: () => new Date(t) },
    });
    const r = await correr(e, { limiteMs: LIMITE_MS });
    expect(r).toMatchObject({ envios: 5, consultados: 4, postergados: 1, errores: 0 });
    expect(operaciones(e)[0]).toMatchObject({
      resultado: 'ok',
      detalle: expect.objectContaining({ consultados: 4, postergados: 1 }),
    });
  });

  it('no empieza un grupo si no cabe su peor caso (preparar + token + una consulta)', async () => {
    const e = escenarioSeguimiento({ envios: [filaEnvio({ track_id: '101' })] });
    const r = await correr(e, { limiteMs: MS_EMPEZAR_GRUPO - 1 });
    expect(r).toMatchObject({ envios: 1, consultados: 0, postergados: 1 });
    expect(e.transporteFalso.enviadas).toEqual([]);
    expect(operaciones(e)).toEqual([]);
  });

  it('no renueva el token si ya no cabe (3 × 45 s) y posterga el resto del grupo', async () => {
    let t = AHORA.getTime();
    const envios = ['101', '102', '103'].map((track_id) => filaEnvio({ track_id }));
    const e = escenarioSeguimiento({
      envios,
      respuestas: { '101': { http: 401 } },
      alConsultar: () => {
        t += 30_000;
      },
      reloj: { ahora: () => new Date(t) },
    });
    // Cabe empezar el grupo (150 s), pero a los 30 s ya no caben los 135 s de renovar.
    const r = await correr(e, { limiteMs: 160_000 });
    expect(r).toMatchObject({ consultados: 0, errores: 1, postergados: 2 });
    expect(e.tokensPedidos()).toBe(1);
    expect(e.consultasHechas()).toHaveLength(1);
  });

  it('cierra las operaciones del seguimiento abandonadas en curso (más de 15 min)', async () => {
    const e = escenarioSeguimiento();
    const fila = (id: string, operacion: string, minutos: number) => ({
      id,
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      operacion,
      ambiente: 'certificacion',
      resultado: 'en_curso',
      confirmada: true,
      detalle: {},
      iniciada_en: haceMin(minutos),
    });
    e.falso.db.operaciones_sii = [
      fila('op-vieja', 'seguimiento', 20),
      fila('op-panel', 'consultar_envio', 30),
      fila('op-reciente', 'seguimiento', 5),
      fila('op-folios', 'solicitar_folios', 60),
    ];
    expect(await cerrarAbandonadas(e.cliente, AHORA)).toBe(2);
    const op = (id: string) => e.falso.tabla('operaciones_sii').find((o) => o.id === id);
    expect(op('op-vieja')).toMatchObject({
      resultado: 'error',
      detalle: { abandonada: true },
      terminada_en: AHORA.toISOString(),
    });
    expect(String(op('op-vieja')?.mensaje)).toContain('no quedó nada pendiente en el SII');
    expect(op('op-panel')).toMatchObject({ resultado: 'error' });
    expect(op('op-reciente')).toMatchObject({ resultado: 'en_curso' });
    // Las de efecto global las maneja ejecutarOperacion (cuentan como inciertas).
    expect(op('op-folios')).toMatchObject({ resultado: 'en_curso' });
  });

  it('la corrida las cierra antes de consultar', async () => {
    const e = escenarioSeguimiento();
    e.falso.db.operaciones_sii = [
      {
        id: 'op-vieja',
        organizacion_id: ORG,
        operacion: 'seguimiento',
        resultado: 'en_curso',
        iniciada_en: haceMin(40),
      },
    ];
    await correr(e);
    expect(operaciones(e)[0]).toMatchObject({ resultado: 'error' });
  });
});

describe('2. el backoff va en el filtro de la base (cola sin hambre)', () => {
  it('un envío nuevo entra aunque haya cientos en backoff largo con consultas más antiguas', async () => {
    const enBackoff = Array.from({ length: 350 }, (_, i) =>
      filaEnvio({ track_id: String(5000 + i), consultas: 60, ultima_consulta_en: haceMin(120) }),
    );
    const nuevo = filaEnvio({ track_id: '101', consultas: 1, ultima_consulta_en: haceMin(5) });
    const e = escenarioSeguimiento({ envios: [...enBackoff, nuevo] });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1 });
    expect(e.consultasHechas().map((p) => p.url.split('-').at(-1))).toEqual(['101']);
  });

  it('filtroPorConsultar (evaluado como PostgREST) da lo mismo que debeConsultar', () => {
    const casos: Record<string, unknown>[] = [];
    for (const consultas of [0, 5, 11, 12, 20, 23, 24, 40, 47, 48, 200]) {
      for (const ultima of [
        null,
        1,
        3,
        4,
        5,
        14,
        15,
        16,
        59,
        60,
        61,
        359,
        360,
        361,
        1439,
        1440,
        1441,
      ]) {
        for (const enviado of [null, 30, 6 * 24 * 60, 8 * 24 * 60]) {
          casos.push({
            consultas,
            ultima_consulta_en: ultima === null ? null : haceMin(ultima),
            enviado_en: enviado === null ? null : haceMin(enviado),
          });
        }
      }
    }
    const filtro = filtroPorConsultar(AHORA);
    for (const caso of casos) {
      expect(evaluarFiltro(filtro, caso), JSON.stringify(caso)).toBe(
        debeConsultar(caso as never, AHORA),
      );
    }
  });
});

describe('3. EPR con detalle incompleto (REST)', () => {
  it('menos rechazos en el detalle que en los contadores: no guarda el estado final', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const docs = [41, 42, 43].map((f) => filaDocumento(envio, f));
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: docs,
      respuestas: {
        '101': jsonEstado('EPR', { informados: 3, aceptados: 1, rechazados: 2 }, [
          { tipo: 39, folio: 42, estado: 'RCH', descripcion: 'Rechazado', error: [] },
        ]),
      },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 0, errores: 1 });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC', consultas: 1 });
    expect(e.falso.tabla('envio_rechazos')).toEqual([]);
    expect(e.consultas(envio.id)[0]).toMatchObject({ estado_sii: 'EPR', rechazados: 2 });
    expect(String(e.consultas(envio.id)[0]?.error)).toContain('solo trae 1 y 0');
    for (const folio of [41, 42, 43]) expect(e.historial.get(folio)).toEqual(['enviado']);
  });

  it('reparos sin detalle también lo frenan', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado('EPR', { informados: 1, aceptados: 1, reparos: 1 }) },
    });
    await correr(e);
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC' });
    expect(e.historial.get(41)).toEqual(['enviado']);
  });
});

describe('4. estados desconocidos y token SOAP', () => {
  it('REST: un estado fuera de la lista blanca no se guarda (sería «rechazado»)', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado('XYZ') },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 0, errores: 1 });
    expect(e.envio(envio.id)).toMatchObject({
      estado_sii: 'REC',
      clasificacion: 'en_proceso',
      consultas: 1,
    });
    expect(e.consultas(envio.id)[0]?.error).toContain('ErrorEstadoDesconocido');
    expect(e.historial.get(41)).toEqual(['enviado']);
    expect(operaciones(e)[0]).toMatchObject({ resultado: 'rechazo_sii' });
  });

  it('SOAP: -11 (aún no registrado) es una falla de esa consulta, sin tocar el estado', async () => {
    const envio = filaEnvio({ track_id: '101', canal: 'soap' });
    const e = escenarioSeguimiento({ envios: [envio] });
    e.soap.estadoEnvio.mockResolvedValueOnce(
      new EstadoEnvio({ trackId: '101', estado: '-11', glosa: '' }),
    );
    const r = await correr(e);
    expect(r).toMatchObject({ errores: 1 });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC' });
    expect(e.consultas(envio.id)[0]?.error).toContain('-11');
  });

  it('SOAP: un estado de token vencido (HTTP 200) renueva el token una vez y repite', async () => {
    const envio = filaEnvio({ track_id: '101', canal: 'soap' });
    const e = escenarioSeguimiento({ envios: [envio] });
    e.soap.estadoEnvio.mockResolvedValueOnce(
      new EstadoEnvio({ trackId: '101', estado: '001', glosa: 'TOKEN NO EXISTE' }),
    );
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, errores: 0 });
    expect(e.soap.olvidarToken).toHaveBeenCalledTimes(1);
    expect(e.soap.obtenerToken).toHaveBeenCalledTimes(2);
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'EPR', clasificacion: 'aceptado' });
  });
});

describe('5 y 6. inconsistentes y respuestas viejas', () => {
  it('el cron también reconsulta los inconsistentes (con backoff)', async () => {
    const inconsistente = (track_id: string, minutos: number) =>
      filaEnvio({
        track_id,
        estado_sii: 'EPR',
        informados: 2,
        aceptados: 1,
        consultas: 3,
        ultima_consulta_en: haceMin(minutos),
      });
    const toca = inconsistente('101', 10);
    const reciente = inconsistente('102', 1);
    expect(toca.clasificacion).toBe('inconsistente');
    const e = escenarioSeguimiento({
      envios: [toca, reciente],
      respuestas: { '101': jsonEstado('EPR', { informados: 2, aceptados: 2 }) },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1, cambiados: 1 });
    expect(e.envio(toca.id)).toMatchObject({ clasificacion: 'aceptado', consultas: 4 });
    expect(e.envio(reciente.id)).toMatchObject({ clasificacion: 'inconsistente', consultas: 3 });
  });

  it('una respuesta en proceso que llega tarde no pisa un estado final ni borra sus rechazos', async () => {
    const leido = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [leido], documentos: [filaDocumento(leido, 41)] });
    // Mientras se consultaba, otra consulta lo cerró como rechazado con su detalle.
    Object.assign(e.envio(leido.id) as object, {
      estado_sii: 'EPR',
      informados: 1,
      rechazados: 1,
      clasificacion: 'rechazado',
    });
    e.falso.tabla('envio_rechazos').push({
      id: 'r1',
      organizacion_id: ORG,
      envio_id: leido.id,
      tipo_dte: 39,
      folio: 41,
      tipo_observacion: 'rechazo',
    });
    const respuesta = desdeRest(EstadoEnvioRest.desdeJson(jsonEstado('PRD'), '101'));
    const g = await guardarRespuesta(e.cliente, leido as never, respuesta, AHORA, []);
    expect(g).toEqual({ tipo: 'ya_final', clasificacion: 'rechazado' });
    expect(e.envio(leido.id)).toMatchObject({
      estado_sii: 'EPR',
      clasificacion: 'rechazado',
      consultas: 0,
    });
    expect(e.falso.tabla('envio_rechazos')).toHaveLength(1);
    expect(e.consultas(leido.id)[0]).toMatchObject({ estado_sii: 'PRD' });
  });

  it('una respuesta que no es EPR nunca intenta borrar rechazos', async () => {
    const leido = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [leido] });
    const respuesta = desdeRest(EstadoEnvioRest.desdeJson(jsonEstado('SOK'), '101'));
    await guardarRespuesta(e.cliente, leido as never, respuesta, AHORA, []);
    const escrituras = e.falso.escrituras;
    expect(escrituras.some((w) => w.tabla === 'envios' && w.accion === 'update')).toBe(true);
    expect(escrituras.some((w) => w.tabla === 'envio_rechazos' && w.accion === 'delete')).toBe(
      false,
    );
  });
});

describe('7. envíos que nunca cierran', () => {
  it('con más de 7 días sin estado final se consulta una vez al día y avisa a Sentry', async () => {
    const ochoDias = 8 * 24 * 60;
    const noToca = filaEnvio({
      track_id: '101',
      consultas: 80,
      ultima_consulta_en: haceMin(7 * 60),
      enviado_en: haceMin(ochoDias),
    });
    const toca = filaEnvio({
      track_id: '102',
      consultas: 80,
      ultima_consulta_en: haceMin(25 * 60),
      enviado_en: haceMin(ochoDias),
    });
    const e = escenarioSeguimiento({
      envios: [noToca, toca],
      respuestas: { '102': jsonEstado('PRD') },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1 });
    const avisos = e.registros.filter((x) => x.etiquetas.resultado === 'envio_sin_cerrar');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      tipo: 'evento',
      nivel: 'warning',
      contexto: expect.objectContaining({ envio_id: toca.id, dias: 8 }),
    });
    expect(operaciones(e)[0]?.detalle).toMatchObject({ sinCerrar: 1 });
  });

  it('sin `registrar` inyectado (producción), el aviso va a Sentry', async () => {
    registrarEnSentry.mockClear();
    const envio = filaEnvio({
      track_id: '102',
      consultas: 80,
      ultima_consulta_en: haceMin(25 * 60),
      enviado_en: haceMin(8 * 24 * 60),
    });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '102': jsonEstado('PRD') } });
    const { registrar: _inyectado, ...operacion } = e.deps.operacion ?? {};
    await ejecutarSeguimiento({ ...e.deps, operacion });
    expect(registrarEnSentry).toHaveBeenCalledWith(
      expect.objectContaining({
        etiquetas: expect.objectContaining({ resultado: 'envio_sin_cerrar' }),
      }),
    );
  });

  it('uno reciente en backoff largo sigue cada 6 horas, sin aviso', async () => {
    const envio = filaEnvio({
      track_id: '101',
      consultas: 80,
      ultima_consulta_en: haceMin(7 * 60),
    });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': jsonEstado('PRD') } });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1 });
    expect(e.registros.some((x) => x.etiquetas.resultado === 'envio_sin_cerrar')).toBe(false);
  });
});
