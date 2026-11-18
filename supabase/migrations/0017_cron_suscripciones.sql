-- =============================================================================
-- 0017 · Cron de la Fase 10: sincronizar las suscripciones con Flow (PLAN-SAAS Fase 10)
--
-- SE APLICA DESPUÉS DEL DEPLOY de `/api/cron/suscripciones` (mismo criterio que la
-- 0014): antes, pg_cron llamaría a una ruta que responde 404.
--
-- Job (UTC):
--   sincronizar-suscripciones  41 * * * *  POST https://boleteame.dev/api/cron/suscripciones
--       Lo fija HORARIO_SUSCRIPCIONES (`apps/web/src/server/pagos/constantes.ts`), igual
--       al del *cron monitor* de Sentry. Cada hora: la mora en Flow se mide en días
--       (`days_until_due`), así que una hora de demora en marcar `morosa` o en volver a
--       `activa` no cambia nada. `timeout_milliseconds` 120 000 = `maxDuration` de la ruta.
--
-- El Bearer se lee de Vault (`cron_token`) en cada corrida, como en la 0014. Idempotente:
-- desagenda el job si existe y lo vuelve a agendar. Se niega a correr (`55000`) sin
-- `cron_token`.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_token') then
    raise exception 'Falta el secreto cron_token en Vault (mismo valor que CRON_SECRET en Vercel)'
      using errcode = '55000';
  end if;
  if exists (select 1 from cron.job where jobname = 'sincronizar-suscripciones') then
    perform cron.unschedule('sincronizar-suscripciones');
  end if;
end;
$$;

select cron.schedule(
  'sincronizar-suscripciones',
  '41 * * * *',
  $cron$
  select net.http_post(
    url := 'https://boleteame.dev/api/cron/suscripciones',
    body := '{"origen":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cron_token' limit 1)
    ),
    timeout_milliseconds := 120000
  );
  $cron$
);

commit;
