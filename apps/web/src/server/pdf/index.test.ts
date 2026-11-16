import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { boletaPrueba, type DetallePrueba } from './boleta-prueba';
import { type DatosRepresentacion, generarPdf } from './index';

// Representación impresa: PDF válido en carta y rollo, con tildes y ñ, muchas líneas y
// nombres largos. El texto se extrae de los flujos de contenido (pdfkit los comprime con
// Flate y escribe el texto WinAnsi en hexadecimal, `[<…> 12 <…>] TJ`).
//
// Con PDF_MUESTRAS=<carpeta> deja un PDF de ejemplo de cada formato en esa carpeta.

/** Texto de todas las páginas con los saltos y blancos reducidos a un espacio. */
function textoPdf(pdf: Buffer): string {
  return lineasPdf(pdf).replace(/\s+/g, ' ');
}

/** Texto de cada página, línea por línea (WinAnsi ≈ latin1 para tildes y ñ). */
function lineasPdf(pdf: Buffer): string {
  const crudo = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenido: string;
    try {
      contenido = inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue; // Imagen u otro flujo que no es Flate de texto.
    }
    for (const tj of contenido.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...(tj[1] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('');
      partes.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  }
  return partes.join('\n');
}

function paginas(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
}

function tamanoPagina(pdf: Buffer): [number, number] {
  const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
  return [Number(m?.[1]), Number(m?.[2])];
}

function esPdf(pdf: Buffer): void {
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
}

function guardarMuestra(nombre: string, pdf: Buffer): void {
  const carpeta = process.env.PDF_MUESTRAS;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, nombre), pdf);
}

