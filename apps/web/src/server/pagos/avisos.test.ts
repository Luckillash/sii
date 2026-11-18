import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INTENTOS, MINUTOS_ABANDONADA } from '../alertas/constantes';
import type { CierreNotificacion, NuevaNotificacion, OrganizacionAlerta } from '../alertas/datos';
import type { MensajeCorreo, ResultadoEnvio } from '../correo/resend';
import type { ClienteServicio } from '../supabase/service';
import {
  avisarMorosas,
  claveIdempotenciaMorosa,
  claveMorosa,
  type DependenciasAvisos,
  MAX_CORREOS,
  type RepositorioAvisos,
  TIPO_MOROSA,
} from './avisos';
import type { FacturaExterna } from './pasarela';
import type { ResultadoSincronizacion } from './suscripciones';

// `avisarMorosas` sin red ni base: un repositorio en memoria que imita
// `reclamar_notificacion` de la 0013 (clave única, reintento de `fallida` hasta 5
// intentos, `pendiente` abandonada a los 15 min, devuelve intentos y grupo) y un doble
// de Resend.

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const SUS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUS2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INICIO = Date.parse('2026-11-17T15:00:00Z');
const DB = {} as ClienteServicio;

interface FilaMemoria {
  id: string;
  organizacionId: string;
  tipo: string;
  clave: string;
  grupo: string | null;
  estado: 'pendiente' | 'enviada' | 'fallida';
  intentos: number;
  actualizadoEn: number;
  error: string | null;
  resendId: string | null;
  destinatarios: string[];
}

function factura(extra: Partial<FacturaExterna> = {}): FacturaExterna {
  return {
    id: '98765',
    monto: 14990,
    estado: 'vencido',
    periodoInicio: '2026-10-10',
    periodoFin: '2026-11-09',
    venceEn: '2026-11-10',
    pagadoEn: null,
    orden: null,
    medio: null,
    enlacePago: 'https://www.flow.cl/app/web/pagarBtnPago.php?token=secreto',
    intentos: 3,
    error: null,
    ...extra,
  };
}

function morosa(
  extra: Partial<Extract<ResultadoSincronizacion, { ok: true }>> = {},
): ResultadoSincronizacion {
  return {
    ok: true,
    organizacionId: ORG,
    suscripcionId: SUS,
    estadoAnterior: 'activa',
    estadoNuevo: 'morosa',
    vencido: factura(),
    ...extra,
  };
}

