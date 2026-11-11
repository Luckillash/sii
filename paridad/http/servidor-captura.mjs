// Servidor local de captura para la paridad de requests HTTP (PLAN-MIGRACION.md §5.3).
//
// Graba cada petición tal como llega (método, ruta con query, cabeceras en el
// orden y la capitalización recibidos, cuerpo en bytes) y responde con las
// respuestas grabadas que se cargaron para el caso, en orden. Lo usan los dos
// lados de la comparación:
//
// - El PHP, a través de `paridad/http/generar.mjs` (`pnpm paridad:generar`), que
//   levanta el servidor, le pasa a generar.php las URLs por variables de entorno y
//   la CA de prueba con `-d curl.cainfo=... -d openssl.cafile=...`. El PHP habla con
//   el servidor por el protocolo de control (abajo) desde `paridad/php/http.php`.
// - Los tests de Node, que lo importan en el mismo proceso
//   (`packages/core/test/soporte/captura.ts`).
//
// La normalización (`normalizarCapturas`) vive SOLO aquí: el PHP recibe del
// servidor los bytes ya normalizados, así que las reglas son las mismas en ambos
// lados por construcción.
//
// Solo módulos de Node (sin dependencias): el job `paridad-php` del CI lo corre
// sin `pnpm install`.
//
// Orígenes (cada uno es un puerto aleatorio propio, para distinguir hosts):
//   http    http://127.0.0.1:<puerto>   también atiende el protocolo de control
//   https   https://localhost:<puerto>  TLS con paridad/material/captura-servidor.pem
//   https2  https://localhost:<puerto>  ídem; para clientes que hablan con dos hosts
//                                        (p. ej. REST: autenticación y envío)
// Escucha en `::` (IPv4 e IPv6), así `localhost` conecta al primer intento aunque
// resuelva a ::1. Solo HTTP/1.1: el TLS anuncia únicamente `http/1.1` por ALPN, así
// que el cURL del PHP (que en Windows trae HTTP/2) no negocia h2.
//
// Protocolo de control (solo en el origen `http`, rutas bajo /__captura/, que no se graban):
//   POST /__captura/caso         cuerpo JSON {respuestas, normalizar}: carga el caso y
//                                borra lo grabado. Responde 204.
//   GET  /__captura/normalizado  las peticiones grabadas, normalizadas (bytes).
//   GET  /__captura/capturas     lo grabado, crudo, en JSON (para depurar; cuerpo en base64).
//
// Caso HTTP (`entrada.http` en paridad/casos/<caso>.json):
//   respuestas  lista; la petición N recibe la respuesta N:
//               {status?: 200, cabeceras?: [[nombre, valor], ...], cuerpo?: "texto UTF-8" | {base64}}
//               Si llegan más peticiones que respuestas, se responde 500 y la petición
//               queda marcada en la salida normalizada.
//   normalizar  opciones: {nombresArchivo?: boolean, camposFormulario?: string[],
//               fechasGwt?: boolean} (ver normalizarCapturas).
//
// Los orígenes TLS piden certificado de cliente (sin exigirlo ni verificarlo): si
// el cliente presenta uno (TLS mutuo, p. ej. el login AUT2000 de folios), la
// salida normalizada lo muestra con su huella y el largo de la cadena.

import { constants as constantesCrypto, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_MATERIAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'material');

/** CA de prueba que emite el certificado del servidor (para `curl.cainfo`, `openssl.cafile` y undici). */
export const RUTA_CA = join(DIR_MATERIAL, 'captura-ca.pem');

const PREFIJO_CONTROL = '/__captura/';

/**
 * Cabeceras que NO se comparan, con su motivo. Todo lo demás se compara, incluidas
 * las que agrega el cliente HTTP por su cuenta (`Accept: *\/*` de cURL, `Expect`,
 * `User-Agent`): si un lado la manda y el otro no, es una diferencia real.
 */
