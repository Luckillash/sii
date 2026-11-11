/**
 * Prueba de humo de TLS contra los hosts de certificación del SII (PLAN-MIGRACION §6, fase 0).
 *
 * Objetivo: descartar a tiempo problemas de OpenSSL 3 (renegociación legacy, cifrados o
 * llaves DH débiles, SHA1 bloqueado) antes de portar los flujos que hablan con el SII.
 *
 * Uso: `pnpm humo:tls` (Node ejecuta este .ts directo, con type stripping: solo sintaxis
 * TS borrable). Para la parte de TLS mutuo hace falta un `.env` en la raíz con
 * SII_CERT_PATH y SII_CERT_PASS (ver `.env.example`).
 *
 * Seguridad: la llave, la clave del .pfx y el RUT del certificado NUNCA se imprimen ni se
 * escriben a disco. El .pfx se lee con node-forge y el PEM vive solo en memoria.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MS_CONEXION = 10_000;
const MS_RESPUESTA = 45_000;
const MAX_CUERPO = 64 * 1024;

interface Host {
  host: string;
  rol: string;
  /** Ruta inofensiva para el GET de prueba. */
  ruta: string;
  /** Si es true, se muestra el inicio del cuerpo (WSDL / XML de semilla). */
  mostrarCuerpo: boolean;
}

const HOSTS: Host[] = [
  {
    host: 'maullin.sii.cl',
    rol: 'SOAP DTEWS (certificación)',
    ruta: '/DTEWS/CrSeed.jws?WSDL',
    mostrarCuerpo: true,
  },
  {
    host: 'apicert.sii.cl',
    rol: 'REST boleta semilla/token (certificación)',
    ruta: '/recursos/v1/boleta.electronica.semilla',
    mostrarCuerpo: true,
  },
  {
    host: 'pangal.sii.cl',
    rol: 'REST boleta envío (certificación)',
    ruta: '/recursos/v1/boleta.electronica.semilla',
    mostrarCuerpo: true,
  },
  // AUT2000 (SolicitudFolios.php): el login con certificado vive en herculesr y la sesión
  // en zeusr; los dos son COMPARTIDOS por certificación y producción (solo cambia la URL
  // de vuelta, que apunta a maullin o palena).
  {
    host: 'herculesr.sii.cl',
    rol: 'AUT2000 login mTLS (compartido cert/prod)',
    ruta: '/',
    mostrarCuerpo: false,
  },
  {
    host: 'zeusr.sii.cl',
    rol: 'AUT2000 sesión (compartido cert/prod)',
    ruta: '/',
    mostrarCuerpo: false,
  },
];

interface MaterialCliente {
  key: string;
  /** Certificado hoja + intermedios, en PEM concatenado. */
  cert: string;
}

/** Relajación mínima de OpenSSL 3, aplicada solo si el intento estricto falla. */
interface Relajacion {
  nombre: string;
  opciones: tls.ConnectionOptions;
}

interface ResultadoPaso {
  ok: boolean;
  detalle: string;
  relajacion?: string;
}

interface ResultadoHost {
  host: Host;
  protocolo: string;
  cifrado: string;
  certServidor: string;
  sinCert: ResultadoPaso;
  conCert?: ResultadoPaso;
  get: ResultadoPaso;
  getConCert: boolean;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Oculta cualquier cosa con forma de RUT (12.345.678-9 / 12345678-9). */
function ocultarRut(texto: string): string {
  return texto.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT oculto]');
}

function mensajeError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; reason?: string };
    const partes = [e.code, e.reason && e.reason !== e.message ? e.reason : undefined, e.message];
    return partes.filter((p) => p).join(': ');
  }
  return String(err);
}

/** Valor de un atributo (p. ej. CN) en el subject/issuer de crypto.X509Certificate. */
function atributo(dn: string, nombre: string): string {
  for (const linea of dn.split('\n')) {
    const [clave, ...resto] = linea.split('=');
    if (clave === nombre) return resto.join('=');
  }
  return '?';
}

function primerValor(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '?';
  return v ?? '?';
}

