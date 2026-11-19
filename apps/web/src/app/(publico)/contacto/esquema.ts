import { z } from 'zod';
import { formatearRut, rutSii, rutValidoSii } from '@/lib/formatos';

// Formulario de contacto del sitio público (PLAN-SAAS Fase 12, punto 4). Puro: lo usan
// el formulario (topes de largo, motivos) y la Server Action (siempre valida, porque al
// servidor se le puede enviar cualquier cosa). Sin `server-only`.

export const MOTIVOS_CONTACTO = [
  'ventas',
  'soporte',
  'certificacion',
  'privacidad',
  'otro',
] as const;

export type MotivoContacto = (typeof MOTIVOS_CONTACTO)[number];

/** Como se ve en el formulario y en el cuerpo del correo al equipo. */
export const ETIQUETA_MOTIVO: Record<MotivoContacto, string> = {
  ventas: 'Ventas / plan Empresa',
  soporte: 'Soporte',
  certificacion: 'Certificación',
  privacidad: 'Privacidad y datos personales',
  otro: 'Otro',
};

/** Versión corta para el asunto: `[Contacto · Ventas] Camila Rojas`. */
export const ASUNTO_MOTIVO: Record<MotivoContacto, string> = {
  ventas: 'Ventas',
  soporte: 'Soporte',
  certificacion: 'Certificación',
  privacidad: 'Privacidad',
  otro: 'Otro',
};

/** `?motivo=ventas` → `'ventas'`; cualquier otro valor (o varios) → `null`. */
export function motivoDesdeParametro(valor: string | string[] | undefined): MotivoContacto | null {
  if (typeof valor !== 'string') return null;
  const v = valor.trim().toLowerCase();
  return (MOTIVOS_CONTACTO as readonly string[]).includes(v) ? (v as MotivoContacto) : null;
}

export const LARGOS_CONTACTO = {
  nombre: 100,
  correo: 254,
  empresa: 100,
  mensajeMinimo: 10,
  mensaje: 5000,
} as const;

/** Campo trampa: oculto para las personas; si llega con algo, es un bot. */
export const CAMPO_TRAMPA = 'sitio_web';

/**
 * `action` del widget de Turnstile del formulario. La acción la exige en la respuesta de
 * `siteverify`: un token resuelto en otro formulario (ingresar, invitación) no sirve aquí.
 */
export const ACCION_TURNSTILE_CONTACTO = 'contacto';

export const MENSAJES_CONTACTO = {
  nombreVacio: 'Escribe tu nombre.',
  nombreLargo: `El nombre puede tener hasta ${LARGOS_CONTACTO.nombre} caracteres.`,
  correoVacio: 'Escribe tu correo electrónico para que podamos responderte.',
  correoInvalido: 'Revisa el correo: debe tener la forma nombre@empresa.cl.',
  empresaLarga: `El nombre de la empresa puede tener hasta ${LARGOS_CONTACTO.empresa} caracteres.`,
  rutInvalido: 'Revisa el RUT: escríbelo como 76.354.771-K, o déjalo en blanco.',
  rutDv: 'El dígito verificador no corresponde a este RUT. Revisa que esté bien escrito.',
  motivo: 'Elige el motivo de tu mensaje.',
  mensajeCorto: `Cuéntanos un poco más: el mensaje necesita al menos ${LARGOS_CONTACTO.mensajeMinimo} caracteres.`,
  mensajeLargo: `El mensaje puede tener hasta ${LARGOS_CONTACTO.mensaje} caracteres. Resume lo principal y te pediremos el detalle al responderte.`,
} as const;

const M = MENSAJES_CONTACTO;

/** Opcional: vacío → `null`; si no, recortado y con tope de largo. */
function textoOpcional(maximo: number, largo: string) {
  return z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim())
    .refine((v) => v.length <= maximo, largo)
    .transform((v) => (v === '' ? null : v));
}

/**
 * RUT de la empresa, opcional. Acepta `76.354.771-k`, `76354771K` o con espacios y lo
 * devuelve formateado (`76.354.771-K`) para leerlo en el correo. Solo dígitos, K, puntos,
 * guion y espacios: lo demás es un error, no se descarta en silencio.
 */
const esquemaRutOpcional = z
  .string()
  .optional()
  .transform((valor, ctx): string | null => {
    const texto = (valor ?? '').trim();
    if (texto === '') return null;
    const normalizado = rutSii(texto);
    if (!/^[0-9kK.\-\s]+$/.test(texto) || !/^[0-9]{1,8}-[0-9K]$/.test(normalizado)) {
      ctx.addIssue({ code: 'custom', message: M.rutInvalido });
      return z.NEVER;
    }
    if (!rutValidoSii(normalizado)) {
      ctx.addIssue({ code: 'custom', message: M.rutDv });
      return z.NEVER;
    }
    return formatearRut(normalizado);
  });

export const esquemaContacto = z.object({
  nombre: z
    .string({ error: M.nombreVacio })
    .trim()
    .min(1, M.nombreVacio)
    .max(LARGOS_CONTACTO.nombre, M.nombreLargo),
  // Se normaliza una sola vez aquí (sin espacios y en minúsculas): el mismo valor va en
  // `reply_to` y en la `Idempotency-Key`.
  correo: z
    .string({ error: M.correoVacio })
    .trim()
    .toLowerCase()
    .min(1, M.correoVacio)
    .max(LARGOS_CONTACTO.correo, M.correoInvalido)
    .pipe(z.email(M.correoInvalido)),
  empresa: textoOpcional(LARGOS_CONTACTO.empresa, M.empresaLarga),
  rut: esquemaRutOpcional,
  motivo: z.enum(MOTIVOS_CONTACTO, { error: M.motivo }),
  mensaje: z
    .string({ error: M.mensajeCorto })
    .trim()
    .min(LARGOS_CONTACTO.mensajeMinimo, M.mensajeCorto)
    .max(LARGOS_CONTACTO.mensaje, M.mensajeLargo),
});

export type DatosContacto = z.output<typeof esquemaContacto>;

export const CAMPOS_CONTACTO = ['nombre', 'correo', 'empresa', 'rut', 'motivo', 'mensaje'] as const;
export type CampoContacto = (typeof CAMPOS_CONTACTO)[number];
export type ValoresContacto = Record<CampoContacto, string>;
export type ErroresContacto = Partial<Record<CampoContacto, string>>;

export type ResultadoValidacionContacto =
  | { ok: true; datos: DatosContacto }
  | { ok: false; errores: ErroresContacto };

/** Valida y devuelve el primer error de cada campo (como las demás acciones). */
export function validarContacto(entrada: unknown): ResultadoValidacionContacto {
  const resultado = esquemaContacto.safeParse(entrada);
  if (resultado.success) return { ok: true, datos: resultado.data };
  const errores: ErroresContacto = {};
  for (const issue of resultado.error.issues) {
    const campo = issue.path[0];
    if (typeof campo === 'string' && !(campo in errores)) {
      errores[campo as CampoContacto] = issue.message;
    }
  }
  return { ok: false, errores };
}

/** Los campos de texto de un FormData (lo que no es texto queda como `''`). */
export function leerCamposContacto(datos: FormData): ValoresContacto {
  const salida = {} as ValoresContacto;
  for (const campo of CAMPOS_CONTACTO) {
    const valor = datos.get(campo);
    salida[campo] = typeof valor === 'string' ? valor : '';
  }
  return salida;
}
