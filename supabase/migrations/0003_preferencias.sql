-- =============================================================================
-- 0003 · Preferencias del usuario y vista previa de invitaciones (PLAN-SAAS Fase 2)
--
-- (El plan la llamaba `0005_preferencias`; el número definitivo es por orden de
-- creación, PLAN-SAAS §6.)
--
-- 1. `perfiles`: tema de la interfaz y última organización/empresa abiertas, para
--    que `/bienvenida` lleve a cada persona donde estaba. Son pistas: la app vuelve a
--    comprobar la membresía antes de usarlas (src/server/sesion.ts).
--    Privilegios: 0001 no da privilegios por columna sobre `perfiles`; `authenticated`
--    tiene UPDATE sobre la tabla completa (los grants por defecto de Supabase), que ya
--    alcanza a las columnas nuevas. La política `edicion_propia` sigue limitando la
--    edición a la fila propia. No hace falta ningún grant.
--
-- 2. `ver_invitacion(token)`: la página /invitacion/[token] muestra organización,
--    correo, rol y vencimiento ANTES de que la persona inicie sesión (rol `anon`). Sin
--    acceso a la tabla `invitaciones` (sigue siendo solo de administradores): la
--    función devuelve una fila solo con el token correcto (sha256 hex, igual que
--    `aceptar_invitacion`) de una invitación pendiente y vigente; si no, cero filas.
--    El token tiene 244 bits aleatorios (`token_aleatorio()`): no se puede adivinar.
--
-- Aditiva: columnas con default o nulas y una función nueva. Sin índices: los de
-- `ultima_organizacion` y `ultima_empresa` van con los demás índices de FK
-- (PLAN-SAAS §6, `indices_fk`).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Preferencias en perfiles
-- -----------------------------------------------------------------------------

alter table public.perfiles
  add column tema text not null default 'sistema'
    constraint perfiles_tema_check check (tema in ('sistema', 'claro', 'oscuro')),
  add column ultima_organizacion uuid
    constraint perfiles_ultima_organizacion_fkey
    references public.organizaciones (id) on delete set null,
  add column ultima_empresa uuid
    constraint perfiles_ultima_empresa_fkey
    references public.empresas (id) on delete set null;

comment on column public.perfiles.tema is
  'Tema de la interfaz: sistema (sigue al sistema operativo), claro u oscuro.';
comment on column public.perfiles.ultima_organizacion is
  'Última organización abierta. Pista para /bienvenida: la app revisa la membresía.';
comment on column public.perfiles.ultima_empresa is
  'Última empresa abierta. Pista: la app revisa que sea de una organización propia.';

-- -----------------------------------------------------------------------------
-- 2. Vista previa de una invitación por su token
-- -----------------------------------------------------------------------------

create function public.ver_invitacion(p_token text)
returns table (
  organizacion_nombre text,
  correo              text,
  rol                 public.rol_miembro,
  expira_en           timestamptz
)
language sql
stable security definer
set search_path = ''
as $$
  select o.nombre, i.correo, i.rol, i.expira_en
  from public.invitaciones i
  join public.organizaciones o on o.id = i.organizacion_id
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and i.aceptada_en is null
    and i.expira_en > now();
$$;

comment on function public.ver_invitacion(text) is
  'Datos de una invitación pendiente y vigente, por el token del enlace. Cero filas si no calza.';

revoke execute on function public.ver_invitacion(text) from public, anon, authenticated;
grant execute on function public.ver_invitacion(text) to anon, authenticated, service_role;

commit;
