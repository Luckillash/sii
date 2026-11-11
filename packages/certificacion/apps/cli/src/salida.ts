// Archivos que genera la CLI (sobres, RCOF, CAF). Los bytes se escriben tal cual
// los entrega la librería: sin reconvertir a ISO-8859-1 (pend. 1.1 del PHP).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, rutaDelArgumento, rutaDelEnv } from './config.ts';

/**
 * Carpeta de salida: `--salida <dir>` (relativa al `cwd`) o, por defecto,
 * `data/output` junto al `.env` (como los bin del PHP). Esa carpeta no se
 * versiona: los XML traen RUT y razón social.
 */
export function carpetaSalida(config: Config, opcion: string | undefined): string {
  return opcion !== undefined
    ? rutaDelArgumento(config, opcion)
    : rutaDelEnv(config, join('data', 'output'));
}

/** Escribe `bytes` en `<carpeta>/<nombre>` (crea la carpeta) y devuelve la ruta. */
export function guardarArchivo(carpeta: string, nombre: string, bytes: Uint8Array): string {
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, nombre);
  writeFileSync(ruta, bytes);
  return ruta;
}
