-- Simulación de roles de la Fase 10: planes comerciales, suscripciones y pagos
-- (migraciones 0015 y 0016).
--
-- Criterio: una organización nueva nace en Certificación (`prueba`) sin `periodo_fin`;
-- `activar_suscripcion` (solo service_role) deja vigente el plan pagado en Flow en una
-- transacción (cancela la anterior, una sola vigente, `plan_vigente` lo refleja), es
-- idempotente con el mismo id externo (el retorno de Flow y el cron pueden llegar dos
-- veces), cambia de plan sobre la misma suscripción externa, vuelve a Certificación sin
-- proveedor y rechaza datos incompletos o estados no permitidos; el límite de boletas del
-- plan nuevo se aplica al emitir en producción; propietarios y administradores leen los
-- pagos y el cliente de la pasarela de su organización, emisores, lectores y otras
-- organizaciones no; nadie escribe con su sesión, anon no ve nada y `eventos_pasarela` es
-- solo de service_role. Además: un id externo no se puede repetir (otra organización, o
-- una suscripción ya cancelada que reaparece), una `morosa` se reactiva con su mismo id,
-- los check de las tablas nuevas y las acciones de las FK al borrar la organización.
-- 30 comprobaciones. Que el `for no key update` sobre la organización no frene un insert
-- en una tabla hija no se prueba aquí: hace falta una segunda sesión concurrente (en una
-- sola transacción los bloqueos propios nunca chocan); la verificación 0016_pagos.sql (19)
-- revisa que el cuerpo use ese modo.
--
-- REQUIERE LAS MIGRACIONES 0015 Y 0016 APLICADAS. Sin ellas el script corre igual (cada
-- paso captura su error), pero casi todo sale false: sin la 0016 no existen
-- activar_suscripcion ni las tablas (42883 / 42P01) y solo salen true la 1-3; sin la 0015
-- tampoco, además, la 1 (crear_organizacion todavía fija periodo_fin a 30 días), y los
-- planes `contador` y `api` no existen.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase8-notificaciones.sql): crea usuarios ficticios (pagos-…@ejemplo.invalid), dos
-- organizaciones, suscripciones, una empresa marcada como autorizada en producción, un CAF
-- de producción de MENTIRA por `registrar_caf` (con su secreto de prueba en Vault), boletas
-- de producción, filas de uso_mensual, clientes de la pasarela, pagos y avisos de la
-- pasarela de prueba, y al final deshace todo. No llama a Flow, al SII ni a pg_net: los
-- documentos se insertan ya `firmado` (sin update de estado, así que no encolan webhooks).
--
-- Cómo correrlo (con las migraciones 0015 y 0016 ya aplicadas):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true se
--      comportó como se espera; false, ver detalle). Si el error es del script, se corrige
--      el script; si es del esquema, se reporta.
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'pagos-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-pagos-fase10%') as organizaciones,
--          (select count(*) from public.suscripciones where id_externo like 'sub-prueba-fase10%') as suscripciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa pagos fase 10%') as empresas,
--          (select count(*) from vault.secrets where description like 'caf:76543210-3:produccion:39:1-%') as secretos,
--          (select count(*) from public.clientes_pago where cliente_externo like 'cus-prueba-fase10%') as clientes_pago,
--          (select count(*) from public.pagos where factura_externa like 'inv-prueba-fase10%') as pagos,
--          (select count(*) from public.eventos_pasarela where token like 'tok-prueba-fase10%') as eventos;
--      (`secretos` puede no ser 0 si una empresa real tiene el RUT 76543210-3 con un CAF de
--      producción de boletas desde el folio 1: basta con que sea el mismo número que antes
--      de correr el script.)
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 8): `request.jwt.claims` local a la
-- transacción + `set local role authenticated | anon | service_role`; `reset role` vuelve
-- a postgres (con los claims vacíos, para que los triggers que miran auth.role() no crean
-- que es un usuario). Los ids que pasan de un paso a otro van en parámetros locales
-- `prueba.*`.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...10a1 propietario de A   ...10a2 administrador de A   ...10a3 emisor de A
--   ...10a4 lector de A        ...10b1 propietario de B
-- Ids externos de Flow de mentira: sub-prueba-fase10-* (suscripciones), cus-prueba-fase10-*
-- (clientes), inv-prueba-fase10-* (importes) y tok-prueba-fase10-* (avisos).
--
-- Límite de boletas: la cuota de producción se cuenta en `tg_contar_uso_documento` al
-- insertar un documento con folio en producción (necesita empresa autorizada, CAF de
-- producción y un plan con `permite_produccion`). Para no emitir 1.000 boletas, el uso del
-- mes se fija en 999 directamente en `uso_mensual` (como postgres) y se prueban la boleta
-- 1.000 (entra) y la 1.001 (rechazada con Pyme, aceptada tras pasar a Contador).

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

