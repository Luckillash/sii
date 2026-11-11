/**
 * Validación de la fase 4 contra el SII de CERTIFICACIÓN (PLAN-MIGRACION §5.4).
 *
 * Reemplaza, para esta validación, a `bin/certificacion/enviar-set-boletas.php` y
 * `enviar-consumo-folios.php` del PHP, usando solo la librería Node.
 *
 * Comandos (Node ejecuta este .ts directo, con type stripping):
 *
 *   node scripts/validar-certificacion.ts token
 *       Pide un token SOAP (maullin) y uno REST (apicert). No envía documentos.
 *   node scripts/validar-certificacion.ts armar [--con-rcof]
 *       Arma el set (y con --con-rcof, también el RCOF) y lo guarda en data/output/
 *       sin enviarlo.
 *   node scripts/validar-certificacion.ts enviar [--canal soap|rest] [--con-rcof]
 *       Arma y ENVÍA el set de pruebas (por defecto por DTEUpload, como los bin del
 *       PHP). Consume los folios configurados. Con --con-rcof envía además el RCOF
 *       después del set.
 *
 * RCOF: el SII eliminó la obligación de enviarlo a partir del 2022-08-01 (sigue solo
 * para períodos hasta julio de 2022), así que por defecto no se arma ni se envía.
 * --con-rcof repite lo que hacían los bin del PHP. Por REST, pangal responde 404 al
 * RCOF (validado el 2026-11-07): para un período antiguo, usar el canal soap.
 * Ver docs/certificacion.md.
 *   node scripts/validar-certificacion.ts estado <trackId> [...]
 *       Consulta cada envío por SOAP (QueryEstUp) y por REST (boleta.electronica.envio).
 *
 * Configuración en el .env de la raíz (ver `.env.example`). Siempre ambiente
 * `certificacion`: este script no sabe hablar con producción.
 *
 * Seguridad: nunca imprime el token, la llave, la clave del .pfx ni el contenido del
 * CAF. Los XML generados (traen RUT y razón social) van a data/output/, que no se versiona.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArmadorBoleta,
  Certificado,
  ClienteBoletaRest,
  ClienteDtews,
  EnvioBoleta,
  FirmaElectronica,
  GeneradorConsumoFolios,
  parsearSetPruebas,
  Rut,
  resumirParaRcof,
  SiiError,
  TransporteUndici,
} from '../packages/core/src/index.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'data', 'output');
const AMBIENTE = 'certificacion' as const;

function env(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre]?.trim();
  if (valor) return valor;
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`Falta ${nombre} en el .env (ver .env.example).`);
}

function rutaDesdeRaiz(ruta: string): string {
  return resolve(RAIZ, ruta);
}

async function cargarCertificado(): Promise<Certificado> {
  return Certificado.desdeArchivo(rutaDesdeRaiz(env('SII_CERT_PATH')), env('SII_CERT_PASS', ''));
}

function config() {
  const rutEmpresa = Rut.de(env('SII_RUT_EMPRESA')).toString();
  const rutEnvia = Rut.de(env('SII_RUT_FIRMA')).toString();
  return {
    rutEmpresa,
    rutEnvia,
    emisor: {
      rut: rutEmpresa,
      razonSocial: env('EMISOR_RAZON_SOCIAL'),
      giro: env('EMISOR_GIRO'),
      direccion: env('EMISOR_DIRECCION'),
      comuna: env('EMISOR_COMUNA'),
    },
    receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
    // Una sola fecha de resolución para el sobre y el RCOF (decisión 5 de la fase 3).
    fchResol: env('SII_FCH_RESOL'),
    nroResol: env('SII_NRO_RESOL', '0'),
    caf: readFileSync(rutaDesdeRaiz(env('SII_CAF_39'))),
    folioInicial: Number.parseInt(env('SII_FOLIO_INICIAL'), 10),
    setPruebas: rutaDesdeRaiz(env('SII_SET_PRUEBAS', 'data/set_pruebas/Set Prueba BE.txt')),
    secEnvio: Number.parseInt(env('SII_RCOF_SEC_ENVIO', '1'), 10),
  };
}

function guardar(nombre: string, bytes: Buffer): string {
  mkdirSync(SALIDA, { recursive: true });
  const ruta = join(SALIDA, nombre);
  writeFileSync(ruta, bytes);
  return ruta;
}

interface Armado {
  sobre: Buffer;
  /** Solo con --con-rcof. */
  rcof: Buffer | undefined;
  folios: number[];
}

