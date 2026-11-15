import { describe, expect, it } from 'vitest';
import { calcularFolios } from '@/components/boleteame/folios';
import {
  disponibilidadDe,
  enteroDeTexto,
  esquemaAnulacion,
  esquemaSolicitud,
  estadoDisponibilidad,
  revisionCalza,
  tieneCola,
  validarRangoAnulacion,
} from './folios';

const caf = (desde: number, hasta: number, siguiente: number, estado = 'activo' as const) => ({
  id: `${desde}`,
  desde,
  hasta,
  siguiente,
  estado,
});

describe('disponibilidadDe', () => {
  it('suma los CAF activos con folios libres y elige el de desde más bajo', () => {
    const d = disponibilidadDe([caf(101, 200, 101), caf(1, 100, 91), caf(201, 210, 211)]);
    expect(d).toEqual({ restante: 110, total: 200, cafEnUso: '1' });
  });

  it('con un solo CAF da el mismo estado que el MedidorFolios', () => {
    for (const siguiente of [1, 85, 86, 100, 101]) {
      const d = disponibilidadDe([caf(1, 100, siguiente)]);
      const medidor = calcularFolios({ desde: 1, hasta: 100, siguiente });
      expect(estadoDisponibilidad(d)).toBe(medidor.estado);
    }
  });

  it('ignora los anulados y agotados', () => {
    expect(disponibilidadDe([{ ...caf(1, 10, 5), estado: 'anulado' }]).restante).toBe(0);
  });
});

describe('validarRangoAnulacion', () => {
  const c = caf(1, 100, 91);
  it('acepta folios asignados sin usar y la cola completa', () => {
    expect(validarRangoAnulacion(c, 5, 10)).toBeNull();
    expect(validarRangoAnulacion(c, 91, 100)).toBeNull();
    expect(validarRangoAnulacion(c, 80, 100)).toBeNull();
  });
  it('rechaza rangos invertidos, fuera del CAF y colas parciales', () => {
    expect(validarRangoAnulacion(c, 10, 5)).toContain('mayor');
    expect(validarRangoAnulacion(c, 0, 5)).toContain('dentro del CAF');
    expect(validarRangoAnulacion(c, 91, 95)).toContain('desde el 91');
    expect(validarRangoAnulacion(c, 92, 100)).toContain('desde el 91');
    expect(validarRangoAnulacion(caf(1, 10, 11), 5, 10)).toBeNull();
  });
  it('tieneCola', () => {
    expect(tieneCola(c)).toBe(true);
    expect(tieneCola(caf(1, 10, 11))).toBe(false);
  });
});

describe('esquemas', () => {
  it('la cantidad es obligatoria y entera entre 1 y 10.000', () => {
    const base = { nivel: 'ensayo', tipoDte: 39, ambiente: 'produccion' };
    expect(esquemaSolicitud.safeParse({ ...base, cantidad: 100 }).success).toBe(true);
    expect(esquemaSolicitud.safeParse(base).success).toBe(false);
    expect(esquemaSolicitud.safeParse({ ...base, cantidad: 10_001 }).success).toBe(false);
    expect(esquemaSolicitud.safeParse({ ...base, cantidad: 1.5 }).success).toBe(false);
    expect(esquemaSolicitud.safeParse({ ...base, cantidad: 5, tipoDte: 33 }).success).toBe(false);
  });
  it('el motivo de anulación es obligatorio', () => {
    const base = { cafId: '77777777-7777-4777-8777-777777777777', desde: 1, hasta: 2 };
    expect(esquemaAnulacion.safeParse({ ...base, motivo: '  ' }).success).toBe(false);
    expect(esquemaAnulacion.safeParse({ ...base, motivo: 'x'.repeat(501) }).success).toBe(false);
    expect(esquemaAnulacion.safeParse({ ...base, motivo: 'ok' }).success).toBe(true);
  });
  it('enteroDeTexto', () => {
    expect(enteroDeTexto('')).toBeUndefined();
    expect(enteroDeTexto('1.000')).toBe(1000);
    expect(enteroDeTexto('1,5')).toBeNaN();
  });
});

describe('revisionCalza', () => {
  const revision = {
    revisionId: 'r',
    ambiente: 'produccion' as const,
    tipoDte: 39 as const,
    cantidad: 50,
    folioInicial: null,
    desde: 1,
    hasta: 50,
  };
  it('solo con el mismo ambiente, tipo, cantidad y folio inicial', () => {
    const resumen = {
      ambiente: 'produccion' as const,
      tipoDte: 39 as const,
      cantidad: 50,
      folioInicial: null,
    };
    expect(revisionCalza(revision, resumen)).toBe(true);
    expect(revisionCalza(revision, { ...resumen, cantidad: 51 })).toBe(false);
    expect(revisionCalza(revision, { ...resumen, tipoDte: 41 })).toBe(false);
    expect(revisionCalza(null, resumen)).toBe(false);
  });
});
