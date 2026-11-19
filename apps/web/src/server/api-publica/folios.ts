import 'server-only';
import type {
  CodigoError,
  EstadoFoliosApi,
  FoliosApi,
  SolicitudFoliosApi,
} from '@/lib/api-publica';
import type { ResultadoFolios } from '@/lib/folios';
import { armarResumen } from '../folios/lectura';
import type { Json } from '../supabase/tipos';
import { empresaRef, exigirActiva, resolverEmpresa } from './empresas';
import { esquemaSolicitudFoliosApi, leerCuerpoJson, validar } from './esquemas';
import { exigirClaveIdempotencia, huella } from './idempotencia';
import type { ContextoApi } from './manejar';
import type { FilaEmpresaApi } from './repositorio';
import { representarCaf } from './representacion';
import { ErrorApi, respuestaJson, respuestaRepetida } from './respuestas';

// Folios de la API pública (PLAN-SAAS Fase 11, §2.2 del diseño).
//
//   GET /folios (`folios:leer`): disponibles por tipo en el ambiente de la clave, con el
//   mismo cálculo que el panel y el Tablero (`armarResumen`, Fase 6/9).
//
//   POST /folios/solicitudes (`folios:solicitar`): `solicitarFolios` de la Fase 6 con la
//   API key en vez de un usuario. Los mismos tres niveles: `ensayo` (sin red ni filas),
//   `revision` (sale al SII sin timbrar; deja una solicitud `simulada` y su `revision_id`)
//   y `timbrar` (⚠️, con `Idempotency-Key` obligatoria). En producción la revisión es
//   OBLIGATORIA antes de timbrar, igual que en el panel: se envía su `revision_id` (30
//   min, un solo uso). Un incierto bloquea nuevas solicitudes hasta revisarlo en el panel.

const TIPOS = [39, 41] as const;

/** `GET /folios`. */
export async function manejarFolios(ctx: ContextoApi): Promise<Response> {
  const { clave, deps } = ctx;
  const params = new URL(ctx.request.url).searchParams;
  const tipoPedido = params.get('tipo_dte');
  if (tipoPedido !== null && tipoPedido !== '39' && tipoPedido !== '41') {
    throw new ErrorApi('parametro_invalido', { campos: { tipo_dte: 'Usa 39 o 41.' } });
  }
  const empresa = await resolverEmpresa(deps.repo, clave, params.get('empresa'), {
    requerida: true,
  });
  const cafs = await deps.repo.cafs(clave.organizacionId, empresa.id, clave.ambiente);
  const resumen = armarResumen(cafs, (ambiente, tipoDte) =>
    cafs.some((c) => c.ambiente === ambiente && c.tipo_dte === tipoDte),
  );
  const tipos = TIPOS.filter((t) => tipoPedido === null || Number(tipoPedido) === t).map((t) => {
    const r = resumen.find((x) => x.ambiente === clave.ambiente && x.tipoDte === t);
    const estado: EstadoFoliosApi = !r?.tuvoCaf
      ? 'sin_folios'
      : r.disponibles <= 0
        ? 'agotado'
        : r.estado === 'aviso'
          ? 'por_agotarse'
          : 'ok';
    return {
      tipo_dte: t,
      disponibles: r?.disponibles ?? 0,
      total: r?.total ?? 0,
      siguiente_folio: r?.enUso?.siguiente ?? null,
      estado,
      cafs: cafs.filter((c) => c.tipo_dte === t).map(representarCaf),
    };
  });
  const cuerpo: FoliosApi = {
    objeto: 'folios',
    empresa: empresaRef(empresa),
    ambiente: clave.ambiente,
    tipos,
  };
  return respuestaJson(cuerpo);
}

// --- Solicitudes --------------------------------------------------------------------

const CODIGO_POR_MOTIVO: Partial<Record<string, CodigoError>> = {
  revision_requerida: 'revision_requerida',
  revision_usada: 'revision_requerida',
  sin_autorizacion: 'sin_autorizacion',
  plan_sin_produccion: 'plan_sin_produccion',
  empresa_desactivada: 'empresa_inactiva',
  empresa_no_encontrada: 'no_encontrado',
  tipo_no_permitido: 'datos_invalidos',
  en_curso: 'operacion_en_curso',
  incierto_sin_revisar: 'incierto_sin_revisar',
  // ErrorCredenciales: el certificado no es de un representante, venció, falta...
  config: 'sin_certificado',
};