function escenario(
  destinatarios: Record<string, string[]> = {
    [ORG]: ['duena@empresa.cl', 'admin@empresa.cl'],
    [ORG2]: ['otra@org.cl'],
  },
) {
  let reloj = INICIO;
  let secuencia = 0;
  const notificaciones = new Map<string, FilaMemoria>();
  const fallas = new Set<string>();
  const reclamos: NuevaNotificacion[] = [];
  const organizaciones = new Map<string, OrganizacionAlerta>([
    [ORG, { id: ORG, nombre: 'Servicios Andinos', slug: 'servicios-andinos' }],
    [ORG2, { id: ORG2, nombre: 'Otra Org', slug: 'otra-org' }],
  ]);
  const planes = new Map([
    [SUS, 'Básico'],
    [SUS2, 'Pyme'],
  ]);
  const fallar = (operacion: string) => {
    if (fallas.has(operacion)) throw new Error(`falla simulada: ${operacion}`);
  };

  const repositorio: RepositorioAvisos = {
    async organizaciones(ids) {
      fallar('organizaciones');
      return new Map([...organizaciones].filter(([id]) => ids.includes(id)));
    },
    async destinatarios(ids) {
      fallar('destinatarios');
      return new Map(ids.map((id) => [id, destinatarios[id] ?? []]));
    },
    async planes(ids) {
      fallar('planes');
      return new Map([...planes].filter(([id]) => ids.includes(id)));
    },
    async reclamar(n) {
      fallar('reclamar');
      reclamos.push(n);
      const fila = notificaciones.get(n.clave);
      if (!fila) {
        secuencia += 1;
        const nueva: FilaMemoria = {
          id: `n${secuencia}`,
          organizacionId: n.organizacionId,
          tipo: n.tipo,
          clave: n.clave,
          grupo: null,
          estado: 'pendiente',
          intentos: 1,
          actualizadoEn: reloj,
          error: null,
          resendId: null,
          destinatarios: [],
        };
        notificaciones.set(n.clave, nueva);
        return { id: nueva.id, intentos: 1, grupo: null };
      }
      const abandonada =
        fila.estado === 'pendiente' && fila.actualizadoEn < reloj - MINUTOS_ABANDONADA * 60_000;
      if (
        fila.organizacionId === n.organizacionId &&
        fila.intentos < MAX_INTENTOS &&
        (fila.estado === 'fallida' || abandonada)
      ) {
        Object.assign(fila, {
          estado: 'pendiente',
          intentos: fila.intentos + 1,
          error: null,
          actualizadoEn: reloj,
        });
        return { id: fila.id, intentos: fila.intentos, grupo: fila.grupo };
      }
      return null;
    },
    async fijarGrupo(ids, grupo) {
      fallar('fijarGrupo');
      for (const fila of notificaciones.values()) {
        if (ids.includes(fila.id) && fila.estado === 'pendiente') fila.grupo = grupo;
      }
    },
    async cerrar(ids, cierre: CierreNotificacion) {
      fallar('cerrar');
      for (const fila of notificaciones.values()) {
        if (!ids.includes(fila.id) || fila.estado !== 'pendiente') continue;
        fila.estado = cierre.estado;
        fila.destinatarios = cierre.destinatarios;
        fila.actualizadoEn = reloj;
        if (cierre.estado === 'enviada') fila.resendId = cierre.resendId;
        else fila.error = cierre.error;
      }
    },
  };

  const respuestas: ResultadoEnvio[] = [];
  const enviados: MensajeCorreo[] = [];
  const correo = {
    enviar: vi.fn(async (m: MensajeCorreo): Promise<ResultadoEnvio> => {
      enviados.push(m);
      return respuestas.shift() ?? { ok: true, id: `resend-${enviados.length}` };
    }),
  };
  const pausas: number[] = [];

  const deps = (parciales: Partial<DependenciasAvisos> = {}): Partial<DependenciasAvisos> => ({
    repositorio,
    correo,
    correoConfigurado: true,
    urlApp: 'https://boleteame.dev',
    ahora: () => new Date(reloj),
    esperar: async (ms) => {
      pausas.push(ms);
    },
    ...parciales,
  });

  return {
    deps,
    correo,
    enviados,
    respuestas,
    notificaciones,
    fallas,
    reclamos,
    pausas,
    planes,
    avanzar: (minutos: number) => {
      reloj += minutos * 60_000;
    },
  };
}

let avisos: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  avisos.mockRestore();
});

describe('claves', () => {
  it('cumplen el formato de notificaciones (0013): tipo a.b y clave <tipo>:..., máx. 200', () => {
    expect(TIPO_MOROSA).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
    const clave = claveMorosa(SUS, '98765');
    expect(clave).toBe(`suscripcion.morosa:${SUS}:98765`);
    expect(clave.startsWith(`${TIPO_MOROSA}:`)).toBe(true);
    expect(claveIdempotenciaMorosa(SUS, '98765')).toBe(`suscripcion.morosa/${SUS}/98765`);
    // Un id raro o largo se reemplaza por su huella (determinista).
    const larga = claveMorosa(SUS, 'x'.repeat(500));
    expect(larga.length).toBeLessThanOrEqual(200);
    expect(larga).toBe(claveMorosa(SUS, 'x'.repeat(500)));
    expect(claveMorosa(SUS, 'a b')).not.toContain(' ');
  });
});

