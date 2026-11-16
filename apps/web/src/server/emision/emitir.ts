import 'server-only';
import {
  ArmadorBoleta,
  EnvioBoleta,
  ErrorTransporte,
  ErrorValidacion,
  NOMBRE_ARCHIVO_BOLETA,
  type RespuestaEnvioRest,
} from '@winex/certificacion';
import {
  type BorradorValido,
  calcularTotales,
  type DocumentoEmitido,
  type ResultadoEmision,
  type ResumenEmision,
} from '@/lib/emision';
import { ETIQUETA_AMBIENTE, enAmbiente, nombreTipoFolio, type TipoFolio } from '@/lib/folios';
import {
  formatearFecha,
  formatearMiles,
  formatearMonto,
  formatearRut,
  nombreTipoDte,
} from '@/lib/formatos';
import { enlazarOperacion, fallaBase, resumenCertificado } from '../certificacion/comun';
import { alertaDespuesDeAsignar } from '../folios/alertas';
import { AlmacenDocumentos } from '../sii/almacen';
import { ErrorIncierto, type MensajeError } from '../sii/errores';
import { ejecutarOperacion, type HerramientasOperacion } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import type { Json } from '../supabase/tipos';
import { guardarEnSesion } from './borradores';
import { type DependenciasEmision, resolverDependenciasEmision } from './dependencias';
import {
  errorBorradorCambio,
  errorCuota,
  errorFoliosAnulados,
  errorSinFolios,
  esErrorEmision,
  falloDeEjecucion,
  falloSinEjecutar,
} from './errores';
import { type Preparacion, prepararEmision } from './preparar';
import {
  type DteLeido,
  leerDte,
  nombresArchivos,
  numeroFolio,
  representarYEnviar,
} from './representacion';
import type { ContextoEmision, EntradaEmision } from './tipos';

// Emisión de una boleta desde el panel (PLAN-SAAS Fase 7), con paridad con
// `sii produccion emitir --confirmar` de la CLI:
//
//   ENSAYO: valida (empresa, ambiente, resolución, certificado, folios, cuota) y resume,
//   con el folio que se usaría, sin reservarlo: sin folio, sin red, sin filas (principio 3).
//
//   EMITIR (⚠️):
//     1. Valida lo mismo, antes de escribir nada.
//     2. Guarda el borrador con la SESIÓN (RLS: `puede_emitir`; receptor al catálogo).
//     3. Dentro de `ejecutarOperacion('emitir')`, con service_role filtrando por
//        organización, en un orden que no quema folios a la ligera:
//        token REST (si falla, nada se consumió) → `asignar_folio` → CAF de Vault →
//        `ArmadorBoleta` → DTE a Storage → `EnvioBoleta` → sobre a Storage → `envios` →
//        UN update del documento (`.eq('estado','borrador')`) con folio, TED, rutas,
//        totales y `estado = 'firmado'`.
//        - `23514` en ese update (0012: el folio se anuló entre medio): otro folio y se
//          vuelve a armar, hasta 3 intentos (el anulado ya está en `folios_anulados`).
//        - 0 filas (borrador borrado o ya emitido), la cuota del mes (`P0001` de
//          `tg_contar_uso_documento`) u otra falla antes de enviar: el folio va a
//          `folios_anulados` y `envios.error`; el documento sigue `borrador`.
//     4. `ClienteBoletaRest.enviarBoleta`:
//        - Track ID: `envios.track_id` (y `estado_sii` si es de subida), documento `enviado`.
//        - Error que deja la duda (todo salvo `ErrorValidacion` o HTTP < 500, misma regla
//          que `envioIncierto()` de la CLI): `envios.incierto` (el trigger deja el documento
//          `incierto`) y `ErrorIncierto`: NO se reemite a ciegas.
//        - HTTP 4xx o validación (el SII no la recibió): documento `anulado` y folio a
//          `folios_anulados`.
//        - Track ID recibido pero no guardado: `ErrorIncierto` con el Track ID.
//     5. Ya fuera de la operación: alerta del 15 % de folios, PDF carta y rollo a Storage
//        y correo al receptor. Si fallan, la emisión sigue `ok` con avisos.
//
// No usa `conBloqueoCertificado`: la emisión REST no abre sesiones AUT2000 y
// `asignar_folio` ya es atómico. Nada de secretos (CAF, RSASK, token, PEM, clave) va a
// `operaciones_sii.detalle`, a los mensajes ni a la consola: solo folios, ids y códigos.

