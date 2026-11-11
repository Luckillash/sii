// Configuración de la CLI: archivo `.env` + entorno, validados con zod
// (PLAN-MIGRACION.md fase 7, pend. 5: nada de RUT, CAF, folios ni FchResol fijos).
//
// Reglas:
// - El `.env` se busca en `--env <ruta>` o, por defecto, en `<cwd>/.env`. Si no
//   existe (y no se pidió con `--env`), valen solo las variables del entorno.
// - Las variables del entorno del proceso ganan sobre las del archivo.
// - Una variable vacía cuenta como faltante.
// - Las rutas del `.env` se resuelven contra la carpeta del `.env`; las de los
//   argumentos, contra el `cwd`.
// - Cada comando valida SOLO las variables que usa, y los errores nombran todas
//   las que faltan de una vez. Nunca se muestran valores (pueden ser secretos).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import {
  type Ambiente,
  Certificado,
  type EmisorBoleta,
  ErrorCertificado,
  Rut,
  type TokenStore,
  TokenStoreArchivo,
} from '@winex/certificacion';
import { z } from 'zod';
import type { Contexto } from './contexto.ts';
import { ErrorConfig } from './errores.ts';

export interface Config {
  /** Ruta absoluta del `.env` leído, o `undefined` si no había. */
  readonly archivoEnv: string | undefined;
  /** Carpeta contra la que se resuelven las rutas que vienen del `.env`. */
  readonly base: string;
  /** Carpeta contra la que se resuelven las rutas de los argumentos. */
  readonly cwd: string;
  /** Variables efectivas (archivo + entorno). No se imprimen nunca. */
  readonly variables: Readonly<Record<string, string | undefined>>;
}

/** Lee el `.env` (si hay) y lo combina con el entorno del proceso. */
export function cargarConfig(ctx: Contexto, rutaEnv?: string): Config {
  const ruta = resolve(ctx.cwd, rutaEnv ?? '.env');
  const existe = existsSync(ruta);
  let archivo: Record<string, string> = {};
  if (existe) {
    try {
      archivo = parseEnv(readFileSync(ruta, 'utf8')) as Record<string, string>;
    } catch (error) {
      throw new ErrorConfig(`No se pudo leer el archivo de configuración ${ruta}.`, {
        cause: error,
      });
    }
  } else if (rutaEnv !== undefined) {
    throw new ErrorConfig(`No existe el archivo de configuración ${ruta}.`);
  }
  return {
    archivoEnv: existe ? ruta : undefined,
    base: existe ? dirname(ruta) : ctx.cwd,
    cwd: ctx.cwd,
    variables: { ...archivo, ...ctx.entorno },
  };
}

// --- Esquemas de campos reutilizables -------------------------------------------

const vacioAIndefinido = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v;

/** Texto no vacío (recortado). */
export const texto = z.preprocess(vacioAIndefinido, z.string({ error: 'falta' }));

/** RUT válido; sale normalizado como `76123456-0`. */
export const rut = texto
  .refine((v) => Rut.esValido(v), 'no es un RUT válido')
  .transform((v) => Rut.de(v).toString());

/** Fecha `AAAA-MM-DD` que existe en el calendario. */
export const fecha = texto.refine((v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}, 'debe ser una fecha AAAA-MM-DD');

/** Entero ≥ 1 escrito en decimal. */
export const enteroPositivo = texto
  .refine((v) => /^[0-9]+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= 1, {
    error: 'debe ser un entero positivo',
  })
  .transform(Number);

/** Entero ≥ 0 escrito en decimal (`NroResol` de certificación es 0). */
export const enteroNoNegativo = texto
  .refine((v) => /^[0-9]+$/.test(v) && Number.isSafeInteger(Number(v)), {
    error: 'debe ser un entero sin signo',
  })
  .transform((v) => String(Number(v)));

/** Correo con la forma `algo@dominio.tld`. */
export const correo = texto.refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
  error: 'no es un correo válido',
});

/** Campo opcional: vacío o ausente → `undefined`. */
export function opcional<T extends z.ZodType>(esquema: T) {
  return z.preprocess(vacioAIndefinido, esquema.optional());
}

