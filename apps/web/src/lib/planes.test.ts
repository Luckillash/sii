import { describe, expect, it } from 'vitest';
import {
  caracteristicasPlan,
  limitesExcedidos,
  nivelCuota,
  type Plan,
  periodoUsoActual,
  textoLimite,
} from './planes';

function plan(parcial: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-pyme',
    codigo: 'pyme',
    nombre: 'Pyme',
    precio_mensual_clp: 14990,
    max_empresas: 1,
    max_usuarios: 3,
    max_boletas_mes: 1000,
    permite_produccion: true,
    incluye_api: false,
    incluye_webhooks: false,
    autoservicio: true,
    orden: 1,
    ...parcial,
  };
}

describe('nivelCuota', () => {
  it.each([
    [0, 100, 'normal'],
    [79, 100, 'normal'],
    [80, 100, 'aviso'],
    [99, 100, 'aviso'],
    [100, 100, 'lleno'],
    [120, 100, 'lleno'],
    [0, null, 'sin_limite'],
    [1_000_000, null, 'sin_limite'],
  ] as const)('%i de %s → %s', (usadas, maximo, nivel) => {
    expect(nivelCuota(usadas, maximo)).toBe(nivel);
  });

  it('el 80 % se redondea hacia arriba; máximo 0 está lleno desde el inicio', () => {
    // 80 % de 7 = 5,6 → avisa desde 6.
    expect(nivelCuota(5, 7)).toBe('normal');
    expect(nivelCuota(6, 7)).toBe('aviso');
    expect(nivelCuota(0, 0)).toBe('lleno');
  });
});

describe('textoLimite', () => {
  it('miles con punto o «Sin límite»', () => {
    expect(textoLimite(10000)).toBe('10.000');
    expect(textoLimite(null)).toBe('Sin límite');
  });
});

describe('limitesExcedidos', () => {
  const uso = { empresas: 1, usuarios: 3, boletasProduccionMes: 5000 };

  it('cabe (incluso justo en el límite y con más boletas que el cupo): vacío', () => {
    expect(limitesExcedidos(uso, plan())).toEqual([]);
  });

  it('sin límites: vacío', () => {
    expect(
      limitesExcedidos(
        { empresas: 50, usuarios: 90, boletasProduccionMes: 0 },
        plan({
          max_empresas: null,
          max_usuarios: null,
        }),
      ),
    ).toEqual([]);
  });

  it('empresas y usuarios de más, en singular o plural', () => {
    expect(limitesExcedidos({ ...uso, empresas: 2, usuarios: 4 }, plan())).toEqual([
      'El plan Pyme permite 1 empresa y tienes 2.',
      'El plan Pyme permite 3 usuarios y tienes 4.',
    ]);
    expect(
      limitesExcedidos(
        { ...uso, empresas: 4, usuarios: 2 },
        plan({ max_empresas: 3, max_usuarios: 1 }),
      ),
    ).toEqual([
      'El plan Pyme permite 3 empresas y tienes 4.',
      'El plan Pyme permite 1 usuario y tienes 2.',
    ]);
  });
});

describe('caracteristicasPlan', () => {
  it('producción con cupo, empresas, usuarios y API', () => {
    expect(caracteristicasPlan(plan())).toEqual([
      '1.000 boletas en producción al mes',
      '1 empresa',
      '3 usuarios',
      'Sin API ni webhooks',
    ]);
  });

  it('sin producción, sin límites y con API/webhooks', () => {
    expect(caracteristicasPlan(plan({ permite_produccion: false }))[0]).toBe(
      'Solo certificación ante el SII (sin producción)',
    );
    expect(
      caracteristicasPlan(
        plan({
          max_boletas_mes: null,
          max_empresas: null,
          max_usuarios: null,
          incluye_api: true,
          incluye_webhooks: true,
        }),
      ),
    ).toEqual([
      'Boletas en producción sin límite',
      'empresas sin límite',
      'usuarios sin límite',
      'API y avisos por webhook',
    ]);
    expect(caracteristicasPlan(plan({ incluye_api: true }))[3]).toBe('API');
  });
});

describe('periodoUsoActual (mes de Chile)', () => {
  it('borde de mes en verano (-03): 23:30 del 30-nov en Chile sigue en noviembre', () => {
    expect(periodoUsoActual(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-01');
    expect(periodoUsoActual(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01');
  });

  it('borde de mes en invierno (-04)', () => {
    expect(periodoUsoActual(new Date('2026-07-01T03:59:59Z'))).toBe('2026-06-01');
    expect(periodoUsoActual(new Date('2026-07-01T04:00:00Z'))).toBe('2026-07-01');
  });

  it('cambio de año', () => {
    expect(periodoUsoActual(new Date('2027-01-01T02:59:59Z'))).toBe('2026-12-01');
    expect(periodoUsoActual(new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
});
