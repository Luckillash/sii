import type { Database } from '@/server/supabase/tipos';

// Contrato compartido de la Fase 11 (PLAN-SAAS §7, «API pública y webhooks»): alcances,
// eventos, cabeceras, límites, códigos de error con sus mensajes y la forma de lo que
// responde `/api/v1`. Puro (sin `server-only`, `node:*` ni React): lo importan las rutas
// de `/api/v1`, `server/api-publica/`, `server/webhooks/`, la UI de Configuración → API y
// Webhooks, la especificación OpenAPI y la página de documentación.
//
// Varias constantes están SINCRONIZADAS con la base: si cambian allá, cambian aquí.
//   ALCANCES            = check de `api_keys.alcances` (0001)
//   EVENTOS_WEBHOOK     = check de `webhooks.eventos` (0001)
//   MAX_INTENTOS_WEBHOOK, ESPERAS_WEBHOOK_MIN = `cerrar_entrega_webhook` (0018)
//   validarUrlWebhook   = check `webhooks_url_permitida` (0018)

type Enums = Database['public']['Enums'];
export type AmbienteSii = Enums['ambiente_sii'];
export type EstadoDocumento = Enums['estado_documento'];
export type OrigenDocumento = Enums['origen_documento'];
export type EstadoEntregaWebhook = Enums['estado_entrega_webhook'];
export type CanalSii = Enums['canal_sii'];
export type ClasificacionEnvio = Enums['clasificacion_envio'];
export type PropositoEnvio = Enums['proposito_envio'];
export type TipoObservacion = Enums['tipo_observacion'];

export const RUTA_API = '/api/v1';
export const URL_API = 'https://boleteame.dev/api/v1';
export const RUTA_DOCS_API = '/docs/api';

// --- Alcances ---------------------------------------------------------------------

/** Igual al check de `api_keys.alcances` (0001). */
export const ALCANCES = [
  'documentos:leer',
  'documentos:emitir',
  'folios:leer',
  'folios:solicitar',
  'envios:leer',
  'certificacion:gestionar',
] as const;
export type Alcance = (typeof ALCANCES)[number];

/** Lo que la UI ofrece: `certificacion:gestionar` queda reservado (sin rutas en la Fase 11). */
export const ALCANCES_OFRECIDOS = [
  'documentos:leer',
  'documentos:emitir',
  'folios:leer',
  'folios:solicitar',
  'envios:leer',
] as const satisfies readonly Alcance[];

/** Alcances marcados por defecto al crear una clave. */
export const ALCANCES_POR_DEFECTO = [
  'documentos:leer',
  'documentos:emitir',
  'envios:leer',
] as const satisfies readonly Alcance[];

export const DESCRIPCION_ALCANCE: Record<Alcance, string> = {
  'documentos:leer': 'Listar y ver boletas, y descargar su XML y PDF.',
  'documentos:emitir': 'Emitir boletas, de a una o en lote.',
  'folios:leer': 'Ver los folios disponibles por tipo de documento.',
  'folios:solicitar': 'Pedir folios (CAF) al SII.',
  'envios:leer': 'Ver el estado de los envíos al SII, con sus rechazos y reparos.',
  'certificacion:gestionar': 'Reservado: la certificación se hace desde el panel.',
};

export function esAlcance(valor: unknown): valor is Alcance {
  return typeof valor === 'string' && (ALCANCES as readonly string[]).includes(valor);
}

// --- API keys ---------------------------------------------------------------------

/** Lo que genera `crear_api_key`: prefijo por ambiente y `token_aleatorio()` (64 hex). */
export const FORMATO_CLAVE = /^sk_(test|live)_[0-9a-f]{64}$/;

/** Ambiente de una clave según su prefijo, o `null` si no tiene el formato de una clave. */
export function ambienteDeClave(clave: string): AmbienteSii | null {
  const coincidencia = FORMATO_CLAVE.exec(clave);
  if (!coincidencia) return null;
  return coincidencia[1] === 'live' ? 'produccion' : 'certificacion';
}

// --- Webhooks ---------------------------------------------------------------------

/** Igual al check de `webhooks.eventos` (0001). */
export const EVENTOS_WEBHOOK = [
  'documento.aceptado',
  'documento.aceptado_con_reparos',
  'documento.rechazado',
  'documento.incierto',
  'envio.actualizado',
  'folios.por_agotarse',
  'certificado.por_vencer',
  'certificacion.actualizada',
] as const;
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number];

