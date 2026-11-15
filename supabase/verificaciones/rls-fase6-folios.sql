-- Simulación de roles de la Fase 6: anular folios y CAF sin traslapes (migración 0011).
--
-- Criterio: un administrador anula folios asignados que no se usaron (caso a) y la cola
-- completa de un CAF (caso b, que deja el CAF `anulado` y fuera de `asignar_folio`); el
-- emisor, el lector y anon no pueden, y para otra organización el CAF no existe; un folio
-- con documento no anulado, una cola parcial y un rango fuera del CAF se rechazan; repetir
-- una anulación devuelve 0; un CAF que se traslapa con otro de la misma empresa, ambiente
-- y tipo da 23P01, y `registrar_caf` sigue siendo idempotente; un administrador con su
-- sesión no escribe directo en `folios_anulados` (sin la política `alta` de 0001), y
-- `cafs` y `folios_anulados` están en la publicación de Realtime. 27 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0011 APLICADA (anular_folios, trg_20_caf_sin_traslape, sin política
-- alta, Realtime). Sin ella el script corre igual (cada llamada captura su error), pero solo
-- la 1 sale true: las de anular_folios dan 42883 (la función no existe), los CAF
-- traslapados entran, el insert directo pasa y las tablas no están publicadas.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase3-empresas.sql y rls-fase5-certificacion.sql): crea usuarios ficticios
-- (folios-…@ejemplo.invalid), dos organizaciones, una empresa, CAF de MENTIRA por
-- `registrar_caf` (con su secreto de prueba en Vault), dos documentos y folios anulados, y al
-- final deshace todo. El «CAF» es un texto de prueba, no un CAF del SII. No llama a pg_net ni
-- a nada con efectos fuera de la base (los documentos quedan en `firmado` y `anulado`, que no
-- encolan webhooks). No lee el contenido de ningún secreto: de Vault solo cuenta filas por
-- descripción.
--
-- Cómo correrlo (con la migración 0011 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación:
--        ok = true   se comportó como se espera
--        ok = false  falló (ver detalle)
--      Si una sale false y el error es del script, se corrige el script; si es del esquema,
--      se reporta (el script no se cambia para que pase).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'folios-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-folios-fase6%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa folios fase 6%') as empresas,
--          (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
--      (`secretos` puede no ser 0 si una empresa real tiene el RUT 11111111-1: basta con que
--      sea el mismo número que antes de correr el script.)
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 5): `request.jwt.claims` local a la
-- transacción (lo leen auth.uid() y auth.role()) + `set local role authenticated | anon |
-- service_role`; `reset role` vuelve a postgres. Los ids que pasan de un paso a otro van en
-- parámetros locales `prueba.*`.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...6a1 propietario de A    ...6a2 administrador de A
--   ...6a3 emisor de A         ...6a4 lector de A
--   ...6b1 propietario de B
-- A pasa al plan Pyme y su equipo se da de alta directo, como lo haría el backend.
--
-- Datos de la empresa de A (tipo 39, certificación):
--   CAF1 folios 1 a 10 y CAF2 folios 11 a 20, por registrar_caf (service_role).
--   asignar_folio entrega 5 folios de CAF1 (siguiente_folio queda en 6).
--   Documento `anulado` con folio 1 y documento `firmado` con folio 2 (CAF1).

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

-- Llama a anular_folios con el rol de la sesión y devuelve 'ok:<n>' o '<sqlstate> <mensaje>'.
create function pg_temp.anular(p_caf uuid, p_desde integer, p_hasta integer, p_motivo text default 'Prueba de anulación')
returns text
language plpgsql
as $$
begin
  return 'ok:' || public.anular_folios(p_caf, p_desde, p_hasta, p_motivo);
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.anular(uuid, integer, integer, text) to authenticated, anon, service_role;

-- Estado del CAF sin RLS ('estado|siguiente_folio'), para comparar desde cualquier rol.
create function pg_temp.caf_estado(p_caf uuid)
returns text
language sql
security definer
as $$
  select c.estado::text || '|' || c.siguiente_folio from public.cafs c where c.id = p_caf;
