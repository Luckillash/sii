/**
 * Validación de la fase 6 contra el portal de la declaración de cumplimiento de
 * boletas (www4.sii.cl, PLAN-MIGRACION §5.4), usando solo la librería Node.
 *
 *   node scripts/declaracion.ts verificar-portal
 *       SIN login: un GET público a <PERMUTACION>.cache.html de la app GWT. Dice si
 *       el portal sigue siendo la versión capturada (POLICY, servicio, firmas de
 *       tipo y métodos). No envía cookies ni datos de la empresa.
 *   node scripts/declaracion.ts estado
 *       Login AUT2000 con el certificado (como la postulación) y consulta del estado
 *       de la declaración (obtenerEstadoAutorizaEmp): solo lectura.
 *   node scripts/declaracion.ts descargar-set --confirmar [--aunque-autorizada]
 *       Login, estado y DESCARGA del set de pruebas de boletas (DownloadFileServlet,
 *       "Generación de nuevo set de pruebas"): el SII REGISTRA la descarga y genera
 *       un set nuevo. La librería no descarga si la empresa está en P90 (un set nuevo
 *       reiniciaría la certificación); este script además se detiene si la empresa
 *       ya está autorizada (P91), salvo con --aunque-autorizada. El set se guarda en
 *       data/output/declaracion-<fecha>/ (no se versiona) y solo se muestra un resumen.
 *
 *   Opciones: --help, --seco (muestra lo que haría, sin red, sin leer el
 *   certificado), --correo <correo del proveedor> (si no, SII_CORREO_PROVEEDOR).
 *
 * Este script NO declara cumplimiento (autorizarEmpresaBolProd) ni pide la revisión
 * del set (ingresarTrackId): esas operaciones no están aquí a propósito.
 *
 * Configuración en el .env de la raíz (ver `.env.example`): SII_CERT_PATH,
 * SII_CERT_PASS, SII_RUT_EMPRESA y, para descargar-set, SII_CORREO_PROVEEDOR.
 *
 * Seguridad: nunca imprime el RUT completo (ni en los mensajes de error), cookies,
 * tokens, la clave ni el nombre del .pfx.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Certificado,
  DeclaracionBoletas,
  DeclaracionInciertaError,
  PERMUTACION_DECLARACION,
  PostulacionSii,
  parsearSetPruebas,
  Rut,
  SesionCaducaError,
  SiiError,
  TransporteUndici,
  validarCorreo,
} from '../packages/core/src/index.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USO = `Uso:
  node scripts/declaracion.ts verificar-portal              (sin login; GET público)
  node scripts/declaracion.ts estado                        (login + estado; solo lectura)
  node scripts/declaracion.ts descargar-set --confirmar [--aunque-autorizada] [--correo <correo>]
                                                            (login + DESCARGA el set: el SII la registra)
Opciones: --help, --seco (sin red: muestra lo que haría).
No declara cumplimiento ni pide la revisión del set.`;

function env(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre]?.trim();
  if (valor) return valor;
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`Falta ${nombre} en el .env (ver .env.example).`);
}

/** `76123456-0` → `*****456-0`. */
function enmascararRut(rut: Rut): string {
  return `${'*'.repeat(Math.max(0, rut.numero.length - 3))}${rut.numero.slice(-3)}-${rut.dv}`;
}

/** Quita los RUT (con o sin puntos y guion) y los números largos de un texto que se va a mostrar. */
function sinRut(texto: string): string {
  return texto
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g, (m) => `***${m.slice(-5)}`)
    .replace(/\b\d{7,}\b/g, (m) => `***${m.slice(-3)}`);
}

/** `correo@dominio.cl` → `c***@dominio.cl`. */
function enmascararCorreo(correo: string): string {
  const arroba = correo.indexOf('@');
  return arroba <= 0 ? '***' : `${correo[0]}***${correo.slice(arroba)}`;
}

function opcion(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return undefined;
  const valor = args[i + 1];
  if (valor === undefined || valor.startsWith('--')) throw new Error(`--${nombre} sin valor.`);
  return valor;
}