async function armar(certificado: Certificado, conRcof: boolean): Promise<Armado> {
  const c = config();
  if (!Number.isInteger(c.folioInicial) || c.folioInicial < 1) {
    throw new Error('SII_FOLIO_INICIAL debe ser un entero positivo.');
  }
  const firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
  const casos = parsearSetPruebas(readFileSync(c.setPruebas), '39');
  const armador = new ArmadorBoleta(firmador);

  console.log(`Set de pruebas: ${casos.length} casos.`);
  const folios: number[] = [];
  const dtes = casos.map((caso, i) => {
    const folio = c.folioInicial + i;
    folios.push(folio);
    console.log(`  ${caso.referencia.razon} -> folio ${folio} (${caso.detalles.length} ítems)`);
    return armador.armar(
      {
        emisor: c.emisor,
        receptor: c.receptor,
        folio: String(folio),
        detalles: caso.detalles,
        tipoDte: caso.tipo,
        referencia: caso.referencia,
      },
      c.caf,
    );
  });

  const sobre = new EnvioBoleta(firmador, {
    rutEmisor: c.rutEmpresa,
    rutEnvia: c.rutEnvia,
    nroResol: c.nroResol,
    fchResol: c.fchResol,
  }).empaquetar(dtes);

  console.log(
    `Sobre EnvioBOLETA: ${sobre.length} bytes -> ${guardar('validacion-envio-set.xml', sobre)}`,
  );
  if (!conRcof) {
    console.log(
      'RCOF: no se arma (no es obligatorio desde 2022-08-01; usa --con-rcof si lo necesitas).',
    );
    return { sobre, rcof: undefined, folios };
  }

  const { resumenes, fchInicio, fchFinal } = resumirParaRcof(dtes);
  const xmlRcof = new GeneradorConsumoFolios().generar(
    {
      rutEmisor: c.rutEmpresa,
      rutEnvia: c.rutEnvia,
      fchResol: c.fchResol,
      nroResol: c.nroResol,
      fchInicio,
      fchFinal,
      secEnvio: c.secEnvio,
    },
    resumenes,
  );
  const rcof = firmador.firmarDte(xmlRcof, '#RCOF');
  console.log(`RCOF: ${rcof.length} bytes -> ${guardar('validacion-rcof.xml', rcof)}`);
  return { sobre, rcof, folios };
}

async function comandoToken(transporte: TransporteUndici): Promise<void> {
  const certificado = await cargarCertificado();
  const soap = new ClienteDtews(certificado, { ambiente: AMBIENTE, transporte });
  const rest = new ClienteBoletaRest(certificado, { ambiente: AMBIENTE, transporte });

  const tokenSoap = await soap.solicitarToken();
  console.log(`SOAP (maullin): token OK (${tokenSoap.length} caracteres).`);
  const tokenRest = await rest.solicitarToken();
  console.log(`REST (apicert): token OK (${tokenRest.length} caracteres).`);
}