$$;
grant execute on function pg_temp.caf_estado(uuid) to authenticated, anon, service_role;

-- Folios anulados de un CAF, sin RLS.
create function pg_temp.anulados(p_caf uuid)
returns bigint
language sql
security definer
as $$
  select count(*) from public.folios_anulados where caf_id = p_caf;
$$;
grant execute on function pg_temp.anulados(uuid) to authenticated, anon, service_role;

-- Secretos de CAF con el RUT de prueba (por la descripción, que lleva solo datos públicos).
create function pg_temp.secretos_caf()
returns bigint
language sql
security definer
as $$
  select count(*) from vault.secrets where description like 'caf:11111111-1:%';
$$;
grant execute on function pg_temp.secretos_caf() to authenticated, anon, service_role;

-- registrar_caf con los valores de prueba (lo que cambia va en los parámetros).
create function pg_temp.caf(p_desde integer, p_hasta integer, p_tipo smallint default 39::smallint)
returns uuid
language sql
as $$
  select public.registrar_caf(current_setting('prueba.org_a')::uuid, current_setting('prueba.emp')::uuid,
                              'certificacion', p_tipo, p_desde, p_hasta, date '2026-11-15', 100::smallint,
                              '11111111-1', 'EMPRESA FOLIOS FASE 6',
                              '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>',
                              null);
$$;
grant execute on function pg_temp.caf(integer, integer, smallint) to authenticated, anon, service_role;

select set_config('prueba.secretos0', pg_temp.secretos_caf()::text, true);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000006a1', 'folios-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000006a2', 'folios-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000006a3', 'folios-emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-0000000006a4', 'folios-lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000006b1', 'folios-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba folios Fase 6 A', 'zz-prueba-folios-fase6-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba folios Fase 6 B', 'zz-prueba-folios-fase6-b')::text, true);

-- El backend sube a A al plan Pyme, da de alta a su equipo y crea la empresa.
reset role;
select set_config('request.jwt.claims', '', true);
update public.suscripciones
set plan_id = (select id from public.planes where codigo = 'pyme')
where organizacion_id = current_setting('prueba.org_a')::uuid;
insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000006a2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000006a3', 'emisor'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000006a4', 'lector');
do $$
declare
  v uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '11111111-1', 'Empresa folios fase 6', 'Servicios de prueba',
          'Calle Falsa 123', 'Santiago')
  returning id into v;
  perform set_config('prueba.emp', v::text, true);
end $$;

-- Como service_role: los dos CAF y 5 folios asignados de CAF1.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('prueba.caf1', pg_temp.caf(1, 10)::text, true);
select set_config('prueba.caf2', pg_temp.caf(11, 20)::text, true);
-- Uno por sentencia (en una sola consulta Postgres puede evaluar la función una sola vez).
do $$
declare
  v_folios text := '';
  v_folio  integer;
begin
  for i in 1 .. 5 loop
    select a.folio into v_folio
    from public.asignar_folio(current_setting('prueba.emp')::uuid, 'certificacion', 39::smallint) a;
    v_folios := v_folios || case when i > 1 then ',' else '' end || v_folio;
  end loop;
  perform set_config('prueba.asignados', v_folios, true);
end $$;

-- Como postgres: un documento anulado (folio 1) y uno firmado (folio 2) de CAF1.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.documentos (organizacion_id, empresa_id, ambiente, tipo_dte, folio, caf_id, estado,
                               mnt_neto, iva, mnt_total)
values
  (current_setting('prueba.org_a')::uuid, current_setting('prueba.emp')::uuid, 'certificacion', 39, 1,
   current_setting('prueba.caf1')::uuid, 'anulado', 840, 160, 1000),
  (current_setting('prueba.org_a')::uuid, current_setting('prueba.emp')::uuid, 'certificacion', 39, 2,
   current_setting('prueba.caf1')::uuid, 'firmado', 840, 160, 1000);

