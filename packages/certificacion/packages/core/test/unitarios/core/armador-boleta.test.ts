// Tests de ArmadorBoleta (nuevo en el port, pend. 2.5: el armado de cada DTE
// estaba en bin/certificacion/enviar-set-boletas.php). La paridad byte a byte
// con el bin está en test/paridad/armar-boleta.test.ts y set-completo.test.ts.

import { verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aIso88591 } from '../../../src/comun/codificacion.ts';
import { ErrorTimbre, ErrorValidacion } from '../../../src/comun/errores.ts';
import { instanteSii, type Reloj, relojFijo } from '../../../src/comun/reloj.ts';
import { parsearDocumento } from '../../../src/comun/xml.ts';
import { ArmadorBoleta } from '../../../src/core/armador-boleta.ts';
import { EnvioBoleta } from '../../../src/core/envio-boleta.ts';
import { FirmaElectronica } from '../../../src/core/firma-electronica.ts';
import { type DatosBoleta, GeneradorBoleta } from '../../../src/core/generador-boleta.ts';
import { Timbre } from '../../../src/core/timbre.ts';
import { ultimaFirmaHija, verificarFirma } from '../../paridad/verificar-firma.ts';
import { cafPrueba, partesTed, tedsEn } from '../../soporte/caf.ts';
import { material } from '../../soporte/paridad.ts';

const { llave, certificado } = material('base');
const firmador = new FirmaElectronica(llave, certificado);
const caf = cafPrueba({ desde: 1, hasta: 10 });
const AHORA = '2026-09-05T10:30:00';
const reloj = relojFijo(instanteSii(AHORA));

function datos(cambios: Partial<DatosBoleta> = {}): DatosBoleta {
  return {
    emisor: {
      rut: '76123456-0',
      razonSocial: 'EMPRESA DE PRUEBA SPA',
      giro: 'VENTA AL POR MENOR',
      direccion: 'CALLE 1',
      comuna: 'SANTIAGO',
    },
    receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
    folio: '5',
    detalles: [
      { nombre: 'Cambio de aceite', cantidad: 1, precio: 19900 },
      { nombre: 'Alineacion y balanceo', cantidad: 1, precio: 9900 },
    ],
    referencia: { codigo: 'SET', razon: 'CASO-1' },
    ...cambios,
  };
}

function armar(cambios: Partial<DatosBoleta> = {}, xmlCaf: Uint8Array | string = caf.xml): Buffer {
  return new ArmadorBoleta(firmador, { reloj }).armar(datos(cambios), xmlCaf);
}

function texto(xml: Buffer, etiqueta: string, indice = 0): string {
  const nodo = parsearDocumento(xml).getElementsByTagName(etiqueta).item(indice);
  if (nodo === null) throw new Error(`Sin <${etiqueta}>`);
  return nodo.textContent ?? '';
}

function ted(xml: Buffer): Buffer {
  const [primero, ...otros] = tedsEn(xml);
  if (primero === undefined || otros.length > 0) throw new Error('Se esperaba un TED');
  return primero;
}

/** Reloj que avanza un segundo en cada lectura y cuenta las lecturas. */
function relojQueAvanza(): Reloj & { lecturas: number } {
  let ms = instanteSii(AHORA).getTime();
  const r = {
    lecturas: 0,
    ahora: () => {
      r.lecturas++;
      ms += 1000;
      return new Date(ms);
    },
  };
  return r;
}