/** Intentos de armado cuando el folio asignado se anuló en paralelo (`23514`). */
export const INTENTOS_FOLIO = 3;

/** Estados con que el SII responde a una subida en curso (se guardan; otros no). */
const ESTADOS_SUBIDA = ['REC', 'SOK', 'CRT', 'FOK', 'PRD', 'EPR'];

/** Si un error del envío deja la duda de si la boleta llegó (`envioIncierto()` de la CLI). */
export function envioIncierto(error: unknown): boolean {
  if (error instanceof ErrorValidacion) return false;
  if (error instanceof ErrorTransporte && error.status !== undefined && error.status < 500) {
    return false;
  }
  return true;
}

function campoPg(error: unknown, campo: 'code' | 'message'): string {
  if (error !== null && typeof error === 'object' && campo in error) {
    const v = (error as Record<string, unknown>)[campo];
    return typeof v === 'string' ? v : '';
  }
  return '';
}

/** `23514` de `tg_validar_documento` (0012): el folio está anulado. Otro `23514` es un CHECK. */
function esFolioAnulado(error: unknown): boolean {
  return campoPg(error, 'code') === '23514' && /anulad/i.test(campoPg(error, 'message'));
}

/** `P0001` de `tg_contar_uso_documento`: se alcanzó el límite de boletas del mes. */
function esCuota(error: unknown): { limite: number | null } | null {
  const mensaje = campoPg(error, 'message');
  if (campoPg(error, 'code') !== 'P0001' || !/l[íi]mite/i.test(mensaje)) return null;
  const n = /l[íi]mite de (\d+)/i.exec(mensaje)?.[1];
  return { limite: n ? Number(n) : null };
}

/** XML del CAF desde Vault (filtrado por organización). Nunca se registra. */
async function xmlCaf(cliente: ClienteServicio, organizacionId: string, cafId: string) {
  const { data, error } = await cliente
    .from('cafs')
    .select('caf_secret_id')
    .eq('organizacion_id', organizacionId)
    .eq('id', cafId)
    .maybeSingle();
  if (error || !data) throw fallaBase('leer el CAF', error);
  const secreto = await cliente.rpc('leer_secreto', { p_id: data.caf_secret_id });
  if (secreto.error || typeof secreto.data !== 'string' || secreto.data === '') {
    throw fallaBase('leer el CAF de Vault', secreto.error);
  }
  return secreto.data;
}

/** Detalles en la forma de `ArmadorBoleta` (precio bruto). */
function detallesBoleta(borrador: BorradorValido) {
  return borrador.lineas.map((l) => ({
    nombre: l.nombre,
    cantidad: l.cantidad,
    precio: l.precio,
    ...(l.exento ? { exento: true } : {}),
    ...(l.unidad ? { unidad: l.unidad } : {}),
  }));
}

// --- Ensayo -------------------------------------------------------------------------

