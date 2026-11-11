// `sii certificacion solicitar-folios`: revisión sin timbrar (por defecto) y solicitud
// con --confirmar, con las páginas sintéticas del asistente (paridad/folios/paginas).
// Siempre contra el TransporteFalso.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { cafPrueba } from '../../../../../packages/core/test/soporte/caf.ts';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto, RUT_EMPRESA } from '../../soporte/cli.ts';
import { hacia, paginaFolios } from './soporte-envio.ts';

type Respuesta = Buffer | string | RespuestaHttp;

/** Responde en orden, sin mirar la URL (como el test de SolicitudFolios del core). */
function secuencia(respuestas: Respuesta[]): TransporteFalso {
  const pendientes = [...respuestas];
  return new TransporteFalso([
    ['*', () => pendientes.shift() ?? new RespuestaHttp(500, {}, 'sin respuesta configurada')],
  ]);
}

const CAF = cafPrueba({ rut: RUT_EMPRESA, desde: 101, hasta: 105 }).xml;

const flujo = (caf: Respuesta = CAF): Respuesta[] => [
  paginaFolios('login-ok'),
  paginaFolios('paso1-rut'),
  paginaFolios('paso2-cantidad'),
  paginaFolios('paso3-confirma'),
  paginaFolios('paso4-genera'),
  caf,
];

