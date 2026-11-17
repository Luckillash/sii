-- Verificación de la migración 0014_cron en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no agenda ni desagenda nada y no llama a pg_net. Se ejecuta tal
-- cual en el SQL Editor o con el MCP `execute_sql` (como `postgres`, que lee `cron.job` y
-- Vault). Cada fila es una comprobación: todas deben salir con ok = true.
--
-- NO MUESTRA EL SECRETO: de Vault solo cuenta filas por nombre, y la comprobación 9
-- compara el valor de `cron_token` con los comandos DENTRO de la consulta y devuelve solo
-- true/false (el `detalle` de esa fila es siempre null). Los comandos que se muestran en
-- `detalle` no lo contienen (eso es justamente lo que verifica la 9).
--
-- 12 comprobaciones: 1-2 requisitos (extensiones y cron_token); 3 los 4 jobs, una vez cada
-- uno, con su horario; 4-5 los comandos HTTP (URL, Bearer leído de Vault en tiempo de
-- ejecución, timeout); 6-7 las limpiezas; 8 activos, base y usuario; 9 ningún comando
-- contiene el secreto; 10 nada más llama a /api/cron; 11 sin corridas fallidas en la
-- última hora; 12 migración registrada.
-- Antes de migrar salen true 1, 2, 9, 10 y 11 (si existen las extensiones y el secreto) y el
-- resto false. La 11 solo dice algo pasados unos minutos desde que se aplicó: para ver si
-- las rutas responden, mira además net._http_response (status_code 200 en las últimas
-- 6 horas) y los *cron monitors* de Sentry (`cron-seguimiento`, `cron-alertas`).

with esperados(jobname, horario) as (
  values
    ('seguimiento-envios', '*/5 * * * *'),
    ('alertas', '*/10 * * * *'),
    ('limpiar-tokens-sii', '17 * * * *'),
    ('limpiar-historial-cron', '23 3 * * *')
),
jobs as (
  select j.jobid, j.jobname, j.schedule, j.command, j.active, j.database, j.username,
         regexp_replace(j.command, '\s+', ' ', 'g') as comando
  from cron.job j
  where j.jobname in (select jobname from esperados)
),
-- El comando HTTP esperado, sin espacios repetidos: URL fija, Bearer desde Vault por nombre.
http(jobname, url, timeout) as (
  values
    ('seguimiento-envios', 'https://boleteame.dev/api/cron/seguimiento', 300000),
    ('alertas', 'https://boleteame.dev/api/cron/alertas', 60000)
)
select * from (
  select 1 as n, 'pg_cron y pg_net instalados' as verificacion,
         (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net')) = 2 as ok,
         (select string_agg(extname || ' ' || extversion, ', ') from pg_extension
           where extname in ('pg_cron', 'pg_net')) as detalle
  union all
  select 2, 'el secreto cron_token existe en Vault, una sola vez (no se lee su valor)',
         (select count(*) from vault.secrets where name = 'cron_token') = 1,
         (select count(*)::text || ' secreto(s) con ese nombre' from vault.secrets where name = 'cron_token')
  union all
  select 3, 'los 4 jobs existen una sola vez cada uno con su horario',
         (select count(*) from jobs j join esperados e
            on e.jobname = j.jobname and e.horario = j.schedule) = 4
         and (select count(*) from jobs) = 4,
         (select string_agg(jobname || ' «' || schedule || '»', ', ' order by jobname) from jobs)
  union all
  select 4, 'seguimiento-envios y alertas: net.http_post a su URL de Production, Content-Type JSON, Bearer leído de vault.decrypted_secrets por name = cron_token y su timeout',
         (select count(*) from jobs j join http h on h.jobname = j.jobname
           where j.comando like '%net.http_post(%'
             and j.comando like '%url := ''' || h.url || '''%'
             and j.comando like '%''Content-Type'', ''application/json''%'
             and j.comando like '%''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''cron_token'' limit 1)%'
             and j.comando like '%timeout_milliseconds := ' || h.timeout || '%') = 2,
         (select string_agg(jobname || ': ' || comando, ' | ' order by jobname) from jobs
           where jobname in ('seguimiento-envios', 'alertas'))
  union all
  select 5, 'el Bearer no es un literal: después de ''Bearer '' viene la subconsulta a Vault (nada de texto fijo)',
         (select count(*) from jobs
           where jobname in ('seguimiento-envios', 'alertas')
             and comando ~ '''Bearer '' \|\| \(select decrypted_secret'
             and comando !~ '''Bearer [^'']') = 2,
         null
  union all
  select 6, 'limpiar-tokens-sii borra solo tokens_sii vencidos hace más de un día',
         coalesce((select comando ~* '^\s*delete from public\.tokens_sii where vence_en < now\(\) - interval ''1 day''\s*$'
                     from jobs where jobname = 'limpiar-tokens-sii'), false),
         (select comando from jobs where jobname = 'limpiar-tokens-sii')
  union all
  select 7, 'limpiar-historial-cron borra solo corridas de cron.job_run_details de más de 7 días',
         coalesce((select comando ~* '^\s*delete from cron\.job_run_details where end_time < now\(\) - interval ''7 days''\s*$'
                     from jobs where jobname = 'limpiar-historial-cron'), false),
         (select comando from jobs where jobname = 'limpiar-historial-cron')
  union all
  select 8, 'los 4 activos, en la base postgres y como usuario postgres',
         (select count(*) from jobs where active and database = 'postgres' and username = 'postgres') = 4,
         (select string_agg(jobname || ' active=' || active || ' ' || database || '/' || username, ', '
                            order by jobname) from jobs)
  union all
  select 9, 'ningún job de pg_cron contiene el valor de cron_token (el detalle nunca lo muestra)',
         not exists (select 1 from cron.job j, vault.decrypted_secrets s
                      where s.name = 'cron_token' and length(s.decrypted_secret) > 0
                        and strpos(j.command, s.decrypted_secret) > 0),
         null
  union all
  select 10, 'ningún otro job llama a /api/cron (sin duplicados con otro nombre)',
         not exists (select 1 from cron.job
                      where command like '%/api/cron/%'
                        and jobname not in ('seguimiento-envios', 'alertas')),
         (select string_agg(coalesce(jobname, '(sin nombre)'), ', ') from cron.job
           where command like '%/api/cron/%' and jobname not in ('seguimiento-envios', 'alertas'))
  union all
  select 11, 'ninguna corrida fallida de estos jobs en la última hora',
         not exists (select 1 from cron.job_run_details d join jobs j on j.jobid = d.jobid
                      where d.status = 'failed' and d.start_time > now() - interval '1 hour'),
         (select string_agg(j.jobname || ': ' || left(coalesce(d.return_message, ''), 120), ' | ')
            from cron.job_run_details d join jobs j on j.jobid = d.jobid
           where d.status = 'failed' and d.start_time > now() - interval '1 hour')
  union all
  select 12, 'migración registrada como 0014',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0014'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
