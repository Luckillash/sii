// Cabeceras de seguridad de todas las respuestas (PLAN-SAAS Fase 13, punto 1). Las arma
// `next.config.ts` en el build (`headers()`), así que este módulo es puro y sin alias `@/`:
// lo carga el resolvedor de TypeScript nativo de Node, que no conoce los `paths`.
//
// Decisiones (detalle en el informe de la Fase 13):
//
// - CSP sin nonce: un nonce obliga a renderizar CADA página por petición (la guía de CSP de
//   Next 16), y la landing, `/docs/api`, los textos legales y las imágenes OG son estáticos.
//   Next inyecta scripts en línea (el payload RSC de `self.__next_f`) distintos por página y
//   por build, así que tampoco sirven hashes fijos. Queda `'unsafe-inline'` en `script-src`,
//   compensado con: hosts de scripts limitados a la app y Turnstile, `object-src 'none'`,
//   `base-uri 'self'`, `form-action 'self'` y `frame-ancestors 'none'`. React escapa todo
//   texto y el único `dangerouslySetInnerHTML` (JSON-LD) va escapado (`serializarJsonLd`).
// - `MODO_CSP`: empezó en `report-only` (deploy `c619a1a`, 2026-11-19) y pasó a `enforce`
//   el 2026-11-20, tras revisar en Production 13 páginas del panel con sesión, el detalle de
//   un envío y las 10 públicas sin violaciones. En las cargas completas, nada se cargó desde
//   fuera del propio origen.
// - Reportes: `report-uri` apunta a la ruta propia `/api/csp`, que los reenvía saneados a
//   Sentry desde el servidor (`lib/reporte-csp.ts`). Antes iban directo a
//   `ingest.sentry.io`, y los bloqueadores de anuncios los frenaban: el mismo motivo del
//   túnel `/api/monitoring`.
// - HSTS sin `preload`: `.dev` ya está en la lista de precarga de los navegadores como TLD
//   completo (todo `*.dev` es solo HTTPS), así que `preload` no agrega nada y solo
//   comprometería al dominio si algún día se postula a hstspreload.org.

export type ModoCsp = 'enforce' | 'report-only';

/** `enforce` desde el 2026-11-20. Para diagnosticar una página rota, volver a `report-only`. */
export const MODO_CSP: ModoCsp = 'enforce';

/** Ruta de la app que recibe los reportes de CSP y los reenvía a Sentry (`app/api/csp`). */
export const RUTA_REPORTE_CSP = '/api/csp';

/** Turnstile (PLAN-SAAS §4.7): el script y el iframe del desafío. */
export const ORIGEN_TURNSTILE = 'https://challenges.cloudflare.com';

/** Dos años; `includeSubDomains` cubre también los subdominios futuros. */
export const HSTS = 'max-age=63072000; includeSubDomains';

export interface OpcionesCabeceras {
  /** `NEXT_PUBLIC_SUPABASE_URL`: REST, Auth y Realtime (wss) desde el navegador. */
  supabaseUrl?: string | undefined;
  /** `NEXT_PUBLIC_APP_URL`: con https se agrega `upgrade-insecure-requests`. */
  appUrl?: string | undefined;
  /** `NEXT_PUBLIC_SENTRY_DSN`: sin un DSN válido no hay a dónde reenviar, y no se pide `report-uri`. */
  sentryDsn?: string | undefined;
  /** `NEXT_PUBLIC_VERCEL_ENV`, para separar los reportes por ambiente en Sentry. */
  ambiente?: string | undefined;
  /** `next dev`: React necesita `'unsafe-eval'` para sus trazas de error. */
  desarrollo?: boolean;
  modo?: ModoCsp;
}

export interface Cabecera {
  key: string;
  value: string;
}

/** Origen https y wss de Supabase, o `[]` si la URL falta o no es http(s). */
export function origenesSupabase(url: string | undefined): string[] {
  if (!url) return [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
  const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return [u.origin, `${ws}//${u.host}`];
}

/**
 * Endpoint de seguridad de Sentry para `report-uri`, desde el DSN
 * (`https://<clave>@<host>/<proyecto>` → `https://<host>/api/<proyecto>/security/?sentry_key=<clave>`).
 * La clave del DSN es pública (ya va en el bundle del navegador).
 */
export function urlReporteSentry(dsn: string | undefined, ambiente?: string): string | null {
  if (!dsn) return null;
  let u: URL;
  try {
    u = new URL(dsn);
  } catch {
    return null;
  }
  const proyecto = u.pathname.replace(/^\/+|\/+$/g, '');
  if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(proyecto)) return null;
  const params = new URLSearchParams({ sentry_key: u.username });
  if (ambiente && /^[\w-]{1,32}$/.test(ambiente)) params.set('sentry_environment', ambiente);
  return `https://${u.host}/api/${proyecto}/security/?${params.toString()}`;
}

/** La política CSP en una línea. */
export function politicaCsp(o: OpcionesCabeceras = {}): string {
  const modo = o.modo ?? MODO_CSP;
  const supabase = origenesSupabase(o.supabaseUrl);
  // El navegador reporta a la ruta propia (mismo origen); ella reenvía a Sentry.
  const reporte = urlReporteSentry(o.sentryDsn, o.ambiente) ? RUTA_REPORTE_CSP : null;
  const https = o.appUrl?.startsWith('https://') ?? false;

  const directivas: [string, ...string[]][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      "'unsafe-inline'",
      ...(o.desarrollo ? ["'unsafe-eval'"] : []),
      ORIGEN_TURNSTILE,
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'", 'data:'],
    // Sentry va por el túnel `/api/monitoring` (mismo origen); Supabase, directo.
    ['connect-src', "'self'", ...supabase],
    ['frame-src', ORIGEN_TURNSTILE],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['media-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  // En report-only el navegador ignora (y avisa en consola) `upgrade-insecure-requests`.
  if (https && modo === 'enforce') directivas.push(['upgrade-insecure-requests']);
  if (reporte) directivas.push(['report-uri', reporte]);

  return directivas.map((d) => d.join(' ')).join('; ');
}

/** Todas las cabeceras de seguridad, para `headers()` de `next.config.ts`. */
export function cabecerasSeguridad(o: OpcionesCabeceras = {}): Cabecera[] {
  const modo = o.modo ?? MODO_CSP;
  return [
    {
      key: modo === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      value: politicaCsp(o),
    },
    { key: 'Strict-Transport-Security', value: HSTS },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Respaldo de `frame-ancestors 'none'` (navegadores viejos, y mientras la CSP sea
    // report-only): la app nunca se muestra dentro de un iframe.
    { key: 'X-Frame-Options', value: 'DENY' },
    // A otros orígenes solo el origen (basta para Turnstile y Flow), nunca la ruta: puede
    // llevar el token de una invitación.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
  ];
}
