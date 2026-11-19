-- Simulación de roles de la Fase 11: API pública y webhooks (migración 0018).
--
-- Criterio: `autenticar_api_key` (solo service_role) acepta una API key válida por su
-- sha256 y rechaza las inválidas, revocadas, vencidas y de organizaciones cuyo plan no
-- incluye API, sin revelar la organización; `ultimo_uso_en` se escribe como mucho una vez
-- por minuto. La idempotencia (`reclamar_idempotencia`, `terminar_idempotencia`,
-- `soltar_idempotencia`, solo service_role) distingue nueva, en curso, conflicto (otra
-- huella u otro recurso), terminada (con la respuesta guardada) y retomada (arriendo
-- vencido o clave soltada), por organización. `encolar_evento` solo encola con un plan que
-- incluya webhooks, y `documento.*` lleva estado, origen y clave de idempotencia. El
-- cron reclama entregas por turnos entre organizaciones sin repetirlas, descarta lo que
-- ya no corresponde, y `cerrar_entrega_webhook` aplica el backoff 1m-5m-30m-2h-6h-12h-24h
-- (±10 %) y descarta en el intento 8 o con una falla definitiva, solo si la fila sigue en el
-- intento reclamado (`p_intento`: un reenvío en vuelo no se pisa). Reenviar, probar y rotar
-- el secreto: solo administradores de la organización (P0002 / 42501 / P0001 / 22023). El
-- check de la URL rechaza destinos no permitidos. RLS: solo administradores leen claves,
-- webhooks y entregas; nadie lee `api_idempotencia` con su sesión. Revocar una API key es
-- definitivo y su expiración no se alarga (trigger de la 0018), ni siquiera con service_role.
-- 39 comprobaciones.
--
-- REQUIERE LAS MIGRACIONES 0015, 0016 Y 0018 APLICADAS. Sin la 0018 el script corre igual
-- (cada paso captura su error), pero casi todo sale false (42883 / 42P01 / 42703): solo
-- salen true la 1, la 35 y la 37, que prueban lo que ya hacía la 0001.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase10-pagos.sql): crea usuarios ficticios (api-…@ejemplo.invalid), tres
-- organizaciones (A y B con el plan API, C en Certificación), una empresa con un CAF de
-- certificación de MENTIRA (registrar_caf, con su secreto de prueba en Vault), una boleta,
-- API keys, webhooks (con sus secretos de prueba en Vault), entregas y claves de
-- idempotencia, y al final deshace todo. No llama al SII, a pg_net ni a ninguna URL: las
-- entregas solo se reclaman y se cierran en la base.
--
-- Cómo correrlo (con las migraciones aplicadas):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true se
--      comportó como se espera; false, ver detalle).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'api-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-api-fase11%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa api fase 11%') as empresas,
--          (select count(*) from public.api_keys where nombre like 'Prueba fase 11%') as api_keys,
--          (select count(*) from public.webhooks where url like 'https://receptor-fase11%') as webhooks,
--          (select count(*) from public.api_idempotencia where clave like 'fase11-%') as idempotencia,
--          (select count(*) from vault.secrets where description like 'webhook https://receptor-fase11%') as secretos_webhook,
--          (select count(*) from vault.secrets where description like 'caf:76543210-3:certificacion:39:1-%') as secretos_caf;
--      (`secretos_caf` puede no ser 0 si una empresa real tiene el RUT 76543210-3 con un CAF
--      de certificación de boletas desde el folio 1: basta con que sea el mismo número que
--      antes de correr el script.)
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 10): `request.jwt.claims` local a la
-- transacción + `set local role authenticated | anon | service_role`; `reset role` vuelve
-- a postgres (con los claims vacíos). Los ids que pasan de un paso a otro van en
-- parámetros locales `prueba.*`.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...11a1 propietario de A   ...11a2 administrador de A   ...11a3 emisor de A
--   ...11b1 propietario de B   ...11c1 propietario de C

begin;

-- ---------------------------------------------------------------------------
-- 0. Preparación (como postgres)
-- ---------------------------------------------------------------------------

create temp table resultados (
  n            integer primary key,
  verificacion text not null,
  ok           boolean,
  detalle      text
) on commit drop;
grant select, insert on resultados to authenticated, anon, service_role;

create function pg_temp.registrar(p_n integer, p_verificacion text, p_ok boolean, p_detalle text default null)
returns void
language sql
as $$
  insert into resultados (n, verificacion, ok, detalle) values (p_n, p_verificacion, p_ok, p_detalle);
$$;
grant execute on function pg_temp.registrar(integer, text, boolean, text) to authenticated, anon, service_role;

-- Ejecuta SQL con el rol de la sesión: 'ok' o '<sqlstate>'.
create function pg_temp.ejecutar(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.ejecutar(text) to authenticated, anon, service_role;

-- Valor escalar de una consulta con el rol de la sesión, como texto, o '<sqlstate>'.
create function pg_temp.valor(p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.valor(text) to authenticated, anon, service_role;

-- Valor escalar sin RLS (como el dueño de la función, postgres).
create function pg_temp.dato(p_sql text)
returns text
language plpgsql
security definer
as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.dato(text) to authenticated, anon, service_role;

-- Resultado de autenticar_api_key para una clave en claro, con el rol de la sesión:
-- 'org|empresa|alcances|ambiente|motivo' (con 'null' en lo nulo), o '<sqlstate>'.
create function pg_temp.autenticar(p_clave text)
returns text
language plpgsql
as $$
begin
  return pg_temp.valor(format(
    $q$select coalesce(organizacion_id::text, 'null') || '|' || coalesce(empresa_id::text, 'null') || '|'
              || coalesce(array_to_string(alcances, ','), 'null') || '|' || coalesce(ambiente::text, 'null') || '|'
              || coalesce(motivo, 'null') || '|' || coalesce(api_key_id::text, 'null')
       from public.autenticar_api_key(%L)$q$,
    encode(sha256(convert_to(p_clave, 'UTF8')), 'hex')));
end;
$$;
grant execute on function pg_temp.autenticar(text) to authenticated, anon, service_role;

-- reclamar_idempotencia con el rol de la sesión: 'resultado|status|respuesta|recurso_id'.
create function pg_temp.reclamar(p_org uuid, p_clave text, p_recurso text, p_huella text)
returns text
language plpgsql
as $$
begin
  return pg_temp.valor(format(
    $q$select resultado || '|' || coalesce(status_http::text, 'null') || '|' || coalesce(respuesta::text, 'null')
              || '|' || coalesce(recurso_id::text, 'null')
       from public.reclamar_idempotencia(%L, %L, %L, %L, null, 120)$q$,
    p_org, p_clave, p_recurso, p_huella));
end;
$$;
grant execute on function pg_temp.reclamar(uuid, text, text, text) to authenticated, anon, service_role;

-- Huella de prueba (sha256 hex de un texto).
create function pg_temp.h(p_texto text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_texto, 'UTF8')), 'hex');
$$;
grant execute on function pg_temp.h(text) to authenticated, anon, service_role;

