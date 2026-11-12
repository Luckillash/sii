import type { Database } from '@/server/supabase/tipos';

// Permisos de la UI derivados del rol (PLAN-SAAS Fase 2, punto 5). Puro: se importa
// desde componentes cliente y desde el servidor. Solo sirve para mostrar u ocultar
// acciones: la autoridad es RLS. Cada función replica una regla de
// supabase/migrations/0001_esquema_inicial.sql (§5 funciones de acceso, §15 triggers,
// §17 políticas); si cambia el SQL, cambia aquí y en permisos.test.ts.
//
// `Database` llega con `import type` (se borra al compilar): `tipos.ts` está en
// `server/` pero es solo tipos, sin `server-only`, así que no arrastra nada al bundle.

export type RolMiembro = Database['public']['Enums']['rol_miembro'];

/** De más a menos permisos (mismo orden que el enum `rol_miembro`). */
export const ROLES = [
  'propietario',
  'administrador',
  'emisor',
  'lector',
] as const satisfies readonly RolMiembro[];

export const ETIQUETA_ROL: Record<RolMiembro, string> = {
  propietario: 'Propietario',
  administrador: 'Administrador',
  emisor: 'Emisor',
  lector: 'Lector',
};

export const DESCRIPCION_ROL: Record<RolMiembro, string> = {
  propietario: 'Control total: gestionas a los propietarios y puedes eliminar la organización.',
  administrador:
    'Gestionas empresas, certificados, folios, equipo e integraciones, salvo a los propietarios.',
  emisor: 'Emites boletas y mantienes receptores y productos.',
  lector: 'Consultas documentos, envíos y reportes, sin hacer cambios.',
};

export function esRolMiembro(valor: unknown): valor is RolMiembro {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

/** `es_admin()`: propietario o administrador. Empresas, certificados, folios, equipo, API. */
export function puedeAdministrar(rol: RolMiembro): boolean {
  return rol === 'propietario' || rol === 'administrador';
}

/** `puede_emitir()`: propietario, administrador o emisor. Documentos, receptores, productos. */
export function puedeEmitir(rol: RolMiembro): boolean {
  return rol === 'propietario' || rol === 'administrador' || rol === 'emisor';
}

/**
 * `tiene_rol(org, '{propietario}')`: solo un propietario nombra, cambia o quita
 * propietarios (políticas alta/edicion/baja de `miembros_organizacion`) y borra la
 * organización.
 */
export function puedeGestionarPropietarios(rol: RolMiembro): boolean {
  return rol === 'propietario';
}

/**
 * Roles que `rolActor` puede dar a un miembro existente (política `edicion` de
 * `miembros_organizacion`, WITH CHECK): hace falta ser admin y, para dar
 * `propietario`, ser propietario. Emisor y lector: ninguno.
 */
export function rolesAsignables(rolActor: RolMiembro): RolMiembro[] {
  if (!puedeAdministrar(rolActor)) return [];
  return ROLES.filter((r) => r !== 'propietario' || puedeGestionarPropietarios(rolActor));
}

/**
 * Roles con que `rolActor` puede invitar: `crear_invitacion()` exige `es_admin()` y
 * `invitaciones.rol` tiene `check (rol <> 'propietario')`, así que nadie invita como
 * propietario (se invita con otro rol y después se promueve).
 */
export function rolesInvitables(rolActor: RolMiembro): RolMiembro[] {
  return rolesAsignables(rolActor).filter((r) => r !== 'propietario');
}

/**
 * ¿Puede `rolActor` cambiar a un miembro de `rolActual` a `rolNuevo`? Política
 * `edicion`: USING mira el rol actual y WITH CHECK el nuevo; tocar un propietario o
 * convertir a alguien en propietario exige ser propietario.
 *
 * No ve el trigger `tg_proteger_ultimo_propietario`: degradar al último propietario
 * falla en la base aunque esto diga `true`. Usa `quedaSinPropietario()` para eso.
 */
export function puedeCambiarRol(
  rolActor: RolMiembro,
  rolActual: RolMiembro,
  rolNuevo: RolMiembro,
): boolean {
  if (!puedeAdministrar(rolActor)) return false;
  const tocaPropietario = rolActual === 'propietario' || rolNuevo === 'propietario';
  return !tocaPropietario || puedeGestionarPropietarios(rolActor);
}

/**
 * ¿Puede `rolActor` sacar de la organización a un miembro con `rolObjetivo`? Política
 * `baja`: cualquiera puede salirse (`esUnoMismo`); a otros, un admin, y a un propietario
 * solo otro propietario. Igual que arriba, el trigger impide quitar al último propietario.
 */
export function puedeQuitarMiembro(
  rolActor: RolMiembro,
  rolObjetivo: RolMiembro,
  esUnoMismo: boolean,
): boolean {
  if (esUnoMismo) return true;
  if (!puedeAdministrar(rolActor)) return false;
  return rolObjetivo !== 'propietario' || puedeGestionarPropietarios(rolActor);
}

/**
 * `tg_proteger_ultimo_propietario`: ¿el cambio dejaría la organización sin propietario?
 * `true` si el miembro es propietario, deja de serlo (o sale) y no hay otro.
 *
 * @param propietarios cuántos propietarios tiene hoy la organización (incluido él).
 * @param rolNuevo el rol que tendría, o `null` si sale de la organización.
 */
export function quedaSinPropietario(
  rolActual: RolMiembro,
  rolNuevo: RolMiembro | null,
  propietarios: number,
): boolean {
  return rolActual === 'propietario' && rolNuevo !== 'propietario' && propietarios <= 1;
}
