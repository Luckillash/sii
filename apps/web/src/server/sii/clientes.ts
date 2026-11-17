import 'server-only';
import {
  type Certificado,
  ClienteBoletaRest,
  ClienteDtews,
  type Reloj,
  type TokenStore,
  type TransporteHttp,
} from '@winex/certificacion';
import type { AmbienteSii } from './operacion';

// Clientes de la librería para hablar con el SII en el ambiente que se pida (Fases 7 y 8).
//
// Existe porque `FABRICAS_SII.rest` de `server/certificacion/dependencias.ts` crea el
// `ClienteBoletaRest` SIEMPRE en certificación (era para el set de pruebas). La emisión
// y el seguimiento también van a producción (api.sii.cl / rahue.sii.cl; palena para
// DTEWS): si alguien usara aquí la fábrica de la certificación, las consultas y envíos
// de producción saldrían a apicert/pangal con el certificado de producción.
//
// Se crean por invocación (nunca en una variable de módulo): el transporte y el
// TokenStore son de la petición que los arma.

export interface OpcionesClienteSii {
  readonly ambiente: AmbienteSii;
  readonly transporte: TransporteHttp;
  readonly reloj: Reloj;
  readonly tokenStore: TokenStore;
}

/** API REST de boletas (semilla, token, envío y estado) en el ambiente pedido. */
export function clienteBoletaRest(
  certificado: Certificado,
  opciones: OpcionesClienteSii,
): ClienteBoletaRest {
  return new ClienteBoletaRest(certificado, {
    ambiente: opciones.ambiente,
    transporte: opciones.transporte,
    reloj: opciones.reloj,
    tokenStore: opciones.tokenStore,
  });
}

/** Canal SOAP DTEWS (CrSeed, GetTokenFromSeed, QueryEstUp) en el ambiente pedido. */
export function clienteDtews(certificado: Certificado, opciones: OpcionesClienteSii): ClienteDtews {
  return new ClienteDtews(certificado, {
    ambiente: opciones.ambiente,
    transporte: opciones.transporte,
    reloj: opciones.reloj,
    tokenStore: opciones.tokenStore,
  });
}
