-- Verificación de la migración 0015_planes_comerciales en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a ninguna función. Se ejecuta tal
-- cual en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas
-- deben salir con ok = true.
-- La prueba de comportamiento (una organización nueva queda en Certificación sin
-- `periodo_fin`, el cambio de plan con `activar_suscripcion` y los límites del plan nuevo)
-- está en rls-fase10-pagos.sql, con transacción y rollback.
-- 10 comprobaciones: 1-2 columnas nuevas de planes; 3-6 la grilla (los 5 planes activos con
-- sus valores, emprendedor inactivo, solo pyme/contador/api de autoservicio, la política
-- que oculta los inactivos); 7-8 crear_organizacion (sin plazo de 30 días, mismos
-- privilegios); 9 ninguna suscripción de Certificación con periodo_fin; 10 migración
-- registrada.
--
-- Los planes se leen como `to_jsonb(p)` y se comparan con `@>` (contiene): así la consulta
-- no falla antes de migrar (cuando `autoservicio` y `orden` no existen) y cada plan sale
-- false con lo que le falta en el detalle. crear_organizacion se busca con to_regprocedure
-- (firma calificada), así el resultado no depende del search_path de la sesión. Antes de
-- migrar salen false la 1-6, la 8 y la 10 (la 7 y la 9 ya se cumplían: los privilegios no
-- cambian y la limpieza de periodo_fin puede no tener nada que limpiar).

