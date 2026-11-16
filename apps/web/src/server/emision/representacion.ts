import 'server-only';
import { decodificarUtf8OIso, parsearDocumento } from '@winex/certificacion';
import type { AmbienteSii, TipoFolio } from '@/lib/folios';
import { formatearMiles } from '@/lib/formatos';
import type { DatosRepresentacion, FormatoPdf } from '../pdf';
import { AlmacenDocumentos } from '../sii/almacen';
import type { ClienteServicio } from '../supabase/service';
import type { Json } from '../supabase/tipos';
import type { MetadataDocumento } from './borradores';
import type { DependenciasEmision } from './dependencias';

// Representación impresa y correo de una boleta emitida (PLAN-SAAS Fase 7). Pasa DESPUÉS
// de la operación con el SII: si el PDF o el correo fallan, la emisión sigue valiendo y
// solo se avisa. Los nombres de los archivos son deterministas y se derivan del DTE
// (`DTE-39-F41.xml` → `DTE-39-F41-carta.pdf` / `DTE-39-F41-rollo.pdf`, en la misma carpeta
// de Storage); las rutas quedan en `documentos.metadata.pdf`.

/** Nombres de archivo de un documento (sin la carpeta `<org>/<empresa>/<ambiente>/`). */
export function nombresArchivos(tipoDte: number, folio: number) {
  const base = `DTE-${tipoDte}-F${folio}`;
  return {
    dte: `${base}.xml`,
    sobre: `EnvioBOLETA-${tipoDte}-F${folio}.xml`,
    carta: `${base}-carta.pdf`,
    rollo: `${base}-rollo.pdf`,
  };
}

/** Nombre del PDF a partir de la ruta del XML del DTE (`.../DTE-39-F41.xml`). */
export function nombrePdfDeXml(xmlPath: string, formato: FormatoPdf): string | null {
  const archivo = xmlPath.split('/').at(-1) ?? '';
  return /\.xml$/i.test(archivo) ? archivo.replace(/\.xml$/i, `-${formato}.pdf`) : null;
}

export interface DteLeido {
  fechaEmision: string;
  neto: number;
  exento: number;
  iva: number;
  total: number;
  /** El `<TED>` con sus bytes ISO-8859-1 como texto `latin1` (un carácter por byte). */
  ted: string | null;
  lineas: DatosRepresentacion['lineas'];
}

