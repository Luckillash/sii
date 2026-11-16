import { describe, expect, it } from 'vitest';
import { correoBoleta, type DatosBoleta } from './boleta';

const DATOS: DatosBoleta = {
  empresa: 'Comercial Ñuñoa SpA',
  rut: '76.354.771-K',
  tipo: 'boleta electrónica',
  folio: '41',
  total: '$ 14.865',
  fecha: '13-11-2026',
};

const EMOJI = /\p{Extended_Pictographic}/u;

describe('correoBoleta', () => {
  it('asunto, empresa, folio, monto, fecha, adjunto y verificación, en HTML y en texto', () => {
    const c = correoBoleta(DATOS);
    expect(c.asunto).toBe('Tu boleta electrónica N.º 41 de Comercial Ñuñoa SpA');
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('Boleta electrónica N.º 41');
      expect(salida).toContain(
        'Comercial Ñuñoa SpA (RUT 76.354.771-K) te envía tu boleta electrónica N.º 41 por $ 14.865, emitida el 13-11-2026.',
      );
      expect(salida).toContain('adjunta en PDF');
      expect(salida).toContain('www.sii.cl');
      expect(salida).toContain('Boletéame');
    }
    expect(c.html).toContain('href="https://www.sii.cl"');
    expect(c.texto).toContain('https://www.sii.cl');
  });

  it('boleta exenta: usa el nombre que recibe', () => {
    const c = correoBoleta({ ...DATOS, tipo: 'boleta exenta electrónica', folio: '7' });
    expect(c.asunto).toBe('Tu boleta exenta electrónica N.º 7 de Comercial Ñuñoa SpA');
    expect(c.texto.startsWith('Boleta exenta electrónica N.º 7')).toBe(true);
  });

  it('respeta el tono: sin exclamaciones ni emoji', () => {
    const c = correoBoleta(DATOS);
    const visible = c.html.replace(/<[^>]*>/g, '');
    for (const salida of [c.asunto, visible, c.texto]) {
      expect(salida).not.toMatch(/[!¡]/u);
      expect(salida).not.toMatch(EMOJI);
    }
  });

  it('escapa los datos variables', () => {
    const c = correoBoleta({ ...DATOS, empresa: '<b>x</b> & Cía' });
    expect(c.html).not.toContain('<b>x</b>');
    expect(c.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; Cía');
  });
});