with columnas as (
  select a.attname::text as columna, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) as defecto
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = to_regclass('public.planes') and a.attnum > 0 and not a.attisdropped
),
esperados(codigo, valores) as (
  values
    ('certificacion', '{"nombre":"Certificación","precio_mensual_clp":0,"max_empresas":1,"max_usuarios":2,"max_boletas_mes":0,"permite_produccion":false,"incluye_api":false,"incluye_webhooks":false,"activo":true,"autoservicio":false,"orden":0}'::jsonb),
    ('pyme',          '{"nombre":"Pyme","precio_mensual_clp":14990,"max_empresas":1,"max_usuarios":3,"max_boletas_mes":1000,"permite_produccion":true,"incluye_api":false,"incluye_webhooks":false,"activo":true,"autoservicio":true,"orden":1}'::jsonb),
    ('contador',      '{"nombre":"Contador","precio_mensual_clp":49990,"max_empresas":15,"max_usuarios":10,"max_boletas_mes":10000,"permite_produccion":true,"incluye_api":false,"incluye_webhooks":false,"activo":true,"autoservicio":true,"orden":2}'::jsonb),
    ('api',           '{"nombre":"API","precio_mensual_clp":39990,"max_empresas":3,"max_usuarios":5,"max_boletas_mes":20000,"permite_produccion":true,"incluye_api":true,"incluye_webhooks":true,"activo":true,"autoservicio":true,"orden":3}'::jsonb),
    ('empresa',       '{"nombre":"Empresa","precio_mensual_clp":0,"max_empresas":null,"max_usuarios":null,"max_boletas_mes":null,"permite_produccion":true,"incluye_api":true,"incluye_webhooks":true,"activo":true,"autoservicio":false,"orden":4}'::jsonb),
    ('emprendedor',   '{"nombre":"Emprendedor","activo":false,"autoservicio":false,"orden":9}'::jsonb)
),
planes as (
  select p.codigo, to_jsonb(p) - 'id' - 'creado_en' as valores from public.planes p
),
grilla as (
  select e.codigo, e.valores as esperado, p.valores as actual,
         coalesce(p.valores @> e.valores, false) as calza
  from esperados e left join planes p on p.codigo = e.codigo
),
funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, l.lanname
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.crear_organizacion(text, text)')
)
select * from (
  select 1 as n, 'planes.autoservicio: boolean not null default false' as verificacion,
         exists (select 1 from columnas where columna = 'autoservicio' and tipo = 'boolean'
                  and attnotnull and defecto = 'false') as ok,
         (select tipo || case when attnotnull then ' not null' else '' end || ' default ' || coalesce(defecto, '-')
            from columnas where columna = 'autoservicio') as detalle
  union all
  select 2, 'planes.orden: smallint not null default 0',
         exists (select 1 from columnas where columna = 'orden' and tipo = 'smallint'
                  and attnotnull and defecto = '0'),
         (select tipo || case when attnotnull then ' not null' else '' end || ' default ' || coalesce(defecto, '-')
            from columnas where columna = 'orden')
  union all
  select 3, 'los 5 planes de la grilla (certificacion, pyme, contador, api, empresa) con precio, límites, producción, API/webhooks, activo, autoservicio y orden exactos',
         (select count(*) from grilla where codigo <> 'emprendedor' and calza) = 5,
         (select string_agg(codigo || ' tiene ' || coalesce((
                    select string_agg(k || '=' || coalesce(actual ->> k, 'NO EXISTE'), ', ' order by k)
                    from jsonb_object_keys(esperado) k
                    where (actual -> k) is distinct from (esperado -> k)), 'NO EXISTE'), '; ')
            from grilla where codigo <> 'emprendedor' and not calza)
  union all
  select 4, 'emprendedor sigue en la tabla (lo pueden referenciar suscripciones) pero inactivo, sin autoservicio y al final (orden 9)',
         coalesce((select calza from grilla where codigo = 'emprendedor'), false),
         (select actual::text from grilla where codigo = 'emprendedor')
  union all
  select 5, 'los planes activos son exactamente esos 5, con orden distinto, y solo pyme, contador y api son de autoservicio',
         (select string_agg(codigo, ',' order by codigo) from planes where (valores ->> 'activo')::boolean)
           = 'api,certificacion,contador,empresa,pyme'
         and (select count(distinct valores ->> 'orden') from planes where (valores ->> 'activo')::boolean) = 5
         and coalesce((select string_agg(codigo, ',' order by codigo) from planes
                        where coalesce((valores ->> 'autoservicio')::boolean, false)), '') = 'api,contador,pyme',
         (select string_agg(codigo || ' activo=' || (valores ->> 'activo') || ' autoservicio='
                            || coalesce(valores ->> 'autoservicio', '-') || ' orden=' || coalesce(valores ->> 'orden', '-'),
                            '; ' order by codigo) from planes)
  union all
  select 6, 'la política lectura de planes sigue mostrando solo los activos (anon y authenticated) y anon lee las columnas nuevas',
         exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'planes' and policyname = 'lectura'
                    and cmd = 'SELECT' and roles @> array['anon', 'authenticated']::name[] and qual = 'activo')
         and coalesce((select count(*) = 2 from columnas where columna in ('autoservicio', 'orden')), false)
         and has_column_privilege('anon', 'public.planes', 'nombre', 'select')
         and (select bool_and(has_column_privilege('anon', 'public.planes', columna, 'select')
                              and has_column_privilege('authenticated', 'public.planes', columna, 'select'))
                from columnas where columna in ('autoservicio', 'orden')),
         (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '-'), '; ')
            from pg_policies where schemaname = 'public' and tablename = 'planes')
  union all
  select 7, 'crear_organizacion: plpgsql, security definer, search_path vacío; authenticated la ejecuta, anon y PUBLIC no (como dejó la 0001)',
         coalesce((select lanname = 'plpgsql' and prosecdef and proconfig @> array['search_path=""']
                          and has_function_privilege('authenticated', oid, 'execute')
                          and not has_function_privilege('anon', oid, 'execute')
                          and not exists (select 1 from aclexplode(proacl) a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion), false),
         (select coalesce(lanname, '-') || ' definer=' || prosecdef::text || ' '
                 || coalesce(array_to_string(proconfig, ', '), '-') || ' ' || coalesce(proacl::text, '-')
            from funcion)
  union all
  select 8, 'crear_organizacion ya no fija periodo_fin = now() + 30 days: suscribe a certificacion en prueba con periodo_fin null y deja al creador como propietario',
         coalesce((select prosrc not like '%interval%'
                          and prosrc like '%''prueba'', null%'
                          and prosrc like '%p.codigo = ''certificacion''%'
                          and prosrc like '%''propietario''%'
                          and prosrc like '%errcode = ''42501''%'
                     from funcion), false),
         (select case when prosrc like '%30 days%' then 'todavía tiene interval ''30 days''' end from funcion)
  union all
  select 9, 'ninguna suscripción de certificacion en prueba tiene periodo_fin',
         not exists (select 1 from public.suscripciones s join public.planes p on p.id = s.plan_id
                      where p.codigo = 'certificacion' and s.estado = 'prueba' and s.periodo_fin is not null),
         (select count(*) || ' suscripción(es) certificacion/prueba en total' from public.suscripciones s
            join public.planes p on p.id = s.plan_id where p.codigo = 'certificacion' and s.estado = 'prueba')
  union all
  select 10, 'la migración está registrada como 0015',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0015'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
