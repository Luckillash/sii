// Port de tests/Core/TimbreTest.php (winex/certificacion v1.9.1, Apache-2.0),
// más los casos propios del port (hora inyectada, Buffer/string, errores tipados).

import { verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aIso88591, desdeIso88591, esUtf8Valido } from '../../../src/comun/codificacion.ts';
import { ErrorTimbre, ErrorValidacion } from '../../../src/comun/errores.ts';
import { instanteSii, relojFijo } from '../../../src/comun/reloj.ts';
import { type DatosTed, Timbre } from '../../../src/core/timbre.ts';
import { cafPrueba, llavePublicaRsapk, partesTed } from '../../soporte/caf.ts';

const caf = cafPrueba();
const reloj = relojFijo(instanteSii('2026-09-05T10:30:00'));

function datos(cambios: Partial<DatosTed> = {}): DatosTed {
  return {
    rutEmisor: '76123456-0',
    tipoDte: '39',
    folio: '5',
    fecha: '2026-09-05',
    rutReceptor: '66666666-6',
    razonSocialReceptor: 'Cliente General',
    montoTotal: '1190',
    nombreItem1: 'Producto de prueba',
    ...cambios,
  };
}

function ted(cambios: Partial<DatosTed> = {}, xmlCaf: Uint8Array | string = caf.xml): Buffer {
  return new Timbre(xmlCaf, { reloj }).generarTed(datos(cambios));
}

function verifica(dd: Buffer, firma: Buffer): boolean {
  return verify('sha1', dd, caf.llavePublica, firma);
}