-- Estado de una entrega, sin RLS: 'estado|intentos|status|entregado?|reenviada_por'.
create function pg_temp.entrega(p_id bigint)
returns text
language plpgsql
security definer
as $$
begin
  return coalesce((select e.estado::text || '|' || e.intentos || '|' || coalesce(e.ultimo_status_http::text, 'null')
                          || '|' || (e.entregado_en is not null)::text || '|' || coalesce(e.reenviada_por::text, 'null')
                   from public.webhook_entregas e where e.id = p_id), 'no existe');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.entrega(bigint) to authenticated, anon, service_role;

-- Segundos desde ahora hasta el próximo intento de una entrega (sin RLS).
create function pg_temp.espera(p_id bigint)
returns numeric
language sql
security definer
as $$
  select extract(epoch from (siguiente_intento_en - now()))::numeric
  from public.webhook_entregas where id = p_id;
$$;
grant execute on function pg_temp.espera(bigint) to authenticated, anon, service_role;

-- Inserta una entrega pendiente vencida hace p_minutos (como postgres): su id.
create function pg_temp.nueva_entrega(p_webhook uuid, p_minutos integer, p_intentos integer default 0)
returns bigint
language sql
security definer
as $$
  insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload, intentos, siguiente_intento_en)
  select w.organizacion_id, w.id, 'documento.aceptado',
         jsonb_build_object('evento', 'documento.aceptado', 'creado_en', now(), 'datos', '{}'::jsonb),
         p_intentos, now() - make_interval(mins => p_minutos)
  from public.webhooks w where w.id = p_webhook
  returning id;
$$;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000011a1', 'api-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000011a2', 'api-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000011a3', 'api-emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-0000000011b1', 'api-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}'),
  ('00000000-0000-4000-8000-0000000011c1', 'api-propietario-c@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario C"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba API Fase 11 A', 'zz-prueba-api-fase11-a')::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba API Fase 11 B', 'zz-prueba-api-fase11-b')::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011c1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_c', public.crear_organizacion('Prueba API Fase 11 C', 'zz-prueba-api-fase11-c')::text, true);
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000011a2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000011a3', 'emisor');

-- A y B pasan al plan API (service_role, como lo hace la pasarela); C sigue en Certificación.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.ejecutar(format($q$select public.activar_suscripcion(%L, (select id from public.planes where codigo = 'api'), 'activa', 'flow', 'sub-prueba-fase11-a')$q$,
                               current_setting('prueba.org_a')));
select pg_temp.ejecutar(format($q$select public.activar_suscripcion(%L, (select id from public.planes where codigo = 'api'), 'activa', 'flow', 'sub-prueba-fase11-b')$q$,
                               current_setting('prueba.org_b')));
reset role;
select set_config('request.jwt.claims', '', true);

-- Empresa de A y CAF de certificación de mentira (para la boleta del evento).
select set_config('prueba.emp_a', '', true);
select set_config('prueba.caf', '', true);
do $$
declare
  v uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '76543210-3', 'Empresa api fase 11 A',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago')
  returning id into v;
  perform set_config('prueba.emp_a', v::text, true);
exception when others then
  raise notice 'empresa de prueba: % %', sqlstate, sqlerrm;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
begin
  perform set_config('prueba.caf', public.registrar_caf(
    current_setting('prueba.org_a')::uuid, current_setting('prueba.emp_a')::uuid,
    'certificacion', 39::smallint, 1, 100, date '2026-11-18', 100::smallint, '76543210-3',
    'EMPRESA API FASE 11',
    '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>', null)::text, true);
exception when others then
  raise notice 'CAF de prueba: % %', sqlstate, sqlerrm;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 1. API keys: crear y autenticar
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.clave_a',
  coalesce(pg_temp.valor(format($q$select public.crear_api_key(%L, 'Prueba fase 11 principal', '{documentos:leer,documentos:emitir}', 'certificacion', null, null)$q$,
                                current_setting('prueba.org_a'))), ''), true);
select set_config('prueba.clave_rev',
  coalesce(pg_temp.valor(format($q$select public.crear_api_key(%L, 'Prueba fase 11 revocada', '{documentos:leer}', 'certificacion', null, null)$q$,
                                current_setting('prueba.org_a'))), ''), true);
select set_config('prueba.clave_venc',
  coalesce(pg_temp.valor(format($q$select public.crear_api_key(%L, 'Prueba fase 11 vencida', '{documentos:leer}', 'produccion', null, now() - interval '1 hour')$q$,
                                current_setting('prueba.org_a'))), ''), true);
-- Revocar con la sesión (columna permitida para authenticated).
select pg_temp.ejecutar(format($q$update public.api_keys set revocada_en = now() where nombre = 'Prueba fase 11 revocada' and organizacion_id = %L$q$,
                               current_setting('prueba.org_a')));
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011c1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.crear_c',
  pg_temp.valor(format($q$select public.crear_api_key(%L, 'Prueba fase 11 C', '{documentos:leer}', 'certificacion', null, null)$q$,
                       current_setting('prueba.org_c'))), true);
reset role;
select set_config('request.jwt.claims', '', true);

-- Una clave de C insertada por el backend (C no tiene plan con API).
select set_config('prueba.clave_c', 'sk_test_' || repeat('c', 64), true);
insert into public.api_keys (organizacion_id, nombre, prefijo, clave_hash, alcances, ambiente)
values (current_setting('prueba.org_c')::uuid, 'Prueba fase 11 C directa', left(current_setting('prueba.clave_c'), 12),
        pg_temp.h(current_setting('prueba.clave_c')), '{documentos:leer}', 'certificacion');

