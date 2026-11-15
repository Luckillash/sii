import 'server-only';
import {
  AMBIENTES_FOLIO,
  type CafRango,
  disponibilidadDe,
  estadoDisponibilidad,
  TIPOS_FOLIO,
} from '@/lib/folios';
import { fallaBase } from '../certificacion/comun';
import {
  type DependenciasCertificacion,
  resolverDependencias,
} from '../certificacion/dependencias';
import { planPermiteProduccion } from './plan';
import type { FilaCaf, FilaSolicitud, OperacionFolios, ResumenTipo, VistaFolios } from './tipos';

// Lectura de `/[org]/folios` (PLAN-SAAS Fase 6, punto 1) con el cliente de SESIÓN: todo
// pasa por RLS (`lectura` para cualquier miembro: lectores y emisores ven, las acciones
// son de administradores). Cada consulta filtra además por organización y empresa.
// Nada de secretos: los CAF se leen sin `caf_secret_id` y los certificados sin los ids de
// Vault. La disponibilidad sigue la regla de `disponibilidadDe` (la de
// `v_folios_disponibles` y `asignar_folio`).

const MAXIMO_CAFS = 50;
const MAXIMO_SOLICITUDES = 30;
const MAXIMO_OPERACIONES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revisada(detalle: unknown): boolean {
  return (
    detalle !== null &&
    typeof detalle === 'object' &&
    !Array.isArray(detalle) &&
    typeof (detalle as Record<string, unknown>).revisada_en === 'string'
  );
}

/**
 * Una incierta por traslape (`detalle.incierto_motivo = 'traslape'`, ver `sii.ts`): el CAF
 * timbrado choca con uno ya cargado y subirlo no serviría. Con el rango del cargado si se
 * pudo leer.
 */
function traslapeDe(detalle: unknown): OperacionFolios['traslape'] {
  if (detalle === null || typeof detalle !== 'object' || Array.isArray(detalle)) return null;
  const d = detalle as Record<string, unknown>;
  if (d.incierto_motivo !== 'traslape') return null;
  return typeof d.traslape_desde === 'number' && typeof d.traslape_hasta === 'number'
    ? { desde: d.traslape_desde, hasta: d.traslape_hasta }
    : {};
}

