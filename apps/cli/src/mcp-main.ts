#!/usr/bin/env node
// Punto de entrada del servidor MCP `sii-mcp` (stdio). La lógica está en
// mcp/servidor.ts (probada con un transporte falso); aquí solo se conecta con el
// proceso real. La salida estándar es del protocolo MCP: los avisos van a stderr.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TransporteUndici } from '@winex/certificacion';
import paquete from '../package.json' with { type: 'json' };
import { crearServidorMcp } from './mcp/servidor.ts';

const AYUDA = `Uso: sii-mcp [--cwd <carpeta>] [--permitir-envios]

Servidor MCP (stdio) que publica los comandos de la CLI \`sii\` como herramientas.

Opciones:
  --cwd <carpeta>      Carpeta de trabajo: ahí se busca el .env y se resuelven las
                       rutas relativas (por defecto, la carpeta actual).
  --permitir-envios    Habilita las llamadas que envían al SII operaciones con efecto
                       real (enviar el set, emitir boletas, pedir folios, postular,
                       declarar...). Sin esta opción se rechazan y solo se puede
                       validar, armar y consultar. También: SII_MCP_PERMITIR_ENVIOS=1.
  -h, --ayuda          Muestra esta ayuda.`;

try {
  const { values } = parseArgs({
    options: {
      cwd: { type: 'string' },
      'permitir-envios': { type: 'boolean' },
      ayuda: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.ayuda === true) {
    process.stderr.write(`${AYUDA}\n`);
  } else {
    const permitirEnvios =
      values['permitir-envios'] === true || process.env.SII_MCP_PERMITIR_ENVIOS === '1';
    const cwd = resolve(values.cwd ?? process.cwd());
    const servidor = crearServidorMcp({
      cwd,
      entorno: process.env,
      crearTransporte: () => new TransporteUndici(),
      permitirEnvios,
      version: paquete.version,
    });
    await servidor.connect(new StdioServerTransport());
    process.stderr.write(
      `[sii-mcp] listo en ${cwd} (envíos al SII ${permitirEnvios ? 'HABILITADOS' : 'deshabilitados'}).\n`,
    );
  }
} catch (error) {
  process.stderr.write(`[ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
