import { describe, expect, it, vi } from 'vitest';
import { baseMemoria, type Fila } from './base-memoria.test-util';
import type {
  FacturaExterna,
  PagoExterno,
  Pasarela,
  RegistroTarjeta,
  SuscripcionExterna,
} from './pasarela';
import {
  activarDespuesDeRegistro,
  cambiarDePlan,
  cancelarSuscripcion,
  type DependenciasPagos,
  estadoDeExterna,
  iniciarContratacion,
  previsualizarCambio,
  procesarAvisoPago,
  sincronizarSuscripcion,
  sincronizarTodas,
} from './suscripciones';

// Dominio de suscripciones sin red ni base: `baseMemoria` (con `activar_suscripcion` de
// la 0016 simulada) y una pasarela falsa que guarda las suscripciones «de Flow» en un Map.

const AHORA = new Date('2026-11-17T15:00:00Z');
const ORG = 'org-andinos';
const ORG2 = 'org-sur';
const USUARIO = { id: 'usr-camila', correo: 'camila@andinos.cl' };
const URL_APP = 'https://app.boleteame.dev/';

const PLAN = {
  certificacion: 'plan-certificacion',
  pyme: 'plan-pyme',
  contador: 'plan-contador',
  empresa: 'plan-empresa',
  emprendedor: 'plan-emprendedor',
} as const;

function plan(
  codigo: keyof typeof PLAN,
  nombre: string,
  precio: number,
  maxEmpresas: number | null,
  maxUsuarios: number | null,
  activo = true,
  autoservicio = true,
): Fila {
  return {
    id: PLAN[codigo],
    codigo,
    nombre,
    precio_mensual_clp: precio,
    max_empresas: maxEmpresas,
    max_usuarios: maxUsuarios,
    max_boletas_mes: 1000,
    permite_produccion: codigo !== 'certificacion',
    incluye_api: false,
    incluye_webhooks: false,
    activo,
    autoservicio,
    orden: 0,
  };
}

function factura(extra: Partial<FacturaExterna> = {}): FacturaExterna {
  return {
    id: 'inv-1',
    monto: 14990,
    estado: 'pagado',
    periodoInicio: '2026-11-17',
    periodoFin: '2026-12-16',
    venceEn: '2026-11-24',
    pagadoEn: '2026-11-17T15:00:00.000Z',
    orden: '778899',
    medio: 'Webpay',
    enlacePago: null,
    intentos: 1,
    error: null,
    ...extra,
  };
}

function externa(extra: Partial<SuscripcionExterna> = {}): SuscripcionExterna {
  return {
    id: 'sus_1',
    planCodigo: 'pyme',
    clienteId: 'cus_1',
    estado: 'activa',
    morosidad: 'al_dia',
    periodoInicio: '2026-11-17T03:00:00.000Z',
    periodoFin: '2026-12-17T03:00:00.000Z',
    cancelarAlFinPeriodo: false,
    facturas: [],
    ...extra,
  };
}

const ok = <T>(datos: T) => ({ ok: true as const, datos });
const falla = (motivo: 'red' | 'rechazado' | 'sin_configuracion', detalle = 'falla simulada') => ({
  ok: false as const,
  motivo,
  detalle,
});

/** Pasarela falsa: «Flow» es un Map de suscripciones, registros de tarjeta y pagos. */
function pasarelaFalsa() {
  const flow = {
    suscripciones: new Map<string, SuscripcionExterna>(),
    registros: new Map<string, RegistroTarjeta>(),
    pagos: new Map<string, PagoExterno>(),
    clientes: 0,
    creadas: 0,
    /** Importes que trae una suscripción recién creada. */
    facturasAlCrear: [factura()],
    /** `true`: subscription/get ya informa el plan nuevo tras changePlan. */
    cambioInmediato: true,
  };
  const pasarela = {
    proveedor: 'flow' as const,
    asegurarPlan: vi.fn<Pasarela['asegurarPlan']>(async () => ok(undefined)),
    crearCliente: vi.fn<Pasarela['crearCliente']>(async () => ok({ id: `cus_${++flow.clientes}` })),
    iniciarRegistroTarjeta: vi.fn<Pasarela['iniciarRegistroTarjeta']>(async (clienteId) =>
      ok({ url: `https://sandbox.flow.cl/app/customer/disclaimer.php?token=reg-${clienteId}` }),
    ),
    estadoRegistroTarjeta: vi.fn<Pasarela['estadoRegistroTarjeta']>(async (token) => {
      const r = flow.registros.get(token);
      return r ? ok(r) : falla('rechazado', 'customer/getRegisterStatus: token desconocido');
    }),
    crearSuscripcion: vi.fn<Pasarela['crearSuscripcion']>(async (clienteId, planCodigo) => {
      const s = externa({
        id: `sus_${++flow.creadas}`,
        clienteId,
        planCodigo,
        facturas: flow.facturasAlCrear,
      });
      flow.suscripciones.set(s.id, s);
      return ok(structuredClone(s));
    }),
    obtenerSuscripcion: vi.fn<Pasarela['obtenerSuscripcion']>(async (id) => {
      const s = flow.suscripciones.get(id);
      return s ? ok(structuredClone(s)) : falla('rechazado', 'subscription/get: no existe');
    }),
    previsualizarCambioPlan: vi.fn<Pasarela['previsualizarCambioPlan']>(async () =>
      ok({ saldo: -3500, proximoCobro: '2026-12-17' }),
    ),
    cambiarPlan: vi.fn<Pasarela['cambiarPlan']>(async (id, planCodigo) => {
      const s = flow.suscripciones.get(id);
      if (!s) return falla('rechazado');
      if (flow.cambioInmediato) s.planCodigo = planCodigo;
      return ok({ saldo: 0, proximoCobro: '2026-12-17' });
    }),
    cancelarSuscripcion: vi.fn<Pasarela['cancelarSuscripcion']>(async (id, alFin) => {
      const s = flow.suscripciones.get(id);
      if (!s) return falla('rechazado');
      if (alFin) s.cancelarAlFinPeriodo = true;
      else s.estado = 'cancelada';
      return ok(structuredClone(s));
    }),
    pagoDeAviso: vi.fn<Pasarela['pagoDeAviso']>(async (token) => {
      const p = flow.pagos.get(token);
      return p ? ok(p) : falla('rechazado', 'payment/getStatus: token desconocido');
    }),
  } satisfies Pasarela;
  return { pasarela, flow };
}

