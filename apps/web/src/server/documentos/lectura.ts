import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstadoDte } from '@/components/boleteame/tipos';
import {
  type AmbienteSii,
  type ErrorSii,
  type EstadoDocumentoBd,
  estadoUi,
  leerErroresSii,
} from '@/lib/documentos-presentacion';
import { formatearFecha } from '@/lib/formatos';
import type { ClasificacionEnvio } from '@/lib/seguimiento';
import { fallaBase } from '../certificacion/comun';
import { leerMetadata } from '../emision/borradores';
import { clienteServidor } from '../supabase/servidor';
import type { Database, Json } from '../supabase/tipos';
import {
  armarConsulta,
  type ConsultaDocumentos,
  ESTADOS_LISTADOS,
  type FiltrosDocumentos,
  ultimaPagina,
} from './filtros';
import { RESULTADOS_POR_REVISAR, revisionEnvio } from './revision';

// Lecturas de `/[org]/documentos`, `/[org]/envios/[id]` y del Tablero (PLAN-SAAS Fase 8)
// con el cliente de SESIÓN: todo pasa por RLS (lectura para cualquier miembro) y cada
// consulta filtra además por organización (y empresa/ambiente donde corresponde). Nada de
// secretos: ni `ted_xml` ni ids de Vault salen de aquí.

type ClienteSesion = SupabaseClient<Database>;

export interface DependenciasLectura {
  sesion: () => Promise<ClienteSesion>;
}

