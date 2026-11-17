import 'server-only';
import type { ResultadoConsultaEnvio } from '@/lib/seguimiento';
import type { MensajeError } from '../sii/errores';
import { ejecutarOperacion, type ResultadoEjecucion } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import { clienteEstado, consultarConRenovacion, rutDeEmpresa } from './consulta';
import { type DependenciasSeguimiento, resolverDependenciasSeguimiento } from './dependencias';
import {
  CLASIFICACIONES_FINALES,
  guardarRespuesta,
  type ResultadoGuardado,
  registrarFalla,
} from './persistencia';
import { COLUMNAS_ENVIO, type ContextoConsultaEnvio, type EnvioSeguimiento } from './tipos';

// «Consultar estado en el SII» del panel (Fase 8): un envío, a pedido. La Server Action ya
// verificó la membresía (`exigirMembresia`); aquí igual se lee el envío con service_role
// filtrando por `organizacion_id`, así que el de otra organización no existe.
//
//   - Incierto o sin Track ID → `sin_track_id` (no hay nada que consultar; nunca se
//     reenvía desde aquí).
//   - Ya con estado final (aceptado, con reparos o rechazado) → `final`. Un
//     `inconsistente` (EPR cuyos conteos no cuadran) SÍ se consulta: el SII puede
//     corregirlo, y no hay otra forma de cerrarlo desde el panel.
//   - Consultado hace menos de `SEGUNDOS_ENTRE_CONSULTAS` → lo guardado, sin salir al SII
//     (doble clic, varias pestañas o alguien insistiendo).
//   - Si no, una operación `consultar_envio` (con `envio_id`) en `operaciones_sii`: token
//     y consulta por el canal del envío, y `guardarRespuesta` igual que el cron.

/** Una consulta más seguida que esto devuelve lo guardado. */
export const SEGUNDOS_ENTRE_CONSULTAS = 30;

const MENSAJE_NO_ENCONTRADO: MensajeError = Object.freeze({
  titulo: 'No encontramos el envío',
  detalle: 'Puede que ya no exista o que sea de otra organización. Recarga la página.',
});

const MENSAJE_LECTURA: MensajeError = Object.freeze({
  titulo: 'No pudimos leer el envío',
  detalle: 'No se consultó nada en el SII. Inténtalo de nuevo en unos minutos.',
});

const MENSAJE_INCIERTO: MensajeError = Object.freeze({
  titulo: 'Este envío no tiene Track ID',
  detalle:
    'La comunicación con el SII falló después de enviarlo y no sabemos si llegó, así que no hay nada que consultar. Revisa en el portal del SII si el folio quedó recibido antes de volver a emitir.',
});

const MENSAJE_SIN_TRACK: MensajeError = Object.freeze({
  titulo: 'Este envío no llegó al SII',
  detalle:
    'No tiene Track ID porque falló antes de enviarse, así que no hay nada que consultar. Revisa el error del envío y vuelve a emitir el documento.',
});

const MENSAJE_RECIEN_FALLO: MensajeError = Object.freeze({
  titulo: 'Consultamos hace unos segundos y el SII no respondió',
  detalle:
    'Espera un minuto y vuelve a intentarlo. El seguimiento automático también lo consulta cada 5 minutos.',
});

const MENSAJE_SIN_DETALLE: MensajeError = Object.freeze({
  titulo: 'El SII procesó el envío con rechazos o reparos',
  detalle:
    'Su respuesta no dice cuáles documentos fueron, así que no cambiamos el estado de ninguno para no dar por aceptado uno rechazado. Revisa los rechazos y reparos de este envío en el portal del SII y vuelve a emitir solo las boletas rechazadas.',
});

function mensajeTransporte(trackId: string): MensajeError {
  return {
    titulo: 'No pudimos consultar el estado en el SII',
    detalle: `El SII no respondió a la consulta del Track ID ${trackId}. Inténtalo de nuevo en unos minutos; el seguimiento automático también lo consulta cada 5 minutos.`,
  };
}

function mensajeRespuesta(trackId: string): MensajeError {
  return {
    titulo: 'El SII no entregó el estado del envío',
    detalle: `Respondió algo que no pudimos leer. Inténtalo de nuevo en unos minutos; si sigue igual, revisa el Track ID ${trackId} en el portal del SII.`,
  };
}

function mensajeDeFalla(r: Exclude<ResultadoEjecucion<unknown>, { ok: true }>, trackId: string) {
  if (!r.ejecutada) return r.mensaje;
  if (r.resultado === 'transporte') return mensajeTransporte(trackId);
  if (r.resultado === 'rechazo_sii') return mensajeRespuesta(trackId);
  // config (certificado), uso, error: el mensaje de la capa ya dice qué hacer.
  return r.mensaje;
}

