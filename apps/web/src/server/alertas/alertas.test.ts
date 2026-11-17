import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enviarCorreo, type MensajeCorreo, type ResultadoEnvio } from '../correo/resend';
import {
  MAX_CORREOS_POR_CORRIDA,
  MAX_INTENTOS,
  MINUTOS_ABANDONADA,
  PAUSA_ENTRE_CORREOS_MS,
} from './constantes';
import type {
  CertificadoPorVencerFila,
  CierreNotificacion,
  DocumentoRechazadoFila,
  EmpresaAlerta,
  EnvioInciertoFila,
  NuevaNotificacion,
  OrganizacionAlerta,
  RepositorioAlertas,
} from './datos';
import {
  claveIdempotenciaRechazos,
  type DependenciasAlertas,
  ejecutarAlertas,
  resolverDependenciasAlertas,
  umbralCertificado,
} from './index';

// `ejecutarAlertas` con un repositorio en memoria que imita la 0013: las lecturas excluyen
// lo que `notificacion_cerrada` da por cerrado, y `reclamar` sigue a
// `reclamar_notificacion` (clave única, reintento de `fallida` hasta 5 intentos,
// `pendiente` abandonada a los 15 min, nunca la clave de otra organización, devuelve
// intentos y grupo). Las funciones SQL (y el reparto por turnos entre organizaciones) se
// prueban en supabase/verificaciones/rls-fase8-notificaciones.sql (PGlite y producción).

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const EMP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EMP2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const INICIO = Date.parse('2026-11-16T15:00:00Z');

interface FilaMemoria {
  id: string;
  organizacionId: string;
  clave: string;
  grupo: string | null;
  estado: 'pendiente' | 'enviada' | 'fallida';
  intentos: number;
  actualizadoEn: number;
  error: string | null;
  resendId: string | null;
  destinatarios: string[];
}

interface Escenario {
  rechazos?: DocumentoRechazadoFila[];
  inciertos?: EnvioInciertoFila[];
  certificados?: CertificadoPorVencerFila[];
  destinatarios?: Record<string, string[]>;
}