select pg_temp.registrar(1, 'crear_api_key (administrador de A, plan API) devuelve una sk_test_ de 64 hex; se guarda solo su sha256 y el prefijo de 12; en C (Certificación) la rechaza por el plan',
  current_setting('prueba.clave_a') ~ '^sk_test_[0-9a-f]{64}$'
  and pg_temp.dato(format($q$select (prefijo = left(%L, 12) and clave_hash = %L)::text from public.api_keys where nombre = 'Prueba fase 11 principal'$q$,
                          current_setting('prueba.clave_a'), pg_temp.h(current_setting('prueba.clave_a')))) = 'true'
  and current_setting('prueba.crear_c') = 'P0001',
  'clave ' || left(current_setting('prueba.clave_a'), 12) || '… / C: ' || current_setting('prueba.crear_c'));

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r text := pg_temp.autenticar(current_setting('prueba.clave_a'));
begin
  perform pg_temp.registrar(2, 'autenticar_api_key con la clave válida: organización A, todas las empresas, sus alcances, certificacion, motivo nulo, y marca ultimo_uso_en',
    r like current_setting('prueba.org_a') || '|null|documentos:leer,documentos:emitir|certificacion|null|%'
    and pg_temp.dato($q$select (ultimo_uso_en is not null)::text from public.api_keys where nombre = 'Prueba fase 11 principal'$q$) = 'true',
    r);
end $$;

-- Throttle: con un uso hace 30 s no escribe; con uno hace 2 min sí.
reset role;
select set_config('request.jwt.claims', '', true);
update public.api_keys set ultimo_uso_en = now() - interval '30 seconds' where nombre = 'Prueba fase 11 principal';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.autenticar(current_setting('prueba.clave_a'));
select set_config('prueba.uso_30', pg_temp.dato($q$select (ultimo_uso_en = now() - interval '30 seconds')::text from public.api_keys where nombre = 'Prueba fase 11 principal'$q$), true);
reset role;
select set_config('request.jwt.claims', '', true);
update public.api_keys set ultimo_uso_en = now() - interval '2 minutes' where nombre = 'Prueba fase 11 principal';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.autenticar(current_setting('prueba.clave_a'));
select pg_temp.registrar(3, 'ultimo_uso_en se escribe como mucho una vez por minuto (uso de hace 30 s: no cambia; de hace 2 min: pasa a now())',
  current_setting('prueba.uso_30') = 'true'
  and pg_temp.dato($q$select (ultimo_uso_en = now())::text from public.api_keys where nombre = 'Prueba fase 11 principal'$q$) = 'true',
  'hace 30 s sin cambio: ' || current_setting('prueba.uso_30'));

select pg_temp.registrar(4, 'formato inválido o clave inexistente → motivo invalida, con todos los ids nulos',
  pg_temp.valor($q$select coalesce(api_key_id::text, 'null') || '|' || coalesce(organizacion_id::text, 'null') || '|' || motivo from public.autenticar_api_key('no-es-un-hash')$q$) = 'null|null|invalida'
  and pg_temp.valor($q$select motivo from public.autenticar_api_key(null)$q$) = 'invalida'
  and pg_temp.autenticar('sk_test_' || repeat('0', 64)) = 'null|null|null|null|invalida|null',
  pg_temp.autenticar('sk_test_' || repeat('0', 64)));

select pg_temp.registrar(5, 'clave revocada (por el administrador con su sesión) → revocada, sin revelar la organización',
  pg_temp.autenticar(current_setting('prueba.clave_rev')) = 'null|null|null|null|revocada|null',
  pg_temp.autenticar(current_setting('prueba.clave_rev')));

select pg_temp.registrar(6, 'clave vencida (expira_en pasado; sk_live_ de producción) → vencida, sin revelar la organización',
  current_setting('prueba.clave_venc') ~ '^sk_live_[0-9a-f]{64}$'
  and pg_temp.autenticar(current_setting('prueba.clave_venc')) = 'null|null|null|null|vencida|null',
  pg_temp.autenticar(current_setting('prueba.clave_venc')));

select pg_temp.registrar(7, 'clave de una organización cuyo plan no incluye API (C, Certificación) → plan_sin_api, sin revelar la organización',
  pg_temp.autenticar(current_setting('prueba.clave_c')) = 'null|null|null|null|plan_sin_api|null',
  pg_temp.autenticar(current_setting('prueba.clave_c')));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.auth_auth', pg_temp.autenticar(current_setting('prueba.clave_a')), true);
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.registrar(8, 'autenticar_api_key no la puede ejecutar authenticated ni anon (42501)',
  current_setting('prueba.auth_auth') = '42501'
  and pg_temp.autenticar(current_setting('prueba.clave_a')) = '42501',
  current_setting('prueba.auth_auth') || ' / ' || pg_temp.autenticar(current_setting('prueba.clave_a')));
reset role;

-- ---------------------------------------------------------------------------
-- 2. Idempotencia (service_role)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'documento', pg_temp.h('cuerpo 1'));
begin
  perform pg_temp.registrar(9, 'reclamar una clave nueva → nueva, y la fila queda en_curso sin respuesta',
    r = 'nueva|null|null|null'
    and pg_temp.valor(format($q$select estado || '|' || (respuesta is null)::text from public.api_idempotencia where organizacion_id = %L and clave = 'fase11-1'$q$,
                             current_setting('prueba.org_a'))) = 'en_curso|true',
    r);
end $$;

select pg_temp.registrar(10, 'reclamar otra vez la misma clave y el mismo cuerpo mientras está en curso → en_curso',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'documento', pg_temp.h('cuerpo 1')) = 'en_curso|null|null|null',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'documento', pg_temp.h('cuerpo 1')));

select pg_temp.registrar(11, 'la misma clave con otro cuerpo, o con otro recurso, → conflicto',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'documento', pg_temp.h('cuerpo 2')) = 'conflicto|null|null|null'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'lote', pg_temp.h('cuerpo 1')) = 'conflicto|null|null|null',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'lote', pg_temp.h('cuerpo 1')));

do $$
declare
  t1 text := pg_temp.valor(format($q$select public.terminar_idempotencia(%L, 'fase11-1', 201, '{"objeto":"documento","folio":7}'::jsonb, '00000000-0000-4000-8000-0000000011ff')::text$q$,
                                  current_setting('prueba.org_a')));
  r  text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-1', 'documento', pg_temp.h('cuerpo 1'));
  t2 text := pg_temp.valor(format($q$select public.terminar_idempotencia(%L, 'fase11-1', 500, '{}'::jsonb)::text$q$,
                                  current_setting('prueba.org_a')));
begin
  perform pg_temp.registrar(12, 'terminar guarda status, respuesta y recurso; repetir la petición → terminada con lo mismo; terminar otra vez no la pisa (false)',
    t1 = 'true'
    and r = 'terminada|201|{"folio": 7, "objeto": "documento"}|00000000-0000-4000-8000-0000000011ff'
    and t2 = 'false',
    t1 || ' / ' || r || ' / ' || t2);
end $$;

do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-2', 'documento', pg_temp.h('cuerpo 3'));
  r2 text;
  r3 text;
