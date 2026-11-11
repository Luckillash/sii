// `sii produccion emitir`: arma una boleta y la envía por la API REST del SII.
// Reemplaza bin/produccion/emitir-boleta.php (sin datos fijos: pend. 5).
//
// Seguridad: en producción esto crea un documento tributario REAL y consume un
// folio. Por eso:
// - sin `--confirmar` no sale nada a la red: arma, guarda el XML y muestra el resumen;
// - toda la validación (opciones, .env, JSON, CAF, folio) ocurre antes de la primera petición;
// - cada envío deja un registro `boleta-<ambiente>-<folio>.envio.json` en la carpeta
//   de salida, y un folio con registro no se vuelve a armar ni a enviar;
// - si el envío falla sin saber si llegó al SII, el registro queda como incierto y
//   la salida es 6 (revisar en el SII antes de reintentar).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Ambiente,
  ArmadorBoleta,
  decodificarUtf8OIso,
  EnvioBoleta,
  ErrorTransporte,
  ErrorValidacion,
  FirmaElectronica,
  type RespuestaEnvioRest,
} from '@winex/certificacion';
import {
  cargarCertificado,
  configEmisor,
  configEmpresa,
  configResolucion,
  leerArchivo,
  rutaArchivo,
  rutaDelArgumento,
} from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, describirError, ErrorConfig, ErrorUso } from '../../errores.ts';
import { carpetaSalida, guardarArchivo } from '../../salida.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionAmbiente,
  opcionBooleana,
  opcionEntero,
  opcionTexto,
} from '../tipos.ts';
import { type BoletaJson, FORMATO_BOLETA_JSON, leerBoletaJson } from './boleta-json.ts';
import { clienteRest, hostsRest, nombreAmbiente, sufijoAmbiente } from './rest.ts';

const AYUDA = `Uso: sii produccion emitir --boleta <archivo.json> --folio <N> [opciones]

Arma una boleta electrónica (DTE 39 o 41), la timbra con el CAF, la firma, la
empaqueta en un EnvioBOLETA y, solo con --confirmar, la envía por la API REST.

  EN PRODUCCIÓN (el ambiente por defecto) LA BOLETA ES UN DOCUMENTO TRIBUTARIO
  REAL Y CONSUME EL FOLIO. Pruebe primero sin --confirmar y revise el resumen.

Opciones:
  --boleta <archivo.json>   Obligatorio. Ítems, receptor y descuento (formato abajo).
  --folio <N>               Obligatorio. Folio a usar; debe estar en el rango del CAF.
  --ambiente <amb>          produccion (por defecto: api.sii.cl / rahue.sii.cl) o
                            certificacion (apicert.sii.cl / pangal.sii.cl, para probar).
  --caf <ruta>              CAF del tipo de documento (reemplaza a la variable del .env).
  --nro-resol <N>           Número de resolución de la carátula (reemplaza al .env).
  --fch-resol <AAAA-MM-DD>  Fecha de resolución de la carátula (reemplaza al .env).
  --salida <dir>            Carpeta de salida (por defecto data/output junto al .env).
  --confirmar               Envía la boleta al SII. Sin esta opción no hay ninguna
                            petición de red.

Variables del .env:
  SII_CERT_PATH, SII_CERT_PASS          certificado que firma
  SII_RUT_EMPRESA, SII_RUT_FIRMA        emisor y titular del certificado (RutEnvia)
  EMISOR_RAZON_SOCIAL, EMISOR_GIRO, EMISOR_DIRECCION, EMISOR_COMUNA
  producción:    SII_PRODUCCION_CAF_39 (o _41), SII_PRODUCCION_NRO_RESOL,
                 SII_PRODUCCION_FCH_RESOL (sin valores por defecto)
  certificación: SII_CAF_39 (o _41), SII_NRO_RESOL (por defecto 0), SII_FCH_RESOL
  SII_CACHE_TOKENS (opcional)           caché de tokens entre ejecuciones

Qué sale al SII (solo con --confirmar):
  GET semilla y POST token (si no hay token vigente en SII_CACHE_TOKENS) y
  POST boleta.electronica.envio con el sobre.

Archivos que escribe (en la carpeta de salida):
  boleta-<ambiente>-<folio>.xml         el sobre EnvioBOLETA firmado (ISO-8859-1)
  boleta-<ambiente>-<folio>.envio.json  registro del envío (trackId, estado). Mientras
                                        exista, ese folio no se vuelve a emitir.

Códigos de salida: 0 OK · 1 boleta inválida (p. ej. folio fuera del CAF) · 2 uso ·
  3 configuración o JSON inválidos · 4 red/HTTP antes del envío (token) o HTTP 4xx
  del SII al envío (la boleta no quedó recibida) · 6 incierto: corte de red, 5xx o
  respuesta sin trackId al enviar; no se sabe si el SII recibió la boleta, revisar
  antes de reintentar.

${FORMATO_BOLETA_JSON}`;

