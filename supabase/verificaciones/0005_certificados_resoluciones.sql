-- Verificación de la migración 0005_certificados_resoluciones en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a las funciones. Se ejecuta tal cual
-- en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben
-- salir con ok = true.
-- La prueba de comportamiento (RLS, reemplazo de la vigente, predeterminado único, secretos
-- en Vault) está en rls-fase3-empresas.sql, con transacción y rollback.
--
-- Las firmas se buscan con to_regprocedure (tipos calificados), así el resultado no depende
-- del search_path de la sesión.

with esperadas(nombre, firma, retorno, definer) as (
  values
    ('registrar_certificado',
     'public.registrar_certificado(uuid, text, text, text, text, timestamptz, timestamptz, '
     || 'text, text, text, boolean, uuid)',
     'uuid', true),
    ('fijar_certificado_predeterminado',
     'public.fijar_certificado_predeterminado(uuid, uuid)', 'void', false),
    ('registrar_resolucion',
     'public.registrar_resolucion(uuid, public.ambiente_sii, integer, date)', 'uuid', false)
),
funciones as (
  select e.nombre, e.retorno, e.definer, p.oid, p.prosecdef, p.proconfig, p.proacl,
         l.lanname, p.proargnames, pg_get_function_result(p.oid) as resultado
  from esperadas e
  left join pg_proc p on p.oid = to_regprocedure(e.firma)
  left join pg_language l on l.oid = p.prolang
)
select * from (
  select 1 as n, 'las 3 funciones existen con la firma y el retorno esperados' as verificacion,
         (select count(*) from funciones where oid is not null and resultado = retorno) = 3 as ok,
         (select string_agg(nombre || ': ' || coalesce(resultado, 'NO EXISTE con esa firma'), '; ')
            from funciones) as detalle
  union all
  select 2, 'nombres de los parámetros (los que usa la app al llamar por RPC)',
         coalesce((
           select bool_and(case nombre
             when 'registrar_certificado' then proargnames = array[
               'p_organizacion', 'p_rut_titular', 'p_nombre_titular', 'p_cn', 'p_emisor_ca',
               'p_vigente_desde', 'p_vigente_hasta', 'p_huella_sha256', 'p_pfx_base64', 'p_clave',
               'p_pfx_legacy', 'p_subido_por']
             when 'fijar_certificado_predeterminado' then proargnames = array['p_empresa', 'p_certificado']
             when 'registrar_resolucion' then proargnames = array['p_empresa', 'p_ambiente', 'p_numero', 'p_fecha']
           end) and count(*) = 3
           from funciones where oid is not null), false),
         (select string_agg(nombre || '(' || coalesce(array_to_string(proargnames, ', '), '-') || ')', '; ')
            from funciones)
  union all
  select 3, 'las 3 son plpgsql',
         (select count(*) from funciones where lanname = 'plpgsql') = 3,
         (select string_agg(nombre || ' ' || coalesce(lanname, '-'), '; ') from funciones)
  union all
  select 4, 'registrar_certificado es security definer; las otras dos, security invoker',
         coalesce((select bool_and(prosecdef = definer) and count(*) = 3
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' definer=' || coalesce(prosecdef::text, '-'), '; ')
            from funciones)
  union all
  select 5, 'las 3 fijan search_path vacío',
         coalesce((select bool_and(proconfig @> array['search_path=""']) and count(*) = 3
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(array_to_string(proconfig, ', '), '-'), '; ')
            from funciones)
  union all
  select 6, 'registrar_certificado: service_role la ejecuta',
         coalesce((select has_function_privilege('service_role', oid, 'execute')
                     from funciones where nombre = 'registrar_certificado' and oid is not null), false),
         (select proacl::text from funciones where nombre = 'registrar_certificado')
  union all
  select 7, 'registrar_certificado: authenticated, anon y PUBLIC no la ejecutan',
         coalesce((
           select not has_function_privilege('authenticated', oid, 'execute')
              and not has_function_privilege('anon', oid, 'execute')
              and not exists (select 1 from aclexplode(proacl) a
                               where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from funciones where nombre = 'registrar_certificado' and oid is not null), false),
         (select proacl::text from funciones where nombre = 'registrar_certificado')
  union all
  select 8, 'fijar_certificado_predeterminado y registrar_resolucion: authenticated y service_role las ejecutan',
         coalesce((
           select bool_and(has_function_privilege('authenticated', oid, 'execute')
                           and has_function_privilege('service_role', oid, 'execute'))
                  and count(*) = 2
           from funciones
           where nombre <> 'registrar_certificado' and oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(proacl::text, '-'), '; ')
            from funciones where nombre <> 'registrar_certificado')
  union all
  select 9, 'fijar_certificado_predeterminado y registrar_resolucion: anon y PUBLIC no las ejecutan',
         coalesce((
           select bool_and(not has_function_privilege('anon', oid, 'execute')
                           and not exists (select 1 from aclexplode(proacl) a
                                            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                  and count(*) = 2
           from funciones
           where nombre <> 'registrar_certificado' and oid is not null), false),
         null
  union all
  select 10, 'certificados sigue sin políticas de escritura (authenticated solo lee)',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'certificados' and cmd <> 'SELECT')
         and exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'certificados'
                        and policyname = 'lectura' and cmd = 'SELECT'),
         (select string_agg(policyname || ':' || cmd, ', ') from pg_policies
           where schemaname = 'public' and tablename = 'certificados')
  union all
  select 11, 'trg_borrar_secretos de certificados borra pfx_secret_id y clave_secret_id',
         exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.certificados'::regclass
                    and t.tgname = 'trg_borrar_secretos'
                    and t.tgfoid = 'public.tg_borrar_secretos()'::regprocedure
                    and t.tgenabled = 'O'
                    and pg_get_triggerdef(t.oid) like '%AFTER DELETE%'
                    and pg_get_triggerdef(t.oid) like '%''pfx_secret_id'', ''clave_secret_id''%'),
         (select pg_get_triggerdef(t.oid) from pg_trigger t
           where t.tgrelid = 'public.certificados'::regclass and t.tgname = 'trg_borrar_secretos')
  union all
  select 12, 'resoluciones y empresa_certificados heredan organizacion_id (trg_00_organizacion)',
         (select count(*) from pg_trigger t
           where t.tgrelid in ('public.resoluciones'::regclass, 'public.empresa_certificados'::regclass)
             and t.tgname = 'trg_00_organizacion'
             and t.tgfoid = 'public.tg_heredar_organizacion()'::regprocedure
             and t.tgenabled = 'O') = 2,
         null
  union all
  select 13, 'authenticated tiene lo que las funciones invoker necesitan (tablas y es_admin)',
         has_table_privilege('authenticated', 'public.resoluciones', 'select, insert, update')
         and has_table_privilege('authenticated', 'public.empresa_certificados', 'select, update')
         and has_table_privilege('authenticated', 'public.empresas', 'select, update')
         and has_function_privilege('authenticated', 'public.es_admin(uuid)', 'execute'),
         null
  union all
  select 14, 'índices únicos parciales de vigente y predeterminado siguen en su lugar',
         exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'resoluciones_vigente_unica' and indexdef like '%WHERE vigente%')
         and exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'empresa_certificados_predeterminado_unico'
                   and indexdef like '%WHERE predeterminado%'),
         null
  union all
  select 15, 'migración registrada como 0005',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0005'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
