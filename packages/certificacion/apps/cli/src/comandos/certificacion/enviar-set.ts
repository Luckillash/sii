// `sii certificacion enviar-set`: arma el set de pruebas de boletas (tipo 39) y lo
// envía a certificación. Reemplaza a bin/certificacion/enviar-set-boletas.php del
// PHP (y al `armar`/`enviar` de scripts/validar-certificacion.ts), sin RCOF: el SII
// lo eliminó desde el 2022-08-01 (ver `enviar-rcof`).

import {
  ArmadorBoleta,
  type CasoSetPruebas,
  EnvioBoleta,
  ErrorTransporte,
  ErrorValidacion,
  parsearSetPruebas,
} from '@winex/certificacion';
import {
  cargarCertificado,
  configEmisor,
  configEmpresa,
  configResolucion,
  configTokenStore,
  enteroPositivo,
  leerArchivo,
  leerVariables,
  rutaArchivo,
} from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { ErrorConfig } from '../../errores.ts';
import { carpetaSalida, guardarArchivo } from '../../salida.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionBooleana,
  opcionEntero,
  opcionEnum,
  opcionTexto,
} from '../tipos.ts';
import {
  avisarSubidaIncierta,
  clienteDtews,
  clienteRest,
  firmadorDe,
  leerCaf,
  mismoRut,
  RECEPTOR_SET,
  subirPorDteUpload,
} from './comun-envio.ts';

/** Nombre del sobre que se guarda en la carpeta de salida. */
export const ARCHIVO_SOBRE = 'envio-set-boletas.xml';
/** Nombre con que DTEUpload recibe el sobre (el `basename` del PHP). */
const NOMBRE_DTEUPLOAD = 'envio_set_boletas.xml';
const TIPO_DTE = 39;

const AYUDA = `Uso: sii certificacion enviar-set [opciones]

Arma el set de pruebas de boletas (tipo 39) con un folio por caso, consecutivos
desde el folio inicial, lo firma y lo envía al SII de certificación. No arma RCOF
(el SII lo eliminó desde el 2022-08-01; ver \`sii certificacion enviar-rcof\`).

Opciones:
  --canal soap|rest      soap (por defecto): DTEUpload en maullin, como el PHP.
                         rest: API REST de boletas (apicert/pangal).
  --caf <ruta>           CAF de boletas (en vez de SII_CAF_39).
  --folio-inicial <n>    Primer folio (en vez de SII_FOLIO_INICIAL).
  --set <ruta>           Set de pruebas .txt del SII (en vez de SII_SET_PRUEBAS).
  --fch-resol <fecha>    Fecha de resolución AAAA-MM-DD (en vez de SII_FCH_RESOL).
  --nro-resol <n>        Número de resolución (en vez de SII_NRO_RESOL; por defecto 0).
  --salida <dir>         Carpeta donde se guarda el sobre (por defecto data/output
                         junto al .env).
  --solo-armar           Arma y guarda el sobre sin enviarlo: no sale nada a la red,
                         no pide token y los folios siguen libres.

Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA, SII_RUT_FIRMA,
EMISOR_RAZON_SOCIAL, EMISOR_GIRO, EMISOR_DIRECCION, EMISOR_COMUNA, SII_FCH_RESOL,
SII_NRO_RESOL, SII_CAF_39, SII_FOLIO_INICIAL, SII_SET_PRUEBAS y, opcional,
SII_CACHE_TOKENS.

Antes de enviar comprueba que todos los folios caben en el rango del CAF.

Qué sale al SII (salvo --solo-armar): el pedido de token y el sobre EnvioBOLETA
firmado (DTEUpload o REST, según --canal). Consume los folios usados.

Archivos que escribe: <salida>/${ARCHIVO_SOBRE} (trae RUT y razón social: no lo
versiones).

Después: sii certificacion estado-envio <trackId>`;

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'enviar-set',
  resumen: 'Arma y envía el set de pruebas de boletas',
  ayuda: AYUDA,
  opciones: {
    canal: { type: 'string' },
    caf: { type: 'string' },
    'folio-inicial': { type: 'string' },
    set: { type: 'string' },
    'fch-resol': { type: 'string' },
    'nro-resol': { type: 'string' },
    salida: { type: 'string' },
    'solo-armar': { type: 'boolean' },
  },
  ejecutar,
};

