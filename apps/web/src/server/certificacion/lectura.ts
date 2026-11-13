import 'server-only';
import type { ClienteServicio } from '../supabase/service';
import type { Tables } from '../supabase/tipos';
import { AMBIENTE, fallaBase, TIPO_BOLETA } from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type {
  CafSet,
  CasoSet,
  DetalleCaso,
  EnvioSet,
  FilaProceso,
  OperacionAsistente,
  VistaAsistente,
} from './tipos';

// Lectura del asistente para la página (PLAN-SAAS Fase 5), con el cliente de SESIÓN:
// todo pasa por RLS (`lectura` para cualquier miembro). Además cada consulta filtra por
// organización y empresa: RLS ya deja fuera las otras organizaciones del usuario, pero
// la página es de una sola. Nada de secretos: los CAF se leen sin `caf_secret_id` y los
// certificados sin los ids de Vault.

const MAXIMO_OPERACIONES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function aProceso(f: Tables<'procesos_certificacion'>): FilaProceso {
  return {
    id: f.id,
    etapa: f.etapa,
    rutAdministrador: f.rut_administrador,
    correoAdministrador: f.correo_administrador,
    correoContactoSii: f.correo_contacto_sii,
    correoIntercambio: f.correo_intercambio,
    nombreSoftware: f.nombre_software,
    boletaExenta: f.boleta_exenta,
    url: f.url,
    postuladaEn: f.postulada_en,
    avisosPostulacion: Array.isArray(f.avisos_postulacion)
      ? f.avisos_postulacion.filter((a): a is string => typeof a === 'string')
      : [],
    correoProveedorSet: f.correo_proveedor_set,
    setDescargadoEn: f.set_descargado_en,
    envioSetId: f.envio_set_id,
    revisionSolicitadaEn: f.revision_solicitada_en,
    linkConsulta: f.link_consulta,
    rutProveedor: f.rut_proveedor,
    nombreProveedor: f.nombre_proveedor,
    correoProveedor: f.correo_proveedor,
    declaradaEn: f.declarada_en,
    codigoEstadoSii: f.codigo_estado_sii,
    glosaEstadoSii: f.glosa_estado_sii,
    pasoSii: f.paso_sii,
    estadoConsultadoEn: f.estado_consultado_en,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

function aDetalles(valor: unknown): DetalleCaso[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (
      typeof o.nombre !== 'string' ||
      typeof o.cantidad !== 'number' ||
      typeof o.precio !== 'number'
    ) {
      return [];
    }
    return [
      {
        nombre: o.nombre,
        cantidad: o.cantidad,
        precio: o.precio,
        ...(o.exento === true ? { exento: true } : {}),
        ...(typeof o.unidad === 'string' && o.unidad !== '' ? { unidad: o.unidad } : {}),
      },
    ];
  });
}

function revisada(detalle: unknown): boolean {
  return (
    detalle !== null &&
    typeof detalle === 'object' &&
    !Array.isArray(detalle) &&
    typeof (detalle as Record<string, unknown>).revisada_en === 'string'
  );
}

/** Primer código de error de un rechazo (`errores[].codigo`), como texto. */
function codigoRechazo(errores: unknown): string | null {
  if (!Array.isArray(errores)) return null;
  for (const e of errores) {
    const codigo = (e ?? {}) as Record<string, unknown>;
    if (typeof codigo.codigo === 'number' || typeof codigo.codigo === 'string') {
      return String(codigo.codigo);
    }
  }
  return null;
}

async function leerEnvio(
  supabase: ClienteServicio,
  organizacionId: string,
  empresaId: string,
  envioId: string,
): Promise<EnvioSet | null> {
  const { data: e, error } = await supabase
    .from('envios')
    .select(
      'id, track_id, clasificacion, estado_sii, incierto, enviado_en, ultima_consulta_en, informados, aceptados, rechazados, reparos',
    )
    .eq('organizacion_id', organizacionId)
    .eq('empresa_id', empresaId)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw fallaBase('leer el envío del set', error);
  if (!e) return null;
  const rechazos = await supabase
    .from('envio_rechazos')
    .select('folio, descripcion, errores, estado')
    .eq('organizacion_id', organizacionId)
    .eq('envio_id', e.id)
    .order('folio', { ascending: true });
  if (rechazos.error) throw fallaBase('leer los rechazos del envío', rechazos.error);
  const consultado = e.ultima_consulta_en !== null;
  return {
    id: e.id,
    trackId: e.track_id,
    estado: e.clasificacion ?? 'pendiente',
    estadoSii: e.estado_sii,
    incierto: e.incierto,
    enviadoEn: e.enviado_en,
    ultimaConsultaEn: e.ultima_consulta_en,
    aceptados: consultado ? e.aceptados : null,
    rechazados: consultado ? e.rechazados : null,
    reparos: consultado ? e.reparos : null,
    rechazos: rechazos.data.map((r) => ({
      folio: r.folio,
      codigo: codigoRechazo(r.errores),
      descripcion: r.descripcion ?? r.estado,
    })),
  };
}

