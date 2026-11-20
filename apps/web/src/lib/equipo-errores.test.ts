import { describe, expect, it } from 'vitest';
import { MENSAJE_GENERICO, mensajeCupo, traducirErrorEquipo } from './equipo-errores';

const ULTIMO_PROPIETARIO = {
  code: 'P0001',
  message: 'La organización debe tener al menos un propietario',
};
const CUPO = { code: 'P0001', message: 'El plan Certificación permite como máximo 2 usuario(s)' };

describe('traducirErrorEquipo', () => {
  it('último propietario: el mensaje depende de la operación', () => {
    expect(traducirErrorEquipo(ULTIMO_PROPIETARIO, 'salir').titulo).toBe(
      'Eres el único propietario',
    );
    expect(traducirErrorEquipo(ULTIMO_PROPIETARIO, 'quitar').titulo).toBe(
      'No puedes quitar al único propietario',
    );
    expect(traducirErrorEquipo(ULTIMO_PROPIETARIO, 'cambiar_rol').titulo).toBe(
      'La organización quedaría sin propietario',
    );
  });

  it('cupo de usuarios del plan (exigir_cupo_usuarios)', () => {
    const m = traducirErrorEquipo(CUPO, 'aceptar');
    expect(m.titulo).toBe('El plan Certificación permite hasta 2 usuarios');
    expect(m.detalle).toMatch(/administrador/);
    expect(traducirErrorEquipo(CUPO, 'invitar').detalle).toMatch(/Quita a un miembro/);
    expect(mensajeCupo('Pyme', 1, 'invitar').titulo).toBe('El plan Pyme permite hasta 1 usuario');
  });

  it('sin suscripción vigente (0004_cupo_sin_suscripcion)', () => {
    const m = traducirErrorEquipo(
      { code: 'P0001', message: 'La organización no tiene una suscripción vigente' },
      'aceptar',
    );
    expect(m.titulo).toBe('La organización no tiene un plan vigente');
    expect(m.detalle).toMatch(/propietario/);
  });

  it('invitación inválida o vencida (aceptar_invitacion, 42501) gana al 42501 genérico', () => {
    const m = traducirErrorEquipo(
      { code: '42501', message: 'Invitación inválida o vencida' },
      'aceptar',
    );
    expect(m.titulo).toMatch(/venció, ya se usó/);
  });

  it('42501 de RLS o de crear_invitacion es falta de permiso', () => {
    expect(traducirErrorEquipo({ code: '42501', message: 'Sin permiso' }, 'invitar').titulo).toBe(
      'No tienes permiso para hacer esto',
    );
    expect(
      traducirErrorEquipo(
        { code: '42501', message: 'new row violates row-level security policy' },
        'cambiar_rol',
      ).titulo,
    ).toBe('No tienes permiso para hacer esto');
  });

  it('23505 al invitar es una invitación duplicada; en otra operación, genérico', () => {
    const duplicada = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect(traducirErrorEquipo(duplicada, 'invitar').titulo).toBe(
      'Ya hay una invitación pendiente para ese correo',
    );
    expect(traducirErrorEquipo(duplicada, 'quitar')).toEqual(MENSAJE_GENERICO);
  });

  it('checks y valores inválidos', () => {
    expect(traducirErrorEquipo({ code: '23514' }, 'invitar').titulo).toBe(
      'Los datos no son válidos',
    );
  });

  it('cualquier otro error (o ninguno) es el genérico, sin filtrar el mensaje original', () => {
    expect(traducirErrorEquipo({ code: 'XX000', message: 'detalle interno' }, 'revocar')).toEqual(
      MENSAJE_GENERICO,
    );
    expect(traducirErrorEquipo(null, 'revocar')).toEqual(MENSAJE_GENERICO);
  });

  it('ningún mensaje lleva exclamaciones', () => {
    const casos = [
      ULTIMO_PROPIETARIO,
      CUPO,
      { code: '42501' },
      { code: '23505' },
      { code: '23514' },
      null,
    ];
    for (const caso of casos) {
      for (const op of ['invitar', 'salir', 'aceptar'] as const) {
        const m = traducirErrorEquipo(caso, op);
        expect(`${m.titulo} ${m.detalle}`).not.toMatch(/[!¡]/);
      }
    }
  });
});
