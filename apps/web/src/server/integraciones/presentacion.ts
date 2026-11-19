import type { Alcance, AmbienteSii, EstadoEntregaWebhook, EventoWebhook } from '@/lib/api-publica';

// Tipos y reglas de presentación de Configuración → API y Webhooks (PLAN-SAAS Fase 11).
// Puro, sin `server-only`: lo importan los componentes cliente (como `equipo-errores`) y
// `lectura.ts`. Nada de secretos: `clave_hash` y `secreto_secret_id` nunca salen de la base.

export type EstadoClave = 'activa' | 'revocada' | 'vencida';

export interface ClaveApiVista {
  id: string;
  nombre: string;
  /** Los 12 primeros caracteres: `sk_test_ab12`. */
  prefijo: string;
  alcances: Alcance[];
  ambiente: AmbienteSii;
  empresa: { id: string; rut: string; razonSocial: string } | null;
  expiraEn: string | null;
  ultimoUsoEn: string | null;
  revocadaEn: string | null;
  creadaEn: string;
}

export interface EntregaVista {
  id: number;
  evento: string;
  estado: EstadoEntregaWebhook;
  intentos: number;
  ultimoStatusHttp: number | null;
  ultimaRespuesta: string | null;
  siguienteIntentoEn: string;
  entregadoEn: string | null;
  reenviadaEn: string | null;
  creadoEn: string;
}

export interface WebhookVista {
  id: string;
  url: string;
  eventos: EventoWebhook[];
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export interface WebhookConResumen extends WebhookVista {
  /** Las últimas entregas, de la más nueva a la más vieja (hasta 5). */
  ultimas: EntregaVista[];
}

/** `vencida` gana a `activa`; `revocada` gana a todo. */
export function estadoClave(
  clave: Pick<ClaveApiVista, 'revocadaEn' | 'expiraEn'>,
  ahora: Date = new Date(),
): EstadoClave {
  if (clave.revocadaEn) return 'revocada';
  if (clave.expiraEn && new Date(clave.expiraEn).getTime() <= ahora.getTime()) return 'vencida';
  return 'activa';
}

export const ETIQUETA_ESTADO_CLAVE: Record<EstadoClave, string> = {
  activa: 'Activa',
  revocada: 'Revocada',
  vencida: 'Vencida',
};

export const ETIQUETA_AMBIENTE: Record<AmbienteSii, string> = {
  certificacion: 'Certificación',
  produccion: 'Producción',
};

/** Prefijo visible con puntos suspensivos: `sk_test_ab12…`. */
export function prefijoVisible(prefijo: string): string {
  return `${prefijo}…`;
}

/** Plazos de expiración que ofrece el formulario (días; vacío = sin plazo). */
export const PLAZOS_EXPIRACION = [
  { valor: '', etiqueta: 'Sin plazo' },
  { valor: '30', etiqueta: '30 días' },
  { valor: '90', etiqueta: '90 días' },
  { valor: '365', etiqueta: '1 año' },
] as const;

export type PlazoExpiracion = (typeof PLAZOS_EXPIRACION)[number]['valor'];

/** Fecha de expiración (ISO) para un plazo en días desde `ahora`, o `null` sin plazo. */
export function expiracionDesde(plazo: PlazoExpiracion, ahora: Date = new Date()): string | null {
  if (plazo === '') return null;
  return new Date(ahora.getTime() + Number(plazo) * 86_400_000).toISOString();
}

/**
 * ¿Fallaron las últimas `cuantas` entregas con resultado (más nueva primero)? Las que siguen
 * en cola (`pendiente`) no cuentan: todavía no tienen resultado.
 */
export function fallasSeguidas(ultimas: readonly EntregaVista[], cuantas = 3): boolean {
  const intentadas = ultimas.filter((e) => e.estado !== 'pendiente');
  if (intentadas.length < cuantas) return false;
  return intentadas
    .slice(0, cuantas)
    .every((e) => e.estado === 'fallido' || e.estado === 'descartado');
}

/** Se puede reenviar lo que ya terminó o está esperando un reintento (no lo que está en cola). */
export function sePuedeReenviar(entrega: Pick<EntregaVista, 'estado'>): boolean {
  return entrega.estado !== 'pendiente';
}
