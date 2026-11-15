import { TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  DetenidoAntesDeTimbrar,
  detenidoAntesDeTimbrar,
  mensajeTraslapeTimbrado,
  PASOS_REVISION,
  TransporteSinTimbrar,
} from './sii';

// `TransporteSinTimbrar` (revisión con el SII): lista permitida en el host del portal del
// ambiente; todo lo demás de ese host se corta sin llegar al transporte real.

async function envia(t: TransporteSinTimbrar, url: string) {
  return t.enviar({ metodo: 'POST', url });
}

describe('TransporteSinTimbrar', () => {
  for (const [ambiente, host] of [
    ['certificacion', 'maullin.sii.cl'],
    ['produccion', 'palena.sii.cl'],
  ] as const) {
    it(`${ambiente}: deja pasar solo los pasos anteriores a timbrar en ${host}`, async () => {
      const real = new TransporteFalso();
      const t = new TransporteSinTimbrar(real, ambiente);
      for (const paso of PASOS_REVISION) {
        await envia(t, `https://${host}/cvc_cgi/dte/${paso}?x=1`);
      }
      expect(real.urls().map((u) => new URL(u).pathname)).toEqual([
        '/cvc_cgi/dte/of_solicita_folios',
        '/cvc_cgi/dte/of_solicita_folios_dcto',
        '/cvc_cgi/dte/of_confirma_folio',
      ]);
    });

    it(`${ambiente}: corta of_genera_folio, of_genera_archivo y cualquier otra ruta de ${host}`, async () => {
      const real = new TransporteFalso();
      const t = new TransporteSinTimbrar(real, ambiente);
      for (const ruta of [
        '/cvc_cgi/dte/of_genera_folio',
        '/cvc_cgi/dte/of_genera_archivo',
        '/cvc_cgi/dte/of_solicita_folios_dcto/extra',
        '/cvc_cgi/dte/OF_GENERA_FOLIO',
        '/cvc_cgi/dte/',
        '/cvc_cgi/otra/of_solicita_folios',
        '/',
      ]) {
        await expect(envia(t, `https://${host}${ruta}`), ruta).rejects.toBeInstanceOf(
          DetenidoAntesDeTimbrar,
        );
      }
      expect(real.enviadas).toEqual([]);
    });
  }

  it('el login en los hosts de autenticación sigue pasando', async () => {
    const real = new TransporteFalso();
    const t = new TransporteSinTimbrar(real, 'produccion');
    await envia(t, 'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://palena.sii.cl');
    await envia(t, 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html');
    expect(real.enviadas).toHaveLength(2);
  });

  it('reconoce la causa en cualquier nivel', () => {
    const e = new Error('a', { cause: new Error('b', { cause: new DetenidoAntesDeTimbrar() }) });
    expect(detenidoAntesDeTimbrar(e)).toBe(true);
    expect(detenidoAntesDeTimbrar(new Error('x'))).toBe(false);
  });
});

describe('mensajeTraslapeTimbrado', () => {
  it('dice qué se timbró, con qué choca y qué hacer, sin proponer subirlo', () => {
    const m = mensajeTraslapeTimbrado({ desde: 10, hasta: 29 }, { desde: 5, hasta: 30 });
    expect(m).toContain('Se timbraron los folios 10 a 29');
    expect(m).toContain('chocan con el CAF de los folios 5 a 30 que ya estaba cargado');
    expect(m).toContain('No los vuelvas a pedir');
    expect(m).toContain('escríbenos a soporte');
    expect(m).not.toContain('súbelo');
  });
});
