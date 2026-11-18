import 'server-only';
import { llamarFlow, type OpcionesFlow, type ResultadoFlow } from './flow';
import type {
  CambioPlan,
  EstadoFactura,
  FacturaExterna,
  PagoExterno,
  Pasarela,
  PlanCobrable,
  RegistroTarjeta,
  SuscripcionExterna,
} from './pasarela';

// Implementación de la pasarela con Flow (PLAN-SAAS D4). Notas de la API (ver también
// documentación/07-referencia/trampas-conocidas.md, «Pagos y suscripciones (Fase 10)»):
// - Varios números llegan como string («20000.0000», status «1»): todo pasa por `numero`.
// - Las fechas vienen como `AAAA-MM-DD hh:mm:ss` en hora de Chile, sin zona.
// - `planId` es texto elegido por el comercio: `boleteame-<codigo>`.
// - Un callback solo trae `token`; el resultado se consulta firmado.

/** Prefijo de los planes de Boletéame en la cuenta de Flow. */
export const PREFIJO_PLAN = 'boleteame-';
/** Días que Flow espera antes de dar por vencido un importe impago (= gracia antes de `morosa`). */
export const DIAS_HASTA_VENCER = 7;
/** Reintentos de cobro de Flow dentro de un importe. */
export const REINTENTOS_COBRO = 3;

export function idPlanFlow(codigo: string): string {
  return `${PREFIJO_PLAN}${codigo}`;
}

export function codigoDePlanFlow(planId: unknown): string | null {
  return typeof planId === 'string' && planId.startsWith(PREFIJO_PLAN)
    ? planId.slice(PREFIJO_PLAN.length) || null
    : null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function texto(valor: unknown, largo = 200): string | null {
  if (typeof valor === 'number') return String(valor);
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim().slice(0, largo) : null;
}

/** Minutos que Santiago está adelantado (negativo: atrasado) respecto de UTC en `ms`. */
function desfaseSantiago(ms: number): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return Math.round((local - ms) / 60_000);
}