/** Códigos cuyo mensaje del contrato no aplica a folios: va el de la capa de folios. */
const CON_MENSAJE_PROPIO: ReadonlySet<CodigoError> = new Set([
  'revision_requerida',
  'sin_certificado',
  'rechazado_por_sii',
  'error_interno',
  'datos_invalidos',
]);

type FalloFolios = Extract<ResultadoFolios, { tipo: 'error' }>;

export function errorDeFolios(r: FalloFolios): ErrorApi {
  const sugerido = r.requiere?.folioInicial?.sugerido;
  if (sugerido) {
    return new ErrorApi('datos_invalidos', {
      mensaje: r.mensaje.detalle,
      campos: {
        folio_inicial: `El SII pide el folio inicial en el primer timbraje de este tipo; sugiere ${sugerido}.`,
      },
    });
  }
  const codigo: CodigoError =
    (r.motivo ? CODIGO_POR_MOTIVO[r.motivo] : undefined) ??
    (r.resultado === 'transporte'
      ? 'sii_no_disponible'
      : r.resultado === 'rechazo_sii'
        ? 'rechazado_por_sii'
        : 'error_interno');
  return new ErrorApi(codigo, {
    ...(CON_MENSAJE_PROPIO.has(codigo) ? { mensaje: r.mensaje.detalle } : {}),
    ...(r.operacionPendienteId ? { operacionPendienteId: r.operacionPendienteId } : {}),
    ...(codigo === 'sii_no_disponible' ? { cabeceras: { 'Retry-After': '60' } } : {}),
  });
}

function base(
  empresa: FilaEmpresaApi,
  ctx: ContextoApi,
  e: { nivel: SolicitudFoliosApi['nivel']; tipo_dte: 39 | 41; cantidad: number },
): SolicitudFoliosApi {
  return {
    objeto: 'solicitud_folios',
    nivel: e.nivel,
    empresa: empresaRef(empresa),
    ambiente: ctx.clave.ambiente,
    tipo_dte: e.tipo_dte,
    cantidad: e.cantidad,
    desde: null,
    hasta: null,
    revision_id: null,
    caf: null,
    operacion_id: null,
  };
}

