import 'server-only';
import { z } from 'zod';
import {
  type AmbienteSii,
  LIMITE_LOTE,
  LIMITE_PAGINA,
  LIMITE_PAGINA_MAXIMO,
  MAXIMO_CUERPO_BYTES,
} from '@/lib/api-publica';
import { type Borrador, type BorradorValido, esquemaBorrador } from '@/lib/emision';
import { CANTIDAD_MAXIMA } from '@/lib/folios';
import { rutSii, validarRut } from '@/lib/formatos';
import { type Cursor, decodificarCursor } from './cursor';
import { ErrorApi } from './respuestas';

// Esquemas de `/api/v1` (PLAN-SAAS Fase 11, §2 del diseño). Los campos van en snake_case
// y en español, como los payloads de los webhooks. La boleta de la API se transforma en
// el `Borrador` del panel y pasa por el MISMO `esquemaBorrador` (Fase 7): mismas reglas
// (ISO-8859-1, RUT, 41 solo exenta, totales) y los errores vuelven en `campos` con las
// rutas en snake_case (`lineas.0.precio`, `receptor.razon_social`).
//
// Los objetos son estrictos: un campo desconocido es un error (un `razonSocial` mal
// escrito no debe emitir a Cliente General en silencio).

const MENSAJE_OBJETO = 'Tiene que ser un objeto JSON.';

const texto = (mensaje: string) => z.string(mensaje);

const esquemaLineaApi = z.strictObject(
  {
    nombre: texto('Escribe el nombre del producto o servicio.'),
    cantidad: z.number('La cantidad tiene que ser un número.'),
    precio: z.number('El precio tiene que ser un número entero en pesos (IVA incluido).'),
    exento: z.boolean('exento tiene que ser true o false.').optional(),
    unidad: z.string('La unidad tiene que ser texto.').nullish(),
  },
  MENSAJE_OBJETO,
);

const esquemaReceptorApi = z.strictObject(
  {
    rut: z.string('El RUT tiene que ser texto.').nullish(),
    razon_social: z.string('La razón social tiene que ser texto.').nullish(),
    correo: z.string('El correo tiene que ser texto.').nullish(),
  },
  MENSAJE_OBJETO,
);

const esquemaDescuentoApi = z.strictObject(
  {
    tipo: z.enum(['monto', 'porcentaje'], 'Usa monto o porcentaje.'),
    valor: z.number('El descuento tiene que ser un número.'),
    glosa: z.string('La glosa tiene que ser texto.').nullish(),
  },
  MENSAJE_OBJETO,
);

const esquemaAmbiente = z.enum(['certificacion', 'produccion'], 'Usa certificacion o produccion.');

/** Una boleta como la recibe `POST /documentos` (y cada ítem del lote). */
export const esquemaEmisionApi = z.strictObject(
  {
    empresa: z.string('empresa tiene que ser el RUT o el id de la empresa.').optional(),
    ambiente: esquemaAmbiente.optional(),
    tipo_dte: z.union([z.literal(39), z.literal(41)], 'Usa 39 (boleta) o 41 (boleta exenta).'),
    receptor: esquemaReceptorApi.nullish(),
    lineas: z
      .array(esquemaLineaApi, 'lineas tiene que ser una lista.')
      .min(1, 'Agrega al menos una línea.'),
    descuento: esquemaDescuentoApi.nullish(),
  },
  MENSAJE_OBJETO,
);
export type EmisionApi = z.output<typeof esquemaEmisionApi>;

export const esquemaLoteApi = z.strictObject(
  {
    documentos: z
      .array(z.unknown(), 'documentos tiene que ser una lista de boletas.')
      .min(1, 'Envía al menos una boleta.')
      .max(LIMITE_LOTE, `Un lote admite hasta ${LIMITE_LOTE} boletas.`),
  },
  MENSAJE_OBJETO,
);

