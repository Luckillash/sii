// `sii certificacion solicitar-folios`: pide folios (CAF) con el asistente del SII
// (login AUT2000 con el certificado), en maullin (certificación, por defecto) o en
// palena (producción, `--ambiente produccion`: folios reales). Reemplaza a
// scripts/solicitar-folios.ts sin guardar las páginas del SII (eso era solo para la
// validación de la fase 5).
//
// Sin `--confirmar` recorre el asistente hasta la confirmación y se detiene antes de
// la orden de timbrar: esa petición no sale (la corta el transporte) y no se gastan
// folios. En producción `--cantidad` es obligatoria (sin valor por defecto) y el CAF
// se guarda con otro nombre (`caf-produccion-...`) para no confundirlo con uno de
// certificación. Los candados de `SolicitudFolios` (host, IDK, empresa y tipo del CAF)
// van atados al ambiente elegido.

import { join } from 'node:path';
import {
  type Ambiente,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  type PeticionHttp,
  type RespuestaHttp,
  SolicitudFolios,
  type TransporteHttp,
} from '@winex/certificacion';
import {
  cargarCertificado,
  leerVariables,
  rut,
  rutaDelArgumento,
  rutaDelEnv,
} from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import { guardarArchivo } from '../../salida.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionAmbiente,
  opcionBooleana,
  opcionEntero,
  opcionTexto,
} from '../tipos.ts';
import { type DatosCaf, leerCaf, rutaParaEnv } from './comun-envio.ts';

/** Paso del asistente que timbra los folios (irreversible). */
const PASO_TIMBRAR = 'of_genera_folio';

const AYUDA = `Uso: sii certificacion solicitar-folios [opciones]

Pide folios (CAF) al SII: inicia sesión con el certificado y recorre el asistente
de folios. Por defecto en certificación (maullin); con --ambiente produccion, en
palena.

  EN PRODUCCIÓN LOS FOLIOS SON REALES: con --confirmar quedan autorizados para la
  empresa. Pruebe primero sin --confirmar y revise el rango que informa.

Sin --confirmar (revisión): recorre el asistente hasta la confirmación y se detiene
ANTES de la orden de timbrar (esa petición no sale). Informa los folios que el SII
asignaría. No gasta folios ni escribe archivos.
Con --confirmar: timbra los folios (irreversible) y guarda el CAF.

Opciones:
  --ambiente <amb>  certificacion (por defecto: maullin.sii.cl) o produccion
                    (palena.sii.cl, folios reales).
  --tipo <n>        Tipo de documento (por defecto 39, boleta electrónica).
  --cantidad <n>    Cantidad de folios. En certificación, por defecto 5 (uno por caso
                    del set); en producción es obligatoria.
  --folio-inicial <n>
                    Folio inicial, solo si el SII lo pide (primer timbraje de ese tipo
                    de documento en el ambiente; normalmente 1). Va únicamente en la
                    página "Ingrese Folio Inicial", también en la revisión (no timbra).
                    Si el SII lo pide y falta, el comando se detiene (código 3) sin
                    timbrar e indica el valor que sugiere el SII.
  --salida <dir>    Carpeta donde se guarda el CAF (por defecto data/caf junto al .env).
  --confirmar       Timbra los folios y guarda el CAF.

Variables del .env: SII_CERT_PATH, SII_CERT_PASS (el titular debe ser representante
electrónico de la empresa) y SII_RUT_EMPRESA.

Qué sale al SII: el login AUT2000 con el certificado (herculesr.sii.cl) y los pasos
del asistente en maullin.sii.cl (o palena.sii.cl en producción); con --confirmar,
además la orden de timbrar y la descarga del CAF.

Archivos que escribe (solo con --confirmar): <salida>/caf-<tipo>-<desde>-<hasta>.xml
en certificación y <salida>/caf-produccion-<tipo>-<desde>-<hasta>.xml en producción.
El CAF trae la llave para timbrar: no lo versiones ni lo compartas.

Si la orden de timbrar salió pero no se obtuvo el CAF, termina con código 6: NO
repitas la solicitud; baja el CAF desde "Folios ya autorizados" en el portal del SII.`;

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'solicitar-folios',
  resumen: 'Pide folios (CAF) en maullin (o en palena, producción)',
  ayuda: AYUDA,
  opciones: {
    ambiente: { type: 'string' },
    tipo: { type: 'string' },
    cantidad: { type: 'string' },
    'folio-inicial': { type: 'string' },
    salida: { type: 'string' },
    confirmar: { type: 'boolean' },
  },
  ejecutar,
};

/** Lo lanza el transporte de revisión en vez de enviar la orden de timbrar. */
class DetenidoAntesDeTimbrar extends Error {
  constructor() {
    super('Revisión: no se envía la orden de timbrar.');
    this.name = 'DetenidoAntesDeTimbrar';
  }
}

/** Transporte que deja pasar todo salvo la orden de timbrar (no llega a salir). */
class TransporteSinTimbrar implements TransporteHttp {
  readonly #real: TransporteHttp;

  constructor(real: TransporteHttp) {
    this.#real = real;
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    if (new URL(peticion.url).pathname.includes(PASO_TIMBRAR)) throw new DetenidoAntesDeTimbrar();
    return this.#real.enviar(peticion);
  }
}