function escenario(opciones: { empresas?: number; miembros?: number } = {}) {
  const base = baseMemoria({
    organizaciones: [
      { id: ORG, slug: 'andinos', nombre: 'Andinos SpA' },
      { id: ORG2, slug: 'sur', nombre: 'Sur Ltda' },
    ],
    planes: [
      plan('certificacion', 'Certificación', 0, 1, 2, true, false),
      plan('pyme', 'Pyme', 14990, 1, 3),
      plan('contador', 'Contador', 49990, 15, 10),
      plan('empresa', 'Empresa', 0, null, null, true, false),
      plan('emprendedor', 'Emprendedor', 9990, 1, 2, false, false),
    ],
    suscripciones: [ORG, ORG2].map((org) => ({
      id: `cert-${org}`,
      organizacion_id: org,
      plan_id: PLAN.certificacion,
      estado: 'prueba',
      periodo_inicio: '2026-10-01T03:00:00.000Z',
      periodo_fin: null,
      proveedor_pago: null,
      id_externo: null,
      cancelar_al_fin_periodo: false,
      sincronizada_en: null,
    })),
    empresas: Array.from({ length: opciones.empresas ?? 1 }, (_, i) => ({
      id: `emp-${i}`,
      organizacion_id: ORG,
    })),
    miembros_organizacion: Array.from({ length: opciones.miembros ?? 1 }, (_, i) => ({
      usuario_id: `usr-${i}`,
      organizacion_id: ORG,
    })),
    uso_mensual: [],
  });
  const { pasarela, flow } = pasarelaFalsa();
  const deps: DependenciasPagos = {
    db: base.cliente,
    pasarela,
    urlApp: URL_APP,
    ahora: () => AHORA,
  };
  const suscripciones = () => base.tablas.suscripciones ?? [];
  const vigente = (org = ORG) =>
    suscripciones().find(
      (s) => s.organizacion_id === org && ['prueba', 'activa', 'morosa'].includes(String(s.estado)),
    );
  const eventos = () => base.tablas.eventos_pasarela ?? [];
  const clientePago = (org = ORG) =>
    (base.tablas.clientes_pago ?? []).find((c) => c.organizacion_id === org);

  /** Deja a `org` suscrita en Flow (como la dejaría `activar_suscripcion`). */
  function suscribirEnFlow(
    org: string,
    idExterno: string,
    codigo: 'pyme' | 'contador' = 'pyme',
    estado: 'activa' | 'morosa' = 'activa',
    extra: Partial<SuscripcionExterna> = {},
  ): Fila {
    const anterior = vigente(org);
    if (anterior) anterior.estado = 'cancelada';
    const fila: Fila = {
      id: `fila-${idExterno}`,
      organizacion_id: org,
      plan_id: PLAN[codigo],
      estado,
      periodo_inicio: '2026-11-10T03:00:00.000Z',
      periodo_fin: '2026-12-10T03:00:00.000Z',
      proveedor_pago: 'flow',
      id_externo: idExterno,
      cancelar_al_fin_periodo: false,
      sincronizada_en: null,
    };
    suscripciones().push(fila);
    flow.suscripciones.set(
      idExterno,
      externa({ id: idExterno, planCodigo: codigo, clienteId: `cus-${org}`, ...extra }),
    );
    return fila;
  }

  return {
    base,
    pasarela,
    flow,
    deps,
    suscripciones,
    vigente,
    eventos,
    clientePago,
    suscribirEnFlow,
  };
}

type FilaSincronizable = Parameters<typeof sincronizarSuscripcion>[1];

/** La fila como la leería el código de la base: una copia, no la fila guardada. */
function copiaFila(fila: Fila, cambios: Partial<FilaSincronizable> = {}): FilaSincronizable {
  return { ...structuredClone(fila), ...cambios } as FilaSincronizable;
}

const ENTRADA = (planCodigo: string) => ({
  organizacion: { id: ORG, nombre: 'Andinos SpA' },
  usuario: USUARIO,
  planCodigo,
});

