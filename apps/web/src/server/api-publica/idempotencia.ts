import 'server-only';
import { createHash } from 'node:crypto';
import { CABECERA_IDEMPOTENCIA, FORMATO_IDEMPOTENCIA } from '@/lib/api-publica';
import { ErrorApi } from './respuestas';

// `Idempotency-Key` de la API pública (PLAN-SAAS Fase 11, §0.2 y §2.3 del diseño). La
// clave se reclama en `api_idempotencia` (0018) con la HUELLA de la petición: el sha256
// del JSON canónico (llaves ordenadas) de lo que define el recurso. La misma clave con
// otra huella es `idempotencia_conflicto` (422); la misma clave y huella devuelve la
// respuesta guardada, o 409 mientras la primera sigue en curso.

/** La clave de la cabecera, o `null` si no vino. Lanza 400 si viene con otra forma. */
export function leerClaveIdempotencia(cabeceras: Headers): string | null {
  const valor = cabeceras.get(CABECERA_IDEMPOTENCIA);
  if (valor === null) return null;
  if (!FORMATO_IDEMPOTENCIA.test(valor)) throw new ErrorApi('idempotencia_invalida');
  return valor;
}

/** Como `leerClaveIdempotencia`, pero la cabecera es obligatoria (400 si falta). */
export function exigirClaveIdempotencia(cabeceras: Headers): string {
  const clave = leerClaveIdempotencia(cabeceras);
  if (clave === null) throw new ErrorApi('idempotencia_requerida');
  return clave;
}

/** JSON con las llaves de los objetos ordenadas (los arreglos conservan su orden). */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const objeto = valor as Record<string, unknown>;
  const partes = Object.keys(objeto)
    .filter((k) => objeto[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(objeto[k])}`);
  return `{${partes.join(',')}}`;
}

/** sha256 hex del JSON canónico: la huella que guarda `api_idempotencia.huella`. */
export function huella(valor: unknown): string {
  return createHash('sha256').update(jsonCanonico(valor), 'utf8').digest('hex');
}
