// Traducción entre los comandos de la CLI y las herramientas MCP.
//
// Cada `DefinicionComando` del registro se publica como una herramienta MCP: sus
// opciones de `parseArgs` pasan a ser el esquema de entrada (en snake_case) y los
// argumentos que manda el cliente se vuelven a convertir en un `argv` que se corre
// con `ejecutarCli`. Así el servidor MCP no duplica validaciones ni reglas: usa
// exactamente el mismo camino que `sii <grupo> <comando>`.

import type { ParseArgsOptionsConfig } from 'node:util';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { DefinicionComando } from '../comandos/tipos.ts';

export type ArgumentosHerramienta = Readonly<Record<string, unknown>>;

type DescriptorOpcion = ParseArgsOptionsConfig[string];

/** Propiedad del esquema que recibe los argumentos posicionales del comando. */
export const PROP_POSICIONALES = 'argumentos';
/** Propiedad del esquema que corresponde a la opción global `--env`. */
export const PROP_ENV = 'env';

// --- Riesgo de cada comando ---------------------------------------------------------

export interface Riesgo {
  /** No cambia nada en el SII ni deja archivos de salida (la caché de tokens no cuenta). */
  readonly soloLectura: boolean;
  /** Hace peticiones de red. */
  readonly red: boolean;
  /**
   * Cuándo el comando envía al SII algo con efecto real (postula, consume folios,
   * emite una boleta, declara...). Esas llamadas solo se ejecutan si el servidor se
   * inició con `--permitir-envios`. Sin este campo, el comando nunca envía.
   */
  readonly envia?: CondicionEnvio;
}

export interface CondicionEnvio {
  /** Texto para la descripción de la herramienta. */
  readonly cuando: string;
  /** Qué cambiar en la llamada para que valide o arme sin enviar. */
  readonly paraNoEnviar: string;
  readonly si: (args: ArgumentosHerramienta) => boolean;
}

const conConfirmar: CondicionEnvio = {
  cuando: 'con confirmar=true',
  paraNoEnviar: 'omite confirmar',
  si: (a) => a.confirmar === true,
};
const salvoSoloArmar: CondicionEnvio = {
  cuando: 'siempre, salvo con solo_armar=true',
  paraNoEnviar: 'usa solo_armar=true',
  si: (a) => a.solo_armar !== true,
};

const consulta: Riesgo = { soloLectura: true, red: true };
const local: Riesgo = { soloLectura: true, red: false };
const efecto = (envia: CondicionEnvio): Riesgo => ({ soloLectura: false, red: true, envia });

/**
 * Clasificación de cada comando (clave `grupo/nombre`). Un test exige que todos los
 * comandos del registro estén aquí: al agregar uno, hay que decidir su riesgo.
 */
export const RIESGOS: Readonly<Record<string, Riesgo>> = {
  'certificacion/postular': efecto(conConfirmar),
  'certificacion/descargar-set': efecto(conConfirmar),
  'certificacion/solicitar-folios': efecto(conConfirmar),
  // Envía por defecto (certificación); solo `--solo-armar` lo evita.
  'certificacion/enviar-set': efecto(salvoSoloArmar),
  'certificacion/estado-envio': consulta,
  'certificacion/solicitar-revision': efecto(conConfirmar),
  'certificacion/verificar-portal': consulta,
  'certificacion/estado-declaracion': consulta,
  'certificacion/declarar': efecto(conConfirmar),
  // En certificación envía sin `--confirmar` (que solo se exige en producción).
  'certificacion/enviar-rcof': efecto(salvoSoloArmar),
  'produccion/emitir': efecto(conConfirmar),
  'produccion/consultar': consulta,
  // Solo consulta al SII, pero agrega líneas a la bitácora local.
  'produccion/seguimiento': { soloLectura: false, red: true },
  'util/firmar-semilla': local,
  'util/verificar-ted': local,
};

/** Un comando sin clasificar se trata como el peor caso: siempre envía. */
const SIN_CLASIFICAR: Riesgo = efecto({
  cuando: 'siempre (comando sin clasificar)',
  paraNoEnviar: 'no hay forma: el comando no está clasificado en RIESGOS',
  si: () => true,
});

export function claveComando(c: Pick<DefinicionComando, 'grupo' | 'nombre'>): string {
  return `${c.grupo}/${c.nombre}`;
}

export function riesgoDe(c: DefinicionComando): Riesgo {
  return RIESGOS[claveComando(c)] ?? SIN_CLASIFICAR;
}

