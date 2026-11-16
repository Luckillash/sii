import { z } from 'zod';
import type { EstadoFolios } from '@/components/boleteame/folios';
import type { ResumenEnsayo } from '@/lib/certificacion';
import type { AmbienteSii, TipoFolio } from '@/lib/folios';
import {
  cabeEnIso88591,
  correoSiiValido,
  formatearRut,
  rutSii,
  rutValidoSii,
} from '@/lib/formatos';
import type { Database } from '@/server/supabase/tipos';

// Contrato compartido de la Fase 7 (PLAN-SAAS §7, «Emisión de boletas»): la forma del
// borrador que arma `/[org]/emitir`, su validación (zod), la regla de totales de la
// boleta y lo que devuelven las acciones. Puro (sin `server-only` ni React): lo importan
// el store de emisión (cliente), las Server Actions y `server/emision/`.
//
// REGLA DE TOTALES: `calcularTotales` replica EXACTAMENTE las cuentas de
// `GeneradorBoleta` de `@winex/certificacion` (precio bruto; neto = round(bruto / 1,19)
// con el `round()` de PHP; IVA = bruto − neto; descuento global solo sobre lo afecto,
// repartido entre las líneas afectas como `<DescuentoMonto>`). La librería no se puede
// importar en el navegador (node-forge, Buffer), así que la cuenta vive aquí y
// `emision.test.ts` la compara contra el XML que escribe la librería. Si la librería
// cambia, esa prueba falla.

export type EstadoDocumento = Database['public']['Enums']['estado_documento'];
export type TipoDescuento = Database['public']['Enums']['tipo_descuento'];

/** Receptor genérico de las boletas (`documentos.receptor_rut` por defecto). */
export const RECEPTOR_GENERICO = Object.freeze({
  rut: '66666666-6',
  razonSocial: 'Cliente General',
});

/** Tope de líneas del formulario (el esquema admite 1.000; una boleta de panel no llega). */
export const MAXIMO_LINEAS = 100;
/** `<NmbItem>` y `productos.nombre`. */
export const LARGO_MAXIMO_NOMBRE = 80;
/** `<UnmdItem>` y `productos.unidad`. */
export const LARGO_MAXIMO_UNIDAD = 4;
/** `<RznSocRecep>` y `receptores.razon_social`. */
export const LARGO_MAXIMO_RAZON_SOCIAL = 100;
/** Decimales de la cantidad (`<QtyItem>`; la columna admite 6, el panel usa 3). */
export const DECIMALES_CANTIDAD = 3;
/** Límite de montos de la librería (desde 1e15 rechaza). */
export const LIMITE_MONTO = 1e15;
/** Tasa de IVA (%), la misma de la librería. */
export const TASA_IVA = 19;

// --- Borrador (lo que arma el formulario) ---------------------------------------------

export interface LineaBorrador {
  /** Producto del catálogo de donde salió (opcional; solo referencia). */
  productoId?: string | null;
  nombre: string;
  /** Mayor que 0, hasta 3 decimales. */
  cantidad: number;
  /** Precio unitario BRUTO (IVA incluido), en pesos enteros. */
  precio: number;
  /** Ítem exento. En la boleta exenta (41) todas las líneas lo son. */
  exento: boolean;
  unidad?: string | null;
}

export interface ReceptorBorrador {
  /** Con o sin puntos; vacío = receptor genérico. */
  rut: string;
  razonSocial?: string | null;
  /** Si viene, se le envía el PDF por correo al emitir. */
  correo?: string | null;
  /** Receptor del catálogo (`receptores`) de donde salió. */
  receptorId?: string | null;
}

export interface DescuentoBorrador {
  tipo: TipoDescuento;
  /** `monto`: pesos enteros; `porcentaje`: 0–100 con hasta 2 decimales. */
  valor: number;
  glosa?: string | null;
}

export interface Borrador {
  tipoDte: TipoFolio;
  ambiente: AmbienteSii;
  receptor: ReceptorBorrador;
  lineas: LineaBorrador[];
  descuento?: DescuentoBorrador | null;
}

// --- Validación -------------------------------------------------------------------------

