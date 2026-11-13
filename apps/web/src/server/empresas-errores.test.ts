import { describe, expect, it } from 'vitest';
import {
  MENSAJE_GENERICO,
  mensajeCupoEmpresas,
  type OperacionEmpresa,
  RUT_DUPLICADO,
  SIN_PERMISO,
  SIN_PLAN_VIGENTE,
  traducirErrorEmpresa,
} from './empresas-errores';

const OPERACIONES: OperacionEmpresa[] = ['crear', 'editar', 'activar', 'desactivar', 'resolucion'];

const CUPO = { code: 'P0001', message: 'El plan Certificación permite como máximo 1 empresa(s)' };
const DUPLICADO = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "empresas_organizacion_id_rut_key"',
};

describe('traducirErrorEmpresa', () => {
  it('23505 al crear: el RUT ya está en la organización', () => {
    expect(traducirErrorEmpresa(DUPLICADO, 'crear')).toEqual(RUT_DUPLICADO);
  });

  it('23505 en resoluciones: otra registrada al mismo tiempo; en otras operaciones, genérico', () => {
    expect(traducirErrorEmpresa(DUPLICADO, 'resolucion').titulo).toBe(
      'Se registró otra resolución al mismo tiempo',
    );
    expect(traducirErrorEmpresa(DUPLICADO, 'editar')).toEqual(MENSAJE_GENERICO);
  });

  it('P0001 de tg_limite_empresas: cupo del plan', () => {
    const m = traducirErrorEmpresa(CUPO, 'crear');
    expect(m.titulo).toBe('El plan Certificación permite hasta 1 empresa');
    expect(m.detalle).toMatch(/desactivadas también cuentan/);
    expect(mensajeCupoEmpresas('Pyme', 3).titulo).toBe('El plan Pyme permite hasta 3 empresas');
  });

  it('P0001 de tg_limite_empresas: sin suscripción vigente', () => {
    expect(
      traducirErrorEmpresa(
        { code: 'P0001', message: 'La organización no tiene una suscripción vigente' },
        'crear',
      ),
    ).toEqual(SIN_PLAN_VIGENTE);
  });

  it('P0001 de tg_proteger_autorizacion', () => {
    const m = traducirErrorEmpresa(
      {
        code: 'P0001',
        message: 'autorizada_produccion solo la cambia el sistema (estado P91 del SII)',
      },
      'editar',
    );
    expect(m.titulo).toBe('La autorización a producción la marca el sistema');
  });

  it('42501 (RLS o «Sin permiso» de registrar_resolucion) es falta de permiso', () => {
    for (const op of OPERACIONES) {
      expect(
        traducirErrorEmpresa(
          { code: '42501', message: 'new row violates row-level security policy for table' },
          op,
        ),
      ).toEqual(SIN_PERMISO);
    }
    expect(traducirErrorEmpresa({ code: '42501', message: 'Sin permiso' }, 'resolucion')).toEqual(
      SIN_PERMISO,
    );
  });

  it('P0002 de registrar_resolucion o 23503: la empresa no existe', () => {
    expect(
      traducirErrorEmpresa({ code: 'P0002', message: 'La empresa no existe' }, 'resolucion').titulo,
    ).toBe('No encontramos la empresa');
    expect(traducirErrorEmpresa({ code: '23503' }, 'resolucion').titulo).toBe(
      'No encontramos la empresa',
    );
  });

  it('23514: checks de la empresa y de la resolución', () => {
    expect(
      traducirErrorEmpresa(
        { code: '23514', message: 'value for domain rut violates check constraint "rut_check"' },
        'crear',
      ).titulo,
    ).toBe('Los datos no son válidos');
    expect(
      traducirErrorEmpresa(
        { code: '23514', message: 'En certificación el número de resolución es 0' },
        'resolucion',
      ).titulo,
    ).toBe('Revisa los datos de la resolución');
    expect(traducirErrorEmpresa({ code: '22004' }, 'resolucion').titulo).toBe(
      'Revisa los datos de la resolución',
    );
    expect(traducirErrorEmpresa({ code: '22007' }, 'resolucion').titulo).toBe(
      'Los datos no son válidos',
    );
  });

  it('cualquier otro error (o ninguno) es el genérico, sin filtrar el mensaje original', () => {
    expect(
      traducirErrorEmpresa({ code: 'XX000', message: 'detalle interno con datos' }, 'crear'),
    ).toEqual(MENSAJE_GENERICO);
    expect(
      traducirErrorEmpresa(
        { code: 'PGRST202', message: 'Could not find the function' },
        'resolucion',
      ),
    ).toEqual(MENSAJE_GENERICO);
    expect(traducirErrorEmpresa(null, 'editar')).toEqual(MENSAJE_GENERICO);
    expect(traducirErrorEmpresa(undefined, 'desactivar')).toEqual(MENSAJE_GENERICO);
  });

  it('ningún mensaje lleva exclamaciones ni repite el mensaje de Postgres', () => {
    const casos = [
      CUPO,
      DUPLICADO,
      { code: '42501' },
      { code: '23514' },
      { code: 'P0002' },
      { code: '22004' },
      null,
    ];
    for (const caso of casos) {
      for (const op of OPERACIONES) {
        const m = traducirErrorEmpresa(caso, op);
        const texto = `${m.titulo} ${m.detalle}`;
        expect(texto).not.toMatch(/[!¡]/);
        expect(texto).not.toMatch(/violates|constraint|duplicate/);
      }
    }
  });
});
