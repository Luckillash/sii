// Servidor MCP: cliente MCP real conectado en memoria, contexto de prueba
// (carpeta temporal con .env, reloj fijo, TransporteFalso). Nunca sale a la red.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { relojFijo, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { COMANDOS } from '../../src/comandos/index.ts';
import { CODIGOS } from '../../src/errores.ts';
import {
  claveComando,
  construirArgv,
  descripcionDeOpcion,
  nombreHerramienta,
  RIESGOS,
} from '../../src/mcp/herramientas.ts';
import { crearServidorMcp } from '../../src/mcp/servidor.ts';
import { CLAVE_PFX, INSTANTE, proyecto } from '../soporte/cli.ts';

function comando(grupo: string, nombre: string) {
  const c = COMANDOS.find((x) => x.grupo === grupo && x.nombre === nombre);
  if (c === undefined) throw new Error(`No existe ${grupo} ${nombre}`);
  return c;
}

async function conectar(dir: string, opciones: { permitirEnvios?: boolean } = {}) {
  const transporte = new TransporteFalso();
  const servidor = crearServidorMcp({
    cwd: dir,
    entorno: {},
    reloj: relojFijo(INSTANTE),
    crearTransporte: () => transporte,
    ...opciones,
  });
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([servidor.connect(lado1), cliente.connect(lado2)]);
  const llamar = async (name: string, args: Record<string, unknown> = {}) =>
    (await cliente.callTool({ name, arguments: args })) as CallToolResult & {
      structuredContent?: { codigo: number; salida: string; errores: string };
    };
  return { cliente, transporte, llamar };
}

describe('herramientas: traducción de comandos', () => {
  it('todos los comandos de la CLI tienen su riesgo clasificado', () => {
    const sinClasificar = COMANDOS.map(claveComando).filter((k) => !(k in RIESGOS));
    expect(sinClasificar).toEqual([]);
    const sobrantes = Object.keys(RIESGOS).filter(
      (k) => !COMANDOS.some((c) => claveComando(c) === k),
    );
    expect(sobrantes).toEqual([]);
  });

  it('arma el argv: snake_case → --opcion=valor, booleanos solo si son true, posicionales tras --', () => {
    const argv = construirArgv(comando('certificacion', 'enviar-set'), {
      folio_inicial: '5',
      solo_armar: true,
      canal: '-raro',
      env: 'otro.env',
    });
    expect(argv).toEqual([
      'certificacion',
      'enviar-set',
      '--canal=-raro',
      '--folio-inicial=5',
      '--solo-armar',
      '--env=otro.env',
    ]);
    expect(
      construirArgv(comando('produccion', 'consultar'), { json: false, argumentos: ['-1'] }),
    ).toEqual(['produccion', 'consultar', '--', '-1']);
  });

  it('toma la descripción de cada opción de la ayuda del comando', () => {
    const { ayuda } = comando('certificacion', 'enviar-set');
    expect(descripcionDeOpcion(ayuda, 'canal')).toMatch(/^--canal: soap \(por defecto\)/);
    expect(descripcionDeOpcion(ayuda, 'folio-inicial')).toContain('Primer folio');
    expect(descripcionDeOpcion(ayuda, 'no-existe')).toBe('Opción --no-existe del comando.');
  });
});

describe('servidor MCP', () => {
  it('publica una herramienta por comando, con esquema y anotaciones', async () => {
    const { cliente } = await conectar(proyecto().dir);
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(COMANDOS.map(nombreHerramienta).sort());

    const emitir = tools.find((t) => t.name === 'produccion_emitir');
    expect(emitir?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(emitir?.inputSchema.properties).toHaveProperty('nro_resol');
    expect(emitir?.description).toContain('ENVÍA AL SII CON EFECTO REAL con confirmar=true');
    expect(emitir?.description).toContain('sin --permitir-envios');

    const estado = tools.find((t) => t.name === 'certificacion_estado_envio');
    expect(estado?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(estado?.inputSchema.required).toContain('argumentos');
  });

  it('corre un comando local y devuelve la salida y el código', async () => {
    const { llamar, transporte } = await conectar(proyecto().dir);
    const r = await llamar('util_firmar_semilla', { argumentos: ['012345678901'] });
    expect(r.isError).toBe(false);
    expect(r.structuredContent?.codigo).toBe(CODIGOS.OK);
    expect(r.structuredContent?.salida).toContain('===== COPIA DESDE AQUI =====');
    expect(JSON.stringify(r)).not.toContain(CLAVE_PFX);
    expect(transporte.enviadas).toHaveLength(0);
  });

  it('un error de la CLI vuelve como isError con su código', async () => {
    const { llamar } = await conectar(proyecto().dir);
    const r = await llamar('util_firmar_semilla', { argumentos: ['12<34'] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.codigo).toBe(CODIGOS.USO);
  });

  it('el esquema rechaza argumentos de tipo o cantidad inválidos', async () => {
    const { llamar } = await conectar(proyecto().dir);
    const r = await llamar('util_firmar_semilla', { argumentos: [] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
  });

  it('sin --permitir-envios rechaza lo que enviaría al SII, sin ejecutar nada', async () => {
    const p = proyecto();
    const { llamar, transporte } = await conectar(p.dir);
    const r = await llamar('certificacion_enviar_set');
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.codigo).toBe(CODIGOS.USO);
    expect(r.structuredContent?.errores).toContain('usa solo_armar=true');
    expect(transporte.enviadas).toHaveLength(0);
    expect(existsSync(join(p.dir, 'data', 'output', 'envio-set-boletas.xml'))).toBe(false);

    const emitir = await llamar('produccion_emitir', {
      boleta: 'b.json',
      folio: '1',
      confirmar: true,
    });
    expect(emitir.structuredContent?.errores).toContain('omite confirmar');
  });

  it('sin --permitir-envios igual deja armar sin enviar', async () => {
    const p = proyecto();
    const { llamar, transporte } = await conectar(p.dir);
    const r = await llamar('certificacion_enviar_set', { solo_armar: true });
    expect(r.structuredContent?.codigo).toBe(CODIGOS.OK);
    expect(r.structuredContent?.salida).toContain('No se envió nada al SII');
    expect(transporte.enviadas).toHaveLength(0);
    expect(existsSync(join(p.dir, 'data', 'output', 'envio-set-boletas.xml'))).toBe(true);
  });

  it('con --permitir-envios la llamada llega al transporte', async () => {
    const { llamar, transporte } = await conectar(proyecto().dir, { permitirEnvios: true });
    const r = await llamar('certificacion_enviar_set');
    // El SII falso responde 404 a todo: lo que importa es que sí se intentó.
    expect(r.isError).toBe(true);
    expect(transporte.enviadas.length).toBeGreaterThan(0);
  });
});
