import { z } from 'zod';

// Validación de las pantallas de acceso. Pura: la usan el formulario (antes de enviar)
// y la Server Action (siempre, porque al servidor se le puede enviar cualquier cosa).

export const LARGO_MINIMO_CLAVE = 8;
/** Supabase Auth (bcrypt) no acepta contraseñas de más de 72 caracteres. */
export const LARGO_MAXIMO_CLAVE = 72;

export const MENSAJES_VALIDACION = {
  correoVacio: 'Escribe tu correo electrónico.',
  correoInvalido: 'Revisa el correo: debe tener la forma nombre@empresa.cl.',
  claveVacia: 'Escribe tu contraseña.',
  claveCorta: `La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`,
  claveLarga: `La contraseña puede tener hasta ${LARGO_MAXIMO_CLAVE} caracteres.`,
  nombreVacio: 'Escribe tu nombre.',
  nombreLargo: 'El nombre puede tener hasta 100 caracteres.',
} as const;

const M = MENSAJES_VALIDACION;

const correo = z
  .string({ error: M.correoVacio })
  .trim()
  .min(1, M.correoVacio)
  .max(254, M.correoInvalido)
  .pipe(z.email(M.correoInvalido));

// Las contraseñas no se recortan: un espacio es un carácter válido.
const claveActual = z.string({ error: M.claveVacia }).min(1, M.claveVacia);

const claveNueva = z
  .string({ error: M.claveCorta })
  .min(LARGO_MINIMO_CLAVE, M.claveCorta)
  .max(LARGO_MAXIMO_CLAVE, M.claveLarga);

const nombre = z
  .string({ error: M.nombreVacio })
  .trim()
  .min(1, M.nombreVacio)
  .max(100, M.nombreLargo);

export const esquemaIngresar = z.object({ correo, clave: claveActual });
export const esquemaEnlace = z.object({ correo });
export const esquemaCrearCuenta = z.object({ nombre, correo, clave: claveNueva });
export const esquemaRecuperar = z.object({ correo });
export const esquemaRestablecer = z.object({ clave: claveNueva });

export type CampoAuth = 'nombre' | 'correo' | 'clave';
/** Un mensaje por campo (el primero que falló). */
export type ErroresCampos = Partial<Record<CampoAuth, string>>;

export type ResultadoValidacion<T> = { ok: true; datos: T } | { ok: false; errores: ErroresCampos };

/** Valida y devuelve el primer error de cada campo. */
export function validar<T extends z.ZodType>(
  esquema: T,
  entrada: unknown,
): ResultadoValidacion<z.infer<T>> {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return { ok: true, datos: resultado.data };
  const errores: ErroresCampos = {};
  for (const problema of resultado.error.issues) {
    const campo = problema.path[0];
    if (typeof campo === 'string' && !(campo in errores)) {
      errores[campo as CampoAuth] = problema.message;
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