-- Id de un plan por su código (sin RLS: también los inactivos), o null.
create function pg_temp.plan(p_codigo text)
returns uuid
language sql
security definer
as $$
  select id from public.planes where codigo = p_codigo;
$$;
grant execute on function pg_temp.plan(text) to authenticated, anon, service_role;

-- Llama a activar_suscripcion con el rol de la sesión: 'id:<uuid>' o '<sqlstate> <mensaje>'.
create function pg_temp.activar(p_org uuid, p_plan uuid, p_estado text,
                                p_proveedor text default null, p_id_externo text default null,
                                p_periodo_inicio timestamptz default null, p_periodo_fin timestamptz default null)
returns text
language plpgsql
as $$
declare
  v uuid;
begin
  v := public.activar_suscripcion(p_org, p_plan, p_estado::public.estado_suscripcion, p_proveedor,
                                  p_id_externo, p_periodo_inicio, p_periodo_fin);
  return 'id:' || coalesce(v::text, 'null');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.activar(uuid, uuid, text, text, text, timestamptz, timestamptz)
  to authenticated, anon, service_role;

-- Suscripciones vigentes (prueba, activa o morosa) de una organización, sin RLS:
-- 'codigo|estado|proveedor|id externo|con o sin fin', separadas por ' + '.
create function pg_temp.vigente(p_org uuid)
returns text
language plpgsql
security definer
as $$
begin
  return coalesce((
    select string_agg(p.codigo || '|' || s.estado || '|' || coalesce(s.proveedor_pago, '-') || '|'
                      || coalesce(s.id_externo, '-') || '|'
                      || case when s.periodo_fin is null then 'sin fin' else 'con fin' end, ' + ')
    from public.suscripciones s join public.planes p on p.id = s.plan_id
    where s.organizacion_id = p_org and s.estado in ('prueba', 'activa', 'morosa')), 'ninguna');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.vigente(uuid) to authenticated, anon, service_role;

-- Una suscripción por id, sin RLS: 'codigo|estado|con o sin fin'.
create function pg_temp.sub(p_id text)
returns text
language plpgsql
security definer
as $$
begin
  return coalesce((
    select p.codigo || '|' || s.estado || '|' || case when s.periodo_fin is null then 'sin fin' else 'con fin' end
    from public.suscripciones s join public.planes p on p.id = s.plan_id
    where s.id = nullif(p_id, '')::uuid), 'no existe');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.sub(text) to authenticated, anon, service_role;

-- Cuántas suscripciones (de cualquier estado) tiene una organización, sin RLS.
create function pg_temp.total_subs(p_org uuid)
returns bigint
language sql
security definer
as $$
  select count(*) from public.suscripciones where organizacion_id = p_org;
$$;
grant execute on function pg_temp.total_subs(uuid) to authenticated, anon, service_role;

-- Plan vigente según plan_vigente(): 'codigo|max_boletas_mes|permite_produccion' (sin RLS).
create function pg_temp.plan_vigente(p_org uuid)
returns text
language plpgsql
security definer
as $$
declare
  r public.planes;
begin
  r := public.plan_vigente(p_org);
  return coalesce(r.codigo, 'ninguno') || '|' || coalesce(r.max_boletas_mes::text, 'sin límite') || '|'
         || coalesce(r.permite_produccion::text, '-');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.plan_vigente(uuid) to authenticated, anon, service_role;

-- Boletas de producción del mes (hora de Chile, como tg_contar_uso_documento), sin RLS.
create function pg_temp.uso(p_org uuid)
returns integer
language sql
security definer
as $$
  select coalesce((select boletas_produccion from public.uso_mensual
                    where organizacion_id = p_org
                      and periodo = date_trunc('month', now() at time zone 'America/Santiago')::date), 0);
$$;
grant execute on function pg_temp.uso(uuid) to authenticated, anon, service_role;

-- Inserta una boleta de producción firmada con ese folio del CAF de prueba, con el rol de
-- la sesión: 'ok' o '<sqlstate> <mensaje>'.
create function pg_temp.boleta(p_folio integer)
returns text
language plpgsql
as $$
begin
  insert into public.documentos (empresa_id, ambiente, tipo_dte, folio, caf_id, estado, mnt_neto, iva, mnt_total)
  values (current_setting('prueba.emp_a')::uuid, 'produccion', 39, p_folio,
          nullif(current_setting('prueba.caf'), '')::uuid, 'firmado', 840, 160, 1000);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.boleta(integer) to authenticated, anon, service_role;

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

