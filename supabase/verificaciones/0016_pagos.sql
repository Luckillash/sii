-- Verificación de la migración 0016_pagos en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a ninguna función. Se ejecuta tal
-- cual en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas
-- deben salir con ok = true.
-- La prueba de comportamiento (activar_suscripcion: cambio de plan, idempotencia, vuelta a
-- Certificación y errores; el RLS de pagos y clientes_pago por rol; el límite de boletas
-- del plan nuevo) está en rls-fase10-pagos.sql, con transacción y rollback.
-- 20 comprobaciones: 1-3 clientes_pago (columnas, llaves y FK, check); 4-7 pagos (columnas,
-- llaves y FK, check, índice); 8-9 eventos_pasarela (columnas; llaves, FK y check); 10
-- triggers trg_90_actualizado_en; 11-12 RLS y políticas; 13 privilegios; 14-15 suscripciones
-- (columnas nuevas e índice único parcial); 16-19 activar_suscripcion (firma, definer y
-- search_path, privilegios, cuerpo); 20 fuera de Realtime y migración registrada.
--
-- Las tablas se buscan con to_regclass y la función con to_regprocedure (nombres
-- calificados), así el resultado no depende del search_path de la sesión y la consulta no
-- falla antes de migrar. Antes de migrar todo sale false.
--
-- Ojo: en `suscripciones` la pasarela va en `proveedor_pago` (columna de la 0001); en las
-- tablas nuevas la columna se llama `proveedor`.

