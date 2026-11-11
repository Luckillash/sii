// Cliente de la API REST de boleta para los comandos de `produccion` (emitir, consultar y
// seguimiento).

import {
  type Ambiente,
  type Certificado,
  ClienteBoletaRest,
  URLS_BOLETA_REST,
} from '@winex/certificacion';
import { type Config, configTokenStore } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';

export interface ClienteRest {
  readonly cliente: ClienteBoletaRest;
  /** Si hay caché de tokens (`SII_CACHE_TOKENS`). */
  readonly conCache: boolean;
  /**
   * Token para operar a nombre de la empresa: el del caché si hay uno vigente o,
   * sin caché, uno nuevo en cada ejecución. Nunca se imprime.
   */
  token(rutEmpresa: string): Promise<string>;
}

/**
 * Prepara el cliente REST sin hacer ninguna petición: valida `SII_CACHE_TOKENS`
 * (si viene) antes de que salga nada al SII.
 */
export function clienteRest(
  ctx: Contexto,
  config: Config,
  certificado: Certificado,
  ambiente: Ambiente,
): ClienteRest {
  const tokenStore = configTokenStore(config);
  const cliente = new ClienteBoletaRest(certificado, {
    ambiente,
    transporte: ctx.transporte(),
    reloj: ctx.reloj,
    ...(tokenStore === undefined ? {} : { tokenStore }),
  });
  return {
    cliente,
    conCache: tokenStore !== undefined,
    token: (rutEmpresa) =>
      tokenStore === undefined ? cliente.solicitarToken() : cliente.obtenerToken(rutEmpresa),
  };
}

/** `api.sii.cl / rahue.sii.cl` o `apicert.sii.cl / pangal.sii.cl`. */
export function hostsRest(ambiente: Ambiente): { auth: string; envio: string } {
  const urls = URLS_BOLETA_REST[ambiente];
  return { auth: new URL(urls.auth).host, envio: new URL(urls.envio).host };
}

/** Nombre del ambiente para la salida. */
export function nombreAmbiente(ambiente: Ambiente): string {
  return ambiente === 'produccion' ? 'producción' : 'certificación';
}

/** Glosa de los estados de un envío REST (`EstadoEnvioRest.estado`). */
const GLOSAS_ESTADO: Readonly<Record<string, string>> = {
  REC: 'recibido',
  SOK: 'esquema validado',
  CRT: 'carátula validada',
  FOK: 'firma validada',
  PRD: 'en proceso',
  EPR: 'envío procesado',
  RSC: 'rechazado por error en el esquema',
  RFR: 'rechazado por error en la firma',
  RCT: 'rechazado por error en la carátula',
  RCH: 'rechazado',
};

/** Glosa de un estado del SII, o `undefined` si es uno desconocido. */
export function glosaEstado(estado: string): string | undefined {
  return Object.hasOwn(GLOSAS_ESTADO, estado) ? GLOSAS_ESTADO[estado] : undefined;
}

/** `--ambiente certificacion` para repetir un comando (vacío en producción, que es el defecto). */
export function sufijoAmbiente(ambiente: Ambiente): string {
  return ambiente === 'produccion' ? '' : ' --ambiente certificacion';
}
