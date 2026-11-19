import 'server-only';
import { esAlcance, esEventoWebhook } from '@/lib/api-publica';
import { clienteServidor } from '../supabase/servidor';
import type { ClaveApiVista, EntregaVista, WebhookConResumen, WebhookVista } from './presentacion';

// Lecturas de Configuración → API y Webhooks (PLAN-SAAS Fase 11), con la sesión del
// usuario: RLS `lectura` con `es_admin` en `api_keys`, `webhooks` y `webhook_entregas`
// (0001). Un emisor o un lector ve listas vacías, por eso las páginas no llaman a estas
// funciones si no es administrador. Toda consulta filtra además por `organizacion_id`.
// Nunca se leen `clave_hash` ni `secreto_secret_id`.

const COLUMNAS_CLAVE =
  'id, nombre, prefijo, alcances, ambiente, expira_en, ultimo_uso_en, revocada_en, creado_en, empresas (id, rut, razon_social)' as const;
const COLUMNAS_WEBHOOK = 'id, url, eventos, activo, creado_en, actualizado_en' as const;
const COLUMNAS_ENTREGA =
  'id, webhook_id, evento, estado, intentos, ultimo_status_http, ultima_respuesta, siguiente_intento_en, entregado_en, reenviada_en, creado_en' as const;

/** Entregas por página del historial. */
export const ENTREGAS_POR_PAGINA = 50;
/** Entregas recientes por webhook en la lista (para el estado y el aviso de fallas). */
const ULTIMAS_POR_WEBHOOK = 5;

interface FilaEntrega {
  id: number;
  webhook_id: string;
  evento: string;
  estado: EntregaVista['estado'];
  intentos: number;
  ultimo_status_http: number | null;
  ultima_respuesta: string | null;
  siguiente_intento_en: string;
  entregado_en: string | null;
  reenviada_en: string | null;
  creado_en: string;
}

function aEntrega(f: FilaEntrega): EntregaVista {
  return {
    id: f.id,
    evento: f.evento,
    estado: f.estado,
    intentos: f.intentos,
    ultimoStatusHttp: f.ultimo_status_http,
    ultimaRespuesta: f.ultima_respuesta,
    siguienteIntentoEn: f.siguiente_intento_en,
    entregadoEn: f.entregado_en,
    reenviadaEn: f.reenviada_en,
    creadoEn: f.creado_en,
  };
}

function aWebhook(f: {
  id: string;
  url: string;
  eventos: string[];
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}): WebhookVista {
  return {
    id: f.id,
    url: f.url,
    eventos: f.eventos.filter(esEventoWebhook),
    activo: f.activo,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

export interface PlanIntegraciones {
  /** Nombre del plan vigente, o `null` si no hay suscripción vigente. */
  nombre: string | null;
  incluyeApi: boolean;
  incluyeWebhooks: boolean;
  permiteProduccion: boolean;
  /** Suscripción morosa: el plan existe pero `plan_vigente()` no lo cuenta. */
  morosa: boolean;
}

/**
 * Lo que el plan permite en integraciones. Replica `plan_vigente()` (que no se expone a
 * `authenticated`): solo una suscripción `prueba` o `activa` cuenta; `morosa` no. Es solo
 * para avisar en la UI: la autoridad son `crear_api_key`, `crear_webhook`,
 * `autenticar_api_key` y `encolar_evento`.
 */
export async function leerPlanIntegraciones(organizacionId: string): Promise<PlanIntegraciones> {
  const db = await clienteServidor();
  const { data, error } = await db
    .from('suscripciones')
    .select('estado, planes (nombre, incluye_api, incluye_webhooks, permite_produccion)')
    .eq('organizacion_id', organizacionId)
    .in('estado', ['prueba', 'activa', 'morosa'])
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
  const plan = data?.planes ?? null;
  const vigente = Boolean(plan) && data?.estado !== 'morosa';
  return {
    nombre: plan?.nombre ?? null,
    incluyeApi: vigente && Boolean(plan?.incluye_api),
    incluyeWebhooks: vigente && Boolean(plan?.incluye_webhooks),
    permiteProduccion: vigente && Boolean(plan?.permite_produccion),
    morosa: data?.estado === 'morosa',
  };
}

/** API keys de la organización, de la más nueva a la más vieja (también revocadas y vencidas). */
export async function leerClavesApi(organizacionId: string): Promise<ClaveApiVista[]> {
  const db = await clienteServidor();
  const { data, error } = await db
    .from('api_keys')
    .select(COLUMNAS_CLAVE)
    .eq('organizacion_id', organizacionId)
    .order('creado_en', { ascending: false })
    .limit(200);
  if (error) throw new Error(`No se pudieron leer las API keys: ${error.message}`);
  return data.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    prefijo: f.prefijo,
    alcances: f.alcances.filter(esAlcance),
    ambiente: f.ambiente,
    empresa: f.empresas
      ? { id: f.empresas.id, rut: f.empresas.rut, razonSocial: f.empresas.razon_social }
      : null,
    expiraEn: f.expira_en,
    ultimoUsoEn: f.ultimo_uso_en,
    revocadaEn: f.revocada_en,
    creadaEn: f.creado_en,
  }));
}