-- Lo que ve el rol de la sesión en pagos y clientes_pago de una organización: 'pagos/clientes'.
create function pg_temp.ve(p_org text)
returns text
language plpgsql
as $$
begin
  return pg_temp.valor(format('select count(*) from public.pagos where organizacion_id = %L', p_org))
         || '/' || pg_temp.valor(format('select count(*) from public.clientes_pago where organizacion_id = %L', p_org));
end;
$$;
grant execute on function pg_temp.ve(text) to authenticated, anon, service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000010a1', 'pagos-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000010a2', 'pagos-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000010a3', 'pagos-emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-0000000010a4', 'pagos-lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000010b1', 'pagos-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba pagos Fase 10 A', 'zz-prueba-pagos-fase10-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba pagos Fase 10 B', 'zz-prueba-pagos-fase10-b')::text, true);

reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp.registrar(1, 'crear_organizacion deja a A y a B en certificacion/prueba sin periodo_fin (0015), y plan_vigente es certificacion con 0 boletas y sin producción',
  pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin'
  and pg_temp.vigente(current_setting('prueba.org_b')::uuid) = 'certificacion|prueba|-|-|sin fin'
  and pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|0|false',
  pg_temp.vigente(current_setting('prueba.org_a')::uuid) || ' / ' || pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid));

-- El backend da de alta al equipo de A (como postgres, sin claims: sin revisar el cupo).
insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000010a2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000010a3', 'emisor'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000010a4', 'lector');

-- Empresa de A ya autorizada en producción (como postgres: tg_proteger_autorizacion lo
-- permite) y un CAF de producción de mentira (registrar_caf, como service_role).
select set_config('prueba.emp_a', '', true);
select set_config('prueba.caf', '', true);
do $$
declare
  v uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna,
                               autorizada_produccion, autorizada_en)
  values (current_setting('prueba.org_a')::uuid, '76543210-3', 'Empresa pagos fase 10 A',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago', true, now())
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
    'produccion', 39::smallint, 1, 2000, date '2026-11-17', 300::smallint, '76543210-3',
    'EMPRESA PAGOS FASE 10',
    '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>', null)::text, true);
exception when others then
  raise notice 'CAF de prueba: % %', sqlstate, sqlerrm;
end $$;

select pg_temp.registrar(2, 'preparación: A con propietario, administrador, emisor y lector; empresa autorizada en producción y CAF de producción 1-2000',
  (select string_agg(m.rol::text, ',' order by m.rol) from public.miembros_organizacion m
    where m.organizacion_id = current_setting('prueba.org_a')::uuid) = 'propietario,administrador,emisor,lector'
  and current_setting('prueba.caf') <> '',
  'caf=' || coalesce(nullif(current_setting('prueba.caf'), ''), 'NO SE CREÓ'));

do $$
declare
  r text := pg_temp.boleta(1);
begin
  perform pg_temp.registrar(3, 'en Certificación una boleta de producción se rechaza (el plan no permite producción) y no cuenta uso',
    r like '%El plan vigente no permite emitir en producción%'
    and pg_temp.uso(current_setting('prueba.org_a')::uuid) = 0,
    r);
end $$;

-- ---------------------------------------------------------------------------
-- 1. activar_suscripcion (service_role): Certificación → Pyme pagado en Flow
-- ---------------------------------------------------------------------------

select set_config('prueba.sub_cert', (select id::text from public.suscripciones
                                       where organizacion_id = current_setting('prueba.org_a')::uuid), true);

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'activa',
                            'flow', 'sub-prueba-fase10-1', now(), now() + interval '1 month');
begin
  perform set_config('prueba.sub_pyme', coalesce(substring(r from '^id:(.*)$'), ''), true);
  perform pg_temp.registrar(4, 'Certificación → Pyme (flow, id externo): id nuevo; la de Certificación queda cancelada con periodo_fin; una sola vigente; plan_vigente es pyme con 1000 boletas',
    r like 'id:%' and current_setting('prueba.sub_pyme') <> current_setting('prueba.sub_cert')
    and pg_temp.sub(current_setting('prueba.sub_cert')) = 'certificacion|cancelada|con fin'
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'pyme|activa|flow|sub-prueba-fase10-1|con fin'
    and pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid) = 'pyme|1000|true'
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 2,
    r || ' / ' || pg_temp.vigente(current_setting('prueba.org_a')::uuid) || ' / '
      || pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid));
end $$;