/** Estado de los folios de una empresa. `null` si la empresa no es de la organización. */
export async function leerFolios(
  organizacionId: string,
  empresaId: string,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<VistaFolios | null> {
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

  const [cafs, activos, solicitudes, operaciones, asociaciones, plan] = await Promise.all([
    supabase
      .from('cafs')
      .select(
        'id, ambiente, tipo_dte, folio_desde, folio_hasta, siguiente_folio, fecha_autorizacion, estado, creado_en, solicitud_id',
      )
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .order('creado_en', { ascending: false })
      .limit(MAXIMO_CAFS),
    // Todos los activos (el historial se corta en MAXIMO_CAFS): de aquí sale el resumen.
    supabase
      .from('cafs')
      .select('id, ambiente, tipo_dte, folio_desde, folio_hasta, siguiente_folio, estado')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('estado', 'activo'),
    supabase
      .from('solicitudes_folios')
      .select(
        'id, ambiente, tipo_dte, cantidad, folio_inicial, confirmada, estado, folio_desde, folio_hasta, mensaje, solicitado_por, creado_en, terminado_en',
      )
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .order('creado_en', { ascending: false })
      .limit(MAXIMO_SOLICITUDES),
    supabase
      .from('operaciones_sii')
      .select('id, ambiente, resultado, confirmada, mensaje, iniciada_en, detalle, solicitud_id')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('operacion', 'solicitar_folios')
      .eq('confirmada', true)
      .order('iniciada_en', { ascending: false })
      .limit(MAXIMO_OPERACIONES),
    supabase
      .from('empresa_certificados')
      .select('certificado_id, es_representante_electronico')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('es_representante_electronico', true),
    // Misma fuente que el servidor al pedir folios: `plan_vigente()` (solo service_role,
    // con la organización de la membresía). Si falla, la vista no bloquea (null).
    planPermiteProduccion(deps.servicio(), organizacionId).catch(() => null),
  ]);
  if (cafs.error) throw fallaBase('leer los CAF', cafs.error);
  if (activos.error) throw fallaBase('leer los CAF', activos.error);
  if (solicitudes.error) throw fallaBase('leer las solicitudes de folios', solicitudes.error);
  if (operaciones.error) throw fallaBase('leer las operaciones', operaciones.error);
  if (asociaciones.error) {
    throw fallaBase('leer los certificados de la empresa', asociaciones.error);
  }

  // Folios anulados por CAF (conteo exacto, sin traer las filas).
  const anulados = await Promise.all(
    cafs.data.map(async (c) => {
      const r = await supabase
        .from('folios_anulados')
        .select('id', { count: 'exact', head: true })
        .eq('organizacion_id', organizacionId)
        .eq('caf_id', c.id);
      if (r.error) throw fallaBase('contar los folios anulados', r.error);
      return r.count ?? 0;
    }),
  );

  // Quién pidió cada solicitud (RLS de `perfiles`: los que comparten organización).
  const ids = [
    ...new Set(solicitudes.data.flatMap((s) => (s.solicitado_por ? [s.solicitado_por] : []))),
  ];
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const perfiles = await supabase.from('perfiles').select('id, nombre, correo').in('id', ids);
    if (!perfiles.error) {
      for (const p of perfiles.data) nombres.set(p.id, p.nombre?.trim() || p.correo || '');
    }
  }

  // Representante electrónico vigente (no revocado ni vencido), el que vence más tarde.
  let representante: VistaFolios['representante'] = null;
  const idsCert = asociaciones.data.map((a) => a.certificado_id);
  if (idsCert.length > 0) {
    const certs = await supabase
      .from('certificados')
      .select('id, nombre_titular, cn, rut_titular, vigente_hasta, revocado_en')
      .eq('organizacion_id', organizacionId)
      .in('id', idsCert);
    if (certs.error) throw fallaBase('leer los certificados', certs.error);
    const ahora = deps.reloj.ahora().getTime();
    const vigente = certs.data
      .filter(
        (c) => !c.revocado_en && (!c.vigente_hasta || new Date(c.vigente_hasta).getTime() > ahora),
      )
      .sort((a, b) => (b.vigente_hasta ?? '').localeCompare(a.vigente_hasta ?? ''))[0];
    if (vigente) {
      representante = {
        titular: vigente.nombre_titular ?? vigente.cn ?? vigente.rut_titular,
        rut: vigente.rut_titular,
        vigenteHasta: vigente.vigente_hasta ?? '',
      };
    }
  }

  const filasCaf: FilaCaf[] = cafs.data.map((c, i) => ({
    id: c.id,
    ambiente: c.ambiente,
    tipoDte: c.tipo_dte,
    desde: c.folio_desde,
    hasta: c.folio_hasta,
    siguiente: c.siguiente_folio,
    fechaAutorizacion: c.fecha_autorizacion,
    estado: c.estado,
    creadoEn: c.creado_en,
    anulados: anulados[i] ?? 0,
    deSolicitud: c.solicitud_id !== null,
  }));

  const resumen: ResumenTipo[] = AMBIENTES_FOLIO.flatMap((ambiente) =>
    TIPOS_FOLIO.map((tipoDte): ResumenTipo => {
      const rangos: CafRango[] = activos.data
        .filter((c) => c.ambiente === ambiente && c.tipo_dte === tipoDte)
        .map((c) => ({
          id: c.id,
          desde: c.folio_desde,
          hasta: c.folio_hasta,
          siguiente: c.siguiente_folio,
          estado: c.estado,
        }));
      const tuvoCaf =
        rangos.length > 0 || filasCaf.some((c) => c.ambiente === ambiente && c.tipoDte === tipoDte);
      const d = disponibilidadDe(rangos);
      const enUso = rangos.find((c) => c.id === d.cafEnUso) ?? null;
      return {
        ambiente,
        tipoDte,
        enUso: enUso
          ? { id: enUso.id, desde: enUso.desde, hasta: enUso.hasta, siguiente: enUso.siguiente }
          : null,
        disponibles: d.restante,
        total: d.total,
        estado: estadoDisponibilidad(d),
        tuvoCaf,
        puedeEmitir: d.restante > 0,
      };
    }),
  );

  const filasSolicitud: FilaSolicitud[] = solicitudes.data.map((s) => ({
    id: s.id,
    ambiente: s.ambiente,
    tipoDte: s.tipo_dte,
    cantidad: s.cantidad,
    folioInicial: s.folio_inicial,
    confirmada: s.confirmada,
    estado: s.estado,
    desde: s.folio_desde,
    hasta: s.folio_hasta,
    mensaje: s.mensaje,
    solicitadoPor: s.solicitado_por ? (nombres.get(s.solicitado_por) ?? null) : null,
    creadoEn: s.creado_en,
    terminadoEn: s.terminado_en,
  }));

  const listaOperaciones: OperacionFolios[] = operaciones.data.map((o) => ({
    id: o.id,
    ambiente: o.ambiente,
    resultado: o.resultado,
    confirmada: o.confirmada,
    mensaje: o.mensaje,
    iniciadaEn: o.iniciada_en,
    revisada: revisada(o.detalle),
    solicitudId: o.solicitud_id,
    traslape: traslapeDe(o.detalle),
  }));

  return {
    empresa: {
      id: empresa.data.id,
      rut: empresa.data.rut,
      razonSocial: empresa.data.razon_social,
      activa: empresa.data.activa,
      autorizadaProduccion: empresa.data.autorizada_produccion,
    },
    planPermiteProduccion: plan,
    representante,
    resumen,
    cafs: filasCaf,
    solicitudes: filasSolicitud,
    operaciones: listaOperaciones,
  };
}
