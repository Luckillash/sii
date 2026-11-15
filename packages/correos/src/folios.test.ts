import { describe, expect, it } from 'vitest';
import { correoFoliosPorAgotarse, type DatosFoliosPorAgotarse } from './folios';

const DATOS: DatosFoliosPorAgotarse = {
  organizacion: 'Servicios Andinos',
  empresa: 'Servicios Andinos SpA',
  rut: '76.354.771-K',
  tipo: 'Boleta electrónica (39)',
  ambiente: 'producción',
  disponibles: '15',
  total: '100',
  agotado: false,
  enlace: 'https://boleteame.dev/servicios-andinos/folios?empresa=1',
};

const EMOJI = /\p{Extended_Pictographic}/u;

describe('correoFoliosPorAgotarse', () => {
  it('por agotarse: asunto, cifras, empresa y qué hacer, en HTML y en texto', () => {
    const c = correoFoliosPorAgotarse(DATOS);
    expect(c.asunto).toBe(
      'Quedan pocos folios de Boleta electrónica (39) en producción: Servicios Andinos SpA',
    );
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('76.354.771-K');
      expect(salida).toContain('le quedan 15 folios');
      expect(salida).toContain('15 %');
      expect(salida).toContain('Solicita un nuevo CAF');
    }
    expect(c.html).toContain('href="https://boleteame.dev/servicios-andinos/folios?empresa=1"');
  });

  it('agotado: dice que no se puede emitir', () => {
    const c = correoFoliosPorAgotarse({ ...DATOS, agotado: true, disponibles: '0' });
    expect(c.asunto).toBe(
      'Sin folios de Boleta electrónica (39) en producción: Servicios Andinos SpA',
    );
    expect(c.texto).toContain('se quedó sin folios');
    expect(c.texto).toContain('No se pueden emitir');
  });

  it('respeta el tono: sin exclamaciones ni emoji', () => {
    for (const agotado of [false, true]) {
      const c = correoFoliosPorAgotarse({ ...DATOS, agotado });
      const visible = c.html.replace(/<[^>]*>/g, '');
      for (const salida of [c.asunto, visible, c.texto]) {
        expect(salida).not.toMatch(/[!¡]/u);
        expect(salida).not.toMatch(EMOJI);
      }
    }
  });

  it('escapa los datos variables y rechaza enlaces que no sean http(s)', () => {
    const c = correoFoliosPorAgotarse({ ...DATOS, empresa: '<b>x</b> & Cía' });
    expect(c.html).not.toContain('<b>x</b>');
    expect(c.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; Cía');
    expect(() => correoFoliosPorAgotarse({ ...DATOS, enlace: 'javascript:alert(1)' })).toThrow();
  });
});