select pg_temp.registrar(5, 'la suscripción de Flow guarda sincronizada_en y cancelar_al_fin_periodo = false',
  pg_temp.valor(format($q$select (sincronizada_en is not null and not cancelar_al_fin_periodo)::text
                          from public.suscripciones where id = %L$q$, current_setting('prueba.sub_pyme'))) = 'true',
  pg_temp.valor(format($q$select sincronizada_en::text || ' ' || cancelar_al_fin_periodo::text
                          from public.suscripciones where id = %L$q$, current_setting('prueba.sub_pyme'))));

-- La sincronización marca que el cliente pidió cancelar al fin del periodo; luego llega
-- otra vez el mismo aviso de Flow (o el cron) con la suscripción vigente.
select pg_temp.ejecutar(format($q$update public.suscripciones set cancelar_al_fin_periodo = true where id = %L$q$,
                               current_setting('prueba.sub_pyme')));

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'activa',
                            'flow', 'sub-prueba-fase10-1');
begin
  perform pg_temp.registrar(6, 'repetir con el mismo id externo es idempotente: mismo id, no inserta, conserva periodo_fin y limpia cancelar_al_fin_periodo',
    r = 'id:' || current_setting('prueba.sub_pyme')
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 2
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'pyme|activa|flow|sub-prueba-fase10-1|con fin'
    and pg_temp.valor(format('select cancelar_al_fin_periodo::text from public.suscripciones where id = %L',
                             current_setting('prueba.sub_pyme'))) = 'false',
    r || ' / ' || pg_temp.total_subs(current_setting('prueba.org_a')::uuid) || ' suscripciones');
end $$;

-- ---------------------------------------------------------------------------
-- 2. El límite de boletas del plan nuevo se aplica
-- ---------------------------------------------------------------------------

-- 999 boletas de producción ya usadas este mes (como postgres).
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.uso_mensual (organizacion_id, periodo, boletas_produccion)
values (current_setting('prueba.org_a')::uuid,
        date_trunc('month', now() at time zone 'America/Santiago')::date, 999)
on conflict (organizacion_id, periodo) do update set boletas_produccion = 999;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r1 text := pg_temp.boleta(1);
  r2 text := pg_temp.boleta(2);
begin
  perform pg_temp.registrar(7, 'con Pyme (1000 boletas/mes) y 999 usadas: la boleta 1000 entra y la 1001 se rechaza; el uso queda en 1000',
    r1 = 'ok' and r2 like '%Se alcanzó el límite de 1000 boletas del mes%'
    and pg_temp.uso(current_setting('prueba.org_a')::uuid) = 1000,
    r1 || ' / ' || r2 || ' / uso ' || pg_temp.uso(current_setting('prueba.org_a')::uuid));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cambio de plan sobre la misma suscripción externa (Pyme → Contador)
-- ---------------------------------------------------------------------------

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('contador'), 'activa',
                            'flow', 'sub-prueba-fase10-1');
begin
  perform pg_temp.registrar(8, 'cambiar el plan con el mismo id externo actualiza plan_id (contador) en la misma fila; plan_vigente es contador con 10000 boletas',
    r = 'id:' || current_setting('prueba.sub_pyme')
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 2
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'contador|activa|flow|sub-prueba-fase10-1|con fin'
    and pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid) = 'contador|10000|true',
    r || ' / ' || pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid));
end $$;

do $$
declare
  r text := pg_temp.boleta(2);
begin
  perform pg_temp.registrar(9, 'con Contador la misma boleta 1001 que Pyme rechazó ahora entra (uso 1001)',
    r = 'ok' and pg_temp.uso(current_setting('prueba.org_a')::uuid) = 1001,
    r || ' / uso ' || pg_temp.uso(current_setting('prueba.org_a')::uuid));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Ids externos que no se pueden repetir; morosa que se reactiva
-- ---------------------------------------------------------------------------

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_b')::uuid, pg_temp.plan('pyme'), 'activa',
                            'flow', 'sub-prueba-fase10-1');
begin
  perform pg_temp.registrar(10, 'B no puede activar con el id externo de A (23505 por suscripciones_externa_unica) y sigue en Certificación',
    r like '23505 %'
    and pg_temp.vigente(current_setting('prueba.org_b')::uuid) = 'certificacion|prueba|-|-|sin fin'
    and pg_temp.total_subs(current_setting('prueba.org_b')::uuid) = 1,
    r || ' / ' || pg_temp.vigente(current_setting('prueba.org_b')::uuid));
end $$;

do $$
declare
  r1 text := pg_temp.activar(current_setting('prueba.org_b')::uuid, pg_temp.plan('api'), 'activa',
                             'flow', 'sub-prueba-fase10-b');
  r2 text;
  v_morosa text;
  v_plan_morosa text;