/** Totales, fecha, TED y líneas de un DTE ya armado (lo que escribió la librería). */
export function leerDte(dte: Buffer): DteLeido {
  const doc = parsearDocumento(decodificarUtf8OIso(dte));
  const texto = (padre: Document | Element, etiqueta: string) =>
    (padre.getElementsByTagName(etiqueta).item(0)?.textContent ?? '').trim();
  const entero = (padre: Document | Element, etiqueta: string) => {
    const n = Number(texto(padre, etiqueta));
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const lineas: DteLeido['lineas'] = [];
  const nodos = doc.getElementsByTagName('Detalle');
  for (let i = 0; i < nodos.length; i++) {
    const d = nodos.item(i);
    if (!d) continue;
    const unidad = texto(d, 'UnmdItem');
    lineas.push({
      nombre: texto(d, 'NmbItem'),
      cantidad: Number(texto(d, 'QtyItem') || '1'),
      unidad: unidad === '' ? null : unidad,
      precio: Number(texto(d, 'PrcItem') || '0'),
      exento: texto(d, 'IndExe') === '1',
      descuento: entero(d, 'DescuentoMonto'),
      montoItem: entero(d, 'MontoItem'),
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

/** El documento ya emitido, con lo que hace falta para el PDF, el correo y Storage. */
export interface DocumentoParaPdf {
  id: string;
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  folio: number;
  xmlPath: string;
  correo: string | null;
  metadata: MetadataDocumento;
  datos: DatosRepresentacion;
}

export interface ResultadoRepresentacion {
  pdf: MetadataDocumento['pdf'];
  correo: MetadataDocumento['correo'] | null;
  avisos: string[];
}

const FORMATOS: readonly FormatoPdf[] = ['carta', 'rollo'];

async function guardarMetadata(
  cliente: ClienteServicio,
  organizacionId: string,
  documentoId: string,
  metadata: MetadataDocumento,
): Promise<boolean> {
  try {
    const { error } = await cliente
      .from('documentos')
      .update({ metadata: metadata as Json })
      .eq('organizacion_id', organizacionId)
      .eq('id', documentoId);
    if (error) console.warn(`emision: no se guardaron las rutas del PDF (código ${error.code})`);
    return !error;
  } catch (error) {
    console.warn('emision: falló el guardado de las rutas del PDF', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

/** Genera un PDF y lo sube junto al XML. Devuelve la ruta y los bytes. Lanza si falla. */
export async function generarYSubirPdf(
  deps: Pick<DependenciasEmision, 'pdf'>,
  almacen: AlmacenDocumentos,
  empresaId: string,
  doc: Pick<DocumentoParaPdf, 'ambiente' | 'xmlPath' | 'datos'>,
  formato: FormatoPdf,
): Promise<{ ruta: string; bytes: Buffer }> {
  const archivo = nombrePdfDeXml(doc.xmlPath, formato);
  if (!archivo) throw new Error('El XML del documento no tiene un nombre válido.');
  const bytes = await deps.pdf(doc.datos, formato);
  // Sobrescribe: el PDF se puede regenerar desde los mismos datos (el XML firmado no).
  const ruta = await almacen.subirPdf({ empresaId, ambiente: doc.ambiente, archivo }, bytes, {
    sobrescribir: true,
  });
  return { ruta, bytes };
}

/**
 * PDF carta y rollo a Storage y, si el receptor tiene correo, el envío del PDF carta.
 * Nunca lanza: cada falla queda en `avisos` (y una línea de consola sin datos).
 */
export async function representarYEnviar(
  deps: Pick<DependenciasEmision, 'pdf' | 'correoBoleta' | 'reloj'>,
  cliente: ClienteServicio,
  ctx: { organizacionId: string; empresaId: string },
  doc: DocumentoParaPdf,
  emisor: { rut: string; razonSocial: string },
): Promise<ResultadoRepresentacion> {
  const avisos: string[] = [];
  const pdf: NonNullable<MetadataDocumento['pdf']> = {};
  let carta: Buffer | undefined;
  try {
    const almacen = new AlmacenDocumentos(cliente, ctx.organizacionId);
    for (const formato of FORMATOS) {
      try {
        const r = await generarYSubirPdf(deps, almacen, ctx.empresaId, doc, formato);
        pdf[formato] = r.ruta;
        if (formato === 'carta') carta = r.bytes;
      } catch (error) {
        console.warn(`emision: no se generó el PDF ${formato}`, {
          tipo: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  } catch (error) {
    console.warn('emision: no se pudo preparar el almacén del PDF', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!pdf.carta && !pdf.rollo) {
    avisos.push(
      'No pudimos generar el PDF de la boleta. La boleta igual quedó emitida; descárgalo desde Documentos más tarde.',
    );
  } else if (!pdf.carta || !pdf.rollo) {
    avisos.push(
      `No pudimos generar el PDF en formato ${pdf.carta ? 'rollo' : 'carta'}. Descárgalo desde Documentos más tarde.`,
    );
  }

  let correo: MetadataDocumento['correo'] | null = null;
  if (doc.correo) {
    if (!carta) {
      avisos.push(
        `No enviamos la boleta a ${doc.correo} porque no se generó el PDF. Puedes reenviarla desde Documentos.`,
      );
    } else {
      try {
        const envio = await deps.correoBoleta({
          para: doc.correo,
          emisor,
          tipoDte: doc.tipoDte,
          folio: doc.folio,
          fechaEmision: doc.datos.fechaEmision,
          total: doc.datos.totales.total,
          pdf: carta,
          claveIdempotencia: `boleta-${doc.id}`,
        });
        if (envio.ok) {
          correo = { id: envio.id, enviado_en: deps.reloj.ahora().toISOString() };
        } else {
          console.warn(`emision: el correo de la boleta no salió (${envio.motivo})`);
          avisos.push(
            envio.motivo === 'sin_configuracion'
              ? 'El envío de correos todavía no está configurado: no enviamos la boleta al receptor.'
              : `No pudimos enviar la boleta a ${doc.correo}. Puedes reenviarla desde Documentos.`,
          );
        }
      } catch (error) {
        console.warn('emision: falló el envío del correo de la boleta', {
          tipo: error instanceof Error ? error.name : typeof error,
        });
        avisos.push(
          `No pudimos enviar la boleta a ${doc.correo}. Puedes reenviarla desde Documentos.`,
        );
      }
    }
  }

  if (pdf.carta || pdf.rollo || correo) {
    await guardarMetadata(cliente, ctx.organizacionId, doc.id, {
      ...doc.metadata,
      ...(pdf.carta || pdf.rollo ? { pdf: { ...doc.metadata.pdf, ...pdf } } : {}),
      ...(correo ? { correo } : {}),
    });
  }
  return { pdf, correo, avisos };
}

/** «N.º 1.234» para los mensajes. */
export function numeroFolio(folio: number): string {
  return `N.º ${formatearMiles(folio)}`;
}
