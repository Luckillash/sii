-- Verificación de la migración 0019_cron_webhooks en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no agenda ni desagenda nada y no llama a pg_net. Se ejecuta tal
-- cual en el SQL Editor o con el MCP `execute_sql` como `postgres` (lee `cron.job` y
-- descifra `cron_token` para la comprobación 6; con `supabase db query --read-only` esa
-- falla con 42501, igual que la 9 de `0014_cron.sql`). Cada fila es una comprobación:
-- todas deben salir con ok = true.
--
-- NO MUESTRA EL SECRETO: de Vault solo cuenta filas por nombre, y la comprobación 6
-- compara el valor de `cron_token` con los comandos DENTRO de la consulta y devuelve solo
-- true/false (su `detalle` es siempre null).
--
-- 9 comprobaciones: 1 requisitos (extensiones, cron_token y la 0018); 2 los 3 jobs, una
-- vez cada uno, con su horario; 3 el comando HTTP (URL, Bearer leído de Vault en tiempo de
-- ejecución, timeout); 4 la limpieza de entregas; 5 activos, base y usuario; 6 ningún comando contiene
-- el secreto; 7 sin corridas fallidas en la última hora; 8 migración registrada; 9 la
-- limpieza de `api_idempotencia`.
-- Antes de migrar salen true la 1 (con la 0018 aplicada), la 6 y la 7. La 7 solo dice algo
-- pasados unos minutos: para ver si la ruta responde, mira además net._http_response
-- (status_code 200) y el *cron monitor* `cron-webhooks` de Sentry.
--
-- Después de aplicar la 0019, la comprobación 10 de `0014_cron.sql` da false (ya lo hacía
-- desde la 0017): es lo esperado.

with esperados(jobname, horario) as (
  values
    ('entregar-webhooks', '* * * * *'),
    ('limpiar-webhook-entregas', '37 4 * * *'),
    ('limpiar-api-idempotencia', '47 4 * * *')
),
jobs as (
  select j.jobid, j.jobname, j.schedule, j.command, j.active, j.database, j.username,
         regexp_replace(j.command, '\s+', ' ', 'g') as comando
  from cron.job j
  where j.jobname in (select jobname from esperados)
)
select * from (
  select 1 as n, 'requisitos: pg_cron y pg_net instalados, cron_token en Vault una sola vez y la 0018 aplicada (reclamar_entregas_webhook existe)' as verificacion,
         (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net')) = 2
         and (select count(*) from vault.secrets where name = 'cron_token') = 1
         and to_regprocedure('public.reclamar_entregas_webhook(integer, integer)') is not null as ok,
         (select string_agg(extname || ' ' || extversion, ', ') from pg_extension
           where extname in ('pg_cron', 'pg_net'))
         || ' · ' || (select count(*)::text from vault.secrets where name = 'cron_token') || ' cron_token' as detalle
  union all
  select 2, 'los 3 jobs existen una sola vez cada uno con su horario',
         (select count(*) from jobs j join esperados e on e.jobname = j.jobname and e.horario = j.schedule) = 3
         and (select count(*) from jobs) = 3,
         (select string_agg(jobname || ' «' || schedule || '»', ', ' order by jobname) from jobs)
  union all
  select 3, 'entregar-webhooks: net.http_post a https://boleteame.dev/api/cron/webhooks, Content-Type JSON, Bearer leído de vault.decrypted_secrets por name = cron_token (no un literal) y timeout de 60 s',
         coalesce((select comando like '%net.http_post(%'
                          and comando like '%url := ''https://boleteame.dev/api/cron/webhooks''%'
                          and comando like '%''Content-Type'', ''application/json''%'
                          and comando like '%''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''cron_token'' limit 1)%'
                          and comando !~ '''Bearer [^'']'
                          and comando like '%timeout_milliseconds := 60000%'
                     from jobs where jobname = 'entregar-webhooks'), false),
         (select comando from jobs where jobname = 'entregar-webhooks')
  union all
  select 4, 'limpiar-webhook-entregas borra solo entregas entregado o descartado de más de 30 días',
         coalesce((select comando ~* '^\s*delete from public\.webhook_entregas where estado in \(''entregado'', ''descartado''\) and creado_en < now\(\) - interval ''30 days''\s*$'
                     from jobs where jobname = 'limpiar-webhook-entregas'), false),
         (select comando from jobs where jobname = 'limpiar-webhook-entregas')
  union all
  select 5, 'los 3 activos, en la base postgres y como usuario postgres',
         (select count(*) from jobs where active and database = 'postgres' and username = 'postgres') = 3,
         (select string_agg(jobname || ' active=' || active || ' ' || database || '/' || username, ', '
                            order by jobname) from jobs)
  union all
  select 6, 'ningún job de pg_cron contiene el valor de cron_token (el detalle nunca lo muestra)',
         not exists (select 1 from cron.job j, vault.decrypted_secrets s
                      where s.name = 'cron_token' and length(s.decrypted_secret) > 0
                        and strpos(j.command, s.decrypted_secret) > 0),
         null
  union all
  select 7, 'ninguna corrida fallida de estos jobs en la última hora',
         not exists (select 1 from cron.job_run_details d join jobs j on j.jobid = d.jobid
                      where d.status = 'failed' and d.start_time > now() - interval '1 hour'),
         (select string_agg(j.jobname || ': ' || left(coalesce(d.return_message, ''), 120), ' | ')
            from cron.job_run_details d join jobs j on j.jobid = d.jobid
           where d.status = 'failed' and d.start_time > now() - interval '1 hour')
  union all
  select 8, 'migración registrada como 0019',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0019'),
         (select string_agg(version, ', ' order by version) from supabase_migrations.schema_migrations
           where version >= '0015')
  union all
  select 9, 'limpiar-api-idempotencia borra solo claves terminada de más de 30 días o en_curso reclamadas hace más de 7 días',
         coalesce((select comando ~* '^\s*delete from public\.api_idempotencia where \(estado = ''terminada'' and terminada_en < now\(\) - interval ''30 days''\) or \(estado = ''en_curso'' and reclamada_en < now\(\) - interval ''7 days''\)\s*$'
                     from jobs where jobname = 'limpiar-api-idempotencia'), false),
         (select comando from jobs where jobname = 'limpiar-api-idempotencia')
) v
order by n;
