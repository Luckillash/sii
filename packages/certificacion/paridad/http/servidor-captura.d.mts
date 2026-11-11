// Tipos de servidor-captura.mjs, para importarlo desde los tests de Node (TypeScript).

export type Origen = 'http' | 'https' | 'https2';

export interface Captura {
  readonly origen: Origen;
  readonly puerto: number;
  readonly metodo: string;
  /** Ruta con query, tal como llegó. */
  readonly ruta: string;
  /** Versión de HTTP, p. ej. `1.1`. */
  readonly version: string;
  /** En el orden y la capitalización recibidos (valores decodificados como latin1). */
  readonly cabeceras: readonly (readonly [string, string])[];
  readonly cuerpo: Buffer;
  /** Llegó después de agotar las respuestas grabadas (se respondió 500). */
  readonly sinRespuesta: boolean;
  /** Certificado TLS que presentó el cliente (huella sha256 de la hoja y largo de la cadena). */
  readonly tlsCliente?: { readonly hoja: string; readonly cadena: number } | null;
}

export interface OpcionesNormalizacion {
  /** `filename="x.tmp.xml"` → `filename="<archivo>.xml"` en las partes del multipart. */
  readonly nombresArchivo?: boolean;
  /** En cuerpos urlencoded, el valor de estos campos pasa a `<normalizado>` (valores de la hora real). */
  readonly camposFormulario?: readonly string[];
  /** En cuerpos `text/x-gwt-rpc`, cada token `dd-mm-aaaa` pasa a `<fecha>` (la fecha de hoy del PHP). */
  readonly fechasGwt?: boolean;
}

export interface RespuestaGrabada {
  /** Por defecto 200. */
  readonly status?: number;
  /** Pares en orden. Si no trae `Content-Length` ni `Transfer-Encoding`, se agrega `Content-Length`. */
  readonly cabeceras?: readonly (readonly [string, string])[];
  /** Texto (se envía en UTF-8) o bytes exactos en base64. */
  readonly cuerpo?: string | { readonly base64: string };
}

/** `entrada.http` de un caso de paridad HTTP. */
export interface CasoHttp {
  /** La petición N recibe la respuesta N. */
  readonly respuestas?: readonly RespuestaGrabada[];
  readonly normalizar?: OpcionesNormalizacion;
}

export interface ServidorCaptura {
  /** URLs base sin `/` final: `http://127.0.0.1:P`, `https://localhost:P`, `https://localhost:P2`. */
  readonly origenes: Readonly<Record<Origen, string>>;
  /** PEM de la CA de prueba que emite el certificado del servidor. */
  readonly ca: string;
  readonly rutaCa: string;
  /** Carga las respuestas del caso y borra lo grabado. */
  cargarCaso(caso?: CasoHttp): void;
  capturas(): Captura[];
  /** Lo grabado desde el último `cargarCaso`, normalizado con las opciones del caso. */
  normalizado(): Buffer;
  cerrar(): Promise<void>;
}

export const RUTA_CA: string;
export const CABECERAS_EXCLUIDAS: ReadonlyMap<string, string>;
export const MARCA_BOUNDARY: string;
export const MARCA_ARCHIVO: string;
export const CABECERAS_NORMALIZADAS: ReadonlyMap<string, string>;
export const MARCA_CODIFICACIONES: string;
export const MARCA_CAMPO: string;
export const MARCA_FECHA: string;

export function normalizarCapturas(
  capturas: readonly Captura[],
  opciones?: OpcionesNormalizacion,
): Buffer;

export function iniciarServidorCaptura(): Promise<ServidorCaptura>;