export const CABECERAS_EXCLUIDAS = new Map([
  [
    'connection',
    'Manejo de la conexión, no del pedido: cURL no la manda, file_get_contents manda ' +
      '`close` y undici `keep-alive` (o `close` con `conexionNueva`). La reutilización ' +
      'de conexiones se decidió en la fase 4 (PLAN §6) y no cambia lo que recibe el SII.',
  ],
]);

/**
 * Cabeceras cuyo valor se reemplaza por una marca, con su motivo. La presencia de
 * la cabecera SÍ se compara (si un lado la manda y el otro no, se ve).
 */
export const CABECERAS_NORMALIZADAS = new Map([
  [
    'accept-encoding',
    "cURL con CURLOPT_ENCODING '' anuncia lo que trae su build (PHP 8.3 de Windows: " +
      '`deflate, gzip, br, zstd`; otra en Ubuntu) y Node anuncia `gzip, deflate` ' +
      '(decisión de la fase 4, PLAN §6). Se compara que vaya, no la lista.',
  ],
]);

/** Valor que reemplaza a las cabeceras de `CABECERAS_NORMALIZADAS`. */
export const MARCA_CODIFICACIONES = '<codificaciones>';
/** Valor que reemplaza a los campos de `camposFormulario` en los cuerpos urlencoded. */
export const MARCA_CAMPO = '<normalizado>';

/** Valor que reemplaza a las fechas `dd-mm-aaaa` de los cuerpos GWT-RPC con `fechasGwt`. */
export const MARCA_FECHA = '<fecha>';

/** Valor que reemplaza al boundary del multipart (en Content-Type y en el cuerpo). */
export const MARCA_BOUNDARY = '<boundary>';
/** Valor que reemplaza al nombre (sin la extensión) de los `filename` con `nombresArchivo`. */
export const MARCA_ARCHIVO = '<archivo>';

const ORIGENES = /** @type {const} */ (['http', 'https', 'https2']);

/**
 * Normaliza lo grabado a bytes deterministas y legibles. Reglas:
 *
 * 1. Cada petición sale como `=== peticion N de M (origen) ===`, la línea
 *    `MÉTODO ruta?query HTTP/x.y`, las cabeceras, una línea vacía, el cuerpo en
 *    bytes exactos y `=== fin de la peticion N ===`. Sin peticiones:
 *    `=== sin peticiones ===`. Las marcas van sin tildes (solo ASCII): el cuerpo
 *    puede ser UTF-8 o ISO-8859-1 y las marcas no deben forzar ninguno de los dos.
 *    Una petición que llegó sin respuesta grabada lo dice en su marca.
 * 2. Cabeceras: nombre en minúsculas, ordenadas por nombre (orden estable: las
 *    repetidas conservan su orden relativo). La capitalización y el orden no se
 *    comparan porque undici escribe las suyas (`host`, `content-length`) en
 *    minúsculas y en posiciones fijas; HTTP no les da significado. Los valores van
 *    tal cual.
 * 3. Se excluyen solo las de `CABECERAS_EXCLUIDAS`.
 * 4. `host`: si apunta a este servidor (localhost, 127.0.0.1 o [::1] con el puerto
 *    del origen) se reemplaza por `<origen>`; si no, queda tal cual.
 * 5. Multipart: el boundary (aleatorio) se reemplaza por `<boundary>` en
 *    Content-Type y en el cuerpo.
 * 6. Con `nombresArchivo`, cada `filename="..."` de las partes del multipart pasa a
 *    `filename="<archivo>.ext"` (se conserva la última extensión). Es opcional,
 *    por caso: para los temporales del PHP (`basename(tempnam(...)).'.xml'`, que
 *    además cambia entre Windows y Linux).
 * 7. `content-length`: si coincide con el cuerpo recibido, se reescribe con el
 *    largo del cuerpo ya normalizado (depende del largo del boundary y de los
 *    nombres de archivo); si no coincide, queda el valor recibido y una nota.
 * 8. `CABECERAS_NORMALIZADAS` (`accept-encoding`): el valor pasa a
 *    `<codificaciones>`; la cabecera sigue apareciendo.
 * 9. Con `camposFormulario` (lista de nombres), en los cuerpos
 *    `application/x-www-form-urlencoded` el valor de esos campos pasa a
 *    `<normalizado>`. Para valores que el PHP toma de la hora real y no se pueden
 *    fijar (p. ej. `FECHA` de la solicitud de folios, que usa
 *    `new DateTimeImmutable('now')`). El nombre y la posición del campo se comparan.
 * 10. Con `fechasGwt`, en los cuerpos `text/x-gwt-rpc` cada token (separado por
 *    `|`) con forma `dd-mm-aaaa` pasa a `<fecha>`. Para la fecha de hoy que el PHP
 *    toma de la hora real (`DeclaracionBoletas::declarar`, `new
 *    DateTimeImmutable('now')`) y escribe en la tabla de strings de GWT. Se sigue
 *    comparando su posición en la tabla y cada índice que la usa. Las demás fechas de
 *    la tabla (p. ej. las de los documentos que se reenvían) también se marcan.
 * 11. Si el cliente presentó un certificado TLS, después de la línea de la
 *    petición va `# tls cliente: sha256 <huella de la hoja> (<n> en la cadena)`.
 *
 * @param {readonly Captura[]} capturas
 * @param {OpcionesNormalizacion} [opciones]
 * @returns {Buffer}
 */
