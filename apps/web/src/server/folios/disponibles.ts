import 'server-only';
import {
  type CafRango,
  type Disponibilidad,
  disponibilidadDe,
  estadoDisponibilidad,
} from '@/lib/folios';
import { fallaBase } from '../certificacion/comun';
import type { ClienteServicio } from '../supabase/service';
import type { ClaveFolios } from './tipos';

// Folios disponibles por empresa, ambiente y tipo (PLAN-SAAS Fase 6, puntos 1 y 6).
//
// Lo mismo que usa `asignar_folio`: los CAF `activo` con `siguiente_folio <= folio_hasta`,
// el de `folio_desde` más bajo primero. La regla del umbral (y su denominador) está en
// `disponibilidadDe` de `@/lib/folios`. Con service_role, siempre filtrado por
// organización; nunca se lee `caf_secret_id`.

/** Los CAF de una clave (empresa, ambiente, tipo), reducidos a su rango. */
export async function leerCafs(cliente: ClienteServicio, clave: ClaveFolios): Promise<CafRango[]> {
  const { data, error } = await cliente
    .from('cafs')
    .select('id, folio_desde, folio_hasta, siguiente_folio, estado')
    .eq('organizacion_id', clave.organizacionId)
    .eq('empresa_id', clave.empresaId)
    .eq('ambiente', clave.ambiente)
    .eq('tipo_dte', clave.tipoDte)
    .order('folio_desde', { ascending: true });
  if (error) throw fallaBase('leer los CAF de la empresa', error);
  return data.map((c) => ({
    id: c.id,
    desde: c.folio_desde,
    hasta: c.folio_hasta,
    siguiente: c.siguiente_folio,
    estado: c.estado,
  }));
}

/** Disponibilidad (restante, denominador y CAF en uso) de una clave. */
export async function disponibilidad(
  cliente: ClienteServicio,
  clave: ClaveFolios,
): Promise<Disponibilidad> {
  return disponibilidadDe(await leerCafs(cliente, clave));
}

export interface FoliosDisponibles {
  total: number;
  primero: { id: string; desde: number; hasta: number; siguiente: number } | null;
}

/** Folios libres y el CAF que se usa primero (lo que usa `asignar_folio`). */
export async function foliosDisponibles(
  cliente: ClienteServicio,
  clave: ClaveFolios,
): Promise<FoliosDisponibles> {
  const cafs = await leerCafs(cliente, clave);
  const d = disponibilidadDe(cafs);
  const primero = cafs.find((c) => c.id === d.cafEnUso);
  return {
    total: d.restante,
    primero: primero
      ? { id: primero.id, desde: primero.desde, hasta: primero.hasta, siguiente: primero.siguiente }
      : null,
  };
}

export type MotivoSinFolios = 'sin_caf' | 'agotado';

/**
 * ¿Se puede emitir este tipo en este ambiente? Punto de enganche de la Fase 7: el botón
 * de emitir se deshabilita si no quedan folios (guía del `MedidorFolios`). `sin_caf`:
 * nunca hubo CAF; `agotado`: los hubo y se acabaron (o se anularon).
 */
export async function puedeEmitir(
  cliente: ClienteServicio,
  clave: ClaveFolios,
): Promise<
  | { puede: true; disponibles: number; aviso: boolean }
  | { puede: false; disponibles: 0; motivo: MotivoSinFolios }
> {
  const cafs = await leerCafs(cliente, clave);
  const d = disponibilidadDe(cafs);
  if (d.restante > 0) {
    return { puede: true, disponibles: d.restante, aviso: estadoDisponibilidad(d) === 'aviso' };
  }
  return { puede: false, disponibles: 0, motivo: cafs.length === 0 ? 'sin_caf' : 'agotado' };
}
