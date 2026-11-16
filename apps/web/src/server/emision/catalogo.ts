import 'server-only';
import type { ProductoCatalogo, ReceptorCatalogo } from '@/lib/emision';
import { type DependenciasEmision, resolverDependenciasEmision } from './dependencias';
import type { ContextoEmision } from './tipos';

// Autocompletado de `/[org]/emitir` (PLAN-SAAS Fase 7): receptores (por RUT o razón
// social) y productos activos (por código o nombre), con la SESIÓN (RLS: lectura para los
// miembros), filtrando por organización y empresa, hasta 8 resultados.
//
// El texto va dentro de un `ilike` y de un `or=(...)` de PostgREST: se escapan los comodines
// de LIKE (`%`, `_` y `\`) y se cambian por `_` (un carácter cualquiera) los que rompen la
// sintaxis del `or` (coma, paréntesis, comillas) y el `*`, que PostgREST lee como `%`.

export const MAXIMO_RESULTADOS = 8;
const LARGO_MAXIMO_TEXTO = 60;

/** Texto del usuario como patrón seguro de `ilike` (sin los `%` de los extremos). */
export function patronBusqueda(texto: string): string {
  return texto
    .trim()
    .slice(0, LARGO_MAXIMO_TEXTO)
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/[,()"*]/g, '_');
}

/** RUT sin puntos (como se guarda: `12345678-9`), para buscar lo que se escribió con puntos. */
function patronRut(texto: string): string {
  return patronBusqueda(texto.replace(/\./g, '').toUpperCase());
}

export async function buscarReceptores(
  ctx: Omit<ContextoEmision, 'usuarioId'>,
  texto: string,
  dependencias?: Partial<DependenciasEmision>,
): Promise<ReceptorCatalogo[]> {
  const patron = patronBusqueda(texto);
  if (patron === '') return [];
  const deps = resolverDependenciasEmision(dependencias);
  const sesion = await deps.sesion();
  const { data, error } = await sesion
    .from('receptores')
    .select('id, rut, razon_social, correo')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .or(`rut.ilike.%${patronRut(texto)}%,razon_social.ilike.%${patron}%`)
    .order('razon_social', { ascending: true })
    .limit(MAXIMO_RESULTADOS);
  if (error) {
    console.warn(`emision: falló la búsqueda de receptores (código ${error.code})`);
    return [];
  }
  return data.map((r) => ({
    id: r.id,
    rut: r.rut,
    razonSocial: r.razon_social,
    correo: r.correo,
  }));
}

export async function buscarProductos(
  ctx: Omit<ContextoEmision, 'usuarioId'>,
  texto: string,
  dependencias?: Partial<DependenciasEmision>,
): Promise<ProductoCatalogo[]> {
  const patron = patronBusqueda(texto);
  if (patron === '') return [];
  const deps = resolverDependenciasEmision(dependencias);
  const sesion = await deps.sesion();
  const { data, error } = await sesion
    .from('productos')
    .select('id, codigo, nombre, precio_bruto, exento, unidad')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('activo', true)
    .or(`codigo.ilike.%${patron}%,nombre.ilike.%${patron}%`)
    .order('nombre', { ascending: true })
    .limit(MAXIMO_RESULTADOS);
  if (error) {
    console.warn(`emision: falló la búsqueda de productos (código ${error.code})`);
    return [];
  }
  return data.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    // La boleta va en pesos enteros (el formulario no admite decimales en el precio).
    precio: Math.round(Number(p.precio_bruto)),
    exento: p.exento,
    unidad: p.unidad,
  }));
}
