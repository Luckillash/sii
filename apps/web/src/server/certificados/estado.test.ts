import { describe, expect, it } from 'vitest';
import { alertasCertificados, type FilaEstadoCertificado, textoDias } from './estado';

function fila(parcial: Partial<FilaEstadoCertificado>): FilaEstadoCertificado {
  return {
    nombreTitular: 'Juan Pérez',
    estado: 'vigente',
    diasRestantes: 200,
    vigenteHasta: '2026-11-22T15:00:00Z',
    ...parcial,
  };
}

describe('alertasCertificados', () => {
  it('sin vencidos ni por vencer, nada', () => {
    expect(alertasCertificados([fila({}), fila({ estado: 'revocado', diasRestantes: 0 })])).toEqual(
      [],
    );
  });

  it('uno por vencer: aviso con días y fecha, como en la plantilla del Tablero', () => {
    const [a] = alertasCertificados([fila({ estado: 'por_vencer', diasRestantes: 12 })]);
    expect(a).toEqual({
      tono: 'aviso',
      titulo: 'Tu certificado de Juan Pérez vence en 12 días',
      detalle:
        'Sin un certificado vigente no podrás firmar documentos. Carga el nuevo antes del 22-11-2026.',
    });
  });

  it('varios por vencer: cuenta y avisa por el más próximo', () => {
    const [a] = alertasCertificados([
      fila({ estado: 'por_vencer', diasRestantes: 20 }),
      fila({ estado: 'por_vencer', diasRestantes: 1, nombreTitular: null }),
    ]);
    expect(a?.titulo).toBe('2 certificados vencen en los próximos 30 días');
    expect(a?.detalle).toMatch(/^El primero vence en 1 día\./);
  });

  it('vencido: error, antes que el aviso', () => {
    const alertas = alertasCertificados([
      fila({ estado: 'por_vencer', diasRestantes: 5 }),
      fila({ estado: 'vencido', diasRestantes: 0, nombreTitular: 'Ana Soto' }),
    ]);
    expect(alertas.map((a) => a.tono)).toEqual(['error', 'aviso']);
    expect(alertas[0]?.titulo).toBe('El certificado de Ana Soto está vencido');
    expect(alertas[0]?.detalle).toMatch(/^Venció el 22-11-2026\./);
  });

  it('textoDias', () => {
    expect(textoDias(0)).toBe('hoy');
    expect(textoDias(1)).toBe('1 día');
    expect(textoDias(30)).toBe('30 días');
  });
});
