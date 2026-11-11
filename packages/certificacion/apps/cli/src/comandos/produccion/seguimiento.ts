// `sii produccion seguimiento`: estado en el SII de las boletas emitidas con
// `sii produccion emitir --confirmar`, para observar el piloto en producción
// (PLAN-MIGRACION.md fase 8). Solo lectura: no envía documentos.
//
// Lee los registros `boleta-<ambiente>-<folio>.envio.json` de la carpeta de
// salida, consulta cada trackId una sola vez (todos con el mismo token) y, con
// --bitacora, agrega una línea JSON por envío a un archivo, para comparar los
// estados día a día durante el período de observación.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type Ambiente,
  type DetalleRepRechRest,
  ErrorTransporte,
  type EstadoEnvioRest,
  fechaHoraSii,
  fechaSii,
} from '@winex/certificacion';
import { z } from 'zod';
import { cargarCertificado, fecha, leerVariables, rut, rutaDelArgumento } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import {
  CODIGOS,
  type CodigoSalida,
  codigoDeError,
  describirError,
  ErrorConfig,
  ErrorUso,
} from '../../errores.ts';
import { carpetaSalida } from '../../salida.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionAmbiente,
  opcionBooleana,
  opcionTexto,
} from '../tipos.ts';
import type { RegistroEnvio } from './emitir.ts';
import { clienteRest, glosaEstado, hostsRest, nombreAmbiente, sufijoAmbiente } from './rest.ts';

const AYUDA = `Uso: sii produccion seguimiento [--ambiente produccion|certificacion] [opciones]

Revisa en el SII el estado de todas las boletas emitidas con
\`sii produccion emitir --confirmar\`: lee los registros de la carpeta de salida y
consulta cada trackId por la API REST, con un solo token. Sirve para seguir el
piloto en producción día a día. Solo lectura: no envía documentos.

Los envíos inciertos (sin trackId: no se sabe si llegaron) no se consultan: se
listan aparte, para revisarlos en el portal del SII.

Opciones:
  --ambiente <amb>          produccion (por defecto: api.sii.cl) o certificacion
                            (apicert.sii.cl). Solo se leen los registros de ese ambiente.
  --salida <dir>            Carpeta con los registros (por defecto data/output junto
                            al .env, la misma que usa emitir).
  --desde <AAAA-MM-DD>      Solo los envíos hechos desde ese día (hora de Chile).
  --bitacora <archivo>      Agrega al archivo una línea JSON por envío revisado
                            (fecha de la consulta, trackId, folios, estado, conteos).
                            La carpeta del archivo tiene que existir.
  --json                    Imprime el resultado completo en JSON, en vez de la tabla.

Variables del .env (solo si hay algo que consultar):
  SII_CERT_PATH, SII_CERT_PASS   certificado para pedir el token
  SII_RUT_EMPRESA                empresa dueña de los envíos
  SII_CACHE_TOKENS (opcional)    caché de tokens entre ejecuciones

Qué sale al SII:
  GET semilla y POST token (si no hay token vigente en SII_CACHE_TOKENS) y un
  GET boleta.electronica.envio/<rut>-<dv>-<trackId> por cada trackId distinto.

Archivos que lee (en la carpeta de salida):
  boleta-<ambiente>-<folio>.envio.json  los registros que deja emitir --confirmar

Archivos que escribe: ninguno por defecto. Con --bitacora, agrega líneas al final
  de ese archivo (nunca lo reescribe). Además, el caché de SII_CACHE_TOKENS, si
  está configurado.

Cómo se clasifica cada envío:
  en proceso    REC, SOK, CRT, FOK o PRD: el SII todavía valida; volver a consultar
  aceptado      EPR con todos los documentos aceptados
  con reparos   EPR sin rechazos pero con reparos (aceptado; revisar el detalle)
  rechazado     EPR con documentos rechazados, o RSC, RFR, RCT, RCH u otro estado

Códigos de salida (si se dan varios casos, gana el primero de esta lista):
  5 algún envío rechazado o con documentos rechazados, un EPR cuyos conteos no
    cuadran, o una consulta a la que el SII respondió algo que no se entiende
  6 hay envíos inciertos o registros ilegibles: revisarlos en el SII
  4 alguna consulta falló por red o HTTP (reintentable)
  0 todo aceptado (con o sin reparos) o aún en proceso; también si no hay registros
  Además: 2 uso · 3 configuración inválida (antes de cualquier petición).`;

