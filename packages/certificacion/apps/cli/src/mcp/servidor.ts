// Servidor MCP de la CLI: publica cada comando de `sii` como una herramienta.
//
// Cada llamada corre `ejecutarCli` con un contexto propio (salida capturada,
// transporte HTTP nuevo que se cierra al terminar). Las llamadas se ejecutan de a
// una: los comandos escriben archivos de salida, registros de folios y la caché de
// tokens, y dos envíos en paralelo podrían pisarse.
//
// Seguridad: por defecto el servidor rechaza toda llamada que enviaría algo con
// efecto al SII (ver `RIESGOS`). Para habilitarlas hay que iniciarlo con
// `--permitir-envios`; aun así, cada comando conserva sus propias protecciones
// (`--confirmar`, registros por folio, validación antes de la primera petición).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Reloj, relojSistema, type TransporteHttp } from '@winex/certificacion';
import { ejecutarCli, NOMBRE_CLI } from '../cli.ts';
import { COMANDOS } from '../comandos/index.ts';
import type { DefinicionComando } from '../comandos/tipos.ts';
import type { Contexto } from '../contexto.ts';
import { CODIGOS, type CodigoSalida, describirError } from '../errores.ts';
import {
  type ArgumentosHerramienta,
  anotacionesDe,
  construirArgv,
  ESQUEMA_SALIDA,
  enviaAlSii,
  esquemaEntrada,
  nombreHerramienta,
  riesgoDe,
} from './herramientas.ts';

export const NOMBRE_SERVIDOR = 'sii-certificacion';

export interface OpcionesServidor {
  /** Carpeta de trabajo: ahí se busca el `.env` y se resuelven las rutas relativas. */
  readonly cwd: string;
  /** Variables del entorno (ganan sobre el `.env`). */
  readonly entorno: Readonly<Record<string, string | undefined>>;
  /** Crea el transporte HTTP de una llamada. Si es `AsyncDisposable`, se cierra al terminar. */
  readonly crearTransporte: () => TransporteHttp;
  /** Habilita las llamadas que envían algo con efecto al SII. Por defecto, no. */
  readonly permitirEnvios?: boolean;
  readonly reloj?: Reloj;
  readonly version?: string;
  /** Comandos a publicar (por defecto, todos los de la CLI). */
  readonly comandos?: readonly DefinicionComando[];
}

const NOMBRES_CODIGO: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(CODIGOS).map(([nombre, codigo]) => [codigo, nombre]),
);

const INSTRUCCIONES = `Herramientas de la CLI \`${NOMBRE_CLI}\` (winex/certificacion en Node.js) para la boleta electrónica del SII de Chile: certificación (postular, descargar el set, pedir folios, enviar el set, pedir revisión, declarar), emisión y consulta en producción por la API REST, y utilidades.

Cada herramienta corre un comando \`${NOMBRE_CLI} <grupo> <comando>\`: las opciones --x-y se pasan como propiedades x_y y los argumentos posicionales en "argumentos". La configuración (certificado, RUT, CAF, resoluciones) sale del .env de la carpeta de trabajo del servidor; los secretos nunca se muestran.

Códigos de salida: 0 OK · 1 error · 2 uso incorrecto (nada salió al SII) · 3 configuración inválida (nada salió al SII) · 4 red/HTTP (reintentable) · 5 rechazo del SII · 6 resultado incierto (NO reintentar: revisar el estado en el SII antes) · 7 verificación fallida.

Las herramientas marcadas como destructivas envían documentos o trámites REALES al SII (consumen folios, emiten boletas, postulan o declaran). Antes de una de esas llamadas, ejecútala sin confirmar (o con solo_armar=true), muestra el resumen al usuario y pide su confirmación explícita.`;