export function normalizarCapturas(capturas, opciones = {}) {
  if (capturas.length === 0) return Buffer.from('=== sin peticiones ===\n', 'latin1');

  const partes = capturas.map((captura, i) => {
    const n = i + 1;
    const tipo = captura.cabeceras.find(([nombre]) => nombre.toLowerCase() === 'content-type');
    const boundary = tipo === undefined ? undefined : boundaryDe(tipo[1]);

    // latin1: un byte = un carácter, ida y vuelta sin pérdida.
    let cuerpo = captura.cuerpo.toString('latin1');
    const urlencoded =
      tipo !== undefined && /^\s*application\/x-www-form-urlencoded/i.test(tipo[1]);
    if (urlencoded && (opciones.camposFormulario?.length ?? 0) > 0) {
      cuerpo = normalizarCampos(cuerpo, opciones.camposFormulario ?? []);
    }
    const gwt = tipo !== undefined && /^\s*text\/x-gwt-rpc/i.test(tipo[1]);
    if (gwt && opciones.fechasGwt === true) {
      cuerpo = normalizarFechasGwt(cuerpo);
    }
    if (boundary !== undefined) {
      cuerpo = cuerpo.split(boundary).join(MARCA_BOUNDARY);
      if (opciones.nombresArchivo === true) cuerpo = normalizarNombresArchivo(cuerpo);
    }

    /** @type {[string, string][]} */
    const cabeceras = [];
    for (const [nombreCrudo, valorCrudo] of captura.cabeceras) {
      const nombre = nombreCrudo.toLowerCase();
      if (CABECERAS_EXCLUIDAS.has(nombre)) continue;
      let valor = valorCrudo;
      if (nombre === 'host') {
        valor = normalizarHost(valor, captura);
      } else if (CABECERAS_NORMALIZADAS.has(nombre)) {
        valor = MARCA_CODIFICACIONES;
      } else if (nombre === 'content-type' && boundary !== undefined) {
        valor = valor.split(boundary).join(MARCA_BOUNDARY);
      } else if (nombre === 'content-length') {
        valor =
          valor.trim() === String(captura.cuerpo.length)
            ? String(cuerpo.length)
            : `${valor} (no calza con el cuerpo recibido: ${captura.cuerpo.length} bytes)`;
      }
      cabeceras.push([nombre, valor]);
    }
    cabeceras.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const marca = captura.sinRespuesta ? ' [sin respuesta configurada: se respondio 500]' : '';
    return [
      `=== peticion ${n} de ${capturas.length} (${captura.origen})${marca} ===\n`,
      `${captura.metodo} ${captura.ruta} HTTP/${captura.version}\n`,
      captura.tlsCliente === null || captura.tlsCliente === undefined
        ? ''
        : `# tls cliente: sha256 ${captura.tlsCliente.hoja} (${captura.tlsCliente.cadena} en la cadena)\n`,
      ...cabeceras.map(([nombre, valor]) => `${nombre}: ${valor}\n`),
      '\n',
      cuerpo,
      `\n=== fin de la peticion ${n} ===\n`,
    ].join('');
  });

  return Buffer.from(partes.join(''), 'latin1');
}

