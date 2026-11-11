// `sii certificacion descargar-set`: descarga el set de pruebas de boletas del
// portal de la declaración (www4). El SII REGISTRA la descarga y genera un set nuevo.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fechaSii, parsearSetPruebas, validarCorreo } from '@winex/certificacion';
import {
  type Config,
  cargarCertificado,
  correo,
  leerVariables,
  rutaDelArgumento,
  rutaDelEnv,
} from '../../config.ts';
import { CODIGOS } from '../../errores.ts';
import { type DefinicionComando, opcionBooleana, opcionTexto } from '../tipos.ts';
import {
  AYUDA_LOGIN,
  autenticar,
  declaracionBoletas,
  lineasEstado,
  rutEmpresa,
  sinConfirmar,
  validarDatos,
} from './comun-portal.ts';

/** Carpeta por defecto del set, junto al `.env` (la misma de `SII_SET_PRUEBAS` en el ejemplo). */
const CARPETA_POR_DEFECTO = join('data', 'set_pruebas');

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'descargar-set',
  resumen: 'Descarga un set de pruebas de boletas NUEVO (el SII registra la descarga)',
  ayuda: [
    'Uso: sii certificacion descargar-set [--correo <correo>] [--rut <rut>] [--salida <dir>]',
    '                                     [--aunque-autorizada] --confirmar',
    '',
    'Descarga el set de pruebas de boletas en el portal de la declaración',
    '("Generación de nuevo set de pruebas"). El SII REGISTRA la descarga y entrega un',
    'set NUEVO: los envíos hechos con un set anterior dejan de servir para la revisión.',
    '',
    'Candados:',
    '  - Si la empresa está en P90 (lista para declarar) la librería no descarga: un set',
    '    nuevo reiniciaría su certificación (código 5).',
    '  - Si ya está autorizada (P91) el comando se detiene (código 1): no se sabe si un',
    '    set nuevo la afecta en el SII. Para hacerlo igual: --aunque-autorizada.',
    '',
    'Opciones:',
    '  --correo <correo>     Correo del proveedor de software (en vez de SII_CORREO_PROVEEDOR).',
    '  --rut <rut>           RUT de la empresa (en vez de SII_RUT_EMPRESA).',
    '  --salida <dir>        Carpeta donde se guarda (por defecto data/set_pruebas junto al .env).',
    '  --aunque-autorizada   Descarga aunque la empresa ya esté autorizada (P91).',
    '  --confirmar           Descarga de verdad. Sin ella se valida todo y no se envía nada.',
    '',
    'Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA, SII_CORREO_PROVEEDOR.',
    '',
    'Qué sale al SII (ambiente certificación), solo con --confirmar:',
    `  1. ${AYUDA_LOGIN}`,
    '  2. obtenerEstadoAutorizaEmp y obtenerPostulacionSeg en www4.sii.cl (GWT-RPC).',
    '  3. GET DownloadFileServlet con el RUT de la empresa, el del usuario del',
    '     certificado y el correo del proveedor: aquí el SII registra la descarga.',
    '',
    'Archivos que escribe: <salida>/set-pruebas-AAAA-MM-DD.txt (UTF-8, fecha de Chile).',
    'Nunca reemplaza un archivo: si ya existe, agrega -2, -3... al nombre. Al final',
    'sugiere la línea SII_SET_PRUEBAS=... para el .env (el comando no edita el .env).',
  ].join('\n'),
  opciones: {
    correo: { type: 'string' },
    rut: { type: 'string' },
    salida: { type: 'string' },
    'aunque-autorizada': { type: 'boolean' },
    confirmar: { type: 'boolean' },
  },
  async ejecutar(ctx, entrada) {
    const config = entrada.config();
    const empresa = rutEmpresa(config, { valor: opcionTexto(entrada, 'rut'), opcion: '--rut' });
    const { SII_CORREO_PROVEEDOR: correoProveedor } = leerVariables(
      config,
      { SII_CORREO_PROVEEDOR: correo },
      { SII_CORREO_PROVEEDOR: { valor: opcionTexto(entrada, 'correo'), opcion: '--correo' } },
    );
    validarDatos('el correo del proveedor', () =>
      validarCorreo(correoProveedor, 'correo del proveedor de software'),
    );
    const carpeta = carpetaSet(config, opcionTexto(entrada, 'salida'));
    const aunqueAutorizada = opcionBooleana(entrada, 'aunque-autorizada');
    const certificado = await cargarCertificado(config);

    ctx.imprimir(`Empresa: ${empresa}`);
    ctx.imprimir(`Correo del proveedor: ${correoProveedor}`);
    ctx.imprimir(`Carpeta de salida: ${carpeta}`);
    ctx.imprimir(
      'Descarga de un set de pruebas NUEVO en www4.sii.cl: el SII registra la descarga.',
    );
    if (!opcionBooleana(entrada, 'confirmar')) {
      return sinConfirmar(ctx, 'sii certificacion descargar-set');
    }

    const sesion = await autenticar(ctx, certificado);
    const declaracion = declaracionBoletas(ctx);
    const estado = await declaracion.estado(sesion, empresa);
    for (const linea of lineasEstado(estado)) ctx.imprimir(linea);
    if (estado.autorizada() && !aunqueAutorizada) {
      ctx.imprimirError(
        '[ERROR] La empresa ya está autorizada (P91): no se descarga un set nuevo porque no se ' +
          'sabe si la afecta en el SII. Si de verdad hace falta, repite con --aunque-autorizada.',
      );
      return CODIGOS.ERROR;
    }

    ctx.imprimir('Descargando el set de pruebas (el SII registra la descarga)...');
    const set = await declaracion.descargarSetPruebas(sesion, empresa, correoProveedor);
    const ruta = guardarSinReemplazar(carpeta, `set-pruebas-${fechaSii(ctx.reloj.ahora())}`, set);

    let lectura: string;
    try {
      lectura = `se leen ${parsearSetPruebas(set).length} casos`;
    } catch (error) {
      lectura = `parsearSetPruebas no lo pudo leer (${error instanceof Error ? error.message : String(error)}); revísalo antes de enviar-set`;
    }
    ctx.imprimir(`Set guardado en ${ruta} (${lectura}).`);
    ctx.imprimir('Para usarlo en enviar-set, deja en el .env:');
    ctx.imprimir(`  SII_SET_PRUEBAS=${rutaParaEnv(config, ruta)}`);
    return CODIGOS.OK;
  },
};

