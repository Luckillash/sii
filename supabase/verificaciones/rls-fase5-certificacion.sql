-- Simulación de las RPC de la Fase 5 (registrar_caf y guardar_set_pruebas, migración 0008).
--
-- Criterio: el XML del CAF entra a Vault y su fila a `cafs` en la misma transacción (con la
-- solicitud de folios enlazada y timbrada); repetir el mismo CAF devuelve el mismo id sin
-- crear otro secreto; un CAF con otro rango, de otra empresa, con el IDK de otro ambiente o
-- con la solicitud de otra empresa se rechaza sin dejar secretos huérfanos; el set de pruebas
-- se reemplaza completo junto con el proceso, y nada de esto lo ejecuta `authenticated` ni
-- `anon`. 16 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0008 APLICADA (registrar_caf, guardar_set_pruebas). Sin ella el
-- script se detiene con «function ... does not exist» (42883) y la transacción se descarta
-- completa: no hay resultados que leer.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase4-bloqueos.sql): crea dos organizaciones, dos empresas, un proceso de
-- certificación, una solicitud de folios y, por las RPC, CAF de MENTIRA con su secreto en
-- Vault, y al final deshace todo. El «CAF» es un texto de prueba, no un CAF del SII. No llama
-- a pg_net ni a nada con efectos fuera de la base.
--
-- Cómo correrlo (con la migración 0008 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación:
--        ok = true   se comportó como se espera
--        ok = false  falló (ver detalle)
--      Si una sale false y el error es del script, se corrige el script; si es del esquema,
--      se reporta (el script no se cambia para que pase).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-certificacion-fase5%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa de prueba fase 5%') as empresas,
--          (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 4): `request.jwt.claims` local a la
-- transacción + `set local role service_role | authenticated | anon`; `reset role` vuelve
-- a postgres. Los ids que pasan de un paso a otro van en parámetros locales `prueba.*`.

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

-- Secretos de CAF de la empresa de prueba (por la descripción, que lleva solo datos públicos).
create function pg_temp.secretos_caf()
returns bigint
language sql
security definer
as $$
  select count(*) from vault.secrets where description like 'caf:11111111-1:%';
$$;
grant execute on function pg_temp.secretos_caf() to authenticated, anon, service_role;

-- ¿El secreto del CAF (descifrado) trae el XML completo, con su <RSASK>? Solo devuelve un
-- booleano: el contenido no sale del script.
create function pg_temp.secreto_con_rsask(p_caf uuid)
returns boolean
language sql
security definer
as $$
  select coalesce((select d.decrypted_secret like '%<RSASK>%'
                     from public.cafs c join vault.decrypted_secrets d on d.id = c.caf_secret_id
                    where c.id = p_caf), false);
$$;
grant execute on function pg_temp.secreto_con_rsask(uuid) to authenticated, anon, service_role;

-- Llama a registrar_caf con los valores de prueba (lo que cambia va en los parámetros).
create function pg_temp.caf(
  p_org uuid, p_emp uuid, p_desde integer, p_hasta integer,
  p_ambiente public.ambiente_sii default 'certificacion', p_idk smallint default 100,
  p_rut text default '11111111-1', p_solicitud uuid default null
)
returns uuid
language sql
as $$
  select public.registrar_caf(p_org, p_emp, p_ambiente, 39::smallint, p_desde, p_hasta,
                              date '2026-11-13', p_idk, p_rut, 'EMPRESA DE PRUEBA FASE 5',
                              '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>',
                              p_solicitud);
$$;
grant execute on function pg_temp.caf(uuid, uuid, integer, integer, public.ambiente_sii, smallint, text, uuid)
  to authenticated, anon, service_role;

do $$
declare
  v_org  uuid;
  v_org2 uuid;
  v_emp  uuid;
  v_emp2 uuid;
  v_proc uuid;
  v_sol  uuid;
  v_sol2 uuid;
begin
  insert into public.organizaciones (nombre, slug)
  values ('Prueba certificación Fase 5', 'zz-prueba-certificacion-fase5')
  returning id into v_org;
  insert into public.organizaciones (nombre, slug)
  values ('Prueba certificación Fase 5 (otra)', 'zz-prueba-certificacion-fase5-otra')
  returning id into v_org2;
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (v_org, '11111111-1', 'Empresa de prueba fase 5', 'Servicios de prueba',
          'Calle Falsa 123', 'Santiago')
  returning id into v_emp;
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (v_org, '22222222-2', 'Empresa de prueba fase 5 (otra)', 'Servicios de prueba',
          'Calle Falsa 123', 'Santiago')
  returning id into v_emp2;
  insert into public.procesos_certificacion (organizacion_id, empresa_id, etapa)
  values (v_org, v_emp, 'postulada')
  returning id into v_proc;
  insert into public.solicitudes_folios (organizacion_id, empresa_id, ambiente, tipo_dte, cantidad, confirmada)
  values (v_org, v_emp, 'certificacion', 39, 5, true)
  returning id into v_sol;
  insert into public.solicitudes_folios (organizacion_id, empresa_id, ambiente, tipo_dte, cantidad, confirmada)
  values (v_org, v_emp2, 'certificacion', 39, 5, true)
  returning id into v_sol2;
  perform set_config('prueba.org', v_org::text, true);
  perform set_config('prueba.org2', v_org2::text, true);
  perform set_config('prueba.emp', v_emp::text, true);
  perform set_config('prueba.emp2', v_emp2::text, true);
  perform set_config('prueba.proc', v_proc::text, true);
  perform set_config('prueba.sol', v_sol::text, true);
  perform set_config('prueba.sol2', v_sol2::text, true);
end $$;

select pg_temp.registrar(1, 'preparación: organización, empresas, proceso y solicitudes de prueba, sin CAF ni secretos',
  (select count(*) from public.cafs where empresa_id = current_setting('prueba.emp')::uuid) = 0
  and pg_temp.secretos_caf() = 0,
  current_setting('prueba.emp'));

-- ---------------------------------------------------------------------------
-- 1. registrar_caf como service_role
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v uuid;
begin
  v := pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 1, 5,
                   p_solicitud => current_setting('prueba.sol')::uuid);
  perform set_config('prueba.caf', v::text, true);
  perform pg_temp.registrar(2, 'registra el CAF: fila en cafs (activo, siguiente_folio = folio_desde) y un secreto en Vault',
    (select c.estado = 'activo' and c.siguiente_folio = 1 and c.folio_hasta = 5 and c.idk = 100
            and c.organizacion_id = current_setting('prueba.org')::uuid
       from public.cafs c where c.id = v)
    and pg_temp.secretos_caf() = 1,
    v::text);