select pg_temp.registrar(1, 'preparación: A (Pyme) con los 4 roles, B; CAF1 (1-10) con 5 folios asignados y CAF2 (11-20) activos; documentos con folio 1 (anulado) y 2 (firmado)',
  (select string_agg(m.rol::text, ',' order by m.rol) from public.miembros_organizacion m
    where m.organizacion_id = current_setting('prueba.org_a')::uuid) = 'propietario,administrador,emisor,lector'
  and current_setting('prueba.asignados') = '1,2,3,4,5'
  and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6'
  and pg_temp.caf_estado(current_setting('prueba.caf2')::uuid) = 'activo|11'
  and (select count(*) from public.documentos where empresa_id = current_setting('prueba.emp')::uuid) = 2
  and pg_temp.secretos_caf() = current_setting('prueba.secretos0')::bigint + 2,
  'asignados ' || current_setting('prueba.asignados') || '; CAF1 ' || pg_temp.caf_estado(current_setting('prueba.caf1')::uuid)
  || '; CAF2 ' || pg_temp.caf_estado(current_setting('prueba.caf2')::uuid));

-- ---------------------------------------------------------------------------
-- 1. Administrador de A: caso a (folios asignados y no usados)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a2","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 3, 4, '  Folios saltados por un corte  ');
begin
  perform pg_temp.registrar(2, 'caso a: el administrador anula 3-4 (bajo siguiente_folio): devuelve 2, con motivo sin espacios, anulado_por y organización; el CAF sigue activo en 6',
    r = 'ok:2'
    and (select count(*) = 2
                and bool_and(motivo = 'Folios saltados por un corte'
                             and anulado_por = '00000000-0000-4000-8000-0000000006a2'
                             and organizacion_id = current_setting('prueba.org_a')::uuid)
           from public.folios_anulados
          where caf_id = current_setting('prueba.caf1')::uuid and folio in (3, 4))
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6',
    r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 3, 4);
begin
  perform pg_temp.registrar(3, 'repetir la misma anulación devuelve 0 y no duplica',
    r = 'ok:0' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 2, r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 3, 5);
begin
  perform pg_temp.registrar(4, 'un rango que repite folios ya anulados cuenta solo los nuevos (3-5 devuelve 1)',
    r = 'ok:1' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 3, r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 1, 2);
begin
  perform pg_temp.registrar(5, 'un folio con documento firmado no se anula (23503) y no entra ningún folio del rango',
    r like '23503 %' and r like '%folio 2%' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 3, r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 1, 1);
begin
  perform pg_temp.registrar(6, 'un folio cuyo documento está anulado sí se anula',
    r = 'ok:1' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4, r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 8);
begin
  perform pg_temp.registrar(7, 'cola parcial (6-8, sin llegar al folio 10): 22023 y el CAF no cambia',
    r like '22023 %' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6', r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 8, 10);
begin
  perform pg_temp.registrar(8, 'cola que empieza más arriba del siguiente folio (8-10 con siguiente 6): 22023',
    r like '22023 %' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6', r);
end $$;

do $$
declare
  r1 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 9, 11);
  r2 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 0, 2);
begin
  perform pg_temp.registrar(9, 'rango fuera del CAF (9-11 y 0-2): 22023',
    r1 like '22023 %' and r2 like '22023 %' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4,
    r1 || ' / ' || r2);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 4, 3);
begin
  perform pg_temp.registrar(10, 'folio inicial mayor que el final: 22023', r like '22023 %', r);
end $$;

do $$
declare
  r1 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 5, 5, '   ');
  r2 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 5, 5, null);
  r3 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 5, 5, repeat('x', 501));
  r4 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 5, 5, repeat('x', 500));
begin
  perform pg_temp.registrar(11, 'motivo vacío, nulo o de 501 caracteres: 22023; de 500 sí pasa (devuelve 0: el 5 ya estaba)',
    r1 like '22023 %' and r2 like '22023 %' and r3 like '22023 %' and r4 = 'ok:0',
    r1 || ' / ' || r2 || ' / ' || r3 || ' / ' || r4);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Quienes no pueden: emisor, lector, otra organización y anon
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 10);
begin
  perform pg_temp.registrar(12, 'el emisor de A no anula (42501) y el CAF no cambia',
    r like '42501 %' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6', r);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a4","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 3, 4);
begin
  perform pg_temp.registrar(13, 'el lector de A no anula (42501)',
    r like '42501 %' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 4, r);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r1 text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 10);
  r2 text := pg_temp.anular(gen_random_uuid(), 6, 10);
  v_ve bigint := (select count(*) from public.cafs where id = current_setting('prueba.caf1')::uuid);