const textoIso = (campo: string, maximo: number) =>
  z
    .string()
    .trim()
    .min(1, `Escribe ${campo}.`)
    .max(maximo, `Usa ${maximo} caracteres como máximo.`)
    .refine(cabeEnIso88591, 'Tiene caracteres que el SII no acepta (emoji o símbolos especiales).');

const decimalesDe = (n: number) => {
  const [, dec = ''] = String(n).split('.');
  return dec.length;
};

export const esquemaLinea = z.object({
  productoId: z.uuid().nullish(),
  nombre: textoIso('el nombre del producto o servicio', LARGO_MAXIMO_NOMBRE),
  cantidad: z
    .number('Escribe la cantidad.')
    .positive('La cantidad tiene que ser mayor que 0.')
    .lt(LIMITE_MONTO, 'La cantidad es demasiado grande.')
    .refine(
      (n) => decimalesDe(n) <= DECIMALES_CANTIDAD,
      `Usa ${DECIMALES_CANTIDAD} decimales como máximo.`,
    ),
  precio: z
    .number('Escribe el precio.')
    .int('El precio va en pesos, sin decimales.')
    .nonnegative('El precio no puede ser negativo.')
    .lt(LIMITE_MONTO, 'El precio es demasiado grande.'),
  exento: z.boolean(),
  unidad: z
    .string()
    .trim()
    .max(LARGO_MAXIMO_UNIDAD, `Usa ${LARGO_MAXIMO_UNIDAD} caracteres como máximo.`)
    .refine(cabeEnIso88591, 'Tiene caracteres que el SII no acepta.')
    .nullish()
    .transform((u) => (u ? u : null)),
});

export const esquemaReceptor = z
  .object({
    rut: z.string().trim(),
    razonSocial: z
      .string()
      .trim()
      .max(LARGO_MAXIMO_RAZON_SOCIAL, `Usa ${LARGO_MAXIMO_RAZON_SOCIAL} caracteres como máximo.`)
      .refine(cabeEnIso88591, 'Tiene caracteres que el SII no acepta.')
      .nullish()
      .transform((r) => (r ? r : null)),
    correo: z
      .string()
      .trim()
      .nullish()
      .transform((c) => (c ? c : null))
      .refine((c) => c === null || correoSiiValido(c), 'Revisa el correo.'),
    receptorId: z.uuid().nullish(),
  })
  .superRefine((r, ctx) => {
    if (r.rut === '') return;
    if (!rutValidoSii(rutSii(r.rut))) {
      ctx.addIssue({ code: 'custom', path: ['rut'], message: 'Revisa el RUT.' });
    }
  })
  .transform((r) => {
    const generico = r.rut === '' || rutSii(r.rut) === RECEPTOR_GENERICO.rut;
    return {
      rut: generico ? RECEPTOR_GENERICO.rut : rutSii(r.rut),
      razonSocial: generico ? RECEPTOR_GENERICO.razonSocial : r.razonSocial,
      correo: r.correo,
      receptorId: generico ? null : (r.receptorId ?? null),
    };
  });

export const esquemaDescuento = z
  .object({
    tipo: z.enum(['monto', 'porcentaje']),
    valor: z.number('Escribe el descuento.').nonnegative('El descuento no puede ser negativo.'),
    glosa: z.string().trim().max(45).nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.tipo === 'monto' && !Number.isInteger(d.valor)) {
      ctx.addIssue({ code: 'custom', path: ['valor'], message: 'El descuento va en pesos.' });
    }
    if (d.tipo === 'porcentaje' && (d.valor > 100 || decimalesDe(d.valor) > 2)) {
      ctx.addIssue({
        code: 'custom',
        path: ['valor'],
        message: 'Usa un porcentaje entre 0 y 100, con 2 decimales como máximo.',
      });
    }
  });

