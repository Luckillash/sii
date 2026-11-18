import { describe, expect, it, vi } from 'vitest';
import type { ConfiguracionFlow } from '../env';
import {
  codigoDePlanFlow,
  DIAS_HASTA_VENCER,
  diaFlow,
  idPlanFlow,
  instanteFlow,
  normalizarFactura,
  normalizarSuscripcion,
  ORIGEN_PUBLICO,
  pasarelaFlow,
  REINTENTOS_COBRO,
  suscripcionDeOrden,
  urlCallbackPlanes,
} from './flow-pasarela';

// Pasarela de Flow sin red: normalizadores puros y la implementación con un `fetch` falso
// que responde por servicio y registra los parámetros de cada llamada.

const CONFIG: ConfiguracionFlow = {
  FLOW_API_KEY: 'CLAVE-API-DE-PRUEBA-1234',
  FLOW_SECRET_KEY: 'secreto-de-prueba-abcdef-0123',
  FLOW_API_URL: 'https://sandbox.flow.cl/api',
};

// 12:00 del 17 de noviembre en Chile (horario de verano, -03).
const AHORA = new Date('2026-11-17T15:00:00Z');

describe('idPlanFlow / codigoDePlanFlow', () => {
  it('prefijo boleteame-', () => {
    expect(idPlanFlow('pyme')).toBe('boleteame-pyme');
    expect(codigoDePlanFlow('boleteame-pyme')).toBe('pyme');
    expect(codigoDePlanFlow('pyme')).toBeNull();
    expect(codigoDePlanFlow('boleteame-')).toBeNull();
    expect(codigoDePlanFlow(12)).toBeNull();
  });
});

describe('instanteFlow (hora de Chile → UTC)', () => {
  it('invierno: -04', () => {
    expect(instanteFlow('2026-07-15 10:00:00')).toBe('2026-07-15T14:00:00.000Z');
  });

  it('verano: -03', () => {
    expect(instanteFlow('2026-01-15 10:00:00')).toBe('2026-01-15T13:00:00.000Z');
    expect(instanteFlow('2026-11-17 23:30')).toBe('2026-11-18T02:30:00.000Z');
  });

  it('alrededor del cambio de hora de septiembre (6-sep-2026, 00:00 → 01:00)', () => {
    expect(instanteFlow('2026-09-05 23:00:00')).toBe('2026-09-06T03:00:00.000Z');
    expect(instanteFlow('2026-09-06 02:00:00')).toBe('2026-09-06T05:00:00.000Z');
  });

  it('solo el día: medianoche de Chile; también acepta la T', () => {
    expect(instanteFlow('2026-11-17')).toBe('2026-11-17T03:00:00.000Z');
    expect(instanteFlow('2026-06-01T08:15:30')).toBe('2026-06-01T12:15:30.000Z');
  });

  it('inválidos y 0000-00-00: null', () => {
    for (const v of [
      '0000-00-00 00:00:00',
      '0000-00-00',
      '17-11-2026',
      'ayer',
      '',
      null,
      undefined,
      1_700_000_000,
    ]) {
      expect(instanteFlow(v)).toBeNull();
    }
  });
});

describe('diaFlow', () => {
  it('AAAA-MM-DD… y DD-MM-AAAA', () => {
    expect(diaFlow('2026-11-17 10:20:30')).toBe('2026-11-17');
    expect(diaFlow('2026-11-17')).toBe('2026-11-17');
    expect(diaFlow('17-11-2026')).toBe('2026-11-17');
  });

  it('vacíos e inválidos: null', () => {
    for (const v of ['0000-00-00', '0000-00-00 00:00:00', '2026/11/17', '', null, 5]) {
      expect(diaFlow(v)).toBeNull();
    }
  });
});