async function leerEnvio(cliente: ClienteServicio, ctx: ContextoConsultaEnvio) {
  const { data, error } = await cliente
    .from('envios')
    .select(COLUMNAS_ENVIO)
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.envioId)
    .maybeSingle();
  if (error) return { tipo: 'error' as const };
  return { tipo: 'ok' as const, envio: data as EnvioSeguimiento | null };
}

async function ultimaConsulta(cliente: ClienteServicio, envio: EnvioSeguimiento) {
  const { data } = await cliente
    .from('consultas_envio')
    .select('error')
    .eq('organizacion_id', envio.organizacion_id)
    .eq('envio_id', envio.id)
    .order('consultado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Consulta en el SII el estado de un envío de la organización y guarda la respuesta. */
export async function consultarEnvio(
  ctx: ContextoConsultaEnvio,
  dependencias?: Partial<DependenciasSeguimiento>,
): Promise<ResultadoConsultaEnvio> {
  const deps = resolverDependenciasSeguimiento(dependencias);
  const cliente = deps.servicio();

  const leido = await leerEnvio(cliente, ctx);
  if (leido.tipo === 'error') return { tipo: 'error', mensaje: { ...MENSAJE_LECTURA } };
  const envio = leido.envio;
  if (!envio) return { tipo: 'error', mensaje: { ...MENSAJE_NO_ENCONTRADO } };
  if (envio.incierto) return { tipo: 'sin_track_id', mensaje: { ...MENSAJE_INCIERTO } };
  const trackId = envio.track_id;
  if (!trackId) return { tipo: 'sin_track_id', mensaje: { ...MENSAJE_SIN_TRACK } };
  const clasificacion = envio.clasificacion ?? 'pendiente';
  if (CLASIFICACIONES_FINALES.includes(clasificacion)) return { tipo: 'final', clasificacion };

  const ahora = deps.reloj.ahora();
  if (envio.ultima_consulta_en) {
    const transcurrido = ahora.getTime() - Date.parse(envio.ultima_consulta_en);
    if (transcurrido >= 0 && transcurrido < SEGUNDOS_ENTRE_CONSULTAS * 1000) {
      const ultima = await ultimaConsulta(cliente, envio);
      if (ultima?.error) return { tipo: 'error', mensaje: { ...MENSAJE_RECIEN_FALLO } };
      return {
        tipo: 'consultado',
        estadoSii: envio.estado_sii,
        glosaSii: envio.glosa_sii,
        clasificacion,
        cambio: false,
      };
    }
  }

  const r = await ejecutarOperacion<ResultadoGuardado>(
    {
      cliente,
      organizacionId: envio.organizacion_id,
      empresaId: envio.empresa_id,
      usuarioId: ctx.usuarioId,
      operacion: 'consultar_envio',
      ambiente: envio.ambiente,
      canal: envio.canal,
      confirmada: true,
      envioId: envio.id,
      dependencias: deps.operacion,
    },
    async ({ agregarDetalle }) => {
      const secretos: string[] = [];
      try {
        const rut = await rutDeEmpresa(cliente, envio.organizacion_id, envio.empresa_id);
        const { certificado } = await deps.credenciales(cliente).certificadoDeEmpresa({
          organizacionId: envio.organizacion_id,
          empresaId: envio.empresa_id,
        });
        await using transporte = deps.transporte();
        const sii = clienteEstado(deps, envio.canal, certificado, {
          ambiente: envio.ambiente,
          transporte,
          tokenStore: deps.tokenStore(cliente),
          rutEmpresa: rut,
        });
        const token = { token: await sii.obtenerToken(), renovado: false };
        secretos.push(token.token);
        const respuesta = await consultarConRenovacion(sii, token, trackId);
        secretos.push(token.token);
        const guardado = await guardarRespuesta(cliente, envio, respuesta, ahora, secretos);
        agregarDetalle({
          estado: respuesta.estado,
          informados: respuesta.informados,
          ...(guardado.tipo === 'guardado'
            ? { cambio: guardado.cambio }
            : { [guardado.tipo]: true }),
        });
        return guardado;
      } catch (error) {
        // Toda falla del panel queda en la bitácora del envío (contrato de la Fase 8).
        await registrarFalla(cliente, envio, error, ahora, secretos);
        throw error;
      }
    },
  );

  if (!r.ok) return { tipo: 'error', mensaje: mensajeDeFalla(r, trackId) };
  if (r.valor.tipo === 'sin_detalle') return { tipo: 'error', mensaje: { ...MENSAJE_SIN_DETALLE } };
  // Otra consulta (el cron) lo cerró mientras tanto: lo guardado manda.
  if (r.valor.tipo === 'ya_final') return { tipo: 'final', clasificacion: r.valor.clasificacion };
  return {
    tipo: 'consultado',
    estadoSii: r.valor.estadoSii,
    glosaSii: r.valor.glosaSii,
    clasificacion: r.valor.clasificacion,
    cambio: r.valor.cambio,
  };
}
