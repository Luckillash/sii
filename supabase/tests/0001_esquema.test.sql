-- Verificación de la Fase 0: la migración inicial quedó completa y con los
-- candados de seguridad que el resto del plan da por hechos.
-- Ejecutar con `supabase test db` (pgTAP).

begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- 1. Las 33 tablas del esquema -------------------------------------------------
select has_table('public', t::name, format('existe public.%s', t))
from unnest(array[
  'tipos_dte', 'estados_sii', 'planes', 'perfiles', 'organizaciones',
  'miembros_organizacion', 'invitaciones', 'suscripciones', 'uso_mensual', 'empresas',
  'resoluciones', 'certificados', 'empresa_certificados', 'tokens_sii', 'sesiones_sii',
  'cafs', 'solicitudes_folios', 'folios_anulados', 'receptores', 'productos', 'envios',
  'envio_estadisticas', 'consultas_envio', 'documentos', 'documento_detalles',
  'envio_rechazos', 'rcof', 'procesos_certificacion', 'set_pruebas_casos',
  'operaciones_sii', 'api_keys', 'webhooks', 'webhook_entregas'
]) as t;

-- 2. RLS en todas las tablas ---------------------------------------------------
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'todas las tablas de public tienen RLS activo'
);

-- 3. Tokens y sesiones del SII: solo service_role ------------------------------
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public' and tablename in ('tokens_sii', 'sesiones_sii') $$,
  'tokens_sii y sesiones_sii no tienen políticas'
);
select ok(
  not has_table_privilege('authenticated', 'public.tokens_sii', 'select'),
  'authenticated no puede leer tokens_sii'
);
select ok(
  not has_table_privilege('anon', 'public.sesiones_sii', 'select'),
  'anon no puede leer sesiones_sii'
);
select ok(
  has_table_privilege('service_role', 'public.tokens_sii', 'insert'),
  'service_role puede escribir tokens_sii'
);

-- 4. Funciones de secretos y tokens: fuera del alcance de la API ----------------
select ok(
  not has_function_privilege('authenticated',
    'public.token_guardar(public.canal_sii, public.ambiente_sii, text, text, bytea, timestamptz)',
    'execute'),
  'authenticated no ejecuta token_guardar'
);
select ok(
  not has_function_privilege('authenticated', 'public.leer_secreto(uuid)', 'execute'),
  'authenticated no ejecuta leer_secreto'
);
select ok(
  has_function_privilege('service_role',
    'public.token_guardar(public.canal_sii, public.ambiente_sii, text, text, bytea, timestamptz)',
    'execute'),
  'service_role ejecuta token_guardar'
);

-- 5. Extensiones: Vault, pg_cron y pg_net (0002) --------------------------------
select ok(exists (select 1 from pg_extension where extname = 'supabase_vault'), 'Vault instalado');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron instalado');
select ok(exists (select 1 from pg_extension where extname = 'pg_net'), 'pg_net instalado');

-- 6. Storage y Realtime ------------------------------------------------------------
select results_eq(
  $$ select public from storage.buckets where id = 'documentos-xml' $$,
  $$ values (false) $$,
  'el bucket documentos-xml existe y es privado'
);
select set_eq(
  $$ select tablename::text from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' $$,
  array['documentos', 'envios', 'procesos_certificacion'],
  'Realtime publica documentos, envios y procesos_certificacion'
);

-- 7. Catálogo de tipos de documento (MVP: boletas 39 y 41) --------------------------
select results_eq(
  $$ select codigo::int from public.tipos_dte order by codigo $$,
  $$ values (39), (41) $$,
  'tipos_dte trae las boletas 39 y 41'
);

-- 8. TokenStore por RPC ---------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$ select public.token_guardar('rest', 'certificacion', '76543210-3', repeat('a', 64),
                                 '\x00112233'::bytea, now() + interval '50 minutes') $$,
  'service_role guarda un token'
);
select is(
  (select count(*)::int
     from public.token_obtener('rest', 'certificacion', '76543210-3', repeat('a', 64))),
  1,
  'service_role lee el token guardado'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ select * from public.token_obtener('rest', 'certificacion', '76543210-3', repeat('a', 64)) $$,
  '42501',
  null,
  'authenticated no puede llamar a token_obtener'
);
reset role;

select * from finish();
rollback;