// --------------------------------------------------------------------------------

describe('estadoDeExterna', () => {
  it('cancelada, morosa solo con importes vencidos (morose 1), si no activa', () => {
    expect(estadoDeExterna(externa({ estado: 'cancelada', morosidad: 'vencida' }))).toBe(
      'cancelada',
    );
    expect(estadoDeExterna(externa({ morosidad: 'vencida' }))).toBe('morosa');
    expect(estadoDeExterna(externa({ morosidad: 'pendiente' }))).toBe('activa');
    expect(estadoDeExterna(externa())).toBe('activa');
  });
});

describe('iniciarContratacion', () => {
  it.each(['no-existe', 'empresa', 'emprendedor', 'certificacion'])(
    'plan %s (inexistente, no autoservicio o inactivo): plan_invalido',
    async (codigo) => {
      const { deps, pasarela } = escenario();
      expect(await iniciarContratacion(deps, ENTRADA(codigo))).toEqual({
        ok: false,
        codigo: 'plan_invalido',
      });
      expect(pasarela.asegurarPlan).not.toHaveBeenCalled();
    },
  );

  it('no cabe (más empresas o usuarios que el plan): no_cabe con el motivo, sin tocar Flow', async () => {
    const { deps, pasarela } = escenario({ empresas: 2, miembros: 4 });
    const r = await iniciarContratacion(deps, ENTRADA('pyme'));
    expect(r).toMatchObject({ ok: false, codigo: 'no_cabe' });
    if (r.ok) return;
    expect(r.detalle).toContain('permite 1 empresa y tienes 2');
    expect(r.detalle).toContain('permite 3 usuarios y tienes 4');
    expect(pasarela.crearCliente).not.toHaveBeenCalled();
  });

  it('crea el cliente de Flow una sola vez, anota el plan pendiente y devuelve la URL', async () => {
    const { deps, pasarela, clientePago, base } = escenario();
    const r = await iniciarContratacion(deps, ENTRADA('pyme'));
    expect(r).toEqual({
      ok: true,
      tipo: 'redirigir',
      url: 'https://sandbox.flow.cl/app/customer/disclaimer.php?token=reg-cus_1',
    });
    expect(pasarela.asegurarPlan).toHaveBeenCalledWith({
      codigo: 'pyme',
      nombre: 'Pyme',
      precioMensualClp: 14990,
    });
    expect(pasarela.crearCliente).toHaveBeenCalledWith({
      nombre: 'Andinos SpA',
      correo: USUARIO.correo,
      idInterno: ORG,
    });
    expect(pasarela.iniciarRegistroTarjeta).toHaveBeenCalledWith(
      'cus_1',
      'https://app.boleteame.dev/api/pagos/flow/registro',
    );
    expect(clientePago()).toMatchObject({
      proveedor: 'flow',
      cliente_externo: 'cus_1',
      plan_pendiente_id: PLAN.pyme,
      plan_pendiente_por: USUARIO.id,
    });

    // Segunda vez (cambió de idea antes de registrar la tarjeta): reusa el cliente.
    const r2 = await iniciarContratacion(deps, ENTRADA('contador'));
    expect(r2).toMatchObject({ ok: true, tipo: 'redirigir' });
    expect(pasarela.crearCliente).toHaveBeenCalledTimes(1);
    expect(base.tablas.clientes_pago).toHaveLength(1);
    expect(clientePago()?.plan_pendiente_id).toBe(PLAN.contador);
  });

  it('con suscripción de Flow vigente: cambio (otro plan) o ya_en_plan (el mismo)', async () => {
    const { deps, pasarela, suscribirEnFlow } = escenario();
    suscribirEnFlow(ORG, 'sus_9', 'pyme');
    expect(await iniciarContratacion(deps, ENTRADA('contador'))).toEqual({
      ok: true,
      tipo: 'cambio',
    });
    expect(await iniciarContratacion(deps, ENTRADA('pyme'))).toEqual({
      ok: false,
      codigo: 'ya_en_plan',
    });
    expect(pasarela.asegurarPlan).not.toHaveBeenCalled();
    expect(pasarela.crearCliente).not.toHaveBeenCalled();
  });

  it('fallas de la pasarela: sin_configuracion, pasarela_red y pasarela', async () => {
    const { deps, pasarela, clientePago } = escenario();
    pasarela.asegurarPlan.mockResolvedValueOnce(falla('sin_configuracion'));
    expect(await iniciarContratacion(deps, ENTRADA('pyme'))).toEqual({
      ok: false,
      codigo: 'sin_configuracion',
    });
    pasarela.crearCliente.mockResolvedValueOnce(falla('red', 'customer/create: caído'));
    expect(await iniciarContratacion(deps, ENTRADA('pyme'))).toEqual({
      ok: false,
      codigo: 'pasarela_red',
      detalle: 'customer/create: caído',
    });
    expect(clientePago()).toBeUndefined();
    pasarela.iniciarRegistroTarjeta.mockResolvedValueOnce(falla('rechazado'));
    expect(await iniciarContratacion(deps, ENTRADA('pyme'))).toMatchObject({
      ok: false,
      codigo: 'pasarela',
    });
  });

  it('falla de la base al guardar el cliente: base', async () => {
    const { deps, base } = escenario();
    base.fallas.set('clientes_pago:insert', { message: 'sin permiso' });
    expect(await iniciarContratacion(deps, ENTRADA('pyme'))).toEqual({
      ok: false,
      codigo: 'base',
      detalle: 'sin permiso',
    });
  });
});

