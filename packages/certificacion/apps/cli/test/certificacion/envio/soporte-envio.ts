// Respuestas falsas del SII para los tests de enviar-set, enviar-rcof, estado-envio y
// solicitar-folios (mismas formas que los tests del core). Nada sale a la red.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escaparXml,
  type PeticionRegistrada,
  type RespuestaFalsa,
  RespuestaHttp,
} from '@winex/certificacion';
import { type Proyecto, proyecto } from '../../soporte/cli.ts';

export const TOKEN = 'TOKENFALSO0123456789';
export const SEMILLA = '012345678901';

/** Respuesta SOAP de DTEWS: el XML del SII va escapado dentro de `<…Return>`. */
function sobreSoap(operacion: string, interior: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soapenv:Body><ns1:${operacion}Response><ns1:${operacion}Return>` +
    escaparXml(interior, 'xml1-sustituir') +
    `</ns1:${operacion}Return></ns1:${operacion}Response></soapenv:Body></soapenv:Envelope>`
  );
}

const semillaSoap = sobreSoap(
  'getSeed',
  `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>${SEMILLA}</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`,
);
const tokenSoap = sobreSoap(
  'getToken',
  `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>${TOKEN}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`,
);

/** Respuesta de `QueryEstUp.getEstUp`. */
export function estadoSoap(trackId: string, estado = 'EPR', glosa = 'Envio Procesado'): string {
  return sobreSoap(
    'getEstUp',
    '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TIPO_DOCTO>39</TIPO_DOCTO>' +
      '<INFORMADOS>2</INFORMADOS><ACEPTADOS>2</ACEPTADOS><RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>' +
      `<SII:RESP_HDR><TRACKID>${trackId}</TRACKID><ESTADO>${estado}</ESTADO><GLOSA>${glosa}</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`,
  );
}

/** Fault SOAP (el Axis del SII responde HTTP 500). */
export function faultSoap(texto: string): RespuestaHttp {
  return new RespuestaHttp(
    500,
    {},
    '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
      `<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>${texto}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
  );
}

/** Respuesta de DTEUpload. */
export function upload(cuerpo: string): string {
  return `<?xml version="1.0"?>\n<RECEPCIONDTE>\n<RUTSENDER>11111111-1</RUTSENDER>\n<RUTCOMPANY>76123456-0</RUTCOMPANY>\n<FILE>x.xml</FILE>\n<TIMESTAMP>2026-11-07 10:00:00</TIMESTAMP>\n${cuerpo}\n</RECEPCIONDTE>`;
}

/** Semilla y token DTEWS de un host (`maullin.sii.cl` o `palena.sii.cl`). */
export function tokenDtews(host = 'maullin.sii.cl'): Record<string, RespuestaFalsa> {
  return {
    [`${host}/DTEWS/CrSeed.jws`]: semillaSoap,
    [`${host}/DTEWS/GetTokenFromSeed.jws`]: tokenSoap,
  };
}

export const AUTH_CERT = 'apicert.sii.cl/recursos/v1';
export const ENVIO_CERT = 'pangal.sii.cl/recursos/v1';

/** Semilla y token REST de certificación (apicert). */
export function tokenRest(): Record<string, RespuestaFalsa> {
  return {
    [`${AUTH_CERT}/boleta.electronica.semilla`]: `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>${SEMILLA}</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`,
    [`${AUTH_CERT}/boleta.electronica.token`]: `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>${TOKEN}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`,
  };
}

/** Estado REST (`boleta.electronica.envio`). */
export function estadoRest(trackId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rut_emisor: '76123456-0',
    rut_envia: '11111111-1',
    trackid: Number(trackId),
    fecha_recepcion: '2026-11-07 10:15:30',
    estado: 'EPR',
    estadistica: [{ tipo: 39, informados: 2, aceptados: 2, rechazados: 0, reparos: 0 }],
    detalle_rep_rech: [],
    ...extra,
  });
}

/** Las peticiones cuya URL contiene `parte`. */
export function hacia(
  enviadas: readonly PeticionRegistrada[],
  parte: string,
): PeticionRegistrada[] {
  return enviadas.filter((p) => p.url.includes(parte));
}

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');

/** Página sintética del asistente de folios (paridad/folios/paginas), en ISO-8859-1. */
export function paginaFolios(nombre: string): Buffer {
  return Buffer.from(
    readFileSync(join(PARIDAD, 'folios/paginas', `${nombre}.html`), 'utf8'),
    'latin1',
  );
}

/** `proyecto()` del arnés (su set de pruebas ya es legible por `parsearSetPruebas`). */
export function proyectoEnvio(opciones: Parameters<typeof proyecto>[0] = {}): Proyecto {
  return proyecto(opciones);
}