begin
  perform pg_temp.dato(format($q$update public.api_idempotencia set reclamada_en = now() - interval '10 minutes'
                                 where organizacion_id = %L and clave = 'fase11-2' returning 'ok'$q$, current_setting('prueba.org_a')));
  r2 := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-2', 'documento', pg_temp.h('cuerpo 3'));
  r3 := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-2', 'documento', pg_temp.h('cuerpo 3'));
  perform pg_temp.registrar(13, 'con el arriendo vencido (la función murió) la misma clave y cuerpo → retomada, y queda tomada de nuevo (en_curso)',
    r1 = 'nueva|null|null|null' and r2 = 'retomada|null|null|null' and r3 = 'en_curso|null|null|null',
    r1 || ' / ' || r2 || ' / ' || r3);
end $$;

do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-3', 'documento', pg_temp.h('cuerpo 4'));
  s  text := pg_temp.valor(format($q$select public.soltar_idempotencia(%L, 'fase11-3', '00000000-0000-4000-8000-0000000011ee')::text$q$,
                                  current_setting('prueba.org_a')));
  r2 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-3', 'documento', pg_temp.h('cuerpo 5'));
  r3 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-3', 'documento', pg_temp.h('cuerpo 4'));
begin
  perform pg_temp.registrar(14, 'soltar deja la clave retomable al instante con su recurso (borrador) y conserva la huella: otro cuerpo → conflicto, el mismo → retomada con recurso_id',
    r1 = 'nueva|null|null|null' and s = 'true'
    and r2 = 'conflicto|null|null|null'
    and r3 = 'retomada|null|null|00000000-0000-4000-8000-0000000011ee',
    r1 || ' / ' || s || ' / ' || r2 || ' / ' || r3);
end $$;

select pg_temp.registrar(15, 'las claves son por organización: la misma clave en B es nueva',
  pg_temp.reclamar(current_setting('prueba.org_b')::uuid, 'fase11-1', 'documento', pg_temp.h('otro cuerpo')) = 'nueva|null|null|null',
  null);

select pg_temp.registrar(16, 'formato: una clave con espacios o vacía → 23514 (check), datos nulos → 22004, huella que no es sha256 hex → 23514',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11 con espacio', 'documento', pg_temp.h('x')) = '23514'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, '', 'documento', pg_temp.h('x')) = '23514'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, null, 'documento', pg_temp.h('x')) = '22004'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-4', 'documento', 'no-es-hex') = '23514'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-4', 'otro', pg_temp.h('x')) = '23514',
  pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11 con espacio', 'documento', pg_temp.h('x')));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(17, 'el propietario de A no lee api_idempotencia ni ejecuta reclamar/terminar/soltar con su sesión (42501)',
  pg_temp.valor('select count(*) from public.api_idempotencia') = '42501'
  and pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'fase11-5', 'documento', pg_temp.h('x')) = '42501'
  and pg_temp.valor(format($q$select public.terminar_idempotencia(%L, 'fase11-2', 200, '{}'::jsonb)::text$q$, current_setting('prueba.org_a'))) = '42501'
  and pg_temp.valor(format($q$select public.soltar_idempotencia(%L, 'fase11-2')::text$q$, current_setting('prueba.org_a'))) = '42501',
  pg_temp.valor('select count(*) from public.api_idempotencia'));
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 3. Webhooks: alta, URL permitida y encolado
-- ---------------------------------------------------------------------------

select set_config('prueba.vault_antes', (select count(*)::text from vault.secrets), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.wh_a',
  coalesce(pg_temp.valor(format($q$select webhook_id::text || ' ' || secreto from public.crear_webhook(%L, 'https://receptor-fase11-a.ejemplo.com/hooks', '{documento.aceptado,envio.actualizado}')$q$,
                                current_setting('prueba.org_a'))), ''), true);
select set_config('prueba.wh_a2',
  coalesce(pg_temp.valor(format($q$select webhook_id::text from public.crear_webhook(%L, 'https://receptor-fase11-a2.ejemplo.com/hooks', '{documento.aceptado}')$q$,
                                current_setting('prueba.org_a'))), ''), true);
