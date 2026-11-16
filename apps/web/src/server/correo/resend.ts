import 'server-only';
import { envCorreo } from '../env';

// Cliente mínimo de Resend (PLAN-SAAS §4.6) sobre `fetch`, sin el SDK: la app solo usa
// `POST /emails`, y así no suma una dependencia ni su árbol para una llamada. Nunca
// lanza: devuelve un resultado tipado y quien llama decide (p. ej. mostrar el enlace
// de una invitación si el correo no salió). Nunca incluye la API key ni el cuerpo del
// correo (que puede llevar un token) en el detalle del error.

const URL_RESEND = 'https://api.resend.com/emails';
const TIEMPO_MAXIMO_MS = 10_000;
/** Límite de Resend para `Idempotency-Key`. */
const LARGO_MAXIMO_CLAVE = 256;

export interface MensajeCorreo {
  para: string | string[];
  asunto: string;
  html: string;
  texto: string;
  /**
   * `Idempotency-Key`: el mismo valor en 24 h no envía dos veces (Resend devuelve el
   * mismo id). Usa el id del evento, nunca un dato secreto en claro.
   */
  claveIdempotencia: string;
  responderA?: string;
  /** Archivos adjuntos (p. ej. el PDF de una boleta). Su contenido nunca va en un error. */
  adjuntos?: AdjuntoCorreo[];
}

export interface AdjuntoCorreo {
  /** Nombre con que lo ve quien recibe (`boleta-39-F41.pdf`), sin rutas. */
  nombre: string;
  contenido: Buffer;
  /** Tipo MIME (`application/pdf`). Sin él, Resend lo deduce de la extensión. */
  tipo?: string;
}

/** Límite de Resend para el correo completo, con los adjuntos ya en base64. */
const TAMANO_MAXIMO_ADJUNTOS = 40 * 1024 * 1024;

/** Nombre de archivo razonable: sin rutas, controles ni comillas, y no muy largo. */
function nombreAdjuntoValido(nombre: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: se rechazan justamente los controles.
  return nombre.length > 0 && nombre.length <= 200 && !/[\\/\u0000-\u001f\u007f"]/.test(nombre);
}

/**
 * `attachments` de la API de Resend, o el motivo para no enviar. El detalle del error
 * solo nombra el problema (nunca el contenido del archivo).
 */
function adjuntosResend(
  adjuntos: AdjuntoCorreo[] | undefined,
):
  | { ok: true; valor: { filename: string; content: string; content_type?: string }[] }
  | { ok: false; detalle: string } {
  if (!adjuntos || adjuntos.length === 0) return { ok: true, valor: [] };
  let tamano = 0;
  const valor: { filename: string; content: string; content_type?: string }[] = [];
  for (const a of adjuntos) {
    if (!nombreAdjuntoValido(a.nombre)) {
      return { ok: false, detalle: 'Nombre de adjunto inválido.' };
    }
    if (!Buffer.isBuffer(a.contenido) || a.contenido.length === 0) {
      return { ok: false, detalle: `El adjunto ${a.nombre} está vacío.` };
    }
    const content = a.contenido.toString('base64');
    tamano += content.length;
    valor.push({ filename: a.nombre, content, ...(a.tipo ? { content_type: a.tipo } : {}) });
  }
  if (tamano > TAMANO_MAXIMO_ADJUNTOS) {
    return { ok: false, detalle: 'Los adjuntos superan el tamaño máximo de Resend (40 MB).' };
  }
  return { ok: true, valor };
}

export type MotivoFalla =
  /** Falta RESEND_API_KEY o CORREO_REMITENTE (aún no hay cuenta de Resend). */
  | 'sin_configuracion'
  /** Resend rechazó el mensaje (4xx): datos, dominio no verificado, clave inválida. */
  | 'rechazado'
  /** 429: límite de envíos. Reintentable más tarde. */
  | 'limite'
  /** Red, tiempo agotado o 5xx. Reintentable. */
  | 'red';

export type ResultadoEnvio =
  | { ok: true; id: string }
  | { ok: false; motivo: MotivoFalla; detalle: string; estado?: number };

export interface ConfiguracionCorreo {
  RESEND_API_KEY: string;
  CORREO_REMITENTE: string;
}

export interface OpcionesEnvio {
  /** Para pruebas. Por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  /** Para pruebas. Por defecto, `envCorreo()` (null si no hay Resend). */
  configuracion?: ConfiguracionCorreo | null;
}

function textoSeguro(valor: unknown, largo = 200): string {
  return typeof valor === 'string' ? valor.slice(0, largo) : '';
}

export async function enviarCorreo(
  mensaje: MensajeCorreo,
  opciones: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  const configuracion = opciones.configuracion !== undefined ? opciones.configuracion : envCorreo();
  if (!configuracion) {
    return {
      ok: false,
      motivo: 'sin_configuracion',
      detalle: 'El envío de correos no está configurado (RESEND_API_KEY, CORREO_REMITENTE).',
    };
  }
  const clave = mensaje.claveIdempotencia.trim();
  if (clave.length === 0 || clave.length > LARGO_MAXIMO_CLAVE) {
    return { ok: false, motivo: 'rechazado', detalle: 'Clave de idempotencia inválida.' };
  }
  const adjuntos = adjuntosResend(mensaje.adjuntos);
  if (!adjuntos.ok) return { ok: false, motivo: 'rechazado', detalle: adjuntos.detalle };

  const hacerFetch = opciones.fetch ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerFetch(URL_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configuracion.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': clave,
      },
      body: JSON.stringify({
        from: configuracion.CORREO_REMITENTE,
        to: Array.isArray(mensaje.para) ? mensaje.para : [mensaje.para],
        subject: mensaje.asunto,
        html: mensaje.html,
        text: mensaje.texto,
        ...(mensaje.responderA ? { reply_to: mensaje.responderA } : {}),
        ...(adjuntos.valor.length > 0 ? { attachments: adjuntos.valor } : {}),
      }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const nombre = error instanceof Error ? error.name : '';
    return {
      ok: false,
      motivo: 'red',
      detalle:
        nombre === 'TimeoutError' || nombre === 'AbortError'
          ? 'Resend no respondió a tiempo.'
          : 'No se pudo conectar con Resend.',
    };
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    // Cuerpo vacío o no JSON: se decide solo por el estado HTTP.
  }
  const datos = (cuerpo ?? {}) as Record<string, unknown>;

  if (respuesta.ok) {
    const id = textoSeguro(datos.id);
    if (id) return { ok: true, id };
    return {
      ok: false,
      motivo: 'red',
      detalle: 'Resend respondió sin id de mensaje.',
      estado: respuesta.status,
    };
  }

  const detalle =
    [textoSeguro(datos.name, 60), textoSeguro(datos.message)].filter(Boolean).join(': ') ||
    `HTTP ${respuesta.status}`;
  const motivo: MotivoFalla =
    respuesta.status === 429 ? 'limite' : respuesta.status >= 500 ? 'red' : 'rechazado';
  return { ok: false, motivo, detalle, estado: respuesta.status };
}
