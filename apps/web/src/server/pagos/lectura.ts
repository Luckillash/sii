import 'server-only';
import {
  COLUMNAS_PLAN,
  type EstadoSuscripcion,
  type Plan,
  type UsoOrganizacion,
} from '@/lib/planes';
import { clienteServidor } from '../supabase/servidor';
import { leerUso } from './uso';

// Lecturas de la página Configuración → Plan, con la sesión del usuario (RLS):
// suscripción, planes y uso los ve cualquier miembro; tarjeta y pagos, solo propietarios y
// administradores (RLS `es_admin` de `clientes_pago` y `pagos`, migración 0016).

export interface SuscripcionVista {
  estado: EstadoSuscripcion;
  plan: Plan;
  periodoInicio: string;
  periodoFin: string | null;
  cancelarAlFinPeriodo: boolean;
  /** Cobrada por la pasarela (Flow); si no, es el plan gratis o uno asignado a mano. */
  pagada: boolean;
}

export interface PagoVista {
  id: string;
  monto: number;
  estado: 'pendiente' | 'vencido' | 'pagado' | 'anulado';
  periodoInicio: string | null;
  periodoFin: string | null;
  venceEn: string | null;
  pagadoEn: string | null;
  enlacePago: string | null;
}

export interface VistaPlan {
  suscripcion: SuscripcionVista | null;
  /** Planes activos, en el orden de la grilla. */
  planes: Plan[];
  uso: UsoOrganizacion;
  /** null: no es administrador. */
  tarjeta: { marca: string | null; ultimos4: string | null } | null;
  pagos: PagoVista[] | null;
}

const ESTADOS_PAGO = new Set(['pendiente', 'vencido', 'pagado', 'anulado']);

export async function leerVistaPlan(organizacionId: string, admin: boolean): Promise<VistaPlan> {
  const db = await clienteServidor();
  const [suscripcion, planes, uso, cliente, pagos] = await Promise.all([
    db
      .from('suscripciones')
      .select(
        `estado, periodo_inicio, periodo_fin, cancelar_al_fin_periodo, proveedor_pago, plan_id`,
      )
      .eq('organizacion_id', organizacionId)
      .in('estado', ['prueba', 'activa', 'morosa'])
      .maybeSingle(),
    db.from('planes').select(COLUMNAS_PLAN).order('orden'),
    leerUso(db, organizacionId),
    admin
      ? db
          .from('clientes_pago')
          .select('tarjeta_marca, tarjeta_ultimos4')
          .eq('organizacion_id', organizacionId)
          .maybeSingle()
      : Promise.resolve(null),
    admin
      ? db
          .from('pagos')
          .select(
            'id, monto_clp, estado, periodo_inicio, periodo_fin, vence_en, pagado_en, enlace_pago',
          )
          .eq('organizacion_id', organizacionId)
          .order('periodo_inicio', { ascending: false, nullsFirst: false })
          .order('creado_en', { ascending: false })
          .limit(24)
      : Promise.resolve(null),
  ]);
  const error = suscripcion.error ?? planes.error ?? cliente?.error ?? pagos?.error;
  if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);

  const listaPlanes = planes.data ?? [];
  let vista: SuscripcionVista | null = null;
  if (suscripcion.data) {
    // Un plan inactivo (`emprendedor`) no se ve por RLS (`planes.lectura using (activo)`)
    // y `plan_vigente()` no se expone a `authenticated`: esa organización ve la grilla sin
    // «tu plan». Al 2026-11-17 nadie está en un plan inactivo.
    const plan = listaPlanes.find((p) => p.id === suscripcion.data?.plan_id) ?? null;
    if (plan) {
      vista = {
        estado: suscripcion.data.estado,
        plan,
        periodoInicio: suscripcion.data.periodo_inicio,
        periodoFin: suscripcion.data.periodo_fin,
        cancelarAlFinPeriodo: suscripcion.data.cancelar_al_fin_periodo,
        pagada: suscripcion.data.proveedor_pago !== null,
      };
    }
  }

  return {
    suscripcion: vista,
    planes: listaPlanes,
    uso,
    tarjeta: cliente?.data
      ? { marca: cliente.data.tarjeta_marca, ultimos4: cliente.data.tarjeta_ultimos4 }
      : null,
    pagos:
      pagos?.data?.map((p) => ({
        id: p.id,
        monto: p.monto_clp,
        estado: (ESTADOS_PAGO.has(p.estado) ? p.estado : 'pendiente') as PagoVista['estado'],
        periodoInicio: p.periodo_inicio,
        periodoFin: p.periodo_fin,
        venceEn: p.vence_en,
        pagadoEn: p.pagado_en,
        enlacePago: p.enlace_pago,
      })) ?? null,
  };
}