export const esquemaBorrador = z
  .object({
    tipoDte: z.union([z.literal(39), z.literal(41)]),
    ambiente: z.enum(['certificacion', 'produccion']),
    receptor: esquemaReceptor,
    lineas: z
      .array(esquemaLinea)
      .min(1, 'Agrega al menos una línea.')
      .max(MAXIMO_LINEAS, `Una boleta admite ${MAXIMO_LINEAS} líneas en el panel.`),
    descuento: esquemaDescuento.nullish(),
  })
  .superRefine((b, ctx) => {
    // La boleta exenta solo lleva líneas exentas.
    if (b.tipoDte === 41) {
      b.lineas.forEach((l, i) => {
        if (!l.exento) {
          ctx.addIssue({
            code: 'custom',
            path: ['lineas', i, 'exento'],
            message: 'En una boleta exenta todas las líneas son exentas.',
          });
        }
      });
    }
    const t = calcularTotales(b);
    if (t.total <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineas'],
        message: 'El total tiene que ser mayor que $ 0.',
      });
    }
    if (t.total >= LIMITE_MONTO) {
      ctx.addIssue({ code: 'custom', path: ['lineas'], message: 'El total es demasiado grande.' });
    }
  });

export type BorradorValido = z.output<typeof esquemaBorrador>;

// --- Totales (paridad con GeneradorBoleta) ----------------------------------------------

export interface TotalLinea {
  /** round(cantidad × precio), bruto. */
  bruto: number;
  /** Parte del descuento global que recibe la línea (`<DescuentoMonto>`). */
  descuento: number;
  /** `<MontoItem>` = bruto − descuento. */
  montoItem: number;
}

export interface Totales {
  lineas: TotalLinea[];
  /** Suma bruta de las líneas afectas, antes del descuento. */
  afectoBruto: number;
  /** Descuento efectivamente aplicado (acotado a lo afecto): `documentos.descuento_aplicado`. */
  descuentoAplicado: number;
  /** `<MntNeto>`. */
  neto: number;
  /** `<MntExe>`. */
  exento: number;
  /** `<IVA>`. */
  iva: number;
  /** `<MntTotal>` = neto + IVA + exento. */
  total: number;
}

type EntradaTotales = {
  lineas: readonly Pick<LineaBorrador, 'cantidad' | 'precio' | 'exento'>[];
  descuento?: Pick<DescuentoBorrador, 'tipo' | 'valor'> | null;
};

/**
 * Totales de la boleta con las mismas cuentas que `GeneradorBoleta.generarBoleta()`.
 * No valida: con entradas inválidas devuelve lo que salga (el esquema valida antes).
 */
export function calcularTotales(entrada: EntradaTotales): Totales {
  const brutos = entrada.lineas.map((l) => redondearPhp(l.cantidad * l.precio));
  let exento = 0;
  let afectoBruto = 0;
  entrada.lineas.forEach((l, i) => {
    if (l.exento) exento += brutos[i] as number;
    else afectoBruto += brutos[i] as number;
  });

  const descuentoAplicado = descuentoBruto(entrada.descuento ?? undefined, afectoBruto);
  const reparto = repartirDescuento(entrada.lineas, brutos, descuentoAplicado, afectoBruto);
  const afectoNeto = afectoBruto - descuentoAplicado;

  let neto = 0;
  let iva = 0;
  if (afectoNeto > 0) {
    neto = Math.trunc(redondearPhp(afectoNeto / (1 + TASA_IVA / 100)));
    iva = afectoNeto - neto;
  }
  return {
    lineas: brutos.map((bruto, i) => {
      const descuento = reparto.get(i) ?? 0;
      return { bruto, descuento, montoItem: bruto - descuento };
    }),
    afectoBruto,
    descuentoAplicado,
    neto,
    exento,
    iva,
    total: neto + iva + exento,
  };
}

function descuentoBruto(
  descuento: Pick<DescuentoBorrador, 'tipo' | 'valor'> | undefined,
  afecto: number,
): number {
  if (descuento == null || afecto <= 0 || descuento.valor <= 0) return 0;
  let bruto: number;
  if (descuento.tipo !== 'porcentaje') bruto = Math.trunc(redondearPhp(descuento.valor));
  else if (descuento.valor > 100) bruto = afecto;
  else bruto = Math.trunc(redondearPhp((afecto * descuento.valor) / 100));
  return Math.max(0, Math.min(bruto, afecto));
}