begin
  perform pg_temp.registrar(14, 'el propietario de B no ve el CAF de A: anular da lo mismo que un CAF inexistente (P0002, mismo mensaje) y el select no lo devuelve',
    r1 like 'P0002 %' and r1 = r2 and v_ve = 0
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6',
    r1 || ' / ' || r2 || ' / ve ' || v_ve);
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 10);
begin
  perform pg_temp.registrar(15, 'anon no ejecuta anular_folios (42501)',
    r like '42501 %' and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'activo|6', r);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Caso b: la cola completa deja el CAF anulado
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 10, 'Cambio de software');
begin
  perform pg_temp.registrar(16, 'caso b: el propietario anula la cola 6-10: devuelve 5 y el CAF queda anulado con siguiente_folio 11',
    r = 'ok:5' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 9
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'anulado|11', r);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf1')::uuid, 6, 10, 'Cambio de software');
begin
  perform pg_temp.registrar(17, 'repetir el caso b devuelve 0 y el CAF sigue anulado',
    r = 'ok:0' and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 9
    and pg_temp.caf_estado(current_setting('prueba.caf1')::uuid) = 'anulado|11', r);
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_caf   uuid;
  v_folio integer;
begin
  select a.caf_id, a.folio into v_caf, v_folio
  from public.asignar_folio(current_setting('prueba.emp')::uuid, 'certificacion', 39::smallint) a;
  perform pg_temp.registrar(18, 'después del caso b, asignar_folio ya no usa CAF1: entrega el 11 de CAF2',
    v_caf = current_setting('prueba.caf2')::uuid and v_folio = 11, coalesce(v_folio::text, '-'));
