import 'server-only';
import {
  CODIGOS_ERROR,
  type CodigoError,
  type DocumentoApi,
  type ListaApi,
  RUTA_API,
  SEGUNDOS_ARRIENDO_IDEMPOTENCIA,
} from '@/lib/api-publica';
import type { ResultadoEmision } from '@/lib/emision';
import type { Json } from '../supabase/tipos';
import { codificarCursor } from './cursor';
import { empresaRef, exigirActiva, resolverEmpresa } from './empresas';
import {
  aBorrador,
  type EmisionApi,
  esquemaEmisionApi,
  leerCuerpoJson,
  leerParametrosListado,
  validar,
} from './esquemas';
import { exigirClaveIdempotencia, huella } from './idempotencia';
import type { ContextoApi } from './manejar';
import type { Ambito, ClaveAutenticada, RepositorioApi } from './repositorio';
import { representarDocumento } from './representacion';
import { cuerpoError, ErrorApi, respuestaJson, respuestaRepetida } from './respuestas';

// Documentos de la API pública (PLAN-SAAS Fase 11, §2.2 y §2.3 del diseño).
//
// EMITIR (`POST /documentos`, alcance `documentos:emitir`, `Idempotency-Key` obligatoria):
//   1. Valida la boleta (mismo `esquemaBorrador` del panel) y la empresa ANTES de reclamar
//      la clave: un error de datos no ocupa la clave.
//   2. Reclama la clave en `api_idempotencia` con la huella de la boleta: `conflicto` →
//      422; `en_curso` → 409 con `Retry-After`; `terminada` → la respuesta guardada, con
//      `Idempotent-Replayed: true`; `nueva` o `retomada` → sigue.
//   3. Si ya hay un documento con esa clave: emitido (la función anterior murió después de
//      emitir) → se responde su estado actual; en borrador → se emite ESE borrador.
//   4. `emitirDocumento` de la Fase 7 con `usuarioId: null` y la API key (origen `api`,
//      borrador guardado con service_role filtrando por organización y empresa, operación
//      con `api_key_id`). Mismas invariantes: token antes del folio, un solo update a
//      `firmado`, `23514`, incierto.
//   5. Se GUARDA la respuesta (la clave queda `terminada`) cuando hay un documento con
//      folio: emitido (201), incierto o firmado sin Track ID (202) o anulado por un rechazo
//      del SII (422). Un error sin documento (validación, folios, cuota, transporte antes de
//      salir) SUELTA la clave: repetir con la misma clave retoma el mismo borrador.

/** Resultado de una emisión, para la ruta y para cada ítem del lote. */
export interface SalidaEmision {
  status: number;
  cuerpo: unknown;
  cabeceras: Record<string, string>;
  repetida: boolean;
}

export function ambitoDe(clave: ClaveAutenticada): Ambito {
  return {
    organizacionId: clave.organizacionId,
    ambiente: clave.ambiente,
    empresaId: clave.empresaId,
  };
}

/** Un documento en la forma de la API (con líneas si se piden), o `null` si no está a su alcance. */
export async function documentoApi(
  repo: RepositorioApi,
  ambito: Ambito,
  id: string,
  conLineas: boolean,
): Promise<DocumentoApi | null> {
  const fila = await repo.documento(ambito, id);
  if (!fila) return null;
  const [empresa, envios, lineas] = await Promise.all([
    repo.empresaPorId(ambito.organizacionId, fila.empresa_id),
    fila.envio_id ? repo.enviosCortos(ambito.organizacionId, [fila.envio_id]) : [],
    conLineas ? repo.lineas(ambito.organizacionId, fila.id) : undefined,
  ]);
  if (!empresa) return null;
  return representarDocumento(fila, empresa, envios[0] ?? null, lineas);
}

function ubicacion(id: string): Record<string, string> {
  return { Location: `${RUTA_API}/documentos/${id}` };
}

// --- Traducción de `ResultadoEmision` --------------------------------------------------

const CODIGO_POR_MOTIVO: Partial<Record<string, CodigoError>> = {
  empresa_inactiva: 'empresa_inactiva',
  empresa_no_encontrada: 'no_encontrado',
  sin_autorizacion: 'sin_autorizacion',
  plan_sin_produccion: 'plan_sin_produccion',
  sin_resolucion: 'sin_resolucion',
  sin_certificado: 'sin_certificado',
  // ErrorCredenciales (sin certificado vigente, vencido, revocado...): `config`.
  config: 'sin_certificado',
  sin_folios: 'sin_folios',
  cuota: 'cuota_agotada',
  receptor_sin_razon_social: 'datos_invalidos',
  en_curso: 'operacion_en_curso',
  incierto_sin_revisar: 'incierto_sin_revisar',
  idempotencia_en_uso: 'idempotencia_en_curso',
  // Carreras con el panel sobre el borrador de esta clave (alguien lo borró, lo emitió o
  // anuló los folios justo entonces): casos de negocio, no errores internos.
  borrador_no_encontrado: 'operacion_en_curso',
  borrador_emitido: 'operacion_en_curso',
  borrador_cambio: 'operacion_en_curso',
  folio_anulado: 'operacion_en_curso',
  documento_incierto: 'incierto_sin_revisar',
  // La API autoriza por alcance; no debería ocurrir, pero no es un 500.
  sin_permiso: 'alcance_insuficiente',
};

