import 'server-only';
import {
  ArmadorBoleta,
  type DetalleBoleta,
  decodificarUtf8OIso,
  EnvioBoleta,
  ErrorTransporte,
  type EstadoEnvioRest,
  NOMBRE_ARCHIVO_BOLETA,
  parsearDocumento,
  SiiError,
} from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearFecha, formatearRut } from '@/lib/formatos';
import { AlmacenDocumentos } from '../sii/almacen';
import { conBloqueoCertificado } from '../sii/bloqueos';
import { ErrorConfig, ErrorIncierto, ErrorUso, sanearTexto } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import type { Json, Tables, TablesInsert } from '../supabase/tipos';
import {
  AMBIENTE,
  actualizarProceso,
  type CambioEtapa,
  cargarEmpresa,
  ejecutar,
  enlazarOperacion,
  ensayar,
  errorDeEjecucion,
  errorSinEjecutar,
  exigirProceso,
  fallaBase,
  ok,
  resumenCertificado,
  TIPO_BOLETA,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import { foliosDisponibles } from './folios';
import { notificarCambioEtapa } from './notificar';
import { type BloqueoEnvio, bloqueoEnvioSet } from './operaciones';
import type { ContextoCertificacion } from './tipos';

// Paso 3 (segunda mitad): envío del set de pruebas por la API REST (decisión D7) y
// consulta de su estado, con paridad con `sii certificacion enviar-set --canal rest` y
// `estado-envio`:
//   - un folio por caso con `asignar_folio` (atómico, bloquea el CAF);
//   - cada boleta con `ArmadorBoleta` (emisor de `empresas`, receptor 66666666-6
//     «Cliente General», CodRef SET y RazonRef CASO-N), su XML a Storage y su fila en
//     `documentos` (origen `set_pruebas`, `caso_set`);
//   - el sobre con `EnvioBoleta.empaquetar` (carátula con la resolución de
//     certificación), su fila en `envios` (propósito `set_pruebas`, canal rest) y la
//     subida con `ClienteBoletaRest.enviarBoleta`;
//   - con Track ID: etapa `set_enviado`, `envio_set_id`;
//   - `ErrorTransporte` después de salir: no se sabe si llegó → `envios.incierto` (el
//     trigger deja los documentos en `incierto`) y resultado `incierto` (no se reenvía
//     hasta revisarlo, ver operaciones.ts);
//   - una falla antes de salir (o un rechazo del SII sin Track ID) con folios ya
//     asignados: los folios van a `folios_anulados` y los documentos quedan `anulado`.

export const RECEPTOR_SET = Object.freeze({ rut: '66666666-6', razonSocial: 'Cliente General' });

type FilaCaso = Pick<
  Tables<'set_pruebas_casos'>,
  'id' | 'numero_caso' | 'tipo_dte' | 'detalles' | 'referencia_codigo' | 'referencia_razon'
>;

interface CasoListo {
  fila: FilaCaso;
  detalles: DetalleBoleta[];
}

/** Los detalles guardados del caso, con la forma que espera `ArmadorBoleta`. */
function detallesDe(caso: FilaCaso): DetalleBoleta[] {
  const crudos = caso.detalles;
  if (!Array.isArray(crudos) || crudos.length === 0) {
    throw new ErrorConfig(
      `El ${caso.referencia_razon} del set guardado no trae detalles. Vuelve a descargar el set.`,
    );
  }
  return crudos.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (
      typeof o.nombre !== 'string' ||
      typeof o.cantidad !== 'number' ||
      typeof o.precio !== 'number'
    ) {
      throw new ErrorConfig(
        `El ${caso.referencia_razon} del set guardado tiene un detalle ilegible. Vuelve a descargar el set.`,
      );
    }
    return {
      nombre: o.nombre,
      cantidad: o.cantidad,
      precio: o.precio,
      ...(o.exento === true ? { exento: true } : {}),
      ...(typeof o.unidad === 'string' && o.unidad !== '' ? { unidad: o.unidad } : {}),
    };
  });
}

