import { type NextRequest, NextResponse } from 'next/server';
import { destinoSeguro } from '@/lib/redireccion';
import { RUTA_INGRESAR, urlIngresar } from '@/lib/rutas';
import { clienteServidor } from '@/server/supabase/servidor';

// Cerrar sesión: <form action="/auth/salir" method="post">. Solo POST (un GET desde un
// <img> o un enlace precargado no debe cerrar la sesión); 303 para que el navegador
// siga con GET a /ingresar. `/auth/*` es pública en el proxy.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Rechaza formularios enviados desde otro sitio (el navegador manda `Origin` en los POST). */
function mismoOrigen(request: NextRequest): boolean {
  const origen = request.headers.get('origin');
  if (!origen) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!mismoOrigen(request)) {
    return new NextResponse('Origen no permitido.', { status: 403 });
  }

  try {
    const supabase = await clienteServidor();
    // 'local': cierra esta sesión; las de otros equipos siguen abiertas.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.error(`auth/salir: ${error.code ?? error.name}`);
  } catch (error) {
    console.error('auth/salir:', error instanceof Error ? error.message : 'error desconocido');
  }

  // Campo opcional `siguiente` (p. ej. la invitación abierta con otro correo): vuelve
  // a ingresar con ese destino, siempre una ruta interna (destinoSeguro).
  let destino = RUTA_INGRESAR;
  try {
    const siguiente = (await request.formData()).get('siguiente');
    if (typeof siguiente === 'string' && siguiente) {
      destino = urlIngresar(destinoSeguro(siguiente));
    }
  } catch {
    // Sin cuerpo de formulario: a ingresar sin destino.
  }

  // Aunque Auth falle, signOut borra las cookies de la sesión: se va a ingresar igual.
  return NextResponse.redirect(new URL(destino, request.url), { status: 303 });
}