function filasResumen(
  p: Preparacion,
  borrador: BorradorValido,
  totales: ReturnType<typeof calcularTotales>,
): ResumenEmision['filas'] {
  const n = borrador.lineas.length;
  return [
    { etiqueta: 'Empresa', valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})` },
    { etiqueta: 'Documento', valor: nombreTipoFolio(borrador.tipoDte) },
    { etiqueta: 'Ambiente', valor: ETIQUETA_AMBIENTE[borrador.ambiente] },
    { etiqueta: 'Receptor', valor: `${formatearRut(p.receptor.rut)} ${p.receptor.razonSocial}` },
    ...(p.receptor.correo ? [{ etiqueta: 'Correo del receptor', valor: p.receptor.correo }] : []),
    { etiqueta: 'Líneas', valor: n === 1 ? '1 línea' : `${n} líneas` },
    ...(totales.descuentoAplicado > 0
      ? [{ etiqueta: 'Descuento', valor: formatearMonto(totales.descuentoAplicado) }]
      : []),
    { etiqueta: 'Total', valor: formatearMonto(totales.total) },
    {
      etiqueta: 'Resolución',
      valor: `N.º ${p.resolucion.numero} del ${formatearFecha(p.resolucion.fecha)}`,
    },
    { etiqueta: 'Canal', valor: 'API REST de boletas del SII' },
  ];
}

async function resumenEnsayo(
  cliente: ClienteServicio,
  ctx: ContextoEmision,
  borrador: BorradorValido,
  p: Preparacion,
): Promise<ResumenEmision> {
  const totales = calcularTotales(borrador);
  const folio = p.folios.primero?.siguiente ?? null;
  const elFolio = folio === null ? 'un folio' : `el folio ${formatearMiles(folio)}`;
  const avisos =
    borrador.ambiente === 'produccion'
      ? [
          `Es un documento tributario real: al emitirla se usa ${elFolio} y se informa al SII. Una boleta emitida no se puede borrar.`,
        ]
      : [
          `Es una boleta de certificación: no tiene validez tributaria. Igual usa ${elFolio} del CAF de certificación.`,
        ];
  avisos.push('El folio queda usado aunque el SII rechace la boleta.');
  if (p.receptor.correo) avisos.push(`Le enviaremos el PDF a ${p.receptor.correo}.`);
  return {
    operacion: 'emitir',
    titulo: `Emitir ${nombreTipoDte(borrador.tipoDte).toLowerCase()} ${enAmbiente(borrador.ambiente)}`,
    ambiente: borrador.ambiente,
    certificado: await resumenCertificado(cliente, ctx, p.certificado),
    filas: filasResumen(p, borrador, totales),
    avisos,
    textoConfirmar: 'Emitir boleta',
    folioPrevisto: folio,
    totales,
  };
}

// --- Emisión ------------------------------------------------------------------------

interface Asignado {
  cafId: string;
  folio: number;
  /** Ya estaba en `folios_anulados` (el `23514`): no se vuelve a anular. */
  anulado: boolean;
  envioId: string | null;
}

/** Lo armado y firmado, listo para enviar. */
interface Armado {
  asignado: Asignado;
  leido: DteLeido;
  xmlPath: string;
  sobre: Buffer;
}

interface ValorEmision {
  documento: DocumentoEmitido;
  armado: Armado;
  trackId: string;
  preparacion: Preparacion;
}

/** Lo que la operación deja para armar el resultado aunque termine en error. */
interface Rastro {
  mensaje?: MensajeError;
  error?: unknown;
  documento?: DocumentoEmitido;
  /** Folio anulado antes de salir por una falla genérica (se agrega al mensaje). */
  folioAnulado?: number;
}

/**
 * Escrituras auxiliares de la operación con service_role. Nunca lanzan: corren dentro del
 * manejo de un error y no pueden taparlo (un `incierto` no puede terminar como `error`).
 */
function auxiliares(cliente: ClienteServicio, ctx: ContextoEmision, documentoId: string) {
  async function sinLanzar(
    paso: string,
    escribir: () => PromiseLike<{ error: { code: string } | null }>,
  ) {
    try {
      const { error } = await escribir();
      if (error) console.warn(`emision: no se pudo ${paso} (código ${error.code})`);
    } catch (error) {
      console.warn(`emision: falló ${paso}`, {
        tipo: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  async function cerrarEnvio(envioId: string | null, motivo: string): Promise<void> {
    if (!envioId) return;
    await sinLanzar('cerrar el envío', () =>
      cliente
        .from('envios')
        .update({ error: motivo })
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', envioId),
    );
  }

  async function marcarIncierto(envioId: string | null, motivo: string, soloSinTrack = false) {
    if (!envioId) return;
    await sinLanzar('marcar el envío incierto', () => {
      const consulta = cliente
        .from('envios')
        .update({ incierto: true, error: motivo })
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', envioId);
      // Con el Track ID ya guardado, el check de `envios` no admite `incierto`.
      return soloSinTrack ? consulta.is('track_id', null) : consulta;
    });
  }

  async function anularDocumento(): Promise<void> {
    await sinLanzar('anular el documento', () =>
      cliente
        .from('documentos')
        .update({ estado: 'anulado' })
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', documentoId),
    );
  }

  async function anularFolios(lista: readonly Asignado[], motivo: string): Promise<void> {
    await sinLanzar('anular los folios', () =>
      cliente.from('folios_anulados').insert(
        lista.map((a) => ({
          organizacion_id: ctx.organizacionId,
          caf_id: a.cafId,
          folio: a.folio,
          motivo,
          anulado_por: ctx.usuarioId,
        })),
      ),
    );
    for (const a of lista) await cerrarEnvio(a.envioId, motivo);
  }

  return { cerrarEnvio, marcarIncierto, anularDocumento, anularFolios };
}

/** La función de la operación: lanza para todo lo que no es `ok` (ver el encabezado). */
async function emitirEnSii(
  deps: DependenciasEmision,
  cliente: ClienteServicio,
  ctx: ContextoEmision,
  borrador: BorradorValido,
  documentoId: string,
  preparar: () => Promise<Preparacion>,
  { operacionId, agregarDetalle }: HerramientasOperacion,
  rastro: Rastro,
): Promise<ValorEmision> {
  const { ambiente, tipoDte } = borrador;
  const aux = auxiliares(cliente, ctx, documentoId);
  const documentoCon = (
    estado: DocumentoEmitido['estado'],
    folio: number,
    total: number,
    trackId: string | null,
  ): DocumentoEmitido => ({
    id: documentoId,
    tipoDte: tipoDte as TipoFolio,
    ambiente,
    folio,
    estado,
    total,
    trackId,
    conPdf: false,
    correoEnviado: false,
  });

  agregarDetalle({ documento_id: documentoId, tipo_dte: tipoDte });
  const p = await preparar();
  const rut = p.empresa.rut;
  const rutEnvia = p.certificado.rutTitular;
  const totales = calcularTotales(borrador);
  const almacen = new AlmacenDocumentos(cliente, ctx.organizacionId);

  await using transporte = deps.transporte();
  const rest = deps.rest(p.certificado.certificado, {
    ambiente,
    transporte,
    reloj: deps.reloj,
    tokenStore: deps.tokenStore(cliente),
  });

  // Token primero: si falla, no se consumió ningún folio.
  const token = await rest.obtenerToken(rut);

  const asignados: Asignado[] = [];
  let armado: Armado | undefined;
  let salio = false;
  let respuesta: RespuestaEnvioRest;
  try {
    const armador = new ArmadorBoleta(p.certificado.firma, { reloj: deps.reloj });
    while (!armado) {
      // Folio (atómico en la base, bloquea el CAF).
      const asignacion = await cliente.rpc('asignar_folio', {
        p_empresa: ctx.empresaId,
        p_ambiente: ambiente,
        p_tipo_dte: tipoDte,
      });
      const fila = asignacion.data?.[0];
      if (asignacion.error?.code === 'P0002') throw errorSinFolios(tipoDte, ambiente);
      if (asignacion.error || !fila) throw fallaBase('asignar un folio', asignacion.error);
      const asignado: Asignado = {
        cafId: fila.caf_id,
        folio: fila.folio,
        anulado: false,
        envioId: null,
      };
      asignados.push(asignado);
      agregarDetalle({ folio: asignado.folio, caf_id: asignado.cafId, intentos: asignados.length });

      // El DTE timbrado y firmado, y el sobre (local).
      const dte = armador.armar(
        {
          emisor: {
            rut,
            razonSocial: p.empresa.razon_social,
            giro: p.empresa.giro,
            direccion: p.empresa.direccion,
            comuna: p.empresa.comuna,
          },
          receptor: { rut: p.receptor.rut, razonSocial: p.receptor.razonSocial },
          folio: String(asignado.folio),
          tipoDte,
          detalles: detallesBoleta(borrador),
          ...(borrador.descuento && borrador.descuento.valor > 0
            ? { descuento: { tipo: borrador.descuento.tipo, valor: borrador.descuento.valor } }
            : {}),
        },
        await xmlCaf(cliente, ctx.organizacionId, asignado.cafId),
      );
      const firmadoEn = deps.reloj.ahora().toISOString();
      const leido = leerDte(dte);
      const nombres = nombresArchivos(tipoDte, asignado.folio);
      const xmlPath = await almacen.subirXml(
        { empresaId: ctx.empresaId, ambiente, archivo: nombres.dte },
        dte,
      );
      const sobre = new EnvioBoleta(
        p.certificado.firma,
        {
          rutEmisor: rut,
          rutEnvia,
          nroResol: p.resolucion.numero,
          fchResol: p.resolucion.fecha,
        },
        { reloj: deps.reloj },
      ).empaquetar([dte]);
      const rutaSobre = await almacen.subirXml(
        { empresaId: ctx.empresaId, ambiente, archivo: nombres.sobre },
        sobre,
      );

      // El envío (carátula con la resolución vigente del ambiente).
      const envio = await cliente
        .from('envios')
        .insert({
          organizacion_id: ctx.organizacionId,
          empresa_id: ctx.empresaId,
          ambiente,
          canal: 'rest',
          proposito: 'emision',
          rut_envia: rutEnvia,
          certificado_id: p.certificado.certificadoId,
          nro_resol: p.resolucion.numero,
          fch_resol: p.resolucion.fecha,
          tmst_firma: firmadoEn,
          nombre_archivo: NOMBRE_ARCHIVO_BOLETA,
          xml_path: rutaSobre,
        })
        .select('id')
        .single();
      if (envio.error || !envio.data) throw fallaBase('registrar el envío', envio.error);
      asignado.envioId = envio.data.id;
      await enlazarOperacion(cliente, ctx, operacionId, { envio_id: envio.data.id });

      // UN update del documento: deja de ser borrador y queda firmado.
      const actualizado = await cliente
        .from('documentos')
        .update({
          folio: asignado.folio,
          caf_id: asignado.cafId,
          ted_xml: leido.ted,
          timbrado_en: firmadoEn,
          firmado_en: firmadoEn,
          xml_path: xmlPath,
          mnt_neto: leido.neto,
          mnt_exe: leido.exento,
          iva: leido.iva,
          mnt_total: leido.total,
          descuento_aplicado: totales.descuentoAplicado,
          ...(leido.fechaEmision ? { fecha_emision: leido.fechaEmision } : {}),
          estado: 'firmado',
          envio_id: envio.data.id,
        })
        .eq('organizacion_id', ctx.organizacionId)
        .eq('empresa_id', ctx.empresaId)
        .eq('id', documentoId)
        .eq('estado', 'borrador')
        .select('id');
      if (actualizado.error && esFolioAnulado(actualizado.error)) {
        // Se anuló entre `asignar_folio` y aquí: ya está en `folios_anulados`.
        asignado.anulado = true;
        await aux.cerrarEnvio(
          asignado.envioId,
          `El folio ${asignado.folio} se anuló antes de usarlo.`,
        );
        if (asignados.length >= INTENTOS_FOLIO) {
          throw errorFoliosAnulados(asignados.map((a) => a.folio));
        }
        continue;
      }
      const cuota = actualizado.error ? esCuota(actualizado.error) : null;
      if (cuota) throw errorCuota(cuota.limite, asignado.folio);
      if (actualizado.error) throw fallaBase('registrar la boleta firmada', actualizado.error);
      if (actualizado.data.length === 0) throw errorBorradorCambio(asignado.folio);
      armado = { asignado, leido, xmlPath, sobre };
    }

    // Sale al SII.
    salio = true;
    respuesta = await rest.enviarBoleta(token, rut, rutEnvia, armado.sobre);
  } catch (error) {
    if (salio && armado && envioIncierto(error)) {
      const { folio } = armado.asignado;
      const motivo = `El envío de la boleta ${numeroFolio(folio)} falló después de salir: el SII pudo haberla recibido.`;
      await aux.marcarIncierto(armado.asignado.envioId, motivo);
      agregarDetalle({ incierto: true });
      rastro.documento = documentoCon('incierto', folio, armado.leido.total, null);
      rastro.mensaje = {
        titulo: 'No sabemos si el SII recibió la boleta',
        detalle: `La comunicación con el SII falló después de enviar la boleta ${numeroFolio(folio)}: pudo haber llegado. No la vuelvas a emitir a ciegas: revisa en el portal del SII si el folio ${formatearMiles(folio)} quedó recibido. La boleta quedó como incierta en Documentos.`,
      };
      throw new ErrorIncierto(
        `${motivo} No la vuelvas a emitir hasta revisar en el SII si el folio quedó recibido.`,
      );
    }
    if (salio && error instanceof ErrorTransporte && error.status === 401) {
      // El SII rechazó el token: el próximo intento pide uno nuevo.
      await rest.olvidarToken(rut).catch(() => undefined);
    }
    const pendientes = asignados.filter((a) => !a.anulado);
    if (pendientes.length > 0) {
      const motivo = salio
        ? 'El SII rechazó el envío de la boleta sin recibirla.'
        : 'La boleta no se alcanzó a enviar al SII.';
      if (salio && armado) {
        const { folio } = armado.asignado;
        await aux.anularDocumento();
        rastro.documento = documentoCon('anulado', folio, armado.leido.total, null);
        rastro.mensaje = {
          titulo: 'El SII no recibió la boleta',
          detalle: `El SII rechazó el envío y la boleta ${numeroFolio(folio)} quedó anulada; ese folio no se vuelve a usar. Revisa los datos y vuelve a emitirla: se usará un folio nuevo.`,
        };
      } else if (!esErrorEmision(error)) {
        rastro.folioAnulado = pendientes.at(-1)?.folio;
      }
      await aux.anularFolios(pendientes, motivo);
      agregarDetalle({ folios_anulados: pendientes.map((a) => a.folio) });
    }
    throw error;
  }

  // Con Track ID: llegó. Si no se puede guardar, es incierto para la app.
  const { asignado, leido } = armado;
  try {
    const conTrack = await cliente
      .from('envios')
      .update({
        track_id: respuesta.trackId,
        enviado_en: deps.reloj.ahora().toISOString(),
        respuesta_subida: JSON.parse(JSON.stringify(respuesta.json)) as Json,
        ...(ESTADOS_SUBIDA.includes(respuesta.estado) ? { estado_sii: respuesta.estado } : {}),
      })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', asignado.envioId ?? '');
    if (conTrack.error) throw fallaBase('guardar el Track ID', conTrack.error);
    const enviado = await cliente
      .from('documentos')
      .update({ estado: 'enviado' })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', documentoId)
      .eq('estado', 'firmado');
    if (enviado.error) throw fallaBase('marcar la boleta enviada', enviado.error);
  } catch {
    const texto = `El SII recibió la boleta ${numeroFolio(asignado.folio)} con el Track ID ${respuesta.trackId}, pero no pudimos guardarlo. No la vuelvas a emitir: anota el Track ID y escríbenos a soporte.`;
    await aux.marcarIncierto(asignado.envioId, texto, true);
    rastro.documento = documentoCon('incierto', asignado.folio, leido.total, respuesta.trackId);
    rastro.mensaje = { titulo: 'No sabemos si quedó registrada la boleta', detalle: texto };
    throw new ErrorIncierto(texto);
  }
  agregarDetalle({ track_id: respuesta.trackId });
  return {
    documento: documentoCon('enviado', asignado.folio, leido.total, respuesta.trackId),
    armado,
    trackId: respuesta.trackId,
    preparacion: p,
  };
}

/** Ensayo (sin folio ni red) o emisión ⚠️ (folio, firma, Storage, envío REST, PDF, correo). */
export async function emitirDocumento(
  ctx: ContextoEmision,
  entrada: EntradaEmision,
  dependencias?: Partial<DependenciasEmision>,
): Promise<ResultadoEmision> {
  const deps = resolverDependenciasEmision(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const { borrador } = entrada;
  const { ambiente, tipoDte } = borrador;
  const preparar = () => prepararEmision(cliente, ctx, borrador, credenciales, deps.reloj.ahora());

  if (entrada.nivel === 'ensayo') {
    try {
      return {
        tipo: 'ensayo',
        resumen: await resumenEnsayo(cliente, ctx, borrador, await preparar()),
      };
    } catch (error) {
      return falloSinEjecutar(error);
    }
  }

  // 1. Validación previa: un dato que falta no deja filas ni consume folios.
  try {
    await preparar();
  } catch (error) {
    return falloSinEjecutar(error);
  }

  // 2. El borrador con la sesión del usuario (RLS).
  let guardado: Awaited<ReturnType<typeof guardarEnSesion>>;
  try {
    guardado = await guardarEnSesion(await deps.sesion(), ctx, borrador, entrada.borradorId);
  } catch (error) {
    return falloSinEjecutar(error);
  }
  const documentoId = guardado.id;

  // 3 y 4. La operación con el SII.
  const rastro: Rastro = {};
  const r = await ejecutarOperacion<ValorEmision>(
    {
      cliente,
      organizacionId: ctx.organizacionId,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      operacion: 'emitir',
      ambiente,
      canal: 'rest',
      confirmada: true,
      documentoId,
      dependencias: deps.operacion,
    },
    async (herramientas) => {
      try {
        return await emitirEnSii(
          deps,
          cliente,
          ctx,
          borrador,
          documentoId,
          preparar,
          herramientas,
          rastro,
        );
      } catch (error) {
        rastro.error = error;
        throw error;
      }
    },
  );

  if (!r.ok) {
    let mensaje = rastro.mensaje;
    if (!mensaje && rastro.folioAnulado !== undefined) {
      mensaje = {
        titulo: r.mensaje.titulo,
        detalle: `${r.mensaje.detalle} El folio ${formatearMiles(rastro.folioAnulado)} quedó anulado; el borrador sigue guardado y al reintentar se usa un folio nuevo.`,
      };
    }
    return falloDeEjecucion(r, {
      ...(mensaje ? { mensaje } : {}),
      error: rastro.error,
      ...(rastro.documento ? { documento: rastro.documento } : {}),
    });
  }

  // 5. Después de la operación: alerta de folios, PDF y correo (nunca frenan el `ok`).
  const { armado, preparacion: p, trackId } = r.valor;
  const { folio, cafId } = armado.asignado;
  await alertaDespuesDeAsignar(
    deps,
    cliente,
    { organizacionId: ctx.organizacionId, empresaId: ctx.empresaId, ambiente, tipoDte },
    { cafId, folio },
  );
  const representacion = await representarYEnviar(
    deps,
    cliente,
    ctx,
    {
      id: documentoId,
      ambiente,
      tipoDte: tipoDte as TipoFolio,
      folio,
      xmlPath: armado.xmlPath,
      correo: p.receptor.correo,
      metadata: guardado.metadata,
      datos: {
        ambiente,
        tipoDte: tipoDte as TipoFolio,
        folio,
        fechaEmision: armado.leido.fechaEmision,
        emisor: {
          rut: p.empresa.rut,
          razonSocial: p.empresa.razon_social,
          giro: p.empresa.giro,
          direccion: p.empresa.direccion,
          comuna: p.empresa.comuna,
        },
        receptor: { rut: p.receptor.rut, razonSocial: p.receptor.razonSocial },
        lineas: armado.leido.lineas,
        totales: {
          neto: armado.leido.neto,
          exento: armado.leido.exento,
          iva: armado.leido.iva,
          total: armado.leido.total,
          descuentoAplicado: calcularTotales(borrador).descuentoAplicado,
        },
        resolucion: p.resolucion,
        tedXml: armado.leido.ted ?? '',
      },
    },
    { rut: p.empresa.rut, razonSocial: p.empresa.razon_social },
  );

  return {
    tipo: 'ok',
    mensaje: {
      titulo: `Emitimos la ${nombreTipoDte(tipoDte).toLowerCase()} ${numeroFolio(folio)}`,
      detalle: `${ambiente === 'certificacion' ? 'Es una boleta de certificación, sin validez tributaria. ' : ''}El SII la recibió con el Track ID ${trackId}. Su resultado (aceptada o rechazada) aparece en Documentos en unos minutos.`,
    },
    documento: {
      ...r.valor.documento,
      conPdf: Boolean(representacion.pdf?.carta || representacion.pdf?.rollo),
      correoEnviado: representacion.correo !== null,
    },
    operacionId: r.operacionId,
    ...(representacion.avisos.length > 0 ? { avisos: representacion.avisos } : {}),
  };
}
