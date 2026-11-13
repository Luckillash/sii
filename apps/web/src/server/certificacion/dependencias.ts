import 'server-only';
import {
  type Certificado,
  ClienteBoletaRest,
  DeclaracionBoletas,
  PostulacionSii,
  type Reloj,
  relojSistema,
  SolicitudFolios,
  type TokenStore,
  type TransporteHttp,
} from '@winex/certificacion';
import { leerLlave } from '../cifrado';
import { enviarCorreo, type MensajeCorreo, type ResultadoEnvio } from '../correo/resend';
import { envAuth } from '../env';
import type { OpcionesBloqueo } from '../sii/bloqueos';
import { type Credenciales, crearCredenciales } from '../sii/credenciales';
import type { DependenciasOperacion } from '../sii/operacion';
import { type AlmacenSesiones, SesionesSupabase } from '../sii/sesiones';
import { TokenStoreSupabase } from '../sii/token-store-supabase';
import { crearTransporte, type TransporteInvocacion } from '../sii/transporte';
import { type ClienteServicio, clienteServicio } from '../supabase/service';
import { clienteServidor } from '../supabase/servidor';

// Dependencias de la capa de certificación, inyectables para probar sin red ni base
// (PLAN-SAAS §8: «Capa SII: Vitest + TransporteFalso»). En producción se arman con
// `resolverDependencias()` en cada llamada (nunca en una variable de módulo: el
// transporte, las credenciales y las sesiones son por invocación, ver server/sii/).
//
// Los clientes de la librería se piden por fábrica y se tipan con el subconjunto que
// se usa: en las pruebas se reemplazan por dobles que no salen a la red. La app no
// reimplementa nada de la librería (principio 4): solo la llama.

export type ClientePostulacion = Pick<PostulacionSii, 'autenticar' | 'postular'>;
export type ClienteDeclaracion = Pick<
  DeclaracionBoletas,
  'verificarPortal' | 'estado' | 'descargarSetPruebas' | 'solicitarRevisionSet' | 'declarar'
>;
export type ClienteFolios = Pick<SolicitudFolios, 'autenticar' | 'solicitar'>;
export type ClienteRest = Pick<
  ClienteBoletaRest,
  'obtenerToken' | 'enviarBoleta' | 'consultarEnvio'
>;

export interface OpcionesCliente {
  readonly transporte: TransporteHttp;
  readonly reloj: Reloj;
}

/** Fábricas de los clientes de la librería. El ambiente siempre es certificación. */
export interface FabricasSii {
  postulacion(opciones: OpcionesCliente): ClientePostulacion;
  declaracion(opciones: OpcionesCliente): ClienteDeclaracion;
  folios(opciones: OpcionesCliente): ClienteFolios;
  rest(
    certificado: Certificado,
    opciones: OpcionesCliente & { readonly tokenStore: TokenStore },
  ): ClienteRest;
}

export const FABRICAS_SII: FabricasSii = Object.freeze({
  postulacion: ({ transporte, reloj }: OpcionesCliente) =>
    new PostulacionSii({ transporte, reloj }),
  declaracion: ({ transporte, reloj }: OpcionesCliente) =>
    new DeclaracionBoletas({ transporte, reloj }),
  folios: ({ transporte, reloj }: OpcionesCliente) =>
    new SolicitudFolios({ ambiente: 'certificacion', transporte, reloj }),
  rest: (
    certificado: Certificado,
    { transporte, reloj, tokenStore }: OpcionesCliente & { readonly tokenStore: TokenStore },
  ) =>
    new ClienteBoletaRest(certificado, {
      ambiente: 'certificacion',
      transporte,
      reloj,
      tokenStore,
    }),
});

export interface CorreoCertificacion {
  enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
  /** Origen público de la app (`NEXT_PUBLIC_APP_URL`), o null si no está configurado. */
  urlApp(): string | null;
}

export interface DependenciasCertificacion {
  /** Cliente service_role (salta RLS: toda consulta filtra por organización). */
  servicio(): ClienteServicio;
  /** Cliente con la sesión del usuario (RLS). */
  sesion(): Promise<ClienteServicio>;
  reloj: Reloj;
  /** Un transporte por operación, cerrado con `await using`. */
  transporte(): TransporteInvocacion;
  credenciales(cliente: ClienteServicio): Credenciales;
  sesionesSii(cliente: ClienteServicio): AlmacenSesiones;
  tokenStore(cliente: ClienteServicio): TokenStore;
  sii: FabricasSii;
  /** Para `ejecutarOperacion` (sesión con Auth, Sentry, reloj). */
  operacion: Partial<DependenciasOperacion>;
  /** Para `conBloqueoCertificado` (pruebas: sin espera). */
  bloqueo: OpcionesBloqueo;
  correo: CorreoCertificacion;
}

function llaveTokens(): Buffer {
  return leerLlave(process.env.SII_TOKENS_KEY);
}

function urlAppPorDefecto(): string | null {
  try {
    return envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Las dependencias reales, con lo que se pase reemplazado. */
export function resolverDependencias(
  parciales: Partial<DependenciasCertificacion> = {},
): DependenciasCertificacion {
  const reloj = parciales.reloj ?? relojSistema;
  return {
    servicio: clienteServicio,
    sesion: clienteServidor,
    transporte: () => crearTransporte(),
    credenciales: (cliente) => crearCredenciales(cliente, { reloj }),
    sesionesSii: (cliente) => new SesionesSupabase(cliente, llaveTokens(), { reloj }),
    tokenStore: (cliente) => new TokenStoreSupabase(cliente, llaveTokens()),
    sii: FABRICAS_SII,
    bloqueo: {},
    correo: { enviar: (mensaje) => enviarCorreo(mensaje), urlApp: urlAppPorDefecto },
    ...parciales,
    reloj,
    operacion: { reloj: () => reloj.ahora(), ...parciales.operacion },
  };
}
