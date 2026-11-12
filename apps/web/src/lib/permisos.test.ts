import { describe, expect, it } from 'vitest';
import { Constants } from '@/server/supabase/tipos';
import {
  DESCRIPCION_ROL,
  ETIQUETA_ROL,
  esRolMiembro,
  puedeAdministrar,
  puedeCambiarRol,
  puedeEmitir,
  puedeGestionarPropietarios,
  puedeQuitarMiembro,
  quedaSinPropietario,
  ROLES,
  type RolMiembro,
  rolesAsignables,
  rolesInvitables,
} from './permisos';

// Cada caso replica supabase/migrations/0001_esquema_inicial.sql:
//   es_admin      = tiene_rol('{propietario,administrador}')
//   puede_emitir  = tiene_rol('{propietario,administrador,emisor}')
//   miembros_organizacion: alta/edicion/baja exigen es_admin y, si el rol (actual o
//   nuevo) es propietario, tiene_rol('{propietario}'); baja también si es uno mismo.
//   invitaciones.rol: check (rol <> 'propietario'); crear_invitacion exige es_admin.

const ROLES_SQL = {
  es_admin: ['propietario', 'administrador'],
  puede_emitir: ['propietario', 'administrador', 'emisor'],
  propietario: ['propietario'],
} as const satisfies Record<string, readonly RolMiembro[]>;

/** tiene_rol(org, p_roles) para un miembro con `rol`. */
const tieneRol = (rol: RolMiembro, roles: readonly RolMiembro[]) => roles.includes(rol);

/** Política `edicion` de miembros_organizacion (USING sobre la fila vieja, CHECK sobre la nueva). */
function politicaEdicion(actor: RolMiembro, viejo: RolMiembro, nuevo: RolMiembro): boolean {
  const condicion = (rol: RolMiembro) =>
    tieneRol(actor, ROLES_SQL.es_admin) &&
    (rol !== 'propietario' || tieneRol(actor, ROLES_SQL.propietario));
  return condicion(viejo) && condicion(nuevo);
}

describe('roles', () => {
  it('ROLES coincide con el enum rol_miembro de la base, en el mismo orden', () => {
    expect([...ROLES]).toEqual([...Constants.public.Enums.rol_miembro]);
  });

  it('cada rol tiene etiqueta y descripción en el tono del design system', () => {
    expect(ETIQUETA_ROL).toEqual({
      propietario: 'Propietario',
      administrador: 'Administrador',
      emisor: 'Emisor',
      lector: 'Lector',
    });
    for (const rol of ROLES) {
      const d = DESCRIPCION_ROL[rol];
      expect(d.length).toBeGreaterThan(10);
      expect(d).not.toMatch(/[!¡]/);
      expect(d).not.toMatch(/\n/);
    }
  });

  it('esRolMiembro', () => {
    expect(esRolMiembro('emisor')).toBe(true);
    expect(esRolMiembro('dueño')).toBe(false);
    expect(esRolMiembro(null)).toBe(false);
  });
});

describe('funciones de acceso', () => {
  it.each(ROLES)('%s: puedeAdministrar = es_admin', (rol) => {
    expect(puedeAdministrar(rol)).toBe(tieneRol(rol, ROLES_SQL.es_admin));
  });
  it.each(ROLES)('%s: puedeEmitir = puede_emitir', (rol) => {
    expect(puedeEmitir(rol)).toBe(tieneRol(rol, ROLES_SQL.puede_emitir));
  });
  it.each(ROLES)('%s: puedeGestionarPropietarios = tiene_rol propietario', (rol) => {
    expect(puedeGestionarPropietarios(rol)).toBe(tieneRol(rol, ROLES_SQL.propietario));
  });
});

describe('equipo', () => {
  it('rolesAsignables', () => {
    expect(rolesAsignables('propietario')).toEqual([
      'propietario',
      'administrador',
      'emisor',
      'lector',
    ]);
    expect(rolesAsignables('administrador')).toEqual(['administrador', 'emisor', 'lector']);
    expect(rolesAsignables('emisor')).toEqual([]);
    expect(rolesAsignables('lector')).toEqual([]);
  });

  it('rolesInvitables: nadie invita como propietario', () => {
    expect(rolesInvitables('propietario')).toEqual(['administrador', 'emisor', 'lector']);
    expect(rolesInvitables('administrador')).toEqual(['administrador', 'emisor', 'lector']);
    expect(rolesInvitables('emisor')).toEqual([]);
    expect(rolesInvitables('lector')).toEqual([]);
  });

  it('puedeCambiarRol replica la política edicion para las 64 combinaciones', () => {
    for (const actor of ROLES) {
      for (const viejo of ROLES) {
        for (const nuevo of ROLES) {
          expect(puedeCambiarRol(actor, viejo, nuevo), `${actor}: ${viejo} → ${nuevo}`).toBe(
            politicaEdicion(actor, viejo, nuevo),
          );
        }
      }
    }
  });

  it('rolesAsignables es lo que permite la política para un miembro no propietario', () => {
    for (const actor of ROLES) {
      const permitidos = ROLES.filter((nuevo) => politicaEdicion(actor, 'lector', nuevo));
      expect(rolesAsignables(actor)).toEqual(permitidos);
    }
  });

  it('puedeQuitarMiembro replica la política baja', () => {
    for (const actor of ROLES) {
      for (const objetivo of ROLES) {
        const esperado =
          tieneRol(actor, ROLES_SQL.es_admin) &&
          (objetivo !== 'propietario' || tieneRol(actor, ROLES_SQL.propietario));
        expect(puedeQuitarMiembro(actor, objetivo, false), `${actor} quita ${objetivo}`).toBe(
          esperado,
        );
        // usuario_id = auth.uid(): cualquiera puede salirse.
        expect(puedeQuitarMiembro(actor, objetivo, true)).toBe(true);
      }
    }
  });

  it('quedaSinPropietario replica tg_proteger_ultimo_propietario', () => {
    expect(quedaSinPropietario('propietario', 'administrador', 1)).toBe(true);
    expect(quedaSinPropietario('propietario', null, 1)).toBe(true);
    expect(quedaSinPropietario('propietario', 'administrador', 2)).toBe(false);
    expect(quedaSinPropietario('propietario', 'propietario', 1)).toBe(false);
    expect(quedaSinPropietario('administrador', null, 1)).toBe(false);
  });
});