/** Lo encola `probar_webhook` (0018); no se puede suscribir. */
export const EVENTO_PRUEBA = 'webhook.prueba' as const;

export const DESCRIPCION_EVENTO: Record<EventoWebhook, string> = {
  'documento.aceptado': 'El SII aceptó la boleta.',
  'documento.aceptado_con_reparos': 'El SII aceptó la boleta con reparos.',
  'documento.rechazado': 'El SII rechazó la boleta.',
  'documento.incierto':
    'No sabemos si el envío llegó al SII: hay que revisarlo antes de volver a emitir.',
  'envio.actualizado': 'Cambió el estado de un envío al SII o sus conteos.',
  'folios.por_agotarse': 'Quedan pocos folios de un tipo de documento, o se agotaron.',
  'certificado.por_vencer': 'Un certificado digital vence en 30, 15, 7 o 1 días.',
  'certificacion.actualizada': 'Avanzó la certificación de una empresa ante el SII.',
};

export function esEventoWebhook(valor: unknown): valor is EventoWebhook {
  return typeof valor === 'string' && (EVENTOS_WEBHOOK as readonly string[]).includes(valor);
}

export const CABECERAS_WEBHOOK = {
  firma: 'Boleteame-Firma',
  evento: 'Boleteame-Evento',
  entrega: 'Boleteame-Entrega',
  intento: 'Boleteame-Intento',
} as const;

/** Antigüedad máxima recomendada de `t` en la firma, en segundos. */
export const TOLERANCIA_FIRMA_S = 300;
/** SINCRONIZADA con `cerrar_entrega_webhook` (0018): descartada después de este intento. */
export const MAX_INTENTOS_WEBHOOK = 8;
/** SINCRONIZADA con la 0018: espera después del intento n (n = 1..7), en minutos (±10 %). */
export const ESPERAS_WEBHOOK_MIN = [1, 5, 30, 120, 360, 720, 1440] as const;
/** Tiempo máximo de respuesta del receptor, en milisegundos. */
export const TIMEOUT_ENTREGA_MS = 10_000;

export const ETIQUETA_ESTADO_ENTREGA: Record<EstadoEntregaWebhook, string> = {
  pendiente: 'Pendiente',
  fallido: 'Reintentando',
  entregado: 'Entregada',
  descartado: 'Descartada',
};

export const MAXIMO_URL_WEBHOOK = 2048;

const PATRON_URL_WEBHOOK = /^https:\/\/[A-Za-z0-9.-]+(:443)?(\/[^\s]*)?$/;
const PATRON_HOST_LOCAL_O_IP = /^https:\/\/(localhost|[0-9.]+)(:443)?(\/|\?|$)/i;
const PATRON_DOMINIO_INTERNO = /^https:\/\/[^/?]*\.(local|localhost|internal)(:443)?(\/|\?|$)/i;
/** Host con punto final (`https://localhost./`): la 0018 lo rechaza. */
const PATRON_HOST_PUNTO_FINAL = /^https:\/\/[^/:]*\.(:443)?(\/|$)/;

/**
 * Espejo del check `webhooks_url_permitida` (0018): https, puerto 443 (o sin puerto), sin
 * usuario ni clave, sin IP literal (v4 o v6), sin `localhost` ni dominios `.local`,
 * `.localhost` o `.internal`, y hasta 2.048 caracteres. La protección completa contra SSRF
 * (lo que resuelve el DNS) la hace la entrega en `server/webhooks/ssrf.ts`.
 */