/**
 * Lo que queda en `boleta-<ambiente>-<folio>.envio.json`. Nunca el token. Lo lee
 * también `sii produccion seguimiento`.
 */
export interface RegistroEnvio {
  readonly ambiente: Ambiente;
  readonly tipoDte: number;
  readonly folio: number;
  readonly archivo: string;
  readonly enviadoEn: string;
  readonly incierto: boolean;
  readonly trackId?: string;
  readonly estado?: string;
  readonly fechaRecepcion?: string;
  readonly error?: string;
}

export const comando: DefinicionComando = {
  grupo: 'produccion',
  nombre: 'emitir',
  resumen: 'Arma y emite una boleta por la API REST',
  ayuda: AYUDA,
  opciones: {
    boleta: { type: 'string' },
    folio: { type: 'string' },
    ambiente: { type: 'string' },
    caf: { type: 'string' },
    'nro-resol': { type: 'string' },
    'fch-resol': { type: 'string' },
    salida: { type: 'string' },
    confirmar: { type: 'boolean' },
  },
  ejecutar: emitir,
};

async function emitir(ctx: Contexto, entrada: EntradaComando) {
  // 1. Opciones (errores de uso, sin leer la config).
  const ambiente = opcionAmbiente(entrada, 'produccion');
  const archivoBoleta = opcionTexto(entrada, 'boleta');
  if (archivoBoleta === undefined) throw new ErrorUso('Falta --boleta <archivo.json>.');
  const folio = opcionEntero(entrada, 'folio');
  if (folio === undefined) throw new ErrorUso('Falta --folio <N>.');
  const confirmar = opcionBooleana(entrada, 'confirmar');

  // 2. Configuración y archivos. Nada de esto sale a la red.
  const config = entrada.config();
  const rutaBoleta = rutaDelArgumento(config, archivoBoleta);
  const boleta = leerBoletaJson(leerArchivo(rutaBoleta, 'el archivo de --boleta'), rutaBoleta);
  const emisor = configEmisor(config);
  const { rutEmpresa, rutEnvia } = configEmpresa(config);
  const resolucion = configResolucion(config, ambiente, {
    nroResol: opcionTexto(entrada, 'nro-resol'),
    fchResol: opcionTexto(entrada, 'fch-resol'),
  });
  const variableCaf = `${ambiente === 'produccion' ? 'SII_PRODUCCION_CAF_' : 'SII_CAF_'}${boleta.tipoDte}`;
  const rutaCaf = rutaArchivo(config, variableCaf, {
    valor: opcionTexto(entrada, 'caf'),
    opcion: '--caf',
  });
  const caf = leerArchivo(rutaCaf, 'el CAF');
  const certificado = await cargarCertificado(config);

  const carpeta = carpetaSalida(config, opcionTexto(entrada, 'salida'));
  const base = `boleta-${ambiente}-${folio}`;
  exigirFolioSinRegistro(join(carpeta, `${base}.envio.json`), folio);
  // Con --confirmar, también el caché de tokens se valida antes de armar.
  const rest = confirmar ? clienteRest(ctx, config, certificado, ambiente) : undefined;

  // 3. Armado (valida el CAF: emisor, tipo y rango de folios).
  const firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
  const dte = new ArmadorBoleta(firmador, { reloj: ctx.reloj }).armar(
    {
      emisor,
      receptor: boleta.receptor,
      folio,
      tipoDte: boleta.tipoDte,
      detalles: boleta.detalles,
      ...(boleta.descuento === undefined ? {} : { descuento: boleta.descuento }),
    },
    caf,
  );
  const sobre = new EnvioBoleta(
    firmador,
    { rutEmisor: rutEmpresa, rutEnvia, ...resolucion },
    { reloj: ctx.reloj },
  ).empaquetar([dte]);
  const rutaXml = guardarArchivo(carpeta, `${base}.xml`, sobre);

  // 4. Resumen.
  if (ambiente === 'produccion') {
    ctx.imprimirError(
      `[AVISO] PRODUCCIÓN: esta boleta es un documento tributario REAL y ${
        confirmar ? 'consume' : 'consumiría'
      } el folio ${folio}.`,
    );
  }
  imprimirResumen(ctx, {
    ambiente,
    boleta,
    folio,
    emisor: `${emisor.razonSocial} (${emisor.rut})`,
    rutaCaf,
    caf,
    dte,
    resolucion,
    rutaXml,
  });

  if (rest === undefined) {
    ctx.imprimir('');
    ctx.imprimir('No se envió nada al SII (falta --confirmar).');
    ctx.imprimir(
      `Para emitirla de verdad${
        ambiente === 'produccion' ? ' (documento real)' : ''
      }, repite el mismo comando agregando --confirmar.`,
    );
    return CODIGOS.OK;
  }

  // 5. Envío.
  const hosts = hostsRest(ambiente);
  ctx.imprimir('');
  ctx.imprimir(`Enviando al SII de ${nombreAmbiente(ambiente)} (${hosts.envio})...`);
  const token = await rest.token(rutEmpresa);
  const registrar = (datos: Partial<RegistroEnvio> & { incierto: boolean }) =>
    guardarArchivo(
      carpeta,
      `${base}.envio.json`,
      Buffer.from(
        `${JSON.stringify(
          {
            ambiente,
            tipoDte: boleta.tipoDte,
            folio,
            archivo: `${base}.xml`,
            enviadoEn: ctx.reloj.ahora().toISOString(),
            ...datos,
          } satisfies RegistroEnvio,
          null,
          2,
        )}\n`,
        'utf8',
      ),
    );

  let respuesta: RespuestaEnvioRest;
  try {
    respuesta = await rest.cliente.enviarBoleta(token, rutEmpresa, rutEnvia, sobre);
  } catch (error) {
    if (error instanceof ErrorTransporte && error.status === 401 && rest.conCache) {
      // El SII rechazó el token del caché: la próxima ejecución pide uno nuevo.
      await rest.cliente.olvidarToken(rutEmpresa);
    }
    if (!envioIncierto(error)) throw error;
    const registro = registrar({ incierto: true, error: describirError(error) });
    ctx.imprimirError(`[ERROR] ${describirError(error)}`);
    ctx.imprimirError(
      `[AVISO] No se sabe si el SII recibió la boleta (folio ${folio}). NO la reenvíes a ciegas: ` +
        `revisa en el SII si el folio quedó emitido. El folio quedó bloqueado en ${registro}; ` +
        'bórralo solo si confirmas que la boleta no llegó.',
    );
    return CODIGOS.INCIERTO;
  }
  registrar({
    incierto: false,
    trackId: respuesta.trackId,
    estado: respuesta.estado,
    fechaRecepcion: respuesta.fechaRecepcion,
  });

  ctx.imprimir(`[OK] Boleta recibida por el SII de ${nombreAmbiente(ambiente)}.`);
  ctx.imprimir(`  TrackID:   ${respuesta.trackId}`);
  ctx.imprimir(`  Estado:    ${respuesta.estado || '(sin estado)'}`);
  if (respuesta.fechaRecepcion !== '') ctx.imprimir(`  Recibida:  ${respuesta.fechaRecepcion}`);
  ctx.imprimir('');
  ctx.imprimir(
    `Siguiente paso, en unos minutos: sii produccion consultar ${respuesta.trackId}${sufijoAmbiente(ambiente)}`,
  );
  return CODIGOS.OK;
}