describe('ArmadorBoleta', () => {
  it('equivale a componer a mano GeneradorBoleta, Timbre y firmarDte (los pasos del bin)', () => {
    const xml = new GeneradorBoleta({ reloj }).generarBoleta(datos());
    const timbre = new Timbre(caf.xml, { reloj }).generarTed({
      rutEmisor: '76123456-0',
      tipoDte: '39',
      folio: '5',
      fecha: '2026-09-05',
      rutReceptor: '66666666-6',
      razonSocialReceptor: 'Cliente General',
      montoTotal: '29800',
      nombreItem1: 'Cambio de aceite',
    });
    const conTed = xml
      .toString('latin1')
      .replace(
        '</Documento>',
        `${timbre.toString('latin1')}\n<TmstFirma>${AHORA}</TmstFirma>\n</Documento>`,
      );
    const esperado = firmador.firmarDte(Buffer.from(conTed, 'latin1'), '#F5T39');
    expect(armar().equals(esperado)).toBe(true);
  });

  it('el TED y el TmstFirma van justo antes de </Documento>, y la firma al final del DTE', () => {
    const dte = armar().toString('latin1');
    expect(dte).toMatch(
      /<\/Referencia>\n {2}<TED version="1\.0">.*<\/TED>\n<TmstFirma>2026-09-05T10:30:00<\/TmstFirma>\n<\/Documento>\n<Signature /s,
    );
    expect(dte.endsWith('</Signature></DTE>') || dte.endsWith('</Signature>\n</DTE>')).toBe(true);
    expect(dte.endsWith('\n')).toBe(false);
  });

  it('firma el <Documento> con la URI #F{folio}T{tipo} y el TED con la llave del CAF', () => {
    const dte = armar();
    const doc = parsearDocumento(dte);
    const documento = doc.getElementsByTagName('Documento').item(0);
    if (documento === null || doc.documentElement === null) throw new Error('Sin <Documento>');
    const r = verificarFirma(documento, ultimaFirmaHija(doc.documentElement), certificado);
    expect(r.uri).toBe('#F5T39');
    expect(r.digestFirma).toBe(r.digestCalculado);
    expect(r.firmaValida).toBe(true);

    const { dd, firma } = partesTed(ted(dte));
    expect(verify('sha1', dd, caf.llavePublica, firma)).toBe(true);
  });

  it('el TED lleva los datos de la boleta', () => {
    const dd = partesTed(ted(armar())).dd.toString('latin1');
    expect(dd).toContain(
      '<RE>76123456-0</RE><TD>39</TD><F>5</F><FE>2026-09-05</FE><RR>66666666-6</RR>' +
        '<RSR>Cliente General</RSR><MNT>29800</MNT><IT1>Cambio de aceite</IT1><CAF version="1.0">',
    );
    expect(dd).toContain(`<TSTED>${AHORA}</TSTED>`);
  });

  it('el MNT del TED es el <MntTotal> que escribió el generador (con descuento), sin recalcular', () => {
    const dte = armar({ descuento: { tipo: 'porcentaje', valor: 10 } });
    const mntTotal = texto(dte, 'MntTotal');
    expect(mntTotal).toBe('26820');
    expect(texto(dte, 'MNT')).toBe(mntTotal);
  });

  it('el IT1 es el primer <NmbItem> des-escapado: el TED lo escapa una sola vez', () => {
    const dte = armar({
      detalles: [
        { nombre: 'Pan & <Queso> ñandú 😀', cantidad: 1, precio: 1000 },
        { nombre: 'Otro', cantidad: 1, precio: 10 },
      ],
    });
    const dd = partesTed(ted(dte)).dd.toString('latin1');
    expect(dd).toContain('<IT1>Pan &amp; &lt;Queso&gt; ñandú ?</IT1>');
  });

  // Decisión del usuario (2026-11-06): el PHP armaba la boleta con el TED
  // firmado sobre <RSR></RSR> y el DTE con <RSR/> (nunca probado en el SII).
  // GeneradorBoleta la sigue aceptando opcional (paridad).
  describe('razón social del receptor obligatoria', () => {
    const MENSAJE =
      'El receptor debe traer razón social (receptor.razonSocial, p. ej. "Cliente General"): ' +
      'sin ella el TED se firmaría con <RSR> vacío.';

    it.each([
      ['sin razonSocial', { rut: '66666666-6' }],
      ['vacía', { rut: '66666666-6', razonSocial: '' }],
      ['solo espacios', { rut: '66666666-6', razonSocial: '   ' }],
      ['solo tabs y saltos', { rut: '66666666-6', razonSocial: '\t\n\r ' }],
      ['solo NBSP', { rut: '66666666-6', razonSocial: ' ' }],
    ])('%s es un ErrorValidacion', (_, receptor) => {
      expect(() => armar({ receptor })).toThrow(ErrorValidacion);
      expect(() => armar({ receptor })).toThrow(MENSAJE);
    });

    it('null (desde JS) es un ErrorValidacion', () => {
      const receptor = {
        rut: '66666666-6',
        razonSocial: null,
      } as unknown as DatosBoleta['receptor'];
      expect(() => armar({ receptor })).toThrow(MENSAJE);
    });

    it('se valida antes de leer el reloj', () => {
      const avanza = relojQueAvanza();
      expect(() =>
        new ArmadorBoleta(firmador, { reloj: avanza }).armar(
          datos({ receptor: { rut: '66666666-6' } }),
          caf.xml,
        ),
      ).toThrow(ErrorValidacion);
      expect(avanza.lecturas).toBe(0);
    });

    it('una razón social de un carácter, o con blancos alrededor, va tal cual al TED', () => {
      const corta = partesTed(ted(armar({ receptor: { rut: '66666666-6', razonSocial: 'X' } })));
      expect(corta.dd.toString('latin1')).toContain('<RSR>X</RSR>');
      const conBlancos = armar({ receptor: { rut: '66666666-6', razonSocial: ' Juan ' } });
      expect(partesTed(ted(conBlancos)).dd.toString('latin1')).toContain('<RSR> Juan </RSR>');
      expect(texto(conBlancos, 'RznSocRecep')).toBe(' Juan ');
    });

    it('GeneradorBoleta sigue aceptando el receptor sin razón social', () => {
      const xml = new GeneradorBoleta({ reloj }).generarBoleta(
        datos({ receptor: { rut: '66666666-6' } }),
      );
      expect(xml.toString('latin1')).not.toContain('RznSocRecep');
    });
  });

  it('un folio y un tipo numéricos se escriben en decimal', () => {
    const caf41 = cafPrueba({ tipoDte: 41, desde: 1, hasta: 10 });
    const dte = new ArmadorBoleta(firmador, { reloj }).armar(
      datos({
        folio: 7,
        tipoDte: 41,
        detalles: [{ nombre: 'Libro', cantidad: 1, precio: 5000, exento: true }],
      }),
      caf41.xml,
    );
    expect(texto(dte, 'Folio')).toBe('7');
    expect(texto(dte, 'TipoDTE')).toBe('41');
    expect(dte.toString('latin1')).toContain('<Reference URI="#F7T41">');
  });

  it('lee el reloj una sola vez por boleta: todas las marcas coinciden', () => {
    const avanza = relojQueAvanza();
    const armador = new ArmadorBoleta(firmador, { reloj: avanza });
    const primera = armador.armar(datos(), caf.xml);
    expect(avanza.lecturas).toBe(1);
    expect(texto(primera, 'TSTED')).toBe('2026-09-05T10:30:01');
    expect(texto(primera, 'TmstFirma')).toBe('2026-09-05T10:30:01');

    const segunda = armador.armar(datos({ folio: '6' }), caf.xml);
    expect(avanza.lecturas).toBe(2);
    expect(texto(segunda, 'TSTED')).toBe('2026-09-05T10:30:02');
    expect(texto(segunda, 'TmstFirma')).toBe('2026-09-05T10:30:02');
  });

  it('a las 23:59:59 de Chile FchEmis y FE son del mismo día (aunque en UTC ya sea otro)', () => {
    const armador = new ArmadorBoleta(firmador, {
      reloj: relojFijo(instanteSii('2026-09-05T23:59:59')),
    });
    const dte = armador.armar(datos(), caf.xml);
    expect(texto(dte, 'FchEmis')).toBe('2026-09-05');
    expect(texto(dte, 'FE')).toBe('2026-09-05');
    expect(texto(dte, 'TmstFirma')).toBe('2026-09-05T23:59:59');
  });

  it('acepta el CAF como Buffer UTF-8, Buffer ISO-8859-1 o texto, con el mismo resultado', () => {
    const cafTildes = cafPrueba({ razonSocial: 'DÍAZ Y MUÑOZ LTDA' });
    const desdeTexto = armar({}, cafTildes.xml);
    expect(armar({}, Buffer.from(cafTildes.xml, 'utf8')).equals(desdeTexto)).toBe(true);
    expect(armar({}, aIso88591(cafTildes.xml)).equals(desdeTexto)).toBe(true);
  });

  it('usa el reloj del sistema si no se inyecta uno', () => {
    const dte = new ArmadorBoleta(firmador).armar(datos(), caf.xml);
    expect(texto(dte, 'TmstFirma')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(texto(dte, 'TSTED')).toBe(texto(dte, 'TmstFirma'));
    expect(texto(dte, 'FchEmis')).toBe(texto(dte, 'TmstFirma').slice(0, 10));
  });

  it('los DTE van directo a EnvioBoleta.empaquetar', () => {
    const armador = new ArmadorBoleta(firmador, { reloj });
    const dtes = ['1', '2', '3'].map((folio) => armador.armar(datos({ folio }), caf.xml));
    const sobre = new EnvioBoleta(
      firmador,
      { rutEmisor: '76123456-0', rutEnvia: '11111111-1', nroResol: '0', fchResol: '2026-09-04' },
      { reloj },
    ).empaquetar(dtes);
    expect(sobre.toString('latin1')).toContain('<TpoDTE>39</TpoDTE>\n<NroDTE>3</NroDTE>');
    expect(tedsEn(sobre)).toHaveLength(3);
  });

  describe('validación contra el CAF', () => {
    it('un CAF de otro tipo de documento es un ErrorValidacion', () => {
      const caf41 = cafPrueba({ tipoDte: 41 });
      expect(() => armar({}, caf41.xml)).toThrow(ErrorValidacion);
      expect(() => armar({}, caf41.xml)).toThrow(/tipo de documento 41, no del 39/);
    });

    it('un folio fuera del rango del CAF es un ErrorValidacion', () => {
      expect(() => armar({ folio: '11' })).toThrow(/fuera del rango del CAF \(1–10\)/);
      expect(() => armar({ folio: 0 })).toThrow(ErrorValidacion);
      expect(() => armar({ folio: '1' })).not.toThrow();
      expect(() => armar({ folio: '10' })).not.toThrow();
    });

    it('un CAF de otro emisor es un ErrorValidacion', () => {
      const ajeno = cafPrueba({ rut: '11111111-1' });
      expect(() => armar({}, ajeno.xml)).toThrow(/emisor 11111111-1, no de 76123456-0/);
    });

    it('un folio o tipo en texto que no es entero es un ErrorValidacion', () => {
      expect(() => armar({ folio: '5a' })).toThrow(ErrorValidacion);
      expect(() => armar({ folio: ' 5' })).toThrow(ErrorValidacion);
      expect(() => armar({ tipoDte: '39.0' })).toThrow(ErrorValidacion);
    });

    it('un CAF ilegible o sin <DA>/<RNG> es un ErrorTimbre', () => {
      expect(() => armar({}, '<AUTORIZACION><CAF')).toThrow(ErrorTimbre);
      expect(() => armar({}, '<AUTORIZACION/>')).toThrow(/no contiene el nodo <DA>/);
      const sinRango = caf.xml.replace(/<RNG>.*<\/RNG>/, '');
      expect(() => armar({}, sinRango)).toThrow(/<RNG>/);
      const rangoRaro = caf.xml.replace('<D>1</D>', '<D>uno</D>');
      expect(() => armar({}, rangoRaro)).toThrow(ErrorTimbre);
    });

    it('los datos inválidos se rechazan como en GeneradorBoleta', () => {
      expect(() => armar({ detalles: [] })).toThrow(ErrorValidacion);
      expect(() => armar({ emisor: { ...datos().emisor, rut: '76123456-1' } })).toThrow(
        ErrorValidacion,
      );
    });
  });
});
