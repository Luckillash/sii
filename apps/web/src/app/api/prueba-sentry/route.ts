import { createHash, timingSafeEqual } from 'node:crypto';

// TEMPORAL: prueba de Sentry en producción. Lanza un error sin capturarlo (como un
// error real) para comprobar que llega por onRequestError, con source maps y con los
// secretos falsos reemplazados por "[Filtrado]". Se borra apenas se confirme, junto
// con la variable SENTRY_PRUEBA_TOKEN de Vercel.
//
//   curl -H "Authorization: Bearer $SENTRY_PRUEBA_TOKEN" https://<dominio>/api/prueba-sentry

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class ErrorPruebaSentry extends Error {
  override name = 'ErrorPruebaSentry';
}

function autorizado(request: Request): boolean {
  const esperado = process.env.SENTRY_PRUEBA_TOKEN;
  if (!esperado || esperado.length < 32) return false;
  const recibido = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  // Sin token válido la ruta no existe: nadie más puede llenar Sentry de errores.
  if (!autorizado(request)) return new Response('No encontrado', { status: 404 });

  // Se arma en ejecución para que el valor no aparezca en las líneas de código que
  // Sentry adjunta al stack trace.
  const falso = ['FALSO', 'NO', 'DEBE', 'VERSE'].join('-');
  const id = new URL(request.url).searchParams.get('id') ?? String(Date.now());
  throw new ErrorPruebaSentry(`Sentry test error ${id} con TOKEN=${falso}`);
}
