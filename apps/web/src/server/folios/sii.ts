import 'server-only';
import {
  datosAmbiente,
  decodificarUtf8OIso,
  ErrorSolicitudFolios,
  ErrorTransporte,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  type PeticionHttp,
  type RespuestaHttp,
  SiiError,
  type TransporteHttp,
} from '@winex/certificacion';
import { type AmbienteSii, textoRango } from '@/lib/folios';
import { conSesionSii, enlazarOperacion, fallaBase } from '../certificacion/comun';
import type { DependenciasCertificacion } from '../certificacion/dependencias';
import type { CredencialesCertificado } from '../sii/credenciales';
import { ErrorIncierto, sanearTexto } from '../sii/errores';
import type { HerramientasOperacion } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import type { Database } from '../supabase/tipos';
import { type DatosCaf, leerDatosCaf, rangoDelCaf } from './caf';
import { leerCafs } from './disponibles';
import { codigoPg } from './errores';
import type { ContextoFolios } from './tipos';

// La solicitud de folios contra el SII (PLAN-SAAS Fases 5 y 6), dentro de
// `ejecutarOperacion` (quien llama abre la operación). Paridad con
// `sii certificacion solicitar-folios` de la CLI:
//
//   - REVISIÓN (`simular: true`, la CLI sin `--confirmar`): recorre el asistente `of_*` con
//     la sesión AUT2000 reutilizada y un transporte que solo deja salir los pasos
//     anteriores a la orden de timbrar (`TransporteSinTimbrar`, lista permitida; la CLI
//     corta solo `of_genera_folio`). `SolicitudFolios` lanza entonces `FoliosSinCafError` con el rango que
//     asignaría el SII y la causa `DetenidoAntesDeTimbrar`: la solicitud queda `simulada`
//     (`confirmada = false`) con ese rango. No se gasta ningún folio.
//   - TIMBRAJE (`simular: false`, `--confirmar`): fila `en_curso` → `SolicitudFolios`
//     timbra → `registrar_caf` (CAF a Vault + fila en `cafs` + solicitud `timbrada`).
//       · `FolioInicialRequeridoError` → solicitud `rechazada`; quien llama devuelve el
//         valor sugerido (`salida.folioSugerido`). No se timbró nada.
//       · `FoliosSinCafError` → solicitud `incierta` con el rango (código 6): no repetir,
//         bajar el CAF desde «Folios ya autorizados» y subirlo.
//       · CAF timbrado que no se pudo guardar (cualquier error de `registrar_caf`) →
//         `incierta` con el rango del CAF si se pudo leer, y `ErrorIncierto` (código 6 de
//         la CLI): los folios ya se timbraron; se baja de «Folios ya autorizados» y se sube.
//       · Si el error es un traslape (23P01) con un CAF ya cargado, mensaje propio (subirlo
//         también fallaría: revisar los dos CAF y escribir a soporte) y
//         `detalle.incierto_motivo = 'traslape'` en la operación, para que la UI no
//         proponga subirlo.
//   - Todo bajo el bloqueo del certificado y su sesión AUT2000 del ambiente
//     (`conSesionSii`), porque el SII frena el re-login.
//
// El XML del CAF (con `<RSASK>`) nunca se registra ni se devuelve: solo viaja a la RPC.

type EstadoSolicitud = Database['public']['Enums']['estado_solicitud_folios'];

/** Paso del asistente que timbra los folios (irreversible). Mismo valor que la CLI. */
export const PASO_TIMBRAR = 'of_genera_folio';

/** Ruta del asistente de folios en el portal del ambiente (maullin o palena). */
export const RUTA_ASISTENTE = '/cvc_cgi/dte/';

/**
 * Los ÚNICOS pasos del asistente que la revisión deja salir al portal del ambiente: el
 * formulario inicial, el de tipo y cantidad y la confirmación (donde el SII fija el
 * rango). Todo lo demás de ese host se corta, en particular `of_genera_folio` (timbra)
 * y `of_genera_archivo` (descarga el CAF).
 */
