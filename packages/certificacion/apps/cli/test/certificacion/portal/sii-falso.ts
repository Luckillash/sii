// SII falso para los comandos del portal: login AUT2000 (página sintética de
// paridad/folios), asistente de postulación (paridad/postulacion) y respuestas GWT
// sintéticas de www4 (las mismas de los tests de DeclaracionBoletas del core).
// Nunca sale a la red.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PeticionRegistrada, RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import {
  FIRMAS_DECLARACION,
  POLICY_DECLARACION,
  SERVICIO_DECLARACION,
} from '../../../../../packages/core/src/postulacion/declaracion-boletas.ts';
import { GwtRpc } from '../../../../../packages/core/src/postulacion/gwt-rpc.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');
const leer = (ruta: string): string => readFileSync(join(PARIDAD, ruta), 'utf8');

/**
 * Login AUT2000 aceptado: la página sintética de folios más las cookies RUT_NS /
 * DV_NS del usuario (11111111-1), que el portal de la declaración necesita.
 */
export const LOGIN_OK = leer('folios/paginas/login-ok.html').replace(
  'function sigue()',
  'document.cookie = "RUT_NS=11111111; path=/; domain=.sii.cl";\n' +
    'document.cookie = "DV_NS=1; path=/; domain=.sii.cl";\nfunction sigue()',
);
export const LOGIN_RECHAZADO = leer('folios/paginas/login-rechazado.html');
/** Página que delata la sesión caducada (redirige al login). */
export const LOGIN_CADUCADO =
  '<html><script>window.location="https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html";</script></html>';

// --- respuestas GWT -----------------------------------------------------------------

const F = FIRMAS_DECLARACION;
const INTEGER = GwtRpc.INTEGER;
const ARRAY_LIST = GwtRpc.ARRAY_LIST;

/** `//OK[...]` con los tokens en el orden en que se leen. */
function ok(lectura: readonly (number | string)[], tabla: readonly string[] = []): string {
  return `//OK[${[...[...lectura].reverse(), JSON.stringify(tabla)].join(',')},0,7]`;
}

const estadoGwt = (codigo: string, paso: string | null, glosa: string): string =>
  paso === null
    ? ok([1, 2, 0, 3], [F.estado, codigo, glosa])
    : ok([1, 2, 3, 4], [F.estado, codigo, paso, glosa]);

export const GWT = {
  P90: estadoGwt('P90', '90', 'PENDIENTE DECLARACION DE CUMPLIMIENTO'),
  P91: estadoGwt('P91', null, 'DECLARACION EFECTUADA 11111111-1'),
  P80: estadoGwt('P80', '80', 'EN REVISION DEL SET'),
  NULO: ok([0]),
  NOMBRE: ok([1], ['EMPRESA DE PRUEBA SPA']),
  DOCUMENTOS: `//OK[15,'EAAAAA',4,18,13,0,'F',4,76123456,3,12,17,10,9,8,0,7,16,5,-4,41,3,2,15,'gAAAAAAAB',4,14,13,0,'F',4,76123456,3,12,11,10,9,8,0,7,6,5,'ZlFhXwA',4,39,3,2,2,1,["${ARRAY_LIST}","${F.documento}","${INTEGER}","java.lang.Long/4227064769","BVE","BOLETA ELECTRONICA","S","01-09-2026","AUTORIZADO","","39","N","java.lang.String/2004016611","Boleta afecta","FIN","BOLETA EXENTA ELECTRONICA","41","Boleta exenta"],0,7]`,
  AUTORIZAR_P91: `//OK[19,0,-4,0,'A',18,17,0,0,16,0,10,10,15,22222222,4,11111111,4,76123456,4,14,13,12,11,10,10,10,9,8,7,5,3,0,6,0,5,0,0,0,0,90,4,3,0,2,1,["${F.postulacion}","P91","BVE","${INTEGER}","0","${F.empresaAutorizada}","1","2","SII","07-11-2026","contacto@proveedor-prueba.cl","Proveedor de Prueba SpA","19","S","https://proveedor-prueba.cl/consulta","${ARRAY_LIST}","EMPRESA DE PRUEBA SPA","java.lang.Long/4227064769","DECLARACION EFECTUADA"],0,7]`,
  POSTULACION_P90: `//OK[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1,["${F.postulacion}","P90"],0,7]`,
  texto: (s: string): string => ok([1], [s]),
  entero: (n: number): string => ok([1, n], [INTEGER]),
} as const;

