-- Verificación de la migración 0003_preferencias en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos. Se ejecuta tal cual en el SQL Editor o con
-- el MCP `execute_sql`. Cada fila es una comprobación: todas deben salir con ok = true.
-- (La 8 llama a ver_invitacion con un token inexistente: es una función `stable` que
-- solo lee.)

with columnas(nombre, tipo, nula, defecto) as (
  values ('tema', 'text', 'NO', '''sistema''::text'),
         ('ultima_organizacion', 'uuid', 'YES', null),
         ('ultima_empresa', 'uuid', 'YES', null)
),
fks(nombre, columna, tabla) as (
  values ('perfiles_ultima_organizacion_fkey', 'ultima_organizacion', 'organizaciones'),
         ('perfiles_ultima_empresa_fkey', 'ultima_empresa', 'empresas')
),
funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ver_invitacion'
    and pg_get_function_identity_arguments(p.oid) = 'p_token text'
)
select * from (
  select 1 as n, 'perfiles tiene tema, ultima_organizacion y ultima_empresa' as verificacion,
         not exists (
           select 1 from columnas c
           left join information_schema.columns ic
             on ic.table_schema = 'public' and ic.table_name = 'perfiles'
            and ic.column_name = c.nombre
           where ic.column_name is null
              or ic.data_type <> c.tipo
              or ic.is_nullable <> c.nula
              or ic.column_default is distinct from c.defecto
         ) as ok,
         (select string_agg(ic.column_name || ' ' || ic.data_type || ' nula=' || ic.is_nullable
                            || ' default=' || coalesce(ic.column_default, '-'), '; ')
            from information_schema.columns ic
           where ic.table_schema = 'public' and ic.table_name = 'perfiles'
             and ic.column_name in (select nombre from columnas)) as detalle
  union all
  select 2, 'check de tema: sistema, claro, oscuro',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.perfiles'::regclass and conname = 'perfiles_tema_check'
                    and contype = 'c'
                    and pg_get_constraintdef(oid) like '%sistema%claro%oscuro%'),
         (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.perfiles'::regclass and conname = 'perfiles_tema_check')
  union all
  select 3, 'FK de ultima_organizacion y ultima_empresa con on delete set null',
         (select count(*) from fks f
            join pg_constraint c on c.conname = f.nombre
                                and c.conrelid = 'public.perfiles'::regclass
           where c.contype = 'f'
             and c.confrelid = ('public.' || f.tabla)::regclass
             and c.confdeltype = 'n') = 2,
         (select string_agg(conname || ' → ' || confrelid::regclass::text
                            || ' ondelete=' || confdeltype::text, '; ')
            from pg_constraint
           where conrelid = 'public.perfiles'::regclass and contype = 'f')
  union all
  select 4, 'authenticated puede actualizar las columnas nuevas',
         has_column_privilege('authenticated', 'public.perfiles', 'tema', 'update')
         and has_column_privilege('authenticated', 'public.perfiles', 'ultima_organizacion', 'update')
         and has_column_privilege('authenticated', 'public.perfiles', 'ultima_empresa', 'update'),
         null
  union all
  select 5, 'perfiles sigue con RLS y su política edicion_propia',
         (select relrowsecurity from pg_class where oid = 'public.perfiles'::regclass)
         and exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'perfiles'
                        and policyname = 'edicion_propia' and cmd = 'UPDATE'),
         null
  union all
  select 6, 'ver_invitacion existe, es security definer y fija search_path vacío',
         coalesce((select prosecdef and proconfig @> array['search_path=""'] from funcion), false),
         (select array_to_string(proconfig, ', ') from funcion)
  union all
  select 7, 'ver_invitacion: ejecutan anon, authenticated y service_role; PUBLIC no',
         coalesce((
           select has_function_privilege('anon', oid, 'execute')
              and has_function_privilege('authenticated', oid, 'execute')
              and has_function_privilege('service_role', oid, 'execute')
              and not exists (select 1 from aclexplode(proacl) a
                               where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from funcion), false),
         (select proacl::text from funcion)
  union all
  select 8, 'ver_invitacion con un token inexistente devuelve cero filas',
         (select count(*) from public.ver_invitacion('token-que-no-existe')) = 0,
         null
  union all
  select 9, 'anon sigue sin leer invitaciones',
         not has_table_privilege('anon', 'public.invitaciones', 'select'), null
  union all
  select 10, 'migración registrada como 0003',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0003'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
