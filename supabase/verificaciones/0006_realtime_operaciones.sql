-- Verificación de la migración 0006_realtime_operaciones en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no se suscribe a nada. Se ejecuta tal cual
-- en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben
-- salir con ok = true.
--
-- Comprueba que las dos tablas quedaron en `supabase_realtime` sin sacar a las que ya
-- estaban, y que Realtime tiene con qué aplicar RLS (políticas de lectura para
-- authenticated, nada para anon).

with tablas(nombre) as (
  values ('operaciones_sii'), ('solicitudes_folios')
),
publicadas as (
  select tablename from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'
)
select * from (
  select 1 as n, 'la publicación supabase_realtime existe y publica insert, update y delete' as verificacion,
         coalesce((select pubinsert and pubupdate and pubdelete and not puballtables
                     from pg_publication where pubname = 'supabase_realtime'), false) as ok,
         (select format('insert=%s update=%s delete=%s todas=%s', pubinsert, pubupdate, pubdelete, puballtables)
            from pg_publication where pubname = 'supabase_realtime') as detalle
  union all
  select 2, 'operaciones_sii y solicitudes_folios están en supabase_realtime',
         (select count(*) from tablas t join publicadas p on p.tablename = t.nombre) = 2,
         (select string_agg(tablename, ', ' order by tablename) from publicadas)
  union all
  select 3, 'documentos, envios y procesos_certificacion (0001) siguen publicadas',
         (select count(*) from publicadas
           where tablename in ('documentos', 'envios', 'procesos_certificacion')) = 3,
         null
  union all
  select 4, 'las dos tablas tienen RLS activo',
         (select count(*) from pg_class
           where oid in ('public.operaciones_sii'::regclass, 'public.solicitudes_folios'::regclass)
             and relrowsecurity) = 2,
         null
  union all
  select 5, 'las dos tienen la política lectura (SELECT, authenticated, es_miembro(organizacion_id))',
         (select count(*) from pg_policies
           where schemaname = 'public'
             and tablename in ('operaciones_sii', 'solicitudes_folios')
             and policyname = 'lectura' and cmd = 'SELECT'
             and roles = array['authenticated']::name[]
             and qual like '%es_miembro(organizacion_id)%') = 2,
         (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), '; ')
            from pg_policies
           where schemaname = 'public' and tablename in ('operaciones_sii', 'solicitudes_folios'))
  union all
  select 6, 'authenticated tiene SELECT sobre las dos (Realtime lee con el rol del suscriptor)',
         has_table_privilege('authenticated', 'public.operaciones_sii', 'select')
         and has_table_privilege('authenticated', 'public.solicitudes_folios', 'select'),
         null
  union all
  select 7, 'anon no tiene SELECT ni políticas sobre las dos',
         not has_table_privilege('anon', 'public.operaciones_sii', 'select')
         and not has_table_privilege('anon', 'public.solicitudes_folios', 'select')
         and not exists (select 1 from pg_policies
                          where schemaname = 'public'
                            and tablename in ('operaciones_sii', 'solicitudes_folios')
                            and ('anon' = any(roles) or 'public' = any(roles))),
         null
  union all
  select 8, 'replica identity por defecto (llave primaria) en las dos, como decidió la migración',
         (select count(*) from pg_class
           where oid in ('public.operaciones_sii'::regclass, 'public.solicitudes_folios'::regclass)
             and relreplident = 'd') = 2,
         (select string_agg(relname || '=' || relreplident::text, ', ') from pg_class
           where oid in ('public.operaciones_sii'::regclass, 'public.solicitudes_folios'::regclass))
  union all
  select 9, 'migración registrada como 0006',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0006'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