/** Contenido del `.cache.html` de la versión capturada del portal (todo presente). */
export const PORTAL_VIGENTE = [
  POLICY_DECLARACION,
  SERVICIO_DECLARACION,
  F.estado,
  F.postulacion,
  F.empresaAutorizada,
  F.documento,
  'DownloadFileServlet',
  ...[
    'obtenerEstadoAutorizaEmp',
    'recuperarNombreContribuyente',
    'listarDocAutorizados',
    'autorizarEmpresaBolProd',
    'recuperarNroActividadesVigAfecIva',
    'ingresarTrackId',
    'obtenerPostulacionSeg',
  ].map((m) => `'${m}'`),
].join(';');

/** Set de pruebas como lo entrega DownloadFileServlet (ISO-8859-1). */
export const SET_DESCARGADO = Buffer.from(
  [
    'SET DE PRUEBA BOLETA ELECTRÓNICA',
    '',
    'CASO-1',
    '==============',
    'Item                    Cantidad    Precio Unitario',
    'Cambio de aceite        1           19900',
    '',
  ].join('\r\n'),
  'latin1',
);

// --- transporte -----------------------------------------------------------------------

type Fija = string | Uint8Array | RespuestaHttp | (() => never);
/** Una respuesta, o varias que se entregan en orden (la última se repite). */
export type RespuestaPortal = Fija | readonly Fija[];

/** Método GWT de una petición al `facade` (posición 6 de la tabla de strings). */
export const metodoGwt = (p: PeticionRegistrada | undefined): string =>
  p?.bytes?.toString('utf8').split('|')[6] ?? '';

/** Lo que se pidió al SII, resumido: host+ruta y, en el facade, el método GWT. */
export function resumen(enviadas: readonly PeticionRegistrada[]): string[] {
  return enviadas.map((p) => {
    const url = new URL(p.url);
    const base = `${p.metodo} ${url.hostname}${url.pathname}`;
    return url.pathname.endsWith('/facade') ? `${base} ${metodoGwt(p)}` : base;
  });
}

function entregar(lista: Fija[]): RespuestaHttp | string | Uint8Array {
  const r = lista.length > 1 ? lista.shift() : lista[0];
  if (r === undefined) return new RespuestaHttp(500, {}, 'sin respuesta configurada');
  return typeof r === 'function' ? r() : r;
}

/**
 * SII falso: `login` responde a AUT2000, `gwt` a cada método del facade de www4,
 * `rutas` a otras URLs (host+ruta con `*`, como `TransporteFalso`). Lo que no esté
 * configurado responde 404.
 */
export function siiFalso(
  opciones: {
    login?: RespuestaPortal;
    gwt?: Readonly<Record<string, RespuestaPortal>>;
    rutas?: Readonly<Record<string, RespuestaPortal>>;
  } = {},
): TransporteFalso {
  const colas = (r: RespuestaPortal): Fija[] =>
    Array.isArray(r) ? [...(r as readonly Fija[])] : [r as Fija];
  const gwt = new Map(Object.entries(opciones.gwt ?? {}).map(([m, r]) => [m, colas(r)]));
  const reglas: [string, (p: PeticionRegistrada) => RespuestaHttp | string | Uint8Array][] = [];
  if (opciones.login !== undefined) {
    const cola = colas(opciones.login);
    reglas.push(['herculesr.sii.cl/cgi_AUT2000/*', () => entregar(cola)]);
  }
  reglas.push([
    'www4.sii.cl/certBolElectDteInternet/facade',
    (p) => {
      const cola = gwt.get(metodoGwt(p));
      return cola === undefined ? new RespuestaHttp(404) : entregar(cola);
    },
  ]);
  for (const [patron, r] of Object.entries(opciones.rutas ?? {})) {
    const cola = colas(r);
    reglas.push([patron, () => entregar(cola)]);
  }
  return new TransporteFalso(reglas);
}
