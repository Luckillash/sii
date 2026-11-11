import 'server-only';
import { constants, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';

// Spike de red de la Fase 0 (PLAN-SAAS §7, Fase 0, paso 2): el equivalente de
// `pnpm humo:tls` de certificacion-node, ejecutado desde una función de Vercel.
// Temporal: se elimina al cerrar la Fase 0 (ver documentación/01-fundamentos/
// ambientes-y-credenciales.md).
//
// Nunca se devuelve la llave, la clave, el token ni el RUT del certificado.

const MS_CONEXION = 10_000;
const MS_RESPUESTA = 45_000;

export interface HostSii {
  host: string;
  rol: string;
  ruta: string;
}

/** Los 5 hosts de certificación que usa la librería (docs/canales.md). */
export const HOSTS_CERTIFICACION: readonly HostSii[] = [
  { host: 'maullin.sii.cl', rol: 'SOAP DTEWS', ruta: '/DTEWS/CrSeed.jws?WSDL' },
  {
    host: 'apicert.sii.cl',
    rol: 'REST semilla/token',
    ruta: '/recursos/v1/boleta.electronica.semilla',
  },
  { host: 'pangal.sii.cl', rol: 'REST envío', ruta: '/recursos/v1/boleta.electronica.semilla' },
  { host: 'herculesr.sii.cl', rol: 'AUT2000 login mTLS', ruta: '/' },
  { host: 'zeusr.sii.cl', rol: 'AUT2000 sesión', ruta: '/' },
];

export interface MaterialTls {
  key: string;
  cert: string;
}

export interface Paso {
  ok: boolean;
  ms: number;
  detalle: string;
  relajacion?: string;
}

export interface ResultadoHost {
  host: string;
  rol: string;
  ip?: string;
  handshake: Paso;
  handshakeConCertificado?: Paso;
  get: Paso;
}

/** Oculta cualquier cosa con forma de RUT. */
export function ocultarRut(texto: string): string {
  return texto.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT oculto]');
}

function mensaje(error: unknown): string {
  if (error instanceof Error) {
    const e = error as Error & { code?: string };
    return ocultarRut([e.code, e.message].filter(Boolean).join(': '));
  }
  return ocultarRut(String(error));
}

/** Relajación mínima de OpenSSL 3 según el error, igual que scripts/humo-tls.ts. */
function relajacionPara(error: unknown): { nombre: string; opciones: tls.ConnectionOptions } | null {
  const texto = mensaje(error).toLowerCase();
  if (texto.includes('legacy renegotiation') || texto.includes('legacy_renegotiation')) {
    return {
      nombre: 'SSL_OP_LEGACY_SERVER_CONNECT',
      opciones: { secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT },
    };
  }
  if (/key too small|md too weak|no ciphers|no shared cipher|handshake failure|unsupported protocol|no protocols/.test(texto)) {
    return {
      nombre: 'DEFAULT@SECLEVEL=1 + TLSv1',
      opciones: { ciphers: 'DEFAULT@SECLEVEL=1', minVersion: 'TLSv1' },
    };
  }
  return null;
}

async function medir<T>(
  fn: (extra: tls.ConnectionOptions) => Promise<T>,
  base: tls.ConnectionOptions,
  describir: (valor: T) => string,
  esOk: (valor: T) => boolean = () => true,
): Promise<Paso & { valor?: T }> {
  const inicio = performance.now();
  try {
    const valor = await fn(base);
    return { ok: esOk(valor), ms: Math.round(performance.now() - inicio), detalle: describir(valor), valor };
  } catch (error) {
    const relajacion = relajacionPara(error);
    if (relajacion) {
      try {
        const valor = await fn({ ...base, ...relajacion.opciones });
        return {
          ok: esOk(valor),
          ms: Math.round(performance.now() - inicio),
          detalle: describir(valor),
          relajacion: relajacion.nombre,
          valor,
        };
      } catch (error2) {
        return { ok: false, ms: Math.round(performance.now() - inicio), detalle: mensaje(error2) };
      }
    }
    return { ok: false, ms: Math.round(performance.now() - inicio), detalle: mensaje(error) };
  }
}

