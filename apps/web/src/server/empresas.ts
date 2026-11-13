import 'server-only';
import { cache } from 'react';
import { clienteServidor } from './supabase/servidor';
import type { Database } from './supabase/tipos';

type Ambiente = Database['public']['Enums']['ambiente_sii'];

// Lecturas de empresas y resoluciones de una organización, siempre con la sesión del
// usuario (RLS: `lectura` para cualquier miembro, `es_miembro(organizacion_id)`). Toda
// consulta filtra además por `organizacion_id`: RLS ya deja fuera a las otras
// organizaciones del usuario, pero la página es de una sola.

export interface Empresa {
  id: string;
  /** Formato del dominio `rut`: `76354771-K`. Para mostrar, `formatearRut()`. */
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
  correoIntercambio: string | null;
  activa: boolean;
  /** La fija el sistema cuando el SII autoriza la empresa (P91). */
  autorizadaProduccion: boolean;
  /** ISO. */
  autorizadaEn: string | null;
  creadaEn: string;
}

export interface Resolucion {
  id: string;
  ambiente: Ambiente;
  numero: number;
  /** `AAAA-MM-DD` (columna `date`). */
  fecha: string;
  vigente: boolean;
  /** ISO: cuándo se registró. */
  creadaEn: string;
}

export interface CupoEmpresas {
  /** Hay una suscripción en prueba o activa (`plan_vigente()`). */
  vigente: boolean;
  plan: string | null;
  /** `null` = ilimitado (o plan no legible). */
  maximo: number | null;
  /** Todas las empresas, activas o no: `tg_limite_empresas` las cuenta todas. */
  usadas: number;
}

const COLUMNAS_EMPRESA =
  'id, rut, razon_social, giro, direccion, comuna, correo_intercambio, activa, autorizada_produccion, autorizada_en, creado_en';

type FilaEmpresa = {
  id: string;
  rut: string;
  razon_social: string;
  giro: string;
  direccion: string;
  comuna: string;
  correo_intercambio: string | null;
  activa: boolean;
  autorizada_produccion: boolean;
  autorizada_en: string | null;
  creado_en: string;
};

function aEmpresa(f: FilaEmpresa): Empresa {
  return {
    id: f.id,
    rut: f.rut,
    razonSocial: f.razon_social,
    giro: f.giro,
    direccion: f.direccion,
    comuna: f.comuna,
    correoIntercambio: f.correo_intercambio,
    activa: f.activa,
    autorizadaProduccion: f.autorizada_produccion,
    autorizadaEn: f.autorizada_en,
    creadaEn: f.creado_en,
  };
}

/** Empresas de la organización: primero las activas, después por razón social. */
export const listarEmpresas = cache(async (organizacionId: string): Promise<Empresa[]> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('empresas')
    .select(COLUMNAS_EMPRESA)
    .eq('organizacion_id', organizacionId);
  if (error) throw new Error(`No se pudieron leer las empresas: ${error.message}`);
  return data
    .map(aEmpresa)
    .sort(
      (a, b) =>
        Number(b.activa) - Number(a.activa) || a.razonSocial.localeCompare(b.razonSocial, 'es-CL'),
    );
});

/**
 * Una empresa de la organización, o `null` si no existe, es de otra organización o el
 * id no es un uuid (quien llama ya lo validó, pero un 22P02 no debe romper la página).
 */
export const obtenerEmpresa = cache(
  async (organizacionId: string, empresaId: string): Promise<Empresa | null> => {
    const supabase = await clienteServidor();
    const { data, error } = await supabase
      .from('empresas')
      .select(COLUMNAS_EMPRESA)
      .eq('organizacion_id', organizacionId)
      .eq('id', empresaId)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      throw new Error(`No se pudo leer la empresa: ${error.message}`);
    }
    return data ? aEmpresa(data) : null;
  },
);

/** Resoluciones de la empresa (vigentes e historial), de la más reciente a la más antigua. */
export async function listarResoluciones(
  organizacionId: string,
  empresaId: string,
): Promise<Resolucion[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('resoluciones')
    .select('id, ambiente, numero, fecha, vigente, creado_en')
    .eq('organizacion_id', organizacionId)
    .eq('empresa_id', empresaId)
    .order('creado_en', { ascending: false });
  if (error) throw new Error(`No se pudieron leer las resoluciones: ${error.message}`);
  return data.map((r) => ({
    id: r.id,
    ambiente: r.ambiente,
    numero: r.numero,
    fecha: r.fecha,
    vigente: r.vigente,
    creadaEn: r.creado_en,
  }));
}

/**
 * Cupo de empresas del plan vigente (suscripción en prueba o activa, la más reciente,
 * como `plan_vigente()`). Solo para avisar antes de agregar: la autoridad es
 * `tg_limite_empresas` al insertar.
 */
export async function cupoEmpresas(organizacionId: string): Promise<CupoEmpresas> {
  const supabase = await clienteServidor();
  const [suscripcion, empresas] = await Promise.all([
    supabase
      .from('suscripciones')
      .select('creado_en, planes (nombre, max_empresas)')
      .eq('organizacion_id', organizacionId)
      .in('estado', ['prueba', 'activa'])
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('empresas')
      .select('id', { count: 'exact', head: true })
      .eq('organizacion_id', organizacionId),
  ]);
  const plan = suscripcion.data?.planes ?? null;
  return {
    // Si la consulta falla, no se adelanta un aviso falso: decide la base.
    vigente: suscripcion.error ? true : suscripcion.data !== null,
    plan: plan?.nombre ?? null,
    maximo: plan?.max_empresas ?? null,
    usadas: empresas.count ?? 0,
  };
}

/** Lo que impide agregar otra empresa según el plan, o `null` si hay cupo (o no se sabe). */
export function bloqueoPorPlan(cupo: CupoEmpresas): 'sin_plan' | 'cupo_lleno' | null {
  if (!cupo.vigente) return 'sin_plan';
  if (cupo.maximo !== null && cupo.usadas >= cupo.maximo) return 'cupo_lleno';
  return null;
}