describe('generarPdf', () => {
  const boleta = boletaPrueba({
    receptor: { rut: '12345678-5', razonSocial: 'Peñalolén Ñandú e Hijos Ltda.' },
  });

  it('carta: PDF válido con emisor, recuadro, detalle, totales y leyendas del timbre', async () => {
    const pdf = await generarPdf(boleta.datos, 'carta');
    esPdf(pdf);
    guardarMuestra('boleta-39-F41-carta.pdf', pdf);
    expect(paginas(pdf)).toBe(1);
    expect(tamanoPagina(pdf)).toEqual([612, 792]);
    const t = textoPdf(pdf);
    for (const esperado of [
      'Comercial Ñuñoa y Peñalolén SpA',
      'Avenida Irarrázaval 1234',
      'Ñuñoa',
      'R.U.T.: 76.123.456-0',
      'BOLETA ELECTRÓNICA',
      'N.º 41',
      '13-11-2026',
      'Peñalolén Ñandú e Hijos Ltda.',
      '12.345.678-5',
      'Café con ñandú de Peñalolén',
      '1,5 Kg',
      '(exento)',
      `$ 2.380`,
      'Monto neto',
      'IVA (19 %)',
      'Monto exento',
      'Timbre Electrónico SII',
      'Res. N.º 0 de 2026',
      'Verifique documento: www.sii.cl',
      'sin validez tributaria',
    ]) {
      expect(t).toContain(esperado);
    }
    const total = boleta.datos.totales.total;
    expect(total).toBeGreaterThan(0);
    expect(t).toContain(`$ ${total.toLocaleString('de-DE')}`);
  });

  it('rollo: 80 mm de ancho, una página con alto según el contenido', async () => {
    const pdf = await generarPdf(boleta.datos, 'rollo');
    esPdf(pdf);
    guardarMuestra('boleta-39-F41-rollo.pdf', pdf);
    expect(paginas(pdf)).toBe(1);
    const [ancho, alto] = tamanoPagina(pdf);
    expect(ancho).toBeCloseTo((80 * 72) / 25.4, 1);
    expect(alto).toBeGreaterThan(300);
    expect(alto).toBeLessThan(800);
    const t = textoPdf(pdf);
    for (const esperado of [
      'BOLETA ELECTRÓNICA',
      'N.º 41',
      'R.U.T.: 76.123.456-0',
      'Timbre Electrónico SII',
      'Verifique documento: www.sii.cl',
      'sin validez tributaria',
    ]) {
      expect(t).toContain(esperado);
    }
  });

  it('boleta exenta: título y totales sin neto ni IVA; producción sin aviso de certificación', async () => {
    const exenta = boletaPrueba({ tipoDte: 41, folio: 7, ambiente: 'produccion' });
    const datos: DatosRepresentacion = {
      ...exenta.datos,
      resolucion: { numero: 80, fecha: '2014-08-22' },
    };
    for (const formato of ['carta', 'rollo'] as const) {
      const t = textoPdf(await generarPdf(datos, formato));
      expect(t).toContain('BOLETA EXENTA ELECTRÓNICA');
      expect(t).toContain('Res. N.º 80 de 2014');
      expect(t).not.toContain('IVA');
      expect(t).not.toContain('Monto neto');
      expect(t).not.toContain('(exento)');
      expect(t).not.toContain('validez tributaria');
      // Receptor genérico: no se imprime.
      expect(t).not.toContain('Cliente General');
      expect(t).not.toContain('66.666.666-6');
    }
  });

  it('descuentos de línea y global aparecen con su signo', async () => {
    const datos: DatosRepresentacion = {
      ...boleta.datos,
      lineas: boleta.datos.lineas.map((l, i) => (i === 0 ? { ...l, descuento: 380 } : l)),
      totales: { ...boleta.datos.totales, descuentoAplicado: 1000 },
    };
    for (const formato of ['carta', 'rollo'] as const) {
      const t = textoPdf(await generarPdf(datos, formato));
      expect(t).toContain('-$ 380');
      expect(t).toContain('Descuento global');
      expect(t).toContain('-$ 1.000');
    }
  });

  it('muchas líneas: la carta pasa de página y el rollo se alarga', async () => {
    const detalles: DetallePrueba[] = Array.from({ length: 120 }, (_, i) => ({
      nombre: `Producto número ${i + 1} con ñandú`,
      cantidad: (i % 5) + 1,
      precio: 990 + i * 10,
    }));
    const muchas = boletaPrueba({ detalles, folio: 99 });
    const carta = await generarPdf(muchas.datos, 'carta');
    esPdf(carta);
    const n = paginas(carta);
    expect(n).toBeGreaterThanOrEqual(3);
    const t = textoPdf(carta);
    expect(t).toContain('Producto número 1 con ñandú');
    expect(t).toContain('Producto número 120 con ñandú');
    expect(t).toContain(`Página ${n} de ${n}`);
    expect(t).toContain('Timbre Electrónico SII');

    const rollo = await generarPdf(muchas.datos, 'rollo');
    esPdf(rollo);
    expect(paginas(rollo)).toBe(1);
    expect(tamanoPagina(rollo)[1]).toBeGreaterThan(
      tamanoPagina(await generarPdf(boleta.datos, 'rollo'))[1] * 3,
    );
  });

  it('nombres largos se ajustan en varias líneas sin perder texto', async () => {
    const largo =
      'Servicio de mantención preventiva y correctiva de equipos de refrigeración industrial ' +
      'para la sucursal de Peñalolén, incluye repuestos, mano de obra y traslado del técnico';
    const emisorLargo =
      'Sociedad Comercializadora de Productos Alimenticios del Sur de Chile y Compañía Limitada';
    const b = boletaPrueba({
      razonSocialEmisor: emisorLargo,
      detalles: [{ nombre: largo, cantidad: 1, precio: 119000 }],
      receptor: {
        rut: '12345678-5',
        razonSocial: 'Asociación Gremial de Pequeños Comerciantes de la Región Metropolitana',
      },
    });
    for (const formato of ['carta', 'rollo'] as const) {
      const pdf = await generarPdf(b.datos, formato);
      esPdf(pdf);
      expect(paginas(pdf)).toBe(1);
      // pdfkit corta en palabras: el nombre completo está repartido en varias líneas, y
      // unidas con un espacio quedan íntegras.
      expect(lineasPdf(pdf)).not.toContain(largo);
      const t = textoPdf(pdf);
      expect(t).toContain(largo);
      expect(t).toContain(emisorLargo);
    }
  });

  it('lanza si el TED no es un TED en latin1', async () => {
    await expect(
      generarPdf({ ...boleta.datos, tedXml: 'no es un TED' }, 'carta'),
    ).rejects.toThrow();
    await expect(
      generarPdf({ ...boleta.datos, tedXml: '<TED version="1.0">☃</TED>' }, 'rollo'),
    ).rejects.toThrow(/ISO-8859-1/);
  });
});