async function cargarCasos(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  procesoId: string,
): Promise<CasoListo[]> {
  const { data, error } = await cliente
    .from('set_pruebas_casos')
    .select('id, numero_caso, tipo_dte, detalles, referencia_codigo, referencia_razon')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('proceso_id', procesoId)
    .order('numero_caso', { ascending: true });
  if (error) throw fallaBase('leer los casos del set', error);
  return data.map((fila) => ({ fila, detalles: detallesDe(fila) }));
}

async function cargarResolucion(cliente: ClienteServicio, ctx: ContextoCertificacion) {
  const { data, error } = await cliente
    .from('resoluciones')
    .select('numero, fecha')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', AMBIENTE)
    .eq('vigente', true)
    .maybeSingle();
  if (error) throw fallaBase('leer la resolución de certificación', error);
  if (!data) {
    throw new ErrorConfig(
      'Falta la resolución de certificación de la empresa (número 0 y la fecha de la postulación). Regístrala en Configuración → Empresas.',
    );
  }
  return data;
}

async function cargarEnvio(cliente: ClienteServicio, ctx: ContextoCertificacion, envioId: string) {
  const { data, error } = await cliente
    .from('envios')
    .select('*')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw fallaBase('leer el envío del set', error);
  return data;
}

async function prepararEnvio(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
) {
  const empresa = await cargarEmpresa(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa === 'borrador' || proceso.etapa === 'postulada') {
    throw new ErrorUso('Primero descarga el set de pruebas (paso 2).');
  }
  if (proceso.etapa !== 'set_descargado' && proceso.etapa !== 'set_enviado') {
    throw new ErrorUso('El SII ya aceptó el set: no hace falta volver a enviarlo.');
  }
  const casos = await cargarCasos(cliente, ctx, proceso.id);
  if (casos.length === 0) {
    throw new ErrorUso('El set guardado no tiene casos. Vuelve a descargar el set de pruebas.');
  }
  const resolucion = await cargarResolucion(cliente, ctx);
  const disponibles = await foliosDisponibles(cliente, ctx);
  if (disponibles.total < casos.length) {
    throw new ErrorConfig(
      `Faltan folios: el set necesita ${casos.length} y hay ${disponibles.total} disponibles. Pide folios para el set y vuelve a intentarlo.`,
    );
  }
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  const anterior = proceso.envio_set_id
    ? await cargarEnvio(cliente, ctx, proceso.envio_set_id)
    : null;
  return { empresa, proceso, casos, resolucion, disponibles, certificado, anterior };
}

/** XML del CAF desde Vault (filtrado por organización). Nunca se registra. */
async function xmlCaf(cliente: ClienteServicio, ctx: ContextoCertificacion, cafId: string) {
  const { data, error } = await cliente
    .from('cafs')
    .select('caf_secret_id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', cafId)
    .maybeSingle();
  if (error || !data) throw fallaBase('leer el CAF', error);
  const secreto = await cliente.rpc('leer_secreto', { p_id: data.caf_secret_id });
  if (secreto.error || typeof secreto.data !== 'string' || secreto.data === '') {
    throw new ErrorConfig('No pudimos leer el CAF guardado. Vuelve a pedir folios para el set.');
  }
  return secreto.data;
}