export const comando: DefinicionComando = {
  grupo: 'produccion',
  nombre: 'seguimiento',
  resumen: 'Estado en el SII de todas las boletas emitidas (piloto)',
  ayuda: AYUDA,
  opciones: {
    ambiente: { type: 'string' },
    salida: { type: 'string' },
    desde: { type: 'string' },
    bitacora: { type: 'string' },
    json: { type: 'boolean' },
  },
  ejecutar: seguimiento,
};

/** `boleta-<ambiente>-<folio>.envio.json` (el nombre que usa emitir). */
const NOMBRE_REGISTRO = /^boleta-(certificacion|produccion)-([0-9]+)\.envio\.json$/;

/** Forma mínima de un registro de emitir. Campos de más se ignoran. */
const esquemaRegistro = z.object({
  ambiente: z.enum(['certificacion', 'produccion']),
  tipoDte: z.number().int(),
  folio: z.number().int().positive(),
  archivo: z.string(),
  enviadoEn: z.string().refine((v) => !Number.isNaN(Date.parse(v))),
  incierto: z.boolean(),
  trackId: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
  estado: z.string().optional(),
  fechaRecepcion: z.string().optional(),
  error: z.string().optional(),
});

/** Un registro con trackId: se consulta. */
type RegistroConTrackId = RegistroEnvio & { readonly trackId: string };

interface Ilegible {
  readonly archivo: string;
  readonly motivo: string;
}

interface Registros {
  readonly conTrackId: RegistroConTrackId[];
  readonly inciertos: RegistroEnvio[];
  readonly ilegibles: Ilegible[];
}

type Resultado = 'aceptado' | 'reparos' | 'en-proceso' | 'rechazado' | 'revisar' | 'error';

const ETIQUETAS: Readonly<Record<Resultado, string>> = {
  aceptado: 'aceptado',
  reparos: 'con reparos',
  'en-proceso': 'en proceso',
  rechazado: 'rechazado',
  revisar: 'conteos no cuadran',
  error: 'error de consulta',
};

/** Un trackId con los folios que viajaron en él y lo que respondió el SII. */
interface Envio {
  readonly trackId: string;
  readonly registros: readonly RegistroConTrackId[];
  readonly resultado: Resultado;
  readonly estado?: EstadoEnvioRest;
  readonly error?: string;
  readonly codigoError?: CodigoSalida;
}

/** Orden en que un caso le gana a otro para el código de salida. */
const PRIORIDAD: readonly CodigoSalida[] = [
  CODIGOS.SII,
  CODIGOS.INCIERTO,
  CODIGOS.TRANSPORTE,
  CODIGOS.ERROR,
];

