// Depuración de eventos antes de enviarlos a Sentry (PLAN-SAAS §4.8, principio 5).
//
// Regla: ningún token, clave, cookie, .pfx, llave de CAF (RSASK), secreto o API key
// sale hacia Sentry. Se aplica en beforeSend, beforeSendSpan y
// beforeBreadcrumb del navegador, del servidor y del edge.

export const FILTRADO = '[Filtrado]';

/** Nombres de campo cuyo valor nunca se envía, sin importar su contenido. */
const CLAVE_SENSIBLE =
  /authorization|cookie|token|clave|contrase|password|passwd|pfx|p12|secret|secreto|rsask|rsapk|api[-_]?key|apikey|llave|private[-_]?key|set-cookie|captcha/i;

/**
 * Cuerpos de petición con otro nombre: los campos de un formulario de Server Action
 * (`server_action_form_data.<campo>`, que agrega `withServerActionInstrumentation`
 * de Sentry), y `body` / `formData` / `rawBody` sueltos. Pueden traer el .pfx, la
 * clave o un CAF aunque el campo no se llame así (p. ej. `archivo`).
 */
const CLAVE_CUERPO = /^(server_action_form_data(\..*)?|body|raw_?body|request_?body|form_?data)$/i;

/** Base64 largo (un .pfx, un CAF, una llave en DER): letras de ambos tipos y dígitos. */
const BASE64_LARGO = /[A-Za-z0-9+/]{120,}={0,2}/g;

function pareceBase64(texto: string): boolean {
  return /[A-Z]/.test(texto) && /[a-z]/.test(texto) && /[0-9]/.test(texto);
}

/** File, Blob o FormData: su contenido (y el nombre del archivo) nunca se envía. */
function esArchivoOFormulario(valor: object): boolean {
  if (typeof Blob !== 'undefined' && valor instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && valor instanceof FormData) return true;
  // Un File ya serializado (`{ name, size, type, lastModified }`).
  const v = valor as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.size === 'number' &&
    typeof v.type === 'string' &&
    typeof v.lastModified === 'number'
  );
}

/** Contenido sensible dentro de textos libres (mensajes, URLs, breadcrumbs). */
const PATRONES_TEXTO: readonly [RegExp, string][] = [
  // Bloques PEM (llaves y certificados).
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, FILTRADO],
  // Llaves del CAF dentro del XML.
  [/<RSASK>[\s\S]*?<\/RSASK>/gi, `<RSASK>${FILTRADO}</RSASK>`],
  // Token del SII en cabecera Cookie o en el XML de respuesta.
  [/TOKEN=[^;\s&"']+/gi, `TOKEN=${FILTRADO}`],
  [/<TOKEN>[\s\S]*?<\/TOKEN>/gi, `<TOKEN>${FILTRADO}</TOKEN>`],
  // Bearer / Basic en cualquier texto.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${FILTRADO}`],
  // JWT (por ejemplo, claves de Supabase).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, FILTRADO],
  // Parámetros de query con nombre sensible (?token=..., &clave=...).
  [
    /([?&](?:token|clave|password|secret|secreto|api_key|apikey|key|invitacion)=)[^&#\s]+/gi,
    `$1${FILTRADO}`,
  ],
  // Token de invitación en la ruta (`/invitacion/<token>`), también codificado dentro de
  // `?siguiente=%2Finvitacion%2F<token>`.
  [/(\/invitacion\/)[^/?#&\s"']+/gi, `$1${FILTRADO}`],
  [/(%2Finvitacion%2F)[^&#%\s"']+/gi, `$1${FILTRADO}`],
  // Nombre del archivo en un cuerpo multipart (los .pfx del SII llevan el RUT en el nombre).
  [/(filename\*?=)(?:"[^"]*"|[^;\s]+)/gi, `$1"${FILTRADO}"`],
  // Nombres de archivo de certificado sueltos en un texto (`12345678-5.pfx`).
  [/[^\s"'<>/\\]+\.(?:pfx|p12)\b/gi, FILTRADO],
];

const PROFUNDIDAD_MAXIMA = 12;

export function depurarTexto(texto: string): string {
  let salida = texto;
  for (const [patron, reemplazo] of PATRONES_TEXTO) {
    salida = salida.replace(patron, reemplazo);
  }
  return salida.replace(BASE64_LARGO, (trozo) => (pareceBase64(trozo) ? FILTRADO : trozo));
}

function depurarValor(valor: unknown, profundidad: number, vistos: WeakSet<object>): unknown {
  if (typeof valor === 'string') return depurarTexto(valor);
  if (valor === null || typeof valor !== 'object') return valor;
  if (profundidad > PROFUNDIDAD_MAXIMA) return FILTRADO;
  if (esArchivoOFormulario(valor)) return FILTRADO;
  if (vistos.has(valor)) return valor;
  vistos.add(valor);

  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) {
      valor[i] = depurarValor(valor[i], profundidad + 1, vistos);
    }
    return valor;
  }

  const objeto = valor as Record<string, unknown>;
  for (const clave of Object.keys(objeto)) {
    if (CLAVE_SENSIBLE.test(clave) || CLAVE_CUERPO.test(clave)) {
      if (objeto[clave] !== undefined && objeto[clave] !== null) objeto[clave] = FILTRADO;
      continue;
    }
    objeto[clave] = depurarValor(objeto[clave], profundidad + 1, vistos);
  }
  return objeto;
}

interface ConPeticion {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
    query_string?: unknown;
  };
}

/**
 * Depura un evento de Sentry en el lugar y lo devuelve. Genérico para no atar este
 * módulo a los tipos de una versión concreta del SDK.
 */
export function depurarEvento<T extends object>(evento: T): T {
  const conPeticion = evento as ConPeticion;
  if (conPeticion.request) {
    // Cuerpos y cookies de las peticiones nunca se envían: pueden traer un .pfx,
    // la clave del certificado o un CAF.
    delete conPeticion.request.data;
    delete conPeticion.request.cookies;
  }
  return depurarValor(evento, 0, new WeakSet()) as T;
}

/** Igual que `depurarEvento`, para los breadcrumbs (fetch, consola, navegación). */
export function depurarBreadcrumb<T extends object>(breadcrumb: T): T {
  return depurarValor(breadcrumb, 0, new WeakSet()) as T;
}