/** Campo con valor por defecto si está vacío o ausente. */
export function conDefecto<T extends z.ZodType>(esquema: T, porDefecto: string) {
  return z.preprocess((v) => vacioAIndefinido(v) ?? porDefecto, esquema);
}

// --- Lectura validada -----------------------------------------------------------

type Esquemas = Readonly<Record<string, z.ZodType>>;
type Salida<T extends Esquemas> = { [K in keyof T]: z.output<T[K]> };

/**
 * Valor que viene de una opción de la línea de comandos y que reemplaza a la
 * variable del `.env` (p. ej. `--fch-resol` en vez de `SII_FCH_RESOL`).
 */
export interface Sobrescritura {
  readonly valor: string | undefined;
  /** Nombre de la opción, para los mensajes (`--fch-resol`). */
  readonly opcion: string;
}

/**
 * Valida un grupo de variables. Las claves de `esquemas` son los nombres de las
 * variables del `.env`. `sobrescrituras` permite que una opción de la línea de
 * comandos reemplace una variable. Lanza `ErrorConfig` con todas las variables
 * que fallan (sin sus valores).
 */
export function leerVariables<T extends Esquemas>(
  config: Config,
  esquemas: T,
  sobrescrituras: Partial<Record<keyof T, Sobrescritura>> = {},
): Salida<T> {
  const salida: Record<string, unknown> = {};
  const problemas: string[] = [];
  for (const [nombre, esquema] of Object.entries(esquemas)) {
    const sobre = sobrescrituras[nombre as keyof T];
    const desdeOpcion = sobre?.valor !== undefined;
    const r = esquema.safeParse(desdeOpcion ? sobre.valor : config.variables[nombre]);
    if (r.success) {
      salida[nombre] = r.data;
    } else {
      const motivo = r.error.issues[0]?.message ?? 'inválida';
      const origen = desdeOpcion
        ? sobre.opcion
        : sobre === undefined
          ? nombre
          : `${nombre} (o ${sobre.opcion})`;
      problemas.push(`${origen}: ${motivo}`);
    }
  }
  if (problemas.length > 0) {
    const donde = config.archivoEnv ?? 'el entorno (no se encontró un .env)';
    throw new ErrorConfig(
      `Configuración inválida en ${donde}:\n  - ${problemas.join('\n  - ')}\nVer .env.example.`,
    );
  }
  return salida as Salida<T>;
}

/** Ruta absoluta de un valor del `.env` (relativo a la carpeta del `.env`). */
export function rutaDelEnv(config: Config, valor: string): string {
  return isAbsolute(valor) ? valor : resolve(config.base, valor);
}

/** Ruta absoluta de un argumento (relativo al `cwd`). */
export function rutaDelArgumento(config: Config, valor: string): string {
  return isAbsolute(valor) ? valor : resolve(config.cwd, valor);
}

/**
 * Ruta de un archivo que puede venir de una opción (relativa al `cwd`) o de una
 * variable del `.env` (relativa al `.env`). Exige que exista.
 */
export function rutaArchivo(
  config: Config,
  variable: string,
  sobrescritura?: Sobrescritura,
): string {
  const { [variable]: valor } = leerVariables(
    config,
    { [variable]: texto },
    sobrescritura ? { [variable]: sobrescritura } : {},
  );
  const ruta =
    sobrescritura?.valor !== undefined
      ? rutaDelArgumento(config, valor as string)
      : rutaDelEnv(config, valor as string);
  if (!existsSync(ruta)) {
    const origen = sobrescritura?.valor !== undefined ? sobrescritura.opcion : variable;
    throw new ErrorConfig(`No existe el archivo indicado en ${origen}: ${ruta}`);
  }
  return ruta;
}

/** Lee un archivo que tiene que existir; si no, `ErrorConfig`. */
export function leerArchivo(ruta: string, que: string): Buffer {
  try {
    return readFileSync(ruta);
  } catch (error) {
    throw new ErrorConfig(`No se pudo leer ${que}: ${ruta}`, { cause: error });
  }
}

// --- Grupos de configuración que comparten los comandos -------------------------

