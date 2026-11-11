// Respuestas de mentira de la API REST de boleta (las mismas de los tests del core).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'unitarios',
  'produccion',
  'fixtures',
);

/** `semilla.xml`, `token.xml`, `envio-recibido.json`, `estado-procesado.json`... */
export function fixture(nombre: string): Buffer {
  return readFileSync(join(FIXTURES, nombre));
}

/** El token de `token.xml`: nunca debe aparecer en la salida. */
export const TOKEN = 'TOKENFALSO0123456789';

/** Hosts y rutas base (sin esquema) para los patrones del `TransporteFalso`. */
export const SII_FALSO = {
  produccion: { auth: 'api.sii.cl/recursos/v1', envio: 'rahue.sii.cl/recursos/v1' },
  certificacion: { auth: 'apicert.sii.cl/recursos/v1', envio: 'pangal.sii.cl/recursos/v1' },
} as const;