export const esquemaSolicitudFoliosApi = z.strictObject(
  {
    empresa: z.string('empresa tiene que ser el RUT o el id de la empresa.').optional(),
    ambiente: esquemaAmbiente.optional(),
    tipo_dte: z.union([z.literal(39), z.literal(41)], 'Usa 39 (boleta) o 41 (boleta exenta).'),
    cantidad: z
      .number('La cantidad tiene que ser un número entero.')
      .int('La cantidad tiene que ser un número entero.')
      .min(1, 'Pide al menos 1 folio.')
      .max(CANTIDAD_MAXIMA, `Pide hasta ${CANTIDAD_MAXIMA} folios por solicitud.`),
    folio_inicial: z
      .number('El folio inicial tiene que ser un número entero.')
      .int('El folio inicial tiene que ser un número entero.')
      .min(1, 'El folio inicial tiene que ser mayor que 0.')
      .optional(),
    nivel: z.enum(['ensayo', 'revision', 'timbrar'], 'Usa ensayo, revision o timbrar.'),
    revision_id: z.uuid('revision_id tiene que ser el id que devolvió la revisión.').optional(),
  },
  MENSAJE_OBJETO,
);
export type SolicitudFoliosEntrada = z.output<typeof esquemaSolicitudFoliosApi>;

// --- Errores de zod a `campos` -------------------------------------------------------

const A_SNAKE: Record<string, string> = {
  tipoDte: 'tipo_dte',
  razonSocial: 'razon_social',
  receptorId: 'receptor',
  productoId: 'lineas',
};

/** `campos` del error: la primera falla de cada ruta, en snake_case. */
export function camposDeZod(error: z.ZodError, prefijo = ''): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const issue of error.issues) {
    const ruta = issue.path
      .map((p) => (typeof p === 'string' ? (A_SNAKE[p] ?? p) : String(p)))
      .join('.');
    const llave = [prefijo, ruta].filter(Boolean).join('.') || prefijo || 'cuerpo';
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) {
        const l = [llave === 'cuerpo' ? '' : llave, k].filter(Boolean).join('.');
        campos[l] ??= 'Este campo no existe en la API. Revisa cómo se escribe.';
      }
      continue;
    }
    campos[llave] ??= issue.message;
  }
  return campos;
}

/** Valida contra un esquema o lanza 422 `datos_invalidos` con los campos. */
export function validar<T extends z.ZodType>(
  esquema: T,
  valor: unknown,
  prefijo = '',
): z.output<T> {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new ErrorApi('datos_invalidos', { campos: camposDeZod(r.error, prefijo) });
  return r.data;
}

// --- Boleta de la API → borrador del panel --------------------------------------------

/**
 * La boleta de la API como `BorradorValido` del ambiente de la clave. Lanza 422
 * `ambiente_no_coincide` si pide otro ambiente, o `datos_invalidos` con los campos.
 */
export function aBorrador(
  entrada: EmisionApi,
  ambiente: AmbienteSii,
  prefijo = '',
): BorradorValido {
  if (entrada.ambiente !== undefined && entrada.ambiente !== ambiente) {
    throw new ErrorApi('ambiente_no_coincide');
  }
  const r = entrada.receptor ?? null;
  const borrador: Borrador = {
    tipoDte: entrada.tipo_dte,
    ambiente,
    receptor: {
      rut: r?.rut?.trim() ?? '',
      razonSocial: r?.razon_social ?? null,
      correo: r?.correo ?? null,
      receptorId: null,
    },
    lineas: entrada.lineas.map((l) => ({
      productoId: null,
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio: l.precio,
      // En la boleta exenta (41) todas las líneas son exentas: por defecto, true.
      exento: l.exento ?? entrada.tipo_dte === 41,
      unidad: l.unidad ?? null,
    })),
    descuento: entrada.descuento
      ? {
          tipo: entrada.descuento.tipo,
          valor: entrada.descuento.valor,
          glosa: entrada.descuento.glosa ?? null,
        }
      : null,
  };
  return validar(esquemaBorrador, borrador, prefijo);
}

// --- Cuerpo de la petición ----------------------------------------------------------