async function seguimiento(ctx: Contexto, entrada: EntradaComando) {
  // 1. Opciones (errores de uso, sin leer la config).
  const ambiente = opcionAmbiente(entrada, 'produccion');
  const desde = opcionDesde(entrada);
  const json = opcionBooleana(entrada, 'json');
  const opcionBitacora = opcionTexto(entrada, 'bitacora');

  // 2. Configuración y registros. Nada de esto sale a la red.
  const config = entrada.config();
  const carpeta = carpetaSalida(config, opcionTexto(entrada, 'salida'));
  const bitacora =
    opcionBitacora === undefined
      ? undefined
      : rutaBitacora(rutaDelArgumento(config, opcionBitacora));
  const { conTrackId, inciertos, ilegibles } = leerRegistros(carpeta, ambiente, desde);

  if (conTrackId.length + inciertos.length + ilegibles.length === 0) {
    const filtro = desde === undefined ? '' : ` desde el ${desde}`;
    const mensaje =
      `No hay registros de envío de ${nombreAmbiente(ambiente)}${filtro} en ${carpeta} ` +
      '(los deja `sii produccion emitir --confirmar`).';
    if (json) {
      ctx.imprimir(JSON.stringify(aJson(ctx, ambiente, carpeta, [], [], [], CODIGOS.OK), null, 2));
    } else {
      ctx.imprimir(mensaje);
    }
    return CODIGOS.OK;
  }

  // 3. Consultas: un token para todos los trackId.
  const porTrackId = agruparPorTrackId(conTrackId);
  const envios: Envio[] = [];
  if (porTrackId.length > 0) {
    const { SII_RUT_EMPRESA: rutEmpresa } = leerVariables(config, { SII_RUT_EMPRESA: rut });
    const certificado = await cargarCertificado(config);
    const rest = clienteRest(ctx, config, certificado, ambiente);
    const token = await rest.token(rutEmpresa);
    for (const { trackId, registros } of porTrackId) {
      try {
        const estado = await rest.cliente.consultarEnvio(token, rutEmpresa, trackId);
        envios.push({ trackId, registros, estado, resultado: clasificar(estado) });
      } catch (error) {
        if (error instanceof ErrorTransporte && error.status === 401) {
          // Token rechazado: las demás consultas fallarían igual.
          if (rest.conCache) await rest.cliente.olvidarToken(rutEmpresa);
          throw error;
        }
        envios.push({
          trackId,
          registros,
          resultado: 'error',
          error: describirError(error),
          codigoError: codigoDeError(error),
        });
      }
    }
  }

  // 4. Resultado.
  const codigo = codigoFinal(envios, inciertos.length + ilegibles.length);
  if (bitacora !== undefined) {
    escribirBitacora(bitacora, ctx, ambiente, envios, inciertos, ilegibles);
  }
  if (json) {
    ctx.imprimir(
      JSON.stringify(aJson(ctx, ambiente, carpeta, envios, inciertos, ilegibles, codigo), null, 2),
    );
  } else {
    imprimirTabla(ctx, ambiente, envios, inciertos, ilegibles);
    if (bitacora !== undefined) ctx.imprimir(`Bitácora: ${bitacora}`);
  }
  return codigo;
}

// --- Opciones -------------------------------------------------------------------

function opcionDesde(entrada: EntradaComando): string | undefined {
  const valor = opcionTexto(entrada, 'desde');
  if (valor === undefined) return undefined;
  if (!fecha.safeParse(valor).success) {
    throw new ErrorUso('--desde debe ser una fecha AAAA-MM-DD.');
  }
  return valor.trim();
}

/** Valida la ruta de la bitácora antes de cualquier petición. */
function rutaBitacora(ruta: string): string {
  if (!existsSync(dirname(ruta))) {
    throw new ErrorConfig(`No existe la carpeta de --bitacora: ${dirname(ruta)}`);
  }
  if (existsSync(ruta) && statSync(ruta).isDirectory()) {
    throw new ErrorConfig(`--bitacora debe ser un archivo, no una carpeta: ${ruta}`);
  }
  return ruta;
}

// --- Registros ------------------------------------------------------------------