begin
  -- La sincronización marca la mora (un update, no activar_suscripcion).
  perform pg_temp.ejecutar(format($q$update public.suscripciones set estado = 'morosa' where id = %L$q$,
                                  coalesce(substring(r1 from '^id:(.*)$'), '00000000-0000-4000-8000-000000000000')));
  v_morosa := pg_temp.vigente(current_setting('prueba.org_b')::uuid);
  v_plan_morosa := pg_temp.plan_vigente(current_setting('prueba.org_b')::uuid);
  r2 := pg_temp.activar(current_setting('prueba.org_b')::uuid, pg_temp.plan('api'), 'activa',
                        'flow', 'sub-prueba-fase10-b');
  perform pg_temp.registrar(11, 'B pasa a API; morosa no tiene plan vigente; al pagar, el mismo id externo la reactiva en la misma fila (activa, plan api)',
    r1 like 'id:%' and v_morosa = 'api|morosa|flow|sub-prueba-fase10-b|sin fin'
    and v_plan_morosa like 'ninguno|%'
    and r2 = r1
    and pg_temp.vigente(current_setting('prueba.org_b')::uuid) = 'api|activa|flow|sub-prueba-fase10-b|sin fin'
    and pg_temp.plan_vigente(current_setting('prueba.org_b')::uuid) = 'api|20000|true'
    and pg_temp.total_subs(current_setting('prueba.org_b')::uuid) = 2,
    r1 || ' / ' || v_morosa || ' / ' || v_plan_morosa || ' / ' || r2);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Vuelta a Certificación (cancelación) e idempotencia sin proveedor
-- ---------------------------------------------------------------------------

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('certificacion'), 'prueba');
begin
  perform set_config('prueba.sub_cert2', coalesce(substring(r from '^id:(.*)$'), ''), true);
  perform pg_temp.registrar(12, 'volver a Certificación sin proveedor: id nuevo; la de Flow queda cancelada con periodo_fin; la nueva sin proveedor ni periodo_fin; plan_vigente certificacion',
    r like 'id:%' and current_setting('prueba.sub_cert2') <> current_setting('prueba.sub_pyme')
    and pg_temp.sub(current_setting('prueba.sub_pyme')) = 'contador|cancelada|con fin'
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin'
    and pg_temp.plan_vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|0|false'
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 3,
    r || ' / ' || pg_temp.vigente(current_setting('prueba.org_a')::uuid));
end $$;

do $$
declare
  r text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('certificacion'), 'prueba');
begin
  perform pg_temp.registrar(13, 'repetir la vuelta a Certificación es idempotente: mismo id, no inserta',
    r = 'id:' || current_setting('prueba.sub_cert2')
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 3
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin',
    r);
end $$;

do $$
declare
  r1 text := pg_temp.boleta(3);
  r2 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('contador'), 'activa',
                             'flow', 'sub-prueba-fase10-1');
begin
  perform pg_temp.registrar(14, 'de vuelta en Certificación no se emite en producción; un aviso atrasado con el id externo ya cancelado no la revive (22023 «ya terminó») y A sigue en Certificación',
    r1 like '%El plan vigente no permite emitir en producción%'
    and r2 like '22023 %ya terminó%'
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin'
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 3,
    r1 || ' / ' || r2);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Validaciones de activar_suscripcion
-- ---------------------------------------------------------------------------

do $$
declare
  r1 text := pg_temp.activar(null, pg_temp.plan('pyme'), 'activa');
  r2 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, null, 'activa');
  r3 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), null);
begin
  perform pg_temp.registrar(15, 'sin organización, plan o estado: 22004',
    r1 like '22004 %' and r2 like '22004 %' and r3 like '22004 %',
    r1 || ' / ' || r2 || ' / ' || r3);
end $$;

do $$
declare
  r1 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'morosa', 'flow', 'sub-prueba-fase10-2');
  r2 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'cancelada', 'flow', 'sub-prueba-fase10-2');
  r3 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'activa', 'flow', null);
  r4 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('pyme'), 'activa', null, 'sub-prueba-fase10-2');
begin
  perform pg_temp.registrar(16, 'estado morosa o cancelada, proveedor sin id externo o id sin proveedor: 22023',
    r1 like '22023 %' and r2 like '22023 %' and r3 like '22023 %' and r4 like '22023 %',
    r1 || ' / ' || r2 || ' / ' || r3 || ' / ' || r4);
end $$;