/** Boundary de un Content-Type multipart (con o sin comillas), o undefined. */
function boundaryDe(contentType) {
  if (!/^\s*multipart\//i.test(contentType)) return undefined;
  const m = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  return boundary === undefined || boundary === '' ? undefined : boundary;
}

/** `a=1&FECHA=2026-11-06&b=2` → `a=1&FECHA=<normalizado>&b=2` para cada nombre de la lista. */
function normalizarCampos(cuerpo, nombres) {
  const codificados = new Set(nombres.map((n) => encodeURIComponent(n)));
  return cuerpo
    .split('&')
    .map((par) => {
      const igual = par.indexOf('=');
      const nombre = igual < 0 ? par : par.slice(0, igual);
      return codificados.has(nombre) ? `${nombre}=${MARCA_CAMPO}` : par;
    })
    .join('&');
}

/** `7|0|3|...|07-11-2026|...` → `7|0|3|...|<fecha>|...` (tokens exactos `dd-mm-aaaa`). */
function normalizarFechasGwt(cuerpo) {
  return cuerpo
    .split('|')
    .map((token) => (/^\d{2}-\d{2}-\d{4}$/.test(token) ? MARCA_FECHA : token))
    .join('|');
}

/** Huella sha256 de la hoja y largo de la cadena que presentó el cliente TLS, o null. */
function certificadoCliente(socket) {
  if (typeof socket.getPeerCertificate !== 'function') return null;
  const hoja = socket.getPeerCertificate(true);
  if (hoja === null || hoja === undefined || hoja.raw === undefined) return null;
  let cadena = 0;
  const vistos = new Set();
  for (
    let c = hoja;
    c?.raw !== undefined && !vistos.has(c.fingerprint256);
    c = c.issuerCertificate
  ) {
    vistos.add(c.fingerprint256);
    cadena++;
  }
  return { hoja: createHash('sha256').update(hoja.raw).digest('hex'), cadena };
}

/** `filename="tmp123.tmp.xml"` → `filename="<archivo>.xml"`, solo en las cabeceras de cada parte. */
function normalizarNombresArchivo(cuerpo) {
  return cuerpo.replace(
    /(\r\nContent-Disposition:[^\r\n]*?; filename=")([^"\r\n]*)(")/gi,
    (_, antes, nombre, despues) => {
      const punto = nombre.lastIndexOf('.');
      const extension = punto > 0 ? nombre.slice(punto) : '';
      return `${antes}${MARCA_ARCHIVO}${extension}${despues}`;
    },
  );
}

function normalizarHost(valor, captura) {
  const m = /^(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i.exec(valor.trim());
  return m !== null && Number(m[1]) === captura.puerto ? `<${captura.origen}>` : valor;
}

/** Valida y deja listas las respuestas grabadas de un caso. */
function leerCaso(caso) {
  if (caso === null || typeof caso !== 'object' || Array.isArray(caso)) {
    throw new Error('El caso HTTP debe ser un objeto {respuestas, normalizar}.');
  }
  const respuestas = (caso.respuestas ?? []).map((r, i) => {
    const donde = `respuestas[${i}]`;
    const status = r.status ?? 200;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error(`${donde}.status inválido: ${status}`);
    }
    const cabeceras = r.cabeceras ?? [];
    if (
      !Array.isArray(cabeceras) ||
      !cabeceras.every(
        (c) => Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === 'string'),
      )
    ) {
      throw new Error(`${donde}.cabeceras debe ser una lista de pares [nombre, valor].`);
    }
    let cuerpo;
    if (r.cuerpo === undefined) cuerpo = Buffer.alloc(0);
    else if (typeof r.cuerpo === 'string') cuerpo = Buffer.from(r.cuerpo, 'utf8');
    else if (typeof r.cuerpo?.base64 === 'string') cuerpo = Buffer.from(r.cuerpo.base64, 'base64');
    else throw new Error(`${donde}.cuerpo debe ser un string o {base64}.`);
    return { status, cabeceras, cuerpo };
  });
  const normalizar = caso.normalizar ?? {};
  for (const clave of Object.keys(normalizar)) {
    if (clave !== 'nombresArchivo' && clave !== 'camposFormulario' && clave !== 'fechasGwt')
      throw new Error(`Opción de normalización desconocida: ${clave}`);
  }
  return { respuestas, normalizar };
}

