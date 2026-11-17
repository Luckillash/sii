-- Verificación de la migración 0013_notificaciones en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a ninguna de las funciones. Se
-- ejecuta tal cual en el SQL Editor o con el MCP `execute_sql`. Cada fila es una
-- comprobación: todas deben salir con ok = true.
-- La prueba de comportamiento (reclamar una vez, no repetir, reintentar una fallida o
-- abandonada hasta 5 intentos conservando el grupo, no robar la clave de otra
-- organización, candidatos sin lo ya avisado y por turnos entre organizaciones, los check
-- de la tabla y el RLS por rol) está en rls-fase8-notificaciones.sql, con transacción y
-- rollback.
-- 18 comprobaciones: 1-8 la tabla (columnas, llaves, check, índice, trigger, RLS y
-- privilegios); 9-13 reclamar_notificacion; 14-17 notificacion_cerrada y las tres
-- funciones de candidatos; 18 fuera de Realtime y migración registrada.
--
-- Las funciones se buscan con to_regprocedure (firma calificada), así el resultado no
-- depende del search_path de la sesión. Antes de migrar todo sale false.

with columnas as (
  select a.attname::text as columna, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull
  from pg_attribute a
  where a.attrelid = to_regclass('public.notificaciones') and a.attnum > 0 and not a.attisdropped
),
restricciones as (
  select c.conname::text as nombre, c.contype, pg_get_constraintdef(c.oid) as definicion,
         c.confrelid, c.confdeltype
  from pg_constraint c
  where c.conrelid = to_regclass('public.notificaciones')
),
esperadas(nombre, firma, resultado, argumentos) as (
  values
    ('reclamar_notificacion', 'public.reclamar_notificacion(uuid, text, text, uuid, jsonb)',
     'TABLE(id uuid, intentos integer, grupo text)',
     array['p_organizacion', 'p_tipo', 'p_clave', 'p_referencia', 'p_datos']),
    ('notificacion_cerrada', 'public.notificacion_cerrada(text)', 'boolean',
     array['p_clave']),
    ('alertas_documentos_rechazados', 'public.alertas_documentos_rechazados(timestamp with time zone, integer)',
     'TABLE(id uuid, organizacion_id uuid, empresa_id uuid, ambiente ambiente_sii, tipo_dte smallint, folio integer, mnt_total bigint, fecha_emision date, envio_id uuid)',
     array['p_desde', 'p_limite']),
    ('alertas_envios_inciertos', 'public.alertas_envios_inciertos(timestamp with time zone, integer)',
     'TABLE(id uuid, organizacion_id uuid, empresa_id uuid, ambiente ambiente_sii, creado_en timestamp with time zone)',
     array['p_desde', 'p_limite']),
    ('alertas_certificados_por_vencer', 'public.alertas_certificados_por_vencer(integer)',
     'TABLE(id uuid, organizacion_id uuid, rut_titular text, nombre_titular text, cn text, vigente_hasta timestamp with time zone, dias_restantes integer, umbral integer)',
     array['p_limite'])
),
funciones as (
  select e.nombre, e.resultado as esperado, e.argumentos, p.oid, p.prosecdef, p.proconfig,
         p.proacl, p.prosrc, p.provolatile, l.lanname,
         -- Solo los parámetros de entrada (en `returns table` proargnames trae también las columnas).
         (select array_agg(n order by i) from unnest(p.proargnames, p.proargmodes) with ordinality
            as x(n, m, i) where m is null or m in ('i', 'b')) as entradas,
         case when p.proargmodes is null then p.proargnames end as nombres_simples,
         regexp_replace(pg_get_function_result(p.oid), 'public\.', '', 'g') as resultado
  from esperadas e
  left join pg_proc p on p.oid = to_regprocedure(e.firma)
  left join pg_language l on l.oid = p.prolang
)
select * from (
  select 1 as n, 'la tabla notificaciones existe con sus 15 columnas, tipos y not null' as verificacion,
         (select count(*) from columnas c join (values
            ('id', 'uuid', true),
            ('organizacion_id', 'uuid', true),
            ('tipo', 'text', true),
            ('referencia_id', 'uuid', false),
            ('clave', 'text', true),
            ('grupo', 'text', false),
            ('datos', 'jsonb', true),
            ('destinatarios', 'text[]', true),
            ('estado', 'text', true),
            ('intentos', 'integer', true),
            ('resend_id', 'text', false),
            ('error', 'text', false),
            ('creado_en', 'timestamp with time zone', true),
            ('actualizado_en', 'timestamp with time zone', true),
            ('enviado_en', 'timestamp with time zone', false)) e(columna, tipo, nn)
            on e.columna = c.columna and e.tipo = c.tipo and e.nn = c.attnotnull) = 15
         and (select count(*) from columnas) = 15 as ok,
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end, ', ')
            from columnas) as detalle
  union all
  select 2, 'llave primaria (id) y clave única (clave) para deduplicar',
         exists (select 1 from restricciones where contype = 'p' and definicion = 'PRIMARY KEY (id)')
         and exists (select 1 from restricciones
                      where contype = 'u' and nombre = 'notificaciones_clave_unica'
                        and definicion = 'UNIQUE (clave)'),
         (select string_agg(nombre || ': ' || definicion, '; ') from restricciones where contype in ('p', 'u'))
  union all
  select 3, 'organizacion_id referencia organizaciones(id) con on delete cascade',
         exists (select 1 from restricciones
                  where contype = 'f' and confrelid = 'public.organizaciones'::regclass
                    and confdeltype = 'c' and definicion like 'FOREIGN KEY (organizacion_id)%'),
         null
  union all
  select 4, 'check de tipo (formato de evento), clave (empieza por tipo:), estado (3 valores), enviada con fecha, intentos, datos objeto, destinatarios y textos acotados (con grupo)',
         (select count(*) from restricciones where contype = 'c' and nombre in (
            'notificaciones_tipo_valido', 'notificaciones_clave_valida', 'notificaciones_estado_valido',
            'notificaciones_enviada_con_fecha', 'notificaciones_intentos_validos',
            'notificaciones_datos_objeto', 'notificaciones_destinatarios_acotados',
            'notificaciones_textos_acotados')) = 8
         and coalesce((select definicion like '%starts_with(clave, (tipo || '':''::text))%'
                         from restricciones where nombre = 'notificaciones_clave_valida'), false)
         and coalesce((select definicion like '%pendiente%' and definicion like '%enviada%'
                              and definicion like '%fallida%'
                         from restricciones where nombre = 'notificaciones_estado_valido'), false)
         and coalesce((select definicion like '%grupo%'
                         from restricciones where nombre = 'notificaciones_textos_acotados'), false),
         (select string_agg(nombre, ', ' order by nombre) from restricciones where contype = 'c')
  union all
  select 5, 'índice notificaciones_organizacion sobre (organizacion_id, creado_en desc), válido',
         coalesce((select i.indisvalid
                          and pg_get_indexdef(i.indexrelid) like '%(organizacion_id, creado_en DESC)%'
                     from pg_index i
                    where i.indexrelid = to_regclass('public.notificaciones_organizacion')
                      and i.indrelid = to_regclass('public.notificaciones')), false),
         pg_get_indexdef(to_regclass('public.notificaciones_organizacion'))
  union all
  select 6, 'trigger trg_90_actualizado_en (before update, tg_actualizado_en) activo',
         exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.notificaciones')
                    and t.tgname = 'trg_90_actualizado_en' and t.tgenabled = 'O'
                    and t.tgfoid = 'public.tg_actualizado_en()'::regprocedure
                    and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16),
         null
  union all
  select 7, 'RLS activo con una sola política: lectura (SELECT, authenticated, es_miembro)',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.notificaciones')), false)
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notificaciones') = 1
         and exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'notificaciones'
                        and policyname = 'lectura' and cmd = 'SELECT'
                        and roles = array['authenticated']::name[]
                        and qual like '%es_miembro(organizacion_id)%'),
         (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), '; ')
            from pg_policies where schemaname = 'public' and tablename = 'notificaciones')
  union all
  select 8, 'authenticated solo lee (sin INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ni TRIGGER), anon no tiene nada y service_role escribe',
         case when to_regclass('public.notificaciones') is null then false
              else has_table_privilege('authenticated', to_regclass('public.notificaciones'), 'select')
                   and not has_table_privilege('authenticated', to_regclass('public.notificaciones'),
                             'insert, update, delete, truncate, references, trigger')
                   and not has_table_privilege('anon', to_regclass('public.notificaciones'),
                             'select, insert, update, delete, truncate, references, trigger')
                   and has_table_privilege('service_role', to_regclass('public.notificaciones'),
                             'select, insert, update')
         end,
         (select relacl::text from pg_class where oid = to_regclass('public.notificaciones'))
  union all
  select 9, 'las 5 funciones existen con su firma y devuelven lo esperado (reclamar_notificacion: TABLE(id, intentos, grupo))',
         (select count(*) from funciones where oid is not null and resultado = esperado) = 5,
         (select string_agg(nombre || ': ' || coalesce(resultado, 'NO EXISTE con esa firma'), '; ')
            from funciones where oid is null or resultado <> esperado)
  union all
  select 10, 'nombres de los parámetros de entrada (los que usa server/alertas al llamar por RPC)',
         (select count(*) from funciones
           where oid is not null and coalesce(entradas, nombres_simples) = argumentos) = 5,
         (select string_agg(nombre || '(' || coalesce(array_to_string(coalesce(entradas, nombres_simples), ', '), '-') || ')', '; ')
            from funciones)
  union all
  select 11, 'reclamar_notificacion: plpgsql, security definer y search_path vacío',
         coalesce((select lanname = 'plpgsql' and prosecdef and proconfig @> array['search_path=""']
                     from funciones where nombre = 'reclamar_notificacion' and oid is not null), false),
         (select coalesce(lanname, '-') || ' definer=' || coalesce(prosecdef::text, '-') || ' '
                 || coalesce(array_to_string(proconfig, ', '), '-')
            from funciones where nombre = 'reclamar_notificacion')
  union all
  select 12, 'solo service_role ejecuta las 5 (authenticated, anon y PUBLIC no)',
         coalesce((select bool_and(has_function_privilege('service_role', oid, 'execute')
                                   and not has_function_privilege('authenticated', oid, 'execute')
                                   and not has_function_privilege('anon', oid, 'execute')
                                   and not exists (select 1 from aclexplode(proacl) a
                                                    where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                          and count(*) = 5
                     from funciones where oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(proacl::text, '-'), '; ') from funciones)
  union all
  select 13, 'cuerpo de reclamar_notificacion: insert ... on conflict sobre la clave única, misma organización, menos de 5 intentos, fallida o pendiente de más de 15 minutos, devuelve el grupo',
         coalesce((select prosrc like '%on conflict on constraint notificaciones_clave_unica do update%'
                          and prosrc like '%n.organizacion_id = excluded.organizacion_id%'
                          and prosrc like '%n.intentos < 5%'
                          and prosrc like '%n.estado = ''fallida''%'
                          and prosrc like '%interval ''15 minutes''%'
                          and prosrc like '%returning n.id, n.intentos, n.grupo%'
                          and prosrc like '%errcode = ''22004''%'
                     from funciones where nombre = 'reclamar_notificacion' and oid is not null), false),
         null
  union all
  select 14, 'notificacion_cerrada: enviada, 5 intentos o pendiente de menos de 15 minutos (la negación de reclamar)',
         coalesce((select prosrc like '%n.estado = ''enviada''%'
                          and prosrc like '%n.intentos >= 5%'
                          and prosrc like '%n.actualizado_en >= now() - interval ''15 minutes''%'
                     from funciones where nombre = 'notificacion_cerrada' and oid is not null), false),
         null
  union all
  select 15, 'las 4 de lectura son sql, stable, security invoker y con search_path vacío',
         coalesce((select bool_and(lanname = 'sql' and provolatile = 's' and not prosecdef
                                   and proconfig @> array['search_path=""'])
                          and count(*) = 4
                     from funciones where nombre <> 'reclamar_notificacion' and oid is not null), false),
         (select string_agg(nombre || ' ' || coalesce(lanname, '-') || ' ' || coalesce(provolatile::text, '-')
                            || ' definer=' || coalesce(prosecdef::text, '-'), '; ')
            from funciones where nombre <> 'reclamar_notificacion')
  union all
  select 16, 'las 3 de candidatos excluyen lo ya avisado (notificacion_cerrada con su clave) y reparten por turnos por organización',
         coalesce((select bool_and(prosrc like '%not public.notificacion_cerrada(%'
                                   and prosrc ~ 'row_number\(\) over \(partition by [a-z]\.organizacion_id')
                          and count(*) = 3
                     from funciones where nombre like 'alertas\_%' and oid is not null), false)
         and coalesce((select prosrc like '%''documento.rechazado:'' || d.id::text%'
                              and prosrc like '%d.origen <> ''set_pruebas''%'
                              and prosrc like '%d.estado = ''rechazado''%'
                         from funciones where nombre = 'alertas_documentos_rechazados'), false)
         and coalesce((select prosrc like '%''envio.incierto:'' || e.id::text%'
                              and prosrc like '%e.proposito = ''emision''%'
                         from funciones where nombre = 'alertas_envios_inciertos'), false)
         and coalesce((select prosrc like '%''certificado.por_vencer:'' || u.id::text || '':'' || u.umbral::text%'
                              and prosrc like '%v.estado = ''por_vencer''%'
                         from funciones where nombre = 'alertas_certificados_por_vencer'), false),
         null
  union all
  select 17, 'umbral de certificados: 1, 7, 15 o 30 según dias_restantes (como umbralCertificado de la app)',
         coalesce((select regexp_replace(prosrc, '\s+', ' ', 'g')
                            like '%when v.dias_restantes <= 1 then 1 when v.dias_restantes <= 7 then 7 when v.dias_restantes <= 15 then 15 else 30%'
                     from funciones where nombre = 'alertas_certificados_por_vencer' and oid is not null), false),
         null
  union all
  select 18, 'notificaciones no está en supabase_realtime y la migración está registrada como 0013',
         not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'notificaciones')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '0013'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