do $$
declare
  r1 text := pg_temp.activar('00000000-0000-4000-8000-0000000010ff', pg_temp.plan('pyme'), 'activa', 'flow', 'sub-prueba-fase10-2');
  r2 text := pg_temp.activar(current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000010fe', 'activa', 'flow', 'sub-prueba-fase10-2');
begin
  perform pg_temp.registrar(17, 'organización o plan que no existen: P0002, y A no cambia (3 suscripciones, Certificación vigente)',
    r1 like 'P0002 %' and r2 like 'P0002 %'
    and pg_temp.total_subs(current_setting('prueba.org_a')::uuid) = 3
    and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin',
    r1 || ' / ' || r2);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Nadie con sesión ejecuta activar_suscripcion
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.r_prop', pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('empresa'), 'activa'), true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.r_admin', pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('empresa'), 'activa'), true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a4","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.r_lector', pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('empresa'), 'activa'), true);

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select set_config('prueba.r_anon', pg_temp.activar(current_setting('prueba.org_a')::uuid, pg_temp.plan('empresa'), 'activa'), true);

select pg_temp.registrar(18, 'propietario, administrador, lector y anon no pueden ejecutar activar_suscripcion (42501) y A sigue en Certificación',
  current_setting('prueba.r_prop') like '42501 %' and current_setting('prueba.r_admin') like '42501 %'
  and current_setting('prueba.r_lector') like '42501 %' and current_setting('prueba.r_anon') like '42501 %'
  and pg_temp.vigente(current_setting('prueba.org_a')::uuid) = 'certificacion|prueba|-|-|sin fin',
  current_setting('prueba.r_prop') || ' / ' || current_setting('prueba.r_admin') || ' / '
    || current_setting('prueba.r_lector') || ' / ' || current_setting('prueba.r_anon'));

-- ---------------------------------------------------------------------------
-- 8. Datos de la pasarela (service_role) y check de las tablas
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select pg_temp.registrar(19, 'service_role registra clientes (A con tarjeta y plan pendiente, B), 3 pagos (2 de A, 1 de B) y un aviso de la pasarela',
  pg_temp.ejecutar(format($q$
    insert into public.clientes_pago (organizacion_id, proveedor, cliente_externo, tarjeta_marca, tarjeta_ultimos4,
                                      tarjeta_registrada_en, plan_pendiente_id, plan_pendiente_por, plan_pendiente_en) values
      (%1$L, 'flow', 'cus-prueba-fase10-a', 'Visa', '6623', now(), %3$L, '00000000-0000-4000-8000-0000000010a2', now()),
      (%2$L, 'flow', 'cus-prueba-fase10-b', null, null, null, null, null, null)
  $q$, current_setting('prueba.org_a'), current_setting('prueba.org_b'), pg_temp.plan('pyme'))) = 'ok'
  and pg_temp.ejecutar(format($q$
    insert into public.pagos (organizacion_id, suscripcion_id, proveedor, factura_externa, orden_externa, monto_clp,
                              estado, periodo_inicio, periodo_fin, vence_en, pagado_en, medio, enlace_pago) values
      (%1$L, %3$L, 'flow', 'inv-prueba-fase10-a1', '1001', 14990, 'pagado', current_date, current_date + 30, current_date, now(), 'Webpay', null),
      (%1$L, %3$L, 'flow', 'inv-prueba-fase10-a2', null, 49990, 'pendiente', current_date + 30, current_date + 60, current_date + 30, null, null, 'https://sandbox.flow.cl/app/web/pay.php?token=x'),
      (%2$L, null, 'flow', 'inv-prueba-fase10-b1', null, 39990, 'vencido', current_date - 30, current_date, current_date - 25, null, null, null)
  $q$, current_setting('prueba.org_a'), current_setting('prueba.org_b'), current_setting('prueba.sub_pyme'))) = 'ok'
  and pg_temp.ejecutar(format($q$
    insert into public.eventos_pasarela (proveedor, tipo, token, organizacion_id, datos)
    values ('flow', 'pago', 'tok-prueba-fase10-1', %L, '{"status":2}')
  $q$, current_setting('prueba.org_b'))) = 'ok',
  pg_temp.valor('select count(*) from public.pagos where factura_externa like ''inv-prueba-fase10%'''));

