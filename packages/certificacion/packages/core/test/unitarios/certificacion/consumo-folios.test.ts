// Port de tests/Certificacion/GeneradorConsumoFoliosTest.php (winex/certificacion
// v1.9.1) más los casos propios del port (entradas tipadas, validación, reloj).

import { describe, expect, it } from 'vitest';
import {
  type CaratulaRcof,
  GeneradorConsumoFolios,
  type ResumenRcof,
} from '../../../src/certificacion/consumo-folios.ts';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import { instanteSii, relojFijo } from '../../../src/comun/reloj.ts';
import { parsearDocumento } from '../../../src/comun/xml.ts';

const SII = 'http://www.sii.cl/SiiDte';

const CARATULA: CaratulaRcof = {
  rutEmisor: '76123456-0',
  rutEnvia: '12345678-5',
  fchResol: '2026-09-04',
  nroResol: '0',
  fchInicio: '2026-09-05',
  fchFinal: '2026-09-05',
  secEnvio: 1,
};

const RESUMEN: ResumenRcof = {
  tipo: '39',
  neto: 10000,
  iva: 1900,
  tasaIva: '19.00',
  exento: 0,
  total: 11900,
  foliosEmitidos: 5,
  foliosAnulados: 0,
  foliosUtilizados: 5,
  rangosUtilizados: [{ inicial: 56, final: 60 }],
  rangosAnulados: [],
};

const reloj = relojFijo(instanteSii('2026-09-05T23:10:42'));

function generar(resumen: Partial<ResumenRcof> = {}, caratula: Partial<CaratulaRcof> = {}): Buffer {
  return new GeneradorConsumoFolios({ reloj }).generar({ ...CARATULA, ...caratula }, [
    { ...RESUMEN, ...resumen },
  ]);
}

/** Texto del primer elemento que sigue la ruta de nombres locales (como `//a/b` en XPath). */
function valor(xml: Buffer, ...ruta: string[]): string | null {
  let nodos = elementos(parsearDocumento(xml), ruta[0] ?? '');
  for (const nombre of ruta.slice(1)) {
    nodos = nodos.flatMap((n) => hijos(n, nombre));
  }
  return nodos[0]?.textContent ?? null;
}

function hijos(padre: Element, nombre?: string): Element[] {
  const lista: Element[] = [];
  for (let n = padre.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && (nombre === undefined || (n as Element).localName === nombre)) {
      lista.push(n as Element);
    }
  }
  return lista;
}