/**
 * Mensajes de la API para los motivos cuyo texto del panel habla de la pantalla. Dicen qué
 * pasó y qué hacer con la `Idempotency-Key`.
 */
const MENSAJE_POR_MOTIVO: Partial<Record<string, string>> = {
  borrador_no_encontrado:
    'La boleta guardada con esta Idempotency-Key se borró desde el panel mientras la emitíamos. Nada salió al SII. Repite la petición con la misma clave.',
  borrador_emitido:
    'La boleta con esta Idempotency-Key ya se emitió. Repite la petición con la misma clave para recibirla, o consúltala con GET /documentos?clave_idempotencia=<clave>.',
  borrador_cambio:
    'La boleta guardada con esta Idempotency-Key cambió en el panel mientras la emitíamos. Su folio quedó anulado y nada salió al SII. Consulta GET /documentos?clave_idempotencia=<clave> antes de repetir.',
  folio_anulado:
    'Los folios asignados se anularon mientras emitíamos. Nada salió al SII. Repite la petición con la misma Idempotency-Key.',
  documento_incierto:
    'La boleta con esta Idempotency-Key quedó con resultado incierto: no sabemos si el SII la recibió. No la emitas con otra clave; revísala en el panel o con GET /documentos?clave_idempotencia=<clave>.',
};

/** Códigos con mensaje propio de la emisión (más preciso que el genérico del contrato). */
const CON_MENSAJE_DE_EMISION: ReadonlySet<CodigoError> = new Set([
  'sin_certificado',
  'rechazado_por_sii',
  'error_interno',
]);

/** `receptor.razonSocial` → `receptor.razon_social`. */
function aSnake(ruta: string): string {
  return ruta.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
}

type ErrorEmision = Extract<ResultadoEmision, { tipo: 'error' }>;

/** Un error de la emisión sin documento, como `ErrorApi` (la clave se suelta). */
export function errorDeEmision(r: ErrorEmision): ErrorApi {
  let codigo: CodigoError =
    (r.motivo ? CODIGO_POR_MOTIVO[r.motivo] : undefined) ??
    (r.resultado === 'transporte'
      ? 'sii_no_disponible'
      : r.resultado === 'rechazo_sii'
        ? 'rechazado_por_sii'
        : 'error_interno');
  const campos = r.errores
    ? Object.fromEntries(Object.entries(r.errores).map(([k, v]) => [aSnake(k), v]))
    : undefined;
  if (campos && codigo === 'error_interno') codigo = 'datos_invalidos';
  const mensajeMotivo = r.motivo ? MENSAJE_POR_MOTIVO[r.motivo] : undefined;
  return new ErrorApi(codigo, {
    ...(mensajeMotivo
      ? { mensaje: mensajeMotivo }
      : CON_MENSAJE_DE_EMISION.has(codigo)
        ? { mensaje: r.mensaje.detalle }
        : {}),
    ...(codigo === 'error_interno'
      ? { diagnostico: { motivo: r.motivo ?? 'ninguno', resultado: r.resultado ?? 'ninguno' } }
      : {}),
    ...(campos ? { campos } : {}),
    ...(codigo === 'sii_no_disponible' ? { cabeceras: { 'Retry-After': '60' } } : {}),
    ...(codigo === 'idempotencia_en_curso' ? { cabeceras: { 'Retry-After': '5' } } : {}),
  });
}

/**
 * La respuesta definitiva para un documento con folio (emitido, incierto o anulado). El
 * 422 `rechazado_por_sii` lleva siempre el mensaje del contrato (pide una clave nueva: esta
 * respuesta queda guardada para la clave); el texto de la emisión va solo en
 * `documento.aviso`.
 */
function salidaDeDocumento(
  doc: DocumentoApi,
  aviso?: { titulo: string; detalle: string },
): SalidaEmision {
  if (doc.estado === 'anulado') {
    return {
      status: CODIGOS_ERROR.rechazado_por_sii,
      cuerpo: cuerpoError('rechazado_por_sii', { documento: aviso ? { ...doc, aviso } : doc }),
      cabeceras: {},
      repetida: false,
    };
  }
  const provisorio = doc.estado === 'incierto' || doc.estado === 'firmado';
  return {
    status: provisorio ? 202 : 201,
    cuerpo: provisorio && aviso ? { ...doc, aviso } : doc,
    cabeceras: ubicacion(doc.id),
    repetida: false,
  };
}

