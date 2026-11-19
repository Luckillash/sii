import 'server-only';
import {
  type Borrador,
  type BorradorValido,
  calcularTotales,
  RECEPTOR_GENERICO,
  type ResultadoEmision,
} from '@/lib/emision';
import type { TipoFolio } from '@/lib/folios';
import { fallaBase } from '../certificacion/comun';
import type { ClienteServicio } from '../supabase/service';
import type { Json, Tables, TablesInsert } from '../supabase/tipos';
import { type DependenciasEmision, resolverDependenciasEmision } from './dependencias';
import {
  errorAmbiente,
  errorBorradorEmitido,
  errorBorradorNoEncontrado,
  errorDocumentoIncierto,
  errorEmpresaNoEncontrada,
  errorIdempotenciaEnUso,
  errorSinPermiso,
  esErrorEmision,
  falloSinEjecutar,
} from './errores';
import type { ContextoEmision } from './tipos';

// Borradores de `/[org]/emitir` (PLAN-SAAS Fase 7): «Guardar borrador», borrarlo y el
// guardado que hace la emisión antes de asignar folio. Todo con el cliente de SESIÓN: RLS
// hace cumplir `puede_emitir` (políticas `alta_borrador` / `edicion_borrador` de la 0001:
// solo `estado = 'borrador'` y sin folio) y las de `receptores` (alta y edición para
// emisores). Cada consulta filtra además por organización y empresa.
//
// El correo del receptor no tiene columna en `documentos`: va en `metadata.receptor_correo`
// (y en `receptores.correo` si el receptor no es el genérico).

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `metadata` que escribe la emisión en `documentos` (todo opcional). */
export interface MetadataDocumento {
  receptor_correo?: string | null;
  /** Rutas de Storage de la representación impresa. */
  pdf?: { carta?: string; rollo?: string };
  /** Envío del PDF al receptor (id de Resend). */
  correo?: { id: string; enviado_en: string };
}

export function leerMetadata(valor: Json | null | undefined): MetadataDocumento {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const v = valor as Record<string, unknown>;
  const salida: MetadataDocumento = {};
  if (typeof v.receptor_correo === 'string') salida.receptor_correo = v.receptor_correo;
  if (v.pdf && typeof v.pdf === 'object' && !Array.isArray(v.pdf)) {
    const p = v.pdf as Record<string, unknown>;
    salida.pdf = {
      ...(typeof p.carta === 'string' ? { carta: p.carta } : {}),
      ...(typeof p.rollo === 'string' ? { rollo: p.rollo } : {}),
    };
  }
  if (v.correo && typeof v.correo === 'object' && !Array.isArray(v.correo)) {
    const c = v.correo as Record<string, unknown>;
    if (typeof c.id === 'string' && typeof c.enviado_en === 'string') {
      salida.correo = { id: c.id, enviado_en: c.enviado_en };
    }
  }
  return salida;
}