/** El cuerpo JSON de la petición: 415 sin `application/json`, 413 si es grande, 400 si no es JSON. */
export async function leerCuerpoJson(request: Request): Promise<unknown> {
  const tipo = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(tipo.trim())) throw new ErrorApi('tipo_contenido');
  const largo = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(largo) && largo > MAXIMO_CUERPO_BYTES)
    throw new ErrorApi('cuerpo_muy_grande');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAXIMO_CUERPO_BYTES) throw new ErrorApi('cuerpo_muy_grande');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ErrorApi('json_invalido');
  }
}

// --- Parámetros de los listados ------------------------------------------------------

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS_DOCUMENTO = [
  'borrador',
  'firmado',
  'enviado',
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'anulado',
  'incierto',
] as const;

export interface ParametrosListado {
  limite: number;
  cursor?: Cursor;
  empresa?: string;
  tipoDte?: number;
  estados?: string[];
  desde?: string;
  hasta?: string;
  folio?: number;
  receptorRut?: string;
  claveIdempotencia?: string;
  origen?: 'panel' | 'api';
}

function fechaValida(v: string): boolean {
  if (!PATRON_FECHA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Los filtros de `GET /documentos`, o 400 `parametro_invalido` con los campos. */
export function leerParametrosListado(params: URLSearchParams): ParametrosListado {
  const campos: Record<string, string> = {};
  const salida: ParametrosListado = { limite: LIMITE_PAGINA };
  const valor = (k: string) => {
    const v = params.get(k);
    return v === null || v.trim() === '' ? undefined : v.trim();
  };

  const limite = valor('limite');
  if (limite !== undefined) {
    const n = Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_PAGINA_MAXIMO) {
      campos.limite = `Usa un número entero entre 1 y ${LIMITE_PAGINA_MAXIMO}.`;
    } else salida.limite = n;
  }
  const cursor = valor('cursor');
  if (cursor !== undefined) salida.cursor = decodificarCursor(cursor);
  const empresa = valor('empresa');
  if (empresa !== undefined) salida.empresa = empresa;
  const tipo = valor('tipo_dte');
  if (tipo !== undefined) {
    if (tipo !== '39' && tipo !== '41') campos.tipo_dte = 'Usa 39 o 41.';
    else salida.tipoDte = Number(tipo);
  }
  const estado = valor('estado');
  if (estado !== undefined) {
    const lista = estado.split(',').map((e) => e.trim());
    const malos = lista.filter((e) => !(ESTADOS_DOCUMENTO as readonly string[]).includes(e));
    if (malos.length > 0) {
      campos.estado = `Estados válidos: ${ESTADOS_DOCUMENTO.join(', ')}, separados por comas.`;
    } else salida.estados = [...new Set(lista)];
  }
  for (const k of ['desde', 'hasta'] as const) {
    const f = valor(k);
    if (f === undefined) continue;
    if (!fechaValida(f)) campos[k] = 'Usa una fecha AAAA-MM-DD.';
    else salida[k] = f;
  }
  if (salida.desde && salida.hasta && salida.desde > salida.hasta) {
    campos.hasta = 'hasta tiene que ser igual o posterior a desde.';
  }
  const folio = valor('folio');
  if (folio !== undefined) {
    const n = Number(folio);
    if (!Number.isSafeInteger(n) || n < 1) campos.folio = 'Usa un folio entero mayor que 0.';
    else salida.folio = n;
  }
  const receptor = valor('receptor_rut');
  if (receptor !== undefined) {
    if (!validarRut(receptor)) campos.receptor_rut = 'Revisa el RUT del receptor.';
    else salida.receptorRut = rutSii(receptor);
  }
  const clave = valor('clave_idempotencia');
  if (clave !== undefined) {
    if (clave.length > 255) campos.clave_idempotencia = 'Usa hasta 255 caracteres.';
    else salida.claveIdempotencia = clave;
  }
  const origen = valor('origen');
  if (origen !== undefined) {
    if (origen !== 'panel' && origen !== 'api') campos.origen = 'Usa panel o api.';
    else salida.origen = origen;
  }
  if (Object.keys(campos).length > 0) throw new ErrorApi('parametro_invalido', { campos });
  return salida;
}