/** `POST /folios/solicitudes`. */
export async function manejarSolicitudFolios(ctx: ContextoApi): Promise<Response> {
  const { clave, deps } = ctx;
  const entrada = validar(esquemaSolicitudFoliosApi, await leerCuerpoJson(ctx.request));
  if (entrada.ambiente !== undefined && entrada.ambiente !== clave.ambiente) {
    throw new ErrorApi('ambiente_no_coincide');
  }
  const empresa = await resolverEmpresa(deps.repo, clave, entrada.empresa, { requerida: true });
  exigirActiva(empresa);
  const timbrar = entrada.nivel === 'timbrar';
  const claveIdempotencia = timbrar ? exigirClaveIdempotencia(ctx.request.headers) : null;
  const org = clave.organizacionId;

  if (claveIdempotencia) {
    const reclamo = await deps.repo.reclamarIdempotencia({
      organizacionId: org,
      clave: claveIdempotencia,
      recurso: 'solicitud_folios',
      huella: huella({
        recurso: 'solicitud_folios',
        empresa_id: empresa.id,
        ambiente: clave.ambiente,
        tipo_dte: entrada.tipo_dte,
        cantidad: entrada.cantidad,
        folio_inicial: entrada.folio_inicial ?? null,
        revision_id: entrada.revision_id ?? null,
      }),
      apiKeyId: clave.apiKeyId,
      arriendoSegundos: 330,
    });
    if (reclamo.resultado === 'conflicto') {
      throw new ErrorApi('idempotencia_conflicto', {
        mensaje:
          'Ya usaste esta Idempotency-Key con otra solicitud de folios. Usa una clave nueva para cada solicitud distinta.',
      });
    }
    if (reclamo.resultado === 'en_curso') {
      throw new ErrorApi('idempotencia_en_curso', { cabeceras: { 'Retry-After': '30' } });
    }
    if (reclamo.resultado === 'terminada') {
      return respuestaRepetida(reclamo.respuesta, reclamo.statusHttp ?? 200);
    }
    // Retomada tras un timbraje `ok` cuya respuesta no se pudo guardar: la clave se soltó
    // apuntando a la operación (`recurso_id`). Si esa operación dejó un CAF, se responde ese
    // CAF en vez de pedir folios otra vez (en certificación nada más lo frenaría).
    if (reclamo.resultado === 'retomada' && reclamo.recursoId) {
      const caf = await deps.repo.cafDeOperacion(org, reclamo.recursoId);
      if (caf) {
        const respuesta: SolicitudFoliosApi = {
          ...base(empresa, ctx, entrada),
          desde: caf.folio_desde,
          hasta: caf.folio_hasta,
          caf: representarCaf(caf),
          operacion_id: reclamo.recursoId,
        };
        await deps.repo.terminarIdempotencia({
          organizacionId: org,
          clave: claveIdempotencia,
          statusHttp: 201,
          respuesta: respuesta as unknown as Json,
          recursoId: caf.id,
        });
        return respuestaJson(respuesta, 201);
      }
    }
  }

  let guardada = false;
  /** Operación de un timbraje `ok`: si guardar falla, la clave se suelta apuntando a ella. */
  let operacionTimbrada: string | null = null;
  try {
    const r = await deps.solicitarFolios(
      { organizacionId: org, empresaId: empresa.id, usuarioId: null, apiKeyId: clave.apiKeyId },
      {
        nivel: entrada.nivel,
        tipoDte: entrada.tipo_dte,
        ambiente: clave.ambiente,
        cantidad: entrada.cantidad,
        ...(entrada.folio_inicial !== undefined ? { folioInicial: entrada.folio_inicial } : {}),
        ...(entrada.revision_id !== undefined ? { revisionId: entrada.revision_id } : {}),
      },
    );
    const cuerpo = base(empresa, ctx, entrada);

    if (r.tipo === 'ensayo') {
      return respuestaJson({
        ...cuerpo,
        aviso: { titulo: r.resumen.titulo, detalle: r.resumen.avisos.join(' ') },
      } satisfies SolicitudFoliosApi);
    }
    if (r.tipo === 'revision') {
      return respuestaJson({
        ...cuerpo,
        desde: r.revision.desde,
        hasta: r.revision.hasta,
        revision_id: r.revision.revisionId,
        operacion_id: r.operacionId,
      } satisfies SolicitudFoliosApi);
    }

    let status: number;
    let respuesta: SolicitudFoliosApi;
    if (r.tipo === 'ok') {
      operacionTimbrada = r.operacionId ?? null;
      const caf = r.operacionId ? await deps.repo.cafDeOperacion(org, r.operacionId) : null;
      respuesta = {
        ...cuerpo,
        desde: caf?.folio_desde ?? null,
        hasta: caf?.folio_hasta ?? null,
        caf: caf ? representarCaf(caf) : null,
        operacion_id: r.operacionId,
        ...(r.avisos && r.avisos.length > 0
          ? { aviso: { titulo: r.mensaje.titulo, detalle: r.avisos.join(' ') } }
          : {}),
      };
      status = 201;
    } else if (r.resultado === 'incierto') {
      // No se sabe si el SII timbró: se guarda (repetir no vuelve a pedir folios).
      respuesta = { ...cuerpo, operacion_id: r.operacionId, aviso: { ...r.mensaje } };
      status = 202;
    } else {
      throw errorDeFolios(r);
    }
    if (claveIdempotencia) {
      await deps.repo.terminarIdempotencia({
        organizacionId: org,
        clave: claveIdempotencia,
        statusHttp: status,
        respuesta: respuesta as unknown as Json,
        recursoId: respuesta.caf?.id ?? null,
      });
      guardada = true;
    }
    return respuestaJson(respuesta, status);
  } finally {
    if (claveIdempotencia && !guardada) {
      await deps.repo
        .soltarIdempotencia({
          organizacionId: org,
          clave: claveIdempotencia,
          ...(operacionTimbrada ? { recursoId: operacionTimbrada } : {}),
        })
        .catch(() => undefined);
    }
  }
}
