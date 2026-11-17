import 'server-only';
import type {
  Certificado,
  ClienteBoletaRest,
  Reloj,
  TokenStore,
  TransporteHttp,
} from '@winex/certificacion';
import type { AmbienteSii } from '@/lib/folios';
import {
  type DependenciasCertificacion,
  resolverDependencias,
} from '../certificacion/dependencias';
import { enviarBoletaPorCorreo } from '../correo/boleta';
import { generarPdf } from '../pdf';
import { clienteBoletaRest } from '../sii/clientes';

// Dependencias de la emisión (PLAN-SAAS Fase 7), inyectables para probar sin red ni base.
// Son las de la certificación (service_role, sesión, reloj, transporte, credenciales,
// TokenStore, `ejecutarOperacion`, correo de las alertas) más tres propias:
//
//   - `rest`: el cliente REST de boletas en el ambiente que se pida. La fábrica de la
//     certificación (`FABRICAS_SII.rest`) lo fija en certificación; la emisión también
//     va a producción (api.sii.cl / rahue.sii.cl).
//   - `pdf`: la representación impresa (`server/pdf`).
//   - `correoBoleta`: el envío del PDF al receptor (`server/correo/boleta`).
//
// Se arman en cada llamada con `resolverDependenciasEmision()` (nunca en una variable de
// módulo: transporte y credenciales son por invocación).

/** Lo que la emisión usa del cliente REST de la librería. */
export type ClienteRestEmision = Pick<
  ClienteBoletaRest,
  'obtenerToken' | 'enviarBoleta' | 'olvidarToken'
>;

export interface OpcionesRestEmision {
  readonly ambiente: AmbienteSii;
  readonly transporte: TransporteHttp;
  readonly reloj: Reloj;
  readonly tokenStore: TokenStore;
}

export type FabricaRestEmision = (
  certificado: Certificado,
  opciones: OpcionesRestEmision,
) => ClienteRestEmision;

/** El cliente REST del ambiente del borrador (`server/sii/clientes.ts`, compartido con la Fase 8). */
export const FABRICA_REST_EMISION: FabricaRestEmision = (certificado, opciones) =>
  clienteBoletaRest(certificado, opciones);

export interface DependenciasEmision extends DependenciasCertificacion {
  rest: FabricaRestEmision;
  pdf: typeof generarPdf;
  correoBoleta: typeof enviarBoletaPorCorreo;
}

/** Las dependencias reales, con lo que se pase reemplazado. */
export function resolverDependenciasEmision(
  parciales: Partial<DependenciasEmision> = {},
): DependenciasEmision {
  const { rest, pdf, correoBoleta, ...comunes } = parciales;
  return {
    ...resolverDependencias(comunes),
    rest: rest ?? FABRICA_REST_EMISION,
    pdf: pdf ?? generarPdf,
    correoBoleta: correoBoleta ?? enviarBoletaPorCorreo,
  };
}