/** Decide qué relajación probar según el error de OpenSSL. null = no es un caso conocido. */
function elegirRelajacion(err: unknown): Relajacion | null {
  const texto = mensajeError(err).toLowerCase();
  if (texto.includes('unsafe legacy renegotiation') || texto.includes('legacy_renegotiation')) {
    return {
      nombre: 'SSL_OP_LEGACY_SERVER_CONNECT (servidor sin RFC 5746)',
      opciones: { secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT },
    };
  }
  if (
    texto.includes('dh key too small') ||
    texto.includes('ee key too small') ||
    texto.includes('ca key too small') ||
    texto.includes('md too weak') ||
    texto.includes('no ciphers available') ||
    texto.includes('no shared cipher') ||
    texto.includes('handshake failure') ||
    texto.includes('unsupported protocol') ||
    texto.includes('no protocols available')
  ) {
    return {
      nombre: "ciphers 'DEFAULT@SECLEVEL=1' + minVersion TLSv1",
      opciones: { ciphers: 'DEFAULT@SECLEVEL=1', minVersion: 'TLSv1' },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chequeo de arranque: RSA-SHA1
// ---------------------------------------------------------------------------

function chequearSha1(): void {
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const datos = Buffer.from('prueba de humo SII: RSA-SHA1');
    const firma = crypto.sign('sha1', datos, privateKey);
    if (!crypto.verify('sha1', datos, publicKey, firma)) {
      throw new Error('la firma RSA-SHA1 recién generada no verifica');
    }
    console.log(`[ok] RSA-SHA1 disponible (OpenSSL ${process.versions.openssl}).`);
  } catch (err) {
    console.error('');
    console.error('[ERROR FATAL] Este Node/OpenSSL no permite firmar con RSA-SHA1.');
    console.error('El SII exige RSA-SHA1 (XMLDSig de semilla, DTE, sobres). Sin eso no hay port.');
    console.error(`Detalle: ${mensajeError(err)}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Certificado de cliente (.pfx con node-forge)
// ---------------------------------------------------------------------------

function cargarEnv(): void {
  const archivo = path.join(RAIZ, '.env');
  if (fs.existsSync(archivo)) {
    process.loadEnvFile(archivo);
    console.log('[ok] .env cargado desde la raíz del repo.');
  } else {
    console.log('[info] No hay .env en la raíz del repo.');
  }
}

function cargarMaterialCliente(): MaterialCliente | null {
  const rutaEnv = process.env.SII_CERT_PATH?.trim() ?? '';
  const clave = process.env.SII_CERT_PASS ?? '';
  if (!rutaEnv || !clave) {
    console.log('');
    console.log('[OMITIDO] Parte de TLS mutuo (certificado de cliente): falta SII_CERT_PATH o');
    console.log('          SII_CERT_PASS. Para habilitarla crea `.env` en la raíz con:');
    console.log('            SII_CERT_PATH=../certificacion-core/data/certs/<archivo>.pfx');
    console.log('            SII_CERT_PASS=<clave del .pfx>');
    console.log('          (el .env está en .gitignore; nunca se versiona).');
    return null;
  }

  const ruta = path.resolve(RAIZ, rutaEnv);
  const sanear = (s: string): string => ocultarRut(s.split(clave).join('***'));

  let der: string;
  try {
    der = fs.readFileSync(ruta).toString('binary');
  } catch (err) {
    console.error(
      `[ERROR] No se pudo leer el .pfx indicado en SII_CERT_PATH: ${sanear(mensajeError(err))}`,
    );
    process.exitCode = 1;
    return null;
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, clave);
  } catch (err) {
    console.error(
      '[ERROR] No se pudo descifrar el .pfx (¿clave incorrecta o algoritmo no soportado?).',
    );
    console.error(`        Detalle: ${sanear(mensajeError(err))}`);
    process.exitCode = 1;
    return null;
  }

  // Llave privada: puede venir como pkcs8ShroudedKeyBag (lo normal) o keyBag.
  const bolsasLlave = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag ?? '' })[
      forge.pki.oids.pkcs8ShroudedKeyBag ?? ''
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag ?? '' })[forge.pki.oids.keyBag ?? ''] ?? []),
  ];
  const llaveForge = bolsasLlave.find((b) => b.key)?.key;
  if (!llaveForge) {
    console.error('[ERROR] El .pfx no trae una llave privada RSA legible por node-forge.');
    process.exitCode = 1;
    return null;
  }
  const keyPem = forge.pki.privateKeyToPem(llaveForge);
  const llave = crypto.createPrivateKey(keyPem);

  const certsPem = (
    p12.getBags({ bagType: forge.pki.oids.certBag ?? '' })[forge.pki.oids.certBag ?? ''] ?? []
  )
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : null))
    .filter((c): c is string => c !== null);

  // La hoja es el certificado que calza con la llave; el resto es la cadena.
  const hojaPem = certsPem.find((pem) => new crypto.X509Certificate(pem).checkPrivateKey(llave));
  if (!hojaPem) {
    console.error('[ERROR] Ningún certificado del .pfx corresponde a la llave privada.');
    process.exitCode = 1;
    return null;
  }
  const cadena = certsPem.filter((pem) => pem !== hojaPem);
  const hoja = new crypto.X509Certificate(hojaPem);

  console.log('');
  console.log('[ok] Certificado de cliente leído con node-forge (solo en memoria):');
  console.log(`     Sujeto CN : ${ocultarRut(atributo(hoja.subject, 'CN'))}`);
  console.log(`     Emisor CN : ${ocultarRut(atributo(hoja.issuer, 'CN'))}`);
  console.log(`     Vigencia  : ${hoja.validFrom}  ->  ${hoja.validTo}`);
  console.log(`     Llave     : RSA ${llave.asymmetricKeyDetails?.modulusLength ?? '?'} bits`);
  console.log(`     Cadena    : ${cadena.length} certificado(s) intermedio(s)`);
  if (new Date(hoja.validTo).getTime() < Date.now()) {
    console.log('     [AVISO] El certificado está VENCIDO; el SII lo va a rechazar.');
  }

  return { key: keyPem, cert: [hojaPem, ...cadena].join('\n') };
}

// ---------------------------------------------------------------------------
// Pruebas de red
// ---------------------------------------------------------------------------

interface InfoHandshake {
  protocolo: string;
  cifrado: string;
  autorizado: boolean;
  certServidor: string;
  efimera: string;
}

function handshake(host: string, extra: tls.ConnectionOptions): Promise<InfoHandshake> {
  return new Promise((resolver, rechazar) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true,
      ...extra,
    });
    const timer = setTimeout(() => {
      socket.destroy(new Error(`timeout de conexión/handshake (${MS_CONEXION / 1000} s)`));
    }, MS_CONEXION);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const par = socket.getPeerCertificate();
      const cifrado = socket.getCipher();
      const efimera = socket.getEphemeralKeyInfo();
      const info: InfoHandshake = {
        protocolo: socket.getProtocol() ?? '?',
        cifrado: cifrado.standardName || cifrado.name,
        autorizado: socket.authorized,
        certServidor:
          `CN=${primerValor(par.subject?.CN)}; emisor=${primerValor(par.issuer?.CN)}` +
          ` (${primerValor(par.issuer?.O)}); vence ${par.valid_to ?? '?'}`,
        efimera:
          efimera && 'type' in efimera && efimera.type
            ? `${efimera.type}${efimera.name ? ` ${efimera.name}` : ''} ${efimera.size ?? '?'} bits`
            : '-',
      };
      socket.end();
      resolver(info);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      rechazar(err);
    });
  });
}

interface InfoGet {
  status: number;
  contentType: string;
  inicio: string;
}

function get(host: Host, extra: tls.ConnectionOptions): Promise<InfoGet> {
  return new Promise((resolver, rechazar) => {
    let terminado = false;
    const fallar = (err: Error): void => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timerConexion);
      clearTimeout(timerRespuesta);
      req.destroy();
      rechazar(err);
    };

    const req = https.request({
      host: host.host,
      port: 443,
      path: host.ruta,
      method: 'GET',
      servername: host.host,
      rejectUnauthorized: true,
      agent: false,
      headers: { 'User-Agent': 'certificacion-node/humo-tls', Accept: '*/*' },
      ...extra,
    });

    const timerConexion = setTimeout(
      () => fallar(new Error(`timeout de conexión (${MS_CONEXION / 1000} s)`)),
      MS_CONEXION,
    );
    const timerRespuesta = setTimeout(
      () => fallar(new Error(`timeout de respuesta (${MS_RESPUESTA / 1000} s)`)),
      MS_RESPUESTA,
    );

    req.once('socket', (socket) => {
      socket.once('secureConnect', () => clearTimeout(timerConexion));
    });
    req.once('error', fallar);
    req.once('response', (res) => {
      clearTimeout(timerConexion);
      const trozos: Buffer[] = [];
      let largo = 0;
      res.on('data', (trozo: Buffer) => {
        if (largo < MAX_CUERPO) {
          trozos.push(trozo);
          largo += trozo.length;
        }
      });
      res.once('error', fallar);
      res.once('end', () => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timerRespuesta);
        const cuerpo = Buffer.concat(trozos).toString('latin1').replace(/\s+/g, ' ').trim();
        resolver({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'] ?? '-',
          inicio: host.mostrarCuerpo ? ocultarRut(cuerpo.slice(0, 80)) : '',
        });
      });
    });
    req.end();
  });
}

/** Ejecuta un paso en modo estricto y, si falla por una causa conocida de OpenSSL 3, reintenta una vez relajado. */
async function conRelajacion<T>(
  etiqueta: string,
  intento: (extra: tls.ConnectionOptions) => Promise<T>,
  base: tls.ConnectionOptions,
): Promise<{ valor: T; relajacion?: string }> {
  try {
    return { valor: await intento(base) };
  } catch (err) {
    const relajacion = elegirRelajacion(err);
    if (!relajacion) throw err;
    console.log(`    [!] ${etiqueta} falló en modo estricto: ${ocultarRut(mensajeError(err))}`);
    console.log(`    [!] Reintentando una vez con relajación: ${relajacion.nombre}`);
    try {
      const valor = await intento({ ...base, ...relajacion.opciones });
      console.log(`    [!] RELAJACIÓN REQUERIDA: ${relajacion.nombre}`);
      return { valor, relajacion: relajacion.nombre };
    } catch (err2) {
      throw new Error(`falla incluso con relajación (${relajacion.nombre}): ${mensajeError(err2)}`);
    }
  }
}

async function probarHost(host: Host, material: MaterialCliente | null): Promise<ResultadoHost> {
  console.log('');
  console.log(`== ${host.host} — ${host.rol}`);

  const resultado: ResultadoHost = {
    host,
    protocolo: '-',
    cifrado: '-',
    certServidor: '-',
    sinCert: { ok: false, detalle: '' },
    get: { ok: false, detalle: '' },
    getConCert: material !== null,
  };

  // 1) Handshake sin certificado de cliente.
  try {
    const { valor, relajacion } = await conRelajacion(
      'Handshake sin cert',
      (e) => handshake(host.host, e),
      {},
    );
    resultado.protocolo = valor.protocolo;
    resultado.cifrado = valor.cifrado;
    resultado.certServidor = valor.autorizado ? 'OK' : 'NO autorizado';
    resultado.sinCert = {
      ok: valor.autorizado,
      detalle: `${valor.protocolo} ${valor.cifrado}`,
      ...(relajacion ? { relajacion } : {}),
    };
    console.log(
      `  Handshake sin cert : ${valor.protocolo}, ${valor.cifrado}, efímera ${valor.efimera}`,
    );
    console.log(
      `  Cert del servidor  : ${valor.autorizado ? 'autorizado' : 'NO autorizado'} — ${valor.certServidor}`,
    );
  } catch (err) {
    resultado.sinCert = { ok: false, detalle: ocultarRut(mensajeError(err)) };
    console.log(`  Handshake sin cert : FALLA — ${resultado.sinCert.detalle}`);
  }

  const tlsCliente: tls.ConnectionOptions = material
    ? { key: material.key, cert: material.cert }
    : {};

  // 2) Handshake con certificado de cliente.
  if (material) {
    try {
      const { valor, relajacion } = await conRelajacion(
        'Handshake con cert',
        (e) => handshake(host.host, e),
        tlsCliente,
      );
      resultado.conCert = {
        ok: valor.autorizado,
        detalle: `${valor.protocolo} ${valor.cifrado}`,
        ...(relajacion ? { relajacion } : {}),
      };
      console.log(`  Handshake con cert : ${valor.protocolo}, ${valor.cifrado}`);
    } catch (err) {
      resultado.conCert = { ok: false, detalle: ocultarRut(mensajeError(err)) };
      console.log(`  Handshake con cert : FALLA — ${resultado.conCert.detalle}`);
    }
  } else {
    console.log('  Handshake con cert : omitido (sin .env)');
  }

  // 3) GET real (con cert de cliente si hay material; si no, sin él).
  const etiquetaGet = `GET ${host.ruta} ${material ? 'con cert' : 'sin cert'}`;
  try {
    const { valor, relajacion } = await conRelajacion(etiquetaGet, (e) => get(host, e), tlsCliente);
    resultado.get = {
      ok: true,
      detalle: `HTTP ${valor.status} ${valor.contentType}`,
      ...(relajacion ? { relajacion } : {}),
    };
    console.log(`  ${etiquetaGet}: HTTP ${valor.status}, ${valor.contentType}`);
    if (valor.inicio) console.log(`    inicio: ${valor.inicio}`);
    // TLS y HTTP funcionaron, pero el SII a veces responde 200 con una página de error
    // de su servidor de aplicaciones (JBoss). No es un problema de TLS: solo se avisa.
    if (/HTTP Status 5\d\d/.test(valor.inicio)) {
      console.log('    [aviso] el cuerpo es una página de error del servidor del SII (no es TLS).');
    }
  } catch (err) {
    resultado.get = { ok: false, detalle: ocultarRut(mensajeError(err)) };
    console.log(`  ${etiquetaGet}: FALLA — ${resultado.get.detalle}`);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

function textoPaso(paso: ResultadoPaso | undefined, omitido: string): string {
  if (!paso) return omitido;
  return paso.ok ? 'OK' : 'FALLA';
}

function imprimirResumen(resultados: ResultadoHost[], conMaterial: boolean): boolean {
  const filas = resultados.map((r) => {
    const relajaciones = [r.sinCert.relajacion, r.conCert?.relajacion, r.get.relajacion].filter(
      (x): x is string => Boolean(x),
    );
    return [
      r.host.host,
      r.protocolo,
      r.cifrado,
      r.certServidor,
      textoPaso(r.conCert, 'pendiente (sin .env)'),
      `${r.getConCert ? '[mTLS] ' : '[sin cert] '}${r.get.ok ? r.get.detalle : 'FALLA'}`,
      relajaciones.length ? [...new Set(relajaciones)].join(', ') : 'ninguna',
    ];
  });
  const cabecera = ['Host', 'Protocolo', 'Cifrado', 'Cert servidor', 'mTLS', 'GET', 'Relajación'];
  const anchos = cabecera.map((c, i) =>
    Math.max(c.length, ...filas.map((f) => (f[i] ?? '').length)),
  );
  const linea = (celdas: string[]): string =>
    `| ${celdas.map((c, i) => c.padEnd(anchos[i] ?? 0)).join(' | ')} |`;

  console.log('');
  console.log('== Resumen');
  console.log(linea(cabecera));
  console.log(`|${anchos.map((a) => '-'.repeat(a + 2)).join('|')}|`);
  for (const f of filas) console.log(linea(f));

  const fallidos = resultados.filter(
    (r) => !r.sinCert.ok || !r.get.ok || (r.conCert !== undefined && !r.conCert.ok),
  );
  console.log('');
  if (!conMaterial) {
    console.log('[OMITIDO] TLS mutuo no probado: falta .env con SII_CERT_PATH y SII_CERT_PASS.');
  }
  if (fallidos.length) {
    console.log(
      `[FALLA] ${fallidos.length} host(s) con problemas: ${fallidos.map((r) => r.host.host).join(', ')}`,
    );
    for (const r of fallidos) {
      for (const [nombre, paso] of [
        ['sin cert', r.sinCert],
        ['con cert', r.conCert],
        ['GET', r.get],
      ] as const) {
        if (paso && !paso.ok) console.log(`        ${r.host.host} (${nombre}): ${paso.detalle}`);
      }
    }
    return false;
  }
  console.log('[ok] Todos los hosts respondieron (con las relajaciones indicadas, si las hubo).');
  return true;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Prueba de humo TLS — Node ${process.version}, OpenSSL ${process.versions.openssl}`);
  chequearSha1();
  cargarEnv();
  const material = cargarMaterialCliente();

  const resultados: ResultadoHost[] = [];
  for (const host of HOSTS) {
    // Secuencial para que la salida quede legible; probarHost nunca lanza.
    resultados.push(await probarHost(host, material));
  }

  const ok = imprimirResumen(resultados, material !== null);
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`[ERROR FATAL] ${ocultarRut(mensajeError(err))}`);
  process.exit(1);
});
