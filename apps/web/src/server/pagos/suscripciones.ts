import 'server-only';
import { type EstadoSuscripcion, limitesExcedidos } from '@/lib/planes';
import type { ClienteServicio } from '../supabase/service';
import type { Database } from '../supabase/tipos';
import type { FacturaExterna, Pasarela, SuscripcionExterna } from './pasarela';
import { leerUso } from './uso';

// Suscripciones con la pasarela (PLAN-SAAS Fase 10, punto 2; D4 Flow). Todo con el
// cliente de servicio: quien llama ya comprobó la sesión y el rol (Server Actions) o es
// una ruta de la pasarela / el cron. La fuente de verdad del cobro es Flow; la base
// guarda una copia sincronizada (`suscripciones`, `pagos`) que es la que leen los
// triggers de cupos a través de `plan_vigente()`.
//
// Flujo de alta (organización en el plan gratis Certificación):
//   1. `iniciarContratacion`: crea (o reusa) el cliente de Flow, anota el plan elegido en
//      `clientes_pago.plan_pendiente_id` y devuelve la URL para registrar la tarjeta.
//   2. Flow devuelve el navegador por POST a `/api/pagos/flow/registro` con un token, SIN
//      cookies de sesión: `activarDespuesDeRegistro` confirma el registro con el token,
//      identifica la organización por el `customerId`, crea la suscripción en Flow y la
//      deja vigente con `activar_suscripcion` (una transacción).
// Con una suscripción de Flow vigente, cambiar de plan es `cambiarDePlan` (sin tarjeta).
// La mora y la cancelación las trae `sincronizarSuscripcion` (aviso de pago y cron).

export interface DependenciasPagos {
  db: ClienteServicio;
  pasarela: Pasarela;
  /** URL pública de la app, para la URL de retorno del registro de tarjeta. */
  urlApp: string;
  ahora?: () => Date;
}

export type CodigoFallaPagos =
  | 'sin_configuracion'
  | 'plan_invalido'
  | 'no_cabe'
  | 'ya_en_plan'
  | 'sin_suscripcion'
  | 'pasarela'
  | 'pasarela_red'
  | 'base';

export type FallaPagos = { ok: false; codigo: CodigoFallaPagos; detalle?: string };

type FilaPlanBase = Database['public']['Tables']['planes']['Row'];
type FilaSuscripcion = Database['public']['Tables']['suscripciones']['Row'];