/** `AAAA-MM-DD[ hh:mm[:ss]]` en hora de Chile → instante ISO (UTC). */
export function instanteFlow(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(valor.trim());
  if (!m) return null;
  const [, a = '0000', mes = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  if (a === '0000') return null;
  const comoUtc = Date.UTC(+a, +mes - 1, +d, +h, +mi, +s);
  if (Number.isNaN(comoUtc)) return null;
  let instante = comoUtc - desfaseSantiago(comoUtc) * 60_000;
  // Segunda pasada por si el cambio de horario cae entre ambos instantes.
  instante = comoUtc - desfaseSantiago(instante) * 60_000;
  return new Date(instante).toISOString();
}

/** Día `AAAA-MM-DD` de una fecha de Flow (`AAAA-MM-DD…` o `DD-MM-AAAA`). */
export function diaFlow(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (iso) return iso[1] === '0000' ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cl = /^(\d{2})-(\d{2})-(\d{4})/.exec(valor.trim());
  return cl ? `${cl[3]}-${cl[2]}-${cl[1]}` : null;
}

function hoyChile(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(ahora);
}

export function normalizarFactura(
  bruto: Record<string, unknown>,
  ahora: Date = new Date(),
): FacturaExterna | null {
  const id = texto(bruto.id);
  if (!id) return null;
  const venceEn = diaFlow(bruto.due_date);
  const pago = (bruto.payment ?? null) as Record<string, unknown> | null;
  const datosPago = (pago?.paymentData ?? null) as Record<string, unknown> | null;
  const externo = (bruto.outsidePayment ?? null) as Record<string, unknown> | null;
  const status = numero(bruto.status);
  let estado: EstadoFactura;
  if (status === 1) estado = 'pagado';
  else if (status === 2) estado = 'anulado';
  else estado = venceEn !== null && venceEn < hoyChile(ahora) ? 'vencido' : 'pendiente';
  const enlace = texto(bruto.paymentLink, 2000);
  return {
    id,
    monto: Math.max(0, Math.round(numero(bruto.amount) ?? 0)),
    estado,
    periodoInicio: diaFlow(bruto.period_start),
    periodoFin: diaFlow(bruto.period_end),
    venceEn,
    pagadoEn:
      estado === 'pagado' ? (instanteFlow(datosPago?.date) ?? instanteFlow(externo?.date)) : null,
    orden: texto(pago?.flowOrder, 100),
    medio: texto(datosPago?.media, 60) ?? (externo ? 'externo' : null),
    enlacePago:
      estado === 'pendiente' || estado === 'vencido'
        ? enlace?.startsWith('https://')
          ? enlace
          : null
        : null,
    intentos: Math.max(0, Math.trunc(numero(bruto.attemp_count) ?? 0)),
    error: numero(bruto.error) === 1 ? texto(bruto.errorDescription, 500) : null,
  };
}

/** `sus_…` de una orden de comercio de Flow `sus_<id>_<invoice>_<fecha>`, o null. */
export function suscripcionDeOrden(orden: string): string | null {
  const m = /^(sus_[A-Za-z0-9]+)_\d+(?:_|$)/.exec(orden.trim());
  return m?.[1] ?? null;
}

export function normalizarSuscripcion(
  bruto: Record<string, unknown>,
  ahora: Date = new Date(),
): SuscripcionExterna | null {
  const id = texto(bruto.subscriptionId);
  const clienteId = texto(bruto.customerId);
  if (!id || !clienteId) return null;
  const status = numero(bruto.status);
  const morose = numero(bruto.morose);
  const facturas = Array.isArray(bruto.invoices)
    ? bruto.invoices
        .map((f) =>
          f && typeof f === 'object'
            ? normalizarFactura(f as Record<string, unknown>, ahora)
            : null,
        )
        .filter((f): f is FacturaExterna => f !== null)
    : [];
  return {
    id,
    planCodigo: codigoDePlanFlow(bruto.planId),
    clienteId,
    estado:
      status === 4
        ? 'cancelada'
        : status === 2
          ? 'prueba'
          : status === 0
            ? 'no_iniciada'
            : 'activa',
    morosidad: morose === 1 ? 'vencida' : morose === 2 ? 'pendiente' : 'al_dia',
    periodoInicio: instanteFlow(bruto.period_start),
    periodoFin: instanteFlow(bruto.period_end),
    cancelarAlFinPeriodo: numero(bruto.cancel_at_period_end) === 1,
    facturas,
  };
}

function suscripcionOError(
  r: ResultadoFlow<Record<string, unknown>>,
  servicio: string,
): ResultadoFlow<SuscripcionExterna> {
  if (!r.ok) return r;
  const s = normalizarSuscripcion(r.datos);
  return s
    ? { ok: true, datos: s }
    : { ok: false, motivo: 'red', detalle: `${servicio}: respuesta sin suscripción` };
}

function cambioDe(datos: Record<string, unknown>): CambioPlan {
  const balance = datos.balance;
  const saldo =
    balance && typeof balance === 'object'
      ? numero((balance as Record<string, unknown>).amount)
      : numero(balance);
  return {
    saldo: Math.round(saldo ?? numero(datos.balance2) ?? 0),
    proximoCobro: diaFlow(datos.next_invoice_date) ?? diaFlow(datos.start_date_of_new_plan),
  };
}

/**
 * Origen público al que Flow avisa los pagos si la app corre en local (`http://localhost`).
 * El `urlCallback` queda guardado en el plan al crearlo y Flow no deja cambiarlo si el plan
 * tiene suscriptores: tiene que ser una URL pública desde el principio. Como hay una sola
 * base (PLAN-SAAS principio 6), Production procesa también los avisos de lo contratado en
 * local.
 */
export const ORIGEN_PUBLICO = 'https://boleteame.dev';

/** `urlCallback` de los planes: el de la app si es https; si no, el de `ORIGEN_PUBLICO`. */
export function urlCallbackPlanes(urlApp: string): string {
  const base = urlApp.startsWith('https://') ? urlApp.replace(/\/+$/, '') : ORIGEN_PUBLICO;
  return `${base}/api/pagos/flow/confirmacion`;
}

export interface ConfiguracionPasarelaFlow extends OpcionesFlow {
  /** URL pública de la app (`NEXT_PUBLIC_APP_URL`), para el `urlCallback` de los planes. */
  urlApp: string;
}

export function pasarelaFlow(config: ConfiguracionPasarelaFlow): Pasarela {
  const opciones: OpcionesFlow = { fetch: config.fetch, configuracion: config.configuracion };
  const urlCallback = `${config.urlApp.replace(/\/$/, '')}/api/pagos/flow/confirmacion`;

  return {
    proveedor: 'flow',

    async asegurarPlan(plan: PlanCobrable) {
      const planId = idPlanFlow(plan.codigo);
      const actual = await llamarFlow<Record<string, unknown>>(
        'GET',
        'plans/get',
        { planId },
        opciones,
      );
      if (actual.ok && numero(actual.datos.status) !== 0) {
        const monto = numero(actual.datos.amount);
        if (monto !== plan.precioMensualClp) {
          return {
            ok: false,
            motivo: 'rechazado',
            detalle: `plans/get: el plan ${planId} cobra ${monto} en Flow y ${plan.precioMensualClp} en la base`,
          };
        }
        // Un plan creado con otro callback (p. ej. antes de ORIGEN_PUBLICO) se corrige si
        // todavía no tiene suscriptores; con suscriptores Flow lo rechaza y se sigue igual.
        if (actual.datos.urlCallback !== urlCallback) {
          await llamarFlow('POST', 'plans/edit', { planId, urlCallback }, opciones);
        }
        return { ok: true, datos: undefined };
      }
      if (!actual.ok && actual.motivo !== 'rechazado') return actual;
      const creado = await llamarFlow(
        'POST',
        'plans/create',
        {
          planId,
          name: `Boletéame ${plan.nombre}`,
          currency: 'CLP',
          amount: plan.precioMensualClp,
          interval: 3,
          interval_count: 1,
          trial_period_days: 0,
          days_until_due: DIAS_HASTA_VENCER,
          charges_retries_number: REINTENTOS_COBRO,
          urlCallback,
        },
        opciones,
      );
      return creado.ok ? { ok: true, datos: undefined } : creado;
    },

    async crearCliente({ nombre, correo, idInterno }) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'customer/create',
        { name: nombre.slice(0, 100), email: correo, externalId: idInterno },
        opciones,
      );
      if (!r.ok) return r;
      const id = texto(r.datos.customerId);
      return id
        ? { ok: true, datos: { id } }
        : { ok: false, motivo: 'red', detalle: 'customer/create: respuesta sin customerId' };
    },

    async iniciarRegistroTarjeta(clienteId, urlRetorno) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'customer/register',
        { customerId: clienteId, url_return: urlRetorno },
        opciones,
      );
      if (!r.ok) return r;
      const url = texto(r.datos.url, 2000);
      const token = texto(r.datos.token, 200);
      if (!url?.startsWith('https://') || !token) {
        return {
          ok: false,
          motivo: 'red',
          detalle: 'customer/register: respuesta sin url o token',
        };
      }
      return { ok: true, datos: { url: `${url}?token=${encodeURIComponent(token)}` } };
    },

    async estadoRegistroTarjeta(token) {
      const r = await llamarFlow<Record<string, unknown>>(
        'GET',
        'customer/getRegisterStatus',
        { token },
        opciones,
      );
      if (!r.ok) return r;
      const clienteId = texto(r.datos.customerId);
      if (!clienteId) {
        return { ok: false, motivo: 'red', detalle: 'customer/getRegisterStatus: sin customerId' };
      }
      const ultimos = texto(r.datos.last4CardDigits, 4);
      const registro: RegistroTarjeta = {
        registrada: numero(r.datos.status) === 1,
        clienteId,
        marca: texto(r.datos.creditCardType, 40),
        ultimos4: ultimos && /^\d{4}$/.test(ultimos) ? ultimos : null,
      };
      return { ok: true, datos: registro };
    },

    async crearSuscripcion(clienteId, planCodigo) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'subscription/create',
        { planId: idPlanFlow(planCodigo), customerId: clienteId },
        opciones,
      );
      return suscripcionOError(r, 'subscription/create');
    },

    async obtenerSuscripcion(id) {
      const r = await llamarFlow<Record<string, unknown>>(
        'GET',
        'subscription/get',
        { subscriptionId: id },
        opciones,
      );
      return suscripcionOError(r, 'subscription/get');
    },

    async obtenerFactura(id) {
      const r = await llamarFlow<Record<string, unknown>>(
        'GET',
        'invoice/get',
        { invoiceId: id },
        opciones,
      );
      if (!r.ok) return r;
      const f = normalizarFactura(r.datos);
      return f
        ? { ok: true, datos: f }
        : { ok: false, motivo: 'red', detalle: 'invoice/get: respuesta sin importe' };
    },

    async previsualizarCambioPlan(id, planCodigo) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'subscription/changePlanPreview',
        { subscriptionId: id, newPlanId: idPlanFlow(planCodigo) },
        opciones,
      );
      return r.ok ? { ok: true, datos: cambioDe(r.datos) } : r;
    },

    async cambiarPlan(id, planCodigo) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'subscription/changePlan',
        { subscriptionId: id, newPlanId: idPlanFlow(planCodigo) },
        opciones,
      );
      return r.ok ? { ok: true, datos: cambioDe(r.datos) } : r;
    },

    async cancelarSuscripcion(id, alFinDelPeriodo) {
      const r = await llamarFlow<Record<string, unknown>>(
        'POST',
        'subscription/cancel',
        { subscriptionId: id, at_period_end: alFinDelPeriodo ? 1 : 0 },
        opciones,
      );
      return suscripcionOError(r, 'subscription/cancel');
    },

    async pagoDeAviso(token) {
      const r = await llamarFlow<Record<string, unknown>>(
        'GET',
        'payment/getStatus',
        { token },
        opciones,
      );
      if (!r.ok) return r;
      const status = numero(r.datos.status);
      const ordenComercio = texto(r.datos.commerceOrder, 100);
      // Los cobros de una suscripción salen de un importe (invoice). Flow arma la orden del
      // comercio como `<subscriptionId>_<invoiceId>_<fecha hora>` (visto en el sandbox el
      // 2026-11-18: `sus_l78a6791ff_1250381_2026-11-18 18:32`): de ahí sale la suscripción.
      // Si la orden fuera solo el id del importe, se consulta `invoice/get`. Si no calza
      // ninguna, el llamador sincroniza por otra vía (ver `procesarAvisoPago`).
      let suscripcionId = ordenComercio ? suscripcionDeOrden(ordenComercio) : null;
      if (!suscripcionId && ordenComercio && /^\d+$/.test(ordenComercio)) {
        const factura = await llamarFlow<Record<string, unknown>>(
          'GET',
          'invoice/get',
          { invoiceId: ordenComercio },
          opciones,
        );
        if (factura.ok) suscripcionId = texto(factura.datos.subscriptionId);
      }
      const pago: PagoExterno = {
        estado:
          status === 2
            ? 'pagado'
            : status === 3
              ? 'rechazado'
              : status === 4
                ? 'anulado'
                : 'pendiente',
        orden: texto(r.datos.flowOrder, 100),
        ordenComercio,
        suscripcionId,
      };
      return { ok: true, datos: pago };
    },
  };
}