// --------------------------------------------------------------------------------

describe('activarDespuesDeRegistro', () => {
  const TOKEN = 'tok-registro-1';

  /** Escenario con la contratación ya iniciada (cliente cus_1 con plan pendiente). */
  async function conContratacion(registrada = true) {
    const e = escenario();
    await iniciarContratacion(e.deps, ENTRADA('pyme'));
    e.flow.registros.set(TOKEN, {
      registrada,
      clienteId: 'cus_1',
      marca: 'Visa',
      ultimos4: '4242',
    });
    return e;
  }

  it('feliz: crea la suscripción, la activa, guarda los pagos y limpia el plan pendiente', async () => {
    const e = await conContratacion();
    const alertar = vi.fn();
    const r = await activarDespuesDeRegistro(e.deps, TOKEN, alertar);
    expect(r).toEqual({ slug: 'andinos', resultado: 'suscrita' });

    expect(e.pasarela.crearSuscripcion).toHaveBeenCalledWith('cus_1', 'pyme');
    expect(e.base.rpcs).toEqual([
      {
        nombre: 'activar_suscripcion',
        args: {
          p_organizacion: ORG,
          p_plan: PLAN.pyme,
          p_estado: 'activa',
          p_proveedor: 'flow',
          p_id_externo: 'sus_1',
          p_periodo_inicio: '2026-11-17T03:00:00.000Z',
          p_periodo_fin: '2026-12-17T03:00:00.000Z',
        },
      },
    ]);
    // La de certificación quedó cancelada y la de Flow vigente (una sola vigente).
    expect(e.suscripciones().find((s) => s.id === `cert-${ORG}`)?.estado).toBe('cancelada');
    const vigente = e.vigente();
    expect(vigente).toMatchObject({
      plan_id: PLAN.pyme,
      estado: 'activa',
      proveedor_pago: 'flow',
      id_externo: 'sus_1',
    });
    expect(e.base.tablas.pagos).toEqual([
      expect.objectContaining({
        organizacion_id: ORG,
        suscripcion_id: vigente?.id,
        proveedor: 'flow',
        factura_externa: 'inv-1',
        monto_clp: 14990,
        estado: 'pagado',
      }),
    ]);
    expect(e.clientePago()).toMatchObject({
      plan_pendiente_id: null,
      plan_pendiente_por: null,
      plan_pendiente_en: null,
      tarjeta_marca: 'Visa',
      tarjeta_ultimos4: '4242',
    });
    expect(e.eventos()).toEqual([
      expect.objectContaining({
        tipo: 'registro',
        token: TOKEN,
        estado: 'procesado',
        organizacion_id: ORG,
        datos: { suscripcion_externa: 'sus_1', resultado: 'suscrita', plan: 'pyme' },
      }),
    ]);
    expect(alertar).not.toHaveBeenCalled();
  });

  it('suscripción creada con importes vencidos: queda morosa', async () => {
    const e = await conContratacion();
    e.flow.facturasAlCrear = [factura({ estado: 'vencido', pagadoEn: null })];
    e.pasarela.crearSuscripcion.mockImplementationOnce(async (clienteId, planCodigo) =>
      ok(
        externa({ clienteId, planCodigo, morosidad: 'vencida', facturas: e.flow.facturasAlCrear }),
      ),
    );
    expect((await activarDespuesDeRegistro(e.deps, TOKEN)).resultado).toBe('suscrita');
    expect(e.vigente()?.estado).toBe('morosa');
  });

  it('tarjeta no registrada: tarjeta_rechazada, sin crear suscripción ni tocar el plan', async () => {
    const e = await conContratacion(false);
    expect(await activarDespuesDeRegistro(e.deps, TOKEN)).toEqual({
      slug: 'andinos',
      resultado: 'tarjeta_rechazada',
    });
    expect(e.pasarela.crearSuscripcion).not.toHaveBeenCalled();
    expect(e.base.rpcs).toHaveLength(0);
    expect(e.vigente()?.plan_id).toBe(PLAN.certificacion);
    expect(e.clientePago()?.plan_pendiente_id).toBe(PLAN.pyme);
    expect(e.eventos()[0]).toMatchObject({
      estado: 'procesado',
      datos: { resultado: 'tarjeta_rechazada' },
    });
    // Repetido: el mismo resultado.
    expect((await activarDespuesDeRegistro(e.deps, TOKEN)).resultado).toBe('tarjeta_rechazada');
  });

  it('cliente de Flow desconocido: error sin slug y evento ignorado', async () => {
    const e = await conContratacion();
    e.flow.registros.set('tok-otro', {
      registrada: true,
      clienteId: 'cus_ajeno',
      marca: null,
      ultimos4: null,
    });
    expect(await activarDespuesDeRegistro(e.deps, 'tok-otro')).toEqual({
      slug: null,
      resultado: 'error',
    });
    expect(e.pasarela.crearSuscripcion).not.toHaveBeenCalled();
    expect(e.eventos()[0]).toMatchObject({
      estado: 'ignorado',
      error: 'Cliente de Flow desconocido',
    });
  });

  it('Flow no confirma el token: error y evento fallido', async () => {
    const e = await conContratacion();
    expect(await activarDespuesDeRegistro(e.deps, 'tok-desconocido')).toEqual({
      slug: null,
      resultado: 'error',
    });
    expect(e.eventos()[0]).toMatchObject({ estado: 'fallido' });
  });

  it('token repetido después de procesado: mismo resultado sin volver a crear', async () => {
    const e = await conContratacion();
    const primero = await activarDespuesDeRegistro(e.deps, TOKEN);
    const segundo = await activarDespuesDeRegistro(e.deps, TOKEN);
    expect(segundo).toEqual(primero);
    expect(e.pasarela.crearSuscripcion).toHaveBeenCalledTimes(1);
    expect(e.pasarela.estadoRegistroTarjeta).toHaveBeenCalledTimes(1);
    expect(e.base.rpcs).toHaveLength(1);
    expect(e.eventos()).toHaveLength(1);
  });

  it('token en curso (otro retorno lo está procesando): en_proceso', async () => {
    const e = await conContratacion();
    e.base.tablas.eventos_pasarela = [
      {
        id: 'ev-1',
        proveedor: 'flow',
        tipo: 'registro',
        token: TOKEN,
        estado: 'recibido',
        intentos: 1,
        datos: {},
        organizacion_id: ORG,
        recibido_en: new Date().toISOString(),
      },
    ];
    expect(await activarDespuesDeRegistro(e.deps, TOKEN)).toEqual({
      slug: 'andinos',
      resultado: 'en_proceso',
    });
    expect(e.pasarela.estadoRegistroTarjeta).not.toHaveBeenCalled();
  });

  it('reintento de un evento fallido que ya creó la suscripción: la obtiene, no crea otra', async () => {
    const e = await conContratacion();
    e.flow.suscripciones.set('sus_77', externa({ id: 'sus_77' }));
    e.base.tablas.eventos_pasarela = [
      {
        id: 'ev-1',
        proveedor: 'flow',
        tipo: 'registro',
        token: TOKEN,
        estado: 'fallido',
        intentos: 1,
        datos: { suscripcion_externa: 'sus_77' },
        organizacion_id: ORG,
        error: 'activar_suscripcion: timeout',
        recibido_en: '2026-11-17T14:00:00.000Z',
      },
    ];
    const r = await activarDespuesDeRegistro(e.deps, TOKEN);
    expect(r).toEqual({ slug: 'andinos', resultado: 'suscrita' });
    expect(e.pasarela.crearSuscripcion).not.toHaveBeenCalled();
    expect(e.pasarela.obtenerSuscripcion).toHaveBeenCalledWith('sus_77');
    expect(e.vigente()).toMatchObject({ id_externo: 'sus_77', estado: 'activa' });
    expect(e.eventos()[0]).toMatchObject({ estado: 'procesado', intentos: 2 });
  });

  it('falla la RPC: error, alerta y evento fallido que conserva la suscripción externa (el reintento no cobra dos veces)', async () => {
    const e = await conContratacion();
    e.base.fallas.set('rpc:activar_suscripcion', { message: 'deadlock detected', code: '40P01' });
    const alertar = vi.fn();
    expect(await activarDespuesDeRegistro(e.deps, TOKEN, alertar)).toEqual({
      slug: 'andinos',
      resultado: 'error',
    });
    expect(alertar).toHaveBeenCalledWith(
      'pagos: suscripción creada en Flow sin activar en la base',
      { suscripcion_externa: 'sus_1', organizacion: ORG },
    );
    expect(e.eventos()[0]).toMatchObject({
      estado: 'fallido',
      datos: { suscripcion_externa: 'sus_1' },
    });
    expect(String(e.eventos()[0]?.error)).toContain('deadlock detected');
    expect(e.vigente()?.plan_id).toBe(PLAN.certificacion);
    expect(e.clientePago()?.plan_pendiente_id).toBe(PLAN.pyme);

    // Flow vuelve a mandar el retorno (o la persona recarga): reusa sus_1.
    e.base.fallas.delete('rpc:activar_suscripcion');
    expect((await activarDespuesDeRegistro(e.deps, TOKEN, alertar)).resultado).toBe('suscrita');
    expect(e.pasarela.crearSuscripcion).toHaveBeenCalledTimes(1);
    expect(e.vigente()?.id_externo).toBe('sus_1');
  });

  it('sin plan pendiente: solo actualiza la tarjeta', async () => {
    const e = await conContratacion();
    const cliente = e.clientePago();
    if (cliente) cliente.plan_pendiente_id = null;
    expect(await activarDespuesDeRegistro(e.deps, TOKEN)).toEqual({
      slug: 'andinos',
      resultado: 'tarjeta_actualizada',
    });
    expect(e.pasarela.crearSuscripcion).not.toHaveBeenCalled();
    expect(e.clientePago()?.tarjeta_ultimos4).toBe('4242');
  });

  it('ya suscrita en Flow con otro plan pendiente: cambia de plan sin crear otra suscripción', async () => {
    const e = await conContratacion();
    e.suscribirEnFlow(ORG, 'sus_50', 'contador');
    expect(await activarDespuesDeRegistro(e.deps, TOKEN)).toEqual({
      slug: 'andinos',
      resultado: 'plan_cambiado',
    });
    expect(e.pasarela.crearSuscripcion).not.toHaveBeenCalled();
    expect(e.pasarela.cambiarPlan).toHaveBeenCalledWith('sus_50', 'pyme');
    expect(e.vigente()).toMatchObject({ id_externo: 'sus_50', plan_id: PLAN.pyme });
  });
});