export const PASOS_REVISION: readonly string[] = Object.freeze([
  'of_solicita_folios',
  'of_solicita_folios_dcto',
  'of_confirma_folio',
]);

/** Lo lanza el transporte de revisión en vez de enviar un paso que no está permitido. */
export class DetenidoAntesDeTimbrar extends Error {
  override name = 'DetenidoAntesDeTimbrar';
  constructor() {
    super('Revisión: solo salen los pasos del asistente anteriores a la orden de timbrar.');
  }
}

/**
 * Transporte de la revisión con el SII, por LISTA PERMITIDA (más estricto que el de la
 * CLI, que solo corta `of_genera_folio`): en el host del portal del ambiente solo pasan
 * los `PASOS_REVISION` bajo `/cvc_cgi/dte/`; cualquier otra ruta de ese host se corta
 * sin salir. El login en los hosts de autenticación (herculesr, zeusr) sigue pasando: ahí
 * no se timbra nada y `SolicitudFolios` ya exige que no salga de sii.cl. Si el SII
 * renombra un paso, la revisión falla (no timbra).
 */
export class TransporteSinTimbrar implements TransporteHttp {
  readonly #real: TransporteHttp;
  readonly #host: string;

  constructor(real: TransporteHttp, ambiente: AmbienteSii) {
    this.#real = real;
    this.#host = datosAmbiente(ambiente).host;
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const url = new URL(peticion.url);
    if (url.hostname === this.#host) {
      const paso = url.pathname.startsWith(RUTA_ASISTENTE)
        ? url.pathname.slice(RUTA_ASISTENTE.length)
        : null;
      if (paso === null || !PASOS_REVISION.includes(paso)) throw new DetenidoAntesDeTimbrar();
    }
    return this.#real.enviar(peticion);
  }
}

/** `true` si la causa (en cualquier nivel) es la orden de timbrar que no salió. */
export function detenidoAntesDeTimbrar(error: unknown): boolean {
  for (
    let causa: unknown = error instanceof Error ? error.cause : undefined;
    causa instanceof Error;
    causa = causa.cause
  ) {
    if (causa instanceof DetenidoAntesDeTimbrar) return true;
  }
  return false;
}

/** Estado y mensaje de la solicitud según el error de la librería (sin secretos). */
export function cierreDeError(error: unknown): {
  estado: EstadoSolicitud;
  mensaje: string;
  rango?: { folio_desde: number; folio_hasta: number };
} {
  const mensaje = error instanceof SiiError ? sanearTexto(error.message) : 'Error inesperado.';
  if (error instanceof FoliosSinCafError) {
    return {
      estado: 'incierta',
      mensaje,
      rango: { folio_desde: error.folioDesde, folio_hasta: error.folioHasta },
    };
  }
  if (error instanceof ErrorSolicitudFolios) return { estado: 'rechazada', mensaje };
  if (error instanceof ErrorTransporte) return { estado: 'error', mensaje };
  return { estado: 'error', mensaje };
}

export const MENSAJE_CAF_SIN_GUARDAR =
  'Se timbraron los folios, pero no pudimos guardar el CAF. No los vuelvas a pedir: baja el CAF desde «Folios ya autorizados» en el portal del SII y súbelo en Folios (CAF).';

/**
 * El CAF recién timbrado choca con uno ya cargado (23P01 de `registrar_caf`, trigger de
 * la 0011). Subirlo a mano también fallaría, así que el mensaje no lo propone.
 */
export function mensajeTraslapeTimbrado(
  timbrado: { desde: number; hasta: number },
  cargado: { desde: number; hasta: number } | null,
): string {
  const choque = cargado
    ? `chocan con el CAF de los folios ${textoRango(cargado.desde, cargado.hasta)} que ya estaba cargado`
    : 'chocan con otro CAF ya cargado del mismo tipo y ambiente';
  return `Se timbraron los folios ${textoRango(timbrado.desde, timbrado.hasta)}, pero ${choque}, así que no pudimos guardarlos. No los vuelvas a pedir: revisa los dos CAF en «Folios ya autorizados» del portal del SII y escríbenos a soporte.`;
}

