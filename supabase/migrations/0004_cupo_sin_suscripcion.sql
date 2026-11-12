-- =============================================================================
-- 0004 · Cupo de usuarios sin suscripción vigente (PLAN-SAAS Fase 2)
--
-- Defecto encontrado con supabase/verificaciones/rls-fase2-tenancy.sql: cuando la
-- organización no tiene suscripción vigente (`morosa` o `cancelada`),
-- `plan_vigente()` devuelve null, `exigir_cupo_usuarios()` leía `max_usuarios`
-- nulo como «sin límite» y dejaba entrar miembros sin tope. `tg_limite_empresas`,
-- en el mismo estado, ya rechazaba con «La organización no tiene una suscripción
-- vigente». Esta migración iguala el criterio.
--
-- No afecta a `crear_organizacion()`: el primer miembro se inserta cuando quien
-- crea aún no es administrador, y `tg_limite_usuarios` no llama a esta función.
--
-- `create or replace` conserva los privilegios que 0001 dio a la función.
-- =============================================================================

begin;

create or replace function public.exigir_cupo_usuarios(p_organizacion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.planes := public.plan_vigente(p_organizacion);
begin
  if v_plan.id is null then
    raise exception 'La organización no tiene una suscripción vigente';
  end if;
  if v_plan.max_usuarios is not null and (
       select count(*) from public.miembros_organizacion where organizacion_id = p_organizacion
     ) >= v_plan.max_usuarios then
    raise exception 'El plan % permite como máximo % usuario(s)', v_plan.nombre, v_plan.max_usuarios;
  end if;
end;
$$;

commit;