async function ejecutar(ctx: Contexto, entrada: EntradaComando) {
  // --- Argumentos y configuración: todo antes de la primera petición. ---
  const ambiente = opcionAmbiente(entrada, 'certificacion');
  const produccion = ambiente === 'produccion';
  const tipo = opcionEntero(entrada, 'tipo') ?? 39;
  const cantidad = opcionEntero(entrada, 'cantidad') ?? (produccion ? undefined : 5);
  if (cantidad === undefined) {
    throw new ErrorUso(
      'En producción falta --cantidad: los folios son reales y no hay valor por defecto.',
    );
  }
  const folioInicial = opcionEntero(entrada, 'folio-inicial');
  const confirmar = opcionBooleana(entrada, 'confirmar');
  const config = entrada.config();
  const salida = opcionTexto(entrada, 'salida');
  const carpeta =
    salida !== undefined
      ? rutaDelArgumento(config, salida)
      : rutaDelEnv(config, join('data', 'caf'));
  const { SII_RUT_EMPRESA: rutEmpresa } = leerVariables(config, { SII_RUT_EMPRESA: rut });
  const certificado = await cargarCertificado(config);

  const transporte = confirmar ? ctx.transporte() : new TransporteSinTimbrar(ctx.transporte());
  const folios = new SolicitudFolios({ ambiente, transporte, reloj: ctx.reloj });

  ctx.imprimir(
    `Folios de ${NOMBRE_AMBIENTE[ambiente]}: tipo ${tipo}, cantidad ${cantidad}. ` +
      (confirmar
        ? `Con --confirmar: SE TIMBRAN${produccion ? ' (FOLIOS REALES)' : ''}.`
        : 'Revisión: se detiene antes de timbrar (agrega --confirmar para timbrar).'),
  );
  ctx.imprimir('Iniciando sesión con el certificado...');
  const sesion = await folios.autenticar(certificado);
  ctx.imprimir('Recorriendo el asistente de folios...');

  const repetir = (extra: string) =>
    `sii certificacion solicitar-folios${produccion ? ' --ambiente produccion' : ''} ` +
    `--tipo ${tipo} --cantidad ${cantidad}${extra}`;
  const conFolioInicial = folioInicial === undefined ? '' : ` --folio-inicial ${folioInicial}`;

  let caf: Buffer;
  try {
    caf = await folios.solicitar(
      sesion,
      rutEmpresa,
      tipo,
      cantidad,
      folioInicial === undefined ? {} : { folioInicial },
    );
  } catch (error) {
    if (error instanceof FoliosSinCafError && detenidoAntesDeTimbrar(error)) {
      ctx.imprimir(
        `Revisión terminada: el SII asignaría los folios ${error.folioDesde} a ${error.folioHasta} ` +
          `de tipo ${tipo} (no se timbraron).`,
      );
      ctx.imprimir(`Para timbrarlos: ${repetir(`${conFolioInicial} --confirmar`)}`);
      return undefined;
    }
    if (error instanceof FolioInicialRequeridoError) {
      const sugerido = /^\d+$/.test(error.folioSugerido) ? error.folioSugerido : '1';
      ctx.imprimirError(`[ERROR] ${error.message}`);
      ctx.imprimirError(
        `Indica el folio inicial con --folio-inicial (normalmente 1): ` +
          `${repetir(` --folio-inicial ${sugerido}`)}${confirmar ? ' --confirmar' : ''}`,
      );
      return CODIGOS.CONFIG;
    }
    throw error;
  }

  // SolicitudFolios ya revisó el CAF (ambiente, empresa y tipo), así que se puede
  // leer; aun así, nada de lo que pase desde aquí puede impedir guardarlo.
  let datos: DatosCaf | undefined;
  try {
    datos = leerCaf(caf, 'la respuesta del SII');
  } catch {
    datos = undefined;
  }
  const rango = datos === undefined ? 'obtenido' : `${datos.desde}-${datos.hasta}`;
  const nombre = `caf-${produccion ? 'produccion-' : ''}${tipo}-${rango}.xml`;
  let ruta: string;
  try {
    ruta = guardarArchivo(carpeta, nombre, caf);
  } catch {
    ctx.imprimirError(
      `[ERROR] Se timbraron los folios, pero no se pudo guardar el CAF en ${join(carpeta, nombre)}. ` +
        'No los vuelvas a pedir: baja el CAF desde "Folios ya autorizados" en el portal del SII.',
    );
    return CODIGOS.INCIERTO;
  }
  if (datos === undefined) {
    ctx.imprimir(`[OK] CAF obtenido y guardado en ${ruta} (no lo versiones).`);
    return undefined;
  }
  ctx.imprimir(`[OK] CAF obtenido: tipo ${datos.tipoDte}, folios ${datos.desde} a ${datos.hasta}.`);
  ctx.imprimir(`Guardado en ${ruta} (no lo versiones).`);
  if (produccion && (tipo === 39 || tipo === 41)) {
    ctx.imprimir(
      `Para usarlo en produccion emitir, en el .env: SII_PRODUCCION_CAF_${tipo}=${rutaParaEnv(config, ruta)} ` +
        `(folios ${datos.desde} a ${datos.hasta}).`,
    );
  } else if (!produccion && tipo === 39) {
    ctx.imprimir(
      `Para usarlo en enviar-set, en el .env: SII_CAF_39=${rutaParaEnv(config, ruta)} y ` +
        `SII_FOLIO_INICIAL=${datos.desde}.`,
    );
  }
  return undefined;
}

const NOMBRE_AMBIENTE: Readonly<Record<Ambiente, string>> = {
  certificacion: 'certificación (maullin)',
  produccion: 'PRODUCCIÓN (palena)',
};

/** `true` si la causa (en cualquier nivel) es la orden de timbrar que no salió. */
function detenidoAntesDeTimbrar(error: Error): boolean {
  for (let causa: unknown = error.cause; causa instanceof Error; causa = causa.cause) {
    if (causa instanceof DetenidoAntesDeTimbrar) return true;
  }
  return false;
}