function codigo(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const c = (error as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/**
 * Receptor distinto del genérico con razón social: alta o actualización en `receptores`
 * (empresa, RUT). El correo solo se escribe si viene (no borra uno guardado). Devuelve el
 * id, o `null` si no corresponde o falló (el catálogo es una comodidad: no frena la boleta).
 */
async function registrarReceptor(
  sesion: ClienteServicio,
  ctx: ContextoEmision,
  receptor: BorradorValido['receptor'],
): Promise<string | null> {
  if (receptor.rut === RECEPTOR_GENERICO.rut || !receptor.razonSocial) return null;
  const { data, error } = await sesion
    .from('receptores')
    .upsert(
      {
        organizacion_id: ctx.organizacionId,
        empresa_id: ctx.empresaId,
        rut: receptor.rut,
        razon_social: receptor.razonSocial,
        ...(receptor.correo ? { correo: receptor.correo } : {}),
      },
      { onConflict: 'empresa_id,rut' },
    )
    .select('id')
    .single();
  if (error || !data) {
    console.warn(`emision: no se guardó el receptor en el catálogo (código ${codigo(error)})`);
    return null;
  }
  return data.id;
}

/** Productos del formulario que de verdad son de la empresa (los demás quedan sin enlace). */
async function productosDeLaEmpresa(
  sesion: ClienteServicio,
  ctx: ContextoEmision,
  borrador: BorradorValido,
): Promise<Set<string>> {
  const ids = [...new Set(borrador.lineas.flatMap((l) => (l.productoId ? [l.productoId] : [])))];
  if (ids.length === 0) return new Set();
  const { data, error } = await sesion
    .from('productos')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .in('id', ids);
  if (error) return new Set();
  return new Set(data.map((p) => p.id));
}

/** Por qué un borrador no se pudo actualizar (0 filas): ya no existe, ya se emitió o quedó incierto. */
async function explicarBorradorAusente(
  sesion: ClienteServicio,
  ctx: ContextoEmision,
  borradorId: string,
): Promise<Error> {
  const { data } = await sesion
    .from('documentos')
    .select('estado, folio')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('id', borradorId)
    .maybeSingle();
  if (!data) return errorBorradorNoEncontrado();
  if (data.estado === 'incierto') return errorDocumentoIncierto(data.folio);
  if (data.estado === 'borrador') return errorSinPermiso();
  return errorBorradorEmitido(data.folio);
}

export interface BorradorEnBase {
  id: string;
  metadata: MetadataDocumento;
}

/** Lo que cambia cuando el borrador lo guarda la API pública (Fase 11). */
export interface OpcionesGuardado {
  /** `documentos.origen` de un borrador nuevo (por defecto `panel`). */
  origen?: 'panel' | 'api';
  /** `documentos.clave_idempotencia` de un borrador nuevo (`Idempotency-Key`). */
  claveIdempotencia?: string;
}

/**
 * Guarda (o actualiza) el borrador y sus líneas, reemplazando las líneas. El panel lo hace
 * con la sesión del usuario (RLS); la API pública, con service_role (nunca hay sesión), y
 * en los dos casos cada consulta filtra por organización y empresa. Lanza `ErrorEmision`
 * (empresa, permiso, borrador ausente o emitido, clave de idempotencia ya usada) o una
 * falla de base (solo su código).
 */
export async function guardarEnSesion(
  sesion: ClienteServicio,
  ctx: ContextoEmision,
  borrador: BorradorValido,
  borradorId?: string,
  opciones: OpcionesGuardado = {},
): Promise<BorradorEnBase> {
  if (borradorId !== undefined && !UUID.test(borradorId)) throw errorBorradorNoEncontrado();

  const empresa = await sesion
    .from('empresas')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.empresaId)
    .maybeSingle();
  if (empresa.error) throw fallaBase('leer la empresa', empresa.error);
  if (!empresa.data) throw errorEmpresaNoEncontrada();

  const totales = calcularTotales(borrador);
  const [receptorId, productos] = await Promise.all([
    registrarReceptor(sesion, ctx, borrador.receptor),
    productosDeLaEmpresa(sesion, ctx, borrador),
  ]);
  const metadata: MetadataDocumento = { receptor_correo: borrador.receptor.correo ?? null };
  const fila = {
    ambiente: borrador.ambiente,
    tipo_dte: borrador.tipoDte,
    receptor_id: receptorId,
    receptor_rut: borrador.receptor.rut,
    receptor_razon_social: borrador.receptor.razonSocial,
    mnt_neto: totales.neto,
    mnt_exe: totales.exento,
    iva: totales.iva,
    mnt_total: totales.total,
    descuento_tipo: borrador.descuento ? borrador.descuento.tipo : null,
    descuento_valor: borrador.descuento ? borrador.descuento.valor : null,
    descuento_glosa: borrador.descuento?.glosa || null,
    descuento_aplicado: totales.descuentoAplicado,
    metadata: metadata as Json,
  } satisfies Partial<TablesInsert<'documentos'>>;

  let id: string;
  if (borradorId !== undefined) {
    const { data, error } = await sesion
      .from('documentos')
      .update(fila)
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('id', borradorId)
      .eq('estado', 'borrador')
      .select('id');
    if (error?.code === '42501') throw errorSinPermiso();
    if (error) throw fallaBase('actualizar el borrador', error);
    if (data.length === 0) throw await explicarBorradorAusente(sesion, ctx, borradorId);
    id = borradorId;
  } else {
    const { data, error } = await sesion
      .from('documentos')
      .insert({
        ...fila,
        organizacion_id: ctx.organizacionId,
        empresa_id: ctx.empresaId,
        estado: 'borrador',
        origen: opciones.origen ?? 'panel',
        ...(opciones.claveIdempotencia ? { clave_idempotencia: opciones.claveIdempotencia } : {}),
        creado_por: ctx.usuarioId,
      })
      .select('id')
      .single();
    if (error?.code === '42501') throw errorSinPermiso();
    if (error?.code === '23505' && opciones.claveIdempotencia) throw errorIdempotenciaEnUso();
    // `tg_validar_documento` revisa en TODO insert de producción (también un borrador sin
    // folio) que la empresa esté autorizada y que el plan lo permita.
    if (error?.code === 'P0001' && borrador.ambiente === 'produccion') {
      if (/autorizada/i.test(error.message)) throw errorAmbiente('sin_autorizacion', 'produccion');
      if (/plan/i.test(error.message)) throw errorAmbiente('plan_sin_produccion', 'produccion');
    }
    if (error || !data) throw fallaBase('guardar el borrador', error);
    id = data.id;
  }

  const borradas = await sesion
    .from('documento_detalles')
    .delete()
    .eq('organizacion_id', ctx.organizacionId)
    .eq('documento_id', id);
  if (borradas.error) throw fallaBase('reemplazar las líneas del borrador', borradas.error);
  const lineas: TablesInsert<'documento_detalles'>[] = borrador.lineas.map((l, i) => ({
    organizacion_id: ctx.organizacionId,
    documento_id: id,
    nro_linea: i + 1,
    producto_id: l.productoId && productos.has(l.productoId) ? l.productoId : null,
    nombre: l.nombre,
    cantidad: l.cantidad,
    unidad: l.unidad ?? null,
    precio: l.precio,
    exento: l.exento,
    descuento_monto: totales.lineas[i]?.descuento ?? 0,
    monto_item: totales.lineas[i]?.montoItem ?? 0,
  }));
  const insertadas = await sesion.from('documento_detalles').insert(lineas);
  if (insertadas.error?.code === '42501') throw errorSinPermiso();
  if (insertadas.error) throw fallaBase('guardar las líneas del borrador', insertadas.error);

  return { id, metadata };
}

/** «Guardar borrador»: RLS directo con la sesión. */
export async function guardarBorrador(
  ctx: ContextoEmision,
  borrador: BorradorValido,
  borradorId?: string,
  dependencias?: Partial<DependenciasEmision>,
): Promise<ResultadoEmision> {
  const deps = resolverDependenciasEmision(dependencias);
  try {
    const guardado = await guardarEnSesion(await deps.sesion(), ctx, borrador, borradorId);
    return {
      tipo: 'borrador',
      documentoId: guardado.id,
      mensaje: {
        titulo: 'Guardamos el borrador',
        detalle: 'Puedes seguir editándolo o emitirlo cuando quieras. Todavía no usa folio.',
      },
    };
  } catch (error) {
    if (esErrorEmision(error)) return falloSinEjecutar(error);
    console.error('emision: no se pudo guardar el borrador', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
    return {
      tipo: 'error',
      mensaje: {
        titulo: 'No pudimos guardar el borrador',
        detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
      },
      operacionId: null,
    };
  }
}

/** Borra un borrador de la empresa (RLS: solo `estado = 'borrador'`). */
export async function borrarBorrador(
  ctx: ContextoEmision,
  borradorId: string,
  dependencias?: Partial<DependenciasEmision>,
): Promise<{ ok: true } | { ok: false; mensaje: { titulo: string; detalle: string } }> {
  const noEncontrado = {
    ok: false as const,
    mensaje: {
      titulo: 'No encontramos el borrador',
      detalle: 'Puede que ya lo hayan borrado o emitido. Recarga la página.',
    },
  };
  if (!UUID.test(borradorId)) return noEncontrado;
  const deps = resolverDependenciasEmision(dependencias);
  const sesion = await deps.sesion();
  const { data, error } = await sesion
    .from('documentos')
    .delete()
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('id', borradorId)
    .eq('estado', 'borrador')
    .select('id');
  if (error) {
    console.warn(`emision: no se pudo borrar el borrador (código ${error.code})`);
    return {
      ok: false,
      mensaje: {
        titulo: 'No pudimos borrar el borrador',
        detalle: 'Inténtalo de nuevo en unos minutos.',
      },
    };
  }
  if (!data || data.length === 0) return noEncontrado;
  return { ok: true };
}

type FilaBorrador = Pick<
  Tables<'documentos'>,
  | 'id'
  | 'tipo_dte'
  | 'ambiente'
  | 'receptor_id'
  | 'receptor_rut'
  | 'receptor_razon_social'
  | 'descuento_tipo'
  | 'descuento_valor'
  | 'descuento_glosa'
  | 'metadata'
>;
type FilaLinea = Pick<
  Tables<'documento_detalles'>,
  'nro_linea' | 'producto_id' | 'nombre' | 'cantidad' | 'precio' | 'exento' | 'unidad'
>;

/** Un borrador guardado, en la forma del formulario (`Borrador`). */
export function aBorrador(fila: FilaBorrador, lineas: readonly FilaLinea[]): Borrador {
  const generico = fila.receptor_rut === RECEPTOR_GENERICO.rut;
  return {
    tipoDte: (fila.tipo_dte === 41 ? 41 : 39) as TipoFolio,
    ambiente: fila.ambiente,
    receptor: {
      rut: generico ? '' : fila.receptor_rut,
      razonSocial: generico ? null : fila.receptor_razon_social,
      correo: leerMetadata(fila.metadata).receptor_correo ?? null,
      receptorId: generico ? null : fila.receptor_id,
    },
    lineas: [...lineas]
      .sort((a, b) => a.nro_linea - b.nro_linea)
      .map((l) => ({
        productoId: l.producto_id,
        nombre: l.nombre,
        cantidad: Number(l.cantidad),
        precio: Number(l.precio),
        exento: l.exento,
        unidad: l.unidad,
      })),
    descuento:
      fila.descuento_tipo && fila.descuento_valor !== null
        ? {
            tipo: fila.descuento_tipo,
            valor: Number(fila.descuento_valor),
            glosa: fila.descuento_glosa,
          }
        : null,
  };
}