describe('GeneradorConsumoFolios', () => {
  it('estructura y carátula (test_estructura_y_caratula)', () => {
    const xml = generar();
    const doc = parsearDocumento(xml);
    expect(doc.documentElement?.localName).toBe('ConsumoFolios');
    expect(elementos(doc, 'DocumentoConsumoFolios')[0]?.getAttribute('ID')).toBe('RCOF');
    expect(valor(xml, 'Caratula', 'RutEmisor')).toBe('76123456-0');
    expect(valor(xml, 'Caratula', 'RutEnvia')).toBe('12345678-5');
    expect(valor(xml, 'Caratula', 'FchResol')).toBe('2026-09-04');
    expect(valor(xml, 'Caratula', 'SecEnvio')).toBe('1');
    expect(valor(xml, 'Caratula', 'TmstFirmaEnv')).toBe('2026-09-05T23:10:42');
  });

  it('resumen con montos y rango (test_resumen_con_montos_y_rango)', () => {
    const xml = generar();
    expect(valor(xml, 'Resumen', 'TipoDocumento')).toBe('39');
    expect(valor(xml, 'Resumen', 'MntNeto')).toBe('10000');
    expect(valor(xml, 'Resumen', 'MntIva')).toBe('1900');
    expect(valor(xml, 'Resumen', 'TasaIVA')).toBe('19.00');
    expect(valor(xml, 'Resumen', 'MntTotal')).toBe('11900');
    expect(valor(xml, 'RangoUtilizados', 'Inicial')).toBe('56');
    expect(valor(xml, 'RangoUtilizados', 'Final')).toBe('60');
  });

  it('omite neto, IVA y exento en cero (test_omite_neto_iva_y_exento_en_cero)', () => {
    const xml = generar({ neto: 0, iva: 0, exento: 0, total: 0 });
    expect(valor(xml, 'Resumen', 'MntNeto')).toBeNull();
    expect(valor(xml, 'Resumen', 'MntIva')).toBeNull();
    expect(valor(xml, 'Resumen', 'TasaIVA')).toBeNull();
    expect(valor(xml, 'Resumen', 'MntExento')).toBeNull();
    expect(valor(xml, 'Resumen', 'MntTotal')).toBe('0');
  });

  it('informa el monto exento (test_informa_el_monto_exento)', () => {
    expect(valor(generar({ exento: 2000, total: 13900 }), 'Resumen', 'MntExento')).toBe('2000');
  });

  it('rangos anulados (test_rangos_anulados)', () => {
    const xml = generar({ foliosAnulados: 1, rangosAnulados: [{ inicial: 58, final: 58 }] });
    expect(valor(xml, 'RangoAnulados', 'Inicial')).toBe('58');
  });

  it('el orden de los elementos del resumen respeta el esquema (test_el_orden_...)', () => {
    const xml = generar({ exento: 2000, total: 13900 });
    const resumen = elementos(parsearDocumento(xml), 'Resumen')[0];
    if (resumen === undefined) throw new Error('Sin <Resumen>');
    expect(hijos(resumen).map((n) => n.localName)).toEqual([
      'TipoDocumento',
      'MntNeto',
      'MntIva',
      'TasaIVA',
      'MntExento',
      'MntTotal',
      'FoliosEmitidos',
      'FoliosAnulados',
      'FoliosUtilizados',
      'RangoUtilizados',
    ]);
  });

  it('un Resumen por elemento, en orden, y los rangos utilizados antes que los anulados', () => {
    const xml = new GeneradorConsumoFolios({ reloj }).generar(CARATULA, [
      {
        ...RESUMEN,
        rangosUtilizados: [
          { inicial: 1, final: 3 },
          { inicial: 7, final: 9 },
        ],
        rangosAnulados: [{ inicial: 4, final: 6 }],
      },
      { ...RESUMEN, tipo: 41, neto: 0, iva: 0, exento: 500, total: 500 },
    ]);
    const resumenes = elementos(parsearDocumento(xml), 'Resumen');
    expect(resumenes.map((r) => hijo(r, 'TipoDocumento'))).toEqual(['39', '41']);
    const primero = resumenes[0];
    if (primero === undefined) throw new Error('Sin <Resumen>');
    expect(
      hijos(primero)
        .filter((n) => n.localName.startsWith('Rango'))
        .map((n) => `${n.localName}:${hijo(n, 'Inicial')}-${hijo(n, 'Final')}`),
    ).toEqual(['RangoUtilizados:1-3', 'RangoUtilizados:7-9', 'RangoAnulados:4-6']);
  });

  it('TasaIVA va tal cual y por defecto es 19.00', () => {
    expect(valor(generar({ tasaIva: '19' }), 'Resumen', 'TasaIVA')).toBe('19');
    const { tasaIva: _omitida, ...sinTasa } = RESUMEN;
    const xml = new GeneradorConsumoFolios({ reloj }).generar(CARATULA, [sinTasa]);
    expect(valor(xml, 'Resumen', 'TasaIVA')).toBe('19.00');
  });

  it('los textos pasan por createElement sin escapar (se interpretan las referencias)', () => {
    const xml = generar({}, { rutEnvia: '1&amp;2' });
    expect(valor(xml, 'Caratula', 'RutEnvia')).toBe('1&2');
  });

  it('sale en ISO-8859-1, formateado y con salto de línea final', () => {
    const texto = generar().toString('latin1');
    expect(texto.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>\n<ConsumoFolios ')).toBe(
      true,
    );
    expect(texto).toContain(
      '\n  <DocumentoConsumoFolios ID="RCOF">\n    <Caratula version="1.0">\n',
    );
    expect(texto.endsWith('</ConsumoFolios>\n')).toBe(true);
  });

  it.each([
    ['neto', { neto: -1 }],
    ['total', { total: 1.5 }],
    ['foliosEmitidos', { foliosEmitidos: Number.NaN }],
    ['inicial', { rangosUtilizados: [{ inicial: -3, final: 5 }] }],
    ['final', { rangosAnulados: [{ inicial: 3, final: 2 ** 60 }] }],
  ] as const)('rechaza %s que no es un entero no negativo', (campo, resumen) => {
    expect(() => generar(resumen)).toThrow(ErrorValidacion);
    expect(() => generar(resumen)).toThrow(campo);
  });

  it('rechaza secEnvio que no es un entero no negativo', () => {
    expect(() => generar({}, { secEnvio: 0.5 })).toThrow(ErrorValidacion);
  });

  it('usa el reloj del sistema si no se inyecta uno', () => {
    const xml = new GeneradorConsumoFolios().generar(CARATULA, [RESUMEN]);
    expect(valor(xml, 'Caratula', 'TmstFirmaEnv')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

function hijo(padre: Element, nombre: string): string | null {
  return hijos(padre, nombre)[0]?.textContent ?? null;
}

/** Elementos `<nombre>` del namespace del SII, en orden de documento. */
function elementos(doc: Document, nombre: string): Element[] {
  const lista: Element[] = [];
  const recorrer = (n: Node) => {
    for (let h = n.firstChild; h !== null; h = h.nextSibling) {
      if (h.nodeType !== 1) continue;
      const el = h as Element;
      if (el.localName === nombre && el.namespaceURI === SII) lista.push(el);
      recorrer(el);
    }
  };
  recorrer(doc);
  return lista;
}
