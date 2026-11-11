// Despacho de la CLI: `sii <grupo> <comando> [opciones]`.
// Reemplaza los 7 scripts de bin/ del PHP (PLAN-MIGRACION.md fase 7).

import { parseArgs } from 'node:util';
import { COMANDOS } from './comandos/index.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  OPCIONES_GLOBALES,
} from './comandos/tipos.ts';
import { type Config, cargarConfig } from './config.ts';
import type { Contexto } from './contexto.ts';
import { CODIGOS, type CodigoSalida, codigoDeError, describirError, ErrorUso } from './errores.ts';

export const NOMBRE_CLI = 'sii';

const GRUPOS = {
  certificacion: 'Certificación de boleta electrónica (maullin / pangal / www4)',
  produccion: 'Emisión y consulta de boletas por la API REST',
  util: 'Herramientas sueltas',
} as const;

function ayudaGeneral(): string {
  const lineas = [
    `${NOMBRE_CLI}: CLI de winex/certificacion (Node.js) para el SII de Chile.`,
    '',
    `Uso: ${NOMBRE_CLI} <grupo> <comando> [opciones]`,
    `     ${NOMBRE_CLI} <grupo> <comando> --ayuda`,
    '',
  ];
  for (const [grupo, descripcion] of Object.entries(GRUPOS)) {
    lineas.push(`${grupo}: ${descripcion}`);
    for (const c of COMANDOS.filter((x) => x.grupo === grupo)) {
      lineas.push(`  ${c.nombre.padEnd(22)}${c.resumen}`);
    }
    lineas.push('');
  }
  lineas.push(
    'Opciones globales:',
    '  --env <ruta>          Archivo de configuración (por defecto ./.env). Ver .env.example.',
    '  -h, --ayuda           Muestra la ayuda.',
    '',
    'Códigos de salida:',
    '  0 OK · 1 error · 2 uso incorrecto · 3 configuración inválida · 4 red/HTTP (reintentable)',
    '  5 rechazo del SII · 6 resultado incierto (revisar el SII antes de repetir) · 7 verificación fallida',
  );
  return lineas.join('\n');
}

function buscar(grupo: string | undefined, nombre: string | undefined) {
  return COMANDOS.find((c) => c.grupo === grupo && c.nombre === nombre);
}

/** Ejecuta la CLI con `argv` (sin `node` ni el script) y devuelve el código de salida. */
export async function ejecutarCli(argv: readonly string[], ctx: Contexto): Promise<CodigoSalida> {
  const [grupo, nombre, ...resto] = argv;
  if (grupo === undefined || grupo === '--ayuda' || grupo === '-h' || grupo === 'ayuda') {
    ctx.imprimir(ayudaGeneral());
    return grupo === undefined ? CODIGOS.USO : CODIGOS.OK;
  }
  const comando = buscar(grupo, nombre);
  if (comando === undefined) {
    const enGrupo = grupo in GRUPOS;
    ctx.imprimirError(
      enGrupo
        ? `[ERROR] Comando desconocido: ${grupo} ${nombre ?? ''}`.trimEnd()
        : `[ERROR] Grupo desconocido: ${grupo}`,
    );
    ctx.imprimirError(`Usa \`${NOMBRE_CLI} --ayuda\` para ver los comandos.`);
    return CODIGOS.USO;
  }

  let entrada: EntradaComando;
  try {
    entrada = leerArgumentos(comando, resto, ctx);
  } catch (error) {
    ctx.imprimirError(`[ERROR] ${describirError(error)}`);
    ctx.imprimirError('');
    ctx.imprimirError(comando.ayuda);
    return CODIGOS.USO;
  }
  if (entrada.opciones.ayuda === true) {
    ctx.imprimir(comando.ayuda);
    return CODIGOS.OK;
  }

  try {
    return (await comando.ejecutar(ctx, entrada)) ?? CODIGOS.OK;
  } catch (error) {
    ctx.imprimirError(`[ERROR] ${describirError(error)}`);
    if (error instanceof ErrorUso) {
      ctx.imprimirError('');
      ctx.imprimirError(comando.ayuda);
    }
    return codigoDeError(error);
  }
}

function leerArgumentos(
  comando: DefinicionComando,
  args: readonly string[],
  ctx: Contexto,
): EntradaComando {
  let parseado: ReturnType<typeof parseArgs>;
  try {
    parseado = parseArgs({
      args: [...args],
      options: { ...comando.opciones, ...OPCIONES_GLOBALES },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new ErrorUso(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parseado;
  const { min, max } = comando.posicionales ?? { min: 0, max: 0 };
  if (values.ayuda !== true && (positionals.length < min || positionals.length > max)) {
    throw new ErrorUso(
      max === 0
        ? `El comando no recibe argumentos (sobra: ${positionals.join(' ')}).`
        : `Cantidad de argumentos inválida (se esperan entre ${min} y ${max}).`,
    );
  }
  let config: Config | undefined;
  const rutaEnv = typeof values.env === 'string' ? values.env : undefined;
  return {
    opciones: values,
    posicionales: positionals,
    config: () => {
      config ??= cargarConfig(ctx, rutaEnv);
      return config;
    },
  };
}