function facturaBruta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 98765,
    subscriptionId: 'sus_1',
    customerId: 'cus_1',
    amount: '14990.0000',
    currency: 'CLP',
    status: 0,
    period_start: '2026-11-10',
    period_end: '2026-12-09',
    due_date: '2026-11-17',
    attemp_count: '2',
    error: 0,
    errorDescription: 'Tarjeta sin fondos',
    paymentLink: 'https://sandbox.flow.cl/app/web/pagarBtnPago.php?token=abc',
    payment: null,
    outsidePayment: null,
    ...extra,
  };
}

describe('normalizarFactura', () => {
  it('impaga sin vencer: pendiente, con números de texto convertidos y enlace https', () => {
    expect(normalizarFactura(facturaBruta(), AHORA)).toEqual({
      id: '98765',
      monto: 14990,
      estado: 'pendiente',
      periodoInicio: '2026-11-10',
      periodoFin: '2026-12-09',
      venceEn: '2026-11-17',
      pagadoEn: null,
      orden: null,
      medio: null,
      enlacePago: 'https://sandbox.flow.cl/app/web/pagarBtnPago.php?token=abc',
      intentos: 2,
      error: null,
    });
  });

  it('vencido según el día de Chile, no el de UTC', () => {
    expect(normalizarFactura(facturaBruta({ due_date: '2026-11-16' }), AHORA)?.estado).toBe(
      'vencido',
    );
    // 23:00 del 17 en Chile = 02:00 del 18 en UTC: el 17 aún no vence.
    const noche = new Date('2026-11-18T02:00:00Z');
    expect(normalizarFactura(facturaBruta({ status: '0' }), noche)?.estado).toBe('pendiente');
    // Sin fecha de vencimiento: pendiente.
    expect(normalizarFactura(facturaBruta({ due_date: null }), AHORA)?.estado).toBe('pendiente');
  });

  it('pagada (status 1): pagadoEn de paymentData, sin enlace', () => {
    const f = normalizarFactura(
      facturaBruta({
        status: '1',
        payment: {
          flowOrder: 3567899,
          paymentData: { date: '2026-11-10 09:05:00', media: 'Webpay' },
        },
      }),
      AHORA,
    );
    expect(f).toMatchObject({
      estado: 'pagado',
      pagadoEn: '2026-11-10T12:05:00.000Z',
      orden: '3567899',
      medio: 'Webpay',
      enlacePago: null,
    });
  });

  it('pagada por fuera (outsidePayment): pagadoEn de ahí y medio «externo»', () => {
    const f = normalizarFactura(
      facturaBruta({ status: 1, outsidePayment: { date: '2026-11-11', comment: 'transferencia' } }),
      AHORA,
    );
    expect(f).toMatchObject({
      estado: 'pagado',
      pagadoEn: '2026-11-11T03:00:00.000Z',
      medio: 'externo',
    });
  });

  it('anulada (status 2): sin enlace ni pagadoEn', () => {
    expect(normalizarFactura(facturaBruta({ status: 2 }), AHORA)).toMatchObject({
      estado: 'anulado',
      enlacePago: null,
      pagadoEn: null,
    });
  });

  it('enlace solo https y solo si está impaga', () => {
    expect(
      normalizarFactura(facturaBruta({ paymentLink: 'http://flow.cl/x' }), AHORA)?.enlacePago,
    ).toBeNull();
    expect(
      normalizarFactura(facturaBruta({ paymentLink: 'javascript:alert(1)' }), AHORA)?.enlacePago,
    ).toBeNull();
    expect(normalizarFactura(facturaBruta({ due_date: '2026-11-01' }), AHORA)?.enlacePago).toMatch(
      /^https:/,
    );
  });

  it('error solo si error = 1', () => {
    expect(normalizarFactura(facturaBruta({ error: 1 }), AHORA)?.error).toBe('Tarjeta sin fondos');
    expect(normalizarFactura(facturaBruta({ error: '1' }), AHORA)?.error).toBe(
      'Tarjeta sin fondos',
    );
    expect(normalizarFactura(facturaBruta({ error: 0 }), AHORA)?.error).toBeNull();
  });

  it('montos raros: no negativos, redondeados; sin id: null', () => {
    expect(normalizarFactura(facturaBruta({ amount: '-5' }), AHORA)?.monto).toBe(0);
    expect(normalizarFactura(facturaBruta({ amount: '9990.6' }), AHORA)?.monto).toBe(9991);
    expect(normalizarFactura(facturaBruta({ amount: 'abc' }), AHORA)?.monto).toBe(0);
    expect(normalizarFactura(facturaBruta({ id: null }), AHORA)).toBeNull();
    expect(normalizarFactura(facturaBruta({ id: '  ' }), AHORA)).toBeNull();
  });
});