exception when others then
  perform pg_temp.registrar(2, 'registra el CAF: fila en cafs (activo, siguiente_folio = folio_desde) y un secreto en Vault',
    false, sqlstate || ' ' || sqlerrm);
end $$;

select pg_temp.registrar(3, 'el secreto guarda el XML completo y la fila apunta a él',
  pg_temp.secreto_con_rsask(nullif(current_setting('prueba.caf', true), '')::uuid));

select pg_temp.registrar(4, 'la solicitud queda timbrada con el rango y el caf_id, y el CAF la enlaza',
  coalesce((select s.estado = 'timbrada' and s.folio_desde = 1 and s.folio_hasta = 5
                   and s.caf_id = c.id and c.solicitud_id = s.id and s.terminado_en is not null
              from public.solicitudes_folios s
              join public.cafs c on c.id = nullif(current_setting('prueba.caf', true), '')::uuid
             where s.id = current_setting('prueba.sol')::uuid), false));

do $$
declare
  v uuid;
begin
  v := pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 1, 5,
                   p_solicitud => current_setting('prueba.sol')::uuid);
  perform pg_temp.registrar(5, 'idempotente: el mismo CAF devuelve el mismo id y no crea otro secreto',
    v = current_setting('prueba.caf')::uuid and pg_temp.secretos_caf() = 1
    and (select count(*) from public.cafs where empresa_id = current_setting('prueba.emp')::uuid) = 1,
    v::text);