/**
 * Un folio con registro de envío ya salió (o pudo salir) al SII: no se vuelve a
 * armar ni a enviar, para no pisar el XML enviado ni duplicar el documento.
 */
function exigirFolioSinRegistro(ruta: string, folio: number): void {
  if (!existsSync(ruta)) return;
  let detalle = '';
  try {
    const registro = JSON.parse(readFileSync(ruta, 'utf8')) as Partial<RegistroEnvio>;
    if (registro.incierto === true) detalle = ' (envío incierto: revisar en el SII)';
    else if (typeof registro.trackId === 'string') detalle = ` (trackId ${registro.trackId})`;
  } catch {
    // Registro ilegible: igual bloquea.
  }
  throw new ErrorConfig(
    `El folio ${folio} ya se envió al SII según ${ruta}${detalle}. Usa otro folio; ` +
      'borra ese archivo solo si confirmas en el SII que la boleta no quedó emitida.',
  );
}

/**
 * Si un error del envío deja la duda de si la boleta llegó. Solo no la deja un
 * error de validación (no salió nada) o una respuesta HTTP 4xx (el SII la rechazó).
 */
function envioIncierto(error: unknown): boolean {
  if (error instanceof ErrorValidacion) return false;
  if (error instanceof ErrorTransporte && error.status !== undefined && error.status < 500) {
    return false;
  }
  return true;
}

