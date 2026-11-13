-- Verificación de la migración 0007_bloqueos_sii en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a las funciones. Se ejecuta tal cual
-- en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben
-- salir con ok = true.
-- La prueba de comportamiento (tomar, rechazar a otro titular, renovar, tomar uno vencido,
-- liberar solo con el titular, authenticated sin EXECUTE, y el choque 23505 de dos
-- operaciones de efecto global en curso) está en rls-fase4-bloqueos.sql, con transacción
-- y rollback.
-- 14 comprobaciones: 1-12 bloqueos_sii y sus funciones; 13-14 el índice único parcial
-- operaciones_sii_efecto_global_en_curso (columnas y predicado).
--
-- Las firmas se buscan con to_regprocedure (tipos calificados), así el resultado no depende
-- del search_path de la sesión.

with esperadas(nombre, firma, argumentos) as (
  values
    ('tomar_bloqueo_certificado',
     'public.tomar_bloqueo_certificado(uuid, public.ambiente_sii, uuid, integer)',
     array['p_certificado', 'p_ambiente', 'p_titular', 'p_segundos']),
    ('liberar_bloqueo_certificado',
     'public.liberar_bloqueo_certificado(uuid, public.ambiente_sii, uuid)',
     array['p_certificado', 'p_ambiente', 'p_titular'])
),
funciones as (
  select e.nombre, e.argumentos, p.oid, p.prosecdef, p.proconfig, p.proacl, l.lanname,
         p.proargnames, pg_get_function_result(p.oid) as resultado
  from esperadas e
  left join pg_proc p on p.oid = to_regprocedure(e.firma)
  left join pg_language l on l.oid = p.prolang
),
columnas as (
  select a.attname::text as columna, a.atttypid::regtype as tipo, a.attnotnull
  from pg_attribute a
  where a.attrelid = to_regclass('public.bloqueos_sii') and a.attnum > 0 and not a.attisdropped
)
select * from (
  select 1 as n, 'la tabla bloqueos_sii existe con sus 5 columnas y tipos' as verificacion,
         (select count(*) from columnas c join (values
            ('certificado_id', 'uuid'::regtype),
            ('ambiente', 'public.ambiente_sii'::regtype),
            ('titular', 'uuid'::regtype),
            ('vence_en', 'timestamptz'::regtype),
            ('tomado_en', 'timestamptz'::regtype)) e(columna, tipo)
            on e.columna = c.columna and e.tipo = c.tipo and c.attnotnull) = 5
         and (select count(*) from columnas) = 5 as ok,
         (select string_agg(columna || ' ' || tipo::text || case when attnotnull then ' not null' else '' end, ', ')
            from columnas) as detalle
  union all
  select 2, 'llave primaria (certificado_id, ambiente)',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.bloqueos_sii') and c.contype = 'p'
                    and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (certificado_id, ambiente)'),
         (select string_agg(pg_get_constraintdef(c.oid), '; ') from pg_constraint c
           where c.conrelid = to_regclass('public.bloqueos_sii'))
  union all
  select 3, 'certificado_id referencia certificados(id) con on delete cascade',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.bloqueos_sii') and c.contype = 'f'
                    and c.confrelid = 'public.certificados'::regclass
                    and c.confdeltype = 'c'),
         null
  union all
  select 4, 'RLS activo y sin políticas',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bloqueos_sii')), false)
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bloqueos_sii'),
         (select string_agg(policyname, ', ') from pg_policies
           where schemaname = 'public' and tablename = 'bloqueos_sii')
  union all
  select 5, 'anon y authenticated no tienen ningún privilegio sobre la tabla',
         -- case (y no and) para no evaluar has_table_privilege si la tabla no existe.
         case when to_regclass('public.bloqueos_sii') is null then false
              else not has_table_privilege('anon', to_regclass('public.bloqueos_sii'),
                         'select, insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('authenticated', to_regclass('public.bloqueos_sii'),
                         'select, insert, update, delete, truncate, references, trigger')
         end,
         (select relacl::text from pg_class where oid = to_regclass('public.bloqueos_sii'))
  union all
  select 6, 'las 2 funciones existen con la firma esperada y devuelven boolean',
         (select count(*) from funciones where oid is not null and resultado = 'boolean') = 2,
         (select string_agg(nombre || ': ' || coalesce(resultado, 'NO EXISTE con esa firma'), '; ')
            from funciones)
  union all
  select 7, 'nombres de los parámetros (los que usa bloqueos.ts al llamar por RPC)',
         coalesce((select bool_and(proargnames = argumentos) and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || '(' || coalesce(array_to_string(proargnames, ', '), '-') || ')', '; ')
            from funciones)
  union all
  select 8, 'las 2 son plpgsql, security definer y fijan search_path vacío',
         coalesce((select bool_and(lanname = 'plpgsql' and prosecdef
                                   and proconfig @> array['search_path=""'])
                          and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(lanname, '-') || ' definer=' || coalesce(prosecdef::text, '-')
                            || ' ' || coalesce(array_to_string(proconfig, ', '), '-'), '; ')
            from funciones)
  union all
  select 9, 'service_role ejecuta las 2',
         coalesce((select bool_and(has_function_privilege('service_role', oid, 'execute')) and count(*) = 2
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(proacl::text, '-'), '; ') from funciones)
  union all
  select 10, 'authenticated, anon y PUBLIC no ejecutan ninguna',
         coalesce((
           select bool_and(not has_function_privilege('authenticated', oid, 'execute')
                           and not has_function_privilege('anon', oid, 'execute')
                           and not exists (select 1 from aclexplode(proacl) a
                                            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                  and count(*) = 2
           from funciones where oid is not null), false),
         null
  union all
  select 11, 'tomar_bloqueo_certificado hace el insert ... on conflict con la condición de arriendo',
         coalesce((select prosrc like '%on conflict (certificado_id, ambiente) do update%'
                          and prosrc like '%b.vence_en <= now() or b.titular = excluded.titular%'
                          and prosrc like '%between 1 and 900%'
                     from pg_proc p join funciones f on f.oid = p.oid
                    where f.nombre = 'tomar_bloqueo_certificado'), false),
         null
  union all
  select 12, 'migración registrada como 0007',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0007'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
  union all
  select 13, 'índice único y válido operaciones_sii_efecto_global_en_curso sobre operaciones_sii (empresa_id, operacion, ambiente)',
         coalesce((select i.indisunique and i.indisvalid
                          and i.indrelid = 'public.operaciones_sii'::regclass
                          and (select array_agg(a.attname::text order by k.orden)
                                 from unnest(i.indkey::int2[]) with ordinality k(attnum, orden)
                                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
                              = array['empresa_id', 'operacion', 'ambiente']
                     from pg_index i
                    where i.indexrelid = to_regclass('public.operaciones_sii_efecto_global_en_curso')), false),
         pg_get_indexdef(to_regclass('public.operaciones_sii_efecto_global_en_curso'))
  union all
  -- Los literales del predicado deben ser exactamente en_curso y las 3 operaciones de
  -- OPERACIONES_EFECTO_GLOBAL (apps/web/src/server/sii/operacion.ts): si cambia la lista
  -- en la app, cambia aquí y en la migración.
  select 14, 'predicado: resultado en_curso, confirmada y solo solicitar_folios, postular y declarar',
         coalesce((select pred like '%resultado = %en_curso%'
                          and pred ~ '(^|[^a-z_])confirmada([^a-z_]|$)'
                          and (select array_agg(distinct m[1] order by m[1])
                                 from regexp_matches(pred, '''([a-z_]+)''', 'g') m)
                              = array['declarar', 'en_curso', 'postular', 'solicitar_folios']
                     from (select pg_get_expr(i.indpred, i.indrelid) as pred
                             from pg_index i
                            where i.indexrelid = to_regclass('public.operaciones_sii_efecto_global_en_curso')) p),
                  false),
         (select pg_get_expr(i.indpred, i.indrelid) from pg_index i
           where i.indexrelid = to_regclass('public.operaciones_sii_efecto_global_en_curso'))
) v
order by n;
