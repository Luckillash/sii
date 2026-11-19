-- =============================================================================
-- 0019 · Cron de la Fase 11: entregar webhooks (PLAN-SAAS Fase 11)
--
-- SE APLICA DESPUÉS DEL DEPLOY de `/api/cron/webhooks` (mismo criterio que la 0014 y la
-- 0017): antes, pg_cron llamaría a una ruta que responde 404. Requiere la 0018
-- (`reclamar_entregas_webhook`, `cerrar_entrega_webhook`).
--
-- Jobs (UTC):
--   entregar-webhooks         * * * * *   POST https://boleteame.dev/api/cron/webhooks
--       Cada minuto: el primer reintento de una entrega fallida es a 1 minuto. Siempre
--       llama, aunque no haya nada pendiente, para que el *cron monitor* de Sentry
--       (`cron-webhooks`) vea todas las corridas. `timeout_milliseconds` 60 000 =
--       `maxDuration` de la ruta.
--   limpiar-webhook-entregas  37 4 * * *  borra las entregas `entregado` y `descartado`
--       de más de 30 días (las `pendiente` y `fallido` nunca: siguen en curso).
--   limpiar-api-idempotencia  47 4 * * *  borra de `api_idempotencia` las claves
--       `terminada` de más de 30 días y las `en_curso` abandonadas (reclamadas hace más de
--       7 días): guardan la respuesta completa (RUT, razón social, líneas) y no deben crecer
--       sin límite. Después de borrarla, la misma Idempotency-Key vuelve a ser nueva; el
--       documento sigue consultable con `GET /documentos?clave_idempotencia=` y la unicidad
--       `documentos (organizacion_id, clave_idempotencia)` impide emitir otro con ella.
--
-- El Bearer se lee de Vault (`cron_token`) en cada corrida, como en la 0014. Idempotente:
-- desagenda los jobs si existen y los vuelve a agendar. Se niega a correr (`55000`) sin
-- `cron_token`. Después de aplicarla, la comprobación 10 de `0014_cron.sql` («ningún otro
-- job llama a /api/cron») da `false`, como ya pasaba con la 0017: es lo esperado.
--
-- Verificación: supabase/verificaciones/0019_cron_webhooks.sql (solo lectura).
-- =============================================================================

begin;

do $$
declare
  v_nombre text;
begin
  if not exists (select 1 from vault.secrets where name = 'cron_token') then
    raise exception 'Falta el secreto cron_token en Vault (mismo valor que CRON_SECRET en Vercel)'
      using errcode = '55000';
  end if;
  foreach v_nombre in array array['entregar-webhooks', 'limpiar-webhook-entregas',
                                  'limpiar-api-idempotencia'] loop
    if exists (select 1 from cron.job where jobname = v_nombre) then
      perform cron.unschedule(v_nombre);
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'entregar-webhooks',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://boleteame.dev/api/cron/webhooks',
    body := '{"origen":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cron_token' limit 1)
    ),
    timeout_milliseconds := 60000
  );
  $cron$
);

select cron.schedule(
  'limpiar-webhook-entregas',
  '37 4 * * *',
  $cron$ delete from public.webhook_entregas where estado in ('entregado', 'descartado') and creado_en < now() - interval '30 days' $cron$
);

select cron.schedule(
  'limpiar-api-idempotencia',
  '47 4 * * *',
  $cron$ delete from public.api_idempotencia where (estado = 'terminada' and terminada_en < now() - interval '30 days') or (estado = 'en_curso' and reclamada_en < now() - interval '7 days') $cron$
);

commit;
