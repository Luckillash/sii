import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from './planes';
import {
  armarGrilla,
  grillaPublica,
  ordenarPlanes,
  PLAN_DESTACADO,
  PLANES_RESPALDO,
  textoPlanAMedida,
  textoPlanCertificacion,
} from './planes-publicos';

const respaldo = (codigo: string): Plan => {
  const plan = PLANES_RESPALDO.find((p) => p.codigo === codigo);
  if (!plan) throw new Error(`sin ${codigo}`);
  return plan;
};

// Filas como las devuelve la base (ids reales, otro orden de llegada).
const DESDE_BASE: Plan[] = PLANES_RESPALDO.map((p, i) => ({ ...p, id: `uuid-${i}` })).reverse();

describe('ordenarPlanes', () => {
  it('ordena por orden, luego precio y código, sin mutar la entrada', () => {
    const entrada = [
      { ...respaldo('api'), orden: 1 },
      { ...respaldo('pyme'), orden: 1 },
      respaldo('certificacion'),
    ];
    const copia = [...entrada];
    expect(ordenarPlanes(entrada).map((p) => p.codigo)).toEqual(['certificacion', 'pyme', 'api']);
    expect(entrada).toEqual(copia);
  });
});

describe('armarGrilla', () => {
  it('reparte la grilla D5: certificación, tres tarjetas con precio y Empresa a medida', () => {
    const g = armarGrilla(DESDE_BASE);
    expect(g.certificacion?.codigo).toBe('certificacion');
    expect(g.tarjetas.map((p) => p.codigo)).toEqual(['pyme', 'contador', 'api']);
    expect(g.aMedida?.codigo).toBe('empresa');
  });

  it('el plan destacado está entre las tarjetas', () => {
    expect(armarGrilla(PLANES_RESPALDO).tarjetas.map((p) => p.codigo)).toContain(
      PLAN_DESTACADO.codigo,
    );
  });

  it('sin certificación ni plan a medida, quedan en null', () => {
    const g = armarGrilla([respaldo('pyme')]);
    expect(g).toEqual({ certificacion: null, tarjetas: [respaldo('pyme')], aMedida: null });
  });

  it('un plan con precio que no se contrata solo no va a las tarjetas', () => {
    const g = armarGrilla([{ ...respaldo('pyme'), autoservicio: false }, respaldo('api')]);
    expect(g.tarjetas.map((p) => p.codigo)).toEqual(['api']);
    expect(g.aMedida?.codigo).toBe('pyme');
  });
});

describe('grillaPublica', () => {
  it('usa lo leído de la base si trae planes con precio', () => {
    const { grilla, respaldo: usoRespaldo } = grillaPublica(DESDE_BASE);
    expect(usoRespaldo).toBe(false);
    expect(grilla.tarjetas[0]?.id).toMatch(/^uuid-/);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['vacío', []],
    ['sin planes con precio', [respaldo('certificacion'), respaldo('empresa')]],
  ])('cae al respaldo con %s', (_, filas) => {
    const { grilla, respaldo: usoRespaldo } = grillaPublica(filas);
    expect(usoRespaldo).toBe(true);
    expect(grilla).toEqual(armarGrilla(PLANES_RESPALDO));
    expect(grilla.tarjetas.map((p) => p.precio_mensual_clp)).toEqual([14990, 49990, 39990]);
  });
});

describe('textos', () => {
  it('plan Certificación', () => {
    expect(textoPlanCertificacion(respaldo('certificacion'))).toBe(
      'Gratis y sin plazo, con 1 empresa y 2 usuarios.',
    );
    expect(
      textoPlanCertificacion({ ...respaldo('certificacion'), max_empresas: 2, max_usuarios: null }),
    ).toBe('Gratis y sin plazo, con 2 empresas.');
  });

  it('plan a medida', () => {
    expect(textoPlanAMedida(respaldo('empresa'))).toBe(
      'Para volúmenes mayores: empresas, usuarios y boletas sin límite, con API y webhooks.',
    );
    expect(
      textoPlanAMedida({ ...respaldo('empresa'), max_usuarios: 50, incluye_webhooks: false }),
    ).toBe('Para volúmenes mayores: empresas y boletas sin límite, con API.');
  });
});

// El respaldo tiene que decir lo mismo que la migración que carga la grilla D5.
describe('PLANES_RESPALDO frente a 0015_planes_comerciales.sql', () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL('../../../../supabase/migrations/0015_planes_comerciales.sql', import.meta.url),
    ),
    'utf8',
  );
  const numero = (v: string) => (v === 'null' ? null : Number(v));
  const filas = new Map<string, Omit<Plan, 'id'> & { activo: boolean }>();
  const patron =
    /\('(\w+)',\s*'([^']+)',\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(\d+)\)/g;
  for (const m of sql.matchAll(patron)) {
    const [, codigo, nombre, precio, emp, usu, bol, prod, api, wh, activo, auto, orden] =
      m as unknown as string[];
    filas.set(codigo as string, {
      codigo: codigo as string,
      nombre: nombre as string,
      precio_mensual_clp: Number(precio),
      max_empresas: numero(emp as string),
      max_usuarios: numero(usu as string),
      max_boletas_mes: numero(bol as string),
      permite_produccion: prod === 'true',
      incluye_api: api === 'true',
      incluye_webhooks: wh === 'true',
      activo: activo === 'true',
      autoservicio: auto === 'true',
      orden: Number(orden),
    });
  }

  it('encuentra la grilla en la migración', () => {
    expect([...filas.keys()].sort()).toEqual([
      'api',
      'certificacion',
      'contador',
      'emprendedor',
      'empresa',
      'pyme',
    ]);
  });

  it('cada plan activo de la migración está en el respaldo con los mismos valores', () => {
    const activos = [...filas.values()].filter((f) => f.activo);
    expect(PLANES_RESPALDO.map((p) => p.codigo).sort()).toEqual(
      activos.map((f) => f.codigo).sort(),
    );
    for (const { activo: _, ...fila } of activos) {
      const { id: __, ...plan } = respaldo(fila.codigo);
      expect(plan, fila.codigo).toEqual(fila);
    }
  });
});
