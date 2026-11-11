// Arma los casos `http-declaracion-*` (paridad/casos/) de DeclaracionBoletas.
//
//   node paridad/declaracion/armar-casos.mjs
//
// Los casos quedan versionados; este script solo evita escribir a mano las
// respuestas GWT-RPC (y el set en ISO-8859-1, en base64) dentro del JSON. Después
// de cambiar algo: correrlo, `pnpm format` (o `pnpm exec biome check --write
// paridad/casos`), `pnpm paridad:generar <casos>` y los tests.
//
// Las respuestas son SINTÉTICAS, con el formato del portal `certBolElectDteInternet`
// (GWT-RPC protocolo 7, los esquemas de DeclaracionBoletas::ESQUEMAS): no contienen
// datos reales (RUT de prueba 76123456-0, 11111111-1 y 22222222-2, correos de
// empresa-prueba.cl, cookies y trackIds inventados). Varias son las mismas de los
// casos `gwt-leer-*`.
//
// Host: www4.sii.cl va al origen `https` del servidor de captura (ver
// operaciones/declaracion.php). Los casos de declarar usan `normalizar.fechasGwt`:
// la fecha de hoy del PHP sale de la hora real.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const F = {
  estado: 'cl.sii.sdi.diii.certBolElectDte.to.EstadoAutorizaTo/1011533792',
  postulacion: 'cl.sii.sdi.diii.certBolElectDte.to.PostulSegHistInsUpdTo/138688689',
  empresa: 'cl.sii.sdi.diii.certBolElectDte.to.TdtEmpresaAutorizadaTo/2240026086',
  documento: 'cl.sii.sdi.diii.certBolElectDte.to.DocumentoAutorizadoTo/493967287',
};
const INTEGER = 'java.lang.Integer/3438268394';
const ARRAY_LIST = 'java.util.ArrayList/4159755760';
const POLICY = '082D0AC4BC4D75A5DF38F116C53877D4';
const SERVICIO = 'cl.sii.sdi.diii.certBolElectDte.web.client.service.Facade';

/** Respuesta GWT (texto UTF-8), como la entrega el portal. */
function gwt(texto, extra = {}) {
  return {
    status: extra.status ?? 200,
    cabeceras: [['Content-Type', 'application/json; charset=utf-8'], ...(extra.cabeceras ?? [])],
    cuerpo: texto,
  };
}

/**
 * `//OK[...]` a partir de los tokens EN EL ORDEN EN QUE SE LEEN (el payload de GWT
 * va al revés) y la tabla de strings.
 */
function ok(lectura, tabla = []) {
  const payload = [...lectura].reverse();
  return `//OK[${[...payload, JSON.stringify(tabla)].join(',')},0,7]`;
}

function html(texto, extra = {}) {
  return {
    status: extra.status ?? 200,
    cabeceras: [['Content-Type', 'text/html; charset=ISO-8859-1']],
    cuerpo: { base64: Buffer.from(texto, 'latin1').toString('base64') },
  };
}

// --- respuestas -------------------------------------------------------------------

const COOKIE_GWT = [
  'Set-Cookie',
  'JSESSIONID=SESIONGWTPRUEBA01; Path=/certBolElectDteInternet; Secure; HttpOnly',
];

const estadoP90 = (extra) =>
  gwt(ok([1, 2, 3, 4], [F.estado, 'P90', '90', 'PENDIENTE DECLARACION DE CUMPLIMIENTO']), extra);
