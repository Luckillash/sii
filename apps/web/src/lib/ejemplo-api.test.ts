import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CABECERAS_WEBHOOK, TOLERANCIA_FIRMA_S } from './api-publica';

// El verificador de firmas del cliente de ejemplo (`scripts/ejemplo-api/verificar-firma.mjs`,
// para que los clientes lo copien) tiene que calzar con lo que firma la entrega de
// webhooks (`server/webhooks/firma.ts`) y con un HMAC calculado aquí con node:crypto.

const RAIZ = new URL('../../../../', import.meta.url);
const RUTA_EJEMPLO = fileURLToPath(new URL('scripts/ejemplo-api/verificar-firma.mjs', RAIZ));
const RUTA_FIRMA_SERVIDOR = fileURLToPath(new URL('../server/webhooks/firma.ts', import.meta.url));

interface ResultadoVerificacion {
  ok: boolean;
  motivo?: string;
}
interface ModuloEjemplo {
  TOLERANCIA_SEGUNDOS: number;
  firmar: (secreto: string, t: number, cuerpo: string) => string;
  verificarFirma: (p: {
    cuerpo: string | Buffer;
    cabecera: string | undefined | null;
    secreto: string;
    toleranciaSegundos?: number;
    ahora?: number | Date;
  }) => ResultadoVerificacion;
}

let ejemplo: ModuloEjemplo;

beforeAll(async () => {
  // Ruta en una variable: TypeScript no intenta resolver los tipos del .mjs.
  const url = pathToFileURL(RUTA_EJEMPLO).href;
  ejemplo = (await import(/* @vite-ignore */ url)) as ModuloEjemplo;
});

const SECRETO = 'whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const T = 1_763_500_000;
const AHORA = T * 1000 + 30_000;
const CUERPO = JSON.stringify({
  id: '123',
  evento: 'documento.aceptado',
  creado_en: '2026-11-18T20:00:00.000Z',
  datos: { documento_id: '6f1c', folio: 43, razon: 'Café ñandú' },
});

function hmacDeReferencia(secreto: string, t: number, cuerpo: string): string {
  return createHmac('sha256', Buffer.from(secreto, 'utf8'))
    .update(Buffer.from(`${t}.${cuerpo}`, 'utf8'))
    .digest('hex');
}

/** `null` = la cabecera válida del CUERPO original. */
function cabeceraDe(cabecera: string | null | undefined): string | undefined {
  return cabecera === null ? `t=${T},v1=${hmacDeReferencia(SECRETO, T, CUERPO)}` : cabecera;
}

const CASOS_RECHAZO: [string, string | null | undefined, string, string, string][] = [
  ['sin cabecera', undefined, CUERPO, SECRETO, 'cabecera_invalida'],
  ['formato', 'v1=abc', CUERPO, SECRETO, 'cabecera_invalida'],
  ['sin v1', `t=${T}`, CUERPO, SECRETO, 'cabecera_invalida'],
  ['cuerpo cambiado', null, `${CUERPO} `, SECRETO, 'firma_invalida'],
  ['otro secreto', null, CUERPO, `${SECRETO}x`, 'firma_invalida'],
];