/** Los registros del ambiente pedido, separados en consultables, inciertos e ilegibles. */
function leerRegistros(carpeta: string, ambiente: Ambiente, desde: string | undefined): Registros {
  const salida: Registros = { conTrackId: [], inciertos: [], ilegibles: [] };
  if (!existsSync(carpeta)) return salida;
  const nombres = readdirSync(carpeta)
    .map((nombre) => ({ nombre, partes: NOMBRE_REGISTRO.exec(nombre) }))
    .filter(({ partes }) => partes?.[1] === ambiente)
    .sort((a, b) => Number(a.partes?.[2]) - Number(b.partes?.[2]));

  for (const { nombre, partes } of nombres) {
    let datos: unknown;
    try {
      datos = JSON.parse(readFileSync(join(carpeta, nombre), 'utf8'));
    } catch {
      salida.ilegibles.push({ archivo: nombre, motivo: 'no es un JSON válido' });
      continue;
    }
    const r = esquemaRegistro.safeParse(datos);
    if (!r.success) {
      const campos = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(raíz)'))];
      salida.ilegibles.push({ archivo: nombre, motivo: `campos inválidos: ${campos.join(', ')}` });
      continue;
    }
    const registro = r.data as RegistroEnvio;
    if (registro.ambiente !== ambiente || String(registro.folio) !== partes?.[2]) {
      salida.ilegibles.push({
        archivo: nombre,
        motivo: 'el ambiente o el folio no coinciden con el nombre del archivo',
      });
      continue;
    }
    if (desde !== undefined && fechaSii(new Date(registro.enviadoEn)) < desde) continue;
    if (registro.incierto) {
      salida.inciertos.push(registro);
    } else if (registro.trackId === undefined) {
      salida.ilegibles.push({ archivo: nombre, motivo: 'no es incierto pero no tiene trackId' });
    } else {
      salida.conTrackId.push(registro as RegistroConTrackId);
    }
  }
  return salida;
}

/** Un grupo por trackId (varios folios pueden compartir envío), del más antiguo al más nuevo. */
function agruparPorTrackId(
  registros: readonly RegistroConTrackId[],
): { trackId: string; registros: RegistroConTrackId[] }[] {
  const grupos = new Map<string, RegistroConTrackId[]>();
  for (const r of registros) {
    const grupo = grupos.get(r.trackId);
    if (grupo === undefined) grupos.set(r.trackId, [r]);
    else grupo.push(r);
  }
  const primerEnvio = (g: readonly RegistroConTrackId[]) =>
    Math.min(...g.map((r) => Date.parse(r.enviadoEn)));
  return [...grupos]
    .map(([trackId, g]) => ({ trackId, registros: g }))
    .sort(
      (a, b) =>
        primerEnvio(a.registros) - primerEnvio(b.registros) ||
        a.trackId.localeCompare(b.trackId, 'en', { numeric: true }),
    );
}

// --- Clasificación y código de salida -------------------------------------------

function clasificar(e: EstadoEnvioRest): Resultado {
  if (e.enProceso()) return 'en-proceso';
  if (!e.procesado() || e.rechazados > 0) return 'rechazado';
  if (e.limpio()) return 'aceptado';
  if (e.reparos > 0 && e.informados > 0 && e.aceptados === e.informados) return 'reparos';
  return 'revisar';
}

function codigoFinal(envios: readonly Envio[], inciertosOIlegibles: number): CodigoSalida {
  const codigos = new Set<CodigoSalida>();
  for (const e of envios) {
    if (e.resultado === 'rechazado' || e.resultado === 'revisar') codigos.add(CODIGOS.SII);
    if (e.codigoError !== undefined) codigos.add(e.codigoError);
  }
  if (inciertosOIlegibles > 0) codigos.add(CODIGOS.INCIERTO);
  return PRIORIDAD.find((c) => codigos.has(c)) ?? CODIGOS.OK;
}

// --- Salida ---------------------------------------------------------------------

/** `2026-11-07 10:00` en hora de Chile. */
function fechaCorta(iso: string): string {
  return fechaHoraSii(new Date(iso)).replace('T', ' ').slice(0, 16);
}

function folios(registros: readonly RegistroEnvio[]): string {
  return registros.map((r) => r.folio).join(', ');
}

function tipos(registros: readonly RegistroEnvio[]): string {
  return [...new Set(registros.map((r) => r.tipoDte))].join(', ');
}

