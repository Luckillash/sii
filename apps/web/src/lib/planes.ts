import type { Database } from '@/server/supabase/tipos';

// Planes, cuotas y estado de la suscripción (PLAN-SAAS Fase 10, D5). Puro: lo usan la
// página de plan, los avisos de cuota de Emitir, Empresas y Equipo, y el servidor (para
// rechazar un cambio a un plan que no alcanza). La autoridad son los triggers de la base
// (`tg_limite_empresas`, `exigir_cupo_usuarios`, `tg_contar_uso_documento`,
// `tg_validar_documento`); esto solo avisa antes y explica.

export type FilaPlan = Database['public']['Tables']['planes']['Row'];
export type EstadoSuscripcion = Database['public']['Enums']['estado_suscripcion'];

/** Lo que la UI necesita de un plan. */
export type Plan = Pick<
  FilaPlan,
  | 'id'
  | 'codigo'
  | 'nombre'
  | 'precio_mensual_clp'
  | 'max_empresas'
  | 'max_usuarios'
  | 'max_boletas_mes'
  | 'permite_produccion'
  | 'incluye_api'
  | 'incluye_webhooks'
  | 'autoservicio'
  | 'orden'
>;

export const COLUMNAS_PLAN =
  'id, codigo, nombre, precio_mensual_clp, max_empresas, max_usuarios, max_boletas_mes, permite_produccion, incluye_api, incluye_webhooks, autoservicio, orden' as const;

/** Uso actual de la organización (lo que los límites cuentan). */
export interface UsoOrganizacion {
  empresas: number;
  usuarios: number;
  /** Boletas de producción con folio del mes calendario en curso (hora de Chile). */
  boletasProduccionMes: number;
}

/** Porcentaje del cupo desde el que se avisa (PLAN-SAAS D5: aviso al 80 % y al 100 %). */
export const UMBRAL_AVISO_CUOTA = 0.8;

export type NivelCuota = 'sin_limite' | 'normal' | 'aviso' | 'lleno';

export function nivelCuota(usadas: number, maximo: number | null): NivelCuota {
  if (maximo === null) return 'sin_limite';
  if (usadas >= maximo) return 'lleno';
  if (maximo > 0 && usadas >= Math.ceil(maximo * UMBRAL_AVISO_CUOTA)) return 'aviso';
  return 'normal';
}

/** «1.000» o «Sin límite». */
export function textoLimite(maximo: number | null): string {
  return maximo === null ? 'Sin límite' : maximo.toLocaleString('es-CL');
}

export const ETIQUETA_ESTADO_SUSCRIPCION: Record<EstadoSuscripcion, string> = {
  prueba: 'Gratis',
  activa: 'Activa',
  morosa: 'Pago vencido',
  cancelada: 'Cancelada',
};

/**
 * Por qué la organización no cabe en `plan` con su uso actual (bajar de plan). Vacío si
 * cabe. Las boletas del mes no impiden bajar: el cupo nuevo rige para las siguientes.
 */
export function limitesExcedidos(uso: UsoOrganizacion, plan: Plan): string[] {
  const motivos: string[] = [];
  if (plan.max_empresas !== null && uso.empresas > plan.max_empresas) {
    motivos.push(
      `El plan ${plan.nombre} permite ${plan.max_empresas} ${plan.max_empresas === 1 ? 'empresa' : 'empresas'} y tienes ${uso.empresas}.`,
    );
  }
  if (plan.max_usuarios !== null && uso.usuarios > plan.max_usuarios) {
    motivos.push(
      `El plan ${plan.nombre} permite ${plan.max_usuarios} ${plan.max_usuarios === 1 ? 'usuario' : 'usuarios'} y tienes ${uso.usuarios}.`,
    );
  }
  return motivos;
}

/** Características del plan para la grilla, en el orden en que se muestran. */
export function caracteristicasPlan(plan: Plan): string[] {
  const unidad = (n: number | null, uno: string, varios: string) =>
    n === null ? `${varios} sin límite` : `${n.toLocaleString('es-CL')} ${n === 1 ? uno : varios}`;
  return [
    plan.permite_produccion
      ? plan.max_boletas_mes === null
        ? 'Boletas en producción sin límite'
        : `${plan.max_boletas_mes.toLocaleString('es-CL')} boletas en producción al mes`
      : 'Solo certificación ante el SII (sin producción)',
    unidad(plan.max_empresas, 'empresa', 'empresas'),
    unidad(plan.max_usuarios, 'usuario', 'usuarios'),
    plan.incluye_api && plan.incluye_webhooks
      ? 'API y avisos por webhook'
      : plan.incluye_api
        ? 'API'
        : 'Sin API ni webhooks',
  ];
}

/** Primer día del mes en curso en Chile, `AAAA-MM-01` (clave de `uso_mensual`). */
export function periodoUsoActual(ahora: Date = new Date()): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(ahora);
  return `${dia.slice(0, 7)}-01`;
}