exception when others then
  perform pg_temp.registrar(18, 'después del caso b, asignar_folio ya no usa CAF1: entrega el 11 de CAF2',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  r text := pg_temp.anular(current_setting('prueba.caf2')::uuid, 11, 20, 'Cierre por el backend');
begin
  perform pg_temp.registrar(19, 'service_role anula la cola de CAF2 desde un folio ya asignado (11-20 con siguiente 12): devuelve 10, anulado_por nulo, CAF2 anulado',
    r = 'ok:10'
    and (select count(*) = 10 and bool_and(anulado_por is null)
           from public.folios_anulados where caf_id = current_setting('prueba.caf2')::uuid)
    and pg_temp.caf_estado(current_setting('prueba.caf2')::uuid) = 'anulado|21', r);
end $$;

do $$
declare
  v_folio integer;
begin
  select a.folio into v_folio
  from public.asignar_folio(current_setting('prueba.emp')::uuid, 'certificacion', 39::smallint) a;
  perform pg_temp.registrar(20, 'con los dos CAF anulados, asignar_folio no entrega folios (P0002)',
    false, 'entregó ' || coalesce(v_folio::text, '-'));
exception when others then
  perform pg_temp.registrar(20, 'con los dos CAF anulados, asignar_folio no entrega folios (P0002)',
    sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Traslapes y registrar_caf
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.caf(15, 25);
  perform pg_temp.registrar(21, 'registrar_caf con un rango que se cruza con CAF2 (15-25): 23P01 que nombra el rango, sin secreto huérfano',
    false, 'entró');
exception when others then
  perform pg_temp.registrar(21, 'registrar_caf con un rango que se cruza con CAF2 (15-25): 23P01 que nombra el rango, sin secreto huérfano',
    sqlstate = '23P01' and sqlerrm like '%11 a 20%'
    and pg_temp.secretos_caf() = current_setting('prueba.secretos0')::bigint + 2,
    sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v3 uuid;
  v4 uuid;
begin
  v3 := pg_temp.caf(21, 30);
  v4 := pg_temp.caf(1, 10, 41::smallint);
  perform set_config('prueba.caf3', v3::text, true);
  perform pg_temp.registrar(22, 'lo que no se traslapa entra: el CAF contiguo 21-30 y el mismo rango 1-10 en el tipo 41',
    pg_temp.caf_estado(v3) = 'activo|21' and pg_temp.caf_estado(v4) = 'activo|1'
    and pg_temp.secretos_caf() = current_setting('prueba.secretos0')::bigint + 4,
    v3 || ' / ' || v4);
exception when others then
  perform pg_temp.registrar(22, 'lo que no se traslapa entra: el CAF contiguo 21-30 y el mismo rango 1-10 en el tipo 41',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  update public.cafs set folio_desde = 18 where id = current_setting('prueba.caf3')::uuid;
  perform pg_temp.registrar(23, 'cambiar el rango de un CAF para que choque (21-30 → 18-30): 23P01', false, 'se actualizó');
exception when others then
  perform pg_temp.registrar(23, 'cambiar el rango de un CAF para que choque (21-30 → 18-30): 23P01',
    sqlstate = '23P01' and pg_temp.caf_estado(current_setting('prueba.caf3')::uuid) = 'activo|21',
    sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v uuid;
begin
  v := pg_temp.caf(1, 10);
  perform pg_temp.registrar(24, 'registrar_caf repetido con CAF1 devuelve el mismo id, sin secreto nuevo y sin reactivarlo',
    v = current_setting('prueba.caf1')::uuid
    and pg_temp.secretos_caf() = current_setting('prueba.secretos0')::bigint + 4
    and pg_temp.caf_estado(v) = 'anulado|11',
    v::text);
exception when others then
  perform pg_temp.registrar(24, 'registrar_caf repetido con CAF1 devuelve el mismo id, sin secreto nuevo y sin reactivarlo',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Lectura de los folios anulados (RLS de 0001)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a4","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_lector', (select count(*) from public.folios_anulados)::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.ve_b', (select count(*) from public.folios_anulados)::text, true);
reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp.registrar(25, 'el lector de A ve los 19 folios anulados de su organización; B no ve ninguno',
  current_setting('prueba.ve_lector') = '19' and current_setting('prueba.ve_b') = '0',
  'lector ' || current_setting('prueba.ve_lector') || ', B ' || current_setting('prueba.ve_b'));

-- ---------------------------------------------------------------------------
-- 6. Sin insert directo en folios_anulados (solo anular_folios) y Realtime
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_ins text := 'no';
  v_upd text := 'no';
  v_del text := 'no';
begin
  begin
    insert into public.folios_anulados (organizacion_id, caf_id, folio, motivo)
    values (current_setting('prueba.org_a')::uuid, current_setting('prueba.caf3')::uuid, 25, 'Insert directo');
  exception when others then
    v_ins := sqlstate;
  end;
  begin
    update public.folios_anulados set motivo = 'Editado' where caf_id = current_setting('prueba.caf1')::uuid;
  exception when others then
    v_upd := sqlstate;
  end;
  begin
    delete from public.folios_anulados where caf_id = current_setting('prueba.caf1')::uuid;
  exception when others then
    v_del := sqlstate;
  end;
  perform pg_temp.registrar(26, 'el administrador de A con su sesión no inserta, edita ni borra directo en folios_anulados (42501): solo por anular_folios',
    v_ins = '42501' and v_upd = '42501' and v_del = '42501'
    and pg_temp.anulados(current_setting('prueba.caf3')::uuid) = 0
    and pg_temp.anulados(current_setting('prueba.caf1')::uuid) = 9
    and pg_temp.caf_estado(current_setting('prueba.caf3')::uuid) = 'activo|21',
    v_ins || '/' || v_upd || '/' || v_del);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp.registrar(27, 'cafs y folios_anulados están en la publicación supabase_realtime',
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('cafs', 'folios_anulados')) = 2,
  (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'));

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones, empresa, CAF, documentos, folios ni secretos de prueba
