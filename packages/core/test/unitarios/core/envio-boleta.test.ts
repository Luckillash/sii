// Port de tests/Core/EnvioBoletaTest.php (winex/certificacion v1.9.1) más los
// casos propios del port (formas de entrada, reloj, errores tipados).

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { c14n, elementoPorEtiqueta } from '../../../src/comun/c14n.ts';
import { aIso88591 } from '../../../src/comun/codificacion.ts';
import { ErrorFirma, ErrorValidacion } from '../../../src/comun/errores.ts';
import { instanteSii, relojFijo } from '../../../src/comun/reloj.ts';
import { parsearDocumento } from '../../../src/comun/xml.ts';
import { type DatosEnvioBoleta, EnvioBoleta } from '../../../src/core/envio-boleta.ts';
import { FirmaElectronica } from '../../../src/core/firma-electronica.ts';
import { material } from '../../soporte/paridad.ts';

const SII = 'http://www.sii.cl/SiiDte';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

const { llave, certificado } = material('base');
const firmador = new FirmaElectronica(llave, certificado);
const DATOS: DatosEnvioBoleta = {
  rutEmisor: '76123456-0',
  rutEnvia: '12345678-5',
  nroResol: '0',
  fchResol: '2026-09-04',
};
const reloj = relojFijo(instanteSii('2026-09-05T10:31:15'));

/** DTE firmado como los que arma GeneradorBoleta (formateado, ISO-8859-1). */
function dte(folio: string, tipo = '39', razonSocial = 'EMPRESA SPA'): Buffer {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE xmlns="${SII}" version="1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Documento ID="F${folio}T${tipo}">
    <Encabezado>
      <IdDoc>
        <TipoDTE>${tipo}</TipoDTE>
        <Folio>${folio}</Folio>
      </IdDoc>
      <Emisor>
        <RUTEmisor>76123456-0</RUTEmisor>
        <RznSocEmisor>${razonSocial}</RznSocEmisor>
      </Emisor>
    </Encabezado>
  </Documento>
</DTE>
`;
  return firmador.firmarDte(aIso88591(xml), `#F${folio}T${tipo}`);
}

function empaquetar(
  dtes: Parameters<EnvioBoleta['empaquetar']>[0],
  datos: DatosEnvioBoleta = DATOS,
): Buffer {
  return new EnvioBoleta(firmador, datos, { reloj }).empaquetar(dtes);
}

function hijos(padre: Element, nombre: string): Element[] {
  const lista: Element[] = [];
  for (let n = padre.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === nombre) lista.push(n as Element);
  }
  return lista;
}

function hijo(padre: Element, nombre: string): Element {
  const el = hijos(padre, nombre)[0];
  if (el === undefined) throw new Error(`No se encontró <${nombre}>`);
  return el;
}

function caratula(sobre: Buffer): Element {
  const el = elementoPorEtiqueta(parsearDocumento(sobre), 'Caratula');
  if (el === undefined) throw new Error('Sin <Caratula>');
  return el;
}

function setDte(sobre: Buffer): Element {
  const el = elementoPorEtiqueta(parsearDocumento(sobre), 'SetDTE');
  if (el === undefined) throw new Error('Sin <SetDTE>');
  return el;
}

