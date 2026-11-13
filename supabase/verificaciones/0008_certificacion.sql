-- Verificación de la migración 0008_certificacion en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a las funciones. Se ejecuta tal cual
-- en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben
-- salir con ok = true.
-- La prueba de comportamiento (CAF a Vault en una transacción, idempotencia sin secretos
-- huérfanos, candados de RUT/IDK/solicitud, reemplazo del set y authenticated sin EXECUTE)
-- está en rls-fase5-certificacion.sql, con transacción y rollback.
-- 10 comprobaciones: 1-8 las dos funciones; 9 cuerpos; 10 migración registrada.
--
-- Las firmas se buscan con to_regprocedure (tipos calificados), así el resultado no depende
-- del search_path de la sesión.

with esperadas(nombre, firma, argumentos, resultado) as (
  values
    ('registrar_caf',
     'public.registrar_caf(uuid, uuid, public.ambiente_sii, smallint, integer, integer, date, smallint, text, text, text, uuid)',
     array['p_organizacion', 'p_empresa', 'p_ambiente', 'p_tipo_dte', 'p_folio_desde',
           'p_folio_hasta', 'p_fecha_autorizacion', 'p_idk', 'p_rut_emisor', 'p_razon_social',
           'p_caf_xml', 'p_solicitud'],
     'uuid'),
    ('guardar_set_pruebas',
     'public.guardar_set_pruebas(uuid, uuid, text, text, jsonb)',
     array['p_organizacion', 'p_proceso', 'p_texto', 'p_correo_proveedor', 'p_casos'],
     'integer')
),
funciones as (
  select e.nombre, e.argumentos, e.resultado as esperado, p.oid, p.prosecdef, p.proconfig,
         p.proacl, p.prosrc, l.lanname, p.proargnames, pg_get_function_result(p.oid) as resultado
  from esperadas e
  left join pg_proc p on p.oid = to_regprocedure(e.firma)
  left join pg_language l on l.oid = p.prolang
)
select * from (
  select 1 as n, 'las 2 funciones existen con la firma esperada' as verificacion,
         (select count(*) from funciones where oid is not null) = 2 as ok,
         (select string_agg(nombre || ': ' || case when oid is null then 'NO EXISTE con esa firma' else 'ok' end, '; ')
            from funciones) as detalle
  union all
  select 2, 'registrar_caf devuelve uuid y guardar_set_pruebas devuelve integer',
         coalesce((select bool_and(resultado = esperado) and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' -> ' || coalesce(resultado, '-'), '; ') from funciones)
  union all
  select 3, 'nombres de los parámetros (los que usa server/certificacion al llamar por RPC)',
         coalesce((select bool_and(proargnames = argumentos) and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || '(' || coalesce(array_to_string(proargnames, ', '), '-') || ')', '; ')
            from funciones)
  union all
  select 4, 'las 2 son plpgsql, security definer y fijan search_path vacío',
         coalesce((select bool_and(lanname = 'plpgsql' and prosecdef
                                   and proconfig @> array['search_path=""'])
                          and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(lanname, '-') || ' definer=' || coalesce(prosecdef::text, '-')
                            || ' ' || coalesce(array_to_string(proconfig, ', '), '-'), '; ')
            from funciones)
  union all
  select 5, 'service_role ejecuta las 2',
         coalesce((select bool_and(has_function_privilege('service_role', oid, 'execute')) and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(proacl::text, '-'), '; ') from funciones)
  union all
  select 6, 'authenticated no ejecuta ninguna',
         coalesce((select bool_and(not has_function_privilege('authenticated', oid, 'execute')) and count(*) = 2
                     from funciones where oid is not null), false),
         null
  union all
  select 7, 'anon no ejecuta ninguna',
         coalesce((select bool_and(not has_function_privilege('anon', oid, 'execute')) and count(*) = 2
                     from funciones where oid is not null), false),
         null
  union all
  select 8, 'PUBLIC no tiene EXECUTE en ninguna',
         coalesce((select bool_and(not exists (select 1 from aclexplode(proacl) a
                                                where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                          and count(*) = 2
                     from funciones where oid is not null), false),
         null
  union all
  select 9, 'cuerpos: registrar_caf guarda en Vault tras serializar por empresa y es idempotente; guardar_set_pruebas reemplaza los casos y deja set_descargado',
         coalesce((select prosrc like '%public.guardar_secreto(%'
                          and prosrc like '%for no key update%'
                          and prosrc like '%v_existente.folio_hasta <> p_folio_hasta%'
                          and prosrc like '%when unique_violation%'
                          and prosrc like '%p_organizacion%'
                     from funciones where nombre = 'registrar_caf'), false)
         and coalesce((select prosrc like '%delete from public.set_pruebas_casos where proceso_id = p_proceso%'
                              and prosrc like '%insert into public.set_pruebas_casos%'
                              and prosrc like '%etapa = ''set_descargado''%'
                              and prosrc like '%envio_set_id = null%'
                              and prosrc like '%p.organizacion_id = p_organizacion%'
                         from funciones where nombre = 'guardar_set_pruebas'), false),
         null
  union all
  select 10, 'migración registrada como 0008',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0008'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