// --------------------------------------------------------------------------------

describe('sincronizarSuscripcion', () => {
  it('morose 1: morosa, guarda los importes y devuelve el vencido más antiguo', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', {
      morosidad: 'vencida',
      facturas: [
        factura({ id: 'inv-3', estado: 'pagado' }),
        factura({ id: 'inv-2', estado: 'vencido', venceEn: '2026-11-10', pagadoEn: null }),
        factura({ id: 'inv-1', estado: 'vencido', venceEn: '2026-10-10', pagadoEn: null }),
      ],
    });
    const r = await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(r).toMatchObject({
      ok: true,
      organizacionId: ORG,
      suscripcionId: fila.id,
      estadoAnterior: 'activa',
      estadoNuevo: 'morosa',
      vencido: { id: 'inv-1' },
    });
    expect(e.vigente()).toMatchObject({
      estado: 'morosa',
      sincronizada_en: AHORA.toISOString(),
    });
    expect(
      e.base.tablas.pagos?.map((p) => [p.factura_externa, p.estado, p.suscripcion_id]),
    ).toEqual([
      ['inv-3', 'pagado', fila.id],
      ['inv-2', 'vencido', fila.id],
      ['inv-1', 'vencido', fila.id],
    ]);

    // Segunda sincronización: upsert por (proveedor, factura_externa), sin duplicar.
    await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(e.base.tablas.pagos).toHaveLength(3);
  });

  it('vuelve a activa cuando Flow la informa al día', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'morosa');
    const r = await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(r).toMatchObject({
      ok: true,
      estadoAnterior: 'morosa',
      estadoNuevo: 'activa',
      vencido: null,
    });
    expect(e.vigente()?.estado).toBe('activa');
  });

  it('cambia plan_id según el planId de Flow; un plan ajeno lo deja igual', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', { planCodigo: 'contador' });
    await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(e.vigente()?.plan_id).toBe(PLAN.contador);

    const flowSus = e.flow.suscripciones.get('sus_1');
    if (flowSus) flowSus.planCodigo = 'plan-de-otro-sistema';
    await sincronizarSuscripcion(e.deps, copiaFila(fila, { plan_id: PLAN.contador }));
    expect(e.vigente()?.plan_id).toBe(PLAN.contador);
  });

  it('copia el período y cancelar_al_fin_periodo; sin inicio informado conserva el anterior', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', {
      periodoInicio: null,
      periodoFin: '2027-01-10T03:00:00.000Z',
      cancelarAlFinPeriodo: true,
    });
    await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(e.vigente()).toMatchObject({
      periodo_inicio: '2026-11-10T03:00:00.000Z',
      periodo_fin: '2027-01-10T03:00:00.000Z',
      cancelar_al_fin_periodo: true,
    });
  });

  it('cancelada en Flow: vuelve al plan certificación con activar_suscripcion (prueba)', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', { estado: 'cancelada' });
    const r = await sincronizarSuscripcion(e.deps, copiaFila(fila));
    expect(r).toMatchObject({ ok: true, estadoAnterior: 'activa', estadoNuevo: 'cancelada' });
    expect(e.base.rpcs).toEqual([
      {
        nombre: 'activar_suscripcion',
        args: { p_organizacion: ORG, p_plan: PLAN.certificacion, p_estado: 'prueba' },
      },
    ]);
    expect(e.suscripciones().find((s) => s.id === fila.id)?.estado).toBe('cancelada');
    expect(e.vigente()).toMatchObject({
      plan_id: PLAN.certificacion,
      estado: 'prueba',
      id_externo: null,
    });

    // Ya cancelada en la base: no vuelve a llamar a la RPC.
    await sincronizarSuscripcion(e.deps, copiaFila(fila, { estado: 'cancelada' }));
    expect(e.base.rpcs).toHaveLength(1);
  });

  it('error de la pasarela o sin id externo: ok false sin tocar la base', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1');
    e.pasarela.obtenerSuscripcion.mockResolvedValueOnce(falla('red', 'subscription/get: caído'));
    expect(await sincronizarSuscripcion(e.deps, copiaFila(fila))).toEqual({
      ok: false,
      organizacionId: ORG,
      suscripcionId: fila.id,
      detalle: 'subscription/get: caído',
    });
    expect(e.vigente()?.sincronizada_en).toBeNull();
    expect(
      await sincronizarSuscripcion(e.deps, copiaFila(fila, { id_externo: null })),
    ).toMatchObject({ ok: false, detalle: 'Sin suscripción externa' });
  });

  it('falla de la base al guardar los pagos: ok false con el detalle', async () => {
    const e = escenario();
    const fila = e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', { facturas: [factura()] });
    e.base.fallas.set('pagos:upsert', { message: 'check violation' });
    expect(await sincronizarSuscripcion(e.deps, copiaFila(fila))).toMatchObject({
      ok: false,
      detalle: expect.stringContaining('check violation'),
    });
  });
});