function repartirDescuento(
  lineas: EntradaTotales['lineas'],
  brutos: readonly number[],
  descuento: number,
  afecto: number,
): Map<number, number> {
  const reparto = new Map<number, number>();
  if (descuento <= 0 || afecto <= 0) return reparto;
  const afectas: [number, number][] = [];
  lineas.forEach((l, i) => {
    const bruto = brutos[i] as number;
    if (!l.exento && bruto > 0) afectas.push([i, Math.trunc(bruto)]);
  });
  let asignado = 0;
  for (const [i, monto] of afectas) {
    const cuota = cuotaDescuento(descuento, monto, afecto);
    reparto.set(i, cuota);
    asignado += cuota;
  }
  let resto = descuento - asignado;
  while (resto > 0) {
    let movio = false;
    for (const [i, monto] of afectas) {
      if (resto <= 0) break;
      const actual = reparto.get(i) ?? 0;
      if (actual < monto) {
        reparto.set(i, actual + 1);
        resto--;
        movio = true;
      }
    }
    if (!movio) break;
  }
  return reparto;
}

const MAXIMO_INT64 = 2n ** 63n - 1n;

function cuotaDescuento(descuento: number, monto: number, afecto: number): number {
  const producto = BigInt(descuento) * BigInt(monto);
  if (producto > MAXIMO_INT64) return Math.trunc(Math.floor((descuento * monto) / afecto));
  const divisor = BigInt(afecto);
  if (producto % divisor === 0n) return Number(producto / divisor);
  return Math.trunc(Math.floor(Number(producto) / afecto));
}

