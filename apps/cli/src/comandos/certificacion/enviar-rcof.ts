// `sii certificacion enviar-rcof`: arma el RCOF (Reporte de Consumo de Folios) desde
// un sobre EnvioBOLETA guardado y lo envía por DTEUpload. Reemplaza a
// bin/certificacion/enviar-consumo-folios.php del PHP, sin montos ni folios
// escritos a mano (pend. 5): salen de los DTE del sobre (`resumirParaRcof`).
//
// El SII eliminó el RCOF desde el 2022-08-01 (PLAN-MIGRACION.md §1): queda solo para
// períodos hasta julio de 2022. Por eso se niega para períodos posteriores salvo
// `--aunque-no-obligatorio`, solo va por DTEUpload (pangal responde 404 por REST) y
// ningún otro comando lo llama.

import { existsSync } from 'node:fs';
import {
  type Ambiente,
  GeneradorConsumoFolios,
  type ResumenDtes,
  Rut,
  resumirParaRcof,
  SiiError,
} from '@winex/certificacion';
import {
  cargarCertificado,
  conDefecto,
  configEmpresa,
  configResolucion,
  configTokenStore,
  enteroPositivo,
  leerArchivo,
  leerVariables,
  rutaDelArgumento,
} from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { ErrorConfig, ErrorUso } from '../../errores.ts';
import { carpetaSalida, guardarArchivo } from '../../salida.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionAmbiente,
  opcionBooleana,
  opcionEntero,
  opcionTexto,
} from '../tipos.ts';
import { clienteDtews, firmadorDe, subirPorDteUpload } from './comun-envio.ts';

/** Nombre del RCOF en la carpeta de salida y en DTEUpload. */
export const ARCHIVO_RCOF = 'rcof.xml';
/** Desde este día el SII ya no pide el RCOF (PLAN-MIGRACION.md §1). */
export const FIN_RCOF = '2022-08-01';

const AYUDA = `Uso: sii certificacion enviar-rcof --sobre <ruta> [opciones]

Arma el RCOF (Reporte de Consumo de Folios) con los DTE de un sobre EnvioBOLETA ya
armado (p. ej. el que deja \`sii certificacion enviar-set\`): montos, folios y
fechas salen de las boletas del sobre. Lo firma y lo envía por DTEUpload.

El SII eliminó el RCOF desde el ${FIN_RCOF}: solo se usa para períodos hasta julio
de 2022. Si la fecha final del período es el ${FIN_RCOF} o posterior, se niega salvo
--aunque-no-obligatorio. Solo va por DTEUpload (SOAP): por REST el SII responde 404.

Opciones:
  --sobre <ruta>           Sobre EnvioBOLETA del que salen los DTE (obligatorio).
  --sec-envio <n>          Secuencia del RCOF del período (en vez de
                           SII_RCOF_SEC_ENVIO; por defecto 1). Súbela si ya enviaste
                           uno para el mismo día.
  --fch-resol <fecha>      Fecha de resolución AAAA-MM-DD (en vez de SII_FCH_RESOL o
                           SII_PRODUCCION_FCH_RESOL).
  --nro-resol <n>          Número de resolución (en vez de SII_NRO_RESOL o
                           SII_PRODUCCION_NRO_RESOL).
  --ambiente <a>           certificacion (por defecto, maullin) o produccion (palena).
  --confirmar              Obligatorio para enviar en producción. Sin él, en producción
                           se arma y guarda el RCOF y se detiene antes de pedir token.
  --aunque-no-obligatorio  Arma y envía aunque el período sea desde el ${FIN_RCOF}.
  --salida <dir>           Carpeta donde se guarda el RCOF (por defecto data/output
                           junto al .env).
  --solo-armar             Arma y guarda el RCOF sin enviarlo (no sale nada a la red).

Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA, SII_RUT_FIRMA,
SII_RCOF_SEC_ENVIO y, según el ambiente, SII_FCH_RESOL / SII_NRO_RESOL (por
defecto 0) o SII_PRODUCCION_FCH_RESOL / SII_PRODUCCION_NRO_RESOL. Opcional:
SII_CACHE_TOKENS.

Qué sale al SII (salvo --solo-armar): el pedido de token DTEWS y el RCOF firmado
por DTEUpload.

Archivos que escribe: <salida>/${ARCHIVO_RCOF}.`;

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'enviar-rcof',
  resumen: 'Envía un RCOF (solo períodos hasta julio de 2022)',
  ayuda: AYUDA,
  opciones: {
    sobre: { type: 'string' },
    'sec-envio': { type: 'string' },
    'fch-resol': { type: 'string' },
    'nro-resol': { type: 'string' },
    ambiente: { type: 'string' },
    confirmar: { type: 'boolean' },
    'aunque-no-obligatorio': { type: 'boolean' },
    salida: { type: 'string' },
    'solo-armar': { type: 'boolean' },
  },
  ejecutar,
};