async function ejecutar(ctx: Contexto, entrada: EntradaComando) {
  // --- Argumentos y configuración: todo antes de la primera petición. ---
  const canal = opcionEnum(entrada, 'canal', ['soap', 'rest'] as const, 'soap');
  const soloArmar = opcionBooleana(entrada, 'solo-armar');
  const folioOpcion = opcionEntero(entrada, 'folio-inicial');

  const config = entrada.config();
  const { rutEmpresa, rutEnvia } = configEmpresa(config);
  const emisor = configEmisor(config);
  const resolucion = configResolucion(config, 'certificacion', {
    nroResol: opcionTexto(entrada, 'nro-resol'),
    fchResol: opcionTexto(entrada, 'fch-resol'),
  });
  const { SII_FOLIO_INICIAL: folioInicial } = leerVariables(
    config,
    { SII_FOLIO_INICIAL: enteroPositivo },
    {
      SII_FOLIO_INICIAL: {
        valor: folioOpcion === undefined ? undefined : String(folioOpcion),
        opcion: '--folio-inicial',
      },
    },
  );
  const rutaCaf = rutaArchivo(config, 'SII_CAF_39', {
    valor: opcionTexto(entrada, 'caf'),
    opcion: '--caf',
  });
  const rutaSet = rutaArchivo(config, 'SII_SET_PRUEBAS', {
    valor: opcionTexto(entrada, 'set'),
    opcion: '--set',
  });
  const carpeta = carpetaSalida(config, opcionTexto(entrada, 'salida'));
  const tokenStore = soloArmar ? undefined : configTokenStore(config);
  const certificado = await cargarCertificado(config);

  const casos = leerSet(rutaSet);
  imprimirCasos(ctx, rutaSet, casos);

  const caf = leerArchivo(rutaCaf, 'el CAF');
  const folios = casos.map((_, i) => folioInicial + i);
  revisarCaf(caf, rutaCaf, rutEmpresa, folios);
  const desde = folios[0] as number;
  const hasta = folios.at(-1) as number;

  // --- Armado (local). ---
  const firmador = firmadorDe(certificado);
  const armador = new ArmadorBoleta(firmador, { reloj: ctx.reloj });
  ctx.imprimir(`Folios: ${desde} a ${hasta} (CAF ${rutaCaf}).`);
  const dtes = casos.map((caso, i) => {
    const folio = folios[i] as number;
    ctx.imprimir(`  ${caso.referencia.razon} -> folio ${folio}`);
    return armador.armar(
      {
        emisor,
        receptor: RECEPTOR_SET,
        folio: String(folio),
        detalles: caso.detalles,
        tipoDte: caso.tipo,
        referencia: caso.referencia,
      },
      caf,
    );
  });
  const sobre = new EnvioBoleta(
    firmador,
    { rutEmisor: rutEmpresa, rutEnvia, ...resolucion },
    { reloj: ctx.reloj },
  ).empaquetar(dtes);
  const rutaSobre = guardarArchivo(carpeta, ARCHIVO_SOBRE, sobre);
  ctx.imprimir(`Sobre EnvioBOLETA guardado en ${rutaSobre} (${sobre.length} bytes).`);

  if (soloArmar) {
    ctx.imprimir('No se envió nada al SII (--solo-armar): los folios siguen libres.');
    return undefined;
  }

  // --- Envío (sale al SII). ---
  const queRevisar = `folios ${desde} a ${hasta}`;
  let trackId: string;
  if (canal === 'soap') {
    ctx.imprimir('Enviando por DTEUpload (maullin)...');
    trackId = await subirPorDteUpload(
      ctx,
      clienteDtews(ctx, certificado, 'certificacion', tokenStore),
      { rutEmisor: rutEmpresa, rutEnvia, xml: sobre, nombreArchivo: NOMBRE_DTEUPLOAD },
      queRevisar,
    );
    ctx.imprimir(`[OK] Set enviado por DTEUpload. TrackID: ${trackId}`);
  } else {
    ctx.imprimir('Enviando por la API REST (pangal)...');
    const rest = clienteRest(ctx, certificado, 'certificacion', tokenStore);
    const token = await rest.obtenerToken(rutEmpresa);
    try {
      const r = await rest.enviarBoleta(token, rutEmpresa, rutEnvia, sobre);
      trackId = r.trackId;
      ctx.imprimir(`[OK] Set enviado por REST. TrackID: ${trackId} (estado ${r.estado})`);
    } catch (error) {
      if (error instanceof ErrorTransporte) {
        avisarSubidaIncierta(ctx, queRevisar);
      }
      throw error;
    }
  }
  ctx.imprimir(
    `Los folios ${desde} a ${hasta} quedaron usados: para el próximo envío usa ` +
      `SII_FOLIO_INICIAL=${hasta + 1} (o --folio-inicial ${hasta + 1}).`,
  );
  ctx.imprimir(`Siguiente paso, en unos minutos: sii certificacion estado-envio ${trackId}`);
  return undefined;
}

