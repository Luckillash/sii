-- Verificación de la migración 0011_folios en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos, no llama a anular_folios ni dispara el trigger.
-- Se ejecuta tal cual en el SQL Editor o con el MCP `execute_sql`. Cada fila es una
-- comprobación: todas deben salir con ok = true.
-- La prueba de comportamiento (un administrador anula folios asignados y la cola completa;
-- emisor, lector y otra organización no pueden; folios usados, cola parcial y rango fuera
-- del CAF se rechazan; repetir devuelve 0; asignar_folio ya no usa un CAF anulado; un CAF
-- traslapado da 23P01 y registrar_caf sigue idempotente) está en rls-fase6-folios.sql, con
-- transacción y rollback.
-- 18 comprobaciones: 1-9 anular_folios; 10-11 el trigger contra traslapes; 12 datos sin
-- traslapes; 13-14 folios_anulados sin insert directo (política alta y privilegios);
-- 15-17 Realtime de cafs y folios_anulados (publicación, RLS, sin secretos); 18 migración
-- registrada.
--
-- Las funciones se buscan con to_regprocedure (firma calificada), así el resultado no
-- depende del search_path de la sesión. Antes de migrar salen true 12, 16 y 17 (lo que ya
-- era cierto con 0001) y el resto false.

with funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, l.lanname, p.proargnames,
         pg_get_function_result(p.oid) as resultado,
         obj_description(p.oid, 'pg_proc') as comentario
  from (select to_regprocedure('public.anular_folios(uuid, integer, integer, text)') as oid) f
  left join pg_proc p on p.oid = f.oid
  left join pg_language l on l.oid = p.prolang
),
funcion_trigger as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, l.lanname,
         pg_get_function_result(p.oid) as resultado
  from (select to_regprocedure('public.tg_caf_sin_traslape()') as oid) f
  left join pg_proc p on p.oid = f.oid
  left join pg_language l on l.oid = p.prolang
),
disparador as (
  select t.tgname, t.tgtype, t.tgenabled, t.tgfoid, pg_get_triggerdef(t.oid) as definicion,
         (select array_agg(a.attname::text order by a.attname::text)
            from unnest(t.tgattr::int2[]) as k (attnum)
            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum) as columnas
  from pg_trigger t
  where t.tgrelid = 'public.cafs'::regclass
    and t.tgname = 'trg_20_caf_sin_traslape'
    and not t.tgisinternal
),
traslapes as (
  select a.id as caf_a, b.id as caf_b, a.empresa_id, a.ambiente, a.tipo_dte,
         a.folio_desde || '-' || a.folio_hasta || ' / ' || b.folio_desde || '-' || b.folio_hasta as rangos
  from public.cafs a
  join public.cafs b
    on b.empresa_id = a.empresa_id
   and b.ambiente = a.ambiente
   and b.tipo_dte = a.tipo_dte
   and a.id < b.id
   and a.folio_desde <= b.folio_hasta
   and b.folio_desde <= a.folio_hasta
)
select * from (
  select 1 as n, 'anular_folios(uuid, integer, integer, text) existe y devuelve integer' as verificacion,
         coalesce((select oid is not null and resultado = 'integer' from funcion), false) as ok,
         (select coalesce(resultado, 'NO EXISTE con esa firma') from funcion) as detalle
  union all
  select 2, 'nombres de los parámetros (los que usa la app al llamar por RPC)',
         coalesce((select proargnames = array['p_caf', 'p_desde', 'p_hasta', 'p_motivo']
                     from funcion where oid is not null), false),
         (select coalesce(array_to_string(proargnames, ', '), '-') from funcion)
  union all
  select 3, 'es plpgsql, security definer y fija search_path vacío',
         coalesce((select lanname = 'plpgsql' and prosecdef and proconfig @> array['search_path=""']
                     from funcion where oid is not null), false),
         (select coalesce(lanname, '-') || ' definer=' || coalesce(prosecdef::text, '-') || ' '
                 || coalesce(array_to_string(proconfig, ', '), '-') from funcion)
  union all
  select 4, 'service_role la ejecuta',
         coalesce((select has_function_privilege('service_role', oid, 'execute')
                     from funcion where oid is not null), false),
         (select coalesce(proacl::text, '-') from funcion)
  union all
  select 5, 'authenticated la ejecuta (la llama el administrador con su sesión)',
         coalesce((select has_function_privilege('authenticated', oid, 'execute')
                     from funcion where oid is not null), false),
         null
  union all
  select 6, 'anon no la ejecuta',
         coalesce((select not has_function_privilege('anon', oid, 'execute')
                     from funcion where oid is not null), false),
         null
  union all
  select 7, 'PUBLIC no tiene EXECUTE',
         coalesce((select not exists (select 1 from aclexplode(proacl) a
                                       where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion where oid is not null), false),
         null
  union all
  select 8, 'tiene comentario',
         coalesce((select length(comentario) > 0 from funcion where oid is not null), false),
         (select comentario from funcion)
  union all
  select 9, 'cuerpo: permiso (service_role o es_admin), candado del CAF, documentos usados (23503), on conflict y cierre del CAF en la cola completa',
         coalesce((select prosrc like '%auth.role()%service_role%'
                          and prosrc like '%public.es_admin(v_org)%'
                          and prosrc like '%for update%'
                          and prosrc like '%d.estado <> ''anulado''%'
                          and prosrc like '%errcode = ''23503''%'
                          and prosrc like '%on conflict (caf_id, folio) do nothing%'
                          and prosrc like '%p_hasta <> v_caf.folio_hasta%'
                          and prosrc like '%siguiente_folio = folio_hasta + 1%'
                          and prosrc like '%estado = ''anulado''%'
                     from funcion where oid is not null), false),
         null
  union all
  select 10, 'tg_caf_sin_traslape() existe, devuelve trigger, es plpgsql, security definer, search_path vacío y sin EXECUTE para PUBLIC, anon ni authenticated',
         coalesce((select resultado = 'trigger' and lanname = 'plpgsql' and prosecdef
                          and proconfig @> array['search_path=""']
                          and prosrc like '%for no key update%'
                          and prosrc like '%errcode = ''23P01''%'
                          and not has_function_privilege('anon', oid, 'execute')
                          and not has_function_privilege('authenticated', oid, 'execute')
                          and not exists (select 1 from aclexplode(proacl) a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion_trigger where oid is not null), false),
         (select coalesce(resultado, 'NO EXISTE') || ' ' || coalesce(proacl::text, '-') from funcion_trigger)
  union all
  select 11, 'trigger trg_20_caf_sin_traslape en cafs: BEFORE, por fila, INSERT y UPDATE OF ambiente, empresa_id, folio_desde, folio_hasta, tipo_dte, activo',
         coalesce((select (tgtype & 1) = 1           -- por fila
                          and (tgtype & 2) = 2       -- before
                          and (tgtype & 4) = 4       -- insert
                          and (tgtype & 16) = 16     -- update
                          and (tgtype & 8) = 0       -- no delete
                          and tgenabled = 'O'
                          and tgfoid = (select oid from funcion_trigger)
                          and columnas = array['ambiente', 'empresa_id', 'folio_desde', 'folio_hasta', 'tipo_dte']
                     from disparador), false),
         (select coalesce(definicion, 'NO EXISTE') from disparador)
  union all
  select 12, 'ningún par de CAF de la misma empresa, ambiente y tipo se traslapa',
         not exists (select 1 from traslapes),
         (select count(*) || ' CAF; '
                 || coalesce((select string_agg(ambiente::text || ' ' || tipo_dte || ': ' || rangos, '; ')
                                from traslapes), 'sin traslapes')
            from public.cafs)
  union all
  select 13, 'folios_anulados ya no tiene la política alta (insert de administradores); solo queda lectura',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'folios_anulados'
                        and (policyname = 'alta' or cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))),
         (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'folios_anulados')
  union all
  select 14, 'authenticated solo lee folios_anulados (sin INSERT, UPDATE, DELETE ni TRUNCATE) y anon no tiene nada',
         has_table_privilege('authenticated', 'public.folios_anulados', 'select')
         and not has_table_privilege('authenticated', 'public.folios_anulados', 'insert')
         and not has_table_privilege('authenticated', 'public.folios_anulados', 'update')
         and not has_table_privilege('authenticated', 'public.folios_anulados', 'delete')
         and not has_table_privilege('authenticated', 'public.folios_anulados', 'truncate')
         and not has_table_privilege('anon', 'public.folios_anulados', 'select, insert, update, delete, truncate'),
         (select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'folios_anulados'
             and grantee in ('anon', 'authenticated'))
  union all
  select 15, 'cafs y folios_anulados están en supabase_realtime (insert, update, delete) y las 5 de 0001 y 0006 siguen',
         coalesce((select pubinsert and pubupdate and pubdelete and not puballtables
                     from pg_publication where pubname = 'supabase_realtime'), false)
         and (select count(*) from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public'
                 and tablename in ('cafs', 'folios_anulados', 'documentos', 'envios',
                                   'procesos_certificacion', 'operaciones_sii', 'solicitudes_folios')) = 7,
         (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public')
  union all
  select 16, 'Realtime aplica RLS en las dos: RLS activo, política lectura (SELECT, authenticated, es_miembro), SELECT para authenticated, nada para anon, replica identity por defecto',
         (select count(*) from pg_class
           where oid in ('public.cafs'::regclass, 'public.folios_anulados'::regclass)
             and relrowsecurity and relreplident = 'd') = 2
         and (select count(*) from pg_policies
               where schemaname = 'public' and tablename in ('cafs', 'folios_anulados')
                 and policyname = 'lectura' and cmd = 'SELECT'
                 and roles = array['authenticated']::name[]
                 and qual like '%es_miembro(organizacion_id)%') = 2
         and has_table_privilege('authenticated', 'public.cafs', 'select')
         and has_table_privilege('authenticated', 'public.folios_anulados', 'select')
         and not has_table_privilege('anon', 'public.cafs', 'select')
         and not exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename in ('cafs', 'folios_anulados')
                            and ('anon' = any(roles) or 'public' = any(roles))),
         (select string_agg(tablename || ':' || policyname || ':' || cmd, '; ' order by tablename, policyname)
            from pg_policies where schemaname = 'public' and tablename in ('cafs', 'folios_anulados'))
  union all
  select 17, 'cafs no guarda el CAF: ninguna columna de XML o llave, y caf_secret_id es solo un uuid (el XML vive en Vault)',
         not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'cafs'
                        and (column_name ilike '%xml%' or column_name ilike '%rsask%'
                             or column_name ilike '%llave%' or column_name ilike '%clave%'
                             or data_type in ('bytea', 'xml')))
         and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'cafs'
                        and column_name = 'caf_secret_id' and data_type = 'uuid'),
         (select string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
            from information_schema.columns where table_schema = 'public' and table_name = 'cafs')
  union all
  select 18, 'migración registrada como 0011',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0011'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
