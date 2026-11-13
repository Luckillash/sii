import 'server-only';
import { type Ambiente, esAmbiente } from '@winex/certificacion';
import type { ClienteServicio } from '../supabase/service';

// XML firmados (DTE, EnvioBOLETA, RCOF) y representaciones impresas en el bucket
// privado `documentos-xml` de Storage (PLAN-SAAS §4.4, Fase 4).
//
// Ruta: `<organizacion_id>/<empresa_id>/<ambiente>/<archivo>`. La política de lectura
// del bucket toma el primer segmento como la organización (`es_miembro`), así que la
// ruta se arma aquí y solo aquí, validando cada segmento. El almacén se crea para UNA
// organización (service_role salta RLS; principio 2): no sube ni firma URLs fuera de
// su carpeta.
//
// El XML del SII va en ISO-8859-1: se sube el `Buffer` tal cual, sin pasar por un
// string (recodificarlo rompería la firma). El `content-type` es exactamente uno de
// `allowed_mime_types` del bucket (`application/xml`, `text/xml`, `application/pdf`),
// sin `; charset=`: Storage compara el tipo literal y el XML ya declara su
// codificación en `<?xml ... encoding="ISO-8859-1"?>`.
//
// Los errores no incluyen la ruta, el contenido ni el detalle de Storage.

export const BUCKET_DOCUMENTOS = 'documentos-xml';

/** Mismo límite que `file_size_limit` del bucket (10 MiB). */
export const MAXIMO_BYTES = 10_485_760;

/** `content-type` por tipo de archivo; los dos están en `allowed_mime_types`. */
const CONTENT_TYPE = { xml: 'application/xml', pdf: 'application/pdf' } as const;

export type TipoArchivo = keyof typeof CONTENT_TYPE;

export type MotivoErrorAlmacen = 'ruta' | 'contenido' | 'existe' | 'storage';

export class ErrorAlmacen extends Error {
  override name = 'ErrorAlmacen';
  readonly motivo: MotivoErrorAlmacen;

  constructor(motivo: MotivoErrorAlmacen, mensaje: string) {
    super(mensaje);
    this.motivo = motivo;
  }
}

/** Dónde va el archivo dentro de la carpeta de la organización. */
export interface DestinoArchivo {
  readonly empresaId: string;
  readonly ambiente: Ambiente;
  /** Solo el nombre, con extensión `.xml` o `.pdf` según el tipo (p. ej. `EnvioBOLETA-123.xml`). */
  readonly archivo: string;
}

export interface OpcionesSubida {
  /** `true` reemplaza un archivo existente. Por defecto `false`: un XML firmado no se pisa. */
  readonly sobrescribir?: boolean;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Letras ASCII, dígitos, punto, guion y guion bajo; empieza con letra o dígito.
const PATRON_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

/** Segundos máximos de una URL firmada: son descargas puntuales, de corta duración. */
export const MAXIMO_SEGUNDOS_URL = 3600;

function uuid(valor: string, que: string): string {
  const normalizado = typeof valor === 'string' ? valor.toLowerCase() : '';
  if (!PATRON_UUID.test(normalizado)) {
    throw new ErrorAlmacen('ruta', `El id de ${que} no es un uuid válido.`);
  }
  return normalizado;
}

function nombreArchivo(archivo: string, tipo?: TipoArchivo): string {
  if (typeof archivo !== 'string' || !PATRON_ARCHIVO.test(archivo) || archivo.includes('..')) {
    throw new ErrorAlmacen(
      'ruta',
      'El nombre del archivo no es válido: usa letras sin tilde, dígitos, punto, guion o guion bajo.',
    );
  }
  const extension = archivo.slice(archivo.lastIndexOf('.') + 1).toLowerCase();
  if (tipo !== undefined ? extension !== tipo : !(extension in CONTENT_TYPE)) {
    throw new ErrorAlmacen(
      'ruta',
      `El archivo debe terminar en .${tipo ?? Object.keys(CONTENT_TYPE).join(' o .')}.`,
    );
  }
  return archivo;
}

/** `<org>/<empresa>/<ambiente>/<archivo>`, con cada segmento validado. */
export function rutaDocumento(
  organizacionId: string,
  destino: DestinoArchivo,
  tipo?: TipoArchivo,
): string {
  const org = uuid(organizacionId, 'la organización');
  const empresa = uuid(destino.empresaId, 'la empresa');
  if (!esAmbiente(destino.ambiente)) {
    throw new ErrorAlmacen('ruta', 'El ambiente debe ser certificacion o produccion.');
  }
  return `${org}/${empresa}/${destino.ambiente}/${nombreArchivo(destino.archivo, tipo)}`;
}

function fallo(operacion: string, error: { status?: unknown; statusCode?: unknown }): ErrorAlmacen {
  const estado = error.status ?? error.statusCode;
  if (String(estado) === '409') {
    return new ErrorAlmacen('existe', 'Ya hay un archivo con ese nombre en Storage.');
  }
  const codigo =
    typeof estado === 'number' || typeof estado === 'string' ? ` (HTTP ${estado})` : '';
  return new ErrorAlmacen('storage', `No se pudo ${operacion} en Storage${codigo}.`);
}

export class AlmacenDocumentos {
  readonly #cliente: ClienteServicio;
  readonly #organizacionId: string;

