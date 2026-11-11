#!/usr/bin/env node
// Punto de entrada del binario `sii`. Toda la lógica está en cli.ts (probada con
// un contexto falso); aquí solo se conecta con el proceso real.

import { ejecutarCli } from './cli.ts';
import { contextoDelProceso } from './contexto.ts';
import { describirError } from './errores.ts';

try {
  await using ctx = contextoDelProceso();
  process.exitCode = await ejecutarCli(process.argv.slice(2), ctx);
} catch (error) {
  process.stderr.write(`[ERROR] ${describirError(error)}\n`);
  process.exitCode = 1;
}
