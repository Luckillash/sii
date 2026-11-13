import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { decidirRuta } from '@/lib/rutas';
import { configClienteAuth } from '@/server/supabase/clave-auth';
import type { Database } from '@/server/supabase/tipos';

// Proxy (ex middleware, Next 16; va en `src/` porque la app está en `src/app`).
// 1. Refresca la sesión de Supabase y escribe las cookies nuevas en la respuesta.
// 2. Filtro optimista de rutas (`decidirRuta`, en `src/lib/rutas.ts`).
// Corre en Node.js (el runtime por defecto del proxy). No reemplaza a
// `exigirUsuario()` / `exigirMembresia()` ni a RLS: las Server Actions, por ejemplo,
// se verifican siempre por su cuenta.

/** Cookies de sesión de Supabase: `sb-<ref>-auth-token` (o partida en `.0`, `.1`…). */
function tieneCookieDeSesion(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.+-auth-token(?:\.\d+)?$/.test(c.name));
}

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });
  let conSesion = false;

  // Sin cookie de sesión no hay nada que refrescar ni validar: se ahorra la llamada.
  if (tieneCookieDeSesion(request)) {
    // Este cliente solo llama a `auth.getClaims()` (que refresca el token si venció):
    // con SUPABASE_SECRET_KEY reenvía la IP real para que el límite de refrescos por IP
    // no lo compartan todas las personas. Nunca usarlo para datos (ver clave-auth.ts).
    const config = configClienteAuth(request.headers);
    const supabase = createServerClient<Database>(config.url, config.clave, {
      global: { headers: config.cabeceras },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(porEscribir, cabeceras) {
          // Los RSC de esta petición leen las cookies de la petición: se actualizan ahí
          // y en la respuesta que llega al navegador.
          for (const { name, value } of porEscribir) request.cookies.set(name, value);
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of porEscribir) {
            respuesta.cookies.set(name, value, options);
          }
          // Cache-Control: private, no-store… para que ninguna caché comparta la sesión.
          for (const [clave, valor] of Object.entries(cabeceras)) {
            respuesta.headers.set(clave, valor);
          }
        },
      },
    });

    // Nada entre createServerClient y getClaims (recomendación de @supabase/ssr).
    // getClaims valida el JWT (firma con JWKS o, con clave simétrica, contra Auth) y
    // refresca la sesión si venció. Nunca getSession() aquí: no valida nada.
    const { data } = await supabase.auth.getClaims();
    conSesion = Boolean(data?.claims.sub);
  }

  const decision = decidirRuta(request.nextUrl.pathname, request.nextUrl.search, conSesion);
  if (decision.tipo === 'continuar') return respuesta;

  // Al redirigir hay que conservar las cookies (y cabeceras de caché) del refresco.
  const redireccion = NextResponse.redirect(new URL(decision.destino, request.url));
  for (const cookie of respuesta.cookies.getAll()) redireccion.cookies.set(cookie);
  const cacheControl = respuesta.headers.get('cache-control');
  if (cacheControl) redireccion.headers.set('cache-control', cacheControl);
  return redireccion;
}

export const config = {
  matcher: [
    // Todo menos: estáticos e imágenes de Next, el túnel de Sentry y archivos de imagen
    // o íconos. `/api/*` sí pasa (para refrescar la sesión) pero es público.
    '/((?!_next/static|_next/image|api/monitoring|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