/** `true` si la llamada, con estos argumentos, enviaría algo con efecto al SII. */
export function enviaAlSii(c: DefinicionComando, args: ArgumentosHerramienta): boolean {
  return riesgoDe(c).envia?.si(args) ?? false;
}

export function anotacionesDe(c: DefinicionComando): ToolAnnotations {
  const r = riesgoDe(c);
  return {
    title: `sii ${c.grupo} ${c.nombre}`,
    readOnlyHint: r.soloLectura,
    destructiveHint: r.envia !== undefined,
    idempotentHint: r.soloLectura,
    openWorldHint: r.red,
  };
}

// --- Nombres y esquema ------------------------------------------------------------

/** `certificacion` + `enviar-set` → `certificacion_enviar_set`. */
export function nombreHerramienta(c: Pick<DefinicionComando, 'grupo' | 'nombre'>): string {
  return `${c.grupo}_${c.nombre}`.replaceAll('-', '_');
}

/** `folio-inicial` → `folio_inicial`. */
export function propiedadDeOpcion(opcion: string): string {
  return opcion.replaceAll('-', '_');
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Descripción de una opción tomada de la ayuda del comando: la línea
 * `  --opcion <valor>   Texto...`. Si no la encuentra, una genérica.
 */
export function descripcionDeOpcion(ayuda: string, opcion: string): string {
  const patron = new RegExp(
    String.raw`^[ \t]*--${escaparRegExp(opcion)}(?:[ =][^ \t\n]+)?[ \t]{2,}(\S.*)$`,
    'm',
  );
  const texto = patron.exec(ayuda)?.[1]?.trim();
  return texto !== undefined ? `--${opcion}: ${texto}` : `Opción --${opcion} del comando.`;
}

function esquemaDeOpcion(ayuda: string, opcion: string, d: DescriptorOpcion) {
  const base = d.type === 'boolean' ? z.boolean() : z.string();
  const valor = d.multiple === true ? z.array(base) : base;
  return valor.optional().describe(descripcionDeOpcion(ayuda, opcion));
}

/** Esquema de entrada (forma zod) de la herramienta de un comando. */
export function esquemaEntrada(c: DefinicionComando): Record<string, z.ZodType> {
  const forma: Record<string, z.ZodType> = {};
  for (const [opcion, d] of Object.entries(c.opciones)) {
    forma[propiedadDeOpcion(opcion)] = esquemaDeOpcion(c.ayuda, opcion, d);
  }
  const { min, max } = c.posicionales ?? { min: 0, max: 0 };
  if (max > 0) {
    const lista = z
      .array(z.string())
      .min(min)
      .max(max)
      .describe(
        `Argumentos posicionales del comando (entre ${min} y ${max}; ver "Uso:" en la descripción).`,
      );
    forma[PROP_POSICIONALES] = min > 0 ? lista : lista.optional();
  }
  forma[PROP_ENV] = z
    .string()
    .optional()
    .describe(
      'Archivo de configuración .env (relativo a la carpeta de trabajo del servidor). Por defecto ./.env.',
    );
  return forma;
}

/** Esquema de la salida estructurada de todas las herramientas. */
export const ESQUEMA_SALIDA = {
  codigo: z.number().int().describe('Código de salida de la CLI (0 = OK; ver la descripción).'),
  salida: z.string().describe('Salida estándar del comando.'),
  errores: z.string().describe('Salida de errores del comando.'),
};

// --- argv -------------------------------------------------------------------------

/**
 * Convierte los argumentos de la herramienta en el `argv` de `ejecutarCli`.
 * Las opciones de texto van como `--opcion=valor` (un valor que empiece con `-` no
 * se confunde con otra opción) y los posicionales después de `--`.
 */
export function construirArgv(c: DefinicionComando, args: ArgumentosHerramienta): string[] {
  const argv = [c.grupo, c.nombre];
  const agregar = (opcion: string, valor: unknown) => {
    if (valor === true) argv.push(`--${opcion}`);
    else if (typeof valor === 'string') argv.push(`--${opcion}=${valor}`);
  };
  for (const opcion of Object.keys(c.opciones)) {
    const valor = args[propiedadDeOpcion(opcion)];
    if (Array.isArray(valor)) for (const v of valor) agregar(opcion, v);
    else agregar(opcion, valor);
  }
  agregar('env', args[PROP_ENV]);
  const posicionales = args[PROP_POSICIONALES];
  if (Array.isArray(posicionales) && posicionales.length > 0) {
    argv.push('--', ...posicionales.map(String));
  }
  return argv;
}
