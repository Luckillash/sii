-- =============================================================================
-- 0014 · Cron de la Fase 8: seguimiento de envíos, alertas por correo y limpiezas
--        (PLAN-SAAS §4.4, §4.8 y Fase 8)
--
-- (El plan reservaba `0014` para los planes comerciales de la Fase 10; el número
-- definitivo es por orden de creación, PLAN-SAAS §6.)
--
-- SE APLICA DESPUÉS DEL DEPLOY de `/api/cron/seguimiento` y `/api/cron/alertas`: desde el
-- commit de esta migración pg_cron llama a esas rutas en producción. Antes del deploy
-- responderían 404 cada 5 minutos (sin daño, pero ruido en `net._http_response` y en los
-- *cron monitors* de Sentry). Por eso va separada de la 0013 (la tabla), que se puede
-- aplicar antes.
--
-- Cómo llama: `net.http_post` (pg_net, asíncrono: el job solo encola la petición y
-- termina) con `Authorization: Bearer <cron_token>`. El token se lee de
-- `vault.decrypted_secrets` CADA VEZ que corre el job (subconsulta dentro del comando):
-- nunca queda en esta migración, en `cron.job.command` ni en el historial de pg_cron, y
-- rotarlo es cambiar el secreto en Vault y `CRON_SECRET` en Vercel, sin migración. Las
-- rutas comparan el Bearer con `CRON_SECRET` en tiempo constante
-- (`server/cron/autorizacion.ts`); sin `CRON_SECRET` responden 503 y no hacen nada.
-- La migración se niega a correr si `cron_token` no existe en Vault (con `'Bearer ' ||
-- null` las cabeceras saldrían nulas y cada llamada fallaría en silencio).
--
-- Jobs (horarios en UTC, `cron.timezone = GMT`):
--   seguimiento-envios  */5 * * * *   POST https://boleteame.dev/api/cron/seguimiento
--       Lo fija HORARIO_SEGUIMIENTO (`apps/web/src/lib/seguimiento.ts`), igual al del
--       *cron monitor* de Sentry. `timeout_milliseconds` 300 000: el `maxDuration` más
--       largo que puede tener la ruta (Hobby, 300 s), para que `net._http_response`
--       guarde la respuesta real y no un tiempo agotado. pg_net 0.20 atiende las
--       peticiones en paralelo (curl multi), así que una lenta no frena a las demás.
--   alertas             */10 * * * *  POST https://boleteame.dev/api/cron/alertas
--       Lo fija HORARIO_ALERTAS (`apps/web/src/server/alertas/constantes.ts`). Cada 10 y no
--       cada 5: los rechazos aparecen cuando corre el seguimiento, y 10 minutos de demora
--       en un aviso por correo no cambian nada; la mitad de corridas es la mitad de
--       lecturas y de invocaciones. `timeout_milliseconds` 60 000 = `maxDuration` de la
--       ruta.
--   limpiar-tokens-sii  17 * * * *    borra de `tokens_sii` los tokens del SII vencidos
--       hace más de un día (los tokens duran ~50 min; el margen evita tocar uno que se
--       está renovando). Es la limpieza que sugería el comentario final de la 0001 y que
--       `trampas-conocidas.md` («Eliminar un certificado no borra sus tokens») daba como
--       pendiente. SQL directo, sin HTTP. Minuto 17 para no coincidir con los otros.
--   limpiar-historial-cron  23 3 * * *  borra de `cron.job_run_details` las corridas de
--       más de 7 días: con tres jobs cada 5-10 minutos son ~600 filas por día y pg_cron no
--       las borra solo. (`net._http_response` no necesita job: pg_net borra las respuestas
--       de más de `pg_net.ttl`, 6 horas en este proyecto.)
--
-- Idempotente: desagenda cada job si ya existe y lo vuelve a agendar (aplicarla dos veces
-- deja los mismos 4 jobs). Para pausar uno sin migración:
--   select cron.alter_job((select jobid from cron.job where jobname = 'alertas'), active := false);
-- Para quitarlos todos: `select cron.unschedule('<nombre>')` con cada nombre.
--
-- La URL es la de Production (`boleteame.dev`, PLAN-SAAS §4.5: sin Preview). Si cambia el
-- dominio, se cambia con una migración nueva.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_token') then
    raise exception 'Falta el secreto cron_token en Vault (mismo valor que CRON_SECRET en Vercel); créalo antes de aplicar la 0014'
      using errcode = '55000';
  end if;
end;
$$;

-- Desagendar lo que exista (cron.unschedule falla si el job no existe).
do $$
declare
  v_nombre text;
begin
  foreach v_nombre in array array[
    'seguimiento-envios', 'alertas', 'limpiar-tokens-sii', 'limpiar-historial-cron'
  ] loop
    if exists (select 1 from cron.job where jobname = v_nombre) then
      perform cron.unschedule(v_nombre);
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'seguimiento-envios',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://boleteame.dev/api/cron/seguimiento',
    body := '{"origen":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cron_token' limit 1)
    ),
    timeout_milliseconds := 300000
  );
  $cron$
);

select cron.schedule(
  'alertas',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://boleteame.dev/api/cron/alertas',
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
  'limpiar-tokens-sii',
  '17 * * * *',
  $cron$ delete from public.tokens_sii where vence_en < now() - interval '1 day' $cron$
);

select cron.schedule(
  'limpiar-historial-cron',
  '23 3 * * *',
  $cron$ delete from cron.job_run_details where end_time < now() - interval '7 days' $cron$
);

commit;