function descripcion(c: DefinicionComando, permitirEnvios: boolean): string {
  const riesgo = riesgoDe(c);
  const partes = [c.resumen];
  if (riesgo.envia !== undefined) {
    partes.push(
      `ENVÍA AL SII CON EFECTO REAL ${riesgo.envia.cuando}. ` +
        (permitirEnvios
          ? 'Pide confirmación explícita al usuario antes de hacerlo.'
          : 'Este servidor se inició sin --permitir-envios: esas llamadas se rechazan; úsala para validar o armar sin enviar.'),
    );
  } else if (riesgo.soloLectura) {
    partes.push(riesgo.red ? 'Solo consulta: no cambia nada en el SII.' : 'Local: no usa la red.');
  }
  partes.push(`Ayuda del comando:\n\n${c.ayuda}`);
  return partes.join('\n\n');
}

interface Resultado {
  readonly codigo: CodigoSalida;
  readonly salida: string;
  readonly errores: string;
}

function resultadoMcp(argv: readonly string[], r: Resultado): CallToolResult {
  const texto = [
    `$ ${NOMBRE_CLI} ${argv.join(' ')}`,
    `Código de salida: ${r.codigo} (${NOMBRES_CODIGO[r.codigo] ?? '?'})`,
    r.salida !== '' ? `--- salida ---\n${r.salida}` : '',
    r.errores !== '' ? `--- errores ---\n${r.errores}` : '',
  ]
    .filter((p) => p !== '')
    .join('\n\n');
  return {
    content: [{ type: 'text', text: texto }],
    structuredContent: { ...r },
    isError: r.codigo !== CODIGOS.OK,
  };
}

/** Crea el servidor MCP (sin conectarlo a ningún transporte). */
export function crearServidorMcp(opciones: OpcionesServidor): McpServer {
  const permitirEnvios = opciones.permitirEnvios === true;
  const servidor = new McpServer(
    { name: NOMBRE_SERVIDOR, version: opciones.version ?? '0.0.0' },
    { instructions: INSTRUCCIONES },
  );

  // Cola: una llamada a la vez.
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(tarea: () => Promise<T>): Promise<T> => {
    const resultado = cola.then(tarea, tarea);
    cola = resultado.catch(() => undefined);
    return resultado;
  };

  async function correr(argv: readonly string[]): Promise<Resultado> {
    const salida: string[] = [];
    const errores: string[] = [];
    let transporte: TransporteHttp | undefined;
    const ctx: Contexto = {
      cwd: opciones.cwd,
      entorno: opciones.entorno,
      reloj: opciones.reloj ?? relojSistema,
      imprimir: (linea) => salida.push(linea),
      imprimirError: (linea) => errores.push(linea),
      transporte: () => {
        transporte ??= opciones.crearTransporte();
        return transporte;
      },
    };
    let codigo: CodigoSalida;
    try {
      codigo = await ejecutarCli(argv, ctx);
    } catch (error) {
      errores.push(`[ERROR] ${describirError(error)}`);
      codigo = CODIGOS.ERROR;
    } finally {
      if (transporte !== undefined && Symbol.asyncDispose in transporte) {
        await (transporte as TransporteHttp & AsyncDisposable)[Symbol.asyncDispose]();
      }
    }
    return { codigo, salida: salida.join('\n'), errores: errores.join('\n') };
  }

  for (const comando of opciones.comandos ?? COMANDOS) {
    servidor.registerTool(
      nombreHerramienta(comando),
      {
        title: `${NOMBRE_CLI} ${comando.grupo} ${comando.nombre}`,
        description: descripcion(comando, permitirEnvios),
        inputSchema: esquemaEntrada(comando),
        outputSchema: ESQUEMA_SALIDA,
        annotations: anotacionesDe(comando),
      },
      async (args: ArgumentosHerramienta) => {
        const argv = construirArgv(comando, args);
        if (!permitirEnvios && enviaAlSii(comando, args)) {
          return resultadoMcp(argv, {
            codigo: CODIGOS.USO,
            salida: '',
            errores:
              '[ERROR] Esta llamada enviaría al SII una operación con efecto real y el servidor MCP ' +
              'se inició sin --permitir-envios. No se ejecutó nada. Para preparar y revisar sin ' +
              `enviar, ${riesgoDe(comando).envia?.paraNoEnviar ?? 'repite la llamada'}.`,
          });
        }
        return resultadoMcp(argv, await enCola(() => correr(argv)));
      },
    );
  }
  return servidor;
}
