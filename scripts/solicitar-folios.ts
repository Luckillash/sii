/**
 * Validación de la fase 5 contra el SII de CERTIFICACIÓN (PLAN-MIGRACION §5.4):
 * login AUT2000 con el certificado real y solicitud de folios (CAF) en maullin,
 * usando solo la librería Node.
 *
 *   node scripts/solicitar-folios.ts revisar [--tipo 39] [--cantidad 5]
 *       Inicia sesión y recorre el asistente hasta la confirmación, y se DETIENE
 *       antes de la orden de timbrar (esa petición no sale). No gasta folios.
 *       Guarda las páginas del SII para compararlas con el parser del PHP.
 *   node scripts/solicitar-folios.ts solicitar [--tipo 39] [--cantidad 5]
 *       Igual, pero TIMBRA los folios y guarda el CAF en data/caf/.
 *
 * Siempre ambiente `certificacion` (maullin): este script no sabe pedir folios de
 * producción.
 *
 * Seguridad: nunca imprime cookies, la clave del .pfx, el RUT ni el contenido del
 * CAF. Las páginas del SII (traen RUT, razón social y nombre del usuario) se
 * guardan en data/output/folios-<fecha>/, que no se versiona; de cada respuesta se
 * guarda el cuerpo y, de las cabeceras, solo status, Content-Type, Location y los
 * NOMBRES de las cookies.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Certificado,
  FoliosSinCafError,
  type PeticionHttp,
  type RespuestaHttp,
  Rut,
  SesionCaducaError,
  SiiError,
  SolicitudFolios,
  type TransporteHttp,
  TransporteUndici,
} from '../packages/core/src/index.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function env(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre]?.trim();
  if (valor) return valor;
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`Falta ${nombre} en el .env (ver .env.example).`);
}

/** La petición que timbra no sale en modo `revisar`. */
class DetenidoAntesDeTimbrar extends Error {}

interface Grabada {
  n: number;
  metodo: string;
  ruta: string;
  status: number;
  contentType: string;
  location: string;
  cookies: string[];
  archivo: string;
  bytes: number;
}

/** Transporte que guarda cada respuesta en `carpeta` y, si se pide, bloquea el POST que timbra. */
class TransporteGrabador implements TransporteHttp {
  readonly grabadas: Grabada[] = [];
  private readonly real: TransporteHttp;
  private readonly carpeta: string;
  private readonly bloquearTimbraje: boolean;

  constructor(real: TransporteHttp, carpeta: string, bloquearTimbraje: boolean) {
    this.real = real;
    this.carpeta = carpeta;
    this.bloquearTimbraje = bloquearTimbraje;
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const url = new URL(peticion.url);
    if (this.bloquearTimbraje && url.pathname.includes('of_genera_folio')) {
      throw new DetenidoAntesDeTimbrar('Modo revisar: no se envía la orden de timbrar.');
    }
    const respuesta = await this.real.enviar(peticion);
    const n = this.grabadas.length + 1;
    const nombre = url.pathname.split('/').filter(Boolean).at(-1) ?? 'raiz';
    const archivo = `${String(n).padStart(2, '0')}-${peticion.metodo}-${nombre}.bin`;
    writeFileSync(join(this.carpeta, archivo), respuesta.cuerpo);
    this.grabadas.push({
      n,
      metodo: peticion.metodo,
      ruta: `${url.host}${url.pathname}`,
      status: respuesta.status,
      contentType: respuesta.cabecera('content-type')[0] ?? '',
      location: (respuesta.cabecera('location')[0] ?? '').split('?')[0] ?? '',
      cookies: respuesta.cabecera('set-cookie').map((c) => c.split('=')[0]?.trim() ?? ''),
      archivo,
      bytes: respuesta.cuerpo.length,
    });
    return respuesta;
  }
}