select set_config('prueba.crear_wh_malo',
  pg_temp.valor(format($q$select webhook_id::text from public.crear_webhook(%L, 'https://localhost/hooks', '{documento.aceptado}')$q$,
                       current_setting('prueba.org_a'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('prueba.secreto_a', split_part(current_setting('prueba.wh_a'), ' ', 2), true);
select set_config('prueba.wh_a', split_part(current_setting('prueba.wh_a'), ' ', 1), true);
select set_config('prueba.secret_id_a', coalesce((select secreto_secret_id::text from public.webhooks
                                                  where id = nullif(current_setting('prueba.wh_a'), '')::uuid), ''), true);

select pg_temp.registrar(18, 'crear_webhook (administrador de A) devuelve un secreto whsec_ que queda en Vault (2 webhooks, 2 secretos); una URL https://localhost se rechaza con 23514',
  current_setting('prueba.secreto_a') ~ '^whsec_[0-9a-f]{64}$'
  and (select decrypted_secret from vault.decrypted_secrets
        where id = nullif(current_setting('prueba.secret_id_a'), '')::uuid) = current_setting('prueba.secreto_a')
  and (select count(*) from vault.secrets) = current_setting('prueba.vault_antes')::int + 2
  and current_setting('prueba.crear_wh_malo') = '23514',
  'webhook ' || current_setting('prueba.wh_a') || ' / localhost: ' || current_setting('prueba.crear_wh_malo'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_malas text[] := array[
    'https://localhost/x', 'https://LOCALHOST:443/x', 'https://10.0.0.1/x', 'https://169.254.169.254/latest',
    'https://servicio.internal/x', 'https://impresora.local/x', 'https://a.localhost/x',
    'https://ejemplo.com:8443/x', 'https://usuario:clave@ejemplo.com/x', 'http://ejemplo.com/x',
    'https://ejemplo.com./x', 'https://[::1]/x', 'https://ejemplo.com /x',
    'https://receptor-fase11-a.ejemplo.com/' || repeat('a', 2048)];
  v_url text;
  v_mal text := '';
  v_bien text;
begin
  foreach v_url in array v_malas loop
    if pg_temp.ejecutar(format('update public.webhooks set url = %L where id = %L', v_url, current_setting('prueba.wh_a2'))) <> '23514' then
      v_mal := v_mal || v_url || ' ';
    end if;
  end loop;
  v_bien := pg_temp.ejecutar(format($q$update public.webhooks set url = 'https://receptor-fase11-a2.ejemplo.com:443/otra/ruta?origen=boleteame' where id = %L$q$,
                                    current_setting('prueba.wh_a2')));
  perform pg_temp.registrar(19, 'check webhooks_url_permitida: 23514 para localhost, IP literal (v4 y v6), .internal/.local/.localhost, otro puerto, usuario:clave, http, punto final, espacios y más de 2048; una https normal con :443, ruta y consulta entra',
    v_mal = '' and v_bien = 'ok',
    'aceptadas que debían rechazarse: ' || coalesce(nullif(v_mal, ''), 'ninguna') || ' / válida: ' || v_bien);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- Webhook de C (sin plan con webhooks) insertado por el backend, con su secreto de prueba.
select set_config('prueba.wh_c', '', true);
do $$
declare
  v uuid;
begin
  insert into public.webhooks (organizacion_id, url, eventos, secreto_secret_id)
  values (current_setting('prueba.org_c')::uuid, 'https://receptor-fase11-c.ejemplo.com/hooks', '{documento.aceptado}',
          vault.create_secret('whsec_' || repeat('c', 64), null, 'webhook https://receptor-fase11-c.ejemplo.com/hooks'))
  returning id into v;
  perform set_config('prueba.wh_c', v::text, true);
exception when others then
  raise notice 'webhook de C: % %', sqlstate, sqlerrm;
end $$;

delete from public.webhook_entregas
where organizacion_id in (current_setting('prueba.org_a')::uuid, current_setting('prueba.org_b')::uuid,
                          current_setting('prueba.org_c')::uuid);
select public.encolar_evento(current_setting('prueba.org_a')::uuid, 'documento.aceptado', '{"prueba":1}'::jsonb);
select public.encolar_evento(current_setting('prueba.org_a')::uuid, 'documento.rechazado', '{"prueba":2}'::jsonb);
select public.encolar_evento(current_setting('prueba.org_c')::uuid, 'documento.aceptado', '{"prueba":3}'::jsonb);

select pg_temp.registrar(20, 'encolar_evento: en A (plan API) una entrega por webhook activo suscrito (2 para documento.aceptado, 0 para documento.rechazado, que nadie pidió); en C (sin webhooks en el plan) ninguna',
  (select count(*) from public.webhook_entregas where organizacion_id = current_setting('prueba.org_a')::uuid
     and evento = 'documento.aceptado' and payload -> 'datos' ->> 'prueba' = '1') = 2
  and (select count(*) from public.webhook_entregas where organizacion_id = current_setting('prueba.org_a')::uuid
         and evento = 'documento.rechazado') = 0
  and (select count(*) from public.webhook_entregas where organizacion_id = current_setting('prueba.org_c')::uuid) = 0,
  (select string_agg(evento || ' ' || organizacion_id::text, ', ') from public.webhook_entregas
    where organizacion_id in (current_setting('prueba.org_a')::uuid, current_setting('prueba.org_c')::uuid)));

-- Una boleta emitida por la API que el SII acepta (como postgres).
do $$
begin
  insert into public.documentos (empresa_id, ambiente, tipo_dte, folio, caf_id, estado, mnt_neto, iva, mnt_total,
                                 origen, clave_idempotencia)
  values (current_setting('prueba.emp_a')::uuid, 'certificacion', 39, 1, nullif(current_setting('prueba.caf'), '')::uuid,
          'firmado', 1000, 190, 1190, 'api', 'fase11-doc-1');
  update public.documentos set estado = 'aceptado'
  where empresa_id = current_setting('prueba.emp_a')::uuid and clave_idempotencia = 'fase11-doc-1';
exception when others then
  raise notice 'boleta de prueba: % %', sqlstate, sqlerrm;
end $$;

select pg_temp.registrar(21, 'documento.aceptado de una boleta de la API lleva estado aceptado, origen api y su clave_idempotencia (además de documento_id, folio y mnt_total)',
  (select count(*) from public.webhook_entregas
    where organizacion_id = current_setting('prueba.org_a')::uuid and evento = 'documento.aceptado'
      and payload -> 'datos' ->> 'estado' = 'aceptado' and payload -> 'datos' ->> 'origen' = 'api'
      and payload -> 'datos' ->> 'clave_idempotencia' = 'fase11-doc-1'
      and payload -> 'datos' ->> 'folio' = '1' and payload -> 'datos' ->> 'mnt_total' = '1190'
      and payload -> 'datos' ? 'documento_id') = 2,
  (select string_agg((payload -> 'datos')::text, ' | ') from public.webhook_entregas
    where organizacion_id = current_setting('prueba.org_a')::uuid and payload -> 'datos' ? 'documento_id'));

-- ---------------------------------------------------------------------------
-- 4. Cron: reclamar y cerrar entregas
-- ---------------------------------------------------------------------------

-- Cola controlada: A con 3 entregas viejas (a1, a2, a3), B con una más nueva (b1).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.wh_b',
  coalesce(pg_temp.valor(format($q$select webhook_id::text from public.crear_webhook(%L, 'https://receptor-fase11-b.ejemplo.com/hooks', '{documento.aceptado}')$q$,
                                current_setting('prueba.org_b'))), ''), true);
reset role;
select set_config('request.jwt.claims', '', true);

delete from public.webhook_entregas
where organizacion_id in (current_setting('prueba.org_a')::uuid, current_setting('prueba.org_b')::uuid,
                          current_setting('prueba.org_c')::uuid);
select set_config('prueba.a1', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 30)::text, true);
select set_config('prueba.a2', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 20)::text, true);
select set_config('prueba.a3', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 10)::text, true);
select set_config('prueba.b1', pg_temp.nueva_entrega(current_setting('prueba.wh_b')::uuid, 1)::text, true);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_ids text;
  v_ok  boolean;
begin
  select string_agg(r.id::text, ',' order by r.id),
         bool_and(r.intentos = 1 and r.url like 'https://receptor-fase11-%' and r.secreto_secret_id is not null
                  and r.payload ? 'datos')
    into v_ids, v_ok
  from public.reclamar_entregas_webhook(2, 120) r;
  perform pg_temp.registrar(22, 'reclamar_entregas_webhook(2): toma por turnos la más vieja de A (a1) y la de B (b1), no a2; con intentos = 1, URL, id del secreto y payload; el arriendo corre el próximo intento 120 s',
    v_ids = least(current_setting('prueba.a1')::bigint, current_setting('prueba.b1')::bigint)::text || ','
            || greatest(current_setting('prueba.a1')::bigint, current_setting('prueba.b1')::bigint)::text
    and coalesce(v_ok, false)
    and pg_temp.espera(current_setting('prueba.a1')::bigint) = 120,
    coalesce(v_ids, 'ninguna') || ' / a1=' || current_setting('prueba.a1') || ' b1=' || current_setting('prueba.b1'));
exception when others then
  perform pg_temp.registrar(22, 'reclamar_entregas_webhook por turnos entre organizaciones', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_ids text;
begin
  select string_agg(r.id::text, ',' order by r.id) into v_ids from public.reclamar_entregas_webhook(10, 120) r;
  perform pg_temp.registrar(23, 'una segunda corrida no repite las tomadas (arriendo vigente): solo a2 y a3',
    v_ids = current_setting('prueba.a2') || ',' || current_setting('prueba.a3'),
    coalesce(v_ids, 'ninguna'));
exception when others then
  perform pg_temp.registrar(23, 'una segunda corrida no repite las tomadas', false, sqlstate || ' ' || sqlerrm);
end $$;

select pg_temp.registrar(24, 'cerrar_entrega_webhook entregada (200) → entregado con entregado_en; cerrarla otra vez → null (ya cerrada)',
  pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 1, true, 200, %L)::text', current_setting('prueba.a1'), 'ok')) = 'entregado'
  and pg_temp.entrega(current_setting('prueba.a1')::bigint) = 'entregado|1|200|true|null'
  and pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 1, false, 500, %L)::text', current_setting('prueba.a1'), 'x')) = 'null',
  pg_temp.entrega(current_setting('prueba.a1')::bigint));

do $$
declare
  r1 text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 1, false, 500, %L)::text', current_setting('prueba.b1'), 'Error interno'));
  e1 numeric := pg_temp.espera(current_setting('prueba.b1')::bigint);
  r2 text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 1, false)::text', current_setting('prueba.a3')));
  e2 numeric := pg_temp.espera(current_setting('prueba.a3')::bigint);