const estadoP91 = gwt(ok([1, 2, 0, 3], [F.estado, 'P91', 'DECLARACION EFECTUADA 11111111-1']));
const nulo = gwt(ok([0]));
const estadoPasoRaro = gwt(
  ok([1, 2, 3, 4], [F.estado, 'P90', ' 9.0e1 ', 'PENDIENTE DECLARACION DE CUMPLIMIENTO']),
);
const incompatible = gwt(
  `//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533","This application is out of date, please click the refresh button on your browser. ( Blocked attempt to access interface '${SERVICIO}', which is not implemented by 'x'; this is either misconfiguration or a hack attempt )"],0,7]`,
);
const nombre = gwt(ok([1], ['SOCIEDAD DE PRUEBA ÑUÑOA SPA']));
// Igual a gwt-leer-documentos-autorizados: Long > 2^32 y > 2^53, back-reference a un Long.
const documentos = gwt(
  `//OK[15,'EAAAAA',4,18,13,0,'F',4,76123456,3,12,17,10,9,8,0,7,16,5,-4,41,3,2,15,'gAAAAAAAB',4,14,13,0,'F',4,76123456,3,12,11,10,9,8,0,7,6,5,'ZlFhXwA',4,39,3,2,2,1,["${ARRAY_LIST}","${F.documento}","${INTEGER}","java.lang.Long/4227064769","BVE","BOLETA ELECTRONICA","S","01-09-2026","AUTORIZADO","","39","N","java.lang.String/2004016611","Boleta afecta","FIN","BOLETA EXENTA ELECTRONICA","41","Boleta exenta"],0,7]`,
);
const sinDocumentos = gwt(ok([1, 0], [ARRAY_LIST]));
// Igual a gwt-leer-autorizar-p91.
const autorizarP91 = gwt(
  `//OK[19,0,-4,0,'A',18,17,0,0,16,0,10,10,15,22222222,4,11111111,4,76123456,4,14,13,12,11,10,10,10,9,8,7,5,3,0,6,0,5,0,0,0,0,90,4,3,0,2,1,["${F.postulacion}","P91","BVE","${INTEGER}","0","${F.empresa}","1","2","SII","07-11-2026","contacto@proveedor-prueba.cl","Proveedor de Prueba SpA","19","S","https://proveedor-prueba.cl/consulta","${ARRAY_LIST}","EMPRESA DE PRUEBA SPA","java.lang.Long/4227064769","DECLARACION EFECTUADA"],0,7]`,
);
// Igual a gwt-leer-postulacion-seg: un PostulSegHistInsUpdTo en P90.
const postulacionP90 = gwt(
  `//OK[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1,["${F.postulacion}","P90"],0,7]`,
);
const autorizarEx = gwt(
  '//EX[2,1,["cl.sii.sdi.diii.certBolElectDte.exception.NegocioException/1234567890","No fue posible registrar la declaracion de cumplimiento"],0,7]',
);
const error500 = {
  status: 500,
  cabeceras: [['Content-Type', 'text/plain']],
  cuerpo: 'The call failed on the server; see server log for details',
};
const login = html(
  '<html><head><script>window.location="https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?https://www4.sii.cl/certBolElectDteInternet/";</script></head><body></body></html>',
);
const actividades = (n) => gwt(ok([1, n], [INTEGER]));
const texto = (s) => gwt(ok([1], [s]));
const redireccion = (location) => ({
  status: 302,
  cabeceras: [['Location', location]],
  cuerpo: '',
});

const SET = [
  'SET DE PRUEBA BOLETA ELECTRÓNICA - NÚMERO DE ATENCIÓN: 0000001',
  '',
  'CASO-1',
  '==========',
  'ITEM                        CANTIDAD   PRECIO UNITARIO',
  'Cambio de aceite                   1             19900',
  'Alineación y balanceo              1              9900',
  '',
  'CASO-2',
  '==========',
  'ITEM                        CANTIDAD   PRECIO UNITARIO',
  'Papel de regalo (señal)           17               120',
  '',
].join('\r\n');
const setIso = {
  status: 200,
  cabeceras: [
    ['Content-Type', 'text/plain; charset=ISO-8859-1'],
    ['Content-Disposition', 'attachment; filename="SetPruebasBoleta.txt"'],
  ],
  cuerpo: { base64: Buffer.from(SET, 'latin1').toString('base64') },
};
const sinSet = html(
  '<html><head><title>Error</title></head><body><h3>No fue posible generar el set de pruebas.</h3><p>Intente m&aacute;s tarde.</p></body></html>',
);

const METODOS = [
  'obtenerEstadoAutorizaEmp',
  'recuperarNombreContribuyente',
  'listarDocAutorizados',
  'autorizarEmpresaBolProd',
  'recuperarNroActividadesVigAfecIva',
  'ingresarTrackId',
  'obtenerPostulacionSeg',
];
function portal(faltan = []) {
  const partes = [
    `var $gwt_version = "2.8.2"; var $strongName = '0FC3D987613537E6E13E9BB93A406F13';`,
    `function Kj(){Kj=Dk;Lj=new Ok(Mk(),'${POLICY}')}`,
    `function Pj(){return '${SERVICIO}'}`,
    ...[F.estado, F.postulacion, F.empresa, F.documento].map((f) => `Zn(a,'${f}');`),
    `function Wq(a){return Mk()+'DownloadFileServlet?rutEmpresa='+a.b}`,
    ...METODOS.map((m) => `function ${m.slice(0, 3)}(a,b){Hm(a,'${m}',b)}`),
  ];
  const cuerpo = `<html><head><script>${partes.filter((p) => !faltan.some((f) => p.includes(f))).join('\n')}</script></head><body></body></html>\n`;
  return { status: 200, cabeceras: [['Content-Type', 'text/html']], cuerpo };
}