export function validarUrlWebhook(
  url: string,
): { ok: true; url: string } | { ok: false; mensaje: string } {
  const limpia = url.trim();
  if (limpia === '') {
    return { ok: false, mensaje: 'Escribe la URL que recibirá los eventos.' };
  }
  if (limpia.length > MAXIMO_URL_WEBHOOK) {
    return {
      ok: false,
      mensaje: `La URL tiene más de ${MAXIMO_URL_WEBHOOK} caracteres. Usa una más corta.`,
    };
  }
  if (!/^https:\/\//i.test(limpia)) {
    return {
      ok: false,
      mensaje: 'La URL tiene que empezar con https://. Los webhooks solo se envían cifrados.',
    };
  }
  if (!PATRON_URL_WEBHOOK.test(limpia)) {
    return {
      ok: false,
      mensaje:
        'La URL no es válida para un webhook. Usa un dominio público con https, sin usuario ni clave, sin espacios y en el puerto 443.',
    };
  }
  if (
    PATRON_HOST_LOCAL_O_IP.test(limpia) ||
    PATRON_DOMINIO_INTERNO.test(limpia) ||
    PATRON_HOST_PUNTO_FINAL.test(limpia)
  ) {
    return {
      ok: false,
      mensaje:
        'La URL apunta a una dirección local o a una IP. Usa un dominio público, por ejemplo https://tu-sistema.cl/webhooks/boleteame.',
    };
  }
  return { ok: true, url: limpia };
}

// --- Idempotencia -----------------------------------------------------------------

export const CABECERA_IDEMPOTENCIA = 'Idempotency-Key';
export const CABECERA_REPETIDA = 'Idempotent-Replayed';
/** ASCII visible, 1 a 200 caracteres (el lote agrega «#n» a cada ítem; la base acepta 255). */
export const FORMATO_IDEMPOTENCIA = /^[!-~]{1,200}$/;
export const SEGUNDOS_ARRIENDO_IDEMPOTENCIA = 120;

/** Clave del ítem `indice` (base 0) de un lote. */
export function claveItemLote(clave: string, indice: number): string {
  return `${clave}#${indice + 1}`;
}

// --- Límites ----------------------------------------------------------------------

export const LIMITE_LOTE = 25;
export const LIMITE_PAGINA = 20;
export const LIMITE_PAGINA_MAXIMO = 100;
export const MAXIMO_CUERPO_BYTES = 262_144;

// --- Errores ----------------------------------------------------------------------

export const CODIGOS_ERROR = {
  no_autenticado: 401,
  clave_invalida: 401,
  clave_revocada: 401,
  clave_vencida: 401,
  plan_sin_api: 403,
  alcance_insuficiente: 403,
  empresa_no_permitida: 403,
  plan_sin_produccion: 403,
  cuota_agotada: 403,
  no_encontrado: 404,
  json_invalido: 400,
  parametro_invalido: 400,
  cursor_invalido: 400,
  idempotencia_requerida: 400,
  idempotencia_invalida: 400,
  idempotencia_en_curso: 409,
  operacion_en_curso: 409,
  incierto_sin_revisar: 409,
  cuerpo_muy_grande: 413,
  tipo_contenido: 415,
  datos_invalidos: 422,
  ambiente_no_coincide: 422,
  empresa_requerida: 422,
  empresa_inactiva: 422,
  idempotencia_conflicto: 422,
  sin_folios: 422,
  sin_certificado: 422,
  sin_resolucion: 422,
  sin_autorizacion: 422,
  revision_requerida: 422,
  rechazado_por_sii: 422,
  limite_excedido: 429,
  error_interno: 500,
  sii_no_disponible: 503,
} as const;
export type CodigoError = keyof typeof CODIGOS_ERROR;