describe('solicitar-folios', () => {
  it('sin --confirmar recorre el asistente y no envía la orden de timbrar', async () => {
    const p = proyecto();
    const transporte = secuencia(flujo());
    const r = await correr(p, ['certificacion', 'solicitar-folios'], { transporte });

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('asignaría los folios 101 a 105');
    expect(r.stdout).toContain('--tipo 39 --cantidad 5 --confirmar');
    expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(0);
    expect(hacia(transporte.enviadas, 'of_genera_archivo')).toHaveLength(0);

    const [login] = transporte.enviadas;
    expect(login?.url).toContain('herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi');
    expect(login?.tls).toBe(true);
    expect(
      transporte.enviadas.slice(1).every((x) => x.url.startsWith('https://maullin.sii.cl/')),
    ).toBe(true);
    // Tipo y cantidad por defecto.
    const cuerpos = transporte.enviadas.map((x) => x.bytes?.toString('latin1') ?? '').join('&');
    expect(cuerpos).toContain('COD_DOCTO=39');
    expect(cuerpos).toContain('CANT_DOCTOS=5');
    // No escribe nada.
    expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
  });

  it('con --confirmar timbra, guarda el CAF y sugiere el .env', async () => {
    const p = proyecto();
    const transporte = secuencia(flujo());
    const r = await correr(
      p,
      ['certificacion', 'solicitar-folios', '--tipo', '39', '--cantidad', '5', '--confirmar'],
      { transporte },
    );

    expect(r.codigo).toBe(CODIGOS.OK);
    expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(1);
    const ruta = join(p.dir, 'data', 'caf', 'caf-39-101-105.xml');
    expect(readFileSync(ruta, 'utf8')).toBe(CAF);
    expect(r.stdout).toContain('folios 101 a 105');
    expect(r.stdout).toContain('SII_CAF_39=data/caf/caf-39-101-105.xml');
    expect(r.stdout).toContain('SII_FOLIO_INICIAL=101');
    // Nunca el contenido del CAF ni cookies.
    expect(r.stdout).not.toContain('RSASK');
    expect(r.stdout).not.toContain('TOKENDEPRUEBA');
  });

  it('--salida elige la carpeta del CAF', async () => {
    const p = proyecto();
    const r = await correr(
      p,
      ['certificacion', 'solicitar-folios', '--confirmar', '--salida', 'cafs'],
      { transporte: secuencia(flujo()) },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(existsSync(join(p.dir, 'cafs', 'caf-39-101-105.xml'))).toBe(true);
  });

  it('timbrado sin CAF: código 6 con el mensaje completo', async () => {
    const p = proyecto();
    const transporte = secuencia(flujo(new RespuestaHttp(500, {}, 'error')));
    const r = await correr(p, ['certificacion', 'solicitar-folios', '--confirmar'], { transporte });

    expect(r.codigo).toBe(CODIGOS.INCIERTO);
    expect(r.stderr).toContain('FoliosSinCafError');
    expect(r.stderr).toContain('folios 101 al 105');
    expect(r.stderr).toContain('Folios ya autorizados');
    expect(r.stderr).toContain('no los vuelvas a pedir sin revisar');
    expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
  });

  it('el SII no acepta el certificado: código 5 y no se recorre el asistente', async () => {
    const transporte = secuencia([paginaFolios('login-rechazado')]);
    const r = await correr(proyecto(), ['certificacion', 'solicitar-folios'], { transporte });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(transporte.enviadas).toHaveLength(1);
  });

  describe('--ambiente produccion (palena, folios reales)', () => {
    /**
     * Las mismas páginas sintéticas con palena en vez de maullin (los `action` son
     * relativos; solo cambia la redirección del login, que el flujo no sigue).
     */
    const enPalena = (pagina: Buffer): Buffer =>
      Buffer.from(
        pagina.toString('latin1').replaceAll('maullin.sii.cl', 'palena.sii.cl'),
        'latin1',
      );
    /** CAF de producción: IDK 300. */
    const CAF_PRODUCCION = CAF.replace('<IDK>100</IDK>', '<IDK>300</IDK>');
    const flujoPalena = (caf: Respuesta = CAF_PRODUCCION): Respuesta[] => [
      ...flujo(caf)
        .slice(0, 5)
        .map((x) => enPalena(x as Buffer)),
      caf,
    ];
    const PROD = ['certificacion', 'solicitar-folios', '--ambiente', 'produccion'];

    it('exige --cantidad y no envía nada sin ella', async () => {
      const r = await correr(proyecto(), PROD);
      expect(r.codigo).toBe(CODIGOS.USO);
      expect(r.stderr).toContain('--cantidad');
      expect(r.transporte.enviadas).toHaveLength(0);
    });

    it('sin --confirmar recorre el asistente de palena y no timbra', async () => {
      const p = proyecto();
      const transporte = secuencia(flujoPalena());
      const r = await correr(p, [...PROD, '--cantidad', '5'], { transporte });

      expect(r.codigo).toBe(CODIGOS.OK);
      expect(r.stdout).toContain('PRODUCCIÓN (palena)');
      expect(r.stdout).toContain('asignaría los folios 101 a 105');
      expect(r.stdout).toContain('--ambiente produccion --tipo 39 --cantidad 5 --confirmar');
      expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(0);
      expect(transporte.enviadas[0]?.url).toContain('herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi');
      expect(
        transporte.enviadas.slice(1).every((x) => x.url.startsWith('https://palena.sii.cl/')),
      ).toBe(true);
      expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
    });

    it('con --confirmar guarda el CAF con otro nombre y sugiere SII_PRODUCCION_CAF_39', async () => {
      const p = proyecto();
      const transporte = secuencia(flujoPalena());
      const r = await correr(p, [...PROD, '--cantidad', '5', '--confirmar'], { transporte });

      expect(r.codigo).toBe(CODIGOS.OK);
      expect(r.stdout).toContain('FOLIOS REALES');
      expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(1);
      const ruta = join(p.dir, 'data', 'caf', 'caf-produccion-39-101-105.xml');
      expect(readFileSync(ruta, 'utf8')).toBe(CAF_PRODUCCION);
      expect(r.stdout).toContain('SII_PRODUCCION_CAF_39=data/caf/caf-produccion-39-101-105.xml');
      expect(r.stdout).not.toContain('SII_CAF_39=');
      expect(r.stdout).not.toContain('RSASK');
    });

    it('una orden de timbrar que apunta a maullin no sale', async () => {
      const p = proyecto();
      const pasos = flujoPalena();
      const confirma = (pasos[3] as Buffer)
        .toString('latin1')
        .replace(
          'ACTION="of_genera_folio"',
          'ACTION="https://maullin.sii.cl/cvc_cgi/dte/of_genera_folio"',
        );
      pasos[3] = Buffer.from(confirma, 'latin1');
      const transporte = secuencia(pasos);
      const r = await correr(p, [...PROD, '--cantidad', '5', '--confirmar'], { transporte });

      expect(r.codigo).not.toBe(CODIGOS.OK);
      expect(r.stderr).toContain('fuera del ambiente de produccion');
      expect(transporte.enviadas.some((x) => x.url.includes('maullin.sii.cl'))).toBe(false);
      expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(0);
      expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
    });

    it('un CAF de certificación (IDK 100) no se guarda: código 6', async () => {
      const p = proyecto();
      const transporte = secuencia(flujoPalena(CAF));
      const r = await correr(p, [...PROD, '--cantidad', '5', '--confirmar'], { transporte });

      expect(r.codigo).toBe(CODIGOS.INCIERTO);
      expect(r.stderr).toContain('IDK 100');
      expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
    });

    describe('primer timbraje: el SII pide el folio inicial', () => {
      // Como la página real de palena (2026-11-10), sin datos de la empresa.
      const FOLIO_INICIAL = Buffer.from(
        `<HTML><BODY>
<FORM NAME="form1" METHOD="POST" ACTION="/cvc_cgi/dte/of_confirma_folio">
Ingrese Folio Inicial <input name="FOLIO_INICIAL" type="text" value=1 size=8 maxlength=8>
No registra timbraje anterior.
<input name="RUT_EMP" type="hidden" value="76123456">
<input name="DV_EMP" type="hidden" value="0">
<input name="COD_DOCTO" type="hidden" value="39">
<input name="CANT_DOCTOS" type="hidden" value="5">
<input name="ACEPTAR" type="submit" value="Confirmar Folio Inicial">
</FORM></BODY></HTML>`,
        'latin1',
      );
      const conFolioInicial = (): Respuesta[] => {
        const pasos = flujoPalena();
        pasos.splice(3, 0, FOLIO_INICIAL);
        return pasos;
      };

      it('sin --folio-inicial se detiene con código 3 y dice cómo seguir', async () => {
        const p = proyecto();
        const transporte = secuencia(conFolioInicial());
        const r = await correr(p, [...PROD, '--cantidad', '5', '--confirmar'], { transporte });

        expect(r.codigo).toBe(CODIGOS.CONFIG);
        expect(r.stderr).toContain('primer timbraje');
        expect(r.stderr).toContain(
          '--ambiente produccion --tipo 39 --cantidad 5 --folio-inicial 1 --confirmar',
        );
        expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(0);
        // La página del folio inicial no se envió.
        expect(hacia(transporte.enviadas, 'of_confirma_folio')).toHaveLength(1);
        expect(readdirSync(join(p.dir, 'data', 'caf'))).toEqual(['caf-39.xml']);
      });

      it('con --folio-inicial la revisión llega a la confirmación sin timbrar', async () => {
        const transporte = secuencia(conFolioInicial());
        const r = await correr(proyecto(), [...PROD, '--cantidad', '5', '--folio-inicial', '1'], {
          transporte,
        });

        expect(r.codigo).toBe(CODIGOS.OK);
        expect(r.stdout).toContain('asignaría los folios 101 a 105');
        expect(r.stdout).toContain('--cantidad 5 --folio-inicial 1 --confirmar');
        expect(hacia(transporte.enviadas, 'of_genera_folio')).toHaveLength(0);
        const pagina = hacia(transporte.enviadas, 'of_confirma_folio')[1];
        const cuerpo = pagina?.bytes?.toString('latin1') ?? '';
        expect(cuerpo).toContain('FOLIO_INICIAL=1');
        expect(cuerpo).toContain('ACEPTAR=Confirmar+Folio+Inicial');
      });

      it('--folio-inicial inválido no envía nada', async () => {
        const r = await correr(proyecto(), [...PROD, '--cantidad', '5', '--folio-inicial', 'uno']);
        expect(r.codigo).toBe(CODIGOS.USO);
        expect(r.transporte.enviadas).toHaveLength(0);
      });
    });
  });

  it('errores de uso y de configuración no envían nada', async () => {
    const p = proyecto();
    for (const args of [
      ['--cantidad', '0'],
      ['--tipo', 'boleta'],
      ['--confirmar', 'si'],
    ]) {
      const r = await correr(p, ['certificacion', 'solicitar-folios', ...args]);
      expect(r.codigo, args.join(' ')).toBe(CODIGOS.USO);
      expect(r.transporte.enviadas).toHaveLength(0);
    }
    p.escribirEnv({ SII_RUT_EMPRESA: '76123456-1' });
    const r = await correr(p, ['certificacion', 'solicitar-folios']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_RUT_EMPRESA: no es un RUT válido');
    expect(r.transporte.enviadas).toHaveLength(0);
  });
});
