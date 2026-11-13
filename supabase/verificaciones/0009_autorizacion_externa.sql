-- Verificación de la migración 0009_autorizacion_externa en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no dispara el trigger. Se ejecuta tal cual en el
-- SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben salir con
-- ok = true.
-- La prueba de comportamiento (un administrador registra la resolución de producción y la
-- empresa queda autorizada; la de certificación no la marca; authenticated sigue sin poder
-- poner autorizada_produccion a mano; idempotente; nunca desmarca) está en
-- rls-fase5-autorizacion-externa.sql, con transacción y rollback.
-- 9 comprobaciones: 1-4 la función; 5-6 el trigger; 7 el candado de 0001 sigue; 8 datos
-- consistentes; 9 migración registrada.
--
-- La función se busca con to_regprocedure (firma calificada), así el resultado no depende del
-- search_path de la sesión.

with funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, l.lanname,
         pg_get_function_result(p.oid) as resultado
  from (select to_regprocedure('public.tg_resolucion_autoriza_produccion()') as oid) f
  left join pg_proc p on p.oid = f.oid
  left join pg_language l on l.oid = p.prolang
),
disparador as (
  select t.tgname, t.tgtype, t.tgenabled, t.tgfoid, pg_get_triggerdef(t.oid) as definicion
  from pg_trigger t
  where t.tgrelid = 'public.resoluciones'::regclass
    and t.tgname = 'trg_50_resolucion_autoriza_produccion'
    and not t.tgisinternal
)
select * from (
  select 1 as n, 'la función tg_resolucion_autoriza_produccion() existe y devuelve trigger' as verificacion,
         coalesce((select oid is not null and resultado = 'trigger' from funcion), false) as ok,
         (select coalesce(resultado, 'NO EXISTE') from funcion) as detalle
  union all
  select 2, 'es plpgsql, security definer y fija search_path vacío',
         coalesce((select lanname = 'plpgsql' and prosecdef and proconfig @> array['search_path=""']
                     from funcion where oid is not null), false),
         (select coalesce(lanname, '-') || ' definer=' || coalesce(prosecdef::text, '-') || ' '
                 || coalesce(array_to_string(proconfig, ', '), '-') from funcion)
  union all
  select 3, 'ni PUBLIC, ni anon, ni authenticated tienen EXECUTE (no se llama por la API)',
         coalesce((select not has_function_privilege('anon', oid, 'execute')
                          and not has_function_privilege('authenticated', oid, 'execute')
                          and not exists (select 1 from aclexplode(proacl) a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion where oid is not null), false),
         (select coalesce(proacl::text, '-') from funcion)
  union all
  select 4, 'cuerpo: marca autorizada_produccion y autorizada_en (coalesce) filtrando por empresa y organización, y nunca desmarca',
         coalesce((select prosrc like '%new.ambiente = ''produccion'' and new.vigente%'
                          and prosrc like '%set autorizada_produccion = true%'
                          and prosrc like '%coalesce(autorizada_en, now())%'
                          and prosrc like '%where id = new.empresa_id%'
                          and prosrc like '%organizacion_id = new.organizacion_id%'
                          and prosrc not like '%autorizada_produccion = false%'
                     from funcion where oid is not null), false),
         null
  union all
  select 5, 'trigger trg_50_resolucion_autoriza_produccion en resoluciones: AFTER, por fila, INSERT y UPDATE, activo, con la función',
         coalesce((select (tgtype & 1) = 1           -- por fila
                          and (tgtype & 2) = 0       -- after
                          and (tgtype & 4) = 4       -- insert
                          and (tgtype & 16) = 16     -- update
                          and (tgtype & 8) = 0       -- no delete
                          and tgenabled = 'O'
                          and tgfoid = (select oid from funcion)
                     from disparador), false),
         (select coalesce(definicion, 'NO EXISTE') from disparador)
  union all
  select 6, 'el trigger solo corre con la resolución de producción vigente (WHEN)',
         coalesce((select definicion like '%WHEN%produccion%vigente%' from disparador), false),
         null
  union all
  select 7, 'tg_proteger_autorizacion sigue protegiendo empresas (authenticated no pone autorizada_produccion a mano)',
         exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.empresas'::regclass
                    and t.tgname = 'trg_05_proteger_autorizacion'
                    and t.tgenabled = 'O'
                    and t.tgfoid = to_regprocedure('public.tg_proteger_autorizacion()')),
         null
  union all
  select 8, 'ninguna empresa con resolución de producción vigente queda sin autorizar',
         not exists (select 1 from public.resoluciones r
                       join public.empresas e on e.id = r.empresa_id
                      where r.ambiente = 'produccion' and r.vigente
                        and (not e.autorizada_produccion or e.autorizada_en is null)),
         (select count(*) || ' resoluciones de producción vigentes' from public.resoluciones
           where ambiente = 'produccion' and vigente)
  union all
  select 9, 'migración registrada como 0009',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0009'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
