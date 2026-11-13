import { z } from 'zod';
import {
  caracteresFueraDeIso88591,
  correoSiiValido,
  hoyEnChile,
  LARGO_MAXIMO_CORREO_SII,
  rutSii,
  rutValidoSii,
} from '@/lib/formatos';
import type { Database } from '@/server/supabase/tipos';

// Validación de empresas y resoluciones (PLAN-SAAS Fase 3, puntos 1 y 4). Pura: la usan
// las Server Actions (siempre) y los formularios (para los topes de largo). Cada regla
// es espejo de supabase/migrations/0001_esquema_inicial.sql §2 y §6:
//
//   empresas.rut                dominio `rut` (rut_valido): 1-8 dígitos, guion, DV con K
//   empresas.razon_social       check length between 1 and 100   (<RznSocEmisor>)
//   empresas.giro               check length between 1 and 80    (<GiroEmisor>)
//   empresas.direccion          check length between 1 and 70    (<DirOrigen>)
//   empresas.comuna             check length between 1 and 20    (<CmnaOrigen>)
//   empresas.correo_intercambio dominio `correo_sii` (correo_sii_valido), opcional
//
// Además, más estricto que la base: razón social, giro, dirección y comuna solo con
// caracteres de ISO-8859-1, la codificación en que se firma el DTE (sin emoji, €,
// comillas tipográficas, rayas, etc.). El correo ya es ASCII por su propia regla.
//   resoluciones.numero         check numero >= 0 y (ambiente = 'produccion' or numero = 0)
//
// `length()` de Postgres cuenta caracteres (puntos de código), no unidades UTF-16: por
// eso los largos se miden con `[...texto].length` y no con `.max()` de zod.

export type Ambiente = Database['public']['Enums']['ambiente_sii'];

export const AMBIENTES = ['certificacion', 'produccion'] as const satisfies readonly Ambiente[];

export const ETIQUETA_AMBIENTE: Record<Ambiente, string> = {
  certificacion: 'Certificación',
  produccion: 'Producción',
};

export const LARGOS_EMPRESA = {
  razonSocial: 100,
  giro: 80,
  direccion: 70,
  comuna: 20,
  correoIntercambio: LARGO_MAXIMO_CORREO_SII,
} as const;

/** Tope de `integer` en Postgres (columna `resoluciones.numero`). */
export const NUMERO_RESOLUCION_MAXIMO = 2_147_483_647;

export const MENSAJES_EMPRESA = {
  rutVacio: 'Escribe el RUT de la empresa.',
  rutInvalido: 'Revisa el RUT: escríbelo como 76.354.771-K.',
  rutDv: 'El dígito verificador no corresponde a este RUT. Revisa que esté bien escrito.',
  razonSocialVacia: 'Escribe la razón social tal como figura en el SII.',
  razonSocialLarga: `La razón social puede tener hasta ${LARGOS_EMPRESA.razonSocial} caracteres, el máximo que acepta el SII.`,
  giroVacio: 'Escribe el giro tal como figura en el SII.',
  giroLargo: `El giro puede tener hasta ${LARGOS_EMPRESA.giro} caracteres, el máximo que acepta el SII. Si el tuyo es más largo, escribe la actividad principal.`,
  direccionVacia: 'Escribe la dirección desde donde emites.',
  direccionLarga: `La dirección puede tener hasta ${LARGOS_EMPRESA.direccion} caracteres.`,
  comunaVacia: 'Escribe la comuna.',
  comunaLarga: `La comuna puede tener hasta ${LARGOS_EMPRESA.comuna} caracteres.`,
  correoLargo: `El correo puede tener hasta ${LARGO_MAXIMO_CORREO_SII} caracteres.`,
  correoInvalido:
    'Revisa el correo: debe tener la forma dte@empresa.cl, sin espacios, tildes ni signos como # $ % & / ( ) = ? + *.',
} as const;

export const MENSAJES_RESOLUCION = {
  ambiente: 'Elige el ambiente: Certificación o Producción.',
  numeroVacio: 'Escribe el número de la resolución de producción.',
  numeroEntero: 'Escribe el número sin puntos ni letras, por ejemplo 80.',
  numeroCero:
    'En producción el número de resolución es mayor que 0. El 0 es solo para certificación.',
  numeroGrande: 'Revisa el número de resolución: es demasiado grande.',
  fechaVacia: 'Elige la fecha de la resolución.',
  fechaInvalida: 'Revisa la fecha: no es una fecha válida.',
  fechaFutura:
    'La fecha de la resolución no puede ser posterior a hoy. Revisa la que te entregó el SII.',
} as const;

