// Deriva de winex/certificacion v1.9.1 (src/Certificacion/EstadoEnvio.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// constructor con un objeto de datos, estado tipado y error tipado.

import { ErrorRespuestaSii } from '../comun/errores.ts';

/** Estados intermedios: el SII todavía no termina de validar el envío. */
const EN_PROCESO = ['REC', 'SOK', 'CRT', 'FOK', 'PRD'] as const;

/**
 * Estado de un envío según `QueryEstUp`. Los que la librería interpreta son
 * `EPR` (procesado) y los intermedios `REC`, `SOK`, `CRT`, `FOK` y `PRD`;
 * cualquier otro (rechazos, códigos de error del servicio) se conserva tal cual.
 */
export type CodigoEstadoEnvio = (typeof EN_PROCESO)[number] | 'EPR' | (string & {});

export interface DatosEstadoEnvio {
  trackId: string;
  estado: CodigoEstadoEnvio;
  glosa: string;
  informados?: number;
  aceptados?: number;
  rechazados?: number;
  reparos?: number;
}

/** Blancos de `\s` en PCRE sin `/u`: espacio, \t, \n, VT, FF y \r (no NBSP). */
const B = '[ \\t\\n\\v\\f\\r]';
/** Lo que quita `trim()` de PHP: espacio, \t, \n, \r, NUL y VT. */
const TRIM_PHP = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/**
 * Estado de un envío subido al SII (`QueryEstUp.getEstUp`), por TrackID.
 *
 * Capturado 2026-09-15 en maullin para sets de boletas:
 *
 * ```xml
 * <SII:RESP_BODY><TIPO_DOCTO>39</TIPO_DOCTO><INFORMADOS>5</INFORMADOS><ACEPTADOS>5</ACEPTADOS>
 * <RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>
 * <SII:RESP_HDR><TRACKID>…</TRACKID><ESTADO>EPR</ESTADO><GLOSA>Envio Procesado</GLOSA>…
 * ```
 */
export class EstadoEnvio {
  readonly trackId: string;
  readonly estado: CodigoEstadoEnvio;
  readonly glosa: string;
  readonly informados: number;
  readonly aceptados: number;
  readonly rechazados: number;
  readonly reparos: number;

  constructor(datos: DatosEstadoEnvio) {
    this.trackId = datos.trackId;
    this.estado = datos.estado;
    this.glosa = datos.glosa;
    this.informados = datos.informados ?? 0;
    this.aceptados = datos.aceptados ?? 0;
    this.rechazados = datos.rechazados ?? 0;
    this.reparos = datos.reparos ?? 0;
    Object.freeze(this);
  }

  /**
   * Lee la respuesta de `getEstUp`, con el XML interior escapado (como lo
   * devuelve el SII dentro de `<getEstUpReturn>`) o sin escapar.
   *
   * Toma la primera aparición de `ESTADO`, `TRACKID` y `GLOSA` (sin los blancos
   * de alrededor) y **suma** `INFORMADOS`, `ACEPTADOS`, `RECHAZADOS` y `REPAROS`
   * de todos los tipos de documento. Si no viene `TRACKID` (o viene vacío o
   * `0`), usa el `trackId` recibido.
   *
   * @throws {ErrorRespuestaSii} si la respuesta no trae `ESTADO` (o viene vacío).
   */
  static desdeRespuesta(respuesta: string, trackId: string): EstadoEnvio {
    const xml = decodificarEntidadesXml(respuesta);

    const estado = valor(xml, 'ESTADO');
    if (estado === null || estado === '') {
      throw new ErrorRespuestaSii(`El SII no devolvió el estado del envío ${trackId}.`);
    }

    const trackIdRespuesta = valor(xml, 'TRACKID');
    return new EstadoEnvio({
      // `?:` de PHP: null, '' y '0' son falsos.
      trackId:
        trackIdRespuesta === null || trackIdRespuesta === '' || trackIdRespuesta === '0'
          ? trackId
          : trackIdRespuesta,
      estado,
      glosa: valor(xml, 'GLOSA') ?? '',
      informados: sumar(xml, 'INFORMADOS'),
      aceptados: sumar(xml, 'ACEPTADOS'),
      rechazados: sumar(xml, 'RECHAZADOS'),
      reparos: sumar(xml, 'REPAROS'),
    });
  }

