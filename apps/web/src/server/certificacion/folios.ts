import 'server-only';
import {
  decodificarUtf8OIso,
  ErrorSolicitudFolios,
  ErrorTransporte,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  parsearDocumento,
  SiiError,
} from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearRut } from '@/lib/formatos';
import { ErrorIncierto, ErrorUso, sanearTexto } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import type { Database } from '../supabase/tipos';
import {
  AMBIENTE,
  cargarEmpresaPorCertificar,
  conSesionSii,
  ejecutar,
  enlazarOperacion,
  ensayar,
  errorDeEjecucion,
  etapaEntre,
  exigirProceso,
  fallaBase,
  ok,
  resumenCertificado,
  TIPO_BOLETA,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// Paso 3 (primera mitad): folios (CAF) de boleta para el set, en certificación (maullin),
// con paridad con `sii certificacion solicitar-folios`:
//   - tipo 39, cantidad = número de casos del set (5 si todavía no se descarga);
//   - certificado de un representante electrónico (`representante: true`);
//   - fila en `solicitudes_folios` (en_curso → timbrada / incierta / rechazada / error);
//   - el CAF va a Vault y a `cafs` con la RPC `registrar_caf` (migración 0008), que
//     también deja la solicitud `timbrada`;
//   - `FolioInicialRequeridoError` (primer timbraje) → `requiere.folioInicial` con el
//     valor que sugiere el SII (no se timbró nada);
//   - si el CAF se timbró pero no se pudo guardar → `incierto` (código 6 de la CLI): no
//     volver a pedirlos, bajar el CAF desde «Folios ya autorizados».
// El ensayo no sale al SII (la CLI sin `--confirmar` recorre el asistente hasta antes de
// timbrar; aquí el ensayo nunca sale a la red, PLAN-SAAS principio 3).
//
// El XML del CAF (con `<RSASK>`) nunca se registra: solo viaja a la RPC.

type EstadoSolicitud = Database['public']['Enums']['estado_solicitud_folios'];

/** Lo que se lee del `<DA>` de un CAF. Nunca la llave. */
export interface DatosCaf {
  rutEmisor: string;
  razonSocial: string;
  tipoDte: number;
  desde: number;
  hasta: number;
  fechaAutorizacion: string;
  idk: number;
}

/** Lee el `<DA>` de un CAF (UTF-8 o ISO-8859-1). Lanza `Error` sin el contenido. */
export function leerDatosCaf(caf: Uint8Array): DatosCaf {
  const doc = parsearDocumento(decodificarUtf8OIso(caf));
  const da = doc.getElementsByTagName('DA').item(0);
  const rng = da?.getElementsByTagName('RNG').item(0) ?? null;
  if (!da || !rng) throw new Error('El CAF no trae <DA> con <RNG>.');
  const campo = (padre: Element, nombre: string) =>
    (padre.getElementsByTagName(nombre).item(0)?.textContent ?? '').trim();
  const entero = (padre: Element, nombre: string) => {
    const valor = campo(padre, nombre);
    if (!/^[0-9]+$/.test(valor)) throw new Error(`El CAF no trae <${nombre}> entero.`);
    return Number(valor);
  };
  const fecha = campo(da, 'FA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('El CAF no trae <FA> válida.');
  return {
    rutEmisor: campo(da, 'RE'),
    razonSocial: campo(da, 'RS'),
    tipoDte: entero(da, 'TD'),
    desde: entero(rng, 'D'),
    hasta: entero(rng, 'H'),
    fechaAutorizacion: fecha,
    idk: entero(da, 'IDK'),
  };
}

export interface FoliosDisponibles {
  total: number;
  primero: { id: string; desde: number; hasta: number; siguiente: number } | null;
}

/** Folios libres de boleta en certificación, en los CAF activos (lo que usa `asignar_folio`). */
export async function foliosDisponibles(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<FoliosDisponibles> {
  const { data, error } = await cliente
    .from('cafs')
    .select('id, folio_desde, folio_hasta, siguiente_folio')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', AMBIENTE)
    .eq('tipo_dte', TIPO_BOLETA)
    .eq('estado', 'activo')
    .order('folio_desde', { ascending: true });
  if (error) throw fallaBase('leer los CAF de la empresa', error);
  const libres = data.filter((c) => c.siguiente_folio <= c.folio_hasta);
  const primero = libres[0];
  return {
    total: libres.reduce((suma, c) => suma + (c.folio_hasta - c.siguiente_folio + 1), 0),
    primero: primero
      ? {
          id: primero.id,
          desde: primero.folio_desde,
          hasta: primero.folio_hasta,
          siguiente: primero.siguiente_folio,
        }
      : null,
  };
}

/** Número de casos del set guardado (0 si todavía no se descarga). */
export async function contarCasos(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  procesoId: string,
) {
  const { count, error } = await cliente
    .from('set_pruebas_casos')
    .select('id', { count: 'exact', head: true })
    .eq('organizacion_id', ctx.organizacionId)
    .eq('proceso_id', procesoId);
  if (error) throw fallaBase('contar los casos del set', error);
  return count ?? 0;
}

async function preparar(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
  folioInicial: number | undefined,
) {
  if (folioInicial !== undefined && (!Number.isSafeInteger(folioInicial) || folioInicial < 1)) {
    throw new ErrorUso('El folio inicial tiene que ser un número entero mayor que 0.');
  }
  const empresa = await cargarEmpresaPorCertificar(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa === 'borrador') {
    throw new ErrorUso('Primero postula la empresa (paso 1).');
  }
  if (!etapaEntre(proceso.etapa, 'postulada', 'revision_solicitada')) {
    throw new ErrorUso(
      'La empresa ya está lista para declarar o autorizada: el set no necesita más folios.',
    );
  }
  const casos = await contarCasos(cliente, ctx, proceso.id);
  const cantidad = casos > 0 ? casos : 5;
  const disponibles = await foliosDisponibles(cliente, ctx);
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    representante: true,
  });
  return { empresa, proceso, cantidad, disponibles, certificado };
}

/** Estado y mensaje de la solicitud según el error de la librería (sin secretos). */
function cierreDeError(error: unknown): {
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

const MENSAJE_CAF_SIN_GUARDAR =
  'Se timbraron los folios, pero no pudimos guardar el CAF. No los vuelvas a pedir: baja el CAF desde «Folios ya autorizados» en el portal del SII y escríbenos a soporte para cargarlo.';

/** Pide folios de boleta (CAF) para el set en certificación (⚠️: timbra folios). */
export async function solicitarFoliosSet(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean; folioInicial?: number },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => preparar(cliente, ctx, credenciales, opciones.folioInicial);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      const avisos = [
        'Se timbran folios de certificación (IDK 100): sirven solo para el set, no en producción.',
        'El titular del certificado tiene que ser representante electrónico de la empresa.',
      ];
      if (p.disponibles.total >= p.cantidad && p.disponibles.primero) {
        avisos.unshift(
          `Ya tienes ${p.disponibles.total} folios de boleta disponibles en certificación (CAF del ${p.disponibles.primero.desde} al ${p.disponibles.primero.hasta}): alcanzan para el set y no hace falta pedir más.`,
        );
      }
      return {
        operacion: 'solicitar_folios',
        titulo: 'Pedir folios para el set de pruebas',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Tipo de documento', valor: `Boleta electrónica (${TIPO_BOLETA})` },
          { etiqueta: 'Cantidad', valor: String(p.cantidad) },
          ...(opciones.folioInicial !== undefined
            ? [{ etiqueta: 'Folio inicial', valor: String(opciones.folioInicial) }]
            : []),
          { etiqueta: 'Folios disponibles hoy', valor: String(p.disponibles.total) },
        ],
        avisos,
        textoConfirmar: 'Pedir folios',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  let folioSugerido: string | undefined;
  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'solicitar_folios', confirmada: true },
    async ({ operacionId, agregarDetalle }) => {
      const p = await prep();
      const solicitud = await cliente
        .from('solicitudes_folios')
        .insert({
          organizacion_id: ctx.organizacionId,
          empresa_id: ctx.empresaId,
          certificado_id: p.certificado.certificadoId,
          ambiente: AMBIENTE,
          tipo_dte: TIPO_BOLETA,
          cantidad: p.cantidad,
          folio_inicial: opciones.folioInicial ?? null,
          confirmada: true,
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
      agregarDetalle({ cantidad: p.cantidad, solicitud_id: solicitudId });

      const cerrar = async (
        cambios: Database['public']['Tables']['solicitudes_folios']['Update'],
      ) => {
        const { error } = await cliente
          .from('solicitudes_folios')
          .update({ ...cambios, terminado_en: deps.reloj.ahora().toISOString() })
          .eq('organizacion_id', ctx.organizacionId)
          .eq('id', solicitudId);
        if (error)
          console.warn(`certificacion: no se pudo cerrar la solicitud (código ${error.code})`);
      };

      await using transporte = deps.transporte();
      const folios = deps.sii.folios({ transporte, reloj: deps.reloj });
      let caf: Buffer;
      try {
        caf = await conSesionSii(
          deps,
          cliente,
          p.certificado,
          () => folios.autenticar(p.certificado.certificado),
          (sesion) =>
            folios.solicitar(
              sesion,
              p.empresa.rut,
              TIPO_BOLETA,
              p.cantidad,
              opciones.folioInicial !== undefined ? { folioInicial: opciones.folioInicial } : {},
            ),
        );
      } catch (error) {
        if (error instanceof FolioInicialRequeridoError) {
          folioSugerido = /^\d+$/.test(error.folioSugerido) ? error.folioSugerido : '1';
        }
        const cierre = cierreDeError(error);
        await cerrar({ estado: cierre.estado, mensaje: cierre.mensaje, ...cierre.rango });
        throw error;
      }

      // Desde aquí los folios ya están timbrados: nada puede perder el CAF sin avisar.
      try {
        const datos = leerDatosCaf(caf);
        const registro = await cliente.rpc('registrar_caf', {
          p_organizacion: ctx.organizacionId,
          p_empresa: ctx.empresaId,
          p_ambiente: AMBIENTE,
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
          throw fallaBase('registrar el CAF', registro.error);
        }
        agregarDetalle({ folio_desde: datos.desde, folio_hasta: datos.hasta });
        return { cafId: registro.data, desde: datos.desde, hasta: datos.hasta };
      } catch {
        await cerrar({ estado: 'incierta', mensaje: MENSAJE_CAF_SIN_GUARDAR });
        throw new ErrorIncierto(MENSAJE_CAF_SIN_GUARDAR);
      }
    },
  );
  if (!r.ok) {
    return errorDeEjecucion(
      r,
      folioSugerido ? { requiere: { folioInicial: { sugerido: folioSugerido } } } : {},
    );
  }
  return ok(
    {
      titulo: 'El SII timbró los folios',
      detalle: `Guardamos el CAF de boleta con los folios ${r.valor.desde} a ${r.valor.hasta}. El siguiente paso es enviar el set al SII.`,
    },
    r.operacionId,
  );
}