begin
  perform pg_temp.registrar(25, 'falla en el intento 1 → fallido con el próximo intento a 1 min ±10 % (54-66 s); un timeout (sin status ni respuesta, parámetros por defecto) también',
    r1 = 'fallido' and e1 between 54 and 66
    and pg_temp.entrega(current_setting('prueba.b1')::bigint) = 'fallido|1|500|false|null'
    and r2 = 'fallido' and e2 between 54 and 66
    and pg_temp.entrega(current_setting('prueba.a3')::bigint) = 'fallido|1|null|false|null',
    r1 || ' ' || round(e1) || ' s / ' || r2 || ' ' || round(e2) || ' s');
end $$;

-- Backoff con más intentos (los intentos los fija postgres; la entrega está en curso).
reset role;
select set_config('request.jwt.claims', '', true);
update public.webhook_entregas set intentos = 4 where id = current_setting('prueba.a2')::bigint;
select set_config('prueba.a7', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 5, 7)::text, true);
select set_config('prueba.a8', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 5, 8)::text, true);
select set_config('prueba.ad', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 5, 1)::text, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r4 text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 4, false, 503, null)::text', current_setting('prueba.a2')));
  e4 numeric := pg_temp.espera(current_setting('prueba.a2')::bigint);
  r7 text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 7, false, 503, null)::text', current_setting('prueba.a7')));
  e7 numeric := pg_temp.espera(current_setting('prueba.a7')::bigint);
begin
  perform pg_temp.registrar(26, 'backoff: tras el intento 4 → 2 h ±10 % (6480-7920 s); tras el intento 7 → 24 h ±10 % (77760-95040 s)',
    r4 = 'fallido' and e4 between 6480 and 7920 and r7 = 'fallido' and e7 between 77760 and 95040,
    r4 || ' ' || round(e4) || ' s / ' || r7 || ' ' || round(e7) || ' s');
end $$;

do $$
declare
  r8 text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 8, false, 500, %L)::text', current_setting('prueba.a8'), repeat('x', 5000)));
  rd text := pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 1, false, null, %L, true)::text', current_setting('prueba.ad'), 'URL bloqueada'));
begin
  perform pg_temp.registrar(27, 'el intento 8 fallido → descartado; una falla definitiva en el intento 1 → descartado; la respuesta se guarda truncada a 1000 caracteres',
    r8 = 'descartado' and rd = 'descartado'
    and pg_temp.dato(format('select length(ultima_respuesta)::text from public.webhook_entregas where id = %s', current_setting('prueba.a8'))) = '1000'
    and pg_temp.entrega(current_setting('prueba.ad')::bigint) = 'descartado|1|null|false|null',
    r8 || ' / ' || rd);
end $$;

-- Descartes al reclamar: webhook desactivado, 8 intentos agotados y plan sin webhooks.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.ejecutar(format('update public.webhooks set activo = false where id = %L', current_setting('prueba.wh_a2')));
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('prueba.x_inactivo', pg_temp.nueva_entrega(current_setting('prueba.wh_a2')::uuid, 3)::text, true);
select set_config('prueba.x_agotada', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 3, 8)::text, true);
select set_config('prueba.x_plan', pg_temp.nueva_entrega(current_setting('prueba.wh_c')::uuid, 3)::text, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_ids text;
begin
  select coalesce(string_agg(r.id::text, ','), '') into v_ids from public.reclamar_entregas_webhook(100, 120) r;
  perform pg_temp.registrar(28, 'al reclamar se descartan (sin devolverlas) la entrega de un webhook desactivado, la que agotó 8 intentos y la de una organización sin webhooks en el plan, cada una con su motivo',
    pg_temp.dato(format($q$select string_agg(estado::text || ':' || ultima_respuesta, ' | ' order by id)
                           from public.webhook_entregas where id in (%s, %s, %s)$q$,
                        current_setting('prueba.x_inactivo'), current_setting('prueba.x_agotada'), current_setting('prueba.x_plan')))
      = 'descartado:El webhook está desactivado. | descartado:Se agotaron los 8 intentos. | descartado:El plan vigente no incluye webhooks.'
    and position(current_setting('prueba.x_inactivo') in v_ids) = 0
    and position(current_setting('prueba.x_plan') in v_ids) = 0,
    'tomadas: ' || coalesce(nullif(v_ids, ''), 'ninguna'));
exception when others then
  perform pg_temp.registrar(28, 'al reclamar se descartan lo que ya no corresponde entregar', false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Acciones del panel: reenviar, probar y rotar
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.reenviar', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.a1'))), true);
select pg_temp.registrar(29, 'el administrador de A reenvía una entrega entregada: la MISMA fila vuelve a pendiente con intentos 0, sin entregado_en, vencida ya y con reenviada_por',
  current_setting('prueba.reenviar') = 'ok'
  and pg_temp.entrega(current_setting('prueba.a1')::bigint) = 'pendiente|0|200|false|00000000-0000-4000-8000-0000000011a2'
  and pg_temp.espera(current_setting('prueba.a1')::bigint) = 0,
  current_setting('prueba.reenviar') || ' / ' || pg_temp.entrega(current_setting('prueba.a1')::bigint));

