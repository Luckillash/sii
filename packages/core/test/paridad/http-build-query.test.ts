import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codificarFormulario, type ValorFormulario } from '../../src/comun/http/formulario.ts';
import { prepararPeticion } from '../../src/comun/http/transporte.ts';
import { casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

type ValorCaso = string | { base64: string };

const lista = casos<{ campos: [ValorCaso, ValorCaso][]; iso88591?: boolean }>('httpBuildQuery');

function valor(v: ValorCaso): ValorFormulario {
  return typeof v === 'string' ? v : Buffer.from(v.base64, 'base64');
}

/**
 * `mb_convert_encoding($v, 'ISO-8859-1', 'UTF-8')`: lo que no cabe queda en `?`.
 * Local al test para no depender de `comun/codificacion.ts`.
 */
function aIso88591(texto: string): Buffer {
  const seguro = Array.from(texto, (c) => ((c.codePointAt(0) ?? 0) > 0xff ? '?' : c)).join('');
  return Buffer.from(seguro, 'latin1');
}

describe('paridad: http_build_query', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);
    const campos = caso.entrada.campos.map(([clave, v]): [ValorFormulario, ValorFormulario] => {
      const crudo = valor(v);
      return [
        valor(clave),
        caso.entrada.iso88591 === true && typeof crudo === 'string' ? aIso88591(crudo) : crudo,
      ];
    });

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    it('codificarFormulario produce los mismos bytes que el PHP', () => {
      exigirIdentico(Buffer.from(codificarFormulario(campos), 'latin1'), bytes, caso.nombre);
    });

    it('el cuerpo que arma el transporte es el mismo', () => {
      const { cuerpo, cabeceras } = prepararPeticion({
        metodo: 'POST',
        url: 'https://maullin.sii.cl/x',
        cuerpo: { tipo: 'formulario', campos },
      });
      exigirIdentico(cuerpo ?? Buffer.alloc(0), bytes, caso.nombre);
      expect(cabeceras['Content-Type']).toBe('application/x-www-form-urlencoded');
    });
  });
});
