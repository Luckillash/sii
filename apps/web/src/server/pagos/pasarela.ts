import 'server-only';
import type { ResultadoFlow } from './flow';

// Adaptador de la pasarela de pagos (PLAN-SAAS Fase 10, punto 2). La app habla con
// esta interfaz y la implementación concreta (Flow, D4: `flow-pasarela.ts`) traduce a
// su API. Si mañana se suma Transbank Oneclick, es otra implementación de lo mismo.
//
// Los tipos están normalizados: fechas ISO (instantes en UTC; días como `AAAA-MM-DD`),
// montos como número de pesos, estados con nombres de la app.

export type Proveedor = 'flow';

export type ResultadoPasarela<T> = ResultadoFlow<T>;

/** Lo que la pasarela necesita saber de un plan de `planes` para cobrarlo. */
export interface PlanCobrable {
  codigo: string;
  nombre: string;
  precioMensualClp: number;
}

export type EstadoFactura = 'pendiente' | 'vencido' | 'pagado' | 'anulado';

export interface FacturaExterna {
  id: string;
  monto: number;
  estado: EstadoFactura;
  /** `AAAA-MM-DD` */
  periodoInicio: string | null;
  periodoFin: string | null;
  venceEn: string | null;
  /** Instante ISO. */
  pagadoEn: string | null;
  orden: string | null;
  medio: string | null;
  enlacePago: string | null;
  intentos: number;
  error: string | null;
}

export interface SuscripcionExterna {
  id: string;
  /** Código del plan en `planes` (sin el prefijo de la pasarela), o null si no es nuestro. */
  planCodigo: string | null;
  clienteId: string;
  /** `no_iniciada` y `prueba` existen en Flow; la app no los usa al crear. */
  estado: 'no_iniciada' | 'activa' | 'prueba' | 'cancelada';
  /** Flow `morose`: 0 al día · 1 con importes vencidos · 2 con pendientes no vencidos. */
  morosidad: 'al_dia' | 'vencida' | 'pendiente';
  /** Instantes ISO del período en curso. */
  periodoInicio: string | null;
  periodoFin: string | null;
  cancelarAlFinPeriodo: boolean;
  facturas: FacturaExterna[];
}

export interface RegistroTarjeta {
  registrada: boolean;
  clienteId: string;
  marca: string | null;
  ultimos4: string | null;
}

export interface CambioPlan {
  /** Negativo: saldo a favor (descuento); positivo: cargo inmediato. */
  saldo: number;
  /** `AAAA-MM-DD` del próximo cobro, si la pasarela lo informa. */
  proximoCobro: string | null;
}

export interface PagoExterno {
  /** Estado del pago: pendiente, pagado, rechazado o anulado. */
  estado: 'pendiente' | 'pagado' | 'rechazado' | 'anulado';
  orden: string | null;
  ordenComercio: string | null;
  /** Suscripción a la que pertenece el pago, si se pudo averiguar. */
  suscripcionId: string | null;
}

export interface Pasarela {
  readonly proveedor: Proveedor;
  /** Crea el plan en la pasarela si no existe; si existe con otro precio, falla. */
  asegurarPlan(plan: PlanCobrable): Promise<ResultadoPasarela<void>>;
  crearCliente(datos: {
    nombre: string;
    correo: string;
    idInterno: string;
  }): Promise<ResultadoPasarela<{ id: string }>>;
  /** URL a la que se redirige al navegador para registrar la tarjeta. */
  iniciarRegistroTarjeta(
    clienteId: string,
    urlRetorno: string,
  ): Promise<ResultadoPasarela<{ url: string }>>;
  estadoRegistroTarjeta(token: string): Promise<ResultadoPasarela<RegistroTarjeta>>;
  crearSuscripcion(
    clienteId: string,
    planCodigo: string,
  ): Promise<ResultadoPasarela<SuscripcionExterna>>;
  obtenerSuscripcion(id: string): Promise<ResultadoPasarela<SuscripcionExterna>>;
  previsualizarCambioPlan(id: string, planCodigo: string): Promise<ResultadoPasarela<CambioPlan>>;
  cambiarPlan(id: string, planCodigo: string): Promise<ResultadoPasarela<CambioPlan>>;
  cancelarSuscripcion(
    id: string,
    alFinDelPeriodo: boolean,
  ): Promise<ResultadoPasarela<SuscripcionExterna>>;
  /** Resultado de un aviso de pago (el callback solo trae un token). */
  pagoDeAviso(token: string): Promise<ResultadoPasarela<PagoExterno>>;
}
