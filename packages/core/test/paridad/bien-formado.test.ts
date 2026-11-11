import { describe, expect, it } from 'vitest';
import { parsearDocumento } from '../../src/comun/xml.ts';
import { casos, esperado } from '../soporte/paridad.ts';

const lista = casos<{ xml: Record<string, string> }>('bienFormado');

/** Veredicto de Node para cada XML, en el formato de la operación PHP. */
function veredictos(xml: Record<string, string>): string {
  return Object.entries(xml)
    .map(([nombre, texto]) => {
      try {
        parsearDocumento(texto);
        return `${nombre}: ok`;
      } catch {
        return `${nombre}: error`;
      }
    })
    .map((linea) => `${linea}\n`)
    .join('');
}

describe('paridad: XML bien formado (loadXML vs parsearDocumento)', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    it('Node acepta y rechaza lo mismo que PHP', () => {
      // Se compara como texto para que el diff muestre qué entrada difiere.
      expect(veredictos(caso.entrada.xml)).toBe(esperado(caso.nombre).bytes.toString('utf8'));
    });
  });
});