export const MENSAJES_ERROR: Record<CodigoError, string> = {
  no_autenticado:
    'Falta la API key. Envíala en la cabecera Authorization: Bearer sk_test_… o sk_live_….',
  clave_invalida:
    'La API key no es válida. Revisa que la copiaste completa o crea una nueva en Configuración → API.',
  clave_revocada: 'Esta API key fue revocada. Crea una nueva en Configuración → API.',
  clave_vencida: 'Esta API key venció. Crea una nueva en Configuración → API.',
  plan_sin_api:
    'El plan vigente de tu organización no incluye acceso por API. Cámbialo en Configuración → Plan.',
  alcance_insuficiente:
    'Esta API key no tiene el alcance que pide esta operación. Crea una clave con ese alcance en Configuración → API.',
  empresa_no_permitida:
    'Esta API key solo sirve para otra empresa. Usa la clave de esa empresa o una que sirva para todas.',
  plan_sin_produccion:
    'El plan vigente no permite emitir en producción. Cámbialo en Configuración → Plan o usa una clave de certificación.',
  cuota_agotada:
    'Tu organización usó todas las boletas del plan este mes. Sube de plan en Configuración → Plan para seguir emitiendo.',
  no_encontrado:
    'No encontramos ese recurso. Revisa el id y que pertenezca a la empresa y al ambiente de tu API key.',
  json_invalido:
    'El cuerpo de la petición no es JSON válido. Revisa su formato y vuelve a enviarla.',
  parametro_invalido:
    'Un parámetro de la consulta no es válido. Revisa el detalle en campos y corrígelo.',
  cursor_invalido:
    'El cursor no es válido. Usa el valor de siguiente_cursor de la respuesta anterior, sin cambiarlo.',
  idempotencia_requerida:
    'Falta la cabecera Idempotency-Key. Envía una clave única por boleta para poder repetir la petición sin duplicarla.',
  idempotencia_invalida:
    'La Idempotency-Key no es válida. Usa entre 1 y 200 caracteres ASCII visibles, sin espacios.',
  idempotencia_en_curso:
    'Otra petición con esta Idempotency-Key se está procesando. Espera unos segundos y repítela con la misma clave.',
  operacion_en_curso:
    'Ya hay una operación igual en curso con el SII. Espera a que termine y vuelve a intentarlo.',
  incierto_sin_revisar:
    'La operación anterior quedó sin respuesta clara del SII. Revísala en el panel y márcala como revisada antes de repetirla.',
  cuerpo_muy_grande: 'El cuerpo de la petición supera los 256 KB. Envía menos datos por petición.',
  tipo_contenido: 'El cuerpo tiene que ser JSON. Envía la cabecera Content-Type: application/json.',
  datos_invalidos: 'Algunos datos no son válidos. Revisa el detalle en campos y corrígelos.',
  ambiente_no_coincide:
    'El ambiente pedido no es el de tu API key. Las claves sk_test_ son de certificación y las sk_live_, de producción.',
  empresa_requerida:
    'Indica la empresa en el campo empresa (RUT o id), porque esta API key sirve para todas.',
  empresa_inactiva: 'La empresa está desactivada. Actívala en Configuración → Empresas.',
  idempotencia_conflicto:
    'Ya usaste esta Idempotency-Key con otra boleta. Usa una clave nueva para cada boleta distinta.',
  sin_folios:
    'No quedan folios para este tipo de documento. Pide más en Folios o con POST /folios/solicitudes.',
  sin_certificado:
    'La empresa no tiene un certificado digital vigente. Súbelo en Configuración → Certificados.',
  sin_resolucion:
    'La empresa no tiene registrada la resolución del SII de este ambiente. Regístrala en Configuración → Empresas.',
  sin_autorizacion:
    'La empresa no está autorizada por el SII para emitir en producción. Termina la certificación primero.',
  revision_requerida:
    'En producción hay que revisar la solicitud con el SII antes de timbrar. Pide primero el nivel revision y envía su revision_id.',
  rechazado_por_sii:
    'El SII rechazó la boleta y su folio quedó anulado. Revisa el detalle, corrige los datos y emítela con una Idempotency-Key nueva.',
  limite_excedido:
    'Hiciste demasiadas peticiones en poco tiempo. Espera un momento y vuelve a intentarlo.',
  error_interno:
    'Tuvimos un problema al procesar la petición. Repítela con la misma Idempotency-Key en unos minutos.',
  sii_no_disponible:
    'No pudimos comunicarnos con el SII y la boleta no se envió. Repite la petición con la misma Idempotency-Key en unos minutos.',
};

// --- Formas de las respuestas -----------------------------------------------------

export interface DocumentoResumenApi {
  id: string;
  tipo_dte: number;
  folio: number | null;
  estado: EstadoDocumento;
}

export interface CuerpoError {
  error: {
    codigo: CodigoError;
    mensaje: string;
    campos?: Record<string, string>;
    documento?: DocumentoApi;
    operacion_pendiente_id?: string;
  };
}

export interface EmpresaRef {
  id: string;
  rut: string;
  razon_social: string;
}

export interface LineaApi {
  nro: number;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  exento: boolean;
  descuento: number;
  monto: number;
}