/** Lee el set; un archivo que no se entiende es un problema de configuración (código 3). */
function leerSet(ruta: string): CasoSetPruebas[] {
  try {
    return parsearSetPruebas(leerArchivo(ruta, 'el set de pruebas'), String(TIPO_DTE));
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      throw new ErrorConfig(`El set de pruebas ${ruta} no se pudo leer: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Los casos leídos, como el bin del PHP, para revisarlos contra el set del portal. */
function imprimirCasos(ctx: Contexto, ruta: string, casos: readonly CasoSetPruebas[]): void {
  ctx.imprimir(`Casos leídos de ${ruta} (${casos.length}):`);
  for (const caso of casos) {
    ctx.imprimir(`  ${caso.referencia.razon}:`);
    for (const item of caso.detalles) {
      const marcas: string[] = [];
      if (item.exento === true) marcas.push('exento');
      if (item.unidad !== undefined && item.unidad !== '') marcas.push(`unidad=${item.unidad}`);
      const sufijo = marcas.length > 0 ? ` [${marcas.join(', ')}]` : '';
      ctx.imprimir(
        `    ${item.nombre} | cantidad=${item.cantidad} | precio=${item.precio}${sufijo}`,
      );
    }
  }
  ctx.imprimir('Revisa que lo anterior coincida con tu set de pruebas.');
}

/** El CAF tiene que ser de boletas, de la empresa, y cubrir todos los folios del set. */
function revisarCaf(
  caf: Uint8Array,
  ruta: string,
  rutEmpresa: string,
  folios: readonly number[],
): void {
  const datos = leerCaf(caf, ruta);
  if (datos.tipoDte !== TIPO_DTE) {
    throw new ErrorConfig(
      `El CAF ${ruta} es del tipo de documento ${datos.tipoDte}; el set necesita uno de tipo ${TIPO_DTE}.`,
    );
  }
  if (!mismoRut(datos.rutEmisor, rutEmpresa)) {
    throw new ErrorConfig(
      `El CAF ${ruta} es de otra empresa (${datos.rutEmisor}), no de SII_RUT_EMPRESA (${rutEmpresa}).`,
    );
  }
  const desde = folios[0] as number;
  const hasta = folios.at(-1) as number;
  if (desde < datos.desde || hasta > datos.hasta) {
    throw new ErrorConfig(
      `Los folios no caben en el CAF ${ruta}: el set tiene ${folios.length} casos y necesita ` +
        `los folios ${desde} a ${hasta}, pero el CAF autoriza del ${datos.desde} al ${datos.hasta}. ` +
        'Ajusta SII_FOLIO_INICIAL (o --folio-inicial) o pide otro CAF con ' +
        '`sii certificacion solicitar-folios`.',
    );
  }
}