// --- casos ------------------------------------------------------------------------

const SESION = [
  { name: 'TOKEN', value: 'TOKENDEPRUEBAAUT2000', domain: 'sii.cl', host_only: false },
  { name: 'RUT_NS', value: '11111111', domain: 'sii.cl', host_only: false },
  { name: 'DV_NS', value: '1', domain: 'sii.cl', host_only: false },
  { name: 'MAULLINSOLO', value: 'M1', domain: 'maullin.sii.cl', host_only: true },
  { name: 'WWW4SOLO', value: 'W1', domain: 'www4.sii.cl', host_only: true },
];
const SESION_SIN_USUARIO = SESION.filter((c) => c.name !== 'RUT_NS' && c.name !== 'DV_NS');

const RUT_EMPRESA = '76123456-0';
const DATOS = {
  rutEmpresa: RUT_EMPRESA,
  linkConsulta: 'https://www.empresa-prueba.cl/boletas/consulta',
  rutProveedor: '22222222-2',
  nombreProveedor: 'Programación Ñandú SpA',
  correoProveedor: 'software@empresa-prueba.cl',
};
const CORREO = 'software.prueba@empresa-prueba.cl';
const TRACK_ID = '123456789012';

/** Las tres lecturas que preceden a la orden de declarar (estado, razón social, documentos). */
const PREVIAS = [estadoP90({ cabeceras: [COOKIE_GWT] }), nombre, documentos];