  /** @param organizacionId la organización dueña de todo lo que este almacén toca */
  constructor(cliente: ClienteServicio, organizacionId: string) {
    this.#cliente = cliente;
    this.#organizacionId = uuid(organizacionId, 'la organización');
  }

  /**
   * Sube un XML (ISO-8859-1) tal cual. Devuelve la ruta dentro del bucket, que es la
   * que se guarda en `documentos.xml_path` / `envios.xml_path`.
   */
  async subirXml(
    destino: DestinoArchivo,
    xml: Uint8Array,
    opciones: OpcionesSubida = {},
  ): Promise<string> {
    if (!(xml instanceof Uint8Array)) {
      // Un string ya se decodificó (y se recodificaría como UTF-8 al subirlo).
      throw new ErrorAlmacen('contenido', 'El XML debe entregarse como bytes (Buffer).');
    }
    if (!/^\s*</.test(Buffer.from(xml.subarray(0, 64)).toString('latin1'))) {
      throw new ErrorAlmacen('contenido', 'El contenido no parece un XML.');
    }
    return this.#subir(destino, 'xml', xml, opciones);
  }

  /** Sube un PDF (representación impresa). Devuelve la ruta dentro del bucket. */
  async subirPdf(
    destino: DestinoArchivo,
    pdf: Uint8Array,
    opciones: OpcionesSubida = {},
  ): Promise<string> {
    if (
      !(pdf instanceof Uint8Array) ||
      Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== '%PDF-'
    ) {
      throw new ErrorAlmacen('contenido', 'El contenido no es un PDF.');
    }
    return this.#subir(destino, 'pdf', pdf, opciones);
  }

  /**
   * URL firmada de corta duración para descargar un archivo de esta organización.
   * Quien la pide ya comprobó que el usuario es miembro de la organización.
   */
  async urlFirmada(ruta: string, segundos = 60): Promise<string> {
    if (!Number.isInteger(segundos) || segundos < 1 || segundos > MAXIMO_SEGUNDOS_URL) {
      throw new ErrorAlmacen(
        'ruta',
        `La duración de la URL debe ser de 1 a ${MAXIMO_SEGUNDOS_URL} segundos.`,
      );
    }
    const partes = typeof ruta === 'string' ? ruta.split('/') : [];
    const [org, empresaId, ambiente, archivo, ...resto] = partes;
    if (
      resto.length > 0 ||
      org === undefined ||
      empresaId === undefined ||
      ambiente === undefined ||
      archivo === undefined
    ) {
      throw new ErrorAlmacen('ruta', 'La ruta del archivo no es válida.');
    }
    if (uuid(org, 'la organización') !== this.#organizacionId) {
      throw new ErrorAlmacen('ruta', 'El archivo no es de esta organización.');
    }
    const validada = rutaDocumento(this.#organizacionId, {
      empresaId,
      ambiente: ambiente as Ambiente,
      archivo,
    });
    const { data, error } = await this.#cliente.storage
      .from(BUCKET_DOCUMENTOS)
      .createSignedUrl(validada, segundos);
    if (error || !data?.signedUrl) throw fallo('firmar la URL del archivo', error ?? {});
    return data.signedUrl;
  }

  async #subir(
    destino: DestinoArchivo,
    tipo: TipoArchivo,
    datos: Uint8Array,
    opciones: OpcionesSubida,
  ): Promise<string> {
    const ruta = rutaDocumento(this.#organizacionId, destino, tipo);
    if (datos.byteLength === 0 || datos.byteLength > MAXIMO_BYTES) {
      throw new ErrorAlmacen(
        'contenido',
        `El archivo está vacío o supera el máximo de ${MAXIMO_BYTES / 1_048_576} MB.`,
      );
    }
    const { error } = await this.#cliente.storage
      .from(BUCKET_DOCUMENTOS)
      .upload(ruta, Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength), {
        contentType: CONTENT_TYPE[tipo],
        upsert: opciones.sobrescribir ?? false,
      });
    if (error) throw fallo('subir el archivo', error);
    return ruta;
  }
}