const ME = MENSAJES_EMPRESA;
const MR = MENSAJES_RESOLUCION;

/** Largo como lo mide `length()` de Postgres: caracteres, no unidades UTF-16. */
export function largoEnCaracteres(texto: string): number {
  return [...texto].length;
}

/** Cuántos caracteres rechazados se nombran en el mensaje, como máximo. */
const MAXIMO_CARACTERES_EN_MENSAJE = 5;

/**
 * Mensaje para un texto con caracteres fuera de ISO-8859-1: nombra cuáles (hasta 5) y
 * qué hacer. El DTE se firma en ISO-8859-1, así que no se aceptan.
 */
export function mensajeFueraDeIso(caracteres: readonly string[]): string {
  const lista = caracteres
    .slice(0, MAXIMO_CARACTERES_EN_MENSAJE)
    .map((c) => `«${c}»`)
    .join(', ');
  const cuales =
    caracteres.length === 1
      ? 'un carácter que no se puede usar'
      : 'caracteres que no se pueden usar';
  return `Tiene ${cuales} en un documento tributario: ${lista}. Quita los emoji y símbolos especiales, o cámbialos por letras, números o signos comunes (por ejemplo, comillas rectas " y guion -).`;
}

function textoObligatorio(maximo: number, vacio: string, largo: string) {
  return z
    .string({ error: vacio })
    .trim()
    .min(1, vacio)
    .superRefine((s, ctx) => {
      const fuera = caracteresFueraDeIso88591(s);
      if (fuera.length > 0) ctx.addIssue({ code: 'custom', message: mensajeFueraDeIso(fuera) });
    })
    .refine((s) => largoEnCaracteres(s) <= maximo, largo);
}

/**
 * RUT como lo guarda el dominio `rut`: acepta `76.354.771-k`, `76354771K` o con
 * espacios, y devuelve `76354771-K`. Solo se admiten dígitos, K, puntos, guion y
 * espacios: cualquier otra cosa es un error, no se descarta en silencio.
 */
export const esquemaRut = z.string({ error: ME.rutVacio }).transform((valor, ctx) => {
  const texto = valor.trim();
  if (texto === '') {
    ctx.addIssue({ code: 'custom', message: ME.rutVacio });
    return z.NEVER;
  }
  const normalizado = rutSii(texto);
  if (!/^[0-9kK.\-\s]+$/.test(texto) || !/^[0-9]{1,8}-[0-9K]$/.test(normalizado)) {
    ctx.addIssue({ code: 'custom', message: ME.rutInvalido });
    return z.NEVER;
  }
  if (!rutValidoSii(normalizado)) {
    ctx.addIssue({ code: 'custom', message: ME.rutDv });
    return z.NEVER;
  }
  return normalizado;
});

/** Correo de intercambio: vacío = `null`; si no, la regla `correo_sii_valido`. */
export const esquemaCorreoIntercambio = z
  .string()
  .optional()
  .transform((valor, ctx): string | null => {
    const texto = (valor ?? '').trim();
    if (texto === '') return null;
    if (texto.length > LARGO_MAXIMO_CORREO_SII) {
      ctx.addIssue({ code: 'custom', message: ME.correoLargo });
      return z.NEVER;
    }
    if (!correoSiiValido(texto)) {
      ctx.addIssue({ code: 'custom', message: ME.correoInvalido });
      return z.NEVER;
    }
    return texto;
  });

const camposEditables = {
  razonSocial: textoObligatorio(
    LARGOS_EMPRESA.razonSocial,
    ME.razonSocialVacia,
    ME.razonSocialLarga,
  ),
  giro: textoObligatorio(LARGOS_EMPRESA.giro, ME.giroVacio, ME.giroLargo),
  direccion: textoObligatorio(LARGOS_EMPRESA.direccion, ME.direccionVacia, ME.direccionLarga),
  comuna: textoObligatorio(LARGOS_EMPRESA.comuna, ME.comunaVacia, ME.comunaLarga),
  correoIntercambio: esquemaCorreoIntercambio,
};

/** Alta: todos los campos. */
export const esquemaEmpresa = z.object({ rut: esquemaRut, ...camposEditables });

