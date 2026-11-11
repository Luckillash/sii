-- =============================================================================
-- 0002 · pg_cron y pg_net (PLAN-SAAS §4.4)
--
-- Postgres dispara las rutas /api/cron/* de Vercel (seguimiento, webhooks,
-- alertas, limpieza) con un token guardado en Vault como `cron_token`. Los
-- `cron.schedule` se agregan en las fases que crean cada ruta (8 y 11); aquí solo
-- se habilitan las extensiones.
--
-- El valor de `cron_token` NO va en una migración. Se crea a mano en cada
-- ambiente con el mismo valor que CRON_SECRET en Vercel:
--   select vault.create_secret('<valor>', 'cron_token', 'Bearer para /api/cron/*');
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