async function comandoEnviar(
  transporte: TransporteUndici,
  canal: 'soap' | 'rest',
  conRcof: boolean,
): Promise<void> {
  const certificado = await cargarCertificado();
  const { rutEmpresa, rutEnvia } = config();
  const { sobre, rcof, folios } = await armar(certificado, conRcof);
  console.log(
    `Folios que se consumen: ${folios[0]} a ${folios.at(-1)}. Canal: ${canal}.${rcof ? ' Con RCOF.' : ''}`,
  );
  if (rcof && canal === 'rest') {
    console.log(
      'Aviso: pangal respondió HTTP 404 al RCOF por REST (2026-11-07); el set se sube igual antes.',
    );
  }

  if (canal === 'soap') {
    const soap = new ClienteDtews(certificado, { ambiente: AMBIENTE, transporte });
    const token = await soap.solicitarToken();
    const trackSet = await soap.enviarDte(token, {
      rutEmisor: rutEmpresa,
      rutEnvia,
      xml: sobre,
      nombreArchivo: 'envio_set_boletas.xml',
    });
    console.log(`Set enviado por DTEUpload. TrackID: ${trackSet}`);
    if (rcof) {
      const trackRcof = await soap.enviarDte(token, {
        rutEmisor: rutEmpresa,
        rutEnvia,
        xml: rcof,
        nombreArchivo: 'rcof.xml',
      });
      console.log(`RCOF enviado por DTEUpload. TrackID: ${trackRcof}`);
    }
  } else {
    const rest = new ClienteBoletaRest(certificado, { ambiente: AMBIENTE, transporte });
    const token = await rest.solicitarToken();
    const set = await rest.enviarBoleta(token, rutEmpresa, rutEnvia, sobre);
    console.log(`Set enviado por REST (pangal). TrackID: ${set.trackId} (estado ${set.estado})`);
    if (rcof) {
      const r = await rest.enviarConsumoFolios(token, rutEmpresa, rutEnvia, rcof);
      console.log(`RCOF enviado por REST (pangal). TrackID: ${r.trackId} (estado ${r.estado})`);
    }
  }
  console.log(
    'Consulta el estado en unos minutos con: node scripts/validar-certificacion.ts estado <trackId> ...',
  );
}

async function comandoEstado(transporte: TransporteUndici, trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) throw new Error('Indica al menos un trackId.');
  const certificado = await cargarCertificado();
  const rutEmpresa = Rut.de(env('SII_RUT_EMPRESA')).toString();
  const soap = new ClienteDtews(certificado, { ambiente: AMBIENTE, transporte });
  const rest = new ClienteBoletaRest(certificado, { ambiente: AMBIENTE, transporte });

  const tokenSoap = await soap.solicitarToken();
  let tokenRest: string | undefined;
  for (const trackId of trackIds) {
    console.log(`TrackID ${trackId}`);
    try {
      const e = await soap.estadoEnvio(tokenSoap, rutEmpresa, trackId);
      console.log(
        `  SOAP: ${e.estado} ${e.glosa} | informados ${e.informados}, aceptados ${e.aceptados}, rechazados ${e.rechazados}, reparos ${e.reparos}`,
      );
    } catch (error) {
      console.log(`  SOAP: ${describir(error)}`);
    }
    try {
      tokenRest ??= await rest.solicitarToken();
      const e = await rest.consultarEnvio(tokenRest, rutEmpresa, trackId);
      console.log(
        `  REST: ${e.estado} | informados ${e.informados}, aceptados ${e.aceptados}, rechazados ${e.rechazados}, reparos ${e.reparos}`,
      );
      for (const d of e.detalleRepRech) console.log(`    detalle: ${JSON.stringify(d)}`);
    } catch (error) {
      console.log(`  REST: ${describir(error)}`);
    }
  }
}

function describir(error: unknown): string {
  if (error instanceof SiiError) return `${error.name}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(RAIZ, '.env'));
  } catch {
    // Sin .env: valen las variables del entorno.
  }
  const [comando, ...resto] = process.argv.slice(2);
  const conRcof = resto.includes('--con-rcof');
  await using transporte = new TransporteUndici();

  switch (comando) {
    case 'token':
      return await comandoToken(transporte);
    case 'armar':
      await armar(await cargarCertificado(), conRcof);
      return;
    case 'enviar': {
      const i = resto.indexOf('--canal');
      const canal = i >= 0 ? resto[i + 1] : 'soap';
      if (canal !== 'soap' && canal !== 'rest') throw new Error('--canal debe ser soap o rest.');
      return await comandoEnviar(transporte, canal, conRcof);
    }
    case 'estado':
      return await comandoEstado(transporte, resto);
    default:
      console.log(
        'Uso: node scripts/validar-certificacion.ts token | armar [--con-rcof] | enviar [--canal soap|rest] [--con-rcof] | estado <trackId>...',
      );
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(`[ERROR] ${describir(error)}`);
  process.exitCode = 1;
});