// --- Emisión con idempotencia ----------------------------------------------------------

export interface PeticionEmision {
  entrada: EmisionApi;
  claveIdempotencia: string;
  /** Prefijo de `campos` (`documentos.3`, en el lote). */
  prefijo?: string;
}

/** Emite una boleta (o devuelve la ya emitida con esa clave). Lanza `ErrorApi`. */
export async function emitirConIdempotencia(
  { clave, deps }: Pick<ContextoApi, 'clave' | 'deps'>,
  { entrada, claveIdempotencia, prefijo = '' }: PeticionEmision,
): Promise<SalidaEmision> {
  const { repo } = deps;
  const borrador = aBorrador(entrada, clave.ambiente, prefijo);
  const empresa = await resolverEmpresa(repo, clave, entrada.empresa, { requerida: true });
  exigirActiva(empresa);
  const ambito = ambitoDe(clave);
  const org = clave.organizacionId;

  const reclamo = await repo.reclamarIdempotencia({
    organizacionId: org,
    clave: claveIdempotencia,
    recurso: 'documento',
    huella: huella({ recurso: 'documento', empresa_id: empresa.id, borrador }),
    apiKeyId: clave.apiKeyId,
    arriendoSegundos: SEGUNDOS_ARRIENDO_IDEMPOTENCIA,
  });
  if (reclamo.resultado === 'conflicto') throw new ErrorApi('idempotencia_conflicto');
  if (reclamo.resultado === 'en_curso') {
    throw new ErrorApi('idempotencia_en_curso', { cabeceras: { 'Retry-After': '5' } });
  }
  if (reclamo.resultado === 'terminada') {
    const status = reclamo.statusHttp ?? 200;
    return {
      status,
      cuerpo: reclamo.respuesta,
      cabeceras:
        reclamo.recursoId && (status === 201 || status === 202) ? ubicacion(reclamo.recursoId) : {},
      repetida: true,
    };
  }

  let guardada = false;
  const terminar = async (salida: SalidaEmision, recursoId: string) => {
    await repo.terminarIdempotencia({
      organizacionId: org,
      clave: claveIdempotencia,
      statusHttp: salida.status,
      respuesta: salida.cuerpo as Json,
      recursoId,
    });
    guardada = true;
    return salida;
  };
  try {
    const existente = await repo.documentoPorClave(org, claveIdempotencia);
    if (existente && existente.estado !== 'borrador') {
      const doc = await documentoApi(repo, ambito, existente.id, true);
      if (!doc) throw new ErrorApi('idempotencia_conflicto');
      return await terminar(salidaDeDocumento(doc, doc.aviso), doc.id);
    }

    const r = await deps.emitir(
      {
        organizacionId: org,
        empresaId: empresa.id,
        usuarioId: null,
        apiKeyId: clave.apiKeyId,
      },
      {
        nivel: 'emitir',
        borrador,
        ...(existente ? { borradorId: existente.id } : {}),
        claveIdempotencia,
      },
    );

    if (r.tipo === 'ok') {
      const doc = await documentoApi(repo, ambito, r.documento.id, true);
      if (!doc) throw new Error('El documento recién emitido no se pudo leer.');
      return await terminar(salidaDeDocumento(doc), doc.id);
    }
    if (r.tipo === 'error' && r.documento) {
      const doc = await documentoApi(repo, ambito, r.documento.id, true);
      if (!doc) throw new Error('El documento de la emisión no se pudo leer.');
      return await terminar(salidaDeDocumento(doc, r.mensaje), doc.id);
    }
    if (r.tipo === 'error') throw errorDeEmision(r);
    throw new Error(`Resultado inesperado de la emisión: ${r.tipo}`);
  } finally {
    if (!guardada) {
      await repo
        .soltarIdempotencia({ organizacionId: org, clave: claveIdempotencia })
        .catch((error: unknown) => {
          console.warn('api-publica: no se pudo liberar la Idempotency-Key', {
            tipo: error instanceof Error ? error.name : typeof error,
          });
        });
    }
  }
}

function aRespuesta(salida: SalidaEmision): Response {
  return salida.repetida
    ? respuestaRepetida(salida.cuerpo, salida.status, salida.cabeceras)
    : respuestaJson(salida.cuerpo, salida.status, salida.cabeceras);
}