function responder(res, respuesta) {
  if (respuesta === undefined) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Servidor de captura: no hay respuesta configurada para esta petición.');
    return;
  }
  const cabeceras = respuesta.cabeceras.flat();
  if (!respuesta.cabeceras.some(([n]) => /^(content-length|transfer-encoding)$/i.test(n))) {
    cabeceras.push('Content-Length', String(respuesta.cuerpo.length));
  }
  res.writeHead(respuesta.status, cabeceras);
  res.end(respuesta.cuerpo);
}

/** Escucha en un puerto aleatorio de `::` (dual) o, si no hay IPv6, de 127.0.0.1. */
function escuchar(servidor) {
  const intentar = (host) =>
    new Promise((resolve, reject) => {
      const fallo = (error) => reject(error);
      servidor.once('error', fallo);
      servidor.listen({ port: 0, host, ipv6Only: false }, () => {
        servidor.off('error', fallo);
        resolve(/** @type {import('node:net').AddressInfo} */ (servidor.address()).port);
      });
    });
  return intentar('::').catch(() => intentar('127.0.0.1'));
}

/**
 * Levanta los tres orígenes en puertos aleatorios.
 *
 * @returns {Promise<ServidorCaptura>}
 */
export async function iniciarServidorCaptura() {
  const ca = readFileSync(RUTA_CA, 'utf8');
  const opcionesTls = {
    key: readFileSync(join(DIR_MATERIAL, 'captura-servidor-llave.pem')),
    cert: readFileSync(join(DIR_MATERIAL, 'captura-servidor.pem')),
    ALPNProtocols: ['http/1.1'],
    // Pide certificado de cliente sin exigirlo ni verificarlo: solo para mostrarlo.
    requestCert: true,
    rejectUnauthorized: false,
    // Sin reanudación de sesión TLS: cada conexión hace el handshake completo y
    // muestra la cadena que envía el cliente. undici reanuda sesiones entre
    // conexiones y cURL (un handle por petición) no; eso es TLS, no HTTP, y no se compara.
    secureOptions: constantesCrypto.SSL_OP_NO_TICKET,
  };

  let caso = leerCaso({});
  /** @type {WeakMap<object, {hoja: string, cadena: number} | null>} */
  const certificadosPorConexion = new WeakMap();
  /** @type {Captura[]} */
  let capturas = [];
  /** @type {Record<string, number>} */
  const puertos = {};

  const control = (req, res, cuerpo) => {
    try {
      const ruta = (req.url ?? '').split('?')[0];
      if (req.method === 'POST' && ruta === `${PREFIJO_CONTROL}caso`) {
        caso = leerCaso(JSON.parse(cuerpo.toString('utf8') || '{}'));
        capturas = [];
        res.writeHead(204).end();
      } else if (req.method === 'GET' && ruta === `${PREFIJO_CONTROL}normalizado`) {
        const bytes = normalizarCapturas(capturas, caso.normalizar);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(bytes);
      } else if (req.method === 'GET' && ruta === `${PREFIJO_CONTROL}capturas`) {
        const json = capturas.map((c) => ({ ...c, cuerpo: c.cuerpo.toString('base64') }));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Ruta de control desconocida: ${req.method} ${ruta}`);
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error instanceof Error ? error.message : String(error));
    }
  };

  const manejador = (origen) => (req, res) => {
    // Las respuestas no necesitan fecha: menos ruido al depurar.
    res.sendDate = false;
    /** @type {Buffer[]} */
    const trozos = [];
    req.on('data', (trozo) => trozos.push(trozo));
    req.on('end', () => {
      const cuerpo = Buffer.concat(trozos);
      if (origen === 'http' && (req.url ?? '').startsWith(PREFIJO_CONTROL)) {
        control(req, res, cuerpo);
        return;
      }
      /** @type {[string, string][]} */
      const cabeceras = [];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
        cabeceras.push([req.rawHeaders[i] ?? '', req.rawHeaders[i + 1] ?? '']);
      }
      const respuesta = caso.respuestas[capturas.length];
      capturas.push({
        origen,
        puerto: puertos[origen] ?? 0,
        metodo: req.method ?? '',
        ruta: req.url ?? '',
        version: req.httpVersion,
        cabeceras,
        cuerpo,
        sinRespuesta: respuesta === undefined,
        tlsCliente: origen === 'http' ? null : (certificadosPorConexion.get(req.socket) ?? null),
      });
      responder(res, respuesta);
    });
  };

  const servidores = {
    http: http.createServer(manejador('http')),
    https: https.createServer(opcionesTls, manejador('https')),
    https2: https.createServer(opcionesTls, manejador('https2')),
  };
  // El certificado de cliente se mide una vez por conexión, al terminar el
  // handshake: en una conexión reutilizada, una segunda llamada a
  // getPeerCertificate(true) ya no trae la cadena (solo la hoja).
  for (const servidor of [servidores.https, servidores.https2]) {
    servidor.on('secureConnection', (socket) => {
      certificadosPorConexion.set(socket, certificadoCliente(socket));
    });
  }
  try {
    for (const origen of ORIGENES) puertos[origen] = await escuchar(servidores[origen]);
  } catch (error) {
    await Promise.all(Object.values(servidores).map((s) => cerrarServidor(s)));
    throw error;
  }

  return {
    origenes: {
      http: `http://127.0.0.1:${puertos.http}`,
      https: `https://localhost:${puertos.https}`,
      https2: `https://localhost:${puertos.https2}`,
    },
    ca,
    rutaCa: RUTA_CA,
    cargarCaso(nuevo = {}) {
      caso = leerCaso(nuevo);
      capturas = [];
    },
    capturas: () => [...capturas],
    normalizado: () => normalizarCapturas(capturas, caso.normalizar),
    cerrar: () =>
      Promise.all(Object.values(servidores).map((s) => cerrarServidor(s))).then(() => {}),
  };
}

function cerrarServidor(servidor) {
  return new Promise((resolve) => {
    if (!servidor.listening) {
      resolve();
      return;
    }
    servidor.close(() => resolve());
    servidor.closeAllConnections();
  });
}

/**
 * @typedef {object} Captura
 * @property {'http' | 'https' | 'https2'} origen
 * @property {number} puerto
 * @property {string} metodo
 * @property {string} ruta        ruta con query, tal como llegó
 * @property {string} version     p. ej. "1.1"
 * @property {[string, string][]} cabeceras  en el orden y capitalización recibidos (valores en latin1)
 * @property {Buffer} cuerpo
 * @property {boolean} sinRespuesta  llegó después de agotar las respuestas grabadas
 * @property {{hoja: string, cadena: number} | null} [tlsCliente]  certificado que presentó el cliente
 */

/**
 * @typedef {object} OpcionesNormalizacion
 * @property {boolean} [nombresArchivo]
 * @property {string[]} [camposFormulario]
 * @property {boolean} [fechasGwt]
 */

/**
 * @typedef {object} ServidorCaptura
 * @property {{http: string, https: string, https2: string}} origenes  URLs base, sin `/` final
 * @property {string} ca      PEM de la CA de prueba
 * @property {string} rutaCa
 * @property {(caso?: object) => void} cargarCaso
 * @property {() => Captura[]} capturas
 * @property {() => Buffer} normalizado
 * @property {() => Promise<void>} cerrar
 */
