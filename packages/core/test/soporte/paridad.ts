// Soporte para los golden tests de paridad contra el core PHP.
//
// Los esperados (paridad/esperados/*.bin) los genera `pnpm paridad:generar`
// con la librería PHP original y se versionan: estos tests no necesitan PHP.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ_PARIDAD = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../paridad');

export interface CasoParidad<E = Record<string, unknown>> {
  nombre: string;
  descripcion: string;
  operacion: string;
  /** Material criptográfico de prueba (solo las operaciones que firman). */
  material?: string;
  entrada: E;
}

export interface MetaParidad {
  caso: string;
  operacion: string;
  core: string;
  bytes: number;
  sha256: string;
  marcas: Record<string, string>;
}

export interface MaterialParidad {
  llave: string;
  certificado: string;
}

/** Casos de una operación, ordenados por nombre. */
export function casos<E>(operacion: string): CasoParidad<E>[] {
  const dir = join(RAIZ_PARIDAD, 'casos');
  return readdirSync(dir)
    .filter((archivo) => archivo.endsWith('.json'))
    .sort()
    .map((archivo) => {
      const datos = JSON.parse(readFileSync(join(dir, archivo), 'utf8')) as Omit<
        CasoParidad<E>,
        'nombre'
      >;
      return { nombre: archivo.slice(0, -'.json'.length), ...datos };
    })
    .filter((caso) => caso.operacion === operacion);
}

export function esperado(caso: string): { bytes: Buffer; meta: MetaParidad } {
  const dir = join(RAIZ_PARIDAD, 'esperados');
  return {
    bytes: readFileSync(join(dir, `${caso}.bin`)),
    meta: JSON.parse(readFileSync(join(dir, `${caso}.meta.json`), 'utf8')) as MetaParidad,
  };
}

export function material(nombre: string): MaterialParidad {
  if (nombre !== 'base') throw new Error(`Material desconocido: ${nombre}`);
  const dir = join(RAIZ_PARIDAD, 'material');
  return {
    llave: readFileSync(join(dir, 'llave.pem'), 'utf8'),
    certificado: readFileSync(join(dir, 'certificado.pem'), 'utf8'),
  };
}

/**
 * Bytes de un archivo de paridad/material/ (p. ej. un .pfx o un CAF de prueba).
 * Es el mismo archivo que el PHP lee con `leerMaterial()` en generar.php.
 */
export function leerMaterial(archivo: string): Buffer {
  if (archivo.includes('..')) throw new Error(`Material desconocido: ${archivo}`);
  return readFileSync(join(RAIZ_PARIDAD, 'material', archivo));
}

/**
 * Compara byte a byte. Si difieren, lanza un error con la posición del primer
 * byte distinto y el contexto decodificado desde ISO-8859-1 (así se ve
 * cualquier byte, sea o no UTF-8 válido).
 */
export function exigirIdentico(obtenido: Buffer, esperadoBytes: Buffer, caso: string): void {
  if (obtenido.equals(esperadoBytes)) return;

  const largo = Math.min(obtenido.length, esperadoBytes.length);
  let i = 0;
  while (i < largo && obtenido[i] === esperadoBytes[i]) i++;

  const contexto = (b: Buffer) =>
    JSON.stringify(b.subarray(Math.max(0, i - 60), i + 60).toString('latin1'));
  throw new Error(
    [
      `[${caso}] la salida difiere del PHP en el byte ${i}`,
      `  largo PHP: ${esperadoBytes.length}, largo Node: ${obtenido.length}`,
      `  PHP:  ${contexto(esperadoBytes)}`,
      `  Node: ${contexto(obtenido)}`,
    ].join('\n'),
  );
}

/**
 * Bytes de la entrada XML de un caso de la operación `c14n`: `xmlBase64` (bytes
 * exactos, p. ej. ISO-8859-1) o `xml` (texto, que el PHP recibe en UTF-8).
 */
export function bytesEntradaXml(entrada: { xml?: string; xmlBase64?: string }): Buffer {
  if (entrada.xmlBase64 !== undefined) return Buffer.from(entrada.xmlBase64, 'base64');
  if (entrada.xml !== undefined) return Buffer.from(entrada.xml, 'utf8');
  throw new Error('La entrada no trae xml ni xmlBase64');
}