async function main(): Promise<void> {
  const [comando, ...args] = process.argv.slice(2);
  if (
    comando === undefined ||
    comando === '--help' ||
    args.includes('--help') ||
    !['verificar-portal', 'estado', 'descargar-set'].includes(comando)
  ) {
    console.log(USO);
    if (comando !== '--help' && !args.includes('--help')) process.exitCode = 2;
    return;
  }
  const seco = args.includes('--seco');

  if (comando === 'descargar-set' && !args.includes('--confirmar') && !seco) {
    console.log(
      'descargar-set registra en el SII la descarga de un set de pruebas NUEVO.\n' +
        'Para hacerlo de verdad, repite con --confirmar (o usa --seco para ver qué haría).',
    );
    process.exitCode = 2;
    return;
  }

  if (comando === 'verificar-portal') {
    console.log(
      `verificar-portal: GET https://www4.sii.cl/certBolElectDteInternet/${PERMUTACION_DECLARACION}.cache.html (sin cookies).`,
    );
    if (seco) {
      console.log('--seco: no se envió nada.');
      return;
    }
    const transporte = new TransporteUndici();
    try {
      const problemas = await new DeclaracionBoletas({ transporte }).verificarPortal();
      if (problemas.length === 0) {
        console.log(
          'Portal vigente: es la versión capturada (POLICY, firmas y métodos presentes).',
        );
      } else {
        console.log('El portal NO es la versión capturada:');
        for (const p of problemas) console.log(`  - ${p}`);
        process.exitCode = 1;
      }
    } finally {
      await transporte.close();
    }
    return;
  }

  // estado / descargar-set: login con el certificado.
  try {
    process.loadEnvFile(join(RAIZ, '.env'));
  } catch {
    // Sin .env: se usan las variables del entorno.
  }
  const rutEmpresa = Rut.de(env('SII_RUT_EMPRESA'), 'SII_RUT_EMPRESA');
  const correo =
    comando === 'descargar-set' ? (opcion(args, 'correo') ?? env('SII_CORREO_PROVEEDOR')) : '';
  if (comando === 'descargar-set') validarCorreo(correo, 'correo del proveedor de software');

  console.log(`Empresa: ${enmascararRut(rutEmpresa)}.`);
  console.log(
    comando === 'estado'
      ? 'estado: login AUT2000 (herculesr → maullin) y obtenerEstadoAutorizaEmp en www4 (solo lectura).'
      : `descargar-set: login, estado, obtenerPostulacionSeg y GET DownloadFileServlet (correo ${enmascararCorreo(correo)}).`,
  );
  if (seco) {
    console.log('--seco: no se leyó el certificado ni se envió nada.');
    return;
  }

  const certificado = await Certificado.desdeArchivo(
    resolve(RAIZ, env('SII_CERT_PATH')),
    env('SII_CERT_PASS', ''),
  );
  const transporte = new TransporteUndici();
  try {
    console.log('Autenticando con el certificado...');
    const sesion = await new PostulacionSii({ transporte }).autenticar(certificado);
    console.log('  sesión AUT2000 OK.');

    const declaracion = new DeclaracionBoletas({ transporte });
    const estado = await declaracion.estado(sesion, rutEmpresa);
    console.log(
      `Estado: ${estado.codigo ?? '(sin trámite: ya autorizada, sin postular o el usuario no la representa)'}` +
        `${estado.glosa !== '' ? ` ${sinRut(estado.glosa)}` : ''}${estado.paso !== null ? ` (paso ${estado.paso})` : ''}.`,
    );
    console.log(
      `Declarar cumplimiento: ${estado.porDeclarar() ? 'SÍ, pendiente (P90)' : 'no corresponde'}.` +
        `${estado.autorizada() ? ' Autorizada en producción (P91).' : ''}`,
    );
    if (comando === 'estado') return;

    if (estado.autorizada() && !args.includes('--aunque-autorizada')) {
      console.log(
        'La empresa ya está autorizada (P91): no se descarga un set nuevo. ' +
          'Si de verdad hace falta, repite con --aunque-autorizada.',
      );
      process.exitCode = 1;
      return;
    }

    console.log('Descargando el set de pruebas (el SII registra la descarga)...');
    const set = await declaracion.descargarSetPruebas(sesion, rutEmpresa, correo);
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    const carpeta = join(RAIZ, 'data', 'output', `declaracion-${marca}`);
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, 'set-pruebas.txt'), set, 'utf8');

    const casosEnTexto = new Set(set.match(/CASO-\d+/g) ?? []).size;
    let lectura: string;
    try {
      lectura = `parsearSetPruebas lee ${parsearSetPruebas(set).length} casos`;
    } catch (error) {
      lectura = `parsearSetPruebas no lo pudo leer (${error instanceof Error ? sinRut(error.message) : 'error'})`;
    }
    console.log(
      `Set descargado: ${Buffer.byteLength(set, 'utf8')} bytes, ${set.split(/\r?\n/).length} líneas, ` +
        `${casosEnTexto} CASO-N distintos; ${lectura}.`,
    );
    console.log(`Guardado en data/output/declaracion-${marca}/set-pruebas.txt (no se versiona).`);
  } catch (error) {
    if (error instanceof DeclaracionInciertaError) {
      // No ocurre en este script (no declara), pero por si acaso.
      console.log(`ATENCIÓN: ${sinRut(error.message)}`);
    } else if (error instanceof SesionCaducaError) {
      console.log(`La sesión no sirvió (${sinRut(error.message)}).`);
    } else if (error instanceof SiiError) {
      console.log(`Error (${error.name}): ${sinRut(error.message)}`);
    } else {
      throw error;
    }
    process.exitCode = 1;
  } finally {
    await transporte.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${sinRut(error.message)}` : 'Error');
  process.exitCode = 1;
});