function escenario(e: Escenario = {}) {
  let reloj = INICIO;
  let secuencia = 0;
  const notificaciones = new Map<string, FilaMemoria>();
  const fallas = new Set<string>();
  const reclamos: NuevaNotificacion[] = [];
  const pausas: number[] = [];

  const organizaciones = new Map<string, OrganizacionAlerta>([
    [ORG, { id: ORG, nombre: 'Servicios Andinos', slug: 'servicios-andinos' }],
    [ORG2, { id: ORG2, nombre: 'Otra Org', slug: 'otra-org' }],
  ]);
  const empresas = new Map<string, EmpresaAlerta>([
    [EMP, { id: EMP, razonSocial: 'Servicios Andinos SpA', rut: '76354771-K' }],
    [EMP2, { id: EMP2, razonSocial: 'Andinos Norte Ltda.', rut: '77777777-7' }],
  ]);
  const destinatarios = new Map(
    Object.entries(
      e.destinatarios ?? {
        [ORG]: ['duena@empresa.cl', 'admin@empresa.cl'],
        [ORG2]: ['otra@org.cl'],
      },
    ),
  );

  const fallar = (operacion: string) => {
    if (fallas.has(operacion)) throw new Error(`falla simulada: ${operacion}`);
  };
  /** `notificacion_cerrada` de la 0013. */
  const cerrada = (clave: string) => {
    const f = notificaciones.get(clave);
    if (!f) return false;
    return (
      f.estado === 'enviada' ||
      f.intentos >= MAX_INTENTOS ||
      (f.estado === 'pendiente' && f.actualizadoEn >= reloj - MINUTOS_ABANDONADA * 60_000)
    );
  };

  const repositorio: RepositorioAlertas = {
    async documentosRechazados() {
      fallar('rechazos');
      return (e.rechazos ?? []).filter((d) => !cerrada(`documento.rechazado:${d.id}`));
    },
    async enviosInciertos() {
      fallar('inciertos');
      return (e.inciertos ?? []).filter((i) => !cerrada(`envio.incierto:${i.id}`));
    },
    async certificadosPorVencer() {
      fallar('certificados');
      return (e.certificados ?? []).filter(
        (c) => !cerrada(`certificado.por_vencer:${c.id}:${c.umbral}`),
      );
    },
    async organizaciones(ids) {
      fallar('organizaciones');
      return new Map([...organizaciones].filter(([id]) => ids.includes(id)));
    },
    async empresas(ids) {
      fallar('empresas');
      return new Map([...empresas].filter(([id]) => ids.includes(id)));
    },
    async destinatarios(ids) {
      fallar('destinatarios');
      return new Map(ids.map((id) => [id, destinatarios.get(id) ?? []]));
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

  /** Cuánto avanza el reloj en cada pausa (para probar el tope de tiempo). */
  let msPorPausa = 0;
  const deps = (parciales: Partial<DependenciasAlertas> = {}): DependenciasAlertas => ({
    repositorio,
    correo,
    correoConfigurado: true,
    urlApp: 'https://boleteame.dev',
    ahora: () => new Date(reloj),
    esperar: async (ms) => {
      pausas.push(ms);
      reloj += msPorPausa;
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
    avanzar: (minutos: number) => {
      reloj += minutos * 60_000;
    },
    lentitud: (ms: number) => {
      msPorPausa = ms;
    },
    fila: (clave: string) => notificaciones.get(clave),
  };
}

const rechazo = (
  id: string,
  extra: Partial<DocumentoRechazadoFila> = {},
): DocumentoRechazadoFila => ({
  id,
  organizacionId: ORG,
  empresaId: EMP,
  ambiente: 'certificacion',
  tipoDte: 39,
  folio: 41,
  mntTotal: 1190,
  fechaEmision: '2026-11-16',
  envioId: 'envio-1',
  motivo: 'Error en el monto total',
  ...extra,
});

const incierto = (id: string, extra: Partial<EnvioInciertoFila> = {}): EnvioInciertoFila => ({
  id,
  organizacionId: ORG,
  empresaId: EMP,
  ambiente: 'produccion',
  creadoEn: '2026-11-16T13:15:00Z',
  documentos: [{ tipoDte: 39, folio: 77, mntTotal: 14865 }],
  ...extra,
});

const certificado = (
  dias: number,
  extra: Partial<CertificadoPorVencerFila> = {},
): CertificadoPorVencerFila => ({
  id: 'cert-1',
  organizacionId: ORG,
  titular: 'Ana Pérez',
  rut: '12345678-5',
  venceEn: '2026-12-01T12:00:00Z',
  dias,
  umbral: umbralCertificado(dias) ?? 30,
  empresas: ['Servicios Andinos SpA'],
  ...extra,
});

let avisos: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  avisos.mockRestore();
  vi.unstubAllEnvs();
});

describe('umbralCertificado (sincronizado con alertas_certificados_por_vencer de la 0013)', () => {
  it('elige el umbral vigente más chico: 30, 15, 7 y 1 días; más de 30 no avisa', () => {
    const casos: [number, number | null][] = [
      [45, null],
      [31, null],
      [30, 30],
      [16, 30],
      [15, 15],
      [8, 15],
      [7, 7],
      [2, 7],
      [1, 1],
      [0, 1],
    ];
    for (const [dias, umbral] of casos) expect(umbralCertificado(dias)).toBe(umbral);
  });
});

describe('ejecutarAlertas: detección y envío', () => {
  it('manda los inciertos primero, agrupa los rechazos de una empresa y ambiente, y uno por certificado', async () => {
    const e = escenario({
      rechazos: [rechazo('d1'), rechazo('d2', { folio: 42, motivo: null, envioId: null })],
      inciertos: [incierto('e9')],
      certificados: [certificado(10)],
    });
    const r = await ejecutarAlertas(e.deps());

    expect(r.correo).toBe('configurado');
    expect(r.correosEnviados).toBe(3);
    expect(r.limiteAlcanzado).toBe(false);
    expect(r.rechazos).toMatchObject({ detectados: 2, enviados: 2, fallidos: 0, error: false });
    expect(r.inciertos).toMatchObject({ detectados: 1, enviados: 1 });
    expect(r.certificados).toMatchObject({ detectados: 1, enviados: 1 });

    const [correoIncierto, correoRechazo, correoCert] = e.enviados;
    expect(correoIncierto?.asunto).toBe('Envío por verificar en el SII: Servicios Andinos SpA');
    expect(correoIncierto?.texto).toContain('16-11-2026 10:15');
    expect(correoIncierto?.texto).toContain('$ 14.865');
    expect(correoIncierto?.texto).toContain('«Ya lo revisé»');
    expect(correoIncierto?.texto).toContain('https://boleteame.dev/servicios-andinos/envios/e9');
    expect(correoIncierto?.claveIdempotencia).toBe('envio.incierto/e9');

    expect(correoRechazo?.para).toEqual(['duena@empresa.cl', 'admin@empresa.cl']);
    expect(correoRechazo?.asunto).toBe('El SII rechazó 2 documentos de Servicios Andinos');
    expect(correoRechazo?.texto).toContain('Boleta electrónica N.º 41');
    expect(correoRechazo?.texto).toContain('Boleta electrónica N.º 42');
    expect(correoRechazo?.texto).toContain('76.354.771-K');
    expect(correoRechazo?.texto).toContain('$ 1.190');
    expect(correoRechazo?.texto).toContain('16-11-2026');
    expect(correoRechazo?.texto).toContain(
      'https://boleteame.dev/servicios-andinos/envios/envio-1',
    );
    // El enlace general lleva empresa y ambiente (la UI no usa la empresa activa).
    expect(correoRechazo?.texto).toContain(
      `https://boleteame.dev/servicios-andinos/documentos?empresa=${EMP}&ambiente=certificacion&estado=rechazado&periodo=todos\n`,
    );
    // El documento sin envío enlaza a su detalle en Documentos.
    expect(correoRechazo?.texto).toContain(
      `documentos?empresa=${EMP}&ambiente=certificacion&estado=rechazado&periodo=todos&doc=d2`,
    );
    expect(correoRechazo?.claveIdempotencia).toBe(
      claveIdempotenciaRechazos(ORG, ['documento.rechazado:d2', 'documento.rechazado:d1']),
    );

    expect(correoCert?.asunto).toContain('vence en 10 días');
    expect(correoCert?.texto).toContain('12.345.678-5');
    expect(correoCert?.texto).toContain(
      'https://boleteame.dev/servicios-andinos/configuracion/certificados',
    );
    expect(correoCert?.claveIdempotencia).toBe('certificado.por_vencer/cert-1/15');

    // Una fila por documento, con el grupo del correo y el id de Resend.
    const grupo = correoRechazo?.claveIdempotencia;
    expect(e.fila('documento.rechazado:d1')).toMatchObject({
      estado: 'enviada',
      resendId: 'resend-2',
      grupo,
    });
    expect(e.fila('documento.rechazado:d2')).toMatchObject({ estado: 'enviada', grupo });
    expect(e.fila('envio.incierto:e9')).toMatchObject({ estado: 'enviada' });
    expect(e.fila('certificado.por_vencer:cert-1:15')).toMatchObject({
      estado: 'enviada',
      destinatarios: ['duena@empresa.cl', 'admin@empresa.cl'],
    });
  });

  it('un solo rechazo: el enlace general lleva también doc=<id>', async () => {
    const e = escenario({ rechazos: [rechazo('d7', { ambiente: 'produccion' })] });
    await ejecutarAlertas(e.deps());
    expect(e.enviados[0]?.asunto).toBe(
      'El SII rechazó la Boleta electrónica N.º 41 de Servicios Andinos SpA',
    );
    expect(e.enviados[0]?.texto).toContain(
      `documentos?empresa=${EMP}&ambiente=produccion&estado=rechazado&periodo=todos&doc=d7\n`,
    );
  });

  it('separa los rechazos por empresa y por ambiente (cada correo con su enlace), y por organización', async () => {
    const e = escenario({
      rechazos: [
        rechazo('d1'),
        rechazo('d2', { ambiente: 'produccion' }),
        rechazo('d3', { empresaId: EMP2 }),
        rechazo('d4'),
        rechazo('d5', { organizacionId: ORG2 }),
      ],
    });
    const r = await ejecutarAlertas(e.deps());
    expect(r.rechazos.enviados).toBe(5);
    expect(e.enviados.map((m) => [m.para, m.asunto])).toEqual([
      [
        ['duena@empresa.cl', 'admin@empresa.cl'],
        'El SII rechazó 2 documentos de Servicios Andinos',
      ],
      [
        ['duena@empresa.cl', 'admin@empresa.cl'],
        'El SII rechazó la Boleta electrónica N.º 41 de Servicios Andinos SpA',
      ],
      [
        ['duena@empresa.cl', 'admin@empresa.cl'],
        'El SII rechazó la Boleta electrónica N.º 41 de Andinos Norte Ltda.',
      ],
      [['otra@org.cl'], 'El SII rechazó la Boleta electrónica N.º 41 de Servicios Andinos SpA'],
    ]);
    expect(e.enviados[1]?.texto).toContain('ambiente=produccion');
    expect(e.enviados[2]?.texto).toContain(`empresa=${EMP2}`);
  });

  it('sin nada que avisar no reclama ni envía', async () => {
    const e = escenario();
    const r = await ejecutarAlertas(e.deps());
    expect(r.certificados.detectados).toBe(0);
    expect(e.reclamos).toEqual([]);
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('una organización sin propietarios ni administradores con correo no reclama nada', async () => {
    const e = escenario({ rechazos: [rechazo('d1')], destinatarios: { [ORG]: [] } });
    const r = await ejecutarAlertas(e.deps());
    expect(r.rechazos).toMatchObject({ detectados: 1, sinDestinatarios: 1, enviados: 0 });
    expect(e.reclamos).toEqual([]);
  });
});

describe('ejecutarAlertas: deduplicación', () => {
  it('una segunda corrida no reenvía: lo avisado ya no vuelve como candidato', async () => {
    const e = escenario({
      rechazos: [rechazo('d1')],
      inciertos: [incierto('e9')],
      certificados: [certificado(10)],
    });
    await ejecutarAlertas(e.deps());
    e.avanzar(10);
    const r = await ejecutarAlertas(e.deps());
    expect(e.correo.enviar).toHaveBeenCalledTimes(3);
    expect(r.correosEnviados).toBe(0);
    expect(r.rechazos.detectados).toBe(0);
    expect(r.inciertos.detectados).toBe(0);
    expect(r.certificados.detectados).toBe(0);
  });

  it('si otra corrida lo reclamó entre la lectura y el reclamo, cuenta como ya avisado', async () => {
    const e = escenario({ inciertos: [incierto('e9')] });
    await e.deps().repositorio.reclamar({
      organizacionId: ORG,
      tipo: 'envio.incierto',
      clave: 'envio.incierto:e9',
      referenciaId: 'e9',
      datos: {},
    });
    // El repositorio en memoria ya lo excluye; uno real podría devolverlo un instante antes.
    const deps = e.deps();
    deps.repositorio = { ...deps.repositorio, enviosInciertos: async () => [incierto('e9')] };
    const r = await ejecutarAlertas(deps);
    expect(r.inciertos).toMatchObject({ detectados: 1, yaAvisados: 1, enviados: 0 });
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('el certificado avisa una vez por umbral al cruzarlo (de 30 a 15 días)', async () => {
    const datos: Escenario = { certificados: [certificado(20)] };
    const e = escenario(datos);
    await ejecutarAlertas(e.deps());
    await ejecutarAlertas(e.deps());
    datos.certificados = [certificado(14)];
    await ejecutarAlertas(e.deps());
    expect(e.enviados.map((m) => m.claveIdempotencia)).toEqual([
      'certificado.por_vencer/cert-1/30',
      'certificado.por_vencer/cert-1/15',
    ]);
  });

  it('si falló el cierre después de enviar, no reenvía antes de 15 min; después reintenta con la misma Idempotency-Key', async () => {
    const e = escenario({ inciertos: [incierto('e9')] });
    e.fallas.add('cerrar');
    const r1 = await ejecutarAlertas(e.deps());
    expect(r1.inciertos).toMatchObject({ enviados: 1, error: true });
    expect(e.fila('envio.incierto:e9')?.estado).toBe('pendiente');
    e.fallas.delete('cerrar');

    e.avanzar(10);
    await ejecutarAlertas(e.deps());
    expect(e.enviados).toHaveLength(1);

    e.avanzar(MINUTOS_ABANDONADA);
    await ejecutarAlertas(e.deps());
    expect(e.enviados).toHaveLength(2);
    expect(e.enviados[1]?.claveIdempotencia).toBe(e.enviados[0]?.claveIdempotencia);
    expect(e.fila('envio.incierto:e9')).toMatchObject({ estado: 'enviada', intentos: 2 });
  });
});

describe('ejecutarAlertas: Idempotency-Key estable del correo agrupado', () => {
  it('un reintento reenvía el mismo grupo con la misma clave, sin mezclarlo con rechazos nuevos', async () => {
    const datos: Escenario = { rechazos: [rechazo('d1'), rechazo('d2', { folio: 42 })] };
    const e = escenario(datos);
    e.respuestas.push({ ok: false, motivo: 'red', detalle: 'Resend no respondió a tiempo.' });
    await ejecutarAlertas(e.deps());
    const grupo = e.enviados[0]?.claveIdempotencia;
    expect(e.fila('documento.rechazado:d1')).toMatchObject({ estado: 'fallida', grupo });
    expect(e.fila('documento.rechazado:d2')).toMatchObject({ estado: 'fallida', grupo });

    // Llega otro rechazo de la misma empresa y ambiente antes del reintento.
    datos.rechazos?.push(rechazo('d3', { folio: 43 }));
    e.avanzar(10);
    const r = await ejecutarAlertas(e.deps());
    expect(r.rechazos.enviados).toBe(3);
    expect(e.enviados).toHaveLength(3);
    const [, reintento, nuevo] = e.enviados;
    expect(reintento?.claveIdempotencia).toBe(grupo);
    expect(reintento?.asunto).toBe('El SII rechazó 2 documentos de Servicios Andinos');
    expect(reintento?.html).toBe(e.enviados[0]?.html);
    expect(nuevo?.claveIdempotencia).toBe(
      claveIdempotenciaRechazos(ORG, ['documento.rechazado:d3']),
    );
    expect(nuevo?.claveIdempotencia).not.toBe(grupo);
    expect(nuevo?.texto).toContain('N.º 43');
    expect(e.fila('documento.rechazado:d3')?.grupo).toBe(nuevo?.claveIdempotencia);
  });

  it('si no se puede guardar el grupo, no envía; a los 15 min lo reclama como nuevo y sale', async () => {
    const e = escenario({ rechazos: [rechazo('d1')] });
    e.fallas.add('fijarGrupo');
    const r1 = await ejecutarAlertas(e.deps());
    expect(r1.rechazos).toMatchObject({ enviados: 0, error: true });
    expect(e.correo.enviar).not.toHaveBeenCalled();
    expect(e.fila('documento.rechazado:d1')).toMatchObject({ estado: 'pendiente', grupo: null });
    e.fallas.delete('fijarGrupo');

    e.avanzar(MINUTOS_ABANDONADA + 1);
    const r2 = await ejecutarAlertas(e.deps());
    expect(r2.rechazos.enviados).toBe(1);
    expect(e.fila('documento.rechazado:d1')).toMatchObject({
      estado: 'enviada',
      grupo: e.enviados[0]?.claveIdempotencia,
    });
  });
});

describe('ejecutarAlertas: volumen por corrida', () => {
  it(`hasta ${MAX_CORREOS_POR_CORRIDA} correos con pausa entre uno y otro; el resto queda libre para la corrida siguiente`, async () => {
    const inciertos = Array.from({ length: 50 }, (_, i) => incierto(`e${i}`));
    const e = escenario({ inciertos, certificados: [certificado(3)] });
    const r1 = await ejecutarAlertas(e.deps());
    expect(r1.correosEnviados).toBe(MAX_CORREOS_POR_CORRIDA);
    expect(r1.limiteAlcanzado).toBe(true);
    expect(r1.inciertos).toMatchObject({ detectados: 50, enviados: 40, postergados: 10 });
    expect(r1.certificados).toMatchObject({ detectados: 1, enviados: 0, postergados: 1 });
    // Lo postergado no se reclamó (no queda pendiente 15 min).
    expect(e.reclamos).toHaveLength(40);
    expect(e.pausas).toHaveLength(MAX_CORREOS_POR_CORRIDA - 1);
    expect(new Set(e.pausas)).toEqual(new Set([PAUSA_ENTRE_CORREOS_MS]));

    e.avanzar(10);
    const r2 = await ejecutarAlertas(e.deps());
    expect(r2.correosEnviados).toBe(11);
    expect(r2.limiteAlcanzado).toBe(false);
    expect(e.enviados).toHaveLength(51);
  });

  it('deja de empezar correos pasado el presupuesto de tiempo', async () => {
    const e = escenario({ inciertos: Array.from({ length: 10 }, (_, i) => incierto(`e${i}`)) });
    e.lentitud(15_000);
    const r = await ejecutarAlertas(e.deps());
    // Se decide antes de la pausa: a los 0, 15 y 30 s hay cupo (el de los 30 sale a los
    // 45 s, tras su pausa); a los 45 s ya no se empieza otro.
    expect(r.correosEnviados).toBe(4);
    expect(r.limiteAlcanzado).toBe(true);
    expect(r.inciertos.postergados).toBe(6);
  });
});

describe('ejecutarAlertas: sin Resend, sin URL y fallas', () => {
  it('sin Resend configurado: detecta y lo informa, pero no reclama filas ni envía', async () => {
    const e = escenario({
      rechazos: [rechazo('d1')],
      inciertos: [incierto('e9')],
      certificados: [certificado(5)],
    });
    const r = await ejecutarAlertas(e.deps({ correoConfigurado: false }));
    expect(r.correo).toBe('sin_configurar');
    expect(r.rechazos.detectados).toBe(1);
    expect(r.inciertos.detectados).toBe(1);
    expect(r.certificados.detectados).toBe(1);
    expect(r.correosEnviados).toBe(0);
    expect(e.reclamos).toEqual([]);
    expect(e.correo.enviar).not.toHaveBeenCalled();

    // Cuando se configura, sale lo que siga en la ventana.
    const despues = await ejecutarAlertas(e.deps());
    expect(despues.correosEnviados).toBe(3);
  });

  it('sin NEXT_PUBLIC_APP_URL tampoco envía (los enlaces quedarían rotos)', async () => {
    const e = escenario({ rechazos: [rechazo('d1')] });
    const r = await ejecutarAlertas(e.deps({ urlApp: null }));
    expect(r.correo).toBe('sin_url');
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('si Resend falla, la fila queda fallida con el motivo y la corrida siguiente la reintenta hasta lograrlo', async () => {
    const e = escenario({ rechazos: [rechazo('d1')] });
    e.respuestas.push({
      ok: false,
      motivo: 'limite',
      detalle: 'rate_limit_exceeded: Too many requests',
      estado: 429,
    });
    const r1 = await ejecutarAlertas(e.deps());
    expect(r1.rechazos).toMatchObject({ enviados: 0, fallidos: 1 });
    expect(e.fila('documento.rechazado:d1')).toMatchObject({
      estado: 'fallida',
      intentos: 1,
      error: 'limite: rate_limit_exceeded: Too many requests',
    });

    e.avanzar(10);
    const r2 = await ejecutarAlertas(e.deps());
    expect(r2.rechazos.enviados).toBe(1);
    expect(e.fila('documento.rechazado:d1')).toMatchObject({
      estado: 'enviada',
      intentos: 2,
      error: null,
    });
    expect(e.enviados[1]?.claveIdempotencia).toBe(e.enviados[0]?.claveIdempotencia);
  });

  it('después de 5 intentos fallidos deja de reintentar (y de leerlo como candidato)', async () => {
    const e = escenario({ certificados: [certificado(3)] });
    for (let i = 0; i < 7; i++) {
      e.respuestas.push({
        ok: false,
        motivo: 'rechazado',
        detalle: 'validation_error: dominio sin verificar',
      });
      await ejecutarAlertas(e.deps());
      e.avanzar(10);
    }
    expect(e.correo.enviar).toHaveBeenCalledTimes(MAX_INTENTOS);
    expect(e.fila('certificado.por_vencer:cert-1:7')).toMatchObject({
      estado: 'fallida',
      intentos: MAX_INTENTOS,
    });
  });

  it('una excepción al enviar se trata como falla de red (fila fallida) y no corta la corrida', async () => {
    const e = escenario({ inciertos: [incierto('e1'), incierto('e2')] });
    e.correo.enviar.mockRejectedValueOnce(new Error('boom'));
    const r = await ejecutarAlertas(e.deps());
    expect(r.inciertos).toMatchObject({ detectados: 2, enviados: 1, fallidos: 1 });
    expect(e.fila('envio.incierto:e1')?.estado).toBe('fallida');
    expect(e.fila('envio.incierto:e2')?.estado).toBe('enviada');
  });

  it('una categoría que no se puede leer queda con error y las demás siguen', async () => {
    const e = escenario({ rechazos: [rechazo('d1')], certificados: [certificado(1)] });
    e.fallas.add('inciertos');
    const r = await ejecutarAlertas(e.deps());
    expect(r.inciertos.error).toBe(true);
    expect(r.rechazos.enviados).toBe(1);
    expect(r.certificados.enviados).toBe(1);
  });

  it('si no se pueden reclamar filas no envía nada (nunca un correo sin registrar)', async () => {
    const e = escenario({ rechazos: [rechazo('d1')], inciertos: [incierto('e9')] });
    e.fallas.add('reclamar');
    const r = await ejecutarAlertas(e.deps());
    expect(r.rechazos.error).toBe(true);
    expect(r.inciertos.error).toBe(true);
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });
});

describe('ningún secreto en correos, resumen, filas ni consola', () => {
  it('con el cliente real de Resend (fetch falso), la API key solo va en la cabecera', async () => {
    const CLAVE_RESEND = 're_clave_resend_de_prueba_0123456789';
    const CRON = 'secreto-del-cron-de-prueba-123456';
    const SUPABASE = 'sb_secret_clave_de_prueba_0123456789';
    vi.stubEnv('CRON_SECRET', CRON);
    vi.stubEnv('SUPABASE_SECRET_KEY', SUPABASE);
    vi.stubEnv('RESEND_API_KEY', CLAVE_RESEND);

    const cuerpos: string[] = [];
    const cabeceras: Record<string, string>[] = [];
    let llamada = 0;
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      cuerpos.push(String(init.body));
      cabeceras.push(init.headers as Record<string, string>);
      llamada += 1;
      return llamada === 2
        ? new Response(
            JSON.stringify({ name: 'internal_server_error', message: 'Falla temporal' }),
            { status: 500 },
          )
        : new Response(JSON.stringify({ id: `re-${llamada}` }), { status: 200 });
    }) as unknown as typeof fetch;

    const e = escenario({
      rechazos: [rechazo('d1')],
      inciertos: [incierto('e9')],
      certificados: [certificado(7)],
    });
    const base = e.deps();
    const deps = resolverDependenciasAlertas({
      repositorio: base.repositorio,
      correoConfigurado: true,
      urlApp: 'https://boleteame.dev',
      ahora: base.ahora,
      esperar: base.esperar,
      correo: {
        enviar: (m) =>
          enviarCorreo(m, {
            fetch: fetchFalso,
            configuracion: {
              RESEND_API_KEY: CLAVE_RESEND,
              CORREO_REMITENTE: 'Boletéame <no-responder@mail.boleteame.dev>',
            },
          }),
      },
    });
    const r = await ejecutarAlertas(deps);
    expect(r.correosEnviados).toBe(2);
    expect(r.rechazos.fallidos).toBe(1);

    expect(cabeceras.every((c) => c.Authorization === `Bearer ${CLAVE_RESEND}`)).toBe(true);
    const todo = [
      ...cuerpos,
      JSON.stringify(r),
      JSON.stringify([...e.notificaciones.values()]),
      JSON.stringify(avisos.mock.calls),
    ].join('\n');
    for (const secreto of [CLAVE_RESEND, CRON, SUPABASE]) expect(todo).not.toContain(secreto);
    expect(e.fila('documento.rechazado:d1')?.error).toBe(
      'red: internal_server_error: Falla temporal',
    );
  });

  it('los avisos de consola llevan solo el tipo y el código, nunca el mensaje del error', async () => {
    const e = escenario({ rechazos: [rechazo('d1')] });
    e.fallas.add('rechazos');
    await ejecutarAlertas(e.deps());
    const registrado = JSON.stringify(avisos.mock.calls);
    expect(registrado).toContain('no se pudo leer una categoría');
    expect(registrado).not.toContain('falla simulada');
  });
});
