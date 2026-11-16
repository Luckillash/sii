import 'server-only';
import type { ArchivoDocumento } from '@/lib/emision';
import type { TipoFolio } from '@/lib/folios';
import type { FormatoPdf } from '../pdf';
import { AlmacenDocumentos } from '../sii/almacen';
import type { Json } from '../supabase/tipos';
import { leerMetadata, UUID } from './borradores';
import { type DependenciasEmision, resolverDependenciasEmision } from './dependencias';
import { generarYSubirPdf } from './representacion';
import type { ContextoEmision } from './tipos';

// Descarga del XML o del PDF de un documento emitido (PLAN-SAAS Fase 7, §4.4): URL firmada
// de corta duración. El documento se lee con la SESIÓN (RLS: es de una organización del
// usuario) y filtrado por organización y empresa; la URL la firma el almacén de esa
// organización (service_role, solo su carpeta). Si falta el PDF (falló al emitir), se
// regenera desde los datos guardados y el `ted_xml`, se sube y se firma.

/** Segundos de vida de la URL firmada: la descarga empieza en seguida. */
export const SEGUNDOS_URL = 60;

type Resultado =
  | { ok: true; url: string }
  | { ok: false; mensaje: { titulo: string; detalle: string } };

const NO_ENCONTRADO: Resultado = {
  ok: false,
  mensaje: {
    titulo: 'No encontramos el documento',
    detalle: 'Puede que sea de otra empresa o que ya no exista. Recarga la página.',
  },
};

const SIN_PDF: Resultado = {
  ok: false,
  mensaje: {
    titulo: 'No pudimos generar el PDF',
    detalle:
      'La boleta sigue emitida y su XML está disponible. Inténtalo de nuevo en unos minutos; si sigue fallando, escríbenos a soporte.',
  },
};

const SIN_ARCHIVO: Resultado = {
  ok: false,
  mensaje: {
    titulo: 'No pudimos preparar la descarga',
    detalle: 'Inténtalo de nuevo en unos minutos.',
  },
};

export async function enlaceDocumento(
  ctx: Omit<ContextoEmision, 'usuarioId'>,
  documentoId: string,
  archivo: ArchivoDocumento,
  dependencias?: Partial<DependenciasEmision>,
): Promise<Resultado> {
  if (!UUID.test(documentoId)) return NO_ENCONTRADO;
  const deps = resolverDependenciasEmision(dependencias);
  const sesion = await deps.sesion();
  const { data: doc, error } = await sesion
    .from('documentos')
    .select(
      'id, ambiente, tipo_dte, folio, estado, xml_path, ted_xml, fecha_emision, receptor_rut, receptor_razon_social, mnt_neto, mnt_exe, iva, mnt_total, descuento_aplicado, envio_id, metadata',
    )
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('id', documentoId)
    .maybeSingle();
  if (error) {
    console.warn(`emision: no se pudo leer el documento (código ${error.code})`);
    return SIN_ARCHIVO;
  }
  if (!doc) return NO_ENCONTRADO;
  if (doc.folio === null || !doc.xml_path) {
    return {
      ok: false,
      mensaje: {
        titulo: 'El documento todavía no se emite',
        detalle: 'Los archivos existen una vez que la boleta tiene folio. Emítela primero.',
      },
    };
  }

  const cliente = deps.servicio();
  const almacen = new AlmacenDocumentos(cliente, ctx.organizacionId);
  try {
    if (archivo === 'xml')
      return { ok: true, url: await almacen.urlFirmada(doc.xml_path, SEGUNDOS_URL) };

    if (doc.estado === 'anulado') {
      return {
        ok: false,
        mensaje: {
          titulo: 'La boleta quedó anulada',
          detalle:
            'El SII no la recibió, así que no tiene representación impresa. Su XML sigue disponible.',
        },
      };
    }
    const formato: FormatoPdf = archivo === 'pdf_rollo' ? 'rollo' : 'carta';
    const metadata = leerMetadata(doc.metadata);
    const guardada = metadata.pdf?.[formato];
    if (guardada) return { ok: true, url: await almacen.urlFirmada(guardada, SEGUNDOS_URL) };

    // Falta el PDF: se regenera con lo guardado (líneas, totales, TED, carátula del envío).
    if (!doc.ted_xml) return SIN_PDF;
    const [lineas, empresa, envio] = await Promise.all([
      sesion
        .from('documento_detalles')
        .select('nro_linea, nombre, cantidad, unidad, precio, exento, descuento_monto, monto_item')
        .eq('organizacion_id', ctx.organizacionId)
        .eq('documento_id', doc.id)
        .order('nro_linea', { ascending: true }),
      sesion
        .from('empresas')
        .select('rut, razon_social, giro, direccion, comuna')
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', ctx.empresaId)
        .maybeSingle(),
      doc.envio_id
        ? sesion
            .from('envios')
            .select('nro_resol, fch_resol')
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', doc.envio_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (lineas.error || empresa.error || envio.error || !empresa.data || !envio.data) {
      return SIN_PDF;
    }
    let ruta: string;
    try {
      const tipoDte = (doc.tipo_dte === 41 ? 41 : 39) as TipoFolio;
      ({ ruta } = await generarYSubirPdf(
        deps,
        almacen,
        ctx.empresaId,
        {
          ambiente: doc.ambiente,
          xmlPath: doc.xml_path,
          datos: {
            ambiente: doc.ambiente,
            tipoDte,
            folio: doc.folio,
            fechaEmision: doc.fecha_emision,
            emisor: {
              rut: empresa.data.rut,
              razonSocial: empresa.data.razon_social,
              giro: empresa.data.giro,
              direccion: empresa.data.direccion,
              comuna: empresa.data.comuna,
            },
            receptor: { rut: doc.receptor_rut, razonSocial: doc.receptor_razon_social },
            lineas: lineas.data.map((l) => ({
              nombre: l.nombre,
              cantidad: Number(l.cantidad),
              unidad: l.unidad,
              precio: Number(l.precio),
              exento: l.exento,
              descuento: l.descuento_monto,
              montoItem: l.monto_item,
            })),
            totales: {
              neto: doc.mnt_neto,
              exento: doc.mnt_exe,
              iva: doc.iva,
              total: doc.mnt_total,
              descuentoAplicado: doc.descuento_aplicado,
            },
            resolucion: { numero: envio.data.nro_resol, fecha: envio.data.fch_resol },
            // `ted_xml` guarda el TED ISO-8859-1 decodificado: cada carácter es un byte latin1.
            tedXml: doc.ted_xml,
          },
        },
        formato,
      ));
    } catch (e) {
      console.warn(`emision: no se pudo regenerar el PDF ${formato}`, {
        tipo: e instanceof Error ? e.name : typeof e,
      });
      return SIN_PDF;
    }
    const nueva = { ...metadata, pdf: { ...metadata.pdf, [formato]: ruta } };
    const { error: e2 } = await cliente
      .from('documentos')
      .update({ metadata: nueva as Json })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', doc.id);
    if (e2) console.warn(`emision: no se guardó la ruta del PDF (código ${e2.code})`);
    return { ok: true, url: await almacen.urlFirmada(ruta, SEGUNDOS_URL) };
  } catch (e) {
    console.warn('emision: no se pudo firmar la URL del documento', {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    return SIN_ARCHIVO;
  }
}
