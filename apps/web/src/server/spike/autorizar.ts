import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Las rutas del spike solo existen si SPIKE_TOKEN está definido, y exigen
 * `Authorization: Bearer <SPIKE_TOKEN>`. Devuelve una respuesta de rechazo o null.
 */
export function rechazoSpike(request: Request): Response | null {
  const esperado = process.env.SPIKE_TOKEN;
  if (!esperado || esperado.length < 32) {
    return new Response('No encontrado', { status: 404 });
  }
  const recibido = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  if (!timingSafeEqual(a, b)) {
    return new Response('No autorizado', { status: 401 });
  }
  return null;
}
