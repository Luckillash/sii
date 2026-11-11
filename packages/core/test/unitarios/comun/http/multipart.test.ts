// Formato del multipart armado a mano. La paridad byte a byte con cURL está en
// test/paridad/http-multipart.test.ts; aquí, las reglas y los bordes.

import { describe, expect, it } from 'vitest';
import { ErrorValidacion } from '../../../../src/comun/errores.ts';
import { armarMultipart, boundaryAleatorio } from '../../../../src/comun/http/multipart.ts';

const B = '------------------------AbCdEfGhIjKlMnOpQrStUv';

describe('boundaryAleatorio', () => {
  it('24 guiones y 22 alfanuméricos, como cURL 8', () => {
    for (let i = 0; i < 50; i++) expect(boundaryAleatorio()).toMatch(/^-{24}[0-9A-Za-z]{22}$/);
  });

  it('cambia en cada llamada', () => {
    const vistos = new Set(Array.from({ length: 100 }, () => boundaryAleatorio()));
    expect(vistos.size).toBe(100);
  });
});

describe('armarMultipart', () => {
  it('campos de texto y archivo en orden, con CRLF y cierre', () => {
    const xml = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><A>\xd1</A>', 'latin1');
    const m = armarMultipart(
      [
        { nombre: 'rutSender', valor: '11111111' },
        { nombre: 'dvSender', valor: 'K' },
        { nombre: 'archivo', archivo: xml, nombreArchivo: 'envio.xml', contentType: 'text/xml' },
      ],
      B,
    );
    expect(m.boundary).toBe(B);
    expect(m.contentType).toBe(`multipart/form-data; boundary=${B}`);
    const esperado = Buffer.concat([
      Buffer.from(
        `--${B}\r\nContent-Disposition: form-data; name="rutSender"\r\n\r\n11111111\r\n` +
          `--${B}\r\nContent-Disposition: form-data; name="dvSender"\r\n\r\nK\r\n` +
          `--${B}\r\nContent-Disposition: form-data; name="archivo"; filename="envio.xml"\r\n` +
          'Content-Type: text/xml\r\n\r\n',
        'latin1',
      ),
      xml,
      Buffer.from(`\r\n--${B}--\r\n`, 'latin1'),
    ]);
    expect(m.datos.equals(esperado)).toBe(true);
  });

  it('el archivo va con sus bytes exactos (ISO-8859-1 no se recodifica)', () => {
    const m = armarMultipart(
      [{ nombre: 'a', archivo: Buffer.from([0xd1, 0x00, 0xff]), nombreArchivo: 'x' }],
      B,
    );
    expect(
      m.datos.includes(Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0xd1, 0x00, 0xff, 0x0d, 0x0a])),
    ).toBe(true);
  });

  it('respeta byteOffset y largo de una vista sobre un buffer mayor', () => {
    const grande = Buffer.from('xxABCyy', 'latin1');
    const vista = new Uint8Array(grande.buffer, grande.byteOffset + 2, 3);
    const m = armarMultipart([{ nombre: 'a', archivo: vista, nombreArchivo: 'x' }], B);
    expect(m.datos.toString('latin1')).toContain('\r\n\r\nABC\r\n');
    expect(m.datos.toString('latin1')).not.toContain('xx');
  });

  it('sin contentType el archivo va como application/octet-stream, como CURLFile sin tipo', () => {
    const m = armarMultipart(
      [{ nombre: 'a', archivo: Buffer.from('z'), nombreArchivo: 'x.xml' }],
      B,
    );
    expect(m.datos.toString('latin1')).toContain(
      'name="a"; filename="x.xml"\r\nContent-Type: application/octet-stream\r\n\r\nz\r\n',
    );
  });

  it('los textos van en UTF-8 y sin Content-Type; un valor vacío deja la parte vacía', () => {
    const m = armarMultipart(
      [
        { nombre: 'glosa', valor: 'Peña €' },
        { nombre: 'vacio', valor: '' },
      ],
      B,
    );
    const texto = m.datos.toString('utf8');
    expect(texto).toContain('name="glosa"\r\n\r\nPeña €\r\n');
    expect(texto).toContain('name="vacio"\r\n\r\n\r\n');
    expect(texto).not.toContain('Content-Type');
  });

  it('sin campos queda solo el cierre', () => {
    expect(armarMultipart([], B).datos.toString('latin1')).toBe(`--${B}--\r\n`);
  });

  it('usa un boundary aleatorio si no se indica', () => {
    const m = armarMultipart([{ nombre: 'a', valor: 'b' }]);
    expect(m.boundary).toMatch(/^-{24}[0-9A-Za-z]{22}$/);
    expect(m.datos.toString('latin1').startsWith(`--${m.boundary}\r\n`)).toBe(true);
  });

  it.each([
    ['comillas en el nombre', [{ nombre: 'a"b', valor: '' }]],
    ['salto de línea en el nombre', [{ nombre: 'a\r\nX: y', valor: '' }]],
    [
      'comillas en el nombre de archivo',
      [{ nombre: 'a', archivo: Buffer.alloc(0), nombreArchivo: 'x".xml' }],
    ],
    [
      'LF en el nombre de archivo',
      [{ nombre: 'a', archivo: Buffer.alloc(0), nombreArchivo: 'x\n' }],
    ],
  ])('rechaza %s', (_, lista) => {
    expect(() => armarMultipart(lista, B)).toThrow(ErrorValidacion);
  });

  it.each(['', 'con espacio', 'a\r\nb', 'x'.repeat(71), 'comilla"'])(
    'rechaza el boundary %j',
    (boundary) => {
      expect(() => armarMultipart([], boundary)).toThrow(ErrorValidacion);
    },
  );
});
