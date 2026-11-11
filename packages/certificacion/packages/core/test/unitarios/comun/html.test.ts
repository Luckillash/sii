// Tests del parser HTML estilo libxml. Las reglas se comparan contra el PHP en
// los casos de paridad html-form-*; aquí van las funciones auxiliares y algunos
// casos de lectura rápida.

import { describe, expect, it } from 'vitest';
import { atributo, elementosPorNombre, parsearHtml, textoHtml } from '../../../src/comun/html.ts';

describe('parsearHtml', () => {
  it('arma html/body implícitos y nombres en minúsculas', () => {
    const raiz = parsearHtml('<FORM ACTION="X"><INPUT NAME="a"></FORM>');
    expect(raiz.hijos.map((h) => h.nombre)).toEqual(['html']);
    const [form] = elementosPorNombre(raiz, 'form');
    expect(form && atributo(form, 'action')).toBe('X');
    expect(elementosPorNombre(raiz, 'input')).toHaveLength(1);
  });

  it('un </form> dentro de una celda no cierra el formulario; un </td> sí', () => {
    const dentro = parsearHtml(
      '<form><table><tr><td><input name="a"></form><input name="b"></td></tr></table></form>',
    );
    const [f1] = elementosPorNombre(dentro, 'form');
    expect(f1 && elementosPorNombre(f1, 'input')).toHaveLength(2);

    const fuera = parsearHtml('<table><tr><td><form><input name="a"></td><td><input name="b">');
    const [f2] = elementosPorNombre(fuera, 'form');
    expect(f2 && elementosPorNombre(f2, 'input')).toHaveLength(1);
  });

  it('atributo() devuelve "" si no está', () => {
    const [input] = elementosPorNombre(parsearHtml('<input name="a">'), 'input');
    expect(input && atributo(input, 'value')).toBe('');
  });
});

describe('textoHtml', () => {
  it('quita etiquetas, decodifica entidades, colapsa blancos y recorta', () => {
    expect(textoHtml('<p>El c&oacute;digo\n\n<b>es</b>&nbsp;X</p>')).toBe('El código es X');
    expect(textoHtml('<p>ñandú ñandú</p>', 5)).toBe('ñandú');
  });

  it('con sinScripts quita el contenido de <script> y <style>', () => {
    const html = '<script>var x = 1;</script><style>a{}</style>texto';
    expect(textoHtml(html)).toBe('var x = 1;a{}texto');
    expect(textoHtml(html, 300, { sinScripts: true })).toBe('texto');
  });
});
