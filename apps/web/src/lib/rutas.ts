import { destinoSeguro } from './redireccion';

// Qué rutas exigen sesión (PLAN-SAAS Fase 2). Puro y sin dependencias de Next para
// probarlo con Vitest; `src/proxy.ts` solo lo aplica.
//
// El proxy es un filtro optimista: la autoridad son `exigirUsuario()` /
// `exigirMembresia()` en cada página o acción y, al final, RLS.

export const RUTA_INGRESAR = '/ingresar';
export const RUTA_BIENVENIDA = '/bienvenida';

/** Rutas públicas exactas. */
const PUBLICAS_EXACTAS = new Set(['/', '/ingresar', '/crear-cuenta', '/recuperar', '/restablecer']);

/**
 * Prefijos públicos (la ruta es el prefijo o cuelga de él). `/api` autentica por su
 * cuenta (API keys, CRON_SECRET, firma de webhooks; el túnel de Sentry está en
 * `/api/monitoring`); `/auth` es el callback de los correos; `/invitacion` se ve antes
 * de iniciar sesión.
 */
const PREFIJOS_PUBLICOS = ['/auth', '/invitacion', '/api', '/monitoring'];

/**
 * Slugs que una organización no puede usar porque chocan con rutas de primer nivel
 * (`/[org]` cuelga de la raíz). El onboarding (`crear_organizacion`) debe rechazarlos;
 * la base no los conoce. Agregar aquí cada carpeta nueva de `src/app`.
 */
export const SLUGS_RESERVADOS: ReadonlySet<string> = new Set([
  'api',
  'auth',
  'bienvenida',
  'crear-cuenta',
  'ingresar',
  'invitacion',
  'monitoring',
  'recuperar',
  'restablecer',
  // Sitio público y usos futuros previsibles (PLAN-SAAS §3.1, Fase 12).
  'precios',
  'legal',
  'ayuda',
  'contacto',
  'docs',
  'app',
  'admin',
  'cuenta',
  'configuracion',
]);

/** Con sesión, estas pantallas sobran: se va a `siguiente` o a `/bienvenida`. */
const SOLO_SIN_SESION = new Set(['/ingresar', '/crear-cuenta']);

// Archivos que Next sirve desde `public/` o rutas de metadatos (favicon, robots,
// sitemap, manifest, íconos). Lista cerrada: una ruta como `/acme/documentos/1.pdf`
// sigue protegida.
const ESTATICO =
  /\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml|webmanifest|json|woff2?|ttf|css|js|map)$/i;

/** Quita la barra final (salvo en `/`) para comparar. */
function normalizar(ruta: string): string {
  return ruta.length > 1 && ruta.endsWith('/') ? ruta.replace(/\/+$/, '') || '/' : ruta;
}

function bajoPrefijo(ruta: string, prefijo: string): boolean {
  return ruta === prefijo || ruta.startsWith(`${prefijo}/`);
}

/** `true` si la ruta no exige sesión. */
export function esRutaPublica(ruta: string): boolean {
  const r = normalizar(ruta);
  if (PUBLICAS_EXACTAS.has(r)) return true;
  if (PREFIJOS_PUBLICOS.some((p) => bajoPrefijo(r, p))) return true;
  // Catálogo del design system: `/_ds` (en disco `%5Fds`). En producción responde 404.
  if (r.startsWith('/_ds') || r.toLowerCase().startsWith('/%5fds')) return true;
  if (r.startsWith('/_next/') || r.startsWith('/.well-known/')) return true;
  return ESTATICO.test(r);
}

export type DecisionRuta = { tipo: 'continuar' } | { tipo: 'redirigir'; destino: string };

/**
 * Decide qué hace el proxy con una petición.
 *
 * @param ruta `pathname` de la petición (sin query).
 * @param busqueda `search` de la petición, con `?` inicial o vacío.
 * @param conSesion si hay un usuario con JWT válido.
 *
 * - Ruta protegida sin sesión → `/ingresar?siguiente=<ruta+query>`.
 * - `/ingresar` o `/crear-cuenta` con sesión → `siguiente` si es interno
 *   (`destinoSeguro`), si no `/bienvenida`, que elige la organización.
 * - Todo lo demás continúa.
 */
export function decidirRuta(ruta: string, busqueda: string, conSesion: boolean): DecisionRuta {
  const r = normalizar(ruta);

  if (conSesion) {
    if (SOLO_SIN_SESION.has(r)) {
      const siguiente = new URLSearchParams(busqueda).get('siguiente');
      return { tipo: 'redirigir', destino: destinoSeguro(siguiente, RUTA_BIENVENIDA) };
    }
    return { tipo: 'continuar' };
  }

  if (esRutaPublica(r)) return { tipo: 'continuar' };
  return { tipo: 'redirigir', destino: urlIngresar(`${ruta}${busqueda}`) };
}

/** `/ingresar?siguiente=<destino>` (o `/ingresar` si el destino es el por defecto). */
export function urlIngresar(siguiente?: string): string {
  if (!siguiente || siguiente === '/' || siguiente === RUTA_BIENVENIDA) return RUTA_INGRESAR;
  return `${RUTA_INGRESAR}?${new URLSearchParams({ siguiente }).toString()}`;
}
