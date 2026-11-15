import { describe, expect, it } from 'vitest';
import type { OperacionFolios, VistaFolios } from '@/server/folios';
import { bloqueoSolicitud, enCurso, inciertaSinRevisar, rangoIncierta } from './logica';

const AHORA = new Date('2026-11-15T12:00:00Z');

function op(datos: Partial<OperacionFolios>): OperacionFolios {
  return {
    id: 'op-1',
    ambiente: 'produccion',
    resultado: 'ok',
    confirmada: true,
    mensaje: null,
    iniciadaEn: '2026-11-15T11:59:00Z',
    revisada: false,
    solicitudId: null,
    traslape: null,
    ...datos,
  };
}

function vista(datos: Partial<VistaFolios> = {}): VistaFolios {
  return {
    empresa: {
      id: 'e',
      rut: '76123456-0',
      razonSocial: 'X',
      activa: true,
      autorizadaProduccion: true,
    },
    planPermiteProduccion: true,
    representante: { titular: 'T', rut: '12345678-5', vigenteHasta: '2027-01-01' },
    resumen: [],
    cafs: [],
    solicitudes: [],
    operaciones: [],
    ...datos,
  };
}

describe('lógica de /[org]/folios', () => {
  it('una incierta sin revisar bloquea su ambiente y trae el rango de su solicitud', () => {
    const v = vista({
      operaciones: [op({ resultado: 'incierto', solicitudId: 's1' })],
      solicitudes: [
        {
          id: 's1',
          ambiente: 'produccion',
          tipoDte: 39,
          cantidad: 20,
          folioInicial: null,
          confirmada: true,
          estado: 'incierta',
          desde: 21,
          hasta: 40,
          mensaje: null,
          solicitadoPor: null,
          creadoEn: '2026-11-15T11:59:00Z',
          terminadoEn: null,
        },
      ],
    });
    const i = inciertaSinRevisar(v, 'produccion', AHORA);
    expect(i && rangoIncierta(i)).toBe('21 a 40');
    expect(bloqueoSolicitud(v, 'produccion', AHORA)).toContain('por verificar');
    expect(bloqueoSolicitud(v, 'certificacion', AHORA)).toBeNull();
  });

  it('una incierta revisada, o seguida de una correcta, no bloquea; una `uso` no la tapa', () => {
    expect(
      inciertaSinRevisar(
        vista({ operaciones: [op({ resultado: 'incierto', revisada: true })] }),
        'produccion',
        AHORA,
      ),
    ).toBeNull();
    expect(
      inciertaSinRevisar(
        vista({ operaciones: [op({ resultado: 'ok' }), op({ id: 'b', resultado: 'incierto' })] }),
        'produccion',
        AHORA,
      ),
    ).toBeNull();
    expect(
      inciertaSinRevisar(
        vista({ operaciones: [op({ resultado: 'uso' }), op({ id: 'b', resultado: 'incierto' })] }),
        'produccion',
        AHORA,
      )?.operacion.id,
    ).toBe('b');
  });

  it('en curso bloquea; abandonada (más de 15 min) cuenta como por verificar', () => {
    const reciente = vista({ operaciones: [op({ resultado: 'en_curso' })] });
    expect(enCurso(reciente.operaciones, 'produccion', AHORA)).not.toBeNull();
    expect(bloqueoSolicitud(reciente, 'produccion', AHORA)).toContain('en curso');
    const vieja = vista({
      operaciones: [op({ resultado: 'en_curso', iniciadaEn: '2026-11-15T11:00:00Z' })],
    });
    expect(enCurso(vieja.operaciones, 'produccion', AHORA)).toBeNull();
    expect(inciertaSinRevisar(vieja, 'produccion', AHORA)).not.toBeNull();
  });

  it('explica antes de pedir: sin autorización, sin plan o sin representante', () => {
    expect(
      bloqueoSolicitud(
        vista({ empresa: { ...vista().empresa, autorizadaProduccion: false } }),
        'produccion',
        AHORA,
      ),
    ).toContain('no está autorizada');
    expect(
      bloqueoSolicitud(vista({ planPermiteProduccion: false }), 'produccion', AHORA),
    ).toContain('plan');
    expect(
      bloqueoSolicitud(vista({ planPermiteProduccion: false }), 'certificacion', AHORA),
    ).toBeNull();
    expect(bloqueoSolicitud(vista({ representante: null }), 'certificacion', AHORA)).toContain(
      'representante electrónico',
    );
  });
});