async function ejecutar(ctx: Contexto, entrada: EntradaComando) {
  // --- Argumentos y configuración: todo antes de la primera petición. ---
  const opcionSobre = opcionTexto(entrada, 'sobre');
  if (opcionSobre === undefined) {
    throw new ErrorUso('Falta --sobre <ruta> (el sobre EnvioBOLETA del que salen los DTE).');
  }
  const ambiente = opcionAmbiente(entrada, 'certificacion');
  const soloArmar = opcionBooleana(entrada, 'solo-armar');
  const confirmado = opcionBooleana(entrada, 'confirmar');
  const aunqueNoObligatorio = opcionBooleana(entrada, 'aunque-no-obligatorio');
  const secOpcion = opcionEntero(entrada, 'sec-envio');

  const config = entrada.config();
  const rutaSobre = rutaDelArgumento(config, opcionSobre);
  if (!existsSync(rutaSobre)) {
    throw new ErrorConfig(`No existe el archivo indicado en --sobre: ${rutaSobre}`);
  }
  const { rutEmpresa, rutEnvia } = configEmpresa(config);
  const resolucion = configResolucion(config, ambiente, {
    nroResol: opcionTexto(entrada, 'nro-resol'),
    fchResol: opcionTexto(entrada, 'fch-resol'),
  });
  const { SII_RCOF_SEC_ENVIO: secEnvio } = leerVariables(
    config,
    { SII_RCOF_SEC_ENVIO: conDefecto(enteroPositivo, '1') },
    {
      SII_RCOF_SEC_ENVIO: {
        valor: secOpcion === undefined ? undefined : String(secOpcion),
        opcion: '--sec-envio',
      },
    },
  );
  const carpeta = carpetaSalida(config, opcionTexto(entrada, 'salida'));
  const enviar = !soloArmar && (ambiente === 'certificacion' || confirmado);
  const tokenStore = enviar ? configTokenStore(config) : undefined;
  const certificado = await cargarCertificado(config);

  const sobre = leerArchivo(rutaSobre, 'el sobre');
  const resumen = resumirSobre(sobre, rutaSobre, rutEmpresa);
  if (resumen.fchFinal >= FIN_RCOF && !aunqueNoObligatorio) {
    throw new ErrorUso(
      `El período del sobre termina el ${resumen.fchFinal}: el SII eliminó el RCOF desde el ` +
        `${FIN_RCOF} y no hace falta enviarlo. Si igual lo necesitas, agrega --aunque-no-obligatorio.`,
    );
  }

  // --- Armado (local). ---
  ctx.imprimir(`RCOF del ${resumen.fchInicio} al ${resumen.fchFinal} (SecEnvio ${secEnvio}):`);
  for (const r of resumen.resumenes) {
    const rangos = r.rangosUtilizados.map((g) => `${g.inicial}-${g.final}`).join(', ');
    ctx.imprimir(
      `  Tipo ${r.tipo}, folios ${rangos}: Neto=${r.neto} IVA=${r.iva} Exento=${r.exento} ` +
        `Total=${r.total} (${r.foliosUtilizados} documentos)`,
    );
  }
  const xml = new GeneradorConsumoFolios({ reloj: ctx.reloj }).generar(
    {
      rutEmisor: rutEmpresa,
      rutEnvia,
      ...resolucion,
      fchInicio: resumen.fchInicio,
      fchFinal: resumen.fchFinal,
      secEnvio,
    },
    resumen.resumenes,
  );
  const rcof = firmadorDe(certificado).firmarDte(xml, '#RCOF');
  const rutaRcof = guardarArchivo(carpeta, ARCHIVO_RCOF, rcof);
  ctx.imprimir(`RCOF guardado en ${rutaRcof} (${rcof.length} bytes).`);

  if (soloArmar) {
    ctx.imprimir('No se envió nada al SII (--solo-armar).');
    return undefined;
  }
  if (!enviar) {
    // Ensayo: como los demás comandos sin --confirmar, termina bien sin enviar nada.
    ctx.imprimir('No se envió nada al SII: en producción el RCOF se envía solo con --confirmar.');
    return undefined;
  }

  // --- Envío (sale al SII). ---
  ctx.imprimir(`Enviando por DTEUpload (${nombreHost(ambiente)})...`);
  const trackId = await subirPorDteUpload(
    ctx,
    clienteDtews(ctx, certificado, ambiente, tokenStore),
    { rutEmisor: rutEmpresa, rutEnvia, xml: rcof, nombreArchivo: ARCHIVO_RCOF },
    `RCOF del ${resumen.fchInicio}, SecEnvio ${secEnvio}`,
  );
  ctx.imprimir(`[OK] RCOF enviado por DTEUpload. TrackID: ${trackId}`);
  ctx.imprimir(
    ambiente === 'certificacion'
      ? `Siguiente paso, en unos minutos: sii certificacion estado-envio --canal soap ${trackId}`
      : `Consulta su estado en el portal del SII (TrackID ${trackId}).`,
  );
  return undefined;
}

/**
 * Resumen del RCOF a partir del sobre completo (`resumirParaRcof` lee cada
 * `<Documento>`, así que no hace falta separar los DTE). Exige que todas las
 * boletas sean de `SII_RUT_EMPRESA`: la carátula del RCOF lleva ese RUT.
 */
function resumirSobre(sobre: Buffer, ruta: string, rutEmpresa: string): ResumenDtes {
  let resumen: ResumenDtes;
  try {
    resumen = resumirParaRcof([sobre]);
  } catch (error) {
    if (error instanceof SiiError) {
      throw new ErrorConfig(`El sobre ${ruta} no sirve para el RCOF: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
  const texto = sobre.toString('latin1');
  const emisores = new Set(
    [...texto.matchAll(/<RUTEmisor>\s*([^<]*?)\s*<\/RUTEmisor>/g)].map((m) => m[1] ?? ''),
  );
  const empresa = Rut.de(rutEmpresa);
  for (const rut of emisores) {
    if (!Rut.esValido(rut) || !Rut.de(rut).equals(empresa)) {
      throw new ErrorConfig(
        `El sobre ${ruta} trae boletas del emisor ${rut}, no de SII_RUT_EMPRESA (${rutEmpresa}).`,
      );
    }
  }
  return resumen;
}

function nombreHost(ambiente: Ambiente): string {
  return ambiente === 'certificacion' ? 'maullin' : 'palena';
}