  /** El SII todavía está validando: hay que volver a consultar más tarde. */
  enProceso(): boolean {
    return (EN_PROCESO as readonly string[]).includes(this.estado);
  }

  procesado(): boolean {
    return this.estado === 'EPR';
  }

  /** Procesado con todos los documentos aceptados, sin rechazos ni reparos. */
  limpio(): boolean {
    return (
      this.procesado() &&
      this.informados > 0 &&
      this.aceptados === this.informados &&
      this.rechazados === 0 &&
      this.reparos === 0
    );
  }

  /** Texto para mostrar, p. ej. `EPR Envio Procesado: 5 informados, 5 aceptados, ...`. */
  resumen(): string {
    return this.procesado()
      ? `${this.estado} ${this.glosa}: ${this.informados} informados, ${this.aceptados} aceptados, ` +
          `${this.rechazados} rechazados, ${this.reparos} con reparos`
      : `${this.estado} ${this.glosa}`.replace(TRIM_PHP, '');
  }
}

/** `<TAG> valor </TAG>` (primera aparición, sin blancos alrededor), o null. */
function valor(xml: string, etiqueta: string): string | null {
  const m = new RegExp(`<${etiqueta}>${B}*([^<]*?)${B}*</${etiqueta}>`).exec(xml);
  return m === null ? null : (m[1] ?? '');
}

/** Suma de todos los `<TAG> número </TAG>` (0 si no hay ninguno). */
function sumar(xml: string, etiqueta: string): number {
  let total = 0;
  for (const m of xml.matchAll(new RegExp(`<${etiqueta}>${B}*(\\d+)${B}*</${etiqueta}>`, 'g'))) {
    total += Number(m[1]);
  }
  return total;
}

/** Entidades con nombre que decodifica PHP con `ENT_XML1` (distingue mayúsculas). */
const ENTIDADES_XML: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/**
 * `html_entity_decode($texto, ENT_QUOTES | ENT_XML1, 'UTF-8')`, verificado contra
 * PHP 8.3:
 *
 * - Solo las cinco entidades de XML (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`), en
 *   minúsculas. `&nbsp;`, `&eacute;` o `&AMP;` quedan tal cual.
 * - Numéricas decimales (`&#233;`) y hexadecimales (`&#xE9;`, `&#XE9;`; el
 *   `strtol` de PHP acepta además `&#x0x41;`), con `;` obligatorio, solo si el
 *   carácter es válido en XML 1.0: \t, \n, \r, U+0020–U+D7FF y
 *   U+E000–U+10FFFF salvo U+FFFE y U+FFFF. `&#0;`, `&#xD800;` o `&#1114112;`
 *   quedan tal cual.
 * - Una sola pasada: `&amp;lt;` da `&lt;`.
 */
export function decodificarEntidadesXml(texto: string): string {
  return texto.replace(
    /&(?:#([0-9]+)|#[xX](?:0[xX])?([0-9a-fA-F]+)|([A-Za-z0-9]+));/g,
    (entidad, decimal?: string, hexadecimal?: string, nombre?: string) => {
      if (nombre !== undefined) return ENTIDADES_XML.get(nombre) ?? entidad;
      const codigo =
        decimal !== undefined
          ? Number.parseInt(decimal, 10)
          : Number.parseInt(hexadecimal ?? '', 16);
      return caracterXmlValido(codigo) ? String.fromCodePoint(codigo) : entidad;
    },
  );
}

function caracterXmlValido(codigo: number): boolean {
  return (
    codigo === 0x09 ||
    codigo === 0x0a ||
    codigo === 0x0d ||
    (codigo >= 0x20 && codigo <= 0xd7ff) ||
    (codigo >= 0xe000 && codigo <= 0x10ffff && codigo !== 0xfffe && codigo !== 0xffff)
  );
}
