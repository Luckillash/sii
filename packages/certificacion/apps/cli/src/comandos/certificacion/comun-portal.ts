// Piezas comunes de los comandos del portal de certificación del SII: postulación
// (maullin) y declaración de cumplimiento (www4). Ambiente siempre certificación.
//
// Todos siguen el mismo orden: se valida TODO (opciones, `.env`, archivos de datos,
// certificado) antes de la primera petición; las operaciones que graban en el SII
// exigen `--confirmar` y, sin él, muestran lo que harían sin enviar nada.

import { existsSync, readFileSync } from 'node:fs';
import {
  type Certificado,
  DeclaracionBoletas,
  ErrorValidacion,
  type EstadoDeclaracion,
  PostulacionSii,
  type SesionSii,
} from '@winex/certificacion';
import type { z } from 'zod';
import {
  type Config,
  leerVariables,
  rut,
  rutaDelArgumento,
  type Sobrescritura,
} from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, type CodigoSalida, ErrorConfig } from '../../errores.ts';

/** Texto común de las ayudas: el login. */
export const AYUDA_LOGIN =
  'Login AUT2000 con el certificado (herculesr.sii.cl, TLS mutuo, vuelta a maullin.sii.cl).';

/** RUT de la empresa: la opción (o argumento) indicada o `SII_RUT_EMPRESA`. */
export function rutEmpresa(config: Config, sobrescritura?: Sobrescritura): string {
  return leerVariables(
    config,
    { SII_RUT_EMPRESA: rut },
    sobrescritura ? { SII_RUT_EMPRESA: sobrescritura } : {},
  ).SII_RUT_EMPRESA;
}

/** Login AUT2000 con el certificado; la sesión sirve para maullin y www4. */
export async function autenticar(ctx: Contexto, certificado: Certificado): Promise<SesionSii> {
  ctx.imprimir('Autenticando con el certificado (AUT2000)...');
  const sesion = await postulacionSii(ctx).autenticar(certificado);
  ctx.imprimir('  Sesión OK.');
  return sesion;
}

/** Cliente del asistente de postulación (maullin) con el transporte y el reloj de la CLI. */
export function postulacionSii(ctx: Contexto): PostulacionSii {
  return new PostulacionSii({ transporte: ctx.transporte(), reloj: ctx.reloj });
}

/** Cliente del portal de la declaración con el transporte y el reloj de la CLI. */
export function declaracionBoletas(ctx: Contexto): DeclaracionBoletas {
  return new DeclaracionBoletas({ transporte: ctx.transporte(), reloj: ctx.reloj });
}

/** Líneas que describen el estado de la declaración (como el bin del PHP). */
export function lineasEstado(estado: EstadoDeclaracion): string[] {
  const codigo =
    estado.codigo ??
    '(sin trámite pendiente: ya autorizada, sin postular o el usuario no la representa)';
  const glosa = estado.glosa !== '' ? ` ${estado.glosa}` : '';
  const paso = estado.paso !== null ? ` (paso ${estado.paso})` : '';
  return [
    `Empresa: ${estado.empresa}`,
    `Estado:  ${codigo}${glosa}${paso}`,
    `Declarar cumplimiento: ${estado.porDeclarar() ? 'SÍ, pendiente (P90)' : 'no corresponde'}` +
      (estado.autorizada() ? '. Autorizada en producción (P91).' : ''),
  ];
}

/** Cierre de un comando que graba y se corrió sin `--confirmar`: nada salió al SII. */
export function sinConfirmar(ctx: Contexto, repetir: string): CodigoSalida {
  ctx.imprimir('');
  ctx.imprimir('Sin --confirmar: se validó todo y NO se envió nada al SII.');
  ctx.imprimir(`Para hacerlo de verdad: ${repetir} --confirmar`);
  return CODIGOS.OK;
}

/** Agrega una indicación al mensaje de un error (conserva su clase, causa y código). */
export function conIndicacion<E extends Error>(error: E, indicacion: string): E {
  error.message = `${error.message}\n${indicacion}`;
  return error;
}

/**
 * Ejecuta `crear` (el constructor de `DatosPostulacion` / `DatosDeclaracion`) y
 * convierte su `ErrorValidacion` en `ErrorConfig` (código 3: nada salió al SII).
 */
export function validarDatos<T>(origen: string, crear: () => T): T {
  try {
    return crear();
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      throw new ErrorConfig(`Datos inválidos en ${origen}: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Lee un archivo JSON (ruta de un argumento, relativa al `cwd`) y lo valida con
 * `esquema`. Cualquier problema es `ErrorConfig` con todos los campos que fallan.
 */
export function leerJson<T extends z.ZodType>(
  config: Config,
  valor: string,
  opcion: string,
  esquema: T,
): { ruta: string; datos: z.output<T> } {
  const ruta = rutaDelArgumento(config, valor);
  if (!existsSync(ruta))
    throw new ErrorConfig(`No existe el archivo indicado en ${opcion}: ${ruta}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(ruta, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new ErrorConfig(`El archivo de ${opcion} no es JSON válido: ${ruta}`, { cause: error });
  }
  const r = esquema.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues.map((issue) => {
      const campo = issue.path.length > 0 ? issue.path.join('.') : '(raíz)';
      if (issue.code === 'unrecognized_keys') {
        return `campo desconocido: ${issue.keys.join(', ')}`;
      }
      return `${campo}: ${issue.message}`;
    });
    const ascii = r.error.issues.some((i) => i.message.startsWith(PREFIJO_NO_ASCII));
    throw new ErrorConfig(
      `Datos inválidos en ${ruta}:\n  - ${problemas.join('\n  - ')}` +
        (ascii ? `\n${EXPLICACION_ASCII}` : ''),
    );
  }
  return { ruta, datos: r.data };
}

// --- Solo ASCII imprimible (decisión del usuario, 2026-11-07, PLAN §8) -------------

const PREFIJO_NO_ASCII = 'tiene caracteres fuera de ASCII imprimible';

/**
 * Por qué se rechazan las tildes. El asistente de postulación declara
 * `charset=iso-8859-1` en un `<meta>`; con eso los valores con tildes vuelven
 * doblemente codificados, la confirmación del SII no calza con lo enviado y la
 * postulación se detiene sin grabar (defecto replicado del PHP por paridad).
 */
export const EXPLICACION_ASCII =
  'Los datos que van a los asistentes del SII se escriben sin tildes, ñ ni otros caracteres ' +
  'especiales (solo ASCII imprimible): el asistente declara charset=iso-8859-1 y con tildes la ' +
  'confirmación del SII no calza y la postulación no se graba (decisión del 2026-11-07, ' +
  'PLAN-MIGRACION §8). Ejemplo: "Senal" en vez de "Señal".';

/** Primer carácter fuera de ASCII imprimible (0x20–0x7E), o `undefined`. */
export function primerNoAscii(valor: string): string | undefined {
  return /[^\x20-\x7E]/u.exec(valor)?.[0];
}

/** Refinamiento de zod: el texto tiene que ser ASCII imprimible. */
export function soloAscii(valor: string, ctx: z.RefinementCtx): void {
  const c = primerNoAscii(valor);
  if (c !== undefined) {
    const codigo = `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
    const visible = /\p{Cc}|\s/u.test(c) ? codigo : `"${c}" ${codigo}`;
    ctx.addIssue({ code: 'custom', message: `${PREFIJO_NO_ASCII} (${visible})` });
  }
}