describe('sincronizarTodas', () => {
  it('solo las de Flow activas o morosas, las menos recientes primero, con límite', async () => {
    const e = escenario();
    const a = e.suscribirEnFlow(ORG, 'sus_a', 'pyme', 'activa', { morosidad: 'vencida' });
    const b = e.suscribirEnFlow(ORG2, 'sus_b');
    a.sincronizada_en = '2026-11-17T10:00:00.000Z';
    b.sincronizada_en = null;
    const resumen = await sincronizarTodas(e.deps);
    expect(resumen).toMatchObject({
      revisadas: 2,
      cambiadas: 1,
      morosas: 1,
      canceladas: 0,
      errores: 0,
    });
    expect(e.pasarela.obtenerSuscripcion.mock.calls.map((c) => c[0])).toEqual(['sus_b', 'sus_a']);

    e.pasarela.obtenerSuscripcion.mockClear();
    const una = await sincronizarTodas(e.deps, { limite: 1 });
    expect(una.revisadas).toBe(1);
  });
});

// --------------------------------------------------------------------------------

describe('cambiarDePlan y previsualizarCambio', () => {
  it('sin suscripción de Flow: sin_suscripcion', async () => {
    const e = escenario();
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toEqual({
      ok: false,
      codigo: 'sin_suscripcion',
    });
    expect(await previsualizarCambio(e.deps, ORG, 'contador')).toEqual({
      ok: false,
      codigo: 'sin_suscripcion',
    });
  });

  it('plan inválido, mismo plan y no cabe', async () => {
    const e = escenario({ empresas: 2 });
    e.suscribirEnFlow(ORG, 'sus_1', 'contador');
    expect(await cambiarDePlan(e.deps, ORG, 'empresa')).toMatchObject({ codigo: 'plan_invalido' });
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toMatchObject({ codigo: 'ya_en_plan' });
    expect(await cambiarDePlan(e.deps, ORG, 'pyme')).toMatchObject({ codigo: 'no_cabe' });
    expect(e.pasarela.cambiarPlan).not.toHaveBeenCalled();
  });

  it('Flow ya informa el plan nuevo: aplicado true', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toEqual({
      ok: true,
      plan: 'Contador',
      aplicado: true,
      desde: '2026-12-17',
      sincronizado: true,
    });
    expect(e.pasarela.cambiarPlan).toHaveBeenCalledWith('sus_1', 'contador');
    expect(e.vigente()?.plan_id).toBe(PLAN.contador);
  });

  it('Flow todavía informa el plan anterior: aplicado false', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    e.flow.cambioInmediato = false;
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toEqual({
      ok: true,
      plan: 'Contador',
      aplicado: false,
      desde: '2026-12-17',
      sincronizado: true,
    });
    expect(e.vigente()?.plan_id).toBe(PLAN.pyme);
  });

  it('falla al cambiar en Flow: pasarela, sin tocar la base', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    e.pasarela.cambiarPlan.mockResolvedValueOnce(falla('rechazado', 'changePlan: no'));
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toEqual({
      ok: false,
      codigo: 'pasarela',
      detalle: 'changePlan: no',
    });
    expect(e.vigente()?.plan_id).toBe(PLAN.pyme);
  });

  // Si Flow ya hizo el cambio y solo falla la lectura posterior, no es una falla: un
  // reintento llamaría otra vez a `subscription/changePlan` (posible segundo cargo).
  it('el cambio ya hecho en Flow no se informa como falla si solo falla la sincronización', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    e.pasarela.obtenerSuscripcion.mockResolvedValueOnce(falla('red', 'subscription/get: caído'));
    expect(await cambiarDePlan(e.deps, ORG, 'contador')).toMatchObject({
      ok: true,
      aplicado: false,
      sincronizado: false,
    });
  });

  it('previsualizar: saldo y próximo cobro de Flow', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    expect(await previsualizarCambio(e.deps, ORG, 'contador')).toEqual({
      ok: true,
      plan: { codigo: 'contador', nombre: 'Contador', precio: 49990 },
      saldo: -3500,
      proximoCobro: '2026-12-17',
    });
    expect(e.pasarela.cambiarPlan).not.toHaveBeenCalled();
  });
});

