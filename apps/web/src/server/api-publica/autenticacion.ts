import 'server-only';
import { createHash } from 'node:crypto';
import { type Alcance, ambienteDeClave } from '@/lib/api-publica';
import type { ClaveAutenticada, MotivoRechazoClave, RepositorioApi } from './repositorio';
import { ErrorApi } from './respuestas';

// Autenticación de `/api/v1` (PLAN-SAAS Fase 11, §2.1 del diseño): `Authorization: Bearer
// sk_test_<64 hex>` o `sk_live_<64 hex>`. Se valida la forma, se calcula el sha256 en hex
// (lo único que guarda `api_keys.clave_hash`) y `autenticar_api_key` (0018) decide:
// inexistente, revocada, vencida o plan sin API. La clave nunca se registra ni se guarda.
//
// El ambiente lo fija la clave: `sk_test_` es certificación y `sk_live_`, producción. Si la
// fila dice otra cosa (no debería: lo fija `crear_api_key`), la clave se trata como inválida.

const ESQUEMA_BEARER = /^Bearer\s+(\S+)\s*$/i;

/** sha256 en hex, igual que `encode(sha256(convert_to(clave, 'UTF8')), 'hex')` de la 0001. */
export function hashClave(clave: string): string {
  return createHash('sha256').update(clave, 'utf8').digest('hex');
}

const CODIGO_RECHAZO: Record<MotivoRechazoClave, ErrorApi['codigo']> = {
  invalida: 'clave_invalida',
  revocada: 'clave_revocada',
  vencida: 'clave_vencida',
  plan_sin_api: 'plan_sin_api',
};

/** La clave autenticada de la petición, o lanza `ErrorApi` (401/403). */
export async function autenticar(
  cabeceras: Headers,
  repo: Pick<RepositorioApi, 'autenticar'>,
): Promise<ClaveAutenticada> {
  const autorizacion = cabeceras.get('authorization');
  if (!autorizacion) throw new ErrorApi('no_autenticado');
  const clave = ESQUEMA_BEARER.exec(autorizacion)?.[1];
  if (!clave) throw new ErrorApi('no_autenticado');
  const ambiente = ambienteDeClave(clave);
  if (!ambiente) throw new ErrorApi('clave_invalida');

  const resultado = await repo.autenticar(hashClave(clave));
  if (!resultado.ok) throw new ErrorApi(CODIGO_RECHAZO[resultado.motivo]);
  if (resultado.clave.ambiente !== ambiente) throw new ErrorApi('clave_invalida');
  return resultado.clave;
}

export function exigirAlcance(clave: ClaveAutenticada, alcance: Alcance): void {
  if (!clave.alcances.includes(alcance)) {
    throw new ErrorApi('alcance_insuficiente', {
      mensaje: `Esta API key no tiene el alcance ${alcance}. Crea una clave con ese alcance en Configuración → API.`,
    });
  }
}
