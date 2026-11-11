import 'server-only';
import type { ClaveToken, TokenGuardado, TokenStore } from '@winex/certificacion';
import { aBytea, cifrar, descifrar, desdeBytea } from '../cifrado';

// TokenStore de la librería sobre las RPC token_obtener / token_guardar /
// token_borrar del esquema (solo service_role). El token se cifra con AES-256-GCM
// en la app; la base solo ve `iv || ciphertext || tag` (PLAN-SAAS §4.4, Fase 4).
//
// Regla de la librería: el token es una credencial. Ningún mensaje de error lo
// incluye, ni tampoco el detalle de PostgREST (podría traer la fila).

interface RespuestaRpc {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** Lo único que este store necesita del cliente de Supabase (facilita las pruebas). */
export interface ClienteRpc {
  rpc(funcion: string, argumentos: Record<string, unknown>): PromiseLike<RespuestaRpc>;
}

export class ErrorTokenStore extends Error {
  override name = 'ErrorTokenStore';
}

interface FilaToken {
  token_cifrado: string;
  vence_en: string;
}

function argumentosClave(clave: ClaveToken) {
  return {
    p_canal: clave.canal,
    p_ambiente: clave.ambiente,
    p_rut: clave.rutEmpresa,
    p_huella: clave.huellaCertificado,
  };
}

/** Datos autenticados del cifrado: el token solo descifra en su propia fila. */
export function contextoToken(clave: ClaveToken): string {
  return JSON.stringify([clave.canal, clave.ambiente, clave.rutEmpresa, clave.huellaCertificado]);
}

function fallo(operacion: string, error: { code?: string }): ErrorTokenStore {
  const codigo = error.code ? ` (código ${error.code})` : '';
  return new ErrorTokenStore(`No se pudo ${operacion} el token del SII en Supabase${codigo}.`);
}

export class TokenStoreSupabase implements TokenStore {
  readonly #cliente: ClienteRpc;
  readonly #llave: Buffer;

  constructor(cliente: ClienteRpc, llave: Buffer) {
    this.#cliente = cliente;
    this.#llave = llave;
  }

  async obtener(clave: ClaveToken): Promise<TokenGuardado | undefined> {
    const { data, error } = await this.#cliente.rpc('token_obtener', argumentosClave(clave));
    if (error) throw fallo('leer', error);
    const fila = (Array.isArray(data) ? data[0] : data) as FilaToken | null | undefined;
    if (!fila) return undefined;
    const venceEn = new Date(fila.vence_en);
    if (Number.isNaN(venceEn.getTime())) return undefined;
    try {
      const token = descifrar(desdeBytea(fila.token_cifrado), this.#llave, contextoToken(clave));
      return { token: token.toString('utf8'), venceEn };
    } catch {
      // Llave rotada o fila alterada: es un caché, se pide un token nuevo.
      return undefined;
    }
  }

  async guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void> {
    const cifrado = cifrar(guardado.token, this.#llave, contextoToken(clave));
    const { error } = await this.#cliente.rpc('token_guardar', {
      ...argumentosClave(clave),
      p_token_cifrado: aBytea(cifrado),
      p_vence_en: guardado.venceEn.toISOString(),
    });
    if (error) throw fallo('guardar', error);
  }

  async borrar(clave: ClaveToken): Promise<void> {
    const { error } = await this.#cliente.rpc('token_borrar', argumentosClave(clave));
    if (error) throw fallo('borrar', error);
  }
}