/**
 * Webhooks de la organización con sus últimas entregas. Una consulta para los webhooks y
 * otra para las entregas recientes de todos (acotada), repartidas en memoria.
 */
export async function leerWebhooks(organizacionId: string): Promise<WebhookConResumen[]> {
  const db = await clienteServidor();
  const { data, error } = await db
    .from('webhooks')
    .select(COLUMNAS_WEBHOOK)
    .eq('organizacion_id', organizacionId)
    .order('creado_en', { ascending: true })
    .limit(100);
  if (error) throw new Error(`No se pudieron leer los webhooks: ${error.message}`);
  if (data.length === 0) return [];

  const webhooks = data.map(aWebhook);
  const recientes = await Promise.all(
    webhooks.map(async (w) => {
      const r = await db
        .from('webhook_entregas')
        .select(COLUMNAS_ENTREGA)
        .eq('organizacion_id', organizacionId)
        .eq('webhook_id', w.id)
        .order('id', { ascending: false })
        .limit(ULTIMAS_POR_WEBHOOK);
      if (r.error) throw new Error(`No se pudieron leer las entregas: ${r.error.message}`);
      return r.data.map(aEntrega);
    }),
  );
  return webhooks.map((w, i) => ({ ...w, ultimas: recientes[i] ?? [] }));
}

/** Un webhook de la organización, o `null` si no existe, es de otra o el id no es un uuid. */
export async function leerWebhook(
  organizacionId: string,
  webhookId: string,
): Promise<WebhookVista | null> {
  const db = await clienteServidor();
  const { data, error } = await db
    .from('webhooks')
    .select(COLUMNAS_WEBHOOK)
    .eq('organizacion_id', organizacionId)
    .eq('id', webhookId)
    .maybeSingle();
  if (error) {
    if (error.code === '22P02') return null;
    throw new Error(`No se pudo leer el webhook: ${error.message}`);
  }
  return data ? aWebhook(data) : null;
}

export interface PaginaEntregas {
  entregas: EntregaVista[];
  /** Id desde el cual pedir la página siguiente (`?antes=`), o `null` si no hay más. */
  antesSiguiente: number | null;
}

/** Historial de un webhook por *keyset* sobre `id desc` (índice `webhook_entregas_historial`). */
export async function leerEntregas(
  organizacionId: string,
  webhookId: string,
  antes: number | null,
): Promise<PaginaEntregas> {
  const db = await clienteServidor();
  let consulta = db
    .from('webhook_entregas')
    .select(COLUMNAS_ENTREGA)
    .eq('organizacion_id', organizacionId)
    .eq('webhook_id', webhookId);
  if (antes !== null) consulta = consulta.lt('id', antes);
  const { data, error } = await consulta
    .order('id', { ascending: false })
    .limit(ENTREGAS_POR_PAGINA + 1);
  if (error) throw new Error(`No se pudieron leer las entregas: ${error.message}`);
  const hayMas = data.length > ENTREGAS_POR_PAGINA;
  const entregas = data.slice(0, ENTREGAS_POR_PAGINA).map(aEntrega);
  return {
    entregas,
    antesSiguiente: hayMas ? (entregas[entregas.length - 1]?.id ?? null) : null,
  };
}
