import 'server-only';
import { ambitoDe } from './documentos';
import type { ContextoApi } from './manejar';
import { representarEnvio } from './representacion';
import { ErrorApi, respuestaJson } from './respuestas';

// `GET /envios/{id}` (PLAN-SAAS Fase 11, alcance `envios:leer`): carátula, Track ID,
// estado del SII, conteos, sus documentos y los rechazos o reparos con los errores del SII.
// Solo envíos del ambiente de la clave (y de su empresa, si tiene); nunca un RCOF.

export async function manejarEnvio(ctx: ContextoApi, id: string): Promise<Response> {
  const { clave, deps } = ctx;
  const ambito = ambitoDe(clave);
  const envio = await deps.repo.envio(ambito, id);
  if (!envio) throw new ErrorApi('no_encontrado');
  const [empresa, documentos, rechazos] = await Promise.all([
    deps.repo.empresaPorId(clave.organizacionId, envio.empresa_id),
    deps.repo.documentosDeEnvio(clave.organizacionId, envio.id),
    deps.repo.rechazosDeEnvio(clave.organizacionId, envio.id),
  ]);
  if (!empresa) throw new ErrorApi('no_encontrado');
  return respuestaJson(representarEnvio(envio, empresa, documentos, rechazos));
}
