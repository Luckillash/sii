import 'server-only';
import { type PeticionRegistrada, RespuestaHttp, TransporteFalso } from '@winex/certificacion';

// SII falso para las pruebas e2e (PLAN-SAAS Fase 13, punto 2: «flujos críticos con SII
// falso»). Con `E2E_SII_FALSO_URL=http://127.0.0.1:<puerto>`, `crearTransporte()` deja de
// salir al SII: cada petición se reenvía al simulador que levanta la prueba
// (`e2e/soporte/sii-falso.ts`), que responde como el SII. Así el `next dev` de la prueba
// recorre la certificación, los folios, la emisión y el seguimiento sin tocar el SII.
//
// Candados (nunca se activa en Production):
//   - solo con `next dev`: con `NODE_ENV=production` (next build / next start) o en
//     Vercel (`VERCEL` / `VERCEL_ENV`, cualquier ambiente) la variable se rechaza;
//   - solo hacia loopback por http (127.0.0.1, localhost, ::1): el simulador corre en el
//     mismo equipo que la prueba;
//   - mal configurada, falla cerrado: lanza en vez de volver al SII real.
// Si la variable llega a un deploy de Vercel se ignora (sigue el SII real, que es lo que
// corresponde ahí) y se avisa una vez por consola.
//
// Al simulador nunca viaja el certificado de cliente (`tls`): solo si la petición lo
// llevaba. Los cuerpos sí (formularios, XML firmados, sobres), como los vería el SII.

export const VARIABLE_SII_FALSO = 'E2E_SII_FALSO_URL';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MS_RESPUESTA = 45_000;

type Entorno = Readonly<Record<string, string | undefined>>;

let avisoVercel = false;

/**
 * URL del simulador, o `null` si no hay que usarlo (sin la variable, o en Vercel).
 *
 * @throws Error si la variable está puesta fuera de `next dev` (build de producción
 *   local) o no apunta a loopback por http.
 */
export function urlSiiFalso(entorno: Entorno = process.env): URL | null {
  const valor = entorno[VARIABLE_SII_FALSO]?.trim();
  if (!valor) return null;

  if (entorno.VERCEL || entorno.VERCEL_ENV) {
    if (!avisoVercel) {
      avisoVercel = true;
      console.error(`${VARIABLE_SII_FALSO} se ignora en Vercel: la capa SII usa el SII real.`);
    }
    return null;
  }
  if (entorno.NODE_ENV === 'production') {
    throw new Error(
      `${VARIABLE_SII_FALSO} solo se permite con next dev (NODE_ENV=${entorno.NODE_ENV}).`,
    );
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`${VARIABLE_SII_FALSO} no es una URL válida.`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password) {
    throw new Error(`${VARIABLE_SII_FALSO} tiene que apuntar a http://127.0.0.1:<puerto>.`);
  }
  return url;
}

/** Lo que recibe el simulador por cada petición al SII. */
export interface PeticionSimulador {
  metodo: string;
  url: string;
  cabeceras: Record<string, string>;
  /** Cuerpo en base64 (vacío si no hay). */
  cuerpo: string;
  /** Si la petición llevaba certificado de cliente (el certificado no viaja). */
  tls: boolean;
  conexionNueva: boolean;
}

/** Lo que responde el simulador. */
export interface RespuestaSimulador {
  status: number;
  cabeceras?: Record<string, string | string[]>;
  /** Cuerpo en base64. */
  cuerpo?: string;
}

async function reenviar(base: URL, p: PeticionRegistrada): Promise<RespuestaHttp> {
  const cuerpo: PeticionSimulador = {
    metodo: p.metodo,
    url: p.url,
    cabeceras: { ...p.cabeceras },
    cuerpo: p.bytes ? p.bytes.toString('base64') : '',
    tls: p.tls,
    conexionNueva: p.conexionNueva,
  };
  const r = await fetch(new URL('/sii', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(p.msRespuesta ?? MS_RESPUESTA),
  });
  if (!r.ok) throw new Error(`El SII falso respondió ${r.status}.`);
  const datos = (await r.json()) as RespuestaSimulador;
  return new RespuestaHttp(
    datos.status,
    datos.cabeceras ?? {},
    Buffer.from(datos.cuerpo ?? '', 'base64'),
  );
}

/**
 * Transporte hacia el simulador si `E2E_SII_FALSO_URL` está activa (ver `urlSiiFalso`),
 * o `null`. `TransporteFalso` arma los bytes de cada petición igual que el transporte real.
 */
export function transporteSiiFalso(entorno: Entorno = process.env): TransporteFalso | null {
  const base = urlSiiFalso(entorno);
  if (base === null) return null;
  return new TransporteFalso([['*', (p) => reenviar(base, p)]]);
}