/** Totales, fecha, TED y líneas de un DTE ya armado (lo que escribió la librería). */
function leerDte(dte: Buffer) {
  const doc = parsearDocumento(decodificarUtf8OIso(dte));
  const texto = (padre: Document | Element, etiqueta: string) =>
    (padre.getElementsByTagName(etiqueta).item(0)?.textContent ?? '').trim();
  const entero = (padre: Document | Element, etiqueta: string) => {
    const n = Number(texto(padre, etiqueta));
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const lineas: Omit<TablesInsert<'documento_detalles'>, 'documento_id' | 'organizacion_id'>[] = [];
  const nodos = doc.getElementsByTagName('Detalle');
  for (let i = 0; i < nodos.length; i++) {
    const d = nodos.item(i);
    if (!d) continue;
    const unidad = texto(d, 'UnmdItem');
    lineas.push({
      nro_linea: entero(d, 'NroLinDet') || i + 1,
      nombre: texto(d, 'NmbItem'),
      cantidad: Number(texto(d, 'QtyItem') || '1'),
      precio: Number(texto(d, 'PrcItem') || '0'),
      monto_item: entero(d, 'MontoItem'),
      exento: texto(d, 'IndExe') === '1',
      ...(unidad !== '' ? { unidad } : {}),
    });
  }
  return {
    fechaEmision: texto(doc, 'FchEmis'),
    neto: entero(doc, 'MntNeto'),
    exento: entero(doc, 'MntExe'),
    iva: entero(doc, 'IVA'),
    total: entero(doc, 'MntTotal'),
    ted: /<TED version="1\.0">[\s\S]*?<\/TED>/.exec(dte.toString('latin1'))?.[0] ?? null,
    lineas,
  };
}

interface Asignado {
  caso: CasoListo;
  cafId: string;
  folio: number;
}

/** Folios asignados y no usados → `folios_anulados`; documentos → `anulado`. Nunca lanza. */
async function anularAsignados(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  asignados: readonly Asignado[],
  documentos: readonly string[],
  envioId: string | null,
  motivo: string,
): Promise<void> {
  try {
    if (documentos.length > 0) {
      const { error } = await cliente
        .from('documentos')
        .update({ estado: 'anulado' })
        .eq('organizacion_id', ctx.organizacionId)
        .in('id', [...documentos]);
      if (error)
        console.warn(`certificacion: no se pudieron anular los documentos (código ${error.code})`);
    }
    if (asignados.length > 0) {
      const { error } = await cliente.from('folios_anulados').insert(
        asignados.map((a) => ({
          organizacion_id: ctx.organizacionId,
          caf_id: a.cafId,
          folio: a.folio,
          motivo,
          anulado_por: ctx.usuarioId,
        })),
      );
      if (error)
        console.warn(`certificacion: no se pudieron anular los folios (código ${error.code})`);
    }
    if (envioId) {
      const { error } = await cliente
        .from('envios')
        .update({ error: motivo })
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', envioId);
      if (error) console.warn(`certificacion: no se pudo cerrar el envío (código ${error.code})`);
    }
  } catch (error) {
    console.warn('certificacion: falló la anulación de folios', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
}

function rangoFolios(asignados: readonly Asignado[]): string {
  const folios = asignados.map((a) => a.folio).sort((a, b) => a - b);
  if (folios.length === 0) return '';
  return folios.length === 1
    ? `el folio ${folios[0]}`
    : `los folios ${folios[0]} a ${folios.at(-1)}`;
}

/** Estados con que el SII responde a una subida en curso (se guardan; otros no). */
const ESTADOS_SUBIDA = ['REC', 'SOK', 'CRT', 'FOK', 'PRD', 'EPR'];

/** Fecha del SII con zona horaria explícita, o null (sin zona no se sabe el instante). */
function fechaConZona(valor: string): string | null {
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(valor.trim())) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Arma y envía el set de pruebas por la API REST (⚠️: consume folios). */
export async function enviarSet(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => prepararEnvio(cliente, ctx, credenciales);

  // Un envío anterior incierto sin revisar (o uno en curso) bloquea, también el ensayo.
  let bloqueo: Awaited<ReturnType<typeof bloqueoEnvioSet>>;
  try {
    bloqueo = await bloqueoEnvioSet(cliente, ctx, deps.reloj.ahora());
  } catch (error) {
    return errorSinEjecutar(error);
  }
  if (bloqueo) {
    return {
      tipo: 'error',
      mensaje: bloqueo.mensaje,
      motivo: bloqueo.motivo,
      operacionId: null,
      operacionPendienteId: bloqueo.operacionPendienteId,
    };
  }

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      const desde = p.disponibles.primero?.siguiente ?? 0;
      const avisos = [
        `Se usan ${p.casos.length} folios de certificación (uno por caso): quedan usados aunque el SII rechace el set.`,
      ];
      if (p.anterior?.track_id) {
        avisos.push(
          `Ya enviaste el set (Track ID ${p.anterior.track_id}). Reenviarlo usa folios nuevos; pide la revisión con el Track ID del envío aceptado.`,
        );
      }
      return {
        operacion: 'enviar_set',
        titulo: 'Enviar el set de pruebas al SII',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Casos', valor: p.casos.map((c) => c.fila.referencia_razon).join(', ') },
          {
            etiqueta: 'Folios',
            valor: `${p.casos.length} folios de boleta (${TIPO_BOLETA}) desde el ${desde}`,
          },
          {
            etiqueta: 'Receptor',
            valor: `${formatearRut(RECEPTOR_SET.rut)} ${RECEPTOR_SET.razonSocial}`,
          },
          {
            etiqueta: 'Resolución',
            valor: `N.º ${p.resolucion.numero} del ${formatearFecha(p.resolucion.fecha)}`,
          },
          { etiqueta: 'Canal', valor: 'API REST de boletas del SII' },
        ],
        avisos,
        textoConfirmar: 'Enviar el set',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const enviarConfirmado = () =>
    ejecutar(
      deps,
      cliente,
      ctx,
      { operacion: 'enviar_set', confirmada: true, canal: 'rest' },
      async ({ operacionId, agregarDetalle }) => {
        const p = await prep();
        const rut = p.empresa.rut;
        const rutEnvia = p.certificado.rutTitular;
        const asignados: Asignado[] = [];
        const documentos: string[] = [];
        let envioId: string | null = null;
        let salio = false;

        await using transporte = deps.transporte();
        let trackId: string;
        let estadoSubida: string;
        let respuestaSubida: Json;
        try {
          // 1. Un folio por caso (atómico en la base).
          for (const caso of p.casos) {
            const { data, error } = await cliente.rpc('asignar_folio', {
              p_empresa: ctx.empresaId,
              p_ambiente: AMBIENTE,
              p_tipo_dte: caso.fila.tipo_dte,
            });
            const fila = data?.[0];
            if (error?.code === 'P0002') {
              throw new ErrorConfig(
                'Se acabaron los folios del CAF. Pide folios para el set y vuelve a intentarlo.',
              );
            }
            if (error || !fila) throw fallaBase('asignar un folio', error);
            asignados.push({ caso, cafId: fila.caf_id, folio: fila.folio });
          }
          agregarDetalle({ folios: asignados.map((a) => a.folio) });

          // 2. Las boletas y el sobre (local).
          const cafs = new Map<string, string>();
          for (const cafId of new Set(asignados.map((a) => a.cafId))) {
            cafs.set(cafId, await xmlCaf(cliente, ctx, cafId));
          }
          const armador = new ArmadorBoleta(p.certificado.firma, { reloj: deps.reloj });
          const emisor = {
            rut,
            razonSocial: p.empresa.razon_social,
            giro: p.empresa.giro,
            direccion: p.empresa.direccion,
            comuna: p.empresa.comuna,
          };
          const dtes = asignados.map((a) =>
            armador.armar(
              {
                emisor,
                receptor: { ...RECEPTOR_SET },
                folio: String(a.folio),
                detalles: a.caso.detalles,
                tipoDte: a.caso.fila.tipo_dte,
                referencia: {
                  codigo: a.caso.fila.referencia_codigo,
                  razon: a.caso.fila.referencia_razon,
                },
              },
              cafs.get(a.cafId) ?? '',
            ),
          );
          const firmadoEn = deps.reloj.ahora().toISOString();
          const sobre = new EnvioBoleta(
            p.certificado.firma,
            {
              rutEmisor: rut,
              rutEnvia,
              nroResol: p.resolucion.numero,
              fchResol: p.resolucion.fecha,
            },
            { reloj: deps.reloj },
          ).empaquetar(dtes);

          // 3. El envío, los XML y los documentos.
          const envio = await cliente
            .from('envios')
            .insert({
              organizacion_id: ctx.organizacionId,
              empresa_id: ctx.empresaId,
              ambiente: AMBIENTE,
              canal: 'rest',
              proposito: 'set_pruebas',
              rut_envia: rutEnvia,
              certificado_id: p.certificado.certificadoId,
              nro_resol: p.resolucion.numero,
              fch_resol: p.resolucion.fecha,
              tmst_firma: firmadoEn,
              nombre_archivo: NOMBRE_ARCHIVO_BOLETA,
            })
            .select('id')
            .single();
          if (envio.error || !envio.data)
            throw fallaBase('registrar el envío del set', envio.error);
          const idEnvio = envio.data.id;
          envioId = idEnvio;
          await enlazarOperacion(cliente, ctx, operacionId, { envio_id: idEnvio });

          const almacen = new AlmacenDocumentos(cliente, ctx.organizacionId);
          const filas: TablesInsert<'documentos'>[] = [];
          const lineasPorFolio = new Map<number, ReturnType<typeof leerDte>['lineas']>();
          for (const [i, a] of asignados.entries()) {
            const dte = dtes[i] as Buffer;
            const ruta = await almacen.subirXml(
              {
                empresaId: ctx.empresaId,
                ambiente: AMBIENTE,
                archivo: `DTE-${a.caso.fila.tipo_dte}-F${a.folio}.xml`,
              },
              dte,
            );
            const leido = leerDte(dte);
            lineasPorFolio.set(a.folio, leido.lineas);
            filas.push({
              organizacion_id: ctx.organizacionId,
              empresa_id: ctx.empresaId,
              ambiente: AMBIENTE,
              tipo_dte: a.caso.fila.tipo_dte,
              folio: a.folio,
              caf_id: a.cafId,
              ...(leido.fechaEmision ? { fecha_emision: leido.fechaEmision } : {}),
              receptor_rut: RECEPTOR_SET.rut,
              receptor_razon_social: RECEPTOR_SET.razonSocial,
              mnt_neto: leido.neto,
              mnt_exe: leido.exento,
              iva: leido.iva,
              mnt_total: leido.total,
              referencia_codigo: a.caso.fila.referencia_codigo,
              referencia_razon: a.caso.fila.referencia_razon,
              ted_xml: leido.ted,
              timbrado_en: firmadoEn,
              firmado_en: firmadoEn,
              xml_path: ruta,
              estado: 'firmado',
              envio_id: idEnvio,
              origen: 'set_pruebas',
              caso_set: a.caso.fila.numero_caso,
              creado_por: ctx.usuarioId,
            });
          }
          const rutaSobre = await almacen.subirXml(
            {
              empresaId: ctx.empresaId,
              ambiente: AMBIENTE,
              archivo: `EnvioBOLETA-set-${idEnvio}.xml`,
            },
            sobre,
          );
          const insertados = await cliente.from('documentos').insert(filas).select('id, folio');
          if (insertados.error || !insertados.data) {
            throw fallaBase('registrar las boletas del set', insertados.error);
          }
          documentos.push(...insertados.data.map((d) => d.id));
          const idPorFolio = new Map(insertados.data.map((d) => [d.folio, d.id] as const));

          // Las líneas son informativas: si no entran, el envío sigue.
          const lineas = insertados.data.flatMap((d) =>
            (lineasPorFolio.get(d.folio ?? 0) ?? []).map((l) => ({
              ...l,
              organizacion_id: ctx.organizacionId,
              documento_id: d.id,
            })),
          );
          if (lineas.length > 0) {
            const { error } = await cliente.from('documento_detalles').insert(lineas);
            if (error)
              console.warn(`certificacion: no se guardaron las líneas (código ${error.code})`);
          }
          for (const a of asignados) {
            const { error } = await cliente
              .from('set_pruebas_casos')
              .update({ documento_id: idPorFolio.get(a.folio) ?? null })
              .eq('organizacion_id', ctx.organizacionId)
              .eq('id', a.caso.fila.id);
            if (error) throw fallaBase('enlazar los casos del set', error);
          }
          const conRuta = await cliente
            .from('envios')
            .update({ xml_path: rutaSobre })
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', idEnvio);
          if (conRuta.error) throw fallaBase('guardar el sobre del set', conRuta.error);

          // 4. Token y subida (sale al SII).
          const rest = deps.sii.rest(p.certificado.certificado, {
            transporte,
            reloj: deps.reloj,
            tokenStore: deps.tokenStore(cliente),
          });
          const token = await rest.obtenerToken(rut);
          salio = true;
          const respuesta = await rest.enviarBoleta(token, rut, rutEnvia, sobre);
          trackId = respuesta.trackId;
          estadoSubida = respuesta.estado;
          respuestaSubida = JSON.parse(JSON.stringify(respuesta.json)) as Json;
        } catch (error) {
          const rango = rangoFolios(asignados);
          if (salio && error instanceof ErrorTransporte) {
            const motivo = `La subida del set falló después de enviarse: el SII pudo haberla recibido (${rango}).`;
            if (envioId) {
              const { error: e } = await cliente
                .from('envios')
                .update({ incierto: true, error: motivo })
                .eq('organizacion_id', ctx.organizacionId)
                .eq('id', envioId);
              if (e)
                console.warn(
                  `certificacion: no se pudo marcar el envío incierto (código ${e.code})`,
                );
              // Enlazado al proceso (sin cambiar la etapa) para que el asistente lo muestre
              // como el último envío del set y avise que no se sabe si llegó.
              const { error: e2 } = await cliente
                .from('procesos_certificacion')
                .update({ envio_set_id: envioId })
                .eq('organizacion_id', ctx.organizacionId)
                .eq('id', p.proceso.id);
              if (e2)
                console.warn(
                  `certificacion: no se pudo enlazar el envío incierto al proceso (código ${e2.code})`,
                );
            }
            agregarDetalle({ incierto: true });
            throw new ErrorIncierto(
              `${motivo} No reenvíes el set hasta revisar los envíos de la empresa en el portal del SII; después márcalo como revisado.`,
            );
          }
          if (asignados.length > 0) {
            const motivo = salio
              ? 'El SII rechazó la subida del set sin entregar un Track ID.'
              : 'El set no se alcanzó a enviar al SII.';
            await anularAsignados(cliente, ctx, asignados, documentos, envioId, motivo);
            agregarDetalle({ folios_anulados: asignados.length });
          }
          throw error;
        }

        // 5. Con Track ID: el envío llegó. Si no se puede guardar, es incierto para la app.
        try {
          const actualizado = await cliente
            .from('envios')
            .update({
              track_id: trackId,
              enviado_en: deps.reloj.ahora().toISOString(),
              respuesta_subida: respuestaSubida,
              ...(ESTADOS_SUBIDA.includes(estadoSubida) ? { estado_sii: estadoSubida } : {}),
            })
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', envioId ?? '');
          if (actualizado.error) throw fallaBase('guardar el Track ID', actualizado.error);
          const enviados = await cliente
            .from('documentos')
            .update({ estado: 'enviado' })
            .eq('organizacion_id', ctx.organizacionId)
            .eq('envio_id', envioId ?? '')
            .eq('estado', 'firmado');
          if (enviados.error) throw fallaBase('marcar las boletas enviadas', enviados.error);
          const cambio = await actualizarProceso(cliente, ctx, p.proceso, {
            etapa: 'set_enviado',
            envio_set_id: envioId,
          });
          agregarDetalle({ track_id: trackId });
          return { trackId, cambio, casos: p.casos.length };
        } catch {
          throw new ErrorIncierto(
            `El SII recibió el set (Track ID ${trackId}), pero no pudimos guardarlo. No reenvíes el set: anota el Track ID y escríbenos a soporte.`,
          );
        }
      },
    );

  // Dos envíos simultáneos pasarían los dos el control de arriba (consulta e insert no
  // son atómicos y `enviar_set` no está en el índice único de la 0007): se serializan
  // con el bloqueo del certificado y el control se repite ya adentro. El segundo ve la
  // fila del primero cerrada: si quedó incierta, no envía.
  let r: Awaited<ReturnType<typeof enviarConfirmado>> | { bloqueado: BloqueoEnvio };
  try {
    r = await conBloqueoCertificado(
      cliente,
      { certificadoId: previo.valor.certificado.certificadoId, ambiente: AMBIENTE },
      async () => {
        const otra = await bloqueoEnvioSet(cliente, ctx, deps.reloj.ahora());
        return otra ? { bloqueado: otra } : enviarConfirmado();
      },
      deps.bloqueo,
    );
  } catch (error) {
    return errorSinEjecutar(error);
  }
  if ('bloqueado' in r) {
    return {
      tipo: 'error',
      mensaje: r.bloqueado.mensaje,
      motivo: r.bloqueado.motivo,
      operacionId: null,
      operacionPendienteId: r.bloqueado.operacionPendienteId,
    };
  }
  if (!r.ok) return errorDeEjecucion(r);

  await notificarCambioEtapa(deps, cliente, ctx, r.valor.cambio, r.operacionId);
  return ok(
    {
      titulo: 'Enviamos el set de pruebas al SII',
      detalle: `El SII recibió las ${r.valor.casos} boletas del set con el Track ID ${r.valor.trackId}. Consulta el estado del envío en unos minutos.`,
    },
    r.operacionId,
  );
}

// --- Estado del envío del set ------------------------------------------------------------

/** Reparo o rechazo de un documento según el estado que da el SII en `detalle_rep_rech`. */
function tipoObservacion(estado: string): 'rechazo' | 'reparo' {
  return /^(RPR|REP|RLV)$/i.test(estado.trim()) ? 'reparo' : 'rechazo';
}

async function guardarEstado(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  envio: Tables<'envios'>,
  estado: EstadoEnvioRest,
  ahora: Date,
): Promise<void> {
  const json = JSON.parse(JSON.stringify(estado.json)) as Json;
  if (estado.estadistica.length > 0) {
    const { error } = await cliente.from('envio_estadisticas').upsert(
      estado.estadistica.map((e) => ({
        organizacion_id: ctx.organizacionId,
        envio_id: envio.id,
        tipo_dte: e.tipo,
        informados: e.informados,
        aceptados: e.aceptados,
        rechazados: e.rechazados,
        reparos: e.reparos,
      })),
      { onConflict: 'envio_id,tipo_dte' },
    );
    if (error) throw fallaBase('guardar las estadísticas del envío', error);
  }
  const borrado = await cliente
    .from('envio_rechazos')
    .delete()
    .eq('organizacion_id', ctx.organizacionId)
    .eq('envio_id', envio.id);
  if (borrado.error) throw fallaBase('limpiar los rechazos del envío', borrado.error);
  if (estado.detalleRepRech.length > 0) {
    const { error } = await cliente.from('envio_rechazos').insert(
      estado.detalleRepRech.map((d) => ({
        organizacion_id: ctx.organizacionId,
        envio_id: envio.id,
        tipo_dte: d.tipo,
        folio: d.folio,
        estado: d.estado,
        tipo_observacion: tipoObservacion(d.estado),
        descripcion: d.descripcion || null,
        errores: JSON.parse(JSON.stringify(d.errores)) as Json,
      })),
    );
    if (error) throw fallaBase('guardar los rechazos del envío', error);
  }
  const actualizado = await cliente
    .from('envios')
    .update({
      estado_sii: estado.estado,
      informados: estado.informados,
      aceptados: estado.aceptados,
      rechazados: estado.rechazados,
      reparos: estado.reparos,
      fecha_recepcion: fechaConZona(estado.fechaRecepcion),
      respuesta_estado: json,
      ultima_consulta_en: ahora.toISOString(),
      consultas: envio.consultas + 1,
    })
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', envio.id);
  if (actualizado.error) throw fallaBase('guardar el estado del envío', actualizado.error);
  const consulta = await cliente.from('consultas_envio').insert({
    organizacion_id: ctx.organizacionId,
    envio_id: envio.id,
    consultado_en: ahora.toISOString(),
    estado_sii: estado.estado,
    informados: estado.informados,
    aceptados: estado.aceptados,
    rechazados: estado.rechazados,
    reparos: estado.reparos,
    respuesta: json,
  });
  if (consulta.error)
    console.warn(`certificacion: no se guardó la consulta (código ${consulta.error.code})`);
}

async function prepararConsulta(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
) {
  const empresa = await cargarEmpresa(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  const envio = proceso.envio_set_id ? await cargarEnvio(cliente, ctx, proceso.envio_set_id) : null;
  if (!envio) throw new ErrorUso('Todavía no envías el set de pruebas: envíalo en el paso 3.');
  if (!envio.track_id) {
    throw new ErrorUso(
      envio.incierto
        ? 'El último envío del set no tiene Track ID (resultado incierto): revisa los envíos de la empresa en el portal del SII.'
        : 'El envío del set no tiene Track ID: vuelve a enviar el set.',
    );
  }
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  return { empresa, proceso, envio, trackId: envio.track_id, certificado };
}

/** Consulta el estado del envío del set en el SII (solo lectura, sin ensayo). */
export async function consultarEstadoSet(
  ctx: ContextoCertificacion,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => prepararConsulta(cliente, ctx, credenciales);

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'estado_envio', confirmada: true, canal: 'rest', envioId: previo.valor.envio.id },
    async ({ agregarDetalle }) => {
      const p = await prep();
      await using transporte = deps.transporte();
      const rest = deps.sii.rest(p.certificado.certificado, {
        transporte,
        reloj: deps.reloj,
        tokenStore: deps.tokenStore(cliente),
      });
      let estado: EstadoEnvioRest;
      try {
        const token = await rest.obtenerToken(p.empresa.rut);
        estado = await rest.consultarEnvio(token, p.empresa.rut, p.trackId);
      } catch (error) {
        const { error: e } = await cliente.from('consultas_envio').insert({
          organizacion_id: ctx.organizacionId,
          envio_id: p.envio.id,
          // Solo el texto de los errores de la librería (escrito para mostrarse, y aun así
          // saneado); de uno desconocido, solo su nombre: su mensaje podría traer cualquier cosa.
          error:
            error instanceof SiiError
              ? sanearTexto(`${error.name}: ${error.message}`)
              : `${error instanceof Error ? error.name : 'Error'} (sin detalle)`,
        });
        if (e) console.warn(`certificacion: no se guardó la consulta (código ${e.code})`);
        throw error;
      }
      agregarDetalle({ estado: estado.estado, informados: estado.informados });
      const ahora = deps.reloj.ahora();
      await guardarEstado(cliente, ctx, p.envio, estado, ahora);
      let cambio: CambioEtapa = { anterior: p.proceso.etapa, nueva: p.proceso.etapa };
      if (estado.limpio() && p.proceso.etapa === 'set_enviado') {
        cambio = await actualizarProceso(cliente, ctx, p.proceso, { etapa: 'set_aceptado' });
      }
      return {
        estado: estado.estado,
        enProceso: estado.enProceso(),
        limpio: estado.limpio(),
        procesado: estado.procesado(),
        informados: estado.informados,
        aceptados: estado.aceptados,
        rechazados: estado.rechazados,
        reparos: estado.reparos,
        cambio,
      };
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  const e = r.valor;
  await notificarCambioEtapa(deps, cliente, ctx, e.cambio, r.operacionId);
  if (e.enProceso) {
    return ok(
      {
        titulo: 'El SII todavía está validando el set',
        detalle: `Estado ${e.estado}. Vuelve a consultar en unos minutos.`,
      },
      r.operacionId,
    );
  }
  if (e.limpio) {
    return ok(
      {
        titulo: 'El SII aceptó el set de pruebas',
        detalle: `Las ${e.aceptados} boletas quedaron aceptadas sin reparos. El siguiente paso es pedir la revisión del set.`,
      },
      r.operacionId,
    );
  }
  if (e.procesado && e.rechazados === 0 && e.reparos > 0) {
    return {
      tipo: 'error',
      mensaje: {
        titulo: 'El SII aceptó el set con reparos',
        detalle: `${e.reparos} boletas tienen reparos. Para pedir la revisión el set tiene que quedar aceptado sin reparos: revisa el detalle, corrige y vuelve a enviar el set (usa folios nuevos).`,
      },
      operacionId: r.operacionId,
      motivo: 'set_con_reparos',
    };
  }
  return {
    tipo: 'error',
    mensaje: {
      titulo: 'El SII rechazó el set de pruebas',
      detalle: e.procesado
        ? `${e.rechazados} de ${e.informados} boletas quedaron rechazadas. Revisa el detalle, corrige y vuelve a enviar el set (usa folios nuevos).`
        : `El SII respondió con el estado ${e.estado}. Revisa el detalle, corrige y vuelve a enviar el set (usa folios nuevos).`,
    },
    operacionId: r.operacionId,
    motivo: 'set_rechazado',
  };
}