describe('scripts/ejemplo-api/verificar-firma.mjs', () => {
  it('firma igual que un HMAC-SHA256 de referencia sobre "t.cuerpo" (UTF-8)', () => {
    expect(ejemplo.firmar(SECRETO, T, CUERPO)).toBe(hmacDeReferencia(SECRETO, T, CUERPO));
  });

  it('vector fijo (no cambia sin que cambien los clientes)', () => {
    expect(ejemplo.firmar('whsec_prueba', 1700000000, '{"id":"1"}')).toBe(
      hmacDeReferencia('whsec_prueba', 1700000000, '{"id":"1"}'),
    );
    expect(ejemplo.firmar('whsec_prueba', 1700000000, '{"id":"1"}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acepta una firma válida (string o Buffer)', () => {
    const cabecera = `t=${T},v1=${hmacDeReferencia(SECRETO, T, CUERPO)}`;
    expect(
      ejemplo.verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora: AHORA }),
    ).toMatchObject({ ok: true });
    expect(
      ejemplo.verificarFirma({
        cuerpo: Buffer.from(CUERPO, 'utf8'),
        cabecera,
        secreto: SECRETO,
        ahora: AHORA,
      }),
    ).toMatchObject({ ok: true });
  });

  it('acepta si alguno de varios v1 calza', () => {
    const cabecera = `t=${T},v1=${'0'.repeat(64)},v1=${hmacDeReferencia(SECRETO, T, CUERPO)}`;
    expect(
      ejemplo.verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora: AHORA }).ok,
    ).toBe(true);
  });

  it('acepta `ahora` como Date', () => {
    const cabecera = `t=${T},v1=${hmacDeReferencia(SECRETO, T, CUERPO)}`;
    expect(
      ejemplo.verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora: new Date(AHORA) })
        .ok,
    ).toBe(true);
  });

  it.each(CASOS_RECHAZO)('rechaza: %s', (_n, cabecera, cuerpo, secreto, motivo) => {
    expect(
      ejemplo.verificarFirma({ cuerpo, cabecera: cabeceraDe(cabecera), secreto, ahora: AHORA }),
    ).toEqual({ ok: false, motivo });
  });

  it(`rechaza una firma con t de más de ${TOLERANCIA_FIRMA_S} s`, () => {
    expect(ejemplo.TOLERANCIA_SEGUNDOS).toBe(TOLERANCIA_FIRMA_S);
    const cabecera = `t=${T},v1=${hmacDeReferencia(SECRETO, T, CUERPO)}`;
    const tarde = T * 1000 + (TOLERANCIA_FIRMA_S + 1) * 1000;
    expect(
      ejemplo.verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora: tarde }),
    ).toEqual({ ok: false, motivo: 'fuera_de_tolerancia' });
  });

  it('la cabecera que lee el receptor es Boleteame-Firma', () => {
    expect(CABECERAS_WEBHOOK.firma.toLowerCase()).toBe('boleteame-firma');
  });
});

interface ModuloServidor {
  firmar: (secreto: string, t: number, cuerpo: string) => string;
  verificarFirma: (p: {
    cuerpo: string;
    cabecera: string | null | undefined;
    secreto: string;
    toleranciaSegundos?: number;
    ahora?: Date;
  }) => ResultadoVerificacion;
}

describe.skipIf(!existsSync(RUTA_FIRMA_SERVIDOR))('server/webhooks/firma.ts (si existe)', () => {
  let servidor: ModuloServidor;
  beforeAll(async () => {
    servidor = (await import(
      /* @vite-ignore */ pathToFileURL(RUTA_FIRMA_SERVIDOR).href
    )) as ModuloServidor;
  });

  it('firman lo mismo', () => {
    expect(servidor.firmar(SECRETO, T, CUERPO)).toBe(ejemplo.firmar(SECRETO, T, CUERPO));
  });

  it('dan el mismo resultado (y motivo) en los casos de aceptación y rechazo', () => {
    const ahora = new Date(AHORA);
    const casos: [string | null | undefined, string, string][] = [
      [null, CUERPO, SECRETO],
      ...CASOS_RECHAZO.map(
        ([, c, cu, s]) => [c, cu, s] as [string | null | undefined, string, string],
      ),
    ];
    for (const [cabecera, cuerpo, secreto] of casos) {
      const valor = cabeceraDe(cabecera);
      expect(ejemplo.verificarFirma({ cuerpo, cabecera: valor, secreto, ahora })).toEqual(
        servidor.verificarFirma({ cuerpo, cabecera: valor, secreto, ahora }),
      );
    }
    const tarde = new Date(AHORA + (TOLERANCIA_FIRMA_S + 60) * 1000);
    const valor = cabeceraDe(null);
    expect(
      ejemplo.verificarFirma({ cuerpo: CUERPO, cabecera: valor, secreto: SECRETO, ahora: tarde }),
    ).toEqual(
      servidor.verificarFirma({ cuerpo: CUERPO, cabecera: valor, secreto: SECRETO, ahora: tarde }),
    );
  });
});
