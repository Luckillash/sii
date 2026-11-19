import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALCANCES,
  ALCANCES_OFRECIDOS,
  ambienteDeClave,
  CODIGOS_ERROR,
  claveItemLote,
  ESPERAS_WEBHOOK_MIN,
  EVENTOS_WEBHOOK,
  FORMATO_CLAVE,
  FORMATO_IDEMPOTENCIA,
  MAX_INTENTOS_WEBHOOK,
  MAXIMO_URL_WEBHOOK,
  MENSAJES_ERROR,
  validarUrlWebhook,
} from './api-publica';

const esquema = readFileSync(
  new URL('../../../../supabase/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8',
);

/** Los literales del `array[...]` que sigue a `marcador` en la 0001. */
function arregloDelCheck(marcador: string): string[] {
  const desde = esquema.indexOf(marcador);
  expect(desde).toBeGreaterThan(-1);
  const inicio = esquema.indexOf('array[', desde);
  const fin = esquema.indexOf(']', inicio);
  return [...esquema.slice(inicio, fin).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const HEX64 = `${'a'.repeat(32)}0123456789abcdef0123456789abcdef`;

describe('sincronía con la 0001', () => {
  it('ALCANCES = check de api_keys.alcances', () => {
    expect(arregloDelCheck('alcances         text[]')).toEqual([...ALCANCES]);
  });

  it('EVENTOS_WEBHOOK = check de webhooks.eventos', () => {
    expect(arregloDelCheck('eventos           text[]')).toEqual([...EVENTOS_WEBHOOK]);
  });

  it('los alcances ofrecidos no incluyen certificacion:gestionar', () => {
    expect(ALCANCES_OFRECIDOS).not.toContain('certificacion:gestionar');
    for (const alcance of ALCANCES_OFRECIDOS) expect(ALCANCES).toContain(alcance);
  });

  it('una espera por cada intento que se reintenta', () => {
    expect(ESPERAS_WEBHOOK_MIN).toHaveLength(MAX_INTENTOS_WEBHOOK - 1);
  });
});

describe('FORMATO_CLAVE y ambienteDeClave', () => {
  it('acepta las claves que genera crear_api_key', () => {
    expect(FORMATO_CLAVE.test(`sk_test_${HEX64}`)).toBe(true);
    expect(FORMATO_CLAVE.test(`sk_live_${HEX64}`)).toBe(true);
    expect(ambienteDeClave(`sk_test_${HEX64}`)).toBe('certificacion');
    expect(ambienteDeClave(`sk_live_${HEX64}`)).toBe('produccion');
  });

  it.each([
    ['vacía', ''],
    ['prefijo desconocido', `sk_prod_${HEX64}`],
    ['corta', `sk_test_${HEX64.slice(1)}`],
    ['larga', `sk_test_${HEX64}0`],
    ['mayúsculas', `sk_test_${HEX64.toUpperCase()}`],
    ['espacio al final', `sk_test_${HEX64} `],
    ['solo el prefijo visible', 'sk_test_ab12'],
  ])('rechaza una clave %s', (_caso, clave) => {
    expect(FORMATO_CLAVE.test(clave)).toBe(false);
    expect(ambienteDeClave(clave)).toBeNull();
  });
});

describe('validarUrlWebhook (espejo del check webhooks_url_permitida)', () => {
  it.each([
    'https://tu-sistema.cl/webhooks/boleteame',
    'https://tu-sistema.cl',
    'https://tu-sistema.cl/',
    'https://tu-sistema.cl:443/webhooks',
    'https://api.ejemplo.com/hooks?token=abc&x=1',
    'https://x-1.sub.ejemplo.cl/a/b#c',
    'https://LOCALHOST.ejemplo.cl/hook',
    'https://local.ejemplo.cl/hook',
  ])('acepta %s', (url) => {
    expect(validarUrlWebhook(url)).toEqual({ ok: true, url });
  });

  it('recorta los espacios de los extremos', () => {
    expect(validarUrlWebhook('  https://tu-sistema.cl/h  ')).toEqual({
      ok: true,
      url: 'https://tu-sistema.cl/h',
    });
  });

  it.each([
    ['vacía', '   '],
    ['http', 'http://tu-sistema.cl/hook'],
    ['otro esquema', 'ftp://tu-sistema.cl/hook'],
    ['puerto 8443', 'https://tu-sistema.cl:8443/hook'],
    ['puerto 80', 'https://tu-sistema.cl:80/hook'],
    ['usuario', 'https://usuario@tu-sistema.cl/hook'],
    ['usuario y clave', 'https://usuario:clave@tu-sistema.cl/hook'],
    ['IPv4', 'https://10.0.0.1/hook'],
    ['IPv4 con 443', 'https://127.0.0.1:443/hook'],
    ['IPv4 sin ruta', 'https://169.254.169.254'],
    ['IPv6', 'https://[::1]/hook'],
    ['IPv6 completa', 'https://[fe80::1]:443/hook'],
    ['localhost', 'https://localhost/hook'],
    ['host con punto final', 'https://localhost./hook'],
    ['dominio con punto final', 'https://ejemplo.cl.'],
    ['localhost mayúsculas', 'https://LocalHost'],
    ['.local', 'https://impresora.local/hook'],
    ['.localhost', 'https://app.localhost:443/'],
    ['.internal', 'https://metadata.google.internal/computeMetadata'],
    ['.internal sin ruta', 'https://servicio.INTERNAL'],
    ['espacio en la ruta', 'https://tu-sistema.cl/a b'],
    ['consulta sin ruta', 'https://tu-sistema.cl?x=1'],
    ['guion bajo en el host', 'https://mi_host.cl/hook'],
  ])('rechaza una URL con %s', (_caso, url) => {
    const resultado = validarUrlWebhook(url);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.mensaje).not.toMatch(/!/);
  });

  it('rechaza más de 2.048 caracteres y acepta justo 2.048', () => {
    const base = 'https://tu-sistema.cl/';
    const justa = base + 'a'.repeat(MAXIMO_URL_WEBHOOK - base.length);
    expect(validarUrlWebhook(justa).ok).toBe(true);
    expect(validarUrlWebhook(`${justa}a`).ok).toBe(false);
  });
});

describe('errores e idempotencia', () => {
  it('cada código tiene mensaje con tono del design system', () => {
    expect(Object.keys(MENSAJES_ERROR).sort()).toEqual(Object.keys(CODIGOS_ERROR).sort());
    for (const mensaje of Object.values(MENSAJES_ERROR)) {
      expect(mensaje).not.toMatch(/[!¡]/);
      expect(mensaje.length).toBeGreaterThan(20);
    }
  });

  it('la clave de un ítem del lote cabe en la base (255) y conserva el formato', () => {
    const clave = 'k'.repeat(200);
    expect(FORMATO_IDEMPOTENCIA.test(clave)).toBe(true);
    expect(claveItemLote(clave, 24)).toBe(`${clave}#25`);
    expect(claveItemLote(clave, 24).length).toBeLessThanOrEqual(255);
    expect(FORMATO_IDEMPOTENCIA.test('con espacio')).toBe(false);
    expect(FORMATO_IDEMPOTENCIA.test('')).toBe(false);
    expect(FORMATO_IDEMPOTENCIA.test('ñ')).toBe(false);
  });
});