/** Estado completo del asistente. `null` si la empresa no es de la organización. */
export async function leerAsistente(
  organizacionId: string,
  empresaId: string,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<VistaAsistente | null> {
  if (!UUID.test(organizacionId) || !UUID.test(empresaId)) return null;
  const deps = resolverDependencias(dependencias);
  const supabase = await deps.sesion();

  const empresa = await supabase
    .from('empresas')
    .select('id, rut, razon_social, activa, autorizada_produccion')
    .eq('organizacion_id', organizacionId)
    .eq('id', empresaId)
    .maybeSingle();
  if (empresa.error) throw fallaBase('leer la empresa', empresa.error);
  if (!empresa.data) return null;

  const [proceso, cafs, resolucion, asociaciones, operaciones] = await Promise.all([
    supabase
      .from('procesos_certificacion')
      .select('*')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .maybeSingle(),
    supabase
      .from('cafs')
      .select('id, folio_desde, folio_hasta, siguiente_folio')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('ambiente', AMBIENTE)
      .eq('tipo_dte', TIPO_BOLETA)
      .eq('estado', 'activo')
      .order('folio_desde', { ascending: true }),
    supabase
      .from('resoluciones')
      .select('numero, fecha')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('ambiente', AMBIENTE)
      .eq('vigente', true)
      .maybeSingle(),
    supabase
      .from('empresa_certificados')
      .select('certificado_id, es_representante_electronico, predeterminado')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId),
    supabase
      .from('operaciones_sii')
      .select('id, operacion, resultado, confirmada, mensaje, iniciada_en, terminada_en, detalle')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('ambiente', AMBIENTE)
      .order('iniciada_en', { ascending: false })
      .limit(MAXIMO_OPERACIONES),
  ]);
  if (proceso.error) throw fallaBase('leer el proceso de certificación', proceso.error);
  if (cafs.error) throw fallaBase('leer los CAF', cafs.error);
  if (resolucion.error) throw fallaBase('leer la resolución', resolucion.error);
  if (asociaciones.error)
    throw fallaBase('leer los certificados de la empresa', asociaciones.error);
  if (operaciones.error) throw fallaBase('leer las operaciones', operaciones.error);

  let casos: CasoSet[] = [];
  let envioSet: EnvioSet | null = null;
  if (proceso.data) {
    const filas = await supabase
      .from('set_pruebas_casos')
      .select('numero_caso, tipo_dte, referencia_razon, detalles, documento_id')
      .eq('organizacion_id', organizacionId)
      .eq('proceso_id', proceso.data.id)
      .order('numero_caso', { ascending: true });
    if (filas.error) throw fallaBase('leer los casos del set', filas.error);
    casos = filas.data.map((c) => ({
      numero: c.numero_caso,
      tipoDte: c.tipo_dte,
      referenciaRazon: c.referencia_razon,
      detalles: aDetalles(c.detalles),
      documentoId: c.documento_id,
    }));
    if (proceso.data.envio_set_id) {
      envioSet = await leerEnvio(supabase, organizacionId, empresaId, proceso.data.envio_set_id);
    }
  }

  const libres = cafs.data.filter((c) => c.siguiente_folio <= c.folio_hasta);
  const primero = libres[0];
  const cafSet: CafSet | null = primero
    ? {
        id: primero.id,
        folioDesde: primero.folio_desde,
        folioHasta: primero.folio_hasta,
        siguienteFolio: primero.siguiente_folio,
        disponibles: libres.reduce((suma, c) => suma + (c.folio_hasta - c.siguiente_folio + 1), 0),
      }
    : null;

  let certificado: VistaAsistente['certificado'] = null;
  const predeterminado = asociaciones.data.find((a) => a.predeterminado);
  if (predeterminado) {
    const c = await supabase
      .from('certificados')
      .select('id, nombre_titular, cn, rut_titular, vigente_hasta')
      .eq('organizacion_id', organizacionId)
      .eq('id', predeterminado.certificado_id)
      .maybeSingle();
    if (c.error) throw fallaBase('leer el certificado', c.error);
    if (c.data) {
      certificado = {
        id: c.data.id,
        titular: c.data.nombre_titular ?? c.data.cn ?? c.data.rut_titular,
        rut: c.data.rut_titular,
        vigenteHasta: c.data.vigente_hasta ?? '',
        representante: predeterminado.es_representante_electronico,
      };
    }
  }

  const listaOperaciones: OperacionAsistente[] = operaciones.data.map((o) => ({
    id: o.id,
    operacion: o.operacion,
    resultado: o.resultado,
    confirmada: o.confirmada,
    mensaje: o.mensaje,
    iniciadaEn: o.iniciada_en,
    terminadaEn: o.terminada_en,
    revisada: revisada(o.detalle),
  }));

  return {
    empresa: {
      id: empresa.data.id,
      rut: empresa.data.rut,
      razonSocial: empresa.data.razon_social,
      activa: empresa.data.activa,
      autorizadaProduccion: empresa.data.autorizada_produccion,
    },
    proceso: proceso.data ? aProceso(proceso.data) : null,
    casos,
    envioSet,
    cafSet,
    resolucionCertificacion: resolucion.data
      ? { numero: resolucion.data.numero, fecha: resolucion.data.fecha }
      : null,
    certificado,
    operaciones: listaOperaciones,
  };
}