describe('cancelarSuscripcion', () => {
  it('cancela al fin del período: cancelar_al_fin_periodo true y devuelve hasta', async () => {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    expect(await cancelarSuscripcion(e.deps, ORG)).toEqual({
      ok: true,
      hasta: '2026-12-17T03:00:00.000Z',
    });
    expect(e.pasarela.cancelarSuscripcion).toHaveBeenCalledWith('sus_1', true);
    expect(e.vigente()).toMatchObject({
      estado: 'activa',
      plan_id: PLAN.pyme,
      cancelar_al_fin_periodo: true,
    });
  });

  it('sin suscripción: sin_suscripcion; falla de Flow: pasarela_red', async () => {
    const e = escenario();
    expect(await cancelarSuscripcion(e.deps, ORG)).toEqual({
      ok: false,
      codigo: 'sin_suscripcion',
    });
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme');
    e.pasarela.cancelarSuscripcion.mockResolvedValueOnce(falla('red'));
    expect(await cancelarSuscripcion(e.deps, ORG)).toMatchObject({
      ok: false,
      codigo: 'pasarela_red',
    });
    expect(e.vigente()?.cancelar_al_fin_periodo).toBe(false);
  });
});

// --------------------------------------------------------------------------------

describe('procesarAvisoPago', () => {
  function conDosSuscripciones() {
    const e = escenario();
    e.suscribirEnFlow(ORG, 'sus_1', 'pyme', 'activa', { morosidad: 'vencida' });
    e.suscribirEnFlow(ORG2, 'sus_2', 'pyme');
    return e;
  }

  it('con suscripción asociada: sincroniza solo esa y cierra el evento procesado', async () => {
    const e = conDosSuscripciones();
    e.flow.pagos.set('tok-pago', {
      estado: 'rechazado',
      orden: '778899',
      ordenComercio: '98765',
      suscripcionId: 'sus_1',
    });
    const r = await procesarAvisoPago(e.deps, 'tok-pago');
    expect(r.estado).toBe('procesado');
    expect(r.sincronizadas).toHaveLength(1);
    expect(r.sincronizadas[0]).toMatchObject({
      ok: true,
      organizacionId: ORG,
      estadoNuevo: 'morosa',
    });
    expect(e.pasarela.obtenerSuscripcion.mock.calls).toEqual([['sus_1']]);
    expect(e.eventos()[0]).toMatchObject({
      tipo: 'pago',
      estado: 'procesado',
      organizacion_id: ORG,
      datos: { estado_pago: 'rechazado', orden: '778899', suscripcion_externa: 'sus_1' },
    });
  });

  it('repetido: no vuelve a consultar Flow', async () => {
    const e = conDosSuscripciones();
    e.flow.pagos.set('tok-pago', {
      estado: 'pagado',
      orden: '1',
      ordenComercio: '2',
      suscripcionId: 'sus_1',
    });
    await procesarAvisoPago(e.deps, 'tok-pago');
    expect(await procesarAvisoPago(e.deps, 'tok-pago')).toEqual({
      estado: 'repetido',
      sincronizadas: [],
    });
    expect(e.pasarela.pagoDeAviso).toHaveBeenCalledTimes(1);
  });

  it('sin asociar: sincroniza las vigentes de Flow', async () => {
    const e = conDosSuscripciones();
    e.flow.pagos.set('tok-pago', {
      estado: 'pagado',
      orden: '1',
      ordenComercio: 'otra-cosa',
      suscripcionId: null,
    });
    const r = await procesarAvisoPago(e.deps, 'tok-pago');
    expect(r.estado).toBe('procesado');
    expect(r.sincronizadas).toHaveLength(2);
    expect(e.pasarela.obtenerSuscripcion.mock.calls.map((c) => c[0]).sort()).toEqual([
      'sus_1',
      'sus_2',
    ]);
    expect(e.eventos()[0]).toMatchObject({
      estado: 'procesado',
      datos: { sin_asociar: true, revisadas: 2 },
    });
  });

  it('suscripción desconocida: ignorado', async () => {
    const e = conDosSuscripciones();
    e.flow.pagos.set('tok-pago', {
      estado: 'pagado',
      orden: '1',
      ordenComercio: '2',
      suscripcionId: 'sus_ajena',
    });
    expect((await procesarAvisoPago(e.deps, 'tok-pago')).estado).toBe('ignorado');
    expect(e.pasarela.obtenerSuscripcion).not.toHaveBeenCalled();
    expect(e.eventos()[0]).toMatchObject({ estado: 'ignorado' });
  });

  it('falla de la pasarela: fallido, y un nuevo aviso con el mismo token se reintenta', async () => {
    const e = conDosSuscripciones();
    expect(await procesarAvisoPago(e.deps, 'tok-pago')).toEqual({
      estado: 'fallido',
      sincronizadas: [],
    });
    expect(e.eventos()[0]).toMatchObject({ estado: 'fallido' });

    e.flow.pagos.set('tok-pago', {
      estado: 'pagado',
      orden: '1',
      ordenComercio: '2',
      suscripcionId: 'sus_2',
    });
    expect((await procesarAvisoPago(e.deps, 'tok-pago')).estado).toBe('procesado');
    expect(e.eventos()).toHaveLength(1);
    expect(e.eventos()[0]).toMatchObject({ estado: 'procesado', intentos: 2 });
  });

  it('falla al sincronizar la suscripción asociada: fallido', async () => {
    const e = conDosSuscripciones();
    e.flow.pagos.set('tok-pago', {
      estado: 'pagado',
      orden: '1',
      ordenComercio: '2',
      suscripcionId: 'sus_1',
    });
    e.pasarela.obtenerSuscripcion.mockResolvedValueOnce(falla('red'));
    expect((await procesarAvisoPago(e.deps, 'tok-pago')).estado).toBe('fallido');
    expect(e.eventos()[0]).toMatchObject({ estado: 'fallido', organizacion_id: ORG });
  });
});