function resolver(d?: Partial<DependenciasLectura>): DependenciasLectura {
  return { sesion: d?.sesion ?? clienteServidor };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fila de la tabla (forma de `DocumentoFila` más lo que necesita el Realtime). */
export interface FilaDocumento {
  id: string;
  tipo: number;
  folio: number;
  receptor: string;
  rut: string;
  /** `10-11-2026`. */
  fecha: string;
  total: number;
  estado: EstadoDte;
  /** ISO: para no pisar un estado más nuevo recibido por Realtime. */
  actualizadoEn: string;
  envioId: string | null;
}

export interface ListaDocumentos {
  filas: FilaDocumento[];
  total: number;
  /** Página efectiva (ajustada si la pedida pasaba de la última). */
  pagina: number;
}

const COLUMNAS_FILA =
  'id, tipo_dte, folio, receptor_rut, receptor_razon_social, fecha_emision, mnt_total, estado, actualizado_en, envio_id';

type FilaBd = {
  id: string;
  tipo_dte: number;
  folio: number | null;
  receptor_rut: string;
  receptor_razon_social: string | null;
  fecha_emision: string;
  mnt_total: number;
  estado: EstadoDocumentoBd;
  actualizado_en: string;
  envio_id: string | null;
};

function aFila(d: FilaBd): FilaDocumento {
  return {
    id: d.id,
    tipo: d.tipo_dte,
    folio: d.folio ?? 0,
    receptor:
      d.receptor_razon_social?.trim() ||
      (d.receptor_rut === '66666666-6' ? 'Cliente General' : 'Sin razón social'),
    rut: d.receptor_rut,
    fecha: formatearFecha(d.fecha_emision),
    total: d.mnt_total,
    estado: estadoUi(d.estado),
    actualizadoEn: d.actualizado_en,
    envioId: d.envio_id,
  };
}

/**
 * Aplica la consulta armada (`armarConsulta`) sobre `documentos`. Los borradores no se
 * listan (están en Emitir) ni los documentos del set de pruebas (están en Certificación).
 */
async function consultar(sesion: ClienteSesion, c: ConsultaDocumentos) {
  let q = sesion
    .from('documentos')
    .select(COLUMNAS_FILA, { count: 'exact' })
    .eq('organizacion_id', c.organizacionId)
    .eq('empresa_id', c.empresaId)
    .eq('ambiente', c.ambiente)
    .in('estado', [...c.estados])
    .neq('origen', 'set_pruebas')
    .not('folio', 'is', null);
  if (c.periodo) q = q.gte('fecha_emision', c.periodo.desde).lt('fecha_emision', c.periodo.hasta);
  if (c.tipo) q = q.eq('tipo_dte', c.tipo);
  if (c.busqueda) q = q.or(c.busqueda);
  return q
    .order('fecha_emision', { ascending: false })
    .order('folio', { ascending: false })
    .order('id', { ascending: true })
    .range(c.rango[0], c.rango[1]);
}

/** Lista paginada en el servidor (`range` + `count: 'exact'`). */
export async function listarDocumentos(
  ctx: { organizacionId: string; empresaId: string; ambiente: AmbienteSii },
  filtros: FiltrosDocumentos,
  dependencias?: Partial<DependenciasLectura>,
): Promise<ListaDocumentos> {
  const sesion = await resolver(dependencias).sesion();
  let pagina = filtros.pagina;
  let r = await consultar(sesion, armarConsulta(ctx, { ...filtros, pagina }));
  if (r.error) throw fallaBase('leer los documentos', r.error);
  const total = r.count ?? 0;
  // Una página que ya no existe (se filtró o se borró algo): se muestra la última.
  if (r.data.length === 0 && total > 0 && pagina > ultimaPagina(total)) {
    pagina = ultimaPagina(total);
    r = await consultar(sesion, armarConsulta(ctx, { ...filtros, pagina }));
    if (r.error) throw fallaBase('leer los documentos', r.error);
  }
  return { filas: (r.data as FilaBd[]).map(aFila), total: r.count ?? total, pagina };
}

/**
 * Ambiente que muestra la lista si la URL no lo dice: el del último documento emitido de
 * la empresa; sin documentos, producción si la empresa está autorizada (como Folios) y si
 * no, certificación.
 */
export async function ambientePorDefecto(
  ctx: { organizacionId: string; empresaId: string; autorizadaProduccion: boolean },
  dependencias?: Partial<DependenciasLectura>,
): Promise<AmbienteSii> {
  const respaldo: AmbienteSii = ctx.autorizadaProduccion ? 'produccion' : 'certificacion';
  try {
    const sesion = await resolver(dependencias).sesion();
    const { data, error } = await sesion
      .from('documentos')
      .select('ambiente')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .in('estado', [...ESTADOS_LISTADOS])
      .neq('origen', 'set_pruebas')
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return respaldo;
    return data.ambiente;
  } catch {
    return respaldo;
  }
}

// --- Detalle de un documento ------------------------------------------------------------

export interface EnvioResumen {
  id: string;
  trackId: string | null;
  clasificacion: ClasificacionEnvio | null;
  estadoSii: string | null;
  glosaSii: string | null;
  incierto: boolean;
  error: string | null;
  enviadoEn: string | null;
  ultimaConsultaEn: string | null;
  actualizadoEn: string;
}

export interface ObservacionSii {
  id: string;
  tipo: 'rechazo' | 'reparo';
  tipoDte: number;
  folio: number;
  /** Tal como lo entrega el SII. */
  estado: string;
  descripcion: string | null;
  errores: ErrorSii[];
  documentoId: string | null;
}

export interface LineaDocumento {
  nroLinea: number;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  exento: boolean;
  descuento: number;
  monto: number;
}

export interface DetalleDocumento {
  id: string;
  empresaId: string;
  ambiente: AmbienteSii;
  tipoDte: number;
  folio: number | null;
  estado: EstadoDocumentoBd;
  /** `AAAA-MM-DD`. */
  fechaEmision: string;
  actualizadoEn: string;
  receptor: { rut: string; razonSocial: string | null; correo: string | null };
  totales: { neto: number; exento: number; iva: number; total: number; descuento: number };
  lineas: LineaDocumento[];
  envio: EnvioResumen | null;
  observaciones: ObservacionSii[];
  conXml: boolean;
  correoEnviadoEn: string | null;
}

const COLUMNAS_ENVIO_RESUMEN =
  'id, track_id, clasificacion, estado_sii, glosa_sii, incierto, error, enviado_en, ultima_consulta_en, actualizado_en';

type EnvioResumenBd = {
  id: string;
  track_id: string | null;
  clasificacion: ClasificacionEnvio | null;
  estado_sii: string | null;
  glosa_sii: string | null;
  incierto: boolean;
  error: string | null;
  enviado_en: string | null;
  ultima_consulta_en: string | null;
  actualizado_en: string;
};

function aEnvioResumen(e: EnvioResumenBd): EnvioResumen {
  return {
    id: e.id,
    trackId: e.track_id,
    clasificacion: e.clasificacion,
    estadoSii: e.estado_sii,
    glosaSii: e.glosa_sii,
    incierto: e.incierto,
    error: e.error,
    enviadoEn: e.enviado_en,
    ultimaConsultaEn: e.ultima_consulta_en,
    actualizadoEn: e.actualizado_en,
  };
}

type ObservacionBd = {
  id: string;
  tipo_observacion: 'rechazo' | 'reparo';
  tipo_dte: number;
  folio: number;
  estado: string;
  descripcion: string | null;
  errores: Json;
  documento_id: string | null;
};

function aObservacion(r: ObservacionBd): ObservacionSii {
  return {
    id: r.id,
    tipo: r.tipo_observacion,
    tipoDte: r.tipo_dte,
    folio: r.folio,
    estado: r.estado,
    descripcion: r.descripcion?.trim() || null,
    errores: leerErroresSii(r.errores),
    documentoId: r.documento_id,
  };
}

/** Detalle del panel. `null` si no es de la organización y empresa (o es un borrador). */
export async function leerDetalleDocumento(
  ctx: { organizacionId: string; empresaId: string },
  documentoId: string,
  dependencias?: Partial<DependenciasLectura>,
): Promise<DetalleDocumento | null> {
  if (!UUID.test(documentoId)) return null;
  const sesion = await resolver(dependencias).sesion();
  const [doc, lineas] = await Promise.all([
    sesion
      .from('documentos')
      .select(
        'id, empresa_id, ambiente, tipo_dte, folio, estado, fecha_emision, actualizado_en, receptor_rut, receptor_razon_social, mnt_neto, mnt_exe, iva, mnt_total, descuento_aplicado, envio_id, xml_path, metadata',
      )
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('id', documentoId)
      .neq('estado', 'borrador')
      .maybeSingle(),
    sesion
      .from('documento_detalles')
      .select('nro_linea, nombre, cantidad, unidad, precio, exento, descuento_monto, monto_item')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('documento_id', documentoId)
      .order('nro_linea', { ascending: true }),
  ]);
  if (doc.error) throw fallaBase('leer el documento', doc.error);
  if (lineas.error) throw fallaBase('leer las líneas del documento', lineas.error);
  const d = doc.data;
  if (!d) return null;

  let envio: EnvioResumen | null = null;
  let observaciones: ObservacionSii[] = [];
  if (d.envio_id) {
    const [e, o] = await Promise.all([
      sesion
        .from('envios')
        .select(COLUMNAS_ENVIO_RESUMEN)
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', d.envio_id)
        .maybeSingle(),
      d.folio === null
        ? Promise.resolve({ data: [] as ObservacionBd[], error: null })
        : sesion
            .from('envio_rechazos')
            .select(
              'id, tipo_observacion, tipo_dte, folio, estado, descripcion, errores, documento_id',
            )
            .eq('organizacion_id', ctx.organizacionId)
            .eq('envio_id', d.envio_id)
            .eq('tipo_dte', d.tipo_dte)
            .eq('folio', d.folio)
            .order('creado_en', { ascending: true }),
    ]);
    if (e.error) throw fallaBase('leer el envío', e.error);
    if (o.error) throw fallaBase('leer los rechazos', o.error);
    envio = e.data ? aEnvioResumen(e.data as EnvioResumenBd) : null;
    observaciones = (o.data as ObservacionBd[]).map(aObservacion);
  }

  const metadata = leerMetadata(d.metadata);
  return {
    id: d.id,
    empresaId: d.empresa_id,
    ambiente: d.ambiente,
    tipoDte: d.tipo_dte,
    folio: d.folio,
    estado: d.estado,
    fechaEmision: d.fecha_emision,
    actualizadoEn: d.actualizado_en,
    receptor: {
      rut: d.receptor_rut,
      razonSocial:
        d.receptor_razon_social ?? (d.receptor_rut === '66666666-6' ? 'Cliente General' : null),
      correo: metadata.receptor_correo?.trim() || null,
    },
    totales: {
      neto: d.mnt_neto,
      exento: d.mnt_exe,
      iva: d.iva,
      total: d.mnt_total,
      descuento: d.descuento_aplicado,
    },
    lineas: lineas.data.map((l) => ({
      nroLinea: l.nro_linea,
      nombre: l.nombre,
      cantidad: Number(l.cantidad),
      unidad: l.unidad,
      precio: Number(l.precio),
      exento: l.exento,
      descuento: l.descuento_monto,
      monto: l.monto_item,
    })),
    envio,
    observaciones,
    conXml: Boolean(d.xml_path) && d.folio !== null,
    correoEnviadoEn: metadata.correo?.enviado_en ?? null,
  };
}

// --- Detalle de un envío ------------------------------------------------------------------

export interface EstadisticaEnvio {
  tipoDte: number;
  informados: number;
  aceptados: number;
  rechazados: number;
  reparos: number;
}

export interface ConsultaBitacora {
  id: number;
  consultadoEn: string;
  estadoSii: string | null;
  glosaSii: string | null;
  error: string | null;
  informados: number | null;
  aceptados: number | null;
  rechazados: number | null;
  reparos: number | null;
  respuesta: Json | null;
}

export interface DetalleEnvio extends EnvioResumen {
  empresa: { id: string; rut: string; razonSocial: string } | null;
  ambiente: AmbienteSii;
  canal: Database['public']['Enums']['canal_sii'];
  proposito: Database['public']['Enums']['proposito_envio'];
  rutEnvia: string;
  nroResol: number;
  /** `AAAA-MM-DD`. */
  fchResol: string;
  tmstFirma: string | null;
  certificado: string | null;
  nombreArchivo: string | null;
  fechaRecepcion: string | null;
  creadoEn: string;
  consultas: number;
  cifras: { informados: number; aceptados: number; rechazados: number; reparos: number };
  respuestaSubida: Json | null;
  respuestaEstado: Json | null;
  estadisticas: EstadisticaEnvio[];
  bitacora: ConsultaBitacora[];
  observaciones: ObservacionSii[];
  documentos: FilaDocumento[];
  /** Envío incierto marcado «Ya lo revisé» (ISO), o `null`. */
  revisadoEn: string | null;
}

/** Operaciones enlazadas a los envíos (para saber si un incierto ya se revisó). */
async function operacionesEnlazadas(
  sesion: ClienteSesion,
  organizacionId: string,
  envioIds: readonly string[],
) {
  if (envioIds.length === 0) return [];
  const { data, error } = await sesion
    .from('operaciones_sii')
    .select('envio_id, resultado, detalle')
    .eq('organizacion_id', organizacionId)
    .in('envio_id', [...envioIds])
    .in('resultado', [...RESULTADOS_POR_REVISAR]);
  if (error) throw fallaBase('leer las operaciones del envío', error);
  return data;
}

/** Consultas que muestra la bitácora (las más recientes). */
export const MAXIMO_BITACORA = 50;

/** Detalle de `/[org]/envios/[id]`. `null` si no es de la organización. */
export async function leerEnvio(
  organizacionId: string,
  envioId: string,
  dependencias?: Partial<DependenciasLectura>,
): Promise<DetalleEnvio | null> {
  if (!UUID.test(envioId) || !UUID.test(organizacionId)) return null;
  const sesion = await resolver(dependencias).sesion();
  const { data: e, error } = await sesion
    .from('envios')
    .select(
      `${COLUMNAS_ENVIO_RESUMEN}, empresa_id, ambiente, canal, proposito, rut_envia, nro_resol, fch_resol, tmst_firma, certificado_id, nombre_archivo, fecha_recepcion, creado_en, consultas, informados, aceptados, rechazados, reparos, respuesta_subida, respuesta_estado`,
    )
    .eq('organizacion_id', organizacionId)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw fallaBase('leer el envío', error);
  if (!e) return null;

  const [empresa, certificado, estadisticas, bitacora, observaciones, documentos, operaciones] =
    await Promise.all([
      sesion
        .from('empresas')
        .select('id, rut, razon_social')
        .eq('organizacion_id', organizacionId)
        .eq('id', e.empresa_id)
        .maybeSingle(),
      e.certificado_id
        ? sesion
            .from('certificados')
            .select('nombre_titular, cn, rut_titular')
            .eq('organizacion_id', organizacionId)
            .eq('id', e.certificado_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sesion
        .from('envio_estadisticas')
        .select('tipo_dte, informados, aceptados, rechazados, reparos')
        .eq('organizacion_id', organizacionId)
        .eq('envio_id', envioId)
        .order('tipo_dte', { ascending: true }),
      sesion
        .from('consultas_envio')
        .select(
          'id, consultado_en, estado_sii, glosa_sii, error, informados, aceptados, rechazados, reparos, respuesta',
        )
        .eq('organizacion_id', organizacionId)
        .eq('envio_id', envioId)
        .order('consultado_en', { ascending: false })
        .order('id', { ascending: false })
        .limit(MAXIMO_BITACORA),
      sesion
        .from('envio_rechazos')
        .select('id, tipo_observacion, tipo_dte, folio, estado, descripcion, errores, documento_id')
        .eq('organizacion_id', organizacionId)
        .eq('envio_id', envioId)
        .order('tipo_dte', { ascending: true })
        .order('folio', { ascending: true }),
      sesion
        .from('documentos')
        .select(COLUMNAS_FILA)
        .eq('organizacion_id', organizacionId)
        .eq('envio_id', envioId)
        .order('tipo_dte', { ascending: true })
        .order('folio', { ascending: true }),
      e.incierto ? operacionesEnlazadas(sesion, organizacionId, [envioId]) : Promise.resolve([]),
    ]);
  if (empresa.error) throw fallaBase('leer la empresa', empresa.error);
  if (estadisticas.error) throw fallaBase('leer las estadísticas', estadisticas.error);
  if (bitacora.error) throw fallaBase('leer las consultas', bitacora.error);
  if (observaciones.error) throw fallaBase('leer los rechazos', observaciones.error);
  if (documentos.error) throw fallaBase('leer los documentos', documentos.error);
  // El certificado es un dato de apoyo: si no se puede leer, la carátula se muestra igual.
  const cert = certificado.error ? null : certificado.data;

  return {
    ...aEnvioResumen(e as EnvioResumenBd),
    empresa: empresa.data
      ? { id: empresa.data.id, rut: empresa.data.rut, razonSocial: empresa.data.razon_social }
      : null,
    ambiente: e.ambiente,
    canal: e.canal,
    proposito: e.proposito,
    rutEnvia: e.rut_envia,
    nroResol: e.nro_resol,
    fchResol: e.fch_resol,
    tmstFirma: e.tmst_firma,
    certificado: cert ? (cert.nombre_titular ?? cert.cn ?? cert.rut_titular) : null,
    nombreArchivo: e.nombre_archivo,
    fechaRecepcion: e.fecha_recepcion,
    creadoEn: e.creado_en,
    consultas: e.consultas,
    cifras: {
      informados: e.informados,
      aceptados: e.aceptados,
      rechazados: e.rechazados,
      reparos: e.reparos,
    },
    respuestaSubida: e.respuesta_subida,
    respuestaEstado: e.respuesta_estado,
    estadisticas: estadisticas.data.map((s) => ({
      tipoDte: s.tipo_dte,
      informados: s.informados,
      aceptados: s.aceptados,
      rechazados: s.rechazados,
      reparos: s.reparos,
    })),
    bitacora: bitacora.data.map((c) => ({
      id: c.id,
      consultadoEn: c.consultado_en,
      estadoSii: c.estado_sii,
      glosaSii: c.glosa_sii,
      error: c.error,
      informados: c.informados,
      aceptados: c.aceptados,
      rechazados: c.rechazados,
      reparos: c.reparos,
      respuesta: c.respuesta,
    })),
    observaciones: (observaciones.data as ObservacionBd[]).map(aObservacion),
    documentos: (documentos.data as FilaBd[]).map(aFila),
    revisadoEn: e.incierto ? revisionEnvio(operaciones) : null,
  };
}

/** Lo mínimo de un envío para la Server Action «Consultar estado en el SII». */
export async function leerEnvioMinimo(
  organizacionId: string,
  envioId: string,
  dependencias?: Partial<DependenciasLectura>,
): Promise<{ id: string; incierto: boolean; trackId: string | null } | null> {
  if (!UUID.test(envioId)) return null;
  const sesion = await resolver(dependencias).sesion();
  const { data, error } = await sesion
    .from('envios')
    .select('id, incierto, track_id')
    .eq('organizacion_id', organizacionId)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw fallaBase('leer el envío', error);
  return data ? { id: data.id, incierto: data.incierto, trackId: data.track_id } : null;
}

/** Empresa de un documento de la organización (para firmar su descarga), o `null`. */
export async function empresaDelDocumento(
  organizacionId: string,
  documentoId: string,
  dependencias?: Partial<DependenciasLectura>,
): Promise<string | null> {
  if (!UUID.test(documentoId)) return null;
  const sesion = await resolver(dependencias).sesion();
  const { data, error } = await sesion
    .from('documentos')
    .select('empresa_id')
    .eq('organizacion_id', organizacionId)
    .eq('id', documentoId)
    .maybeSingle();
  if (error) throw fallaBase('leer el documento', error);
  return data?.empresa_id ?? null;
}

// --- Envíos inciertos (Tablero) --------------------------------------------------------

export interface EnvioIncierto {
  id: string;
  empresaId: string;
  ambiente: AmbienteSii;
  creadoEn: string;
  folios: { tipoDte: number; folio: number }[];
}

/** Envíos que muestra la alerta del Tablero. */
export const MAXIMO_INCIERTOS_TABLERO = 10;
/** Inciertos que se leen para descontar los revisados (un tope por si se acumulan). */
export const TOPE_INCIERTOS_LEIDOS = 200;

/**
 * Envíos que no se reintentan solos y nadie marcó «Ya lo revisé»: hasta 10, los más
 * recientes primero, con su total. Sin los del set de pruebas (son de Certificación, como
 * en las alertas por correo).
 */
export async function enviosInciertos(
  ctx: { organizacionId: string; empresaId: string },
  dependencias?: Partial<DependenciasLectura>,
): Promise<{ envios: EnvioIncierto[]; total: number }> {
  const sesion = await resolver(dependencias).sesion();
  const { data, error } = await sesion
    .from('envios')
    .select('id, empresa_id, ambiente, creado_en')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('incierto', true)
    .neq('proposito', 'set_pruebas')
    .order('creado_en', { ascending: false })
    .limit(TOPE_INCIERTOS_LEIDOS);
  if (error) throw fallaBase('leer los envíos por verificar', error);
  if (data.length === 0) return { envios: [], total: 0 };

  const operaciones = await operacionesEnlazadas(
    sesion,
    ctx.organizacionId,
    data.map((e) => e.id),
  );
  const pendientes = data.filter(
    (e) => revisionEnvio(operaciones.filter((o) => o.envio_id === e.id)) === null,
  );
  const visibles = pendientes.slice(0, MAXIMO_INCIERTOS_TABLERO);
  if (visibles.length === 0) return { envios: [], total: 0 };

  const docs = await sesion
    .from('documentos')
    .select('envio_id, tipo_dte, folio')
    .eq('organizacion_id', ctx.organizacionId)
    .in(
      'envio_id',
      visibles.map((e) => e.id),
    );
  if (docs.error) throw fallaBase('leer los documentos por verificar', docs.error);
  return {
    total: pendientes.length,
    envios: visibles.map((e) => ({
      id: e.id,
      empresaId: e.empresa_id,
      ambiente: e.ambiente,
      creadoEn: e.creado_en,
      folios: docs.data
        .filter((d) => d.envio_id === e.id && d.folio !== null)
        .map((d) => ({ tipoDte: d.tipo_dte, folio: d.folio as number })),
    })),
  };
}