function suscripcionBruta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subscriptionId: 'sus_1',
    planId: 'boleteame-pyme',
    customerId: 'cus_1',
    status: 1,
    morose: 0,
    period_start: '2026-11-10 00:00:00',
    period_end: '2026-12-09 00:00:00',
    cancel_at_period_end: 0,
    invoices: [],
    ...extra,
  };
}

describe('normalizarSuscripcion', () => {
  it('activa al día', () => {
    expect(normalizarSuscripcion(suscripcionBruta(), AHORA)).toEqual({
      id: 'sus_1',
      planCodigo: 'pyme',
      clienteId: 'cus_1',
      estado: 'activa',
      morosidad: 'al_dia',
      periodoInicio: '2026-11-10T03:00:00.000Z',
      periodoFin: '2026-12-09T03:00:00.000Z',
      cancelarAlFinPeriodo: false,
      facturas: [],
    });
  });

  it.each([
    [0, 'no_iniciada'],
    ['1', 'activa'],
    [2, 'prueba'],
    ['4', 'cancelada'],
  ] as const)('status %s → %s', (status, estado) => {
    expect(normalizarSuscripcion(suscripcionBruta({ status }), AHORA)?.estado).toBe(estado);
  });

  it.each([
    [0, 'al_dia'],
    ['1', 'vencida'],
    [2, 'pendiente'],
  ] as const)('morose %s → %s', (morose, morosidad) => {
    expect(normalizarSuscripcion(suscripcionBruta({ morose }), AHORA)?.morosidad).toBe(morosidad);
  });

  it('planId sin el prefijo: planCodigo null', () => {
    expect(
      normalizarSuscripcion(suscripcionBruta({ planId: 'otro-plan' }), AHORA)?.planCodigo,
    ).toBe(null);
  });

  it('importes normalizados (descarta los inválidos) y cancel_at_period_end', () => {
    const s = normalizarSuscripcion(
      suscripcionBruta({
        cancel_at_period_end: '1',
        invoices: [facturaBruta({ due_date: '2026-11-01' }), null, { sinId: true }, 'x'],
      }),
      AHORA,
    );
    expect(s?.cancelarAlFinPeriodo).toBe(true);
    expect(s?.facturas).toHaveLength(1);
    expect(s?.facturas[0]).toMatchObject({ id: '98765', estado: 'vencido' });
  });

  it('sin subscriptionId o customerId: null', () => {
    expect(normalizarSuscripcion(suscripcionBruta({ subscriptionId: '' }), AHORA)).toBeNull();
    expect(normalizarSuscripcion(suscripcionBruta({ customerId: null }), AHORA)).toBeNull();
  });
});

// --------------------------------------------------------------------------------
// Pasarela con fetch falso
// --------------------------------------------------------------------------------

type Respuesta = { estado: number; cuerpo: unknown } | 'red';
type Llamada = { metodo: string; servicio: string; params: Record<string, string> };