/** Edición: el RUT no se cambia (si hay que cambiarlo, se crea otra empresa). */
export const esquemaEdicionEmpresa = z.object(camposEditables);

export const CAMPOS_EMPRESA = [
  'rut',
  'razonSocial',
  'giro',
  'direccion',
  'comuna',
  'correoIntercambio',
] as const;

export type CampoEmpresa = (typeof CAMPOS_EMPRESA)[number];
export type ValoresEmpresa = Record<CampoEmpresa, string>;
export type DatosEmpresa = z.infer<typeof esquemaEmpresa>;
export type DatosEdicionEmpresa = z.infer<typeof esquemaEdicionEmpresa>;

/** `AAAA-MM-DD` que existe en el calendario (no `2026-02-30`). */
export function esFechaIso(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function esquemaFecha(hoy: string) {
  return z
    .string({ error: MR.fechaVacia })
    .trim()
    .min(1, MR.fechaVacia)
    .refine(esFechaIso, { message: MR.fechaInvalida, abort: true })
    .refine((f) => f <= hoy, MR.fechaFutura);
}

const esquemaNumeroProduccion = z
  .string({ error: MR.numeroVacio })
  .trim()
  .min(1, MR.numeroVacio)
  .regex(/^\d+$/, MR.numeroEntero)
  .transform(Number)
  .pipe(z.number().int().min(1, MR.numeroCero).max(NUMERO_RESOLUCION_MAXIMO, MR.numeroGrande));

/**
 * Resolución del SII para la carátula. En certificación el SII entrega solo la fecha:
 * el número es siempre 0 (lo que venga en `numero` se ignora; el campo va deshabilitado
 * y no viaja en el formulario). En producción, un entero mayor que 0. La fecha no puede
 * ser futura, contada en hora de Chile.
 *
 * @param hoy `AAAA-MM-DD` de hoy en Chile (por defecto, `hoyEnChile()`).
 */
export function esquemaResolucion(hoy: string = hoyEnChile()) {
  const fecha = esquemaFecha(hoy);
  return z
    .object({
      ambiente: z.enum(AMBIENTES, { error: MR.ambiente }),
      numero: z.unknown().optional(),
      fecha: z.unknown().optional(),
    })
    .transform((d, ctx) => {
      // Número y fecha se validan por separado para informar los dos errores a la vez.
      const resultadoFecha = fecha.safeParse(d.fecha ?? '');
      const resultadoNumero =
        d.ambiente === 'produccion'
          ? esquemaNumeroProduccion.safeParse(d.numero ?? '')
          : ({ success: true, data: 0 } as const);
      for (const [campo, r] of [
        ['fecha', resultadoFecha],
        ['numero', resultadoNumero],
      ] as const) {
        if (r.success) continue;
        for (const issue of r.error.issues) {
          ctx.addIssue({ code: 'custom', path: [campo], message: issue.message });
        }
      }
      if (!resultadoFecha.success || !resultadoNumero.success) return z.NEVER;
      return { ambiente: d.ambiente, numero: resultadoNumero.data, fecha: resultadoFecha.data };
    });
}

export type CampoResolucion = 'ambiente' | 'numero' | 'fecha';
export type DatosResolucion = z.output<ReturnType<typeof esquemaResolucion>>;

export type ResultadoValidacion<T, C extends string> =
  | { ok: true; datos: T }
  | { ok: false; errores: Partial<Record<C, string>> };

/** Valida y devuelve el primer error de cada campo (como `(auth)/_compartido/esquemas.ts`). */
export function validarCampos<T extends z.ZodType, C extends string>(
  esquema: T,
  entrada: unknown,
): ResultadoValidacion<z.output<T>, C> {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return { ok: true, datos: resultado.data };
  const errores: Partial<Record<C, string>> = {};
  for (const issue of resultado.error.issues) {
    const campo = issue.path[0];
    if (typeof campo === 'string' && !(campo in errores)) {
      errores[campo as C] = issue.message;
    }
  }
  return { ok: false, errores };
}

/** Los campos de texto de un FormData (lo que no es texto queda como `''`). */
export function leerCampos<C extends string>(
  datos: FormData,
  campos: readonly C[],
): Record<C, string> {
  const salida = {} as Record<C, string>;
  for (const campo of campos) {
    const valor = datos.get(campo);
    salida[campo] = typeof valor === 'string' ? valor : '';
  }
  return salida;
}
