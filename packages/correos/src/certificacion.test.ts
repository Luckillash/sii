import { describe, expect, it } from 'vitest';
import { correoCertificacion, type DatosCertificacion } from './certificacion';

const DATOS: DatosCertificacion = {
  organizacion: 'Servicios Andinos',
  empresa: 'Servicios Andinos SpA',
  rut: '76.354.771-K',
  etapa: 'Set aceptado',
  siguientePaso: 'Pide la revisión del set al SII desde el asistente.',
  enlace: 'https://boleteame.dev/servicios-andinos/certificacion',
};

const EMOJI = /\p{Extended_Pictographic}/u;

describe('correoCertificacion', () => {
  const correo = correoCertificacion(DATOS);

  it('arma el asunto con la empresa y la etapa', () => {
    expect(correo.asunto).toBe('Certificación de Servicios Andinos SpA: Set aceptado');
  });

  it('dice la empresa, el RUT, la etapa y qué hacer, en HTML y en texto', () => {
    for (const salida of [correo.html, correo.texto]) {
      expect(salida).toContain('76.354.771-K');
      expect(salida).toContain('Set aceptado');
      expect(salida).toContain('Pide la revisión del set al SII');
      expect(salida).toContain('Servicios Andinos');
    }
  });

  it('lleva el enlace al asistente en el botón y en el texto plano', () => {
    expect(correo.html).toContain('href="https://boleteame.dev/servicios-andinos/certificacion"');
    expect(correo.texto).toContain('https://boleteame.dev/servicios-andinos/certificacion');
  });

  it('respeta el tono: sin exclamaciones ni emoji', () => {
    const visible = correo.html.replace(/<[^>]*>/g, '');
    for (const salida of [correo.asunto, visible, correo.texto]) {
      expect(salida).not.toMatch(/[!¡]/u);
      expect(salida).not.toMatch(EMOJI);
    }
  });

  it('escapa los datos variables y rechaza enlaces que no sean http(s)', () => {
    const c = correoCertificacion({ ...DATOS, empresa: '<b>x</b> & Cía' });
    expect(c.html).not.toContain('<b>x</b>');
    expect(c.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; Cía');
    expect(() => correoCertificacion({ ...DATOS, enlace: 'javascript:alert(1)' })).toThrow();
  });
});