const TABLA_LOG10 = [
  1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9,
  1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

function log10EnteroAbs(valor: number): number {
  const v = Math.abs(valor);
  if (v < 1e-8 || v > 1e22) return Math.floor(Math.log10(v));
  let r = 15;
  r += v < (TABLA_LOG10[r] as number) ? -8 : 8;
  r += v < (TABLA_LOG10[r] as number) ? -4 : 4;
  r += v < (TABLA_LOG10[r] as number) ? -2 : 2;
  r += v < (TABLA_LOG10[r] as number) ? -1 : 1;
  if (v < (TABLA_LOG10[r] as number)) r -= 1;
  return r - 8;
}

function mitadHaciaAfuera(valor: number): number {
  return valor >= 0 ? Math.floor(valor + 0.5) : Math.ceil(valor - 0.5);
}

/** `round()` de PHP 8.3 con 0 decimales (igual que `redondearPhp` de la librería). */
export function redondearPhp(valor: number): number {
  if (!Number.isFinite(valor) || valor === 0) return valor;
  const precision = 14 - log10EnteroAbs(valor);
  let tmp: number;
  if (precision > 0 && precision < 15) {
    const p = 10 ** precision;
    tmp = mitadHaciaAfuera(valor * p) / p;
  } else {
    tmp = valor;
    if (Math.abs(tmp) >= 1e15) return valor;
  }
  return mitadHaciaAfuera(tmp);
}

// --- Lo que devuelven las acciones de `/[org]/emitir` ------------------------------------

/** Nivel de la emisión: `ensayo` valida y resume sin asignar folio; `emitir` es ⚠️. */
export type NivelEmision = 'ensayo' | 'emitir';

/** Resumen del ensayo para el `Dialogo` (incluye el folio que se asignaría, sin reservarlo). */
export interface ResumenEmision extends Omit<ResumenEnsayo, 'operacion' | 'ambiente'> {
  operacion: 'emitir';
  ambiente: AmbienteSii;
  /** Folio que se asignaría hoy (`null` si no hay CAF con folios). No se reserva. */
  folioPrevisto: number | null;
  totales: Totales;
}

/** Documento emitido (o que quedó a medio camino), para la pantalla de resultado. */
export interface DocumentoEmitido {
  id: string;
  tipoDte: TipoFolio;
  ambiente: AmbienteSii;
  folio: number;
  estado: EstadoDocumento;
  total: number;
  trackId: string | null;
  /** Hay PDF guardado (si falló al generarlo, la emisión igual vale). */
  conPdf: boolean;
  /** Se envió (o encoló) el correo al receptor. */
  correoEnviado: boolean;
}

export type ResultadoEmision =
  | { tipo: 'ensayo'; resumen: ResumenEmision }
  | {
      tipo: 'borrador';
      /** Borrador guardado (RLS directo). */
      documentoId: string;
      mensaje: { titulo: string; detalle: string };
    }
  | {
      tipo: 'ok';
      mensaje: { titulo: string; detalle: string };
      documento: DocumentoEmitido;
      operacionId: string | null;
      avisos?: string[];
    }
  | {
      tipo: 'error';
      mensaje: { titulo: string; detalle: string };
      /** `incierto`: no se sabe si el SII recibió la boleta; NO reemitir a ciegas. */
      resultado?: Exclude<Database['public']['Enums']['resultado_operacion'], 'en_curso' | 'ok'>;
      motivo?: string;
      operacionId: string | null;
      /** Documento que quedó registrado (p. ej. `incierto`), si lo hay. */
      documento?: DocumentoEmitido;
      errores?: Record<string, string>;
    };

/** RUT para mostrar del receptor (`66.666.666-6`). */
export function rutReceptorParaMostrar(rut: string): string {
  return formatearRut(rut === '' ? RECEPTOR_GENERICO.rut : rut);
}

// --- Vista de `/[org]/emitir` (la arma `server/emision`, la consume la página) ----------

/** Folios de un tipo en un ambiente, para el resumen («folio que se asignará»). */
export interface FoliosEmision {
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  /** `siguiente_folio` del CAF que usaría `asignar_folio` (`null` si no hay folios). */
  siguiente: number | null;
  disponibles: number;
  total: number;
  /** Mismo criterio que el `MedidorFolios` (Fase 6). */
  estado: EstadoFolios;
  /** Falso si se agotaron (el botón de emitir se deshabilita, guía del `MedidorFolios`). */
  puedeEmitir: boolean;
}

/** Por qué no se puede emitir en un ambiente (la UI lo explica antes de que choque). */
export type MotivoAmbienteBloqueado =
  | 'empresa_inactiva'
  | 'sin_autorizacion'
  | 'plan_sin_produccion'
  | 'sin_resolucion'
  | 'sin_certificado';

export interface AmbienteEmision {
  ambiente: AmbienteSii;
  habilitado: boolean;
  motivo: MotivoAmbienteBloqueado | null;
  /** Resolución vigente de la carátula (`null` si falta). */
  resolucion: { numero: number; fecha: string } | null;
}

export interface BorradorGuardado {
  id: string;
  tipoDte: TipoFolio;
  ambiente: AmbienteSii;
  receptorRut: string;
  receptorRazonSocial: string | null;
  total: number;
  actualizadoEn: string;
}

export interface VistaEmision {
  empresa: {
    id: string;
    rut: string;
    razonSocial: string;
    activa: boolean;
    autorizadaProduccion: boolean;
  };
  /** Certificado vigente con que se firma (`null` si no hay: no se puede emitir). */
  certificado: { titular: string; rut: string; vigenteHasta: string } | null;
  /** Los dos ambientes, producción primero. */
  ambientes: AmbienteEmision[];
  /** 39 y 41 en los dos ambientes. */
  folios: FoliosEmision[];
  /** Borradores recientes de la empresa (los más nuevos primero, hasta 10). */
  borradores: BorradorGuardado[];
  /** El borrador pedido con `?borrador=<id>`, ya en la forma del formulario. */
  borrador: { id: string; datos: Borrador } | null;
}

export interface ReceptorCatalogo {
  id: string;
  rut: string;
  razonSocial: string;
  correo: string | null;
}

export interface ProductoCatalogo {
  id: string;
  codigo: string | null;
  nombre: string;
  /** Precio bruto (IVA incluido). */
  precio: number;
  exento: boolean;
  unidad: string | null;
}

/** Archivos descargables de un documento emitido (URL firmada de corta duración). */
export type ArchivoDocumento = 'xml' | 'pdf_carta' | 'pdf_rollo';
