import 'server-only';
import { createHmac } from 'node:crypto';
import { type ConfiguracionFlow, envFlow } from '../env';

// Cliente mínimo de la API REST de Flow (PLAN-SAAS D4) sobre `fetch`, sin SDK. Cada
// llamada lleva `apiKey` y la firma `s` = HMAC-SHA256 (hex) de los parámetros ordenados
// por nombre y concatenados `nombrevalor` (sin `s`, valores crudos). GET con query
// string, POST como `application/x-www-form-urlencoded`.
//
// Nunca lanza: devuelve un resultado tipado. El detalle de un error nunca incluye la
// apiKey, la firma ni los parámetros (pueden traer correos o tokens): solo el servicio,
// el código y el mensaje de Flow, acotados.

const TIEMPO_MAXIMO_MS = 12_000;

export type ParametrosFlow = Record<string, string | number | undefined | null>;

export type MotivoFallaFlow =
  /** Faltan FLOW_API_KEY, FLOW_SECRET_KEY o FLOW_API_URL. */
  | 'sin_configuracion'
  /** 400/401: Flow rechazó la petición (parámetros, firma, regla de negocio). */
  | 'rechazado'
  /** Red, tiempo agotado, 5xx u otro estado inesperado. Reintentable. */
  | 'red';

export type ResultadoFlow<T> =
  | { ok: true; datos: T }
  | { ok: false; motivo: MotivoFallaFlow; codigo?: number; detalle: string; estado?: number };

export interface OpcionesFlow {
  /** Para pruebas. Por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  /** Para pruebas. Por defecto, `envFlow()`. */
  configuracion?: ConfiguracionFlow | null;
}

/** Firma de Flow: orden por nombre (bytes, como `sort()` de PHP) y `nombrevalor`. */
export function firmarFlow(parametros: Record<string, string>, secreto: string): string {
  const claves = Object.keys(parametros).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let texto = '';
  for (const clave of claves) texto += clave + parametros[clave];
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

function limpiar(parametros: ParametrosFlow): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null) continue;
    salida[clave] = String(valor);
  }
  return salida;
}

function textoSeguro(valor: unknown, largo = 200): string {
  return typeof valor === 'string' ? valor.slice(0, largo) : '';
}

export async function llamarFlow<T = unknown>(
  metodo: 'GET' | 'POST',
  servicio: string,
  parametros: ParametrosFlow,
  opciones: OpcionesFlow = {},
): Promise<ResultadoFlow<T>> {
  const configuracion = opciones.configuracion !== undefined ? opciones.configuracion : envFlow();
  if (!configuracion) {
    return {
      ok: false,
      motivo: 'sin_configuracion',
      detalle:
        'La pasarela de pagos no está configurada (FLOW_API_KEY, FLOW_SECRET_KEY, FLOW_API_URL).',
    };
  }
  const datos = limpiar({ ...parametros, apiKey: configuracion.FLOW_API_KEY });
  const cuerpo = new URLSearchParams({
    ...datos,
    s: firmarFlow(datos, configuracion.FLOW_SECRET_KEY),
  });
  const url = `${configuracion.FLOW_API_URL}/${servicio}`;

  const hacerFetch = opciones.fetch ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerFetch(metodo === 'GET' ? `${url}?${cuerpo.toString()}` : url, {
      method: metodo,
      headers:
        metodo === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: metodo === 'POST' ? cuerpo.toString() : undefined,
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
          ? `Flow no respondió a tiempo (${servicio}).`
          : `No se pudo conectar con Flow (${servicio}).`,
    };
  }

  let json: unknown = null;
  try {
    json = await respuesta.json();
  } catch {
    // Cuerpo vacío o no JSON: se decide por el estado HTTP.
  }

  if (respuesta.status === 200 && json !== null && typeof json === 'object') {
    return { ok: true, datos: json as T };
  }
  const error = (json ?? {}) as Record<string, unknown>;
  const codigo = typeof error.code === 'number' ? error.code : Number(error.code) || undefined;
  const mensaje = textoSeguro(error.message) || `HTTP ${respuesta.status}`;
  // Solo 200, 400 y 401 son respuestas «esperadas» de Flow; lo demás es infraestructura.
  const motivo: MotivoFallaFlow =
    respuesta.status === 400 || respuesta.status === 401 ? 'rechazado' : 'red';
  return {
    ok: false,
    motivo,
    ...(codigo !== undefined ? { codigo } : {}),
    detalle: `${servicio}: ${mensaje}`,
    estado: respuesta.status,
  };
}