select pg_temp.registrar(30, '22023: reenviar una entrega que ya está en cola (pendiente) o de un webhook desactivado',
  pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.a1'))) = '22023'
  and pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.x_inactivo'))) = '22023',
  pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.x_inactivo'))));
reset role;

-- Reenvío de una entrega en vuelo: `fallido` y reclamada (intentos 2 → 3, como hace
-- reclamar_entregas_webhook, sin tocar el resto de la cola); el administrador la reenvía
-- (vuelve a pendiente con intentos 0) y el cierre del intento viejo devuelve null sin pisarla.
select set_config('request.jwt.claims', '', true);
select set_config('prueba.vuelo', pg_temp.nueva_entrega(current_setting('prueba.wh_a')::uuid, 5, 2)::text, true);
update public.webhook_entregas
set estado = 'fallido', intentos = intentos + 1, siguiente_intento_en = now() + interval '120 seconds'
where id = current_setting('prueba.vuelo')::bigint;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.vuelo_reenvio', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.vuelo'))), true);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('prueba.vuelo_cierre',
  pg_temp.valor(format('select public.cerrar_entrega_webhook(%s, 3, true, 200, %L)::text', current_setting('prueba.vuelo'), 'ok')), true);
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(38, 'reenviar una entrega en vuelo (fallido, reclamada en el intento 3) la deja pendiente con intentos 0; el cierre del intento 3 devuelve null y no la pisa',
  current_setting('prueba.vuelo_reenvio') = 'ok'
  and current_setting('prueba.vuelo_cierre') = 'null'
  and pg_temp.entrega(current_setting('prueba.vuelo')::bigint) = 'pendiente|0|null|false|00000000-0000-4000-8000-0000000011a2',
  current_setting('prueba.vuelo_reenvio') || ' / cierre ' || current_setting('prueba.vuelo_cierre') || ' / '
  || pg_temp.entrega(current_setting('prueba.vuelo')::bigint));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a3","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.r_emisor', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.b1'))), true);