/** Columnas alineadas con espacios. */
function tabla(filas: readonly (readonly string[])[]): string[] {
  const anchos = filas[0]?.map((_, i) => Math.max(...filas.map((f) => f[i]?.length ?? 0))) ?? [];
  return filas.map((f) =>
    f
      .map((celda, i) => (i === f.length - 1 ? celda : celda.padEnd(anchos[i] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

function imprimirTabla(
  ctx: Contexto,
  ambiente: Ambiente,
  envios: readonly Envio[],
  inciertos: readonly RegistroEnvio[],
  ilegibles: readonly Ilegible[],
): void {
  ctx.imprimir(
    `Seguimiento de boletas en ${nombreAmbiente(ambiente)} (${hostsRest(ambiente).auth}), ` +
      `consultado el ${fechaCorta(ctx.reloj.ahora().toISOString())}:`,
  );

  if (envios.length > 0) {
    ctx.imprimir('');
    const filas = envios.map((e) => {
      const primero = e.registros[0];
      const conteo = (n: number | undefined) => (n === undefined ? '-' : String(n));
      return [
        folios(e.registros),
        tipos(e.registros),
        primero === undefined ? '' : fechaCorta(primero.enviadoEn),
        e.trackId,
        e.estado === undefined
          ? ETIQUETAS[e.resultado]
          : `${e.estado.estado} (${ETIQUETAS[e.resultado]})`,
        conteo(e.estado?.aceptados),
        conteo(e.estado?.rechazados),
        conteo(e.estado?.reparos),
      ];
    });
    for (const linea of tabla([
      ['Folio', 'Tipo', 'Enviado', 'TrackID', 'Estado SII', 'Acept.', 'Rech.', 'Rep.'],
      ...filas,
    ])) {
      ctx.imprimir(linea);
    }
  }

  const conDetalle = envios.filter(
    (e) =>
      e.estado !== undefined &&
      (e.resultado === 'rechazado' || e.resultado === 'reparos' || e.resultado === 'revisar'),
  );
  if (conDetalle.length > 0) {
    ctx.imprimir('');
    ctx.imprimir('Rechazos y reparos:');
    for (const e of conDetalle) {
      const estado = e.estado as EstadoEnvioRest;
      const glosa = glosaEstado(estado.estado);
      ctx.imprimir(
        `  TrackID ${e.trackId}: ${estado.estado}${glosa === undefined ? '' : ` (${glosa})`}, ` +
          `informados ${estado.informados} · aceptados ${estado.aceptados} · ` +
          `rechazados ${estado.rechazados} · reparos ${estado.reparos}`,
      );
      for (const d of estado.detalleRepRech) ctx.imprimir(`    ${describirDetalle(d)}`);
    }
  }

  const conError = envios.filter((e) => e.error !== undefined);
  if (conError.length > 0) {
    ctx.imprimir('');
    ctx.imprimir('Consultas que fallaron (vuelve a correr el seguimiento más tarde):');
    for (const e of conError) {
      ctx.imprimir(`  TrackID ${e.trackId} (folio ${folios(e.registros)}): ${e.error}`);
    }
  }

  if (inciertos.length > 0) {
    ctx.imprimir('');
    ctx.imprimir(
      'Envíos inciertos (no se sabe si llegaron al SII). Revisa cada folio en el portal del ' +
        'SII antes de hacer nada; no los reemitas a ciegas:',
    );
    for (const r of inciertos) {
      ctx.imprimir(
        `  Folio ${r.folio} (tipo ${r.tipoDte}), enviado ${fechaCorta(r.enviadoEn)}` +
          `${r.error === undefined ? '' : `: ${r.error}`}`,
      );
    }
  }

  if (ilegibles.length > 0) {
    ctx.imprimir('');
    ctx.imprimir('Registros ilegibles (revísalos a mano y en el portal del SII):');
    for (const i of ilegibles) ctx.imprimir(`  ${i.archivo}: ${i.motivo}`);
  }

  const cuenta = (r: Resultado) => envios.filter((e) => e.resultado === r).length;
  const rechazados = cuenta('rechazado') + cuenta('revisar');
  ctx.imprimir('');
  ctx.imprimir(
    `Resumen: ${envios.length} envíos consultados · ${cuenta('aceptado')} aceptados · ` +
      `${cuenta('reparos')} con reparos · ${cuenta('en-proceso')} en proceso · ` +
      `${rechazados} rechazados · ${cuenta('error')} con error · ` +
      `${inciertos.length + ilegibles.length} por revisar en el SII`,
  );
  if (cuenta('en-proceso') > 0) {
    ctx.imprimir(
      'Hay envíos que el SII todavía valida: vuelve a correr ' +
        `\`sii produccion seguimiento${sufijoAmbiente(ambiente)}\` en unos minutos.`,
    );
  }
}

function describirDetalle(d: DetalleRepRechRest): string {
  const errores = d.errores.map(
    (err) =>
      `${err.codigo === null ? '' : `[${err.codigo}] `}${err.descripcion}` +
      `${err.detalle === '' ? '' : `: ${err.detalle}`}`,
  );
  return (
    `Tipo ${d.tipo} folio ${d.folio}: ${d.estado}${d.descripcion === '' ? '' : ` (${d.descripcion})`}` +
    `${errores.length === 0 ? '' : ` - ${errores.join('; ')}`}`
  );
}

/** Datos de un envío para `--json` y la bitácora (sin RUTs ni el token). */
function datosEnvio(e: Envio) {
  const comun = {
    trackId: e.trackId,
    folios: e.registros.map((r) => r.folio),
    tiposDte: [...new Set(e.registros.map((r) => r.tipoDte))],
    resultado: e.resultado,
  };
  if (e.estado === undefined) return { ...comun, error: e.error ?? '' };
  return {
    ...comun,
    estado: e.estado.estado,
    informados: e.estado.informados,
    aceptados: e.estado.aceptados,
    rechazados: e.estado.rechazados,
    reparos: e.estado.reparos,
  };
}

function aJson(
  ctx: Contexto,
  ambiente: Ambiente,
  carpeta: string,
  envios: readonly Envio[],
  inciertos: readonly RegistroEnvio[],
  ilegibles: readonly Ilegible[],
  codigo: CodigoSalida,
) {
  return {
    ambiente,
    consultadoEn: ctx.reloj.ahora().toISOString(),
    carpeta,
    codigo,
    envios: envios.map((e) => ({
      ...datosEnvio(e),
      enviadoEn: e.registros[0]?.enviadoEn ?? '',
      ...(e.estado === undefined
        ? {}
        : {
            glosa: glosaEstado(e.estado.estado) ?? '',
            fechaRecepcion: e.estado.fechaRecepcion,
            detalle: e.estado.detalleRepRech,
          }),
    })),
    inciertos: inciertos.map((r) => ({
      folio: r.folio,
      tipoDte: r.tipoDte,
      enviadoEn: r.enviadoEn,
      archivo: r.archivo,
      ...(r.error === undefined ? {} : { error: r.error }),
    })),
    ilegibles,
  };
}

/** Agrega una línea JSON por envío revisado (y por incierto o ilegible). */
function escribirBitacora(
  ruta: string,
  ctx: Contexto,
  ambiente: Ambiente,
  envios: readonly Envio[],
  inciertos: readonly RegistroEnvio[],
  ilegibles: readonly Ilegible[],
): void {
  const consultadoEn = ctx.reloj.ahora().toISOString();
  const lineas = [
    ...envios.map((e) => ({ consultadoEn, ambiente, ...datosEnvio(e) })),
    ...inciertos.map((r) => ({
      consultadoEn,
      ambiente,
      folios: [r.folio],
      tiposDte: [r.tipoDte],
      resultado: 'incierto',
    })),
    ...ilegibles.map((i) => ({
      consultadoEn,
      ambiente,
      archivo: i.archivo,
      resultado: 'ilegible',
    })),
  ];
  try {
    appendFileSync(ruta, lineas.map((l) => `${JSON.stringify(l)}\n`).join(''), 'utf8');
  } catch (error) {
    throw new ErrorConfig(`No se pudo escribir la bitácora: ${ruta}`, { cause: error });
  }
}
