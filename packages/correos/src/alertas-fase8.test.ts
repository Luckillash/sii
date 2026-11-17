import { describe, expect, it } from 'vitest';
import { correoCertificadoPorVencer, type DatosCertificadoPorVencer } from './certificado';
import { correoEnvioIncierto, type DatosEnvioIncierto } from './incierto';
import type { Correo } from './plantilla';
import { correoDocumentosRechazados, type DocumentoRechazado } from './rechazo';

const EMOJI = /\p{Extended_Pictographic}/u;

function revisarTono(c: Correo) {
  const visible = c.html.replace(/<[^>]*>/g, '');
  for (const salida of [c.asunto, visible, c.texto]) {
    expect(salida).not.toMatch(/[!¡]/u);
    expect(salida).not.toMatch(EMOJI);
  }
}

const DOC: DocumentoRechazado = {
  documento: 'Boleta electrónica N.º 41',
  empresa: 'Servicios Andinos SpA',
  rut: '76.354.771-K',
  total: '$ 1.190',
  fecha: '16-11-2026',
  ambiente: 'certificación',
  motivo: 'Error en el monto total',
  enlace: 'https://boleteame.dev/servicios-andinos/envios/e1',
};

describe('correoDocumentosRechazados', () => {
  const lista = 'https://boleteame.dev/servicios-andinos/documentos?estado=rechazado&periodo=todos';

  it('uno: asunto con el documento y la empresa, motivo del SII y qué hacer', () => {
    const c = correoDocumentosRechazados({
      organizacion: 'Servicios Andinos',
      documentos: [DOC],
      enlace: lista,
    });
    expect(c.asunto).toBe('El SII rechazó la Boleta electrónica N.º 41 de Servicios Andinos SpA');
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('76.354.771-K');
      expect(salida).toContain('$ 1.190');
      expect(salida).toContain('16-11-2026');
      expect(salida).toContain('Motivo del SII: Error en el monto total');
      expect(salida).toContain('vuelve a emitir el documento');
    }
    expect(c.html).toContain('href="https://boleteame.dev/servicios-andinos/envios/e1"');
    expect(c.html).toContain(`href="${lista.replace('&', '&amp;')}"`);
    revisarTono(c);
  });

  it('varios: un solo correo con todos, y sin motivo lo dice', () => {
    const c = correoDocumentosRechazados({
      organizacion: 'Servicios Andinos',
      documentos: [
        DOC,
        { ...DOC, documento: 'Boleta electrónica N.º 42', motivo: null },
        { ...DOC, documento: 'Boleta exenta electrónica N.º 7' },
      ],
      enlace: lista,
    });
    expect(c.asunto).toBe('El SII rechazó 3 documentos de Servicios Andinos');
    expect(c.texto).toContain('N.º 42');
    expect(c.texto).toContain('N.º 7');
    expect(c.texto).toContain('El SII no informó el motivo');
    revisarTono(c);
  });

  it('escapa los datos y exige al menos un documento y enlaces http(s)', () => {
    const c = correoDocumentosRechazados({
      organizacion: 'X',
      documentos: [{ ...DOC, motivo: '<script>x</script>' }],
      enlace: lista,
    });
    expect(c.html).not.toContain('<script>');
    expect(() =>
      correoDocumentosRechazados({ organizacion: 'X', documentos: [], enlace: lista }),
    ).toThrow();
    expect(() =>
      correoDocumentosRechazados({
        organizacion: 'X',
        documentos: [{ ...DOC, enlace: 'javascript:alert(1)' }],
        enlace: lista,
      }),
    ).toThrow();
  });
});

describe('correoEnvioIncierto', () => {
  const DATOS: DatosEnvioIncierto = {
    organizacion: 'Servicios Andinos',
    empresa: 'Servicios Andinos SpA',
    rut: '76.354.771-K',
    ambiente: 'producción',
    fecha: '16-11-2026 10:15',
    documentos: [{ documento: 'Boleta electrónica N.º 41', total: '$ 1.190' }],
    enlace: 'https://boleteame.dev/servicios-andinos/envios/e9',
  };

  it('explica qué pasó, que no se reintenta y cómo revisarlo en el SII', () => {
    const c = correoEnvioIncierto(DATOS);
    expect(c.asunto).toBe('Envío por verificar en el SII: Servicios Andinos SpA');
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('la Boleta electrónica N.º 41');
      expect(salida).toContain('no devolvió Track ID');
      expect(salida).toContain('16-11-2026 10:15');
      expect(salida).toContain('No vuelvas a emitir ni a enviar');
      expect(salida).toContain('no lo reintenta solo');
      expect(salida).toContain('www.sii.cl');
      expect(salida).toContain('pulsa «Ya lo revisé» en el detalle del envío');
      expect(salida).toContain('emite los documentos de nuevo');
      expect(salida).not.toContain('marca el envío como revisado');
    }
    expect(c.html).toContain('href="https://www.sii.cl"');
    expect(c.html).toContain('href="https://boleteame.dev/servicios-andinos/envios/e9"');
    revisarTono(c);
  });

  it('con varios documentos o sin documentos legibles', () => {
    const varios = correoEnvioIncierto({
      ...DATOS,
      documentos: [...DATOS.documentos, { documento: 'Boleta electrónica N.º 42', total: '$ 990' }],
    });
    expect(varios.texto).toContain('El envío de 2 documentos');
    const ninguno = correoEnvioIncierto({ ...DATOS, documentos: [] });
    expect(ninguno.texto).toContain('El envío de documentos');
    revisarTono(varios);
    revisarTono(ninguno);
  });
});

describe('correoCertificadoPorVencer', () => {
  const DATOS: DatosCertificadoPorVencer = {
    organizacion: 'Servicios Andinos',
    titular: 'Ana Pérez',
    rut: '12.345.678-5',
    vence: '10-12-2026',
    dias: 15,
    empresas: ['Servicios Andinos SpA'],
    enlace: 'https://boleteame.dev/servicios-andinos/configuracion/certificados',
  };

  it('días, fecha, empresas y qué hacer', () => {
    const c = correoCertificadoPorVencer(DATOS);
    expect(c.asunto).toBe('El certificado digital de Ana Pérez vence en 15 días (10-12-2026)');
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('12.345.678-5');
      expect(salida).toContain('Servicios Andinos SpA');
      expect(salida).toContain('sube el archivo .pfx nuevo');
    }
    revisarTono(c);
  });

  it('menos de 2 días (no «mañana») y menos de 24 h', () => {
    expect(correoCertificadoPorVencer({ ...DATOS, dias: 1 }).asunto).toContain(
      'vence en menos de 2 días',
    );
    expect(correoCertificadoPorVencer({ ...DATOS, dias: 1 }).texto).not.toContain('mañana');
    expect(correoCertificadoPorVencer({ ...DATOS, dias: 0 }).asunto).toContain(
      'vence en menos de 24 h',
    );
    const sinEmpresas = correoCertificadoPorVencer({ ...DATOS, empresas: [] });
    expect(sinEmpresas.texto).not.toContain('Con él se firman');
    revisarTono(sinEmpresas);
  });
});