function flowFalso(rutas: Record<string, Respuesta | ((p: Record<string, string>) => Respuesta)>) {
  const llamadas: Llamada[] = [];
  const f = vi.fn<typeof fetch>(async (entrada, init) => {
    const url = new URL(String(entrada));
    const servicio = url.pathname.replace(/^\/api\//, '');
    const metodo = init?.method ?? 'GET';
    const params = Object.fromEntries(
      metodo === 'GET' ? url.searchParams : new URLSearchParams(String(init?.body)),
    );
    delete params.apiKey;
    delete params.s;
    llamadas.push({ metodo, servicio, params });
    const ruta = rutas[servicio];
    const r = typeof ruta === 'function' ? ruta(params) : ruta;
    if (!r) return Response.json({ code: 404, message: 'servicio no simulado' }, { status: 400 });
    if (r === 'red') throw new TypeError('fetch failed');
    return Response.json(r.cuerpo, { status: r.estado });
  });
  const pasarela = pasarelaFlow({
    urlApp: 'https://app.boleteame.dev/',
    configuracion: CONFIG,
    fetch: f,
  });
  return { pasarela, llamadas, f };
}

const PYME = { codigo: 'pyme', nombre: 'Pyme', precioMensualClp: 14990 };

describe('suscripcionDeOrden', () => {
  it('lee el id de suscripción de la orden de comercio de Flow', () => {
    expect(suscripcionDeOrden('sus_l78a6791ff_1250381_2026-11-18 18:32')).toBe('sus_l78a6791ff');
    expect(suscripcionDeOrden('sus_abc_99')).toBe('sus_abc');
    expect(suscripcionDeOrden('98765')).toBeNull();
    expect(suscripcionDeOrden('orden-abc')).toBeNull();
    expect(suscripcionDeOrden('sus_abc')).toBeNull();
  });
});

describe('pasarelaFlow.obtenerFactura', () => {
  it('normaliza el importe de invoice/get con el detalle del pago', async () => {
    const { pasarela } = flowFalso({
      'invoice/get': {
        estado: 200,
        cuerpo: {
          id: 1250381,
          amount: '14990.0000',
          status: 1,
          period_start: '2026-11-18 00:00:00',
          period_end: '2026-12-17 00:00:00',
          due_date: '2026-11-25 00:00:00',
          attemp_count: 1,
          error: 0,
          payment: {
            flowOrder: 11777257,
            paymentData: { date: '2026-11-18 18:32:42', media: 'Cargo automático' },
          },
          paymentLink: null,
        },
      },
    });
    expect(await pasarela.obtenerFactura('1250381')).toMatchObject({
      ok: true,
      datos: {
        id: '1250381',
        monto: 14990,
        estado: 'pagado',
        pagadoEn: '2026-11-18T21:32:42.000Z',
        medio: 'Cargo automático',
        orden: '11777257',
      },
    });
  });
});

describe('urlCallbackPlanes', () => {
  it('usa la URL de la app si es https y el origen público si es local', () => {
    expect(urlCallbackPlanes('https://boleteame.dev/')).toBe(
      'https://boleteame.dev/api/pagos/flow/confirmacion',
    );
    expect(urlCallbackPlanes('http://localhost:3000')).toBe(
      `${ORIGEN_PUBLICO}/api/pagos/flow/confirmacion`,
    );
  });
});

describe('pasarelaFlow.asegurarPlan', () => {
  it('existe con el mismo precio: ok sin crear', async () => {
    const { pasarela, llamadas } = flowFalso({
      'plans/get': {
        estado: 200,
        cuerpo: {
          planId: 'boleteame-pyme',
          amount: '14990.0000',
          status: 1,
          urlCallback: 'https://app.boleteame.dev/api/pagos/flow/confirmacion',
        },
      },
    });
    expect(await pasarela.asegurarPlan(PYME)).toEqual({ ok: true, datos: undefined });
    expect(llamadas.map((l) => l.servicio)).toEqual(['plans/get']);
    expect(llamadas[0]?.params).toEqual({ planId: 'boleteame-pyme' });
  });

  it('existe con otro urlCallback: intenta corregirlo con plans/edit y sigue aunque falle', async () => {
    const { pasarela, llamadas } = flowFalso({
      'plans/get': {
        estado: 200,
        cuerpo: {
          planId: 'boleteame-pyme',
          amount: 14990,
          status: 1,
          urlCallback: 'http://localhost:3000/api/pagos/flow/confirmacion',
        },
      },
      'plans/edit': { estado: 401, cuerpo: { code: 501, message: 'plan has subscribers' } },
    });
    expect(await pasarela.asegurarPlan(PYME)).toEqual({ ok: true, datos: undefined });
    expect(llamadas.map((l) => l.servicio)).toEqual(['plans/get', 'plans/edit']);
    expect(llamadas[1]?.params).toEqual({
      planId: 'boleteame-pyme',
      urlCallback: 'https://app.boleteame.dev/api/pagos/flow/confirmacion',
    });
  });

  it('existe con otro precio: rechazado, sin crear ni editar', async () => {
    const { pasarela, llamadas } = flowFalso({
      'plans/get': { estado: 200, cuerpo: { planId: 'boleteame-pyme', amount: 9990, status: 1 } },
    });
    const r = await pasarela.asegurarPlan(PYME);
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado' });
    if (!r.ok) expect(r.detalle).toMatch(/9990.*14990/);
    expect(llamadas).toHaveLength(1);
  });

  it('no existe: plans/create mensual con días de gracia, reintentos y urlCallback', async () => {
    const { pasarela, llamadas } = flowFalso({
      'plans/get': { estado: 400, cuerpo: { code: 404, message: 'Plan not found' } },
      'plans/create': { estado: 200, cuerpo: { planId: 'boleteame-pyme' } },
    });
    expect(await pasarela.asegurarPlan(PYME)).toEqual({ ok: true, datos: undefined });
    const crear = llamadas[1];
    expect(crear?.metodo).toBe('POST');
    expect(crear?.servicio).toBe('plans/create');
    expect(crear?.params).toEqual({
      planId: 'boleteame-pyme',
      name: 'Boletéame Pyme',
      currency: 'CLP',
      amount: '14990',
      interval: '3',
      interval_count: '1',
      trial_period_days: '0',
      days_until_due: String(DIAS_HASTA_VENCER),
      charges_retries_number: String(REINTENTOS_COBRO),
      urlCallback: 'https://app.boleteame.dev/api/pagos/flow/confirmacion',
    });
  });

  it('plan eliminado en Flow (status 0): lo vuelve a crear', async () => {
    const { pasarela, llamadas } = flowFalso({
      'plans/get': { estado: 200, cuerpo: { planId: 'boleteame-pyme', amount: 1, status: 0 } },
      'plans/create': { estado: 200, cuerpo: {} },
    });
    expect((await pasarela.asegurarPlan(PYME)).ok).toBe(true);
    expect(llamadas.map((l) => l.servicio)).toEqual(['plans/get', 'plans/create']);
  });

  it('red al consultar: no intenta crear', async () => {
    const { pasarela, llamadas } = flowFalso({ 'plans/get': 'red' });
    expect(await pasarela.asegurarPlan(PYME)).toMatchObject({ ok: false, motivo: 'red' });
    expect(llamadas).toHaveLength(1);
  });
});

describe('pasarelaFlow: clientes y tarjeta', () => {
  it('crearCliente acota el nombre y devuelve el customerId', async () => {
    const { pasarela, llamadas } = flowFalso({
      'customer/create': { estado: 200, cuerpo: { customerId: 'cus_9' } },
    });
    const r = await pasarela.crearCliente({
      nombre: 'N'.repeat(150),
      correo: 'a@b.cl',
      idInterno: 'org-1',
    });
    expect(r).toEqual({ ok: true, datos: { id: 'cus_9' } });
    expect(llamadas[0]?.params).toEqual({
      name: 'N'.repeat(100),
      email: 'a@b.cl',
      externalId: 'org-1',
    });
  });

  it('iniciarRegistroTarjeta arma url?token= con la URL de retorno', async () => {
    const { pasarela, llamadas } = flowFalso({
      'customer/register': {
        estado: 200,
        cuerpo: { url: 'https://sandbox.flow.cl/app/customer/disclaimer.php', token: 'tok/1' },
      },
    });
    const r = await pasarela.iniciarRegistroTarjeta(
      'cus_9',
      'https://app.boleteame.dev/api/pagos/flow/registro',
    );
    expect(r).toEqual({
      ok: true,
      datos: { url: 'https://sandbox.flow.cl/app/customer/disclaimer.php?token=tok%2F1' },
    });
    expect(llamadas[0]).toMatchObject({
      metodo: 'POST',
      params: {
        customerId: 'cus_9',
        url_return: 'https://app.boleteame.dev/api/pagos/flow/registro',
      },
    });
  });

  it('iniciarRegistroTarjeta sin token o con URL no https: red', async () => {
    for (const cuerpo of [
      { url: 'https://sandbox.flow.cl/x' },
      { url: 'http://sandbox.flow.cl/x', token: 't' },
    ]) {
      const { pasarela } = flowFalso({ 'customer/register': { estado: 200, cuerpo } });
      expect(await pasarela.iniciarRegistroTarjeta('c', 'https://x')).toMatchObject({
        ok: false,
        motivo: 'red',
      });
    }
  });

  it('estadoRegistroTarjeta: registrada, marca y últimos 4 (solo si son 4 dígitos)', async () => {
    const { pasarela, llamadas } = flowFalso({
      'customer/getRegisterStatus': {
        estado: 200,
        cuerpo: {
          status: '1',
          customerId: 'cus_9',
          creditCardType: 'Visa',
          last4CardDigits: '4242',
        },
      },
    });
    expect(await pasarela.estadoRegistroTarjeta('tok1')).toEqual({
      ok: true,
      datos: { registrada: true, clienteId: 'cus_9', marca: 'Visa', ultimos4: '4242' },
    });
    expect(llamadas[0]).toMatchObject({ metodo: 'GET', params: { token: 'tok1' } });

    const otro = flowFalso({
      'customer/getRegisterStatus': {
        estado: 200,
        cuerpo: { status: 0, customerId: 'cus_9', last4CardDigits: 'xx42' },
      },
    });
    expect(await otro.pasarela.estadoRegistroTarjeta('tok2')).toEqual({
      ok: true,
      datos: { registrada: false, clienteId: 'cus_9', marca: null, ultimos4: null },
    });
  });

  it('estadoRegistroTarjeta sin customerId: red', async () => {
    const { pasarela } = flowFalso({
      'customer/getRegisterStatus': { estado: 200, cuerpo: { status: 1 } },
    });
    expect(await pasarela.estadoRegistroTarjeta('t')).toMatchObject({ ok: false, motivo: 'red' });
  });
});

describe('pasarelaFlow: suscripciones', () => {
  it('crearSuscripcion con el planId prefijado; normaliza la respuesta', async () => {
    const { pasarela, llamadas } = flowFalso({
      'subscription/create': { estado: 200, cuerpo: suscripcionBruta() },
    });
    const r = await pasarela.crearSuscripcion('cus_1', 'pyme');
    expect(r).toMatchObject({ ok: true, datos: { id: 'sus_1', planCodigo: 'pyme' } });
    expect(llamadas[0]?.params).toEqual({ planId: 'boleteame-pyme', customerId: 'cus_1' });
  });

  it('respuesta sin suscripción: red', async () => {
    const { pasarela } = flowFalso({ 'subscription/get': { estado: 200, cuerpo: { foo: 1 } } });
    expect(await pasarela.obtenerSuscripcion('sus_1')).toMatchObject({ ok: false, motivo: 'red' });
  });

  it('cambiarPlan y previsualizar: saldo y próximo cobro', async () => {
    const { pasarela, llamadas } = flowFalso({
      'subscription/changePlanPreview': {
        estado: 200,
        cuerpo: { balance: { amount: '-3500.0000' }, next_invoice_date: '2026-12-10 00:00:00' },
      },
      'subscription/changePlan': {
        estado: 200,
        cuerpo: { balance: '1200', start_date_of_new_plan: '2026-12-10' },
      },
    });
    expect(await pasarela.previsualizarCambioPlan('sus_1', 'contador')).toEqual({
      ok: true,
      datos: { saldo: -3500, proximoCobro: '2026-12-10' },
    });
    expect(await pasarela.cambiarPlan('sus_1', 'contador')).toEqual({
      ok: true,
      datos: { saldo: 1200, proximoCobro: '2026-12-10' },
    });
    expect(llamadas[1]?.params).toEqual({
      subscriptionId: 'sus_1',
      newPlanId: 'boleteame-contador',
    });
  });

  it('cancelarSuscripcion al fin del período: at_period_end=1', async () => {
    const { pasarela, llamadas } = flowFalso({
      'subscription/cancel': {
        estado: 200,
        cuerpo: suscripcionBruta({ cancel_at_period_end: 1 }),
      },
    });
    const r = await pasarela.cancelarSuscripcion('sus_1', true);
    expect(r).toMatchObject({ ok: true, datos: { cancelarAlFinPeriodo: true } });
    expect(llamadas[0]?.params).toEqual({ subscriptionId: 'sus_1', at_period_end: '1' });
  });
});

describe('pasarelaFlow.pagoDeAviso', () => {
  it('commerceOrder numérico: consulta invoice/get y devuelve la suscripción', async () => {
    const { pasarela, llamadas } = flowFalso({
      'payment/getStatus': {
        estado: 200,
        cuerpo: { status: 2, flowOrder: 778899, commerceOrder: '98765' },
      },
      'invoice/get': { estado: 200, cuerpo: { id: 98765, subscriptionId: 'sus_1' } },
    });
    expect(await pasarela.pagoDeAviso('tok_pago')).toEqual({
      ok: true,
      datos: { estado: 'pagado', orden: '778899', ordenComercio: '98765', suscripcionId: 'sus_1' },
    });
    expect(llamadas.map((l) => [l.servicio, l.params])).toEqual([
      ['payment/getStatus', { token: 'tok_pago' }],
      ['invoice/get', { invoiceId: '98765' }],
    ]);
  });

  it('orden de Flow sus_<id>_<importe>_<fecha>: la suscripción sale de la orden, sin invoice/get', async () => {
    const { pasarela, llamadas } = flowFalso({
      'payment/getStatus': {
        estado: 200,
        cuerpo: {
          status: 2,
          flowOrder: 11777257,
          commerceOrder: 'sus_l78a6791ff_1250381_2026-11-18 18:32',
        },
      },
    });
    const r = await pasarela.pagoDeAviso('tok');
    expect(r).toMatchObject({
      ok: true,
      datos: { estado: 'pagado', suscripcionId: 'sus_l78a6791ff' },
    });
    expect(llamadas.map((l) => l.servicio)).toEqual(['payment/getStatus']);
  });

  it('commerceOrder no numérico: no consulta el importe', async () => {
    const { pasarela, llamadas } = flowFalso({
      'payment/getStatus': {
        estado: 200,
        cuerpo: { status: '3', flowOrder: 1, commerceOrder: 'orden-abc' },
      },
    });
    expect(await pasarela.pagoDeAviso('t')).toMatchObject({
      ok: true,
      datos: { estado: 'rechazado', suscripcionId: null },
    });
    expect(llamadas).toHaveLength(1);
  });

  it('estados del pago y falla de invoice/get (sin suscripción, sin fallar)', async () => {
    for (const [status, estado] of [
      [1, 'pendiente'],
      [4, 'anulado'],
      [null, 'pendiente'],
    ] as const) {
      const { pasarela } = flowFalso({
        'payment/getStatus': { estado: 200, cuerpo: { status, commerceOrder: '1' } },
        'invoice/get': { estado: 400, cuerpo: { code: 1, message: 'no' } },
      });
      expect(await pasarela.pagoDeAviso('t')).toMatchObject({
        ok: true,
        datos: { estado, suscripcionId: null },
      });
    }
  });

  it('falla de payment/getStatus: se propaga', async () => {
    const { pasarela } = flowFalso({ 'payment/getStatus': 'red' });
    expect(await pasarela.pagoDeAviso('t')).toMatchObject({ ok: false, motivo: 'red' });
  });
});
