import 'server-only';
import {
  type Certificado,
  type ClienteBoletaRest,
  type ClienteDtews,
  type Reloj,
  relojSistema,
  type TokenStore,
} from '@winex/certificacion';
import { leerLlave } from '../cifrado';
import { clienteBoletaRest, clienteDtews, type OpcionesClienteSii } from '../sii/clientes';
import { type Credenciales, crearCredenciales } from '../sii/credenciales';
import type { DependenciasOperacion } from '../sii/operacion';
import { TokenStoreSupabase } from '../sii/token-store-supabase';
import { crearTransporte, type TransporteInvocacion } from '../sii/transporte';
import { type ClienteServicio, clienteServicio } from '../supabase/service';

// Dependencias del seguimiento de envíos (PLAN-SAAS Fase 8), inyectables para probar sin
// red ni base (§8: «Capa SII: Vitest + TransporteFalso»). Son las piezas de la Fase 4
// (service_role, transporte, credenciales, TokenStore cifrado, `ejecutarOperacion`) más
// las fábricas de los clientes de estado de la librería:
//
//   - `rest`: `ClienteBoletaRest` del AMBIENTE DEL ENVÍO (`server/sii/clientes.ts`, el
//     mismo de la emisión). No la de `FABRICAS_SII.rest`, que fija certificación.
//   - `soap`: `ClienteDtews` (QueryEstUp) para los envíos con `canal = 'soap'`.
//
// No arrastra la sesión del usuario, el correo ni las sesiones AUT2000: el seguimiento
// corre en el cron (sin usuario) y el REST/DTEWS no usan AUT2000. Se arman en cada llamada
// con `resolverDependenciasSeguimiento()` (nunca en una variable de módulo: transporte y
// credenciales son por invocación, ver `server/sii/`).

/** Lo que el seguimiento usa del cliente REST de la librería. */
export type ClienteEstadoRest = Pick<
  ClienteBoletaRest,
  'obtenerToken' | 'olvidarToken' | 'consultarEnvio'
>;

/** Lo que el seguimiento usa del cliente SOAP DTEWS de la librería. */
export type ClienteEstadoSoap = Pick<ClienteDtews, 'obtenerToken' | 'olvidarToken' | 'estadoEnvio'>;

export type FabricaEstadoRest = (
  certificado: Certificado,
  opciones: OpcionesClienteSii,
) => ClienteEstadoRest;

export type FabricaEstadoSoap = (
  certificado: Certificado,
  opciones: OpcionesClienteSii,
) => ClienteEstadoSoap;

export interface DependenciasSeguimiento {
  /** Cliente service_role (salta RLS: toda consulta filtra por organización). */
  servicio(): ClienteServicio;
  reloj: Reloj;
  /** Un transporte por grupo o consulta, cerrado con `await using`. */
  transporte(): TransporteInvocacion;
  credenciales(cliente: ClienteServicio): Credenciales;
  tokenStore(cliente: ClienteServicio): TokenStore;
  rest: FabricaEstadoRest;
  soap: FabricaEstadoSoap;
  /** Para `ejecutarOperacion` (Sentry, reloj). */
  operacion: Partial<DependenciasOperacion>;
}

/** Las dependencias reales, con lo que se pase reemplazado. */
export function resolverDependenciasSeguimiento(
  parciales: Partial<DependenciasSeguimiento> = {},
): DependenciasSeguimiento {
  const reloj = parciales.reloj ?? relojSistema;
  return {
    servicio: clienteServicio,
    transporte: () => crearTransporte(),
    credenciales: (cliente) => crearCredenciales(cliente, { reloj }),
    tokenStore: (cliente) => new TokenStoreSupabase(cliente, leerLlave(process.env.SII_TOKENS_KEY)),
    rest: clienteBoletaRest,
    soap: clienteDtews,
    ...parciales,
    reloj,
    operacion: { reloj: () => reloj.ahora(), ...parciales.operacion },
  };
}