interface InfoHandshake {
  protocolo: string;
  cifrado: string;
  autorizado: boolean;
  ip: string;
}

function handshake(host: string, extra: tls.ConnectionOptions): Promise<InfoHandshake> {
  return new Promise((resolver, rechazar) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true, ...extra });
    const timer = setTimeout(
      () => socket.destroy(new Error(`timeout de conexión (${MS_CONEXION / 1000} s)`)),
      MS_CONEXION,
    );
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cifrado = socket.getCipher();
      const info = {
        protocolo: socket.getProtocol() ?? '?',
        cifrado: cifrado.standardName || cifrado.name,
        autorizado: socket.authorized,
        ip: socket.remoteAddress ?? '?',
      };
      socket.end();
      resolver(info);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      rechazar(error);
    });
  });
}

function get(host: HostSii, extra: tls.ConnectionOptions): Promise<{ status: number; tipo: string }> {
  return new Promise((resolver, rechazar) => {
    const req = https.request({
      host: host.host,
      port: 443,
      path: host.ruta,
      method: 'GET',
      servername: host.host,
      rejectUnauthorized: true,
      agent: false,
      timeout: MS_CONEXION,
      headers: { 'User-Agent': 'timbre/spike-conectividad', Accept: '*/*' },
      ...extra,
    });
    const timer = setTimeout(
      () => req.destroy(new Error(`timeout de respuesta (${MS_RESPUESTA / 1000} s)`)),
      MS_RESPUESTA,
    );
    req.once('timeout', () => req.destroy(new Error(`timeout de conexión (${MS_CONEXION / 1000} s)`)));
    req.once('error', (error) => {
      clearTimeout(timer);
      rechazar(error);
    });
    req.once('response', (res) => {
      res.resume();
      res.once('end', () => {
        clearTimeout(timer);
        resolver({ status: res.statusCode ?? 0, tipo: String(res.headers['content-type'] ?? '-') });
      });
    });
    req.end();
  });
}

export async function probarHost(host: HostSii, material: MaterialTls | null): Promise<ResultadoHost> {
  const sinCert = await medir(
    (e) => handshake(host.host, e),
    {},
    (v) => `${v.protocolo} ${v.cifrado}${v.autorizado ? '' : ' (cert del servidor NO autorizado)'}`,
    (v) => v.autorizado,
  );
  const resultado: ResultadoHost = {
    host: host.host,
    rol: host.rol,
    ...(sinCert.valor ? { ip: sinCert.valor.ip } : {}),
    handshake: sinValor(sinCert),
    get: { ok: false, ms: 0, detalle: '' },
  };
  const base: tls.ConnectionOptions = material ? { key: material.key, cert: material.cert } : {};
  if (material) {
    resultado.handshakeConCertificado = sinValor(
      await medir(
        (e) => handshake(host.host, e),
        base,
        (v) => `${v.protocolo} ${v.cifrado}`,
        (v) => v.autorizado,
      ),
    );
  }
  resultado.get = sinValor(
    await medir(
      (e) => get(host, e),
      base,
      (v) => `HTTP ${v.status} ${v.tipo}${material ? ' [mTLS]' : ''}`,
    ),
  );
  return resultado;
}

function sinValor(paso: Paso & { valor?: unknown }): Paso {
  const { valor: _valor, ...resto } = paso;
  return resto;
}

/** El SII exige RSA-SHA1 (semilla, DTE, sobres). Si el runtime no lo permite, no hay producto. */
export function rsaSha1Disponible(): boolean {
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const datos = Buffer.from('spike Timbre: RSA-SHA1');
    return verify('sha1', datos, publicKey, sign('sha1', datos, privateKey));
  } catch {
    return false;
  }
}

/** Huella corta y no reversible para identificar el certificado en el informe. */
export function huellaCorta(pem: string): string {
  return createHash('sha256').update(pem).digest('hex').slice(0, 12);
}