do $$
declare
  v1 text := pg_temp.ejecutar($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                 select organizacion_id, 'flow', 'inv-prueba-fase10-x1', 1000, 'reembolsado'
                                 from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-a'$q$);
  v2 text := pg_temp.ejecutar($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado, enlace_pago)
                                 select organizacion_id, 'flow', 'inv-prueba-fase10-x2', 1000, 'pendiente', 'http://flow.cl/pago'
                                 from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-a'$q$);
  v3 text := pg_temp.ejecutar($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                 select organizacion_id, 'stripe', 'inv-prueba-fase10-x3', 1000, 'pendiente'
                                 from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-a'$q$);
  v4 text := pg_temp.ejecutar($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                 select organizacion_id, 'flow', 'inv-prueba-fase10-x4', -1, 'pendiente'
                                 from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-a'$q$);
  v5 text := pg_temp.ejecutar($q$update public.clientes_pago set tarjeta_ultimos4 = '66a3' where cliente_externo = 'cus-prueba-fase10-a'$q$);
  v6 text := pg_temp.ejecutar($q$insert into public.eventos_pasarela (proveedor, tipo, token) values ('flow', 'reembolso', 'tok-prueba-fase10-2')$q$);
begin
  perform pg_temp.registrar(20, 'check: estado de pago fuera de los 4, enlace sin https, proveedor distinto de flow, monto negativo, últimos 4 no numéricos y tipo de aviso desconocido: 23514',
    v1 = '23514' and v2 = '23514' and v3 = '23514' and v4 = '23514' and v5 = '23514' and v6 = '23514',
    v1 || '/' || v2 || '/' || v3 || '/' || v4 || '/' || v5 || '/' || v6);
end $$;

do $$
declare
  v1 text := pg_temp.ejecutar(format($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                        values (%L, 'flow', 'inv-prueba-fase10-a1', 14990, 'pagado')$q$,
                                     current_setting('prueba.org_b')));
  v2 text := pg_temp.ejecutar($q$insert into public.eventos_pasarela (proveedor, tipo, token) values ('flow', 'pago', 'tok-prueba-fase10-1')$q$);
  v3 text := pg_temp.ejecutar(format($q$insert into public.clientes_pago (organizacion_id, proveedor, cliente_externo)
                                        values (%L, 'flow', 'cus-prueba-fase10-a')$q$, current_setting('prueba.org_b')));
  v4 text := pg_temp.ejecutar($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                 select organizacion_id, 'flow', 'inv-prueba-fase10-a2', 49990, 'pagado'
                                 from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-a'
                                 on conflict (proveedor, factura_externa) do update set estado = excluded.estado,
                                   pagado_en = now(), intentos = public.pagos.intentos + 1$q$);
begin
  perform pg_temp.registrar(21, 'únicos: la misma factura, el mismo aviso o el mismo cliente externo no se repiten (23505); el upsert por (proveedor, factura_externa) actualiza el importe',
    v1 = '23505' and v2 = '23505' and v3 = '23505' and v4 = 'ok'
    and pg_temp.valor($q$select estado || '|' || intentos from public.pagos where factura_externa = 'inv-prueba-fase10-a2'$q$) = 'pagado|1'
    and pg_temp.valor($q$select count(*) from public.pagos where factura_externa like 'inv-prueba-fase10%'$q$) = '3',
    v1 || '/' || v2 || '/' || v3 || '/' || v4);
end $$;

-- ---------------------------------------------------------------------------
-- 9. RLS: quién lee pagos y clientes_pago
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(22, 'el propietario de A lee los 2 pagos y el cliente de A, y nada de B',
  pg_temp.ve(current_setting('prueba.org_a')) = '2/1' and pg_temp.ve(current_setting('prueba.org_b')) = '0/0',
  'A ' || pg_temp.ve(current_setting('prueba.org_a')) || ', B ' || pg_temp.ve(current_setting('prueba.org_b')));

select pg_temp.registrar(23, 'con sesión no se lee eventos_pasarela (42501), ni siquiera el propietario',
  pg_temp.valor('select count(*) from public.eventos_pasarela') = '42501',
  pg_temp.valor('select count(*) from public.eventos_pasarela'));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(24, 'el administrador de A lee los 2 pagos y el cliente de A (con la tarjeta: marca y últimos 4), y nada de B',
  pg_temp.ve(current_setting('prueba.org_a')) = '2/1' and pg_temp.ve(current_setting('prueba.org_b')) = '0/0'
  and pg_temp.valor('select tarjeta_marca || '' '' || tarjeta_ultimos4 from public.clientes_pago') = 'Visa 6623',
  'A ' || pg_temp.ve(current_setting('prueba.org_a')) || ', B ' || pg_temp.ve(current_setting('prueba.org_b')));

do $$
declare
  v_ins text := pg_temp.ejecutar(format($q$insert into public.pagos (organizacion_id, proveedor, factura_externa, monto_clp, estado)
                                           values (%L, 'flow', 'inv-prueba-fase10-x9', 0, 'pagado')$q$,
                                        current_setting('prueba.org_a')));
  v_upd text := pg_temp.ejecutar($q$update public.pagos set estado = 'anulado' where factura_externa = 'inv-prueba-fase10-a2'$q$);
  v_del text := pg_temp.ejecutar($q$delete from public.pagos where factura_externa = 'inv-prueba-fase10-a2'$q$);
  v_cli text := pg_temp.ejecutar(format($q$update public.clientes_pago set plan_pendiente_id = %L
                                           where cliente_externo = 'cus-prueba-fase10-a'$q$, pg_temp.plan('empresa')));
  v_cin text := pg_temp.ejecutar(format($q$insert into public.clientes_pago (organizacion_id, proveedor, cliente_externo)
                                           values (%L, 'flow', 'cus-prueba-fase10-x')$q$, current_setting('prueba.org_a')));
  v_ev  text := pg_temp.ejecutar($q$insert into public.eventos_pasarela (proveedor, tipo, token) values ('flow', 'pago', 'tok-prueba-fase10-x')$q$);
begin
  perform pg_temp.registrar(25, 'el administrador de A con su sesión no inserta, edita ni borra pagos, no edita ni crea clientes_pago y no escribe avisos (42501)',
    v_ins = '42501' and v_upd = '42501' and v_del = '42501' and v_cli = '42501' and v_cin = '42501' and v_ev = '42501'
    and pg_temp.valor($q$select estado from public.pagos where factura_externa = 'inv-prueba-fase10-a2'$q$) = 'pagado',
    v_ins || '/' || v_upd || '/' || v_del || '/' || v_cli || '/' || v_cin || '/' || v_ev);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a3","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_emisor', pg_temp.ve(current_setting('prueba.org_a')), true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(26, 'el emisor y el lector de A no leen pagos ni clientes_pago (0 filas: la política es es_admin)',
  current_setting('prueba.ve_emisor') = '0/0' and pg_temp.ve(current_setting('prueba.org_a')) = '0/0',
  'emisor ' || current_setting('prueba.ve_emisor') || ', lector ' || pg_temp.ve(current_setting('prueba.org_a')));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010b1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(27, 'el propietario de B lee solo lo suyo (1 pago y su cliente) y nada de A',
  pg_temp.ve(current_setting('prueba.org_b')) = '1/1' and pg_temp.ve(current_setting('prueba.org_a')) = '0/0'
  and pg_temp.valor('select count(*) from public.pagos') = '1',
  'B ' || pg_temp.ve(current_setting('prueba.org_b')) || ', A ' || pg_temp.ve(current_setting('prueba.org_a')));

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.registrar(28, 'anon no puede leer pagos, clientes_pago ni eventos_pasarela (42501)',
  pg_temp.valor('select count(*) from public.pagos') = '42501'
  and pg_temp.valor('select count(*) from public.clientes_pago') = '42501'
  and pg_temp.valor('select count(*) from public.eventos_pasarela') = '42501',
  pg_temp.valor('select count(*) from public.pagos') || '/' || pg_temp.valor('select count(*) from public.clientes_pago')
    || '/' || pg_temp.valor('select count(*) from public.eventos_pasarela'));

-- ---------------------------------------------------------------------------
-- 10. Acciones de las FK al borrar
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_borrar text;
begin
  -- Borrar la suscripción de Flow de A deja sus pagos sin suscripción (on delete set null).
  v_borrar := pg_temp.ejecutar(format('delete from public.suscripciones where id = %L', current_setting('prueba.sub_pyme')));
  perform pg_temp.registrar(29, 'borrar una suscripción deja sus pagos con suscripcion_id null (on delete set null)',
    v_borrar = 'ok'
    and pg_temp.valor($q$select count(*) from public.pagos
                         where factura_externa in ('inv-prueba-fase10-a1', 'inv-prueba-fase10-a2')
                           and suscripcion_id is null$q$) = '2',
    v_borrar);
end $$;

do $$
declare
  v_borrar text := pg_temp.ejecutar(format('delete from public.organizaciones where id = %L', current_setting('prueba.org_b')));
begin
  perform pg_temp.registrar(30, 'borrar la organización B borra sus pagos y su cliente (cascade) y deja su aviso con organizacion_id null (set null)',
    v_borrar = 'ok'
    and pg_temp.valor($q$select count(*) from public.pagos where factura_externa = 'inv-prueba-fase10-b1'$q$) = '0'
    and pg_temp.valor($q$select count(*) from public.clientes_pago where cliente_externo = 'cus-prueba-fase10-b'$q$) = '0'
    and pg_temp.valor($q$select (organizacion_id is null)::text from public.eventos_pasarela where token = 'tok-prueba-fase10-1'$q$) = 'true',
    v_borrar);
end $$;

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones, suscripciones, CAF ni pagos de prueba
