import { describe, expect, it } from 'vitest';
import { decidirAlerta } from '@/lib/folios';
import { EMPRESA, ORG } from '../../../test/certificacion-prueba';
import { escenarioFolios, filaCaf } from '../../../test/folios-prueba';
import { alertaDespuesDeAsignar, alertarSiCruza, claveIdempotenciaAlerta } from './alertas';
import type { ClaveFolios } from './tipos';

const CLAVE: ClaveFolios = {
  organizacionId: ORG,
  empresaId: EMPRESA,
  ambiente: 'produccion',
  tipoDte: 39,
};

describe('decidirAlerta (regla del 15 %)', () => {
  it('cruza: de 16 de 100 a 15 de 100', () => {
    expect(decidirAlerta({ restante: 16, total: 100 }, { restante: 15, total: 100 })).toBe(
      'por_agotarse',
    );
  });

  it('no cruza: ya estaba bajo el umbral, o sigue sobre él', () => {
    expect(decidirAlerta({ restante: 15, total: 100 }, { restante: 14, total: 100 })).toBeNull();
    expect(decidirAlerta({ restante: 50, total: 100 }, { restante: 49, total: 100 })).toBeNull();
    // Un CAF nuevo sube la proporción: tampoco es un cruce.
    expect(decidirAlerta({ restante: 10, total: 100 }, { restante: 110, total: 200 })).toBeNull();
  });

  it('agotado: de cualquier estado con folios a cero (también saltando el aviso)', () => {
    expect(decidirAlerta({ restante: 1, total: 100 }, { restante: 0, total: 0 })).toBe('agotado');
    expect(decidirAlerta({ restante: 60, total: 100 }, { restante: 0, total: 0 })).toBe('agotado');
    expect(decidirAlerta({ restante: 0, total: 0 }, { restante: 0, total: 0 })).toBeNull();
  });

  it('el denominador es el tamaño de los CAF activos con folios libres', () => {
    // A (1–100) con 10 libres + B (101–200) intacto: 110 de 200, sin aviso.
    expect(decidirAlerta({ restante: 111, total: 200 }, { restante: 110, total: 200 })).toBeNull();
  });
});

describe('claveIdempotenciaAlerta', () => {
  it('es determinista por empresa, ambiente, tipo, CAF y umbral', () => {
    const base = {
      empresaId: EMPRESA,
      ambiente: 'produccion' as const,
      tipoDte: 39,
      cafId: 'caf-1',
    };
    const a = claveIdempotenciaAlerta({ ...base, decision: 'por_agotarse' });
    expect(a).toBe(`folios.por_agotarse/${EMPRESA}/produccion/39/caf-1/15`);
    expect(claveIdempotenciaAlerta({ ...base, decision: 'por_agotarse' })).toBe(a);
    expect(claveIdempotenciaAlerta({ ...base, decision: 'agotado' })).toBe(
      `folios.por_agotarse/${EMPRESA}/produccion/39/caf-1/agotado`,
    );
    expect(claveIdempotenciaAlerta({ ...base, cafId: 'caf-2', decision: 'por_agotarse' })).not.toBe(
      a,
    );
    expect(a.length).toBeLessThanOrEqual(256);
  });
});

describe('alertarSiCruza', () => {
  it('si cruza, encola el webhook sin secretos y manda el correo a los administradores', async () => {
    const e = escenarioFolios();
    const d = await alertarSiCruza(
      { correo: e.correo },
      e.falso.cliente,
      CLAVE,
      { restante: 16, total: 100, cafEnUso: 'caf-1' },
      { restante: 15, total: 100, cafEnUso: 'caf-1' },
    );
    expect(d).toBe('por_agotarse');
    const evento = e.falso.rpcs.find((x) => x.nombre === 'encolar_evento');
    expect(evento?.args).toEqual({
      p_organizacion: ORG,
      p_evento: 'folios.por_agotarse',
      p_payload: {
        empresa_id: EMPRESA,
        rut_empresa: '76123456-0',
        ambiente: 'produccion',
        tipo_dte: 39,
        folios_disponibles: 15,
        folios_total: 100,
        umbral: 0.15,
        agotado: false,
        caf_id: 'caf-1',
      },
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
    const mensaje = e.correo.enviar.mock.calls[0]?.[0];
    // Solo el propietario (el lector no recibe la alerta).
    expect(mensaje?.para).toEqual(['duena@empresa.cl']);
    expect(mensaje?.claveIdempotencia).toBe(
      `folios.por_agotarse/${EMPRESA}/produccion/39/caf-1/15`,
    );
    expect(mensaje?.texto).toContain(
      'le quedan 15 folios de Boleta electrónica (39) en producción',
    );
    expect(mensaje?.texto).toContain(
      `https://boleteame.dev/servicios-andinos/folios?empresa=${EMPRESA}`,
    );
  });

  it('si no cruza no hace nada', async () => {
    const e = escenarioFolios();
    const d = await alertarSiCruza(
      { correo: e.correo },
      e.falso.cliente,
      CLAVE,
      { restante: 15, total: 100, cafEnUso: 'caf-1' },
      { restante: 14, total: 100, cafEnUso: 'caf-1' },
    );
    expect(d).toBeNull();
    expect(e.falso.escrituras).toEqual([]);
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('nunca lanza aunque falle el webhook y el correo', async () => {
    const e = escenarioFolios();
    e.falso.fallas.set('rpc:encolar_evento', { code: 'XX000', message: 'x' });
    e.correo.enviar.mockRejectedValueOnce(new Error('red'));
    const d = await alertarSiCruza(
      { correo: e.correo },
      e.falso.cliente,
      CLAVE,
      { restante: 1, total: 10, cafEnUso: 'c' },
      { restante: 0, total: 0, cafEnUso: null },
    );
    expect(d).toBe('agotado');
  });
});

describe('alertaDespuesDeAsignar (enganche de la Fase 7)', () => {
  it('reconstruye el antes: un folio más; cruza al dejar 15 de 100', async () => {
    const e = escenarioFolios({
      tablas: {
        cafs: [filaCaf({ id: 'c1', folio_desde: 1, folio_hasta: 100, siguiente_folio: 86 })],
      },
    });
    const d = await alertaDespuesDeAsignar({ correo: e.correo }, e.falso.cliente, CLAVE, {
      cafId: 'c1',
      folio: 85,
    });
    expect(d).toBe('por_agotarse');
  });

  it('al asignar el último folio del CAF (queda agotado), avisa que se agotó', async () => {
    const e = escenarioFolios({
      tablas: {
        cafs: [
          filaCaf({
            id: 'c1',
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 11,
            estado: 'agotado',
          }),
        ],
      },
    });
    const d = await alertaDespuesDeAsignar({ correo: e.correo }, e.falso.cliente, CLAVE, {
      cafId: 'c1',
      folio: 10,
    });
    expect(d).toBe('agotado');
  });
});