function argumento(args: string[], nombre: string, porDefecto: number): number {
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return porDefecto;
  const valor = Number(args[i + 1]);
  if (!Number.isSafeInteger(valor) || valor < 1) throw new Error(`--${nombre} inválido.`);
  return valor;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(RAIZ, '.env'));
  } catch {
    // Sin .env: se usan las variables del entorno.
  }
  const [comando, ...args] = process.argv.slice(2);
  if (comando !== 'revisar' && comando !== 'solicitar') {
    console.log(
      'Uso: node scripts/solicitar-folios.ts revisar|solicitar [--tipo 39] [--cantidad 5]',
    );
    process.exitCode = 2;
    return;
  }
  const tipo = argumento(args, 'tipo', 39);
  const cantidad = argumento(args, 'cantidad', 5);
  const timbrar = comando === 'solicitar';

  const certificado = await Certificado.desdeArchivo(
    resolve(RAIZ, env('SII_CERT_PATH')),
    env('SII_CERT_PASS', ''),
  );
  const rutEmpresa = Rut.de(env('SII_RUT_EMPRESA'));

  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const carpeta = join(RAIZ, 'data', 'output', `folios-${marca}`);
  mkdirSync(carpeta, { recursive: true });

  const real = new TransporteUndici();
  const grabador = new TransporteGrabador(real, carpeta, !timbrar);
  const folios = new SolicitudFolios({ ambiente: 'certificacion', transporte: grabador });

  console.log(
    `${timbrar ? 'SOLICITAR (timbra)' : 'REVISAR (no timbra)'}: tipo ${tipo}, ${cantidad} folios, ambiente certificacion (maullin).`,
  );
  let resultado = '';
  try {
    console.log('Autenticando con el certificado...');
    const sesion = await folios.autenticar(certificado);
    console.log('  sesión AUT2000 OK.');

    console.log('Recorriendo el asistente de folios...');
    const caf = await folios.solicitar(sesion, rutEmpresa, tipo, cantidad);

    const texto = caf.toString('latin1');
    const valor = (etiqueta: string) =>
      new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(texto)?.[1]?.trim() ?? '?';
    const desde = valor('D');
    const hasta = valor('H');
    const destino = join(RAIZ, 'data', 'caf', `caf-${tipo}-${desde}-${hasta}.xml`);
    writeFileSync(destino, caf);
    resultado = `CAF obtenido: tipo ${valor('TD')}, folios ${desde}-${hasta}, IDK ${valor('IDK')}, RUT del CAF = SII_RUT_EMPRESA: ${Rut.de(valor('RE')).equals(rutEmpresa) ? 'sí' : 'NO'}.\n  Guardado en data/caf/${`caf-${tipo}-${desde}-${hasta}.xml`} (no se versiona).`;
  } catch (error) {
    if (error instanceof FoliosSinCafError && error.cause instanceof DetenidoAntesDeTimbrar) {
      resultado = `Detenido antes de timbrar, como se pidió. La confirmación del SII ofrecía los folios ${error.folioDesde}-${error.folioHasta} (no se timbraron).`;
    } else if (error instanceof FoliosSinCafError) {
      resultado = `ATENCIÓN: ${error.message}`;
      process.exitCode = 1;
    } else if (error instanceof SesionCaducaError) {
      resultado = `La sesión no sirvió (${error.message}). No se timbró nada.`;
      process.exitCode = 1;
    } else if (error instanceof SiiError) {
      resultado = `Error (${error.name}): ${error.message}. No se timbró nada.`;
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await real.close();
    writeFileSync(
      join(carpeta, 'peticiones.json'),
      `${JSON.stringify(grabador.grabadas, null, 2)}\n`,
    );
  }

  console.log('Peticiones (respuestas guardadas en data/output/, no se versiona):');
  for (const g of grabador.grabadas) {
    console.log(
      `  ${g.n}. ${g.metodo} ${g.ruta} -> ${g.status}${g.location ? ` (Location ${g.location})` : ''} ${g.contentType} ${g.bytes} bytes; cookies: ${g.cookies.join(', ') || '-'}`,
    );
  }
  console.log(resultado);
  console.log(`Carpeta: data/output/folios-${marca}/`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