export interface DocumentoApi {
  objeto: 'documento';
  id: string;
  empresa: EmpresaRef;
  ambiente: AmbienteSii;
  tipo_dte: 39 | 41;
  folio: number | null;
  estado: EstadoDocumento;
  /** AAAA-MM-DD. */
  fecha_emision: string;
  receptor: { rut: string; razon_social: string | null; correo: string | null };
  totales: { neto: number; exento: number; iva: number; total: number; descuento: number };
  /** Solo en el detalle (`GET /documentos/{id}` y la respuesta de la emisión). */
  lineas?: LineaApi[];
  envio: { id: string; track_id: string | null; estado_sii: string | null } | null;
  origen: OrigenDocumento;
  clave_idempotencia: string | null;
  /** Cuando el resultado no es definitivo (incierto, firmado sin envío). */
  aviso?: { titulo: string; detalle: string };
  creado_en: string;
  actualizado_en: string;
}

export interface ListaApi<T> {
  objeto: 'lista';
  datos: T[];
  tiene_mas: boolean;
  siguiente_cursor: string | null;
}

export interface ErrorSiiApi {
  seccion: string | null;
  linea: number | null;
  nivel: string | null;
  codigo: string | null;
  descripcion: string | null;
  detalle: string | null;
}

export interface RechazoApi {
  tipo_dte: number;
  folio: number;
  documento_id: string | null;
  estado: string;
  tipo_observacion: TipoObservacion;
  descripcion: string | null;
  errores: ErrorSiiApi[];
}

export interface EnvioApi {
  objeto: 'envio';
  id: string;
  empresa: EmpresaRef;
  ambiente: AmbienteSii;
  canal: CanalSii;
  proposito: PropositoEnvio;
  track_id: string | null;
  estado_sii: string | null;
  glosa_sii: string | null;
  clasificacion: ClasificacionEnvio | null;
  incierto: boolean;
  conteos: { informados: number; aceptados: number; rechazados: number; reparos: number };
  caratula: { rut_envia: string; nro_resol: number; fch_resol: string };
  documentos: DocumentoResumenApi[];
  rechazos: RechazoApi[];
  consultas: number;
  enviado_en: string | null;
  ultima_consulta_en: string | null;
  creado_en: string;
  actualizado_en: string;
}

export type EstadoFoliosApi = 'ok' | 'por_agotarse' | 'agotado' | 'sin_folios';

export interface CafApi {
  id: string;
  folio_desde: number;
  folio_hasta: number;
  siguiente_folio: number;
  disponibles: number;
  estado: Enums['estado_caf'];
  fecha_autorizacion: string;
}

export interface FoliosApi {
  objeto: 'folios';
  empresa: EmpresaRef;
  ambiente: AmbienteSii;
  tipos: {
    tipo_dte: 39 | 41;
    disponibles: number;
    total: number;
    siguiente_folio: number | null;
    estado: EstadoFoliosApi;
    cafs: CafApi[];
  }[];
}

export type NivelSolicitudFoliosApi = 'ensayo' | 'revision' | 'timbrar';

export interface SolicitudFoliosApi {
  objeto: 'solicitud_folios';
  nivel: NivelSolicitudFoliosApi;
  empresa: EmpresaRef;
  ambiente: AmbienteSii;
  tipo_dte: 39 | 41;
  cantidad: number;
  /** Rango que el SII asignaría (revisión) o asignó (timbrado); `null` en el ensayo local. */
  desde: number | null;
  hasta: number | null;
  /** Solo en `revision`: se envía al timbrar (obligatorio en producción, 30 min, un uso). */
  revision_id: string | null;
  /** Solo en `timbrar` con éxito. */
  caf: CafApi | null;
  operacion_id: string | null;
  aviso?: { titulo: string; detalle: string };
}

export interface ResultadoItemLoteApi {
  indice: number;
  clave_idempotencia: string;
  /** HTTP equivalente a la emisión individual; `null` si quedó pendiente. */
  status: number | null;
  repetida: boolean;
  documento?: DocumentoApi;
  error?: CuerpoError['error'];
}

export interface ResultadoLoteApi {
  objeto: 'lote';
  resultados: ResultadoItemLoteApi[];
  procesados: number;
  /** Ítems que no alcanzaron a emitirse: repite el lote con la misma Idempotency-Key. */
  pendientes: number;
}

export interface CuerpoWebhook {
  /** Id de la entrega (estable entre intentos): sirve para deduplicar. */
  id: string;
  evento: EventoWebhook | typeof EVENTO_PRUEBA;
  creado_en: string;
  datos: Record<string, unknown>;
}