describe('avisarMorosas', () => {
  it('envía una vez por importe vencido y no reenvía en la corrida siguiente', async () => {
    const e = escenario();
    const r = await avisarMorosas(DB, [morosa()], e.deps());
    expect(r).toEqual({
      candidatas: 1,
      enviadas: 1,
      omitidas: 0,
      fallidas: 0,
      correoConfigurado: true,
    });
    expect(e.enviados).toHaveLength(1);
    const [m] = e.enviados;
    expect(m?.para).toEqual(['duena@empresa.cl', 'admin@empresa.cl']);
    expect(m?.asunto).toBe('Tu plan tiene un pago vencido: Servicios Andinos');
    expect(m?.texto).toContain('$ 14.990');
    expect(m?.texto).toContain('plan Básico');
    expect(m?.texto).toContain('venció el 10-11-2026');
    expect(m?.texto).toContain('https://www.flow.cl/app/web/pagarBtnPago.php?token=secreto');
    expect(m?.texto).toContain('https://boleteame.dev/servicios-andinos/configuracion/plan');
    expect(m?.claveIdempotencia).toBe(`suscripcion.morosa/${SUS}/98765`);

    const fila = e.notificaciones.get(`suscripcion.morosa:${SUS}:98765`);
    expect(fila).toMatchObject({
      tipo: 'suscripcion.morosa',
      estado: 'enviada',
      resendId: 'resend-1',
      grupo: `suscripcion.morosa/${SUS}/98765`,
      destinatarios: ['duena@empresa.cl', 'admin@empresa.cl'],
    });
    // Sin el enlace de pago ni correos en los datos de auditoría.
    expect(JSON.stringify(e.reclamos[0]?.datos)).not.toContain('flow.cl');
    expect(e.reclamos[0]).toMatchObject({ organizacionId: ORG, referenciaId: SUS });

    e.avanzar(60);
    const otra = await avisarMorosas(DB, [morosa()], e.deps());
    expect(otra).toMatchObject({ candidatas: 1, enviadas: 0, omitidas: 1, fallidas: 0 });
    expect(e.enviados).toHaveLength(1);
  });

  it('no envía si reclamar_notificacion no devuelve fila', async () => {
    const e = escenario();
    const deps = e.deps();
    const repositorio = deps.repositorio as RepositorioAvisos;
    const r = await avisarMorosas(DB, [morosa()], {
      ...deps,
      repositorio: { ...repositorio, reclamar: async () => null },
    });
    expect(r).toMatchObject({ candidatas: 1, enviadas: 0, omitidas: 1, fallidas: 0 });
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('un importe vencido nuevo de la misma suscripción es otro aviso', async () => {
    const e = escenario();
    await avisarMorosas(DB, [morosa()], e.deps());
    const r = await avisarMorosas(
      DB,
      [morosa({ vencido: factura({ id: '98766', venceEn: '2026-12-10' }) })],
      e.deps(),
    );
    expect(r.enviadas).toBe(1);
    expect(e.enviados.map((m) => m.claveIdempotencia)).toEqual([
      `suscripcion.morosa/${SUS}/98765`,
      `suscripcion.morosa/${SUS}/98766`,
    ]);
  });

  it('ignora las no morosas, las que no traen vencido y los resultados con error', async () => {
    const e = escenario();
    const r = await avisarMorosas(
      DB,
      [
        morosa({ estadoNuevo: 'activa', estadoAnterior: 'morosa', vencido: null }),
        morosa({ estadoNuevo: 'cancelada', vencido: null }),
        morosa({ vencido: null }),
        { ok: false, organizacionId: ORG, suscripcionId: SUS2, detalle: 'red' },
      ],
      e.deps(),
    );
    expect(r).toEqual({
      candidatas: 0,
      enviadas: 0,
      omitidas: 0,
      fallidas: 0,
      correoConfigurado: true,
    });
    expect(e.reclamos).toHaveLength(0);
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('sin Resend no reclama ni envía', async () => {
    const e = escenario();
    const r = await avisarMorosas(DB, [morosa()], e.deps({ correoConfigurado: false }));
    expect(r).toEqual({
      candidatas: 1,
      enviadas: 0,
      omitidas: 1,
      fallidas: 0,
      correoConfigurado: false,
    });
    expect(e.reclamos).toHaveLength(0);
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('sin NEXT_PUBLIC_APP_URL tampoco reclama', async () => {
    const e = escenario();
    const r = await avisarMorosas(DB, [morosa()], e.deps({ urlApp: null }));
    expect(r).toMatchObject({ candidatas: 1, omitidas: 1, correoConfigurado: true });
    expect(e.reclamos).toHaveLength(0);
  });

  it('si Resend falla registra la fila fallida (acotada) y la reintenta con la misma clave', async () => {
    const e = escenario();
    e.respuestas.push({ ok: false, motivo: 'rechazado', detalle: 'x'.repeat(900), estado: 422 });
    const r = await avisarMorosas(DB, [morosa()], e.deps());
    expect(r).toMatchObject({ candidatas: 1, enviadas: 0, omitidas: 0, fallidas: 1 });
    const clave = `suscripcion.morosa:${SUS}:98765`;
    const fila = e.notificaciones.get(clave);
    expect(fila?.estado).toBe('fallida');
    expect(fila?.error?.startsWith('rechazado: ')).toBe(true);
    expect(fila?.error?.length).toBeLessThanOrEqual(500);
    expect(fila?.resendId).toBeNull();
    // El aviso de consola solo lleva el código.
    expect(JSON.stringify(avisos.mock.calls)).not.toContain('@');
    expect(JSON.stringify(avisos.mock.calls)).not.toContain('flow.cl');

    const otra = await avisarMorosas(DB, [morosa()], e.deps());
    expect(otra.enviadas).toBe(1);
    expect(e.notificaciones.get(clave)).toMatchObject({ estado: 'enviada', intentos: 2 });
    expect(e.enviados[0]?.claveIdempotencia).toBe(e.enviados[1]?.claveIdempotencia);
  });

  it('una excepción del envío cuenta como fallida y cierra la fila', async () => {
    const e = escenario();
    e.correo.enviar.mockRejectedValueOnce(new Error('boom'));
    const r = await avisarMorosas(DB, [morosa()], e.deps());
    expect(r.fallidas).toBe(1);
    expect(e.notificaciones.get(`suscripcion.morosa:${SUS}:98765`)?.estado).toBe('fallida');
  });

  it('destinatarios sin duplicados (sin distinguir mayúsculas) y sin destinatarios no reclama', async () => {
    const e = escenario({
      [ORG]: ['Duena@Empresa.cl', 'duena@empresa.cl ', 'admin@empresa.cl', 'admin@empresa.cl'],
      [ORG2]: [],
    });
    const r = await avisarMorosas(
      DB,
      [morosa(), morosa({ organizacionId: ORG2, suscripcionId: SUS2 })],
      e.deps(),
    );
    expect(r).toMatchObject({ candidatas: 2, enviadas: 1, omitidas: 1, fallidas: 0 });
    expect(e.enviados[0]?.para).toEqual(['duena@empresa.cl', 'admin@empresa.cl']);
    expect(e.reclamos.map((n) => n.organizacionId)).toEqual([ORG]);
  });

  it('el mismo importe repetido en los resultados es una sola candidata', async () => {
    const e = escenario();
    const r = await avisarMorosas(DB, [morosa(), morosa()], e.deps());
    expect(r).toMatchObject({ candidatas: 1, enviadas: 1 });
    expect(e.enviados).toHaveLength(1);
  });

  it('sin enlace de pago https el correo va sin él', async () => {
    const e = escenario();
    await avisarMorosas(
      DB,
      [morosa({ vencido: factura({ enlacePago: 'http://inseguro.cl/pagar' }) })],
      e.deps(),
    );
    expect(e.enviados[0]?.texto).not.toContain('inseguro.cl');
    expect(e.enviados[0]?.html).not.toContain('Pagar con Flow');
    expect(e.enviados[0]?.texto).toContain('configuracion/plan');
  });

  it('sin plan o sin organización no reclama; un error de lectura cuenta como fallida', async () => {
    const e = escenario();
    e.planes.delete(SUS);
    const r = await avisarMorosas(DB, [morosa()], e.deps());
    expect(r).toMatchObject({ candidatas: 1, omitidas: 1 });
    expect(e.reclamos).toHaveLength(0);

    const e2 = escenario();
    e2.fallas.add('destinatarios');
    const r2 = await avisarMorosas(DB, [morosa()], e2.deps());
    expect(r2).toMatchObject({ candidatas: 1, enviadas: 0, fallidas: 1, omitidas: 0 });
    expect(e2.reclamos).toHaveLength(0);
  });

  it('si no puede cerrar la fila igual cuenta el envío; si falla reclamar, fallida', async () => {
    const e = escenario();
    e.fallas.add('cerrar');
    const r = await avisarMorosas(DB, [morosa()], e.deps());
    expect(r.enviadas).toBe(1);

    const e2 = escenario();
    e2.fallas.add('reclamar');
    const r2 = await avisarMorosas(DB, [morosa()], e2.deps());
    expect(r2).toMatchObject({ enviadas: 0, fallidas: 1 });
    expect(e2.correo.enviar).not.toHaveBeenCalled();
  });

  it('pausa entre correos y respeta el tope por corrida', async () => {
    const e = escenario();
    const muchas = Array.from({ length: MAX_CORREOS + 3 }, (_, i) =>
      morosa({ vencido: factura({ id: String(1000 + i) }) }),
    );
    const r = await avisarMorosas(DB, muchas, e.deps());
    expect(r).toMatchObject({
      candidatas: MAX_CORREOS + 3,
      enviadas: MAX_CORREOS,
      omitidas: 3,
      fallidas: 0,
    });
    expect(e.pausas).toHaveLength(MAX_CORREOS - 1);
    expect(e.reclamos).toHaveLength(MAX_CORREOS);
  });
});