interface DatosResumen {
  readonly ambiente: Ambiente;
  readonly boleta: BoletaJson;
  readonly folio: number;
  readonly emisor: string;
  readonly rutaCaf: string;
  readonly caf: Buffer;
  readonly dte: Buffer;
  readonly resolucion: { nroResol: string; fchResol: string };
  readonly rutaXml: string;
}

function imprimirResumen(ctx: Contexto, d: DatosResumen): void {
  const dte = d.dte.toString('latin1');
  const campo = (etiqueta: string) =>
    new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(dte)?.[1] ?? '?';
  // Solo el rango de folios del CAF (dato público), nunca su contenido.
  const rango = /<RNG>\s*<D>\s*(\d+)\s*<\/D>\s*<H>\s*(\d+)\s*<\/H>/.exec(
    decodificarUtf8OIso(d.caf),
  );
  const { boleta } = d;

  ctx.imprimir(
    `Boleta ${boleta.tipoDte === 41 ? 'exenta' : 'afecta'} (tipo ${boleta.tipoDte}), ambiente ${nombreAmbiente(d.ambiente)}:`,
  );
  ctx.imprimir(`  Emisor:      ${d.emisor}`);
  ctx.imprimir(`  Receptor:    ${boleta.receptor.razonSocial ?? ''} (${boleta.receptor.rut})`);
  ctx.imprimir(`  Folio:       ${d.folio}`);
  ctx.imprimir(
    `  CAF:         ${d.rutaCaf}${rango === null ? '' : ` (folios ${rango[1]} a ${rango[2]})`}`,
  );
  ctx.imprimir(`  Fecha:       ${campo('FchEmis')}`);
  ctx.imprimir(`  Resolución:  N° ${d.resolucion.nroResol} del ${d.resolucion.fchResol}`);
  ctx.imprimir('  Ítems:');
  boleta.detalles.forEach((item, i) => {
    const unidad = item.unidad === undefined ? '' : ` ${item.unidad}`;
    ctx.imprimir(
      `    ${i + 1}. ${item.nombre}: ${item.cantidad}${unidad} x $${item.precio}${item.exento === true ? ' (exento)' : ''}`,
    );
  });
  if (boleta.descuento !== undefined && boleta.descuento.valor > 0) {
    const { tipo = 'monto', valor } = boleta.descuento;
    ctx.imprimir(
      `  Descuento:   ${tipo === 'porcentaje' ? `${valor}%` : `$${valor}`} (sobre lo afecto)`,
    );
  }
  ctx.imprimir(`  Total:       $${campo('MntTotal')}`);
  ctx.imprimir(`  XML:         ${d.rutaXml}`);
}