exception when others then
  perform pg_temp.registrar(5, 'idempotente: el mismo CAF devuelve el mismo id y no crea otro secreto',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 1, 9);
  perform pg_temp.registrar(6, 'mismo folio_desde con otro rango: 23505 sin secreto huérfano', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(6, 'mismo folio_desde con otro rango: 23505 sin secreto huérfano',
    sqlstate = '23505' and pg_temp.secretos_caf() = 1, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 10, 14,
                      p_rut => '22222222-2');
  perform pg_temp.registrar(7, 'CAF de otro RUT emisor: 22023 sin secreto', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(7, 'CAF de otro RUT emisor: 22023 sin secreto',
    sqlstate = '22023' and pg_temp.secretos_caf() = 1, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 10, 14,
                      p_idk => 300::smallint);
  perform pg_temp.registrar(8, 'IDK de producción en certificación: 22023 sin secreto', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(8, 'IDK de producción en certificación: 22023 sin secreto',
    sqlstate = '22023' and pg_temp.secretos_caf() = 1, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 10, 14,
                      p_solicitud => current_setting('prueba.sol2')::uuid);
  perform pg_temp.registrar(9, 'solicitud de otra empresa: 22023 sin secreto', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(9, 'solicitud de otra empresa: 22023 sin secreto',
    sqlstate = '22023' and pg_temp.secretos_caf() = 1, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform pg_temp.caf(current_setting('prueba.org2')::uuid, current_setting('prueba.emp')::uuid, 10, 14);
  perform pg_temp.registrar(10, 'empresa de otra organización: P0002 sin secreto', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(10, 'empresa de otra organización: P0002 sin secreto',
    sqlstate = 'P0002' and pg_temp.secretos_caf() = 1, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 2. guardar_set_pruebas como service_role
-- ---------------------------------------------------------------------------

do $$
declare
  v integer;
  v_casos jsonb := (
    select jsonb_agg(jsonb_build_object(
      'numero_caso', n, 'tipo_dte', 39,
      'detalles', jsonb_build_array(jsonb_build_object('nombre', 'Item ' || n, 'cantidad', 1, 'precio', 1000)),
      'referencia_codigo', 'SET', 'referencia_razon', 'CASO-' || n))
    from generate_series(1, 5) n);
begin
  v := public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                  'SET DE PRUEBA ... CASO-1 ...', 'sw@proveedor.cl', v_casos);
  perform pg_temp.registrar(11, 'guarda 5 casos y deja el proceso en set_descargado con texto, correo y fecha',
    v = 5
    and (select count(*) from public.set_pruebas_casos
          where proceso_id = current_setting('prueba.proc')::uuid
            and organizacion_id = current_setting('prueba.org')::uuid) = 5
    and (select etapa = 'set_descargado' and set_pruebas_texto like 'SET DE PRUEBA%'
                and correo_proveedor_set = 'sw@proveedor.cl' and set_descargado_en is not null
           from public.procesos_certificacion where id = current_setting('prueba.proc')::uuid),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(11, 'guarda 5 casos y deja el proceso en set_descargado con texto, correo y fecha',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v integer;
  v_casos jsonb := (
    select jsonb_agg(jsonb_build_object(
      'numero_caso', n, 'tipo_dte', 39,
      'detalles', jsonb_build_array(jsonb_build_object('nombre', 'Otro ' || n, 'cantidad', 2, 'precio', 500)),
      'referencia_razon', 'CASO-' || n))
    from generate_series(1, 3) n);
begin
  v := public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                  'SET DE PRUEBA nuevo', null, v_casos);
  perform pg_temp.registrar(12, 'un set nuevo reemplaza los casos (3, con CodRef SET por defecto) y conserva el correo',
    v = 3
    and (select count(*) from public.set_pruebas_casos
          where proceso_id = current_setting('prueba.proc')::uuid) = 3
    and not exists (select 1 from public.set_pruebas_casos
                     where proceso_id = current_setting('prueba.proc')::uuid
                       and (referencia_codigo <> 'SET' or detalles -> 0 ->> 'nombre' not like 'Otro%'))
    and (select correo_proveedor_set = 'sw@proveedor.cl'
           from public.procesos_certificacion where id = current_setting('prueba.proc')::uuid),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(12, 'un set nuevo reemplaza los casos (3, con CodRef SET por defecto) y conserva el correo',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                     'SET', null,
                                     '[{"numero_caso": 1, "detalles": [], "referencia_razon": "CASO-1"}]'::jsonb);
  perform pg_temp.registrar(13, 'casos inválidos (sin detalles): 22023 y los casos anteriores siguen', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(13, 'casos inválidos (sin detalles): 22023 y los casos anteriores siguen',
    sqlstate = '22023'
    and (select count(*) from public.set_pruebas_casos where proceso_id = current_setting('prueba.proc')::uuid) = 3,
    sqlstate || ' ' || sqlerrm);
end $$;

reset role;
update public.procesos_certificacion set codigo_estado_sii = 'P90'
where id = current_setting('prueba.proc')::uuid;
set local role service_role;

do $$
begin
  perform public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                     'SET', null,
                                     '[{"numero_caso": 1, "detalles": [{"nombre": "x", "cantidad": 1, "precio": 1}], "referencia_razon": "CASO-1"}]'::jsonb);
  perform pg_temp.registrar(14, 'en por_declarar (P90) no se reemplaza el set: 22023', false, 'no lanzó');
exception when others then
  perform pg_temp.registrar(14, 'en por_declarar (P90) no se reemplaza el set: 22023',
    sqlstate = '22023'
    and (select count(*) from public.set_pruebas_casos where proceso_id = current_setting('prueba.proc')::uuid) = 3,
    sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 3. authenticated y anon no ejecutan ninguna
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000f501"}', true);
set local role authenticated;

do $$
declare
  v_caf text := 'no';
  v_set text := 'no';
begin
  begin
    perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 20, 24);
  exception when others then
    v_caf := sqlstate;
  end;
  begin
    perform public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                       'SET', null, '[]'::jsonb);
  exception when others then
    v_set := sqlstate;
  end;
  perform pg_temp.registrar(15, 'authenticated no ejecuta registrar_caf ni guardar_set_pruebas (42501)',
    v_caf = '42501' and v_set = '42501', v_caf || '/' || v_set);
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare
  v_caf text := 'no';
  v_set text := 'no';
begin
  begin
    perform pg_temp.caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 20, 24);
  exception when others then
    v_caf := sqlstate;
  end;
  begin
    perform public.guardar_set_pruebas(current_setting('prueba.org')::uuid, current_setting('prueba.proc')::uuid,
                                       'SET', null, '[]'::jsonb);
  exception when others then
    v_set := sqlstate;
  end;
  perform pg_temp.registrar(16, 'anon no ejecuta registrar_caf ni guardar_set_pruebas (42501), y no quedó ningún secreto de más',
    v_caf = '42501' and v_set = '42501' and pg_temp.secretos_caf() = 1, v_caf || '/' || v_set);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja las organizaciones, empresas, CAF ni secretos de prueba
