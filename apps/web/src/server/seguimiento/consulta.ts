import 'server-only';
import { type Certificado, ErrorRespuestaSii, ErrorTransporte } from '@winex/certificacion';
import type { OpcionesClienteSii } from '../sii/clientes';
import type { CanalSii } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import type { DependenciasSeguimiento } from './dependencias';
import { desdeRest, desdeSoap, ErrorPersistencia } from './persistencia';
import type { RespuestaEstado } from './tipos';

// Un cliente de estado por grupo (empresa + ambiente + canal), con un solo token para
// todas las consultas del grupo (PLAN-SAAS Fase 8: «un token por empresa»). El token sale
// del TokenStore cifrado (`tokens_sii`), así que entre corridas del cron también se
// reutiliza mientras esté vigente (50 min). Canal REST por defecto (D7); los envíos
// `canal = 'soap'` se consultan con QueryEstUp (`ClienteDtews.estadoEnvio`), que usa
// OTRO token (el de DTEWS): por eso el canal también separa los grupos.

/** Estados en proceso (`estados_sii.en_proceso` de la 0001; `EN_PROCESO` de la librería). */
export const ESTADOS_EN_PROCESO: readonly string[] = Object.freeze([
  'REC',
  'SOK',
  'CRT',
  'FOK',
  'PRD',
]);

/** Rechazos del sobre (`estados_sii.es_rechazo` de la 0001). */
export const ESTADOS_RECHAZO_SOBRE: readonly string[] = Object.freeze(['RSC', 'RFR', 'RCT', 'RCH']);

/**
 * Lista blanca: solo estos códigos se guardan en `envios.estado_sii` (son las 10 filas de
 * `estados_sii`). `clasificar_envio` trata cualquier otro como `rechazado`, y el SII
 * responde otros que no lo son: QueryEstUp da `-11` (sin glosa) a un envío que todavía no
 * registra y `RPR` (aceptado con reparos) a un RCOF, y contesta HTTP 200 con códigos de
 * error en `ESTADO`. Un código fuera de la lista es una falla de esa consulta: el envío
 * queda como estaba y se vuelve a consultar con el *backoff*.
 */
export const ESTADOS_CONOCIDOS: readonly string[] = Object.freeze([
  ...ESTADOS_EN_PROCESO,
  'EPR',
  ...ESTADOS_RECHAZO_SOBRE,
]);

/** El SII respondió un estado que no está en la lista blanca (código 5, como la CLI). */
export class ErrorEstadoDesconocido extends ErrorRespuestaSii {
  override name = 'ErrorEstadoDesconocido';
  constructor(estado: string, glosa: string | null) {
    const codigo = estado.slice(0, 20);
    super(
      `El SII respondió el estado «${codigo}»${glosa ? ` (${glosa.slice(0, 120)})` : ''}, que no es un estado de envío conocido: no se guardó y se volverá a consultar.`,
      { estado: codigo },
    );
  }
}

/**
 * QueryEstUp no responde 401 cuando el token DTEWS venció: contesta HTTP 200 con un
 * `ESTADO` de error, y la librería lo entrega como un `EstadoEnvio` más. No hay un código
 * documentado (ni en la librería ni en el repo), así que se reconoce por los códigos de
 * token habituales del DTEWS (001–003) o por una glosa que hable del token. Es una
 * heurística sin contrastar con el SII; si se equivoca, el costo es pedir un token de más.
 */
export class ErrorTokenSoap extends ErrorRespuestaSii {
  override name = 'ErrorTokenSoap';
  constructor(estado: string) {
    const codigo = estado.slice(0, 20);
    super(`QueryEstUp rechazó el token del DTEWS (ESTADO ${codigo}).`, { estado: codigo });
  }
}

const ESTADOS_TOKEN_SOAP: readonly string[] = ['001', '002', '003'];

export interface ClienteEstado {
  obtenerToken(): Promise<string>;
  olvidarToken(): Promise<void>;
  /** Lanza `ErrorTokenSoap` o `ErrorEstadoDesconocido` según la lista blanca. */
  consultar(token: string, trackId: string): Promise<RespuestaEstado>;
}