describe('Timbre', () => {
  it('la firma del TED es verificable con la clave pública del CAF', () => {
    const { dd, firma } = partesTed(ted());
    expect(verifica(dd, firma)).toBe(true);
    expect(verify('sha1', dd, llavePublicaRsapk(caf.xml), firma)).toBe(true);
  });

  it('alterar un dato invalida la firma', () => {
    const { dd, firma } = partesTed(ted());
    const alterado = Buffer.from(
      dd.toString('latin1').replace('<MNT>1190</MNT>', '<MNT>1</MNT>'),
      'latin1',
    );
    expect(alterado.equals(dd)).toBe(false);
    expect(verifica(alterado, firma)).toBe(false);
  });

  it('el DD no lleva blancos entre etiquetas', () => {
    // Regresión del reparo 510: el SII aplana los blancos antes de verificar.
    const { dd } = partesTed(ted());
    expect(dd.toString('latin1')).not.toMatch(/>\s+</);
  });

  it('el DD trae los datos del documento y el CAF', () => {
    const dd = partesTed(ted()).dd.toString('latin1');
    for (const fragmento of [
      '<RE>76123456-0</RE>',
      '<TD>39</TD>',
      '<F>5</F>',
      '<FE>2026-09-05</FE>',
      '<RR>66666666-6</RR>',
      '<MNT>1190</MNT>',
      '<IT1>Producto de prueba</IT1>',
      '<CAF version="1.0">',
    ]) {
      expect(dd).toContain(fragmento);
    }
    expect(dd).toMatch(/<TSTED>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}<\/TSTED>/);
  });

  it('el TSTED sale del reloj inyectado, en hora de Chile', () => {
    expect(partesTed(ted()).dd.toString('latin1')).toContain('<TSTED>2026-09-05T10:30:00</TSTED>');
  });

  it('sin reloj usa la hora del sistema', () => {
    const dd = partesTed(new Timbre(caf.xml).generarTed(datos())).dd.toString('latin1');
    expect(dd).toMatch(/<TSTED>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}<\/TSTED>/);
  });

  it('el primer ítem se trunca a 40 caracteres', () => {
    const dd = partesTed(ted({ nombreItem1: 'x'.repeat(60) })).dd.toString('latin1');
    expect(dd).toContain(`<IT1>${'x'.repeat(40)}</IT1>`);
  });

  it('el truncado cuenta code points, no unidades UTF-16 ni bytes', () => {
    const dd = partesTed(ted({ nombreItem1: `${'ñ'.repeat(38)}😀😀😀` })).dd;
    // 38 ñ + 2 emoji = 40 code points; cada emoji pasa a un solo "?".
    expect(dd.toString('latin1')).toContain(`<IT1>${'ñ'.repeat(38)}??</IT1>`);
  });

  it('los caracteres especiales se escapan (sin tocar las comillas)', () => {
    const dd = partesTed(ted({ razonSocialReceptor: `Pan & Vino <SA> "Hnos" 'Ltda'` })).dd;
    expect(dd.toString('latin1')).toContain(`<RSR>Pan &amp; Vino &lt;SA&gt; "Hnos" 'Ltda'</RSR>`);
  });

  it('el TED se firma sobre los bytes ISO-8859-1', () => {
    // Regresión del rechazo RFR con razones sociales con tilde.
    const { dd, firma } = partesTed(ted({ razonSocialReceptor: 'Muñoz Díaz' }));
    expect(verifica(dd, firma)).toBe(true);
    expect(dd.includes(Buffer.from('Mu\xF1oz D\xEDaz', 'latin1'))).toBe(true);
    expect(esUtf8Valido(dd)).toBe(false);
  });

  it('los caracteres fuera de ISO-8859-1 pasan a "?"', () => {
    const dd = partesTed(ted({ razonSocialReceptor: 'Señor € 😀' })).dd.toString('latin1');
    expect(dd).toContain('<RSR>Se\xF1or ? ?</RSR>');
  });

  it('acepta un CAF con tildes en ISO-8859-1 sin declarar', () => {
    const iso = aIso88591(cafPrueba({ razonSocial: 'DÍAZ Y MUÑOZ LTDA' }).xml);
    expect(esUtf8Valido(iso)).toBe(false);
    const { dd, firma } = partesTed(ted({}, iso));
    expect(verifica(dd, firma)).toBe(true);
    expect(dd.toString('latin1')).toContain('<RS>DÍAZ Y MUÑOZ LTDA</RS>');
  });

  it('un CAF en Buffer UTF-8 y el mismo como string dan el mismo TED', () => {
    const tildes = cafPrueba({ razonSocial: 'DÍAZ Y MUÑOZ LTDA' }).xml;
    expect(ted({}, Buffer.from(tildes, 'utf8')).equals(ted({}, tildes))).toBe(true);
    expect(ted({}, aIso88591(tildes)).equals(ted({}, tildes))).toBe(true);
  });

  it('el bloque <CAF> se aplana, pero los blancos dentro del texto se conservan', () => {
    const sangrado = caf.xml
      .replaceAll('\n', '\r\n\t')
      .replace('<RS>EMPRESA DE PRUEBA SPA</RS>', '<RS>  EMPRESA DE PRUEBA  </RS>');
    const dd = partesTed(ted({}, sangrado)).dd.toString('latin1');
    expect(dd).toContain(
      '<CAF version="1.0"><DA><RE>76123456-0</RE><RS>  EMPRESA DE PRUEBA  </RS>',
    );
  });

  it('solo los blancos ASCII de \\s (con VT y FF) se aplanan; NBSP y U+0085 no', () => {
    const dd = partesTed(
      ted({ razonSocialReceptor: ' \t\v\f\r\n ', nombreItem1: ' \u0085' }),
    ).dd.toString('latin1');
    expect(dd).toContain('<RSR></RSR>');
    expect(dd).toContain('<IT1> \u0085</IT1>');
  });

  it('los campos numéricos se escriben en decimal', () => {
    const dd = partesTed(ted({ tipoDte: 41, folio: 7, montoTotal: 1190 })).dd.toString('latin1');
    expect(dd).toContain('<TD>41</TD><F>7</F>');
    expect(dd).toContain('<MNT>1190</MNT>');
  });

  it('rechaza números que no son enteros seguros', () => {
    expect(() => ted({ montoTotal: 1190.5 })).toThrow(ErrorValidacion);
    expect(() => ted({ folio: Number.NaN })).toThrow(ErrorValidacion);
    expect(() => ted({ folio: 2 ** 60 })).toThrow(ErrorValidacion);
  });

  it('el texto equivalente vuelve a los mismos bytes', () => {
    const bytes = ted({ razonSocialReceptor: 'Muñoz € Díaz' });
    expect(aIso88591(desdeIso88591(bytes)).equals(bytes)).toBe(true);
  });

  it('sirve con una llave de 2048 bits y exponente 65537', () => {
    const grande = cafPrueba({ bits: 2048, exponente: 65537 });
    const { dd, firma } = partesTed(new Timbre(grande.xml, { reloj }).generarTed(datos()));
    expect(verify('sha1', dd, grande.llavePublica, firma)).toBe(true);
  });

  describe('errores', () => {
    it('CAF sin nodo <CAF>', () => {
      expect(() => new Timbre('<AUTORIZACION><RSASK>x</RSASK></AUTORIZACION>')).toThrow(
        new ErrorTimbre('El XML no contiene el nodo <CAF>.'),
      );
    });

    it('CAF sin llave privada', () => {
      expect(
        () => new Timbre('<AUTORIZACION><CAF version="1.0"><DA/></CAF></AUTORIZACION>'),
      ).toThrow(/RSASK/);
      expect(
        () => new Timbre('<AUTORIZACION><CAF version="1.0"><DA/></CAF></AUTORIZACION>'),
      ).toThrow(ErrorTimbre);
    });

    it('XML mal formado', () => {
      expect(
        () => new Timbre('<AUTORIZACION><CAF version="1.0"></CAF><RSASK>x</AUTORIZACION>'),
      ).toThrow(new ErrorTimbre('El CAF no es un XML válido.'));
    });

    it('llave ilegible: falla al construir, no al timbrar', () => {
      const roto = caf.xml.replace(/<RSASK>[\s\S]*<\/RSASK>/, '<RSASK>no-es-una-llave</RSASK>');
      expect(() => new Timbre(roto)).toThrow(ErrorTimbre);
      expect(() => new Timbre(roto)).toThrow(/RSASK/);
    });

    it('los mensajes no incluyen la llave', () => {
      const roto = caf.xml.replace(/(-----BEGIN RSA PRIVATE KEY-----\n).{12}/, '$1AAAAAAAAAAAA');
      try {
        new Timbre(roto);
        expect.unreachable('debía fallar');
      } catch (error) {
        expect(error).toBeInstanceOf(ErrorTimbre);
        expect((error as Error).message).not.toMatch(/MII|BEGIN/);
      }
    });
  });
});
