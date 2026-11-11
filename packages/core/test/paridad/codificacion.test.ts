// Golden tests de codificación de texto (mbstring). Ver
// paridad/php/operaciones/codificacion.php.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aIso88591,
  decodificarUtf8OIso,
  esUtf8Valido,
  largoCodePoints,
  truncarCodePoints,
} from '../../src/comun/codificacion.ts';
import { type CasoParidad, casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

function verificarMeta(caso: CasoParidad<unknown>): Buffer {
  const { bytes, meta } = esperado(caso.nombre);
  expect(bytes.length).toBe(meta.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
  return bytes;
}

const SALTO = Buffer.from('\n');

describe('paridad: convertirIso (mb_convert_encoding UTF-8 → ISO-8859-1)', () => {
  const lista = casos<{ textos: string[] }>('convertirIso');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const obtenido = Buffer.concat(caso.entrada.textos.flatMap((t) => [aIso88591(t), SALTO]));
      exigirIdentico(obtenido, bytes, caso.nombre);
    });
  });
});

describe('paridad: truncarTexto (mb_strlen y mb_substr)', () => {
  const lista = casos<{ textos: string[]; largo: number }>('truncarTexto');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const { textos, largo } = caso.entrada;
      const obtenido = textos
        .map((t) => `${largoCodePoints(t)}|${truncarCodePoints(t, largo)}\n`)
        .join('');
      exigirIdentico(Buffer.from(obtenido, 'utf8'), bytes, caso.nombre);
    });
  });
});

describe('paridad: decodificarTexto (mb_check_encoding y fallback ISO-8859-1)', () => {
  const lista = casos<{ bytes_base64: string[] }>('decodificarTexto');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node produce los mismos bytes que el PHP', () => {
      const bytes = verificarMeta(caso);
      const obtenido = Buffer.concat(
        caso.entrada.bytes_base64.flatMap((base64) => {
          const entrada = Buffer.from(base64, 'base64');
          const valido = esUtf8Valido(entrada);
          return [
            Buffer.from(valido ? '1|' : '0|'),
            Buffer.from(decodificarUtf8OIso(entrada), 'utf8'),
            SALTO,
          ];
        }),
      );
      exigirIdentico(obtenido, bytes, caso.nombre);
    });
  });
});
