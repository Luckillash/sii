import { describe, expect, it } from 'vitest';
import { cabeceraFirma, firmar, verificarFirma } from './firma';

// Firma `Boleteame-Firma: t=<unix>,v1=<hex HMAC-SHA256(secreto, `${t}.${cuerpo}`)>`.
// El vector se calculó aparte con `openssl dgst -sha256 -hmac`.

const SECRETO = 'whsec_0123456789abcdef';
const T = 1_700_000_000;
const CUERPO = '{"id":"1","evento":"webhook.prueba"}';
const ESPERADA = '982ab3af2faee56cdd5731af70e011f33900bf55ef1a8729db87eec559bde24d';
const AHORA = new Date(T * 1000);

describe('firmar', () => {
  it('coincide con el vector conocido (secreto completo whsec_… en UTF-8)', () => {
    expect(firmar(SECRETO, T, CUERPO)).toBe(ESPERADA);
    expect(cabeceraFirma(SECRETO, T, CUERPO)).toBe(`t=${T},v1=${ESPERADA}`);
  });

  it('cambia con el cuerpo, el t o el secreto', () => {
    expect(firmar(SECRETO, T, `${CUERPO} `)).not.toBe(ESPERADA);
    expect(firmar(SECRETO, T + 1, CUERPO)).not.toBe(ESPERADA);
    expect(firmar(`${SECRETO}x`, T, CUERPO)).not.toBe(ESPERADA);
  });

  it('firma los bytes UTF-8 (tildes y ñ)', () => {
    const cuerpo = '{"razon_social":"Panadería Ñuñoa"}';
    const f = firmar(SECRETO, T, cuerpo);
    expect(
      verificarFirma({ cuerpo, cabecera: `t=${T},v1=${f}`, secreto: SECRETO, ahora: AHORA }),
    ).toEqual({
      ok: true,
      t: T,
    });
  });
});

describe('verificarFirma', () => {
  const cabecera = `t=${T},v1=${ESPERADA}`;

  it('válida dentro de la tolerancia (300 s por defecto, en ambas direcciones)', () => {
    for (const desfase of [0, 300, -300]) {
      const ahora = new Date((T + desfase) * 1000);
      expect(verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora })).toEqual({
        ok: true,
        t: T,
      });
    }
  });

  it('fuera de tolerancia', () => {
    for (const desfase of [301, -301]) {
      const ahora = new Date((T + desfase) * 1000);
      expect(verificarFirma({ cuerpo: CUERPO, cabecera, secreto: SECRETO, ahora })).toEqual({
        ok: false,
        motivo: 'fuera_de_tolerancia',
      });
    }
    expect(
      verificarFirma({
        cuerpo: CUERPO,
        cabecera,
        secreto: SECRETO,
        ahora: new Date((T + 600) * 1000),
        toleranciaSegundos: 900,
      }).ok,
    ).toBe(true);
  });

  it('firma inválida: otro cuerpo u otro secreto', () => {
    expect(
      verificarFirma({ cuerpo: `${CUERPO}x`, cabecera, secreto: SECRETO, ahora: AHORA }),
    ).toEqual({
      ok: false,
      motivo: 'firma_invalida',
    });
    expect(
      verificarFirma({ cuerpo: CUERPO, cabecera, secreto: 'whsec_otro', ahora: AHORA }),
    ).toEqual({
      ok: false,
      motivo: 'firma_invalida',
    });
  });

  it('cabecera inválida: ausente, sin t, sin v1, t no entero o v1 que no es hex de 64', () => {
    for (const c of [
      null,
      undefined,
      '',
      `v1=${ESPERADA}`,
      `t=${T}`,
      `t=abc,v1=${ESPERADA}`,
      `t=${T}.5,v1=${ESPERADA}`,
      `t=${T},v1=${ESPERADA.toUpperCase()}`,
      `t=${T},v1=${ESPERADA.slice(1)}`,
      `t=${T},v0=${ESPERADA}`,
    ]) {
      expect(
        verificarFirma({ cuerpo: CUERPO, cabecera: c, secreto: SECRETO, ahora: AHORA }),
      ).toEqual({
        ok: false,
        motivo: 'cabecera_invalida',
      });
    }
  });

  it('acepta espacios y varios v1 (basta que coincida uno)', () => {
    const otra = 'a'.repeat(64);
    expect(
      verificarFirma({
        cuerpo: CUERPO,
        cabecera: ` t=${T} , v1=${otra}, v1=${ESPERADA}`,
        secreto: SECRETO,
        ahora: AHORA,
      }),
    ).toEqual({ ok: true, t: T });
  });
});