describe('EnvioBoleta', () => {
  it('carátula (test_caratula)', () => {
    const sobre = empaquetar(dte('56'));
    const doc = parsearDocumento(sobre);
    expect(doc.documentElement?.localName).toBe('EnvioBOLETA');
    expect(doc.documentElement?.namespaceURI).toBe(SII);

    const c = caratula(sobre);
    expect(hijo(c, 'RutEmisor').textContent).toBe('76123456-0');
    expect(hijo(c, 'RutEnvia').textContent).toBe('12345678-5');
    expect(hijo(c, 'RutReceptor').textContent).toBe('60803000-K');
    expect(hijo(c, 'FchResol').textContent).toBe('2026-09-04');
    expect(hijo(c, 'NroResol').textContent).toBe('0');
    expect(hijo(c, 'TmstFirmaEnv').textContent).toBe('2026-09-05T10:31:15');
  });

  it('cuenta los documentos por tipo (test_cuenta_los_documentos_por_tipo)', () => {
    const sobre = empaquetar(Buffer.concat([dte('1'), dte('2'), dte('3', '41')]));
    const sub = hijos(caratula(sobre), 'SubTotDTE').map((n) => [
      hijo(n, 'TpoDTE').textContent,
      Number(hijo(n, 'NroDTE').textContent),
    ]);
    expect(sub).toEqual([
      ['39', 2],
      ['41', 1],
    ]);
    expect(hijos(setDte(sobre), 'DTE')).toHaveLength(3);
  });

  it('los SubTotDTE van en el orden de primera aparición, no en orden numérico', () => {
    const sobre = empaquetar([dte('1', '41'), dte('2'), dte('3', '41')]);
    const tipos = hijos(caratula(sobre), 'SubTotDTE').map((n) => hijo(n, 'TpoDTE').textContent);
    expect(tipos).toEqual(['41', '39']);
  });

  it('el sobre queda firmado sobre el SetDTE (test_el_sobre_queda_firmado_sobre_el_set_dte)', () => {
    const sobre = empaquetar(dte('56'));
    const raiz = parsearDocumento(sobre).documentElement;
    if (raiz === null) throw new Error('sin raíz');
    const firma = hijos(raiz, 'Signature').at(-1);
    if (firma === undefined) throw new Error('sin <Signature>');
    expect(firma.namespaceURI).toBe(DSIG);

    const reference = firma.getElementsByTagName('Reference')[0];
    expect(reference?.getAttribute('URI')).toBe('#SetDoc');
    expect(firma.getElementsByTagName('DigestValue')[0]?.textContent).toBe(
      createHash('sha1')
        .update(c14n(setDte(sobre)), 'utf8')
        .digest('base64'),
    );
  });

  it('quita la declaración XML de cada DTE (test_quita_la_declaracion_xml_de_cada_dte)', () => {
    const sobre = empaquetar([dte('56'), dte('57')]);
    expect(hijos(setDte(sobre), 'DTE')).toHaveLength(2);
    // Solo queda la declaración del sobre.
    expect(sobre.toString('latin1').match(/<\?xml/g)).toHaveLength(1);
  });

  it('quita declaraciones en mayúsculas y con \\r dentro (el . de PCRE cruza \\r)', () => {
    const cuerpo = dte('56')
      .toString('latin1')
      .replace(/^<\?xml[^\n]*\?>/, '');
    const sobre = empaquetar([
      `<?XML VERSION="1.0"?>${cuerpo}`,
      `<?xml version="1.0"\r encoding="ISO-8859-1"?>${cuerpo.replace('F56T39', 'F57T39')}`,
    ]);
    expect(hijos(setDte(sobre), 'DTE')).toHaveLength(2);
    expect(sobre.toString('latin1').match(/<\?xml/gi)).toHaveLength(1);
  });

  it('una declaración partida por \\n no se quita (el . de PCRE no cruza \\n)', () => {
    const cuerpo = dte('56')
      .toString('latin1')
      .replace(/^<\?xml[^\n]*\?>/, '');
    // Con un target que no es exactamente "xml" el sobre sigue siendo XML válido.
    const sobre = empaquetar(`<?xml-x a="1"\n?>${cuerpo}`);
    expect(sobre.toString('latin1')).toContain('<?xml-x a="1"\n?>');
  });

  // libxml rechaza una PI con target `xml` (en cualquier combinación de
  // mayúsculas) fuera del inicio, así que el PHP lanza "No se encontró el nodo
  // SetDTE"; parsearDocumento (comun/xml.ts) la rechaza igual (caso de paridad
  // xml-bien-formado) y firmarDte no firma.
  it('una declaración <?xml que queda en medio hace fallar la firma, como el PHP', () => {
    const cuerpo = dte('56')
      .toString('latin1')
      .replace(/^<\?xml[^\n]*\?>/, '');
    expect(() => empaquetar(`<?xml version="1.0"\n?>${cuerpo}`)).toThrow(ErrorFirma);
  });

  it('un arreglo agrega "\\n" después de cada DTE; un Buffer suelto va tal cual', () => {
    const a = dte('1');
    const b = dte('2');
    const comoArreglo = empaquetar([a, b]);
    expect(empaquetar(Buffer.concat([a, Buffer.from('\n'), b, Buffer.from('\n')]))).toEqual(
      comoArreglo,
    );
    expect(empaquetar(Buffer.concat([a, b]))).not.toEqual(comoArreglo);
  });

  it('acepta Uint8Array y strings (texto Unicode → ISO-8859-1)', () => {
    const bytes = dte('5', '39', 'ÑANDÚ &amp; CÍA');
    const esperado = empaquetar([bytes]);
    expect(empaquetar([new Uint8Array(bytes)])).toEqual(esperado);
    expect(empaquetar([bytes.toString('latin1')])).toEqual(esperado);
    // La salida es ISO-8859-1: la Ñ es un byte.
    expect(esperado.includes(Buffer.from([0xd1, 0x41, 0x4e, 0x44, 0xda]))).toBe(true);
  });

  it('un string con caracteres fuera de ISO-8859-1 es un ErrorValidacion', () => {
    const cuerpo = dte('56').toString('latin1').replace('EMPRESA SPA', 'EMPRESA €');
    expect(() => empaquetar(cuerpo)).toThrow(ErrorValidacion);
  });

  it('nroResol numérico se escribe en decimal', () => {
    const sobre = empaquetar(dte('56'), { ...DATOS, nroResol: 80 });
    expect(hijo(caratula(sobre), 'NroResol').textContent).toBe('80');
  });

  it('los datos de la carátula van como bytes UTF-8 sin escapar, como el PHP', () => {
    // Mojibake a propósito: el PHP concatena el string UTF-8 en el sobre ISO-8859-1.
    const sobre = empaquetar(dte('56'), { ...DATOS, rutEnvia: 'Ñ' });
    expect(hijo(caratula(sobre), 'RutEnvia').textContent).toBe('Ã\u0091');
  });

  // Decisión del usuario (2026-11-06): el PHP armaba y firmaba un sobre sin
  // SubTotDTE ni DTE, que no valida contra el XSD. Aquí es un ErrorValidacion.
  it.each([
    ['una lista vacía', []],
    ['un Buffer vacío', Buffer.alloc(0)],
    ['un string vacío', ''],
    ['una lista de vacíos', ['', Buffer.alloc(0)]],
    ['solo una declaración XML', '<?xml version="1.0" encoding="ISO-8859-1"?>\n'],
    ['XML sin <TipoDTE>', '<DTE xmlns="http://www.sii.cl/SiiDte" version="1.0"/>'],
  ] as const)('sin ningún DTE (%s) es un ErrorValidacion', (_, dtes) => {
    expect(() => empaquetar(dtes)).toThrow(ErrorValidacion);
    expect(() => empaquetar(dtes)).toThrow(
      'No hay DTE que empaquetar: el sobre EnvioBOLETA exige al menos un DTE (con su <TipoDTE>).',
    );
  });

  it('un solo DTE basta (el mínimo que exige el XSD)', () => {
    const sobre = empaquetar([dte('56')]);
    expect(hijos(caratula(sobre), 'SubTotDTE')).toHaveLength(1);
    expect(hijos(setDte(sobre), 'DTE')).toHaveLength(1);
  });

  it('usa el reloj del sistema si no se inyecta uno', () => {
    const sobre = new EnvioBoleta(firmador, DATOS).empaquetar(dte('56'));
    expect(hijo(caratula(sobre), 'TmstFirmaEnv').textContent).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    );
  });

  it('termina justo en la etiqueta de cierre, en ISO-8859-1', () => {
    const sobre = empaquetar(dte('56'));
    expect(
      sobre.toString('latin1').startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>\n'),
    ).toBe(true);
    expect(sobre.toString('latin1').endsWith('</Signature></EnvioBOLETA>')).toBe(true);
  });
});