/** Certificado digital (`SII_CERT_PATH`, `SII_CERT_PASS`). */
export async function cargarCertificado(config: Config): Promise<Certificado> {
  const ruta = rutaArchivo(config, 'SII_CERT_PATH');
  const clave = config.variables.SII_CERT_PASS ?? '';
  try {
    return await Certificado.desdeArchivo(ruta, clave);
  } catch (error) {
    if (error instanceof ErrorCertificado) throw error;
    throw new ErrorConfig('No se pudo leer el certificado de SII_CERT_PATH.', { cause: error });
  }
}

/** Empresa emisora y titular del certificado que envía. */
export function configEmpresa(
  config: Config,
  sobrescrituras: { rutEmpresa?: Sobrescritura } = {},
): { rutEmpresa: string; rutEnvia: string } {
  const v = leerVariables(
    config,
    { SII_RUT_EMPRESA: rut, SII_RUT_FIRMA: rut },
    sobrescrituras.rutEmpresa ? { SII_RUT_EMPRESA: sobrescrituras.rutEmpresa } : {},
  );
  return { rutEmpresa: v.SII_RUT_EMPRESA, rutEnvia: v.SII_RUT_FIRMA };
}

/** Datos del emisor para la boleta (`EMISOR_*`; el RUT es `SII_RUT_EMPRESA`). */
export function configEmisor(config: Config): EmisorBoleta {
  const v = leerVariables(config, {
    SII_RUT_EMPRESA: rut,
    EMISOR_RAZON_SOCIAL: texto,
    EMISOR_GIRO: texto,
    EMISOR_DIRECCION: texto,
    EMISOR_COMUNA: texto,
  });
  return {
    rut: v.SII_RUT_EMPRESA,
    razonSocial: v.EMISOR_RAZON_SOCIAL,
    giro: v.EMISOR_GIRO,
    direccion: v.EMISOR_DIRECCION,
    comuna: v.EMISOR_COMUNA,
  };
}

/**
 * Resolución que va en la carátula del sobre (y del RCOF). Una sola fecha para
 * ambos (decisión 5 de la fase 3).
 * - certificación: `SII_NRO_RESOL` (por defecto 0) y `SII_FCH_RESOL`;
 * - producción: `SII_PRODUCCION_NRO_RESOL` y `SII_PRODUCCION_FCH_RESOL`, sin
 *   valores por defecto (son los de la autorización de la empresa).
 */
export function configResolucion(
  config: Config,
  ambiente: Ambiente,
  sobrescrituras: { nroResol?: string | undefined; fchResol?: string | undefined } = {},
): { nroResol: string; fchResol: string } {
  const [nro, fch] =
    ambiente === 'certificacion'
      ? (['SII_NRO_RESOL', 'SII_FCH_RESOL'] as const)
      : (['SII_PRODUCCION_NRO_RESOL', 'SII_PRODUCCION_FCH_RESOL'] as const);
  const v = leerVariables(
    config,
    {
      [nro]: ambiente === 'certificacion' ? conDefecto(enteroNoNegativo, '0') : enteroNoNegativo,
      [fch]: fecha,
    } as Record<string, z.ZodType<string>>,
    {
      [nro]: { valor: sobrescrituras.nroResol, opcion: '--nro-resol' },
      [fch]: { valor: sobrescrituras.fchResol, opcion: '--fch-resol' },
    },
  );
  return { nroResol: v[nro] as string, fchResol: v[fch] as string };
}

/**
 * Caché de tokens entre ejecuciones (`SII_CACHE_TOKENS`, ruta de un archivo JSON).
 * Sin la variable, cada ejecución pide su token. El archivo guarda tokens
 * vigentes: protegerlo como una credencial.
 */
export function configTokenStore(config: Config): TokenStore | undefined {
  const valor = config.variables.SII_CACHE_TOKENS?.trim();
  if (!valor) return undefined;
  const ruta = rutaDelEnv(config, valor);
  if (!existsSync(dirname(ruta))) {
    throw new ErrorConfig(`No existe la carpeta de SII_CACHE_TOKENS: ${dirname(ruta)}`);
  }
  return new TokenStoreArchivo(ruta);
}
