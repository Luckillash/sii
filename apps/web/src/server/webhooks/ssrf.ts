import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

// Protección contra SSRF de la entrega de webhooks (PLAN-SAAS Fase 11). La URL ya pasó
// `validarUrlWebhook` (espejo del check `webhooks_url_permitida`, sin IP literal ni
// dominios locales), pero un dominio público puede resolver a una IP interna, o cambiar
// de IP entre la validación y la conexión (*DNS rebinding*). Por eso la validación se
// hace en el `lookup` del socket: la IP que se revisa es la misma a la que se conecta.

/** Rangos que nunca se contactan: privados, loopback, link-local, CGNAT, multicast, etc. */
const BLOQUEADAS = new BlockList();
for (const [red, prefijo] of [
  ['0.0.0.0', 8], // «esta red»
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (metadatos de nubes en 169.254.169.254)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // asignaciones IETF
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // pruebas de rendimiento
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada y broadcast
] as const) {
  BLOQUEADAS.addSubnet(red, prefijo, 'ipv4');
}
for (const [red, prefijo] of [
  ['::', 96], // no especificada, loopback (::1) e IPv4 compatibles (::a.b.c.d)
  ['64:ff9b::', 96], // NAT64: puede traducir a una IPv4 interna
  ['100::', 64], // descarte
  ['fc00::', 7], // ULA (privada)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOQUEADAS.addSubnet(red, prefijo, 'ipv6');
}

const MAPEADA_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Lleva `::ffff:a.b.c.d` a `a.b.c.d` (una IPv4 escrita como IPv6 se revisa como IPv4). */
export function normalizarIp(ip: string): string {
  const mapeada = MAPEADA_IPV4.exec(ip);
  return mapeada?.[1] ?? ip;
}

/** `true` si la IP no se puede contactar (o si no es una IP válida). */
export function esDireccionBloqueada(ip: string): boolean {
  const normal = normalizarIp(ip);
  const familia = isIP(normal);
  if (familia === 4) return BLOQUEADAS.check(normal, 'ipv4');
  if (familia === 6) {
    // Las IPv4 mapeadas en hexadecimal (`::ffff:7f00:1`) también se bloquean enteras.
    if (/^::ffff:/i.test(normal)) return true;
    return BLOQUEADAS.check(normal, 'ipv6');
  }
  return true;
}

/** El destino resolvió a una IP que no se contacta: la entrega se descarta sin reintentos. */
export class ErrorDireccionBloqueada extends Error {
  override readonly name = 'ErrorDireccionBloqueada';
  readonly code = 'EDIRECCIONBLOQUEADA';
}

export const MENSAJE_DIRECCION_BLOQUEADA =
  'La URL resuelve a una dirección privada o local, y los webhooks solo se envían a direcciones públicas. Usa un dominio público.';

type ResolverDns = (
  hostname: string,
  opciones: { all: true; family?: number; hints?: number },
  callback: (error: NodeJS.ErrnoException | null, direcciones: LookupAddress[]) => void,
) => void;

const resolverPorDefecto: ResolverDns = (hostname, opciones, callback) =>
  dnsLookup(hostname, opciones, callback);

/**
 * `lookup` para `https.request` / `net.connect`: resuelve todas las direcciones y rechaza
 * si **alguna** está bloqueada (así no se puede alternar entre una pública y una interna).
 * Responde en las dos formas del callback de Node: con `all: true` (que usa
 * `autoSelectFamily`) la lista; si no, la primera dirección y su familia.
 */
export function crearLookupSeguro(resolver: ResolverDns = resolverPorDefecto): LookupFunction {
  return (hostname, opciones, callback) => {
    const familia = typeof opciones.family === 'number' ? opciones.family : undefined;
    resolver(
      hostname,
      { all: true, ...(familia ? { family: familia } : {}), hints: opciones.hints },
      (error, direcciones) => {
        if (error) {
          callback(error, '', 0);
          return;
        }
        const lista = (direcciones ?? []).map((d) => ({
          address: normalizarIp(d.address),
          family: isIP(normalizarIp(d.address)) || d.family,
        }));
        if (lista.length === 0) {
          const vacio: NodeJS.ErrnoException = new Error(`No se pudo resolver ${hostname}`);
          vacio.code = 'ENOTFOUND';
          callback(vacio, '', 0);
          return;
        }
        if (lista.some((d) => esDireccionBloqueada(d.address))) {
          callback(new ErrorDireccionBloqueada(MENSAJE_DIRECCION_BLOQUEADA), '', 0);
          return;
        }
        if (opciones.all) {
          (callback as unknown as (e: null, d: LookupAddress[]) => void)(null, lista);
          return;
        }
        const [primera] = lista as [LookupAddress];
        callback(null, primera.address, primera.family);
      },
    );
  };
}

export const lookupSeguro: LookupFunction = crearLookupSeguro();