select set_config('prueba.r_emisor_a', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.a8'))), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.r_otra', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.a8'))), true);
select set_config('prueba.r_noexiste', pg_temp.ejecutar('select public.reenviar_entrega_webhook(-1)'), true);
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('prueba.r_anon', pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.a8'))), true);
reset role;
select pg_temp.registrar(31, 'reenviar: el emisor de A → 42501 en su organización y P0002 en otra; el propietario de B con una entrega de A → P0002; una que no existe → P0002; anon → 42501 (sin EXECUTE)',
  current_setting('prueba.r_emisor_a') = '42501' and current_setting('prueba.r_emisor') = 'P0002'
  and current_setting('prueba.r_otra') = 'P0002' and current_setting('prueba.r_noexiste') = 'P0002'
  and current_setting('prueba.r_anon') = '42501'
  and pg_temp.entrega(current_setting('prueba.a8')::bigint) like 'descartado|8|%',
  current_setting('prueba.r_emisor_a') || ' ' || current_setting('prueba.r_emisor') || ' ' || current_setting('prueba.r_otra')
    || ' ' || current_setting('prueba.r_noexiste') || ' ' || current_setting('prueba.r_anon'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011c1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(32, 'en C (plan sin webhooks) su propietario no puede reenviar ni probar: P0001',
  pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.x_plan'))) = 'P0001'
  and pg_temp.ejecutar(format('select public.probar_webhook(%L)', current_setting('prueba.wh_c'))) = 'P0001',
  pg_temp.ejecutar(format('select public.reenviar_entrega_webhook(%s)', current_setting('prueba.x_plan'))));
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.prueba_id', pg_temp.valor(format('select public.probar_webhook(%L)::text', current_setting('prueba.wh_a'))), true);
select set_config('prueba.prueba_inactivo', pg_temp.ejecutar(format('select public.probar_webhook(%L)', current_setting('prueba.wh_a2'))), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a3","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.prueba_emisor', pg_temp.ejecutar(format('select public.probar_webhook(%L)', current_setting('prueba.wh_a'))), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.prueba_otra', pg_temp.ejecutar(format('select public.probar_webhook(%L)', current_setting('prueba.wh_a'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(33, 'probar_webhook (administrador de A) encola webhook.prueba pendiente con el id del webhook en los datos; desactivado → 22023, emisor → 42501, otra organización → P0002',
  current_setting('prueba.prueba_id') ~ '^[0-9]+$'
  and pg_temp.dato(format($q$select (evento = 'webhook.prueba' and estado = 'pendiente' and intentos = 0
                                     and webhook_id = %L and payload ->> 'evento' = 'webhook.prueba'
                                     and payload -> 'datos' ->> 'webhook_id' = %L
                                     and payload -> 'datos' ? 'mensaje')::text
                              from public.webhook_entregas where id = %s$q$,
                          current_setting('prueba.wh_a'), current_setting('prueba.wh_a'),
                          case when current_setting('prueba.prueba_id') ~ '^[0-9]+$' then current_setting('prueba.prueba_id') else '-1' end)) = 'true'
  and current_setting('prueba.prueba_inactivo') = '22023'
  and current_setting('prueba.prueba_emisor') = '42501'
  and current_setting('prueba.prueba_otra') = 'P0002',
  current_setting('prueba.prueba_id') || ' ' || current_setting('prueba.prueba_inactivo') || ' '
    || current_setting('prueba.prueba_emisor') || ' ' || current_setting('prueba.prueba_otra'));

select set_config('prueba.vault_rotar', (select count(*)::text from vault.secrets), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a3","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.rotar_emisor', pg_temp.ejecutar(format('select public.rotar_secreto_webhook(%L)', current_setting('prueba.wh_a'))), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.secreto_nuevo', pg_temp.valor(format('select public.rotar_secreto_webhook(%L)', current_setting('prueba.wh_a'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(34, 'rotar_secreto_webhook: el administrador recibe un whsec_ nuevo y distinto; el webhook apunta a un secreto nuevo en Vault con ese valor y el anterior se borró (Vault igual en cantidad); el emisor → 42501',
  current_setting('prueba.secreto_nuevo') ~ '^whsec_[0-9a-f]{64}$'
  and current_setting('prueba.secreto_nuevo') <> current_setting('prueba.secreto_a')
  and (select s.decrypted_secret from public.webhooks w join vault.decrypted_secrets s on s.id = w.secreto_secret_id
        where w.id = current_setting('prueba.wh_a')::uuid) = current_setting('prueba.secreto_nuevo')
  and not exists (select 1 from vault.secrets where id = nullif(current_setting('prueba.secret_id_a'), '')::uuid)
  and (select count(*) from vault.secrets) = current_setting('prueba.vault_rotar')::int
  and current_setting('prueba.rotar_emisor') = '42501',
  'emisor: ' || current_setting('prueba.rotar_emisor'));

-- ---------------------------------------------------------------------------
-- 6. RLS y privilegios
-- ---------------------------------------------------------------------------

create function pg_temp.ve() returns text language plpgsql as $$
begin
  return pg_temp.valor(format('select count(*) from public.api_keys where organizacion_id = %L', current_setting('prueba.org_a')))
         || '/' || pg_temp.valor(format('select count(*) from public.webhooks where organizacion_id = %L', current_setting('prueba.org_a')))
         || '/' || pg_temp.valor(format('select count(*) from public.webhook_entregas where organizacion_id = %L', current_setting('prueba.org_a')));
end;
$$;
grant execute on function pg_temp.ve() to authenticated, anon, service_role;

select set_config('prueba.ve_postgres', pg_temp.ve(), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_admin', pg_temp.ve(), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a3","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_emisor', pg_temp.ve(), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_b', pg_temp.ve(), true);
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('prueba.ve_anon', pg_temp.ve(), true);
reset role;
select pg_temp.registrar(35, 'RLS: el administrador de A ve todas las claves, webhooks y entregas de A; el emisor de A y el propietario de B, 0/0/0; anon sin privilegios (42501)',
  current_setting('prueba.ve_admin') = current_setting('prueba.ve_postgres')
  and current_setting('prueba.ve_postgres') !~ '^0/'
  and current_setting('prueba.ve_emisor') = '0/0/0'
  and current_setting('prueba.ve_b') = '0/0/0'
  and current_setting('prueba.ve_anon') = '42501/42501/42501',
  'postgres ' || current_setting('prueba.ve_postgres') || ' · admin ' || current_setting('prueba.ve_admin')
    || ' · emisor ' || current_setting('prueba.ve_emisor') || ' · B ' || current_setting('prueba.ve_b')
    || ' · anon ' || current_setting('prueba.ve_anon'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(36, 'el propietario de A no ejecuta reclamar_entregas_webhook ni cerrar_entrega_webhook (42501) ni escribe en webhook_entregas directamente',
  pg_temp.ejecutar('select * from public.reclamar_entregas_webhook(10, 120)') = '42501'
  and pg_temp.ejecutar(format('select public.cerrar_entrega_webhook(%s, 4, true, 200, null)', current_setting('prueba.a2'))) = '42501'
  and pg_temp.valor(format($q$with u as (update public.webhook_entregas set estado = 'entregado' where id = %s returning 1)
                              select count(*) from u$q$, current_setting('prueba.a2'))) in ('0', '42501')
  and pg_temp.entrega(current_setting('prueba.a2')::bigint) like 'fallido|%',
  pg_temp.entrega(current_setting('prueba.a2')::bigint));
reset role;

select set_config('prueba.vault_borrar', (select count(*)::text from vault.secrets), true);
select set_config('prueba.secret_id_nuevo', (select secreto_secret_id::text from public.webhooks where id = current_setting('prueba.wh_a')::uuid), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.borrar', pg_temp.ejecutar(format('delete from public.webhooks where id = %L', current_setting('prueba.wh_a'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(37, 'el administrador borra el webhook: su secreto sale de Vault (tg_borrar_secretos) y sus entregas se borran en cascada',
  current_setting('prueba.borrar') = 'ok'
  and not exists (select 1 from public.webhooks where id = current_setting('prueba.wh_a')::uuid)
  and not exists (select 1 from vault.secrets where id = current_setting('prueba.secret_id_nuevo')::uuid)
  and (select count(*) from vault.secrets) = current_setting('prueba.vault_borrar')::int - 1
  and not exists (select 1 from public.webhook_entregas where webhook_id = current_setting('prueba.wh_a')::uuid),
  current_setting('prueba.borrar'));

-- ---------------------------------------------------------------------------
-- 6. Revocar es definitivo (trigger de la 0018)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.reactivar',
  pg_temp.ejecutar(format($q$update public.api_keys set revocada_en = null where nombre = 'Prueba fase 11 revocada' and organizacion_id = %L$q$,
                          current_setting('prueba.org_a'))), true);
select set_config('prueba.alargar_auth',
  pg_temp.ejecutar(format($q$update public.api_keys set expira_en = now() + interval '1 year' where nombre = 'Prueba fase 11 vencida' and organizacion_id = %L$q$,
                          current_setting('prueba.org_a'))), true);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('prueba.alargar_srv',
  pg_temp.ejecutar(format($q$update public.api_keys set expira_en = now() + interval '1 year' where nombre = 'Prueba fase 11 vencida' and organizacion_id = %L$q$,
                          current_setting('prueba.org_a'))), true);
select set_config('prueba.quitar_srv',
  pg_temp.ejecutar(format($q$update public.api_keys set expira_en = null where nombre = 'Prueba fase 11 vencida' and organizacion_id = %L$q$,
                          current_setting('prueba.org_a'))), true);
select set_config('prueba.acortar_srv',
  pg_temp.ejecutar(format($q$update public.api_keys set expira_en = now() + interval '1 day' where nombre = 'Prueba fase 11 principal' and organizacion_id = %L$q$,
                          current_setting('prueba.org_a'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(39, 'revocar es definitivo: el administrador no reactiva una clave revocada (22023) ni toca expira_en (42501, sin grant); service_role tampoco alarga ni quita la expiración (22023), pero sí puede acortarla; la revocada sigue rechazada',
  current_setting('prueba.reactivar') = '22023'
  and current_setting('prueba.alargar_auth') = '42501'
  and current_setting('prueba.alargar_srv') = '22023'
  and current_setting('prueba.quitar_srv') = '22023'
  and current_setting('prueba.acortar_srv') = 'ok'
  and pg_temp.autenticar(current_setting('prueba.clave_rev')) = 'null|null|null|null|revocada|null',
  'reactivar ' || current_setting('prueba.reactivar') || ' / alargar (auth) ' || current_setting('prueba.alargar_auth')
  || ' / alargar (srv) ' || current_setting('prueba.alargar_srv') || ' / quitar (srv) ' || current_setting('prueba.quitar_srv')
  || ' / acortar (srv) ' || current_setting('prueba.acortar_srv'));

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones, claves, webhooks, entregas ni secretos de prueba