const casos = {
  'http-declaracion-estado-p90': {
    descripcion: 'estado(): EstadoAutorizaTo P90 (porDeclarar), con una cookie nueva del portal',
    accion: 'estado',
    respuestas: [estadoP90({ cabeceras: [COOKIE_GWT] })],
  },
  'http-declaracion-estado-p91': {
    descripcion: 'estado(): P91 (autorizada) con el paso nulo',
    accion: 'estado',
    respuestas: [estadoP91],
  },
  'http-declaracion-estado-nulo': {
    descripcion: 'estado(): el SII responde null (sin trámite): código null, glosa vacía',
    accion: 'estado',
    respuestas: [nulo],
  },
  'http-declaracion-estado-paso-raro': {
    descripcion: "estado(): paso ' 9.0e1 ' (is_numeric con blancos y exponente → 90)",
    accion: 'estado',
    respuestas: [estadoPasoRaro],
  },
  'http-declaracion-estado-redireccion': {
    descripcion:
      'estado(): una 302 dentro de www4 convierte el POST en GET sin cuerpo (conserva las cabeceras GWT, Referer = la URL anterior)',
    accion: 'estado',
    respuestas: [redireccion('/certBolElectDteInternet/facade?reintento=1'), estadoP90()],
  },
  'http-declaracion-estado-sesion-caducada': {
    descripcion: 'estado(): la respuesta es una página que manda al login → SesionCaduca',
    accion: 'estado',
    respuestas: [login],
    esperaError: true,
  },
  'http-declaracion-estado-incompatible': {
    descripcion: 'estado(): //EX IncompatibleRemoteServiceException (el SII cambió el portal)',
    accion: 'estado',
    respuestas: [incompatible],
    esperaError: true,
  },
  'http-declaracion-declarar': {
    descripcion:
      'declarar(): P90 → razón social (con Ñ) → documentos (Long > 2^53) → autorizarEmpresaBolProd → P91',
    accion: 'declarar',
    respuestas: [...PREVIAS, autorizarP91],
  },
  'http-declaracion-declarar-sin-p90': {
    descripcion: 'declarar(): la empresa está en P91: no sale ninguna otra petición',
    accion: 'declarar',
    respuestas: [estadoP91],
    esperaError: true,
  },
  'http-declaracion-declarar-sin-usuario': {
    descripcion: 'declarar(): la sesión no trae RUT_NS/DV_NS → SesionCaduca sin peticiones',
    accion: 'declarar',
    sesion: SESION_SIN_USUARIO,
    respuestas: [],
    esperaError: true,
  },
  'http-declaracion-declarar-sin-documentos': {
    descripcion: 'declarar(): listarDocAutorizados devuelve una lista vacía: no se declara',
    accion: 'declarar',
    respuestas: [estadoP90(), nombre, sinDocumentos],
    esperaError: true,
  },
  'http-declaracion-declarar-sin-p91': {
    descripcion:
      'declarar(): autorizarEmpresaBolProd responde un PostulSegHistInsUpdTo en P90 → incierta',
    accion: 'declarar',
    respuestas: [...PREVIAS, postulacionP90],
    esperaError: true,
  },
  'http-declaracion-declarar-ex': {
    descripcion: 'declarar(): autorizarEmpresaBolProd responde //EX → incierta',
    accion: 'declarar',
    respuestas: [...PREVIAS, autorizarEx],
    esperaError: true,
  },
  'http-declaracion-declarar-500': {
    descripcion: 'declarar(): autorizarEmpresaBolProd responde HTTP 500 → incierta',
    accion: 'declarar',
    respuestas: [...PREVIAS, error500],
    esperaError: true,
  },
  'http-declaracion-declarar-sesion-caducada': {
    descripcion: 'declarar(): la respuesta a autorizarEmpresaBolProd es el login → incierta',
    accion: 'declarar',
    respuestas: [...PREVIAS, login],
    esperaError: true,
  },
  'http-declaracion-revision': {
    descripcion: 'solicitarRevisionSet(): 3 actividades afectas (código 90) y respuesta "1"',
    accion: 'solicitarRevisionSet',
    respuestas: [actividades(3), texto('1')],
  },
  'http-declaracion-revision-error-estado': {
    descripcion:
      'solicitarRevisionSet(): 0 actividades (código 91) y "errorEstado" → SetSinDescargar',
    accion: 'solicitarRevisionSet',
    respuestas: [actividades(0), texto('errorEstado')],
    esperaError: true,
  },
  'http-declaracion-revision-otra': {
    descripcion:
      'solicitarRevisionSet(): actividades null (código 91) y otra respuesta (var_export con comilla)',
    accion: 'solicitarRevisionSet',
    respuestas: [nulo, texto("it's down")],
    esperaError: true,
  },
  'http-declaracion-descargar': {
    descripcion:
      'descargarSetPruebas(): sin postulación en P90 ni estado → GET DownloadFileServlet (query de http_build_query, Referer ?SET=1), set en ISO-8859-1',
    accion: 'descargarSetPruebas',
    respuestas: [nulo, nulo, setIso],
  },
  'http-declaracion-descargar-p90-seg': {
    descripcion: 'descargarSetPruebas(): obtenerPostulacionSeg no es nulo (P90) → no se descarga',
    accion: 'descargarSetPruebas',
    respuestas: [postulacionP90],
    esperaError: true,
  },
  'http-declaracion-descargar-p90-estado': {
    descripcion:
      'descargarSetPruebas(): obtenerPostulacionSeg nulo, pero estado P90 → no se descarga',
    accion: 'descargarSetPruebas',
    respuestas: [nulo, estadoP90()],
    esperaError: true,
  },
  'http-declaracion-descargar-sin-set': {
    descripcion: 'descargarSetPruebas(): HTTP 200 con una página de error en vez del set',
    accion: 'descargarSetPruebas',
    respuestas: [nulo, estadoP91, sinSet],
    esperaError: true,
  },
  'http-declaracion-portal-vigente': {
    descripcion: 'verificarPortal(): el .cache.html trae todo (sin sesión ni cookies)',
    accion: 'verificarPortal',
    respuestas: [portal()],
  },
  'http-declaracion-portal-404': {
    descripcion: 'verificarPortal(): 404 = el SII publicó otra versión',
    accion: 'verificarPortal',
    respuestas: [
      { status: 404, cabeceras: [['Content-Type', 'text/html']], cuerpo: '<h1>Not Found</h1>' },
    ],
  },
  'http-declaracion-portal-faltantes': {
    descripcion: 'verificarPortal(): faltan una firma de tipo, la POLICY y un método',
    accion: 'verificarPortal',
    respuestas: [portal([F.documento, POLICY, "'ingresarTrackId'"])],
  },
};

for (const [nombreCaso, c] of Object.entries(casos)) {
  const entrada = {
    accion: c.accion,
    sesion: c.sesion ?? SESION,
    ...(c.accion === 'declarar' ? { datos: DATOS } : { rutEmpresa: RUT_EMPRESA }),
    ...(c.accion === 'solicitarRevisionSet' ? { trackId: TRACK_ID } : {}),
    ...(c.accion === 'descargarSetPruebas' ? { correoProveedor: CORREO } : {}),
    ...(c.esperaError === true ? { esperaError: true } : {}),
    http: {
      respuestas: c.respuestas,
      ...(c.accion === 'declarar' ? { normalizar: { fechasGwt: true } } : {}),
    },
  };
  const json = { descripcion: c.descripcion, operacion: 'httpDeclaracion', entrada };
  writeFileSync(join(raiz, 'casos', `${nombreCaso}.json`), `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`${Object.keys(casos).length} casos http-declaracion-* escritos en paridad/casos/.`);