/** `--salida` (relativa al `cwd`) o `data/set_pruebas` junto al `.env`. */
function carpetaSet(config: Config, opcion: string | undefined): string {
  return opcion !== undefined
    ? rutaDelArgumento(config, opcion)
    : rutaDelEnv(config, CARPETA_POR_DEFECTO);
}

/**
 * Escribe `<carpeta>/<base>.txt` o, si existe, `<base>-2.txt`, `<base>-3.txt`...
 * Usa la bandera `wx`: nunca reemplaza un archivo, ni siquiera en una carrera.
 */
function guardarSinReemplazar(carpeta: string, base: string, contenido: string): string {
  mkdirSync(carpeta, { recursive: true });
  for (let n = 1; ; n++) {
    const ruta = join(carpeta, n === 1 ? `${base}.txt` : `${base}-${n}.txt`);
    try {
      writeFileSync(ruta, contenido, { encoding: 'utf8', flag: 'wx' });
      return ruta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Ruta para el `.env`: relativa a su carpeta si queda dentro, con `/`. */
function rutaParaEnv(config: Config, ruta: string): string {
  const rel = relative(config.base, ruta);
  if (rel === '' || rel.startsWith('..') || /^[a-zA-Z]:/.test(rel)) return ruta;
  return rel.split(sep).join('/');
}