/** Aplica la lista blanca a una respuesta ya normalizada. */
export function validarEstado(r: RespuestaEstado, canal: CanalSii): RespuestaEstado {
  const estado = r.estado.trim();
  if (ESTADOS_CONOCIDOS.includes(estado)) return estado === r.estado ? r : { ...r, estado };
  if (canal === 'soap' && (ESTADOS_TOKEN_SOAP.includes(estado) || /token/i.test(r.glosa ?? ''))) {
    throw new ErrorTokenSoap(estado);
  }
  throw new ErrorEstadoDesconocido(estado, r.glosa);
}

export function clienteEstado(
  deps: DependenciasSeguimiento,
  canal: CanalSii,
  certificado: Certificado,
  opciones: Omit<OpcionesClienteSii, 'reloj'> & { rutEmpresa: string },
): ClienteEstado {
  const comunes = {
    ambiente: opciones.ambiente,
    transporte: opciones.transporte,
    tokenStore: opciones.tokenStore,
    reloj: deps.reloj,
  };
  const rut = opciones.rutEmpresa;
  if (canal === 'soap') {
    const soap = deps.soap(certificado, comunes);
    return {
      obtenerToken: () => soap.obtenerToken(rut),
      olvidarToken: () => soap.olvidarToken(rut),
      consultar: async (token, trackId) =>
        validarEstado(desdeSoap(await soap.estadoEnvio(token, rut, trackId)), 'soap'),
    };
  }
  const rest = deps.rest(certificado, comunes);
  return {
    obtenerToken: () => rest.obtenerToken(rut),
    olvidarToken: () => rest.olvidarToken(rut),
    consultar: async (token, trackId) =>
      validarEstado(desdeRest(await rest.consultarEnvio(token, rut, trackId)), 'rest'),
  };
}

/**
 * RUT de la empresa del envío (service_role, filtrando por organización). Lanza
 * `ErrorPersistencia` si no se puede leer: sin RUT no hay token ni consulta.
 */
export async function rutDeEmpresa(
  cliente: ClienteServicio,
  organizacionId: string,
  empresaId: string,
): Promise<string> {
  const { data, error } = await cliente
    .from('empresas')
    .select('rut')
    .eq('organizacion_id', organizacionId)
    .eq('id', empresaId)
    .maybeSingle();
  if (error || !data) throw new ErrorPersistencia('leer la empresa del envío', error);
  return data.rut;
}

/**
 * El SII rechazó el token (venció antes de tiempo o lo invalidó): hay que pedir otro. REST
 * responde 401; QueryEstUp, HTTP 200 con un estado de token (`ErrorTokenSoap`).
 */
export function tokenRechazado(error: unknown): boolean {
  return (
    (error instanceof ErrorTransporte && error.status === 401) || error instanceof ErrorTokenSoap
  );
}

export interface EstadoToken {
  token: string;
  renovado: boolean;
  /** Se quiso renovar pero no quedaba tiempo: el resto del grupo se posterga. */
  sinTiempo?: boolean;
}

/**
 * Consulta con el token del grupo y, si el SII lo rechaza, lo olvida, pide uno nuevo UNA
 * vez y repite la consulta. El estado se comparte entre las consultas del grupo: después
 * de una renovación, otro rechazo ya no renueva (sería un problema del certificado o del
 * SII, no del token). `puedeRenovar` dice si queda tiempo para renovar (semilla + token +
 * la consulta repetida, hasta 3 peticiones de 45 s); si no, se relanza el rechazo.
 */
export async function consultarConRenovacion(
  sii: ClienteEstado,
  estado: EstadoToken,
  trackId: string,
  puedeRenovar: () => boolean = () => true,
): Promise<RespuestaEstado> {
  try {
    return await sii.consultar(estado.token, trackId);
  } catch (error) {
    if (estado.renovado || !tokenRechazado(error)) throw error;
    if (!puedeRenovar()) {
      estado.sinTiempo = true;
      throw error;
    }
    estado.renovado = true;
    await sii.olvidarToken().catch(() => undefined);
    estado.token = await sii.obtenerToken();
    return await sii.consultar(estado.token, trackId);
  }
}
