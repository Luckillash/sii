-- Verificación de la migración 0004_cupo_sin_suscripcion en el proyecto de Supabase (producción).
--
-- SOLO LECTURA. Cada fila es una comprobación: todas deben salir con ok = true.
-- La prueba de comportamiento (organización `morosa` que no acepta más miembros) se hace
-- con la simulación de roles en transacción con rollback (rls-fase2-tenancy.sql).

with funcion as (
  select p.prosrc, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'exigir_cupo_usuarios'
)
select * from (
  select 1 as n, 'exigir_cupo_usuarios rechaza sin suscripción vigente' as verificacion,
         coalesce((select prosrc like '%v_plan.id is null%'
                          and prosrc like '%no tiene una suscripción vigente%' from funcion), false) as ok,
         null::text as detalle
  union all
  select 2, 'sigue siendo security definer con search_path vacío',
         coalesce((select prosecdef and proconfig @> array['search_path=""'] from funcion), false),
         (select array_to_string(proconfig, ', ') from funcion)
  union all
  select 3, 'authenticated no la ejecuta directamente',
         not has_function_privilege('authenticated', 'public.exigir_cupo_usuarios(uuid)', 'execute'),
         null
) v
order by n;
