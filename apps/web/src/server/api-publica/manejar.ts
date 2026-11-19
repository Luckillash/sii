import 'server-only';
import type { Alcance } from '@/lib/api-publica';
import { autenticar, exigirAlcance } from './autenticacion';
import { capturarEnSentry, type DependenciasApi, resolverDependenciasApi } from './dependencias';
import type { ClaveAutenticada } from './repositorio';
import { esErrorApi, respuestaError } from './respuestas';

// Envoltorio de cada ruta de `/api/v1` (PLAN-SAAS Fase 11): autentica la API key, exige el
// alcance de la ruta, corre el manejador y traduce lo que lance. Un `ErrorApi` es una
// respuesta esperada (4xx o 503); cualquier otra excepción va a Sentry con la etiqueta
// `api_publica_ruta` y responde 500 `error_interno`, sin detalles al cliente.

export interface ContextoApi {
  request: Request;
  clave: ClaveAutenticada;
  deps: DependenciasApi;
}

export interface OpcionesRuta {
  /** Nombre de la ruta para Sentry (`POST /documentos`). */
  ruta: string;
  alcance: Alcance;
}

function prefijar(diagnostico: Record<string, string> | undefined): Record<string, string> {
  if (!diagnostico) return {};
  return Object.fromEntries(
    Object.entries(diagnostico).map(([k, v]) => [`api_publica_${k}`, v.slice(0, 64)]),
  );
}

export async function manejarApi(
  request: Request,
  opciones: OpcionesRuta,
  manejador: (ctx: ContextoApi) => Promise<Response>,
  dependencias?: Partial<DependenciasApi>,
): Promise<Response> {
  let deps: DependenciasApi | undefined;
  try {
    deps = resolverDependenciasApi(dependencias);
    const clave = await autenticar(request.headers, deps.repo);
    exigirAlcance(clave, opciones.alcance);
    return await manejador({ request, clave, deps });
  } catch (error) {
    if (esErrorApi(error)) {
      // Un `error_interno` traducido de la capa de abajo sí es un problema nuestro: va a
      // Sentry con sus etiquetas fijas (motivo y resultado), sin la petición.
      if (error.codigo === 'error_interno') {
        (deps?.capturar ?? capturarEnSentry)(error, {
          api_publica_ruta: opciones.ruta,
          ...prefijar(error.opciones.diagnostico),
        });
      }
      return respuestaError(error.codigo, error.opciones);
    }
    (deps?.capturar ?? capturarEnSentry)(error, {
      api_publica_ruta: opciones.ruta,
    });
    return respuestaError('error_interno');
  }
}