/** Ensayo (`?ensayo=1`): valida y resume con el folio previsto, sin folio, red ni filas. */
async function ensayar(ctx: ContextoApi, entrada: EmisionApi): Promise<Response> {
  const { clave, deps } = ctx;
  const borrador = aBorrador(entrada, clave.ambiente);
  const empresa = await resolverEmpresa(deps.repo, clave, entrada.empresa, { requerida: true });
  exigirActiva(empresa);
  const r = await deps.emitir(
    {
      organizacionId: clave.organizacionId,
      empresaId: empresa.id,
      usuarioId: null,
      apiKeyId: clave.apiKeyId,
    },
    { nivel: 'ensayo', borrador },
  );
  if (r.tipo === 'error') throw errorDeEmision(r);
  if (r.tipo !== 'ensayo') throw new Error(`Resultado inesperado del ensayo: ${r.tipo}`);
  const t = r.resumen.totales;
  return respuestaJson({
    objeto: 'ensayo',
    empresa: empresaRef(empresa),
    ambiente: clave.ambiente,
    tipo_dte: borrador.tipoDte,
    folio_previsto: r.resumen.folioPrevisto,
    totales: {
      neto: t.neto,
      exento: t.exento,
      iva: t.iva,
      total: t.total,
      descuento: t.descuentoAplicado,
    },
    avisos: r.resumen.avisos,
  });
}

/** `POST /documentos`. */
export async function manejarEmision(ctx: ContextoApi): Promise<Response> {
  const ensayo = new URL(ctx.request.url).searchParams.get('ensayo');
  const cuerpo = await leerCuerpoJson(ctx.request);
  const entrada = validar(esquemaEmisionApi, cuerpo);
  if (ensayo === '1' || ensayo === 'true') return ensayar(ctx, entrada);
  const claveIdempotencia = exigirClaveIdempotencia(ctx.request.headers);
  return aRespuesta(await emitirConIdempotencia(ctx, { entrada, claveIdempotencia }));
}

// --- Lectura -------------------------------------------------------------------------

/** `GET /documentos/{id}`. */
export async function manejarDocumento(ctx: ContextoApi, id: string): Promise<Response> {
  const doc = await documentoApi(ctx.deps.repo, ambitoDe(ctx.clave), id, true);
  // Las boletas del set de pruebas no son de la operación: el listado tampoco las muestra.
  if (!doc || doc.origen === 'set_pruebas') throw new ErrorApi('no_encontrado');
  return respuestaJson(doc);
}

/** `GET /documentos`: lista sin líneas, por `creado_en` descendente. */
export async function manejarListado(ctx: ContextoApi): Promise<Response> {
  const { clave, deps } = ctx;
  const p = leerParametrosListado(new URL(ctx.request.url).searchParams);
  const empresa = await resolverEmpresa(deps.repo, clave, p.empresa, { requerida: false });
  const ambito = ambitoDe(clave);
  const filas = await deps.repo.listarDocumentos(ambito, {
    ...(empresa ? { empresaId: empresa.id } : {}),
    ...(p.tipoDte !== undefined ? { tipoDte: p.tipoDte } : {}),
    ...(p.estados ? { estados: p.estados } : {}),
    ...(p.desde ? { desde: p.desde } : {}),
    ...(p.hasta ? { hasta: p.hasta } : {}),
    ...(p.folio !== undefined ? { folio: p.folio } : {}),
    ...(p.receptorRut ? { receptorRut: p.receptorRut } : {}),
    ...(p.claveIdempotencia ? { claveIdempotencia: p.claveIdempotencia } : {}),
    ...(p.origen ? { origen: p.origen } : {}),
    ...(p.cursor ? { cursor: p.cursor } : {}),
    limite: p.limite,
  });
  const pagina = filas.slice(0, p.limite);
  const [empresas, envios] = await Promise.all([
    deps.repo.empresas(
      clave.organizacionId,
      pagina.map((f) => f.empresa_id),
    ),
    deps.repo.enviosCortos(
      clave.organizacionId,
      pagina.flatMap((f) => (f.envio_id ? [f.envio_id] : [])),
    ),
  ]);
  const datos = pagina.flatMap((f) => {
    const e = empresas.find((x) => x.id === f.empresa_id);
    if (!e) return [];
    return [representarDocumento(f, e, envios.find((x) => x.id === f.envio_id) ?? null)];
  });
  const ultima = pagina.at(-1);
  const tieneMas = filas.length > p.limite;
  const lista: ListaApi<DocumentoApi> = {
    objeto: 'lista',
    datos,
    tiene_mas: tieneMas,
    siguiente_cursor:
      tieneMas && ultima ? codificarCursor({ creadoEn: ultima.creado_en, id: ultima.id }) : null,
  };
  return respuestaJson(lista);
}