/** Suscripción vigente (`prueba`, `activa` o `morosa`) o null. */
async function suscripcionVigente(
  db: ClienteServicio,
  organizacionId: string,
): Promise<FilaSuscripcion | null> {
  const { data, error } = await db
    .from('suscripciones')
    .select('*')
    .eq('organizacion_id', organizacionId)
    .in('estado', ['prueba', 'activa', 'morosa'])
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la suscripción vigente: ${error.message}`);
  return data;
}

async function planPorCodigo(db: ClienteServicio, codigo: string): Promise<FilaPlanBase | null> {
  const { data, error } = await db.from('planes').select('*').eq('codigo', codigo).maybeSingle();
  if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
  return data;
}

async function planPorId(db: ClienteServicio, id: string): Promise<FilaPlanBase | null> {
  const { data, error } = await db.from('planes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
  return data;
}

function fallaPasarela(r: { motivo: string; detalle: string }): FallaPagos {
  if (r.motivo === 'sin_configuracion') return { ok: false, codigo: 'sin_configuracion' };
  return {
    ok: false,
    codigo: r.motivo === 'red' ? 'pasarela_red' : 'pasarela',
    detalle: r.detalle,
  };
}

/** `AAAA-MM-DD` o null → valor para una columna `date`. */
function fechaOVacia(valor: string | null): string | null {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

/** Upsert de los importes de la pasarela en `pagos`. */
export async function guardarFacturas(
  db: ClienteServicio,
  organizacionId: string,
  suscripcionId: string | null,
  facturas: FacturaExterna[],
): Promise<void> {
  if (facturas.length === 0) return;
  const filas = facturas.map((f) => ({
    organizacion_id: organizacionId,
    suscripcion_id: suscripcionId,
    proveedor: 'flow',
    factura_externa: f.id,
    orden_externa: f.orden,
    monto_clp: f.monto,
    estado: f.estado,
    periodo_inicio: fechaOVacia(f.periodoInicio),
    periodo_fin: fechaOVacia(f.periodoFin),
    vence_en: fechaOVacia(f.venceEn),
    pagado_en: f.pagadoEn,
    medio: f.medio,
    enlace_pago: f.enlacePago,
    intentos: f.intentos,
    error: f.error,
  }));
  const { error } = await db
    .from('pagos')
    .upsert(filas, { onConflict: 'proveedor,factura_externa' });
  if (error) throw new Error(`No se pudieron guardar los pagos: ${error.message}`);
}

/** Estado de la app para una suscripción de Flow que no está cancelada. */
export function estadoDeExterna(ext: SuscripcionExterna): EstadoSuscripcion {
  if (ext.estado === 'cancelada') return 'cancelada';
  // Gracia (D4): Flow marca `morose = 1` recién cuando un importe pasó su `due_date`
  // (DIAS_HASTA_VENCER) sin pagarse, tras sus reintentos de cobro.
  return ext.morosidad === 'vencida' ? 'morosa' : 'activa';
}

// --------------------------------------------------------------------------------
// Sincronización (fuente de verdad: Flow)
// --------------------------------------------------------------------------------

export type ResultadoSincronizacion =
  | {
      ok: true;
      organizacionId: string;
      suscripcionId: string;
      estadoAnterior: EstadoSuscripcion;
      estadoNuevo: EstadoSuscripcion;
      /** Importe vencido más antiguo, si la suscripción quedó morosa. */
      vencido: FacturaExterna | null;
    }
  | { ok: false; organizacionId: string; suscripcionId: string; detalle: string };

export async function sincronizarSuscripcion(
  deps: DependenciasPagos,
  fila: Pick<FilaSuscripcion, 'id' | 'organizacion_id' | 'id_externo' | 'plan_id' | 'estado'>,
): Promise<ResultadoSincronizacion> {
  const base = { organizacionId: fila.organizacion_id, suscripcionId: fila.id };
  if (!fila.id_externo) return { ok: false, ...base, detalle: 'Sin suscripción externa' };
  const r = await deps.pasarela.obtenerSuscripcion(fila.id_externo);
  if (!r.ok) return { ok: false, ...base, detalle: r.detalle };
  return aplicarExterna(deps, fila, r.datos);
}

async function aplicarExterna(
  deps: DependenciasPagos,
  fila: Pick<FilaSuscripcion, 'id' | 'organizacion_id' | 'plan_id' | 'estado'>,
  ext: SuscripcionExterna,
): Promise<ResultadoSincronizacion> {
  const { db } = deps;
  const base = { organizacionId: fila.organizacion_id, suscripcionId: fila.id };
  try {
    await guardarFacturas(db, fila.organizacion_id, fila.id, ext.facturas);
    const estadoNuevo = estadoDeExterna(ext);

    if (estadoNuevo === 'cancelada') {
      if (fila.estado !== 'cancelada') {
        // Vuelve al plan gratis: `activar_suscripcion` cancela la de Flow e inserta la de
        // certificación en la misma transacción (nunca queda sin plan vigente).
        const certificacion = await planPorCodigo(db, 'certificacion');
        if (!certificacion) throw new Error('No existe el plan certificacion');
        const { error } = await db.rpc('activar_suscripcion', {
          p_organizacion: fila.organizacion_id,
          p_plan: certificacion.id,
          p_estado: 'prueba',
        });
        if (error) throw new Error(`activar_suscripcion: ${error.message}`);
        await db
          .from('suscripciones')
          .update({ sincronizada_en: (deps.ahora?.() ?? new Date()).toISOString() })
          .eq('id', fila.id);
      }
      return { ok: true, ...base, estadoAnterior: fila.estado, estadoNuevo, vencido: null };
    }

    let planId = fila.plan_id;
    if (ext.planCodigo) {
      const plan = await planPorCodigo(db, ext.planCodigo);
      if (plan) planId = plan.id;
    }
    const { error } = await db
      .from('suscripciones')
      .update({
        estado: estadoNuevo,
        plan_id: planId,
        periodo_inicio: ext.periodoInicio ?? undefined,
        periodo_fin: ext.periodoFin,
        cancelar_al_fin_periodo: ext.cancelarAlFinPeriodo,
        sincronizada_en: (deps.ahora?.() ?? new Date()).toISOString(),
      })
      .eq('id', fila.id)
      .in('estado', ['activa', 'morosa', 'prueba']);
    if (error) throw new Error(`No se pudo actualizar la suscripción: ${error.message}`);

    const vencido =
      estadoNuevo === 'morosa'
        ? ([...ext.facturas]
            .filter((f) => f.estado === 'vencido')
            .sort((a, b) => (a.venceEn ?? '').localeCompare(b.venceEn ?? ''))[0] ?? null)
        : null;
    return { ok: true, ...base, estadoAnterior: fila.estado, estadoNuevo, vencido };
  } catch (e) {
    return { ok: false, ...base, detalle: e instanceof Error ? e.message : String(e) };
  }
}

export interface ResumenSincronizacion {
  revisadas: number;
  cambiadas: number;
  morosas: number;
  canceladas: number;
  errores: number;
  resultados: ResultadoSincronizacion[];
}

/** Sincroniza las suscripciones de Flow vigentes, las menos recientes primero. */
export async function sincronizarTodas(
  deps: DependenciasPagos,
  opciones: { limite?: number; presupuestoMs?: number } = {},
): Promise<ResumenSincronizacion> {
  const inicio = Date.now();
  const { data, error } = await deps.db
    .from('suscripciones')
    .select('id, organizacion_id, id_externo, plan_id, estado')
    .eq('proveedor_pago', 'flow')
    .in('estado', ['activa', 'morosa'])
    .not('id_externo', 'is', null)
    .order('sincronizada_en', { ascending: true, nullsFirst: true })
    .limit(opciones.limite ?? 100);
  if (error) throw new Error(`No se pudieron leer las suscripciones: ${error.message}`);

  const resumen: ResumenSincronizacion = {
    revisadas: 0,
    cambiadas: 0,
    morosas: 0,
    canceladas: 0,
    errores: 0,
    resultados: [],
  };
  for (const fila of data) {
    if (opciones.presupuestoMs && Date.now() - inicio > opciones.presupuestoMs) break;
    const r = await sincronizarSuscripcion(deps, fila);
    resumen.revisadas++;
    resumen.resultados.push(r);
    if (!r.ok) {
      resumen.errores++;
      continue;
    }
    if (r.estadoNuevo !== r.estadoAnterior) resumen.cambiadas++;
    if (r.estadoNuevo === 'morosa') resumen.morosas++;
    if (r.estadoNuevo === 'cancelada') resumen.canceladas++;
  }
  return resumen;
}

// --------------------------------------------------------------------------------
// Avisos de la pasarela (idempotencia con `eventos_pasarela`)
// --------------------------------------------------------------------------------

type TipoEvento = 'registro' | 'pago';
type Reclamo =
  | { tomado: true; id: string; datos: Record<string, unknown> }
  | {
      tomado: false;
      estado: string;
      datos: Record<string, unknown>;
      organizacionId: string | null;
    };

/** Un aviso en curso (`recibido`) se da por abandonado tras este tiempo. */
const AVISO_ABANDONADO_MS = 2 * 60_000;

async function reclamarEvento(
  deps: DependenciasPagos,
  tipo: TipoEvento,
  token: string,
): Promise<Reclamo> {
  const { db } = deps;
  const nuevo = await db
    .from('eventos_pasarela')
    .insert({ proveedor: 'flow', tipo, token })
    .select('id')
    .single();
  if (!nuevo.error) return { tomado: true, id: nuevo.data.id, datos: {} };
  if (nuevo.error.code !== '23505') throw new Error(`eventos_pasarela: ${nuevo.error.message}`);

  const { data: existente, error } = await db
    .from('eventos_pasarela')
    .select('id, estado, datos, intentos, recibido_en, organizacion_id')
    .eq('proveedor', 'flow')
    .eq('tipo', tipo)
    .eq('token', token)
    .single();
  if (error) throw new Error(`eventos_pasarela: ${error.message}`);
  const datos = (existente.datos ?? {}) as Record<string, unknown>;
  const enCurso =
    existente.estado === 'recibido' &&
    Date.now() - new Date(existente.recibido_en).getTime() < AVISO_ABANDONADO_MS;
  if (existente.estado === 'procesado' || existente.estado === 'ignorado' || enCurso) {
    return {
      tomado: false,
      estado: enCurso ? 'en_curso' : existente.estado,
      datos,
      organizacionId: existente.organizacion_id,
    };
  }
  // Fallido o abandonado: se vuelve a tomar (conserva `datos`, p. ej. la suscripción ya creada).
  const { data: retomado, error: e2 } = await db
    .from('eventos_pasarela')
    .update({
      estado: 'recibido',
      intentos: existente.intentos + 1,
      recibido_en: new Date().toISOString(),
    })
    .eq('id', existente.id)
    .eq('estado', existente.estado)
    .select('id')
    .maybeSingle();
  if (e2) throw new Error(`eventos_pasarela: ${e2.message}`);
  if (!retomado) {
    return { tomado: false, estado: 'en_curso', datos, organizacionId: existente.organizacion_id };
  }
  return { tomado: true, id: existente.id, datos };
}

async function cerrarEvento(
  db: ClienteServicio,
  id: string,
  estado: 'procesado' | 'ignorado' | 'fallido',
  cambios: { organizacionId?: string | null; datos?: Record<string, unknown>; error?: string },
): Promise<void> {
  await db
    .from('eventos_pasarela')
    .update({
      estado,
      procesado_en: new Date().toISOString(),
      ...(cambios.organizacionId !== undefined ? { organizacion_id: cambios.organizacionId } : {}),
      ...(cambios.datos
        ? {
            datos:
              cambios.datos as Database['public']['Tables']['eventos_pasarela']['Row']['datos'],
          }
        : {}),
      ...(cambios.error !== undefined ? { error: cambios.error.slice(0, 500) } : {}),
    })
    .eq('id', id);
}

async function guardarDatosEvento(
  db: ClienteServicio,
  id: string,
  datos: Record<string, unknown>,
): Promise<void> {
  await db
    .from('eventos_pasarela')
    .update({ datos: datos as Database['public']['Tables']['eventos_pasarela']['Row']['datos'] })
    .eq('id', id);
}

// --------------------------------------------------------------------------------
// Alta: contratar un plan desde el plan gratis
// --------------------------------------------------------------------------------

export type ResultadoContratacion =
  | { ok: true; tipo: 'redirigir'; url: string }
  /** Ya tiene una suscripción de Flow vigente: se cambia de plan sin tarjeta. */
  | { ok: true; tipo: 'cambio' }
  | FallaPagos;

async function planContratable(db: ClienteServicio, codigo: string): Promise<FilaPlanBase | null> {
  const plan = await planPorCodigo(db, codigo);
  return plan?.activo && plan.autoservicio ? plan : null;
}

async function verificarQueCabe(
  db: ClienteServicio,
  organizacionId: string,
  plan: FilaPlanBase,
): Promise<FallaPagos | null> {
  const motivos = limitesExcedidos(await leerUso(db, organizacionId), plan);
  return motivos.length > 0 ? { ok: false, codigo: 'no_cabe', detalle: motivos.join(' ') } : null;
}

export async function iniciarContratacion(
  deps: DependenciasPagos,
  entrada: {
    organizacion: { id: string; nombre: string };
    usuario: { id: string; correo: string };
    planCodigo: string;
  },
): Promise<ResultadoContratacion> {
  const { db, pasarela } = deps;
  const plan = await planContratable(db, entrada.planCodigo);
  if (!plan) return { ok: false, codigo: 'plan_invalido' };
  const noCabe = await verificarQueCabe(db, entrada.organizacion.id, plan);
  if (noCabe) return noCabe;

  const vigente = await suscripcionVigente(db, entrada.organizacion.id);
  if (vigente?.proveedor_pago === 'flow' && vigente.id_externo) {
    if (vigente.plan_id === plan.id) return { ok: false, codigo: 'ya_en_plan' };
    return { ok: true, tipo: 'cambio' };
  }

  const asegurado = await pasarela.asegurarPlan({
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioMensualClp: plan.precio_mensual_clp,
  });
  if (!asegurado.ok) return fallaPasarela(asegurado);

  const { data: existente, error } = await db
    .from('clientes_pago')
    .select('cliente_externo')
    .eq('organizacion_id', entrada.organizacion.id)
    .maybeSingle();
  if (error) return { ok: false, codigo: 'base', detalle: error.message };

  let clienteId = existente?.cliente_externo ?? null;
  if (!clienteId) {
    const creado = await pasarela.crearCliente({
      nombre: entrada.organizacion.nombre,
      correo: entrada.usuario.correo,
      idInterno: entrada.organizacion.id,
    });
    if (!creado.ok) return fallaPasarela(creado);
    clienteId = creado.datos.id;
    const { error: e } = await db.from('clientes_pago').insert({
      organizacion_id: entrada.organizacion.id,
      proveedor: 'flow',
      cliente_externo: clienteId,
    });
    if (e) return { ok: false, codigo: 'base', detalle: e.message };
  }

  const { error: e3 } = await db
    .from('clientes_pago')
    .update({
      plan_pendiente_id: plan.id,
      plan_pendiente_por: entrada.usuario.id,
      plan_pendiente_en: new Date().toISOString(),
    })
    .eq('organizacion_id', entrada.organizacion.id);
  if (e3) return { ok: false, codigo: 'base', detalle: e3.message };

  const registro = await pasarela.iniciarRegistroTarjeta(
    clienteId,
    `${deps.urlApp.replace(/\/$/, '')}/api/pagos/flow/registro`,
  );
  if (!registro.ok) return fallaPasarela(registro);
  return { ok: true, tipo: 'redirigir', url: registro.datos.url };
}

export type ResultadoRetorno = {
  /** Slug de la organización para volver a su página de plan, si se pudo identificar. */
  slug: string | null;
  resultado:
    | 'suscrita'
    | 'plan_cambiado'
    | 'tarjeta_actualizada'
    | 'tarjeta_rechazada'
    | 'en_proceso'
    | 'error';
};

async function slugDe(db: ClienteServicio, organizacionId: string | null): Promise<string | null> {
  if (!organizacionId) return null;
  const { data } = await db
    .from('organizaciones')
    .select('slug')
    .eq('id', organizacionId)
    .maybeSingle();
  return data?.slug ?? null;
}

/**
 * Retorno del registro de tarjeta (`/api/pagos/flow/registro`). Nunca lanza por un dato
 * de Flow: devuelve `error` y deja el detalle en `eventos_pasarela` (y en `alertar`, que
 * la ruta manda a Sentry, sin el token).
 */
export async function activarDespuesDeRegistro(
  deps: DependenciasPagos,
  token: string,
  alertar: (mensaje: string, extra: Record<string, string>) => void = () => {},
): Promise<ResultadoRetorno> {
  const { db, pasarela } = deps;
  const reclamo = await reclamarEvento(deps, 'registro', token);
  if (!reclamo.tomado) {
    const slug = await slugDe(db, reclamo.organizacionId);
    if (reclamo.estado === 'en_curso') return { slug, resultado: 'en_proceso' };
    const previo = reclamo.datos.resultado;
    return {
      slug,
      resultado:
        previo === 'suscrita' ||
        previo === 'plan_cambiado' ||
        previo === 'tarjeta_actualizada' ||
        previo === 'tarjeta_rechazada'
          ? previo
          : 'error',
    };
  }
  const evento = reclamo.id;
  const datos: Record<string, unknown> = { ...reclamo.datos };

  const registro = await pasarela.estadoRegistroTarjeta(token);
  if (!registro.ok) {
    await cerrarEvento(db, evento, 'fallido', { error: registro.detalle });
    return { slug: null, resultado: 'error' };
  }

  const { data: cliente, error: eCliente } = await db
    .from('clientes_pago')
    .select('organizacion_id, plan_pendiente_id')
    .eq('proveedor', 'flow')
    .eq('cliente_externo', registro.datos.clienteId)
    .maybeSingle();
  if (eCliente || !cliente) {
    await cerrarEvento(db, evento, eCliente ? 'fallido' : 'ignorado', {
      error: eCliente?.message ?? 'Cliente de Flow desconocido',
    });
    return { slug: null, resultado: 'error' };
  }
  const org = cliente.organizacion_id;
  const slug = await slugDe(db, org);

  if (!registro.datos.registrada) {
    await cerrarEvento(db, evento, 'procesado', {
      organizacionId: org,
      datos: { ...datos, resultado: 'tarjeta_rechazada' },
    });
    return { slug, resultado: 'tarjeta_rechazada' };
  }

  try {
    const { error: eTarjeta } = await db
      .from('clientes_pago')
      .update({
        tarjeta_marca: registro.datos.marca,
        tarjeta_ultimos4: registro.datos.ultimos4,
        tarjeta_registrada_en: new Date().toISOString(),
      })
      .eq('organizacion_id', org);
    if (eTarjeta) throw new Error(eTarjeta.message);

    if (!cliente.plan_pendiente_id) {
      await cerrarEvento(db, evento, 'procesado', {
        organizacionId: org,
        datos: { ...datos, resultado: 'tarjeta_actualizada' },
      });
      return { slug, resultado: 'tarjeta_actualizada' };
    }

    const plan = await planPorId(db, cliente.plan_pendiente_id);
    if (!plan?.activo || !plan.autoservicio) throw new Error('El plan pendiente ya no se contrata');

    const vigente = await suscripcionVigente(db, org);
    let resultado: 'suscrita' | 'plan_cambiado' = 'suscrita';
    if (vigente?.proveedor_pago === 'flow' && vigente.id_externo) {
      // Ya estaba suscrita (p. ej. registró otra tarjeta con un plan elegido): cambio de plan.
      if (vigente.plan_id !== plan.id) {
        const cambio = await cambiarEnPasarela(
          deps,
          vigente as FilaSuscripcion & { id_externo: string },
          plan,
        );
        if (!cambio.ok) throw new Error(cambio.detalle ?? cambio.codigo);
        resultado = 'plan_cambiado';
      }
    } else {
      const asegurado = await pasarela.asegurarPlan({
        codigo: plan.codigo,
        nombre: plan.nombre,
        precioMensualClp: plan.precio_mensual_clp,
      });
      if (!asegurado.ok) throw new Error(asegurado.detalle);

      // Si un intento anterior de este mismo aviso ya creó la suscripción en Flow, se
      // reusa: crear otra cobraría dos veces.
      let ext: SuscripcionExterna;
      const yaCreada =
        typeof datos.suscripcion_externa === 'string' ? datos.suscripcion_externa : null;
      if (yaCreada) {
        const r = await pasarela.obtenerSuscripcion(yaCreada);
        if (!r.ok) throw new Error(r.detalle);
        ext = r.datos;
      } else {
        const r = await pasarela.crearSuscripcion(registro.datos.clienteId, plan.codigo);
        if (!r.ok) throw new Error(r.detalle);
        ext = r.datos;
        datos.suscripcion_externa = ext.id;
        await guardarDatosEvento(db, evento, datos);
      }

      const { data: suscripcionId, error: eActivar } = await db.rpc('activar_suscripcion', {
        p_organizacion: org,
        p_plan: plan.id,
        p_estado: 'activa',
        p_proveedor: 'flow',
        p_id_externo: ext.id,
        ...(ext.periodoInicio ? { p_periodo_inicio: ext.periodoInicio } : {}),
        ...(ext.periodoFin ? { p_periodo_fin: ext.periodoFin } : {}),
      });
      if (eActivar || !suscripcionId) {
        alertar('pagos: suscripción creada en Flow sin activar en la base', {
          suscripcion_externa: ext.id,
          organizacion: org,
        });
        throw new Error(`activar_suscripcion: ${eActivar?.message ?? 'sin id'}`);
      }
      await guardarFacturas(db, org, suscripcionId, ext.facturas);
      if (estadoDeExterna(ext) === 'morosa') {
        await db.from('suscripciones').update({ estado: 'morosa' }).eq('id', suscripcionId);
      }
    }

    await db
      .from('clientes_pago')
      .update({ plan_pendiente_id: null, plan_pendiente_por: null, plan_pendiente_en: null })
      .eq('organizacion_id', org);
    await cerrarEvento(db, evento, 'procesado', {
      organizacionId: org,
      datos: { ...datos, resultado, plan: plan.codigo },
    });
    return { slug, resultado };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    await cerrarEvento(db, evento, 'fallido', { organizacionId: org, datos, error: detalle });
    return { slug, resultado: 'error' };
  }
}

// --------------------------------------------------------------------------------
// Cambio de plan y cancelación (con suscripción de Flow vigente)
// --------------------------------------------------------------------------------

async function suscripcionFlowVigente(
  db: ClienteServicio,
  organizacionId: string,
): Promise<(FilaSuscripcion & { id_externo: string }) | null> {
  const vigente = await suscripcionVigente(db, organizacionId);
  return vigente?.proveedor_pago === 'flow' && vigente.id_externo
    ? (vigente as FilaSuscripcion & { id_externo: string })
    : null;
}

export type ResultadoVistaPrevia =
  | {
      ok: true;
      plan: { codigo: string; nombre: string; precio: number };
      /** Negativo: saldo a favor; positivo: cargo al cambiar. */
      saldo: number;
      proximoCobro: string | null;
    }
  | FallaPagos;

export async function previsualizarCambio(
  deps: DependenciasPagos,
  organizacionId: string,
  planCodigo: string,
): Promise<ResultadoVistaPrevia> {
  const { db, pasarela } = deps;
  const plan = await planContratable(db, planCodigo);
  if (!plan) return { ok: false, codigo: 'plan_invalido' };
  const vigente = await suscripcionFlowVigente(db, organizacionId);
  if (!vigente) return { ok: false, codigo: 'sin_suscripcion' };
  if (vigente.plan_id === plan.id) return { ok: false, codigo: 'ya_en_plan' };
  const noCabe = await verificarQueCabe(db, organizacionId, plan);
  if (noCabe) return noCabe;
  const asegurado = await pasarela.asegurarPlan({
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioMensualClp: plan.precio_mensual_clp,
  });
  if (!asegurado.ok) return fallaPasarela(asegurado);
  const r = await pasarela.previsualizarCambioPlan(vigente.id_externo, plan.codigo);
  if (!r.ok) return fallaPasarela(r);
  return {
    ok: true,
    plan: { codigo: plan.codigo, nombre: plan.nombre, precio: plan.precio_mensual_clp },
    saldo: r.datos.saldo,
    proximoCobro: r.datos.proximoCobro,
  };
}

export type ResultadoCambio =
  | {
      ok: true;
      plan: string;
      /** El plan nuevo ya rige (Flow lo informa); si no, rige desde `desde`. */
      aplicado: boolean;
      desde: string | null;
      /**
       * false: Flow aceptó el cambio pero no se pudo leer después. NO es una falla (el cambio
       * y su posible cobro ya se hicieron): el cron lo reconcilia, y no hay que repetirlo.
       */
      sincronizado: boolean;
    }
  | FallaPagos;

async function cambiarEnPasarela(
  deps: DependenciasPagos,
  vigente: FilaSuscripcion & { id_externo: string },
  plan: FilaPlanBase,
): Promise<ResultadoCambio> {
  const { pasarela } = deps;
  const asegurado = await pasarela.asegurarPlan({
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioMensualClp: plan.precio_mensual_clp,
  });
  if (!asegurado.ok) return fallaPasarela(asegurado);
  const cambio = await pasarela.cambiarPlan(vigente.id_externo, plan.codigo);
  if (!cambio.ok) return fallaPasarela(cambio);
  const sync = await sincronizarSuscripcion(deps, vigente);
  if (!sync.ok) {
    return {
      ok: true,
      plan: plan.nombre,
      aplicado: false,
      desde: cambio.datos.proximoCobro,
      sincronizado: false,
    };
  }
  const { data } = await deps.db
    .from('suscripciones')
    .select('plan_id')
    .eq('id', vigente.id)
    .maybeSingle();
  return {
    ok: true,
    plan: plan.nombre,
    aplicado: data?.plan_id === plan.id,
    desde: cambio.datos.proximoCobro,
    sincronizado: true,
  };
}

export async function cambiarDePlan(
  deps: DependenciasPagos,
  organizacionId: string,
  planCodigo: string,
): Promise<ResultadoCambio> {
  const { db } = deps;
  const plan = await planContratable(db, planCodigo);
  if (!plan) return { ok: false, codigo: 'plan_invalido' };
  const vigente = await suscripcionFlowVigente(db, organizacionId);
  if (!vigente) return { ok: false, codigo: 'sin_suscripcion' };
  if (vigente.plan_id === plan.id) return { ok: false, codigo: 'ya_en_plan' };
  const noCabe = await verificarQueCabe(db, organizacionId, plan);
  if (noCabe) return noCabe;
  return cambiarEnPasarela(deps, vigente, plan);
}

export type ResultadoCancelacion = { ok: true; hasta: string | null } | FallaPagos;

/** Cancela al final del período pagado; hasta entonces rige el plan actual. */
export async function cancelarSuscripcion(
  deps: DependenciasPagos,
  organizacionId: string,
): Promise<ResultadoCancelacion> {
  const { db, pasarela } = deps;
  const vigente = await suscripcionFlowVigente(db, organizacionId);
  if (!vigente) return { ok: false, codigo: 'sin_suscripcion' };
  const r = await pasarela.cancelarSuscripcion(vigente.id_externo, true);
  if (!r.ok) return fallaPasarela(r);
  const sync = await aplicarExterna(deps, vigente, r.datos);
  if (!sync.ok) return { ok: false, codigo: 'base', detalle: sync.detalle };
  if (r.datos.estado !== 'cancelada') {
    await db.from('suscripciones').update({ cancelar_al_fin_periodo: true }).eq('id', vigente.id);
  }
  return { ok: true, hasta: r.datos.periodoFin };
}

// --------------------------------------------------------------------------------
// Aviso de pago (callback del plan)
// --------------------------------------------------------------------------------

export type ResultadoAvisoPago = {
  estado: 'procesado' | 'repetido' | 'ignorado' | 'fallido';
  sincronizadas: ResultadoSincronizacion[];
};

/** Cuántas suscripciones revisa como máximo un aviso que no se pudo asociar. */
const LIMITE_SIN_ASOCIAR = 20;

export async function procesarAvisoPago(
  deps: DependenciasPagos,
  token: string,
): Promise<ResultadoAvisoPago> {
  const { db, pasarela } = deps;
  const reclamo = await reclamarEvento(deps, 'pago', token);
  if (!reclamo.tomado) return { estado: 'repetido', sincronizadas: [] };

  const pago = await pasarela.pagoDeAviso(token);
  if (!pago.ok) {
    await cerrarEvento(db, reclamo.id, 'fallido', { error: pago.detalle });
    return { estado: 'fallido', sincronizadas: [] };
  }
  const datos = {
    estado_pago: pago.datos.estado,
    orden: pago.datos.orden,
    suscripcion_externa: pago.datos.suscripcionId,
  };

  if (pago.datos.suscripcionId) {
    const { data: fila } = await db
      .from('suscripciones')
      .select('id, organizacion_id, id_externo, plan_id, estado')
      .eq('proveedor_pago', 'flow')
      .eq('id_externo', pago.datos.suscripcionId)
      .maybeSingle();
    if (!fila) {
      await cerrarEvento(db, reclamo.id, 'ignorado', { datos, error: 'Suscripción desconocida' });
      return { estado: 'ignorado', sincronizadas: [] };
    }
    const r = await sincronizarSuscripcion(deps, fila);
    await cerrarEvento(db, reclamo.id, r.ok ? 'procesado' : 'fallido', {
      organizacionId: fila.organizacion_id,
      datos,
      ...(r.ok ? {} : { error: r.detalle }),
    });
    return { estado: r.ok ? 'procesado' : 'fallido', sincronizadas: [r] };
  }

  // No se pudo saber de qué suscripción es: se revisan las vigentes (el cron hace lo
  // mismo cada hora, así que esto solo adelanta el cambio).
  const resumen = await sincronizarTodas(deps, {
    limite: LIMITE_SIN_ASOCIAR,
    presupuestoMs: 10_000,
  });
  await cerrarEvento(db, reclamo.id, resumen.errores > 0 ? 'fallido' : 'procesado', {
    datos: { ...datos, sin_asociar: true, revisadas: resumen.revisadas },
  });
  return {
    estado: resumen.errores > 0 ? 'fallido' : 'procesado',
    sincronizadas: resumen.resultados,
  };
}