const MENSAJE_REVISION_CON_CAF =
  'La revisión obtuvo un CAF, lo que no debería pasar sin timbrar. No vuelvas a pedir folios: revisa «Folios ya autorizados» en el portal del SII y, si se timbraron, baja el CAF y súbelo en Folios (CAF).';

export interface PeticionFolios {
  ambiente: AmbienteSii;
  tipoDte: number;
  cantidad: number;
  folioInicial?: number;
  certificado: CredencialesCertificado;
  rutEmpresa: string;
}

export type DesenlaceSolicitud =
  | { tipo: 'simulada'; solicitudId: string; desde: number; hasta: number }
  | { tipo: 'timbrada'; solicitudId: string; cafId: string; desde: number; hasta: number };

/** Lo que la función deja para quien llama aunque lance (el folio inicial que pide el SII). */
export interface SalidaSolicitud {
  folioSugerido?: string;
}

/**
 * Revisión o timbraje de folios en el SII. Corre DENTRO de `ejecutarOperacion` (lanza
 * para todo lo que no sea ok; la traducción a `resultado` la hace la operación).
 */
export async function solicitarEnSii(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  ctx: ContextoFolios,
  peticion: PeticionFolios,
  modo: { simular: boolean },
  { operacionId, agregarDetalle }: HerramientasOperacion,
  salida: SalidaSolicitud = {},
): Promise<DesenlaceSolicitud> {
  const { ambiente, tipoDte, cantidad, folioInicial, certificado } = peticion;
  const solicitud = await cliente
    .from('solicitudes_folios')
    .insert({
      organizacion_id: ctx.organizacionId,
      empresa_id: ctx.empresaId,
      certificado_id: certificado.certificadoId,
      ambiente,
      tipo_dte: tipoDte,
      cantidad,
      folio_inicial: folioInicial ?? null,
      confirmada: !modo.simular,
      estado: 'en_curso',
      solicitado_por: ctx.usuarioId,
    })
    .select('id')
    .single();
  if (solicitud.error || !solicitud.data) {
    throw fallaBase('registrar la solicitud de folios', solicitud.error);
  }
  const solicitudId = solicitud.data.id;
  await enlazarOperacion(cliente, ctx, operacionId, { solicitud_id: solicitudId });
  agregarDetalle({
    nivel: modo.simular ? 'revision' : 'timbrar',
    tipo_dte: tipoDte,
    cantidad,
    solicitud_id: solicitudId,
  });

  const cerrar = async (cambios: Database['public']['Tables']['solicitudes_folios']['Update']) => {
    const { error } = await cliente
      .from('solicitudes_folios')
      .update({ ...cambios, terminado_en: deps.reloj.ahora().toISOString() })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', solicitudId);
    if (error) console.warn(`folios: no se pudo cerrar la solicitud (código ${error.code})`);
  };

  await using transporteReal = deps.transporte();
  const transporte = modo.simular
    ? new TransporteSinTimbrar(transporteReal, ambiente)
    : transporteReal;
  const folios = deps.sii.folios({ transporte, reloj: deps.reloj, ambiente });
  let caf: Buffer;
  try {
    caf = await conSesionSii(
      deps,
      cliente,
      certificado,
      () => folios.autenticar(certificado.certificado),
      (sesion) =>
        folios.solicitar(
          sesion,
          peticion.rutEmpresa,
          tipoDte,
          cantidad,
          folioInicial !== undefined ? { folioInicial } : {},
        ),
      ambiente,
    );
  } catch (error) {
    if (modo.simular && error instanceof FoliosSinCafError && detenidoAntesDeTimbrar(error)) {
      await cerrar({
        estado: 'simulada',
        folio_desde: error.folioDesde,
        folio_hasta: error.folioHasta,
        mensaje: null,
      });
      agregarDetalle({ folio_desde: error.folioDesde, folio_hasta: error.folioHasta });
      return {
        tipo: 'simulada',
        solicitudId,
        desde: error.folioDesde,
        hasta: error.folioHasta,
      };
    }
    if (error instanceof FolioInicialRequeridoError) {
      salida.folioSugerido = /^\d+$/.test(error.folioSugerido) ? error.folioSugerido : '1';
    }
    const cierre = cierreDeError(error);
    await cerrar({ estado: cierre.estado, mensaje: cierre.mensaje, ...cierre.rango });
    throw error;
  }

  if (modo.simular) {
    // El transporte corta la orden de timbrar: un CAF aquí no debería existir nunca.
    await cerrar({ estado: 'incierta', mensaje: MENSAJE_REVISION_CON_CAF, ...rangoDelCaf(caf) });
    throw new ErrorIncierto(MENSAJE_REVISION_CON_CAF);
  }

  // Desde aquí los folios ya están timbrados: nada puede perder el CAF sin avisar.
  let datos: DatosCaf | null = null;
  let codigoRegistro: string | undefined;
  try {
    datos = leerDatosCaf(caf);
    const registro = await cliente.rpc('registrar_caf', {
      p_organizacion: ctx.organizacionId,
      p_empresa: ctx.empresaId,
      p_ambiente: ambiente,
      p_tipo_dte: datos.tipoDte,
      p_folio_desde: datos.desde,
      p_folio_hasta: datos.hasta,
      p_fecha_autorizacion: datos.fechaAutorizacion,
      p_idk: datos.idk,
      p_rut_emisor: datos.rutEmisor,
      p_razon_social: datos.razonSocial,
      // Texto Unicode (Vault guarda texto); `ArmadorBoleta` lo recibe igual.
      p_caf_xml: decodificarUtf8OIso(caf),
      p_solicitud: solicitudId,
    });
    if (registro.error || typeof registro.data !== 'string') {
      codigoRegistro = codigoPg(registro.error);
      throw fallaBase('registrar el CAF', registro.error);
    }
    agregarDetalle({ folio_desde: datos.desde, folio_hasta: datos.hasta });
    return {
      tipo: 'timbrada',
      solicitudId,
      cafId: registro.data,
      desde: datos.desde,
      hasta: datos.hasta,
    };
  } catch {
    const rango = rangoDelCaf(caf);
    if (codigoRegistro === '23P01' && datos) {
      // Traslape: el CAF timbrado choca con uno ya cargado. Sigue siendo incierto (los
      // folios ya se timbraron), pero subirlo tampoco serviría: se deja marcado en el
      // detalle de la operación para que la UI no lo proponga.
      const timbrado = { desde: datos.desde, hasta: datos.hasta };
      const cargado = await cafQueChoca(cliente, ctx, ambiente, datos).catch(() => null);
      const mensaje = mensajeTraslapeTimbrado(timbrado, cargado);
      await cerrar({
        estado: 'incierta',
        mensaje,
        folio_desde: datos.desde,
        folio_hasta: datos.hasta,
      });
      agregarDetalle({
        folio_desde: datos.desde,
        folio_hasta: datos.hasta,
        incierto_motivo: 'traslape',
        ...(cargado ? { traslape_desde: cargado.desde, traslape_hasta: cargado.hasta } : {}),
      });
      throw new ErrorIncierto(mensaje);
    }
    await cerrar({ estado: 'incierta', mensaje: MENSAJE_CAF_SIN_GUARDAR, ...rango });
    if (rango) agregarDetalle(rango);
    throw new ErrorIncierto(MENSAJE_CAF_SIN_GUARDAR);
  }
}

/** El CAF ya cargado (mismo tipo y ambiente) cuyo rango se cruza con el timbrado. */
async function cafQueChoca(
  cliente: ClienteServicio,
  ctx: ContextoFolios,
  ambiente: AmbienteSii,
  datos: Pick<DatosCaf, 'tipoDte' | 'desde' | 'hasta'>,
): Promise<{ desde: number; hasta: number } | null> {
  const cafs = await leerCafs(cliente, {
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    ambiente,
    tipoDte: datos.tipoDte,
  });
  const otro = cafs.find((c) => c.desde <= datos.hasta && datos.desde <= c.hasta);
  return otro ? { desde: otro.desde, hasta: otro.hasta } : null;
}