with columnas as (
  select c.relname::text as tabla, a.attname::text as columna,
         format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) as defecto
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid in (to_regclass('public.clientes_pago'), to_regclass('public.pagos'),
                       to_regclass('public.eventos_pasarela'), to_regclass('public.suscripciones'))
    and a.attnum > 0 and not a.attisdropped
),
esperadas(tabla, columna, tipo, nn) as (
  values
    ('clientes_pago', 'organizacion_id', 'uuid', true),
    ('clientes_pago', 'proveedor', 'text', true),
    ('clientes_pago', 'cliente_externo', 'text', true),
    ('clientes_pago', 'tarjeta_marca', 'text', false),
    ('clientes_pago', 'tarjeta_ultimos4', 'text', false),
    ('clientes_pago', 'tarjeta_registrada_en', 'timestamp with time zone', false),
    ('clientes_pago', 'plan_pendiente_id', 'uuid', false),
    ('clientes_pago', 'plan_pendiente_por', 'uuid', false),
    ('clientes_pago', 'plan_pendiente_en', 'timestamp with time zone', false),
    ('clientes_pago', 'creado_en', 'timestamp with time zone', true),
    ('clientes_pago', 'actualizado_en', 'timestamp with time zone', true),
    ('pagos', 'id', 'uuid', true),
    ('pagos', 'organizacion_id', 'uuid', true),
    ('pagos', 'suscripcion_id', 'uuid', false),
    ('pagos', 'proveedor', 'text', true),
    ('pagos', 'factura_externa', 'text', true),
    ('pagos', 'orden_externa', 'text', false),
    ('pagos', 'monto_clp', 'integer', true),
    ('pagos', 'estado', 'text', true),
    ('pagos', 'periodo_inicio', 'date', false),
    ('pagos', 'periodo_fin', 'date', false),
    ('pagos', 'vence_en', 'date', false),
    ('pagos', 'pagado_en', 'timestamp with time zone', false),
    ('pagos', 'medio', 'text', false),
    ('pagos', 'enlace_pago', 'text', false),
    ('pagos', 'intentos', 'integer', true),
    ('pagos', 'error', 'text', false),
    ('pagos', 'creado_en', 'timestamp with time zone', true),
    ('pagos', 'actualizado_en', 'timestamp with time zone', true),
    ('eventos_pasarela', 'id', 'uuid', true),
    ('eventos_pasarela', 'proveedor', 'text', true),
    ('eventos_pasarela', 'tipo', 'text', true),
    ('eventos_pasarela', 'token', 'text', true),
    ('eventos_pasarela', 'organizacion_id', 'uuid', false),
    ('eventos_pasarela', 'estado', 'text', true),
    ('eventos_pasarela', 'intentos', 'integer', true),
    ('eventos_pasarela', 'datos', 'jsonb', true),
    ('eventos_pasarela', 'error', 'text', false),
    ('eventos_pasarela', 'recibido_en', 'timestamp with time zone', true),
    ('eventos_pasarela', 'procesado_en', 'timestamp with time zone', false)
),
comparadas as (
  select e.tabla, count(*) as esperadas,
         count(*) filter (where c.columna is not null and c.tipo = e.tipo and c.attnotnull = e.nn) as calzan,
         (select count(*) from columnas x where x.tabla = e.tabla) as existentes
  from esperadas e
  left join columnas c on c.tabla = e.tabla and c.columna = e.columna
  group by e.tabla
),
restricciones as (
  select t.relname::text as tabla, c.conname::text as nombre, c.contype,
         pg_get_constraintdef(c.oid) as definicion, c.confrelid, c.confdeltype
  from pg_constraint c join pg_class t on t.oid = c.conrelid
  where c.conrelid in (to_regclass('public.clientes_pago'), to_regclass('public.pagos'),
                       to_regclass('public.eventos_pasarela'))
),
tablas(tabla) as (
  values ('clientes_pago'), ('pagos'), ('eventos_pasarela')
),
funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, p.proargnames, p.pronargdefaults,
         l.lanname, pg_get_function_result(p.oid) as resultado
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.activar_suscripcion(uuid, uuid, public.estado_suscripcion, text, text, timestamp with time zone, timestamp with time zone)')
)
select * from (
  select 1 as n, 'la tabla clientes_pago existe con sus 11 columnas, tipos y not null' as verificacion,
         coalesce((select calzan = 11 and existentes = 11 from comparadas where tabla = 'clientes_pago'), false) as ok,
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end, ', ')
            from columnas where tabla = 'clientes_pago') as detalle
  union all
  select 2, 'clientes_pago: llave primaria (organizacion_id), única (proveedor, cliente_externo); FK organizacion_id → organizaciones on delete cascade, plan_pendiente_id → planes (sin acción), plan_pendiente_por → auth.users on delete set null',
         exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'p'
                  and definicion = 'PRIMARY KEY (organizacion_id)')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'u'
                      and definicion = 'UNIQUE (proveedor, cliente_externo)')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'f'
                      and confrelid = 'public.organizaciones'::regclass and confdeltype = 'c'
                      and definicion like 'FOREIGN KEY (organizacion_id)%')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'f'
                      and confrelid = 'public.planes'::regclass and confdeltype = 'a'
                      and definicion like 'FOREIGN KEY (plan_pendiente_id)%')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'f'
                      and confrelid = 'auth.users'::regclass and confdeltype = 'n'
                      and definicion like 'FOREIGN KEY (plan_pendiente_por)%')
         and (select count(*) from restricciones where tabla = 'clientes_pago' and contype = 'f') = 3,
         (select string_agg(nombre || ': ' || definicion, '; ' order by nombre)
            from restricciones where tabla = 'clientes_pago' and contype in ('p', 'u', 'f'))
  union all
  select 3, 'clientes_pago: 4 check (proveedor solo flow, cliente_externo de 1 a 100, marca hasta 40, últimos 4 = 4 dígitos)',
         (select count(*) from restricciones where tabla = 'clientes_pago' and contype = 'c') = 4
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'c'
                      and definicion like '%proveedor = ''flow''%')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'c'
                      and definicion like '%length(cliente_externo) >= 1%' and definicion like '%<= 100%')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'c'
                      and definicion like '%length(tarjeta_marca) <= 40%')
         and exists (select 1 from restricciones where tabla = 'clientes_pago' and contype = 'c'
                      and definicion like '%tarjeta_ultimos4 ~ ''^[0-9]{4}$''%'),
         (select string_agg(definicion, '; ' order by nombre) from restricciones
           where tabla = 'clientes_pago' and contype = 'c')
  union all
  select 4, 'la tabla pagos existe con sus 18 columnas, tipos y not null',
         coalesce((select calzan = 18 and existentes = 18 from comparadas where tabla = 'pagos'), false),
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end, ', ')
            from columnas where tabla = 'pagos')
  union all
  select 5, 'pagos: llave primaria (id), única (proveedor, factura_externa) para el upsert; FK organizacion_id on delete cascade y suscripcion_id on delete set null',
         exists (select 1 from restricciones where tabla = 'pagos' and contype = 'p' and definicion = 'PRIMARY KEY (id)')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'u'
                      and definicion = 'UNIQUE (proveedor, factura_externa)')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'f'
                      and confrelid = 'public.organizaciones'::regclass and confdeltype = 'c'
                      and definicion like 'FOREIGN KEY (organizacion_id)%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'f'
                      and confrelid = 'public.suscripciones'::regclass and confdeltype = 'n'
                      and definicion like 'FOREIGN KEY (suscripcion_id)%')
         and (select count(*) from restricciones where tabla = 'pagos' and contype = 'f') = 2,
         (select string_agg(nombre || ': ' || definicion, '; ' order by nombre)
            from restricciones where tabla = 'pagos' and contype in ('p', 'u', 'f'))
  union all
  select 6, 'pagos: 9 check (proveedor flow, factura 1-100, orden hasta 100, monto >= 0, estado de 4 valores, medio hasta 60, enlace https, intentos >= 0, error hasta 500)',
         (select count(*) from restricciones where tabla = 'pagos' and contype = 'c') = 9
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%proveedor = ''flow''%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%monto_clp >= 0%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%''pendiente''%' and definicion like '%''vencido''%'
                      and definicion like '%''pagado''%' and definicion like '%''anulado''%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%enlace_pago ~ ''^https://''%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%intentos >= 0%')
         and exists (select 1 from restricciones where tabla = 'pagos' and contype = 'c'
                      and definicion like '%length(error) <= 500%'),
         (select string_agg(definicion, '; ' order by nombre) from restricciones
           where tabla = 'pagos' and contype = 'c')
  union all
  select 7, 'índice pagos_organizacion sobre (organizacion_id, periodo_inicio desc nulls last), válido',
         coalesce((select i.indisvalid
                          and pg_get_indexdef(i.indexrelid) like '%(organizacion_id, periodo_inicio DESC NULLS LAST)%'
                     from pg_index i
                    where i.indexrelid = to_regclass('public.pagos_organizacion')
                      and i.indrelid = to_regclass('public.pagos')), false),
         pg_get_indexdef(to_regclass('public.pagos_organizacion'))
  union all
  select 8, 'la tabla eventos_pasarela existe con sus 11 columnas, tipos y not null (estado ''recibido'', intentos 1 y datos ''{}'' por defecto)',
         coalesce((select calzan = 11 and existentes = 11 from comparadas where tabla = 'eventos_pasarela'), false)
         and exists (select 1 from columnas where tabla = 'eventos_pasarela' and columna = 'estado'
                      and defecto = '''recibido''::text')
         and exists (select 1 from columnas where tabla = 'eventos_pasarela' and columna = 'intentos'
                      and defecto = '1')
         and exists (select 1 from columnas where tabla = 'eventos_pasarela' and columna = 'datos'
                      and defecto = '''{}''::jsonb'),
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end
                            || coalesce(' default ' || defecto, ''), ', ')
            from columnas where tabla = 'eventos_pasarela')
  union all
  select 9, 'eventos_pasarela: llave primaria (id), única (proveedor, tipo, token), FK organizacion_id on delete set null; 6 check (proveedor flow, tipo registro/pago, token 1-200, estado de 4 valores, intentos >= 1, error)',
         exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'p'
                  and definicion = 'PRIMARY KEY (id)')
         and exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'u'
                      and definicion = 'UNIQUE (proveedor, tipo, token)')
         and exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'f'
                      and confrelid = 'public.organizaciones'::regclass and confdeltype = 'n'
                      and definicion like 'FOREIGN KEY (organizacion_id)%')
         and (select count(*) from restricciones where tabla = 'eventos_pasarela' and contype = 'c') = 6
         and exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'c'
                      and definicion like '%''registro''%' and definicion like '%''pago''%')
         and exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'c'
                      and definicion like '%''recibido''%' and definicion like '%''procesado''%'
                      and definicion like '%''ignorado''%' and definicion like '%''fallido''%')
         and exists (select 1 from restricciones where tabla = 'eventos_pasarela' and contype = 'c'
                      and definicion like '%intentos >= 1%'),
         (select string_agg(nombre || ': ' || definicion, '; ' order by nombre)
            from restricciones where tabla = 'eventos_pasarela')
  union all
  select 10, 'trigger trg_90_actualizado_en (before update, tg_actualizado_en) activo en clientes_pago y pagos',
         (select count(*) from pg_trigger t
           where t.tgrelid in (to_regclass('public.clientes_pago'), to_regclass('public.pagos'))
             and t.tgname = 'trg_90_actualizado_en' and t.tgenabled = 'O'
             and t.tgfoid = 'public.tg_actualizado_en()'::regprocedure
             and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16) = 2,
         (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ') from pg_trigger t
           where t.tgrelid in (to_regclass('public.clientes_pago'), to_regclass('public.pagos'),
                               to_regclass('public.eventos_pasarela')) and not t.tgisinternal)
  union all
  select 11, 'RLS activo en las 3 tablas',
         (select count(*) from tablas t join pg_class c on c.oid = to_regclass('public.' || t.tabla)
           where c.relrowsecurity) = 3,
         (select string_agg(t.tabla || '=' || coalesce(c.relrowsecurity::text, 'NO EXISTE'), ', ')
            from tablas t left join pg_class c on c.oid = to_regclass('public.' || t.tabla))
  union all
  select 12, 'políticas: una sola en clientes_pago y en pagos, lectura (SELECT, authenticated, es_admin); ninguna en eventos_pasarela',
         (select count(*) from pg_policies where schemaname = 'public'
           and tablename in ('clientes_pago', 'pagos', 'eventos_pasarela')) = 2
         and (select count(*) from pg_policies
               where schemaname = 'public' and tablename in ('clientes_pago', 'pagos')
                 and policyname = 'lectura' and cmd = 'SELECT'
                 and roles = array['authenticated']::name[]
                 and qual like '%es_admin(organizacion_id)%') = 2,
         (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ',')
                            || ':' || coalesce(qual, '-'), '; ')
            from pg_policies where schemaname = 'public'
              and tablename in ('clientes_pago', 'pagos', 'eventos_pasarela'))
  union all
  select 13, 'privilegios: authenticated solo SELECT en clientes_pago y pagos y nada en eventos_pasarela; anon nada; service_role escribe en las 3',
         case when to_regclass('public.clientes_pago') is null or to_regclass('public.pagos') is null
                   or to_regclass('public.eventos_pasarela') is null then false
              else has_table_privilege('authenticated', to_regclass('public.clientes_pago'), 'select')
                   and has_table_privilege('authenticated', to_regclass('public.pagos'), 'select')
                   and not has_table_privilege('authenticated', to_regclass('public.clientes_pago'),
                             'insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('authenticated', to_regclass('public.pagos'),
                             'insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('authenticated', to_regclass('public.eventos_pasarela'),
                             'select, insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('anon', to_regclass('public.clientes_pago'),
                             'select, insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('anon', to_regclass('public.pagos'),
                             'select, insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('anon', to_regclass('public.eventos_pasarela'),
                             'select, insert, update, delete, truncate, references, trigger')
                   and has_table_privilege('service_role', to_regclass('public.clientes_pago'), 'select, insert, update, delete')
                   and has_table_privilege('service_role', to_regclass('public.pagos'), 'select, insert, update, delete')
                   and has_table_privilege('service_role', to_regclass('public.eventos_pasarela'), 'select, insert, update, delete')
                   -- Sin privilegios por columna que abran una puerta lateral.
                   and not exists (select 1 from pg_attribute a
                                    where a.attrelid in (to_regclass('public.clientes_pago'), to_regclass('public.pagos'),
                                                         to_regclass('public.eventos_pasarela'))
                                      and a.attacl is not null)
         end,
         (select string_agg(t.tabla || ' ' || coalesce(c.relacl::text, '-'), '; ')
            from tablas t left join pg_class c on c.oid = to_regclass('public.' || t.tabla))
  union all
  select 14, 'suscripciones: cancelar_al_fin_periodo boolean not null default false y sincronizada_en timestamptz (nullable)',
         exists (select 1 from columnas where tabla = 'suscripciones' and columna = 'cancelar_al_fin_periodo'
                  and tipo = 'boolean' and attnotnull and defecto = 'false')
         and exists (select 1 from columnas where tabla = 'suscripciones' and columna = 'sincronizada_en'
                      and tipo = 'timestamp with time zone' and not attnotnull),
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end
                            || coalesce(' default ' || defecto, ''), ', ')
            from columnas where tabla = 'suscripciones'
              and columna in ('cancelar_al_fin_periodo', 'sincronizada_en', 'proveedor_pago', 'id_externo'))
  union all
  select 15, 'índice suscripciones_externa_unica: único, válido, sobre (proveedor_pago, id_externo) y parcial (id_externo is not null)',
         coalesce((select i.indisunique and i.indisvalid
                          and pg_get_indexdef(i.indexrelid) like '%(proveedor_pago, id_externo) WHERE (id_externo IS NOT NULL)'
                     from pg_index i
                    where i.indexrelid = to_regclass('public.suscripciones_externa_unica')
                      and i.indrelid = to_regclass('public.suscripciones')), false),
         pg_get_indexdef(to_regclass('public.suscripciones_externa_unica'))
  union all
  select 16, 'activar_suscripcion(uuid, uuid, estado_suscripcion, text, text, timestamptz, timestamptz) existe, devuelve uuid, con sus nombres de parámetros y 4 opcionales',
         coalesce((select resultado = 'uuid'
                          and proargnames = array['p_organizacion', 'p_plan', 'p_estado', 'p_proveedor',
                                                  'p_id_externo', 'p_periodo_inicio', 'p_periodo_fin']
                          and pronargdefaults = 4
                     from funcion), false),
         (select resultado || ' (' || array_to_string(proargnames, ', ') || ') opcionales=' || pronargdefaults
            from funcion)
  union all
  select 17, 'activar_suscripcion: plpgsql, security definer y search_path vacío',
         coalesce((select lanname = 'plpgsql' and prosecdef and proconfig @> array['search_path=""'] from funcion), false),
         (select lanname || ' definer=' || prosecdef::text || ' ' || coalesce(array_to_string(proconfig, ', '), '-')
            from funcion)
  union all
  select 18, 'solo service_role ejecuta activar_suscripcion (authenticated, anon y PUBLIC no)',
         coalesce((select has_function_privilege('service_role', oid, 'execute')
                          and not has_function_privilege('authenticated', oid, 'execute')
                          and not has_function_privilege('anon', oid, 'execute')
                          and not exists (select 1 from aclexplode(proacl) a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion), false),
         (select coalesce(proacl::text, '-') from funcion)
  union all
  select 19, 'cuerpo de activar_suscripcion: errores 22004/22023/P0002, solo prueba o activa, bloquea la organización con for no key update (no frena los insert de tablas hijas) y la vigente con for update, rechaza un id externo ya cancelado (22023), compara proveedor_pago e id_externo, cancela la anterior e inserta la nueva',
         coalesce((select prosrc like '%errcode = ''22004''%'
                          and prosrc like '%errcode = ''22023''%'
                          and prosrc like '%errcode = ''P0002''%'
                          and prosrc like '%p_estado not in (''prueba'', ''activa'')%'
                          and prosrc like '%from public.organizaciones where id = p_organizacion for no key update%'
                          and regexp_replace(prosrc, '\s+', ' ', 'g')
                                like '%where proveedor_pago = p_proveedor and id_externo = p_id_externo and estado = ''cancelada''%'
                          and prosrc like '%ya terminó%'
                          and prosrc like '%estado in (''prueba'', ''activa'', ''morosa'')%'
                          and regexp_replace(prosrc, '\s+', ' ', 'g')
                                like '%estado in (''prueba'', ''activa'', ''morosa'') for update%'
                          and prosrc like '%v_vigente.proveedor_pago = p_proveedor%'
                          and prosrc like '%v_vigente.id_externo = p_id_externo%'
                          and prosrc like '%estado = ''cancelada''%'
                          and prosrc like '%insert into public.suscripciones%'
                     from funcion), false),
         null
  union all
  select 20, 'ninguna de las 3 tablas está en supabase_realtime y la migración está registrada como 0016',
         not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename in ('clientes_pago', 'pagos', 'eventos_pasarela'))
         and exists (select 1 from supabase_migrations.schema_migrations where version = '0016'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
