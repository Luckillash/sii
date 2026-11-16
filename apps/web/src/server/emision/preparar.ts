import 'server-only';
import {
  type BorradorValido,
  type MotivoAmbienteBloqueado,
  RECEPTOR_GENERICO,
} from '@/lib/emision';
import type { AmbienteSii } from '@/lib/folios';
import { hoyEnChile } from '@/lib/formatos';
import { type FilaEmpresaDb, fallaBase } from '../certificacion/comun';
import { type FoliosDisponibles, foliosDisponibles } from '../folios/disponibles';
import { planPermiteProduccion } from '../folios/plan';
import type { Credenciales, CredencialesCertificado } from '../sii/credenciales';
import type { ClienteServicio } from '../supabase/service';
import {
  errorAmbiente,
  errorCuota,
  errorEmpresaNoEncontrada,
  errorReceptorSinRazonSocial,
  errorSinFolios,
} from './errores';
import type { ContextoEmision } from './tipos';

// Validación previa de una emisión (PLAN-SAAS Fase 7, paso 1). Corre en el ensayo, antes
// de abrir la operación (un dato que falta no deja filas ni consume folios) y otra vez
// dentro de `ejecutarOperacion`. Todo con service_role, filtrando por organización.
//
// Orden (el mismo de los motivos de la vista, `motivoAmbiente`): empresa de la
// organización y activa; en producción, autorización (P91 o resolución) y plan; resolución
// vigente del ambiente; certificado vigente; folios; y en producción la cuota del mes (para
// no quemar un folio que `tg_contar_uso_documento` rechazaría).

/** Datos con que se decide si un ambiente está habilitado (vista y servidor). */
export interface DatosAmbiente {
  activa: boolean;
  autorizadaProduccion: boolean;
  /** `null` si no se pudo leer: la vista no bloquea por esto y decide el servidor. */
  planPermiteProduccion: boolean | null;
  conResolucion: boolean;
  conCertificado: boolean;
}

/** Por qué no se puede emitir en un ambiente, o `null` si se puede. */
export function motivoAmbiente(
  ambiente: AmbienteSii,
  datos: DatosAmbiente,
): MotivoAmbienteBloqueado | null {
  if (!datos.activa) return 'empresa_inactiva';
  if (ambiente === 'produccion') {
    if (!datos.autorizadaProduccion) return 'sin_autorizacion';
    if (datos.planPermiteProduccion === false) return 'plan_sin_produccion';
  }
  if (!datos.conResolucion) return 'sin_resolucion';
  if (!datos.conCertificado) return 'sin_certificado';
  return null;
}

/** Primer día del mes en Chile (`uso_mensual.periodo`, como `tg_contar_uso_documento`). */
export function periodoChile(ahora: Date): string {
  return `${hoyEnChile(ahora).slice(0, 7)}-01`;
}

export interface ReceptorListo {
  rut: string;
  razonSocial: string;
  correo: string | null;
  generico: boolean;
}

/** El receptor con la razón social que exige `ArmadorBoleta` (Cliente General si es genérico). */
export function receptorListo(borrador: BorradorValido): ReceptorListo {
  const r = borrador.receptor;
  const generico = r.rut === RECEPTOR_GENERICO.rut;
  const razonSocial = generico ? RECEPTOR_GENERICO.razonSocial : (r.razonSocial ?? '').trim();
  if (razonSocial === '') throw errorReceptorSinRazonSocial();
  return { rut: r.rut, razonSocial, correo: r.correo ?? null, generico };
}

export interface Preparacion {
  empresa: FilaEmpresaDb;
  resolucion: { numero: number; fecha: string };
  certificado: CredencialesCertificado;
  folios: FoliosDisponibles;
  receptor: ReceptorListo;
}

async function leerEmpresa(cliente: ClienteServicio, ctx: Omit<ContextoEmision, 'usuarioId'>) {
  const { data, error } = await cliente
    .from('empresas')
    .select('id, rut, razon_social, giro, direccion, comuna, activa, autorizada_produccion')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.empresaId)
    .maybeSingle();
  if (error) throw fallaBase('leer la empresa', error);
  if (!data) throw errorEmpresaNoEncontrada();
  return data;
}

/** Resolución vigente del ambiente (la de la carátula), o `null`. */
export async function resolucionVigente(
  cliente: ClienteServicio,
  ctx: Omit<ContextoEmision, 'usuarioId'>,
  ambiente: AmbienteSii,
): Promise<{ numero: number; fecha: string } | null> {
  const { data, error } = await cliente
    .from('resoluciones')
    .select('numero, fecha')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', ambiente)
    .eq('vigente', true)
    .maybeSingle();
  if (error) throw fallaBase('leer la resolución', error);
  return data;
}

/** Límite de boletas de producción del plan vigente (`null` = sin límite o sin plan). */
async function limiteBoletasMes(
  cliente: ClienteServicio,
  organizacionId: string,
): Promise<number | null> {
  const { data, error } = await cliente.rpc('plan_vigente', { p_organizacion: organizacionId });
  if (error) throw fallaBase('leer el plan vigente', error);
  const plan = (Array.isArray(data) ? data[0] : data) as { max_boletas_mes?: unknown } | null;
  return typeof plan?.max_boletas_mes === 'number' ? plan.max_boletas_mes : null;
}

/** Boletas de producción ya contadas este mes (`uso_mensual`). */
async function boletasDelMes(
  cliente: ClienteServicio,
  organizacionId: string,
  ahora: Date,
): Promise<number> {
  const { data, error } = await cliente
    .from('uso_mensual')
    .select('boletas_produccion')
    .eq('organizacion_id', organizacionId)
    .eq('periodo', periodoChile(ahora))
    .maybeSingle();
  if (error) throw fallaBase('leer el uso del mes', error);
  return data?.boletas_produccion ?? 0;
}

/** Valida todo lo que la emisión necesita, sin escribir nada. Lanza el primer problema. */
export async function prepararEmision(
  cliente: ClienteServicio,
  ctx: ContextoEmision,
  borrador: BorradorValido,
  credenciales: Credenciales,
  ahora: Date,
): Promise<Preparacion> {
  const { ambiente, tipoDte } = borrador;
  const receptor = receptorListo(borrador);

  const empresa = await leerEmpresa(cliente, ctx);
  if (!empresa.activa) throw errorAmbiente('empresa_inactiva', ambiente);
  if (ambiente === 'produccion') {
    if (!empresa.autorizada_produccion) throw errorAmbiente('sin_autorizacion', ambiente);
    if (!(await planPermiteProduccion(cliente, ctx.organizacionId))) {
      throw errorAmbiente('plan_sin_produccion', ambiente);
    }
  }

  const resolucion = await resolucionVigente(cliente, ctx, ambiente);
  if (!resolucion) throw errorAmbiente('sin_resolucion', ambiente);

  // ErrorCredenciales trae su propio mensaje (sin certificado, revocado, vencido...).
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });

  const folios = await foliosDisponibles(cliente, {
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    ambiente,
    tipoDte,
  });
  if (folios.total <= 0 || !folios.primero) throw errorSinFolios(tipoDte, ambiente);

  if (ambiente === 'produccion') {
    const limite = await limiteBoletasMes(cliente, ctx.organizacionId);
    if (limite !== null && (await boletasDelMes(cliente, ctx.organizacionId, ahora)) >= limite) {
      throw errorCuota(limite);
    }
  }

  return { empresa, resolucion, certificado, folios, receptor };
}
