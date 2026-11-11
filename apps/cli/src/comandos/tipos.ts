// Contrato común de los comandos de la CLI.

import type { ParseArgsOptionsConfig } from 'node:util';
import type { Ambiente } from '@winex/certificacion';
import type { Config } from '../config.ts';
import type { Contexto } from '../contexto.ts';
import { type CodigoSalida, ErrorUso } from '../errores.ts';

export type Grupo = 'certificacion' | 'produccion' | 'util';

export type ValorOpcion = string | boolean | (string | boolean)[] | undefined;

export interface EntradaComando {
  /** Opciones ya validadas por `parseArgs` (modo estricto). */
  readonly opciones: Readonly<Record<string, ValorOpcion>>;
  readonly posicionales: readonly string[];
  /**
   * Configuración (`.env` + entorno). Se carga al primer uso: un comando que no
   * necesita config (p. ej. la ayuda) no falla si el `.env` está mal.
   */
  readonly config: () => Config;
}

export interface DefinicionComando {
  readonly grupo: Grupo;
  readonly nombre: string;
  /** Una línea, para el listado de comandos. */
  readonly resumen: string;
  /**
   * Ayuda completa: sintaxis, opciones, variables del `.env` que usa y qué sale al
   * SII. Se muestra con `--ayuda` y junto a un error de uso.
   */
  readonly ayuda: string;
  /** Opciones propias (las globales `--env` y `--ayuda` se agregan solas). */
  readonly opciones: ParseArgsOptionsConfig;
  /** Cantidad de argumentos posicionales aceptados. Por defecto, ninguno. */
  readonly posicionales?: { readonly min: number; readonly max: number };
  /** Devuelve el código de salida (por defecto `CODIGOS.OK`) o lanza. */
  ejecutar(ctx: Contexto, entrada: EntradaComando): Promise<CodigoSalida | undefined>;
}

/** Opciones que aceptan todos los comandos. */
export const OPCIONES_GLOBALES = Object.freeze({
  env: { type: 'string' },
  ayuda: { type: 'boolean', short: 'h' },
} satisfies ParseArgsOptionsConfig);

// --- Lectura de opciones --------------------------------------------------------

/** Valor de una opción de texto, o `undefined` si no vino. */
export function opcionTexto(entrada: EntradaComando, nombre: string): string | undefined {
  const v = entrada.opciones[nombre];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ErrorUso(`--${nombre} necesita un valor.`);
  return v;
}

/** `true` si vino la opción booleana. */
export function opcionBooleana(entrada: EntradaComando, nombre: string): boolean {
  return entrada.opciones[nombre] === true;
}

/** Valor de una opción que solo admite ciertos valores. */
export function opcionEnum<const T extends string>(
  entrada: EntradaComando,
  nombre: string,
  valores: readonly T[],
  porDefecto: T,
): T {
  const v = opcionTexto(entrada, nombre);
  if (v === undefined) return porDefecto;
  if (!(valores as readonly string[]).includes(v)) {
    throw new ErrorUso(`--${nombre} debe ser ${valores.join(' o ')}.`);
  }
  return v as T;
}

/** Entero ≥ 1 de una opción, o `undefined` si no vino. */
export function opcionEntero(entrada: EntradaComando, nombre: string): number | undefined {
  const v = opcionTexto(entrada, nombre);
  if (v === undefined) return undefined;
  if (!/^[0-9]+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1) {
    throw new ErrorUso(`--${nombre} debe ser un entero positivo.`);
  }
  return Number(v);
}

/** `--ambiente certificacion|produccion`, con el valor por defecto indicado. */
export function opcionAmbiente(entrada: EntradaComando, porDefecto: Ambiente): Ambiente {
  return opcionEnum(entrada, 'ambiente', ['certificacion', 'produccion'] as const, porDefecto);
}
