-- Verificación de las migraciones 0001 y 0002 en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea extensiones ni objetos. Se ejecuta tal cual en el
-- SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben
-- salir con ok = true.

with tablas_esperadas(nombre) as (
  values ('tipos_dte'), ('estados_sii'), ('planes'), ('perfiles'), ('organizaciones'),
         ('miembros_organizacion'), ('invitaciones'), ('suscripciones'), ('uso_mensual'),
         ('empresas'), ('resoluciones'), ('certificados'), ('empresa_certificados'),
         ('tokens_sii'), ('sesiones_sii'), ('cafs'), ('solicitudes_folios'),
         ('folios_anulados'), ('receptores'), ('productos'), ('envios'),
         ('envio_estadisticas'), ('consultas_envio'), ('documentos'), ('documento_detalles'),
         ('envio_rechazos'), ('rcof'), ('procesos_certificacion'), ('set_pruebas_casos'),
         ('operaciones_sii'), ('api_keys'), ('webhooks'), ('webhook_entregas')
),
firma_token_guardar(f) as (
  values ('public.token_guardar(public.canal_sii, public.ambiente_sii, text, text, bytea, timestamptz)')
)
select * from (
  select 1 as n, 'existen las 33 tablas' as verificacion,
         not exists (select 1 from tablas_esperadas t
                      where to_regclass('public.' || t.nombre) is null) as ok,
         (select string_agg(t.nombre, ', ') from tablas_esperadas t
           where to_regclass('public.' || t.nombre) is null) as detalle
  union all
  select 2, 'RLS activo en todas las tablas de public',
         not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                      where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
         (select string_agg(c.relname, ', ') from pg_class c
            join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
  union all
  select 3, 'tokens_sii y sesiones_sii sin políticas',
         not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename in ('tokens_sii', 'sesiones_sii')),
         null
  union all
  select 4, 'authenticated no lee tokens_sii',
         not has_table_privilege('authenticated', 'public.tokens_sii', 'select'), null
  union all
  select 5, 'anon no lee sesiones_sii',
         not has_table_privilege('anon', 'public.sesiones_sii', 'select'), null
  union all
  select 6, 'service_role escribe tokens_sii',
         has_table_privilege('service_role', 'public.tokens_sii', 'insert'), null
  union all
  select 7, 'authenticated no ejecuta token_guardar',
         not has_function_privilege('authenticated', (select f from firma_token_guardar), 'execute'),
         null
  union all
  select 8, 'service_role ejecuta token_guardar',
         has_function_privilege('service_role', (select f from firma_token_guardar), 'execute'), null
  union all
  select 9, 'authenticated no ejecuta leer_secreto',
         not has_function_privilege('authenticated', 'public.leer_secreto(uuid)', 'execute'), null
  union all
  select 10, 'extensiones Vault, pg_cron y pg_net',
         (select count(*) from pg_extension
           where extname in ('supabase_vault', 'pg_cron', 'pg_net')) = 3,
         (select string_agg(extname || ' ' || extversion, ', ') from pg_extension
           where extname in ('supabase_vault', 'pg_cron', 'pg_net'))
  union all
  select 11, 'bucket documentos-xml existe y es privado',
         coalesce((select not public from storage.buckets where id = 'documentos-xml'), false),
         null
  union all
  select 12, 'Realtime publica documentos, envios y procesos_certificacion',
         (select array_agg(tablename::text order by tablename) from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public')
           = array['documentos', 'envios', 'procesos_certificacion'],
         (select string_agg(tablename::text, ', ' order by tablename) from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public')
  union all
  select 13, 'tipos_dte trae las boletas 39 y 41',
         (select array_agg(codigo::int order by codigo) from public.tipos_dte) = array[39, 41],
         null
) v
order by n;
