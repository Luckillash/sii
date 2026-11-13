-- Simulación de la autorización a producción obtenida fuera de Boletéame (migración 0009).
--
-- Criterio (decisión del usuario 2026-11-13): registrar la resolución de PRODUCCIÓN de una
-- empresa equivale a declarar que ya está autorizada. Un administrador que la registra (con
-- `registrar_resolucion` o con un insert directo, siempre con RLS) deja la empresa con
-- `autorizada_produccion = true` y `autorizada_en`; una resolución de certificación no la
-- marca; un lector o un administrador de otra organización no pueden; un authenticated sigue
-- sin poder poner o quitar `autorizada_produccion` a mano; repetir no cambia la fecha y nada
-- la desmarca. 12 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0009 APLICADA (trigger trg_50_resolucion_autoriza_produccion). Sin
-- ella el script corre igual, pero las comprobaciones 4, 5, 6, 7, 9 y 11 salen false (la
-- empresa no queda autorizada).
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase3-empresas.sql): crea usuarios ficticios (@ejemplo.invalid), dos organizaciones,
-- tres empresas y resoluciones de prueba, y al final deshace todo. No llama a pg_net ni a
-- nada con efectos fuera de la base, y no toca Vault.
--
-- Cómo correrlo (con la migración 0009 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación:
--        ok = true   se comportó como se espera
--        ok = false  falló (ver detalle)
--      Si una sale false y el error es del script, se corrige el script; si es del esquema,
--      se reporta (el script no se cambia para que pase).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'autext-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-autorizacion-externa%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa autorizacion externa%') as empresas;
--
-- Cómo se simula una sesión (igual que en las Fases 2 a 5): `request.jwt.claims` local a la
-- transacción (lo leen auth.uid() y auth.role()) + `set local role authenticated` (o
-- `service_role` para el backend). Para volver a `postgres`: `reset role`, con los claims
-- vacíos para que los triggers que miran auth.role() no crean que es un usuario. Los ids que
-- pasan de un paso a otro van en parámetros locales `prueba.*`.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...e1 autext-propietario-a    propietario de la organización A
--   ...e2 autext-administrador-a  administrador de A
--   ...e3 autext-lector-a         lector de A
--   ...f1 autext-propietario-b    propietario de la organización B
-- A pasa al plan Pyme (dos empresas: una por la RPC y otra por insert directo); B queda en
-- Certificación con una empresa.

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

-- Estado de autorización de una empresa, leído sin RLS (security definer), para comparar
-- desde cualquier rol: «true|<autorizada_en>» o «false|-».
create function pg_temp.autorizacion(p_empresa uuid)
returns text
language sql
security definer
as $$
  select coalesce((select autorizada_produccion::text || '|' || coalesce(autorizada_en::text, '-')
                     from public.empresas where id = p_empresa), 'no existe');
$$;
grant execute on function pg_temp.autorizacion(uuid) to authenticated, anon, service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'autext-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'autext-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'autext-lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000000f1', 'autext-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

-- Cada propietario crea su organización.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba autorizacion externa A', 'zz-prueba-autorizacion-externa-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba autorizacion externa B', 'zz-prueba-autorizacion-externa-b')::text, true);

-- El backend sube a A al plan Pyme, da de alta a su equipo y crea las empresas de prueba.
reset role;
select set_config('request.jwt.claims', '', true);
update public.suscripciones
set plan_id = (select id from public.planes where codigo = 'pyme')
where organizacion_id = current_setting('prueba.org_a')::uuid;
insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000e2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000e3', 'lector');

do $$
declare
  v_a1 uuid;
  v_a2 uuid;
  v_b  uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '76543210-3', 'Empresa autorizacion externa A1',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago')
  returning id into v_a1;
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '11111111-1', 'Empresa autorizacion externa A2',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago')
  returning id into v_a2;
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_b')::uuid, '22222222-2', 'Empresa autorizacion externa B',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago')
  returning id into v_b;
  perform set_config('prueba.emp_a1', v_a1::text, true);
  perform set_config('prueba.emp_a2', v_a2::text, true);
  perform set_config('prueba.emp_b', v_b::text, true);
end $$;

select pg_temp.registrar(1, 'preparación: A (Pyme) con propietario, administrador y lector y dos empresas; B con una; ninguna autorizada',
  (select string_agg(m.rol::text, ',' order by m.rol) from public.miembros_organizacion m
    where m.organizacion_id = current_setting('prueba.org_a')::uuid) = 'propietario,administrador,lector'
  and (select count(*) from public.empresas
        where id in (current_setting('prueba.emp_a1')::uuid, current_setting('prueba.emp_a2')::uuid,
                     current_setting('prueba.emp_b')::uuid)
          and not autorizada_produccion and autorizada_en is null) = 3,
  pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid));

-- ---------------------------------------------------------------------------
-- 1. El administrador de A, con registrar_resolucion (empresa A1)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a1')::uuid, 'certificacion', 0, date '2026-11-10');
  perform pg_temp.registrar(2, 'una resolución de certificación vigente no marca la empresa',
    pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = 'false|-',
    pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid));
exception when others then
  perform pg_temp.registrar(2, 'una resolución de certificación vigente no marca la empresa', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  update public.empresas set autorizada_produccion = true where id = current_setting('prueba.emp_a1')::uuid;
  perform pg_temp.registrar(3, 'el administrador no pone autorizada_produccion a mano (tg_proteger_autorizacion)', false, 'se actualizó');
exception when others then
  perform pg_temp.registrar(3, 'el administrador no pone autorizada_produccion a mano (tg_proteger_autorizacion)',
    sqlerrm like 'autorizada_produccion solo la cambia el sistema%'
    and pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = 'false|-',
    sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v uuid;
begin
  v := public.registrar_resolucion(current_setting('prueba.emp_a1')::uuid, 'produccion', 80, date '2014-08-22');
  perform set_config('prueba.res_a1', v::text, true);
  perform set_config('prueba.autorizada_a1', pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid), true);
  perform pg_temp.registrar(4, 'registrar_resolucion de producción (administrador, con RLS) deja la empresa autorizada con fecha',
    current_setting('prueba.autorizada_a1') like 'true|%'
    and current_setting('prueba.autorizada_a1') <> 'true|-',
    current_setting('prueba.autorizada_a1'));
exception when others then
  perform pg_temp.registrar(4, 'registrar_resolucion de producción (administrador, con RLS) deja la empresa autorizada con fecha',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a1')::uuid, 'produccion', 81, date '2015-01-05');
  perform pg_temp.registrar(5, 'idempotente: otra resolución de producción deja la empresa igual (misma autorizada_en) y la anterior en el historial',
    current_setting('prueba.autorizada_a1') like 'true|%'
    and pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = current_setting('prueba.autorizada_a1')
    and (select not vigente from public.resoluciones where id = current_setting('prueba.res_a1')::uuid)
    and (select count(*) from public.resoluciones
          where empresa_id = current_setting('prueba.emp_a1')::uuid and ambiente = 'produccion' and vigente) = 1,
    pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid));
exception when others then
  perform pg_temp.registrar(5, 'idempotente: otra resolución de producción deja la empresa igual (misma autorizada_en) y la anterior en el historial',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v integer;
begin
  -- El administrador deja sin vigencia la resolución de producción (política de edición).
  update public.resoluciones set vigente = false
  where empresa_id = current_setting('prueba.emp_a1')::uuid and ambiente = 'produccion' and vigente;
  get diagnostics v = row_count;
  perform pg_temp.registrar(6, 'nunca desmarca: dejar sin vigencia la resolución de producción no quita la autorización',
    v = 1 and current_setting('prueba.autorizada_a1') like 'true|%'
    and pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = current_setting('prueba.autorizada_a1'),
    v || ' filas; ' || pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid));
exception when others then
  perform pg_temp.registrar(6, 'nunca desmarca: dejar sin vigencia la resolución de producción no quita la autorización',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  update public.empresas set autorizada_produccion = false, autorizada_en = null
  where id = current_setting('prueba.emp_a1')::uuid;
  perform pg_temp.registrar(7, 'el administrador tampoco quita autorizada_produccion a mano', false, 'se actualizó');
exception when others then
  perform pg_temp.registrar(7, 'el administrador tampoco quita autorizada_produccion a mano',
    sqlerrm like 'autorizada_produccion solo la cambia el sistema%'
    and pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = current_setting('prueba.autorizada_a1'),
    sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Empresa A2: el lector no puede; el administrador, con un insert directo (RLS)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_rpc    text := 'no';
  v_insert text := 'no';
begin
  begin
    perform public.registrar_resolucion(current_setting('prueba.emp_a2')::uuid, 'produccion', 90, date '2020-03-01');
  exception when others then
    v_rpc := sqlstate;
  end;
  begin
    insert into public.resoluciones (empresa_id, ambiente, numero, fecha)
    values (current_setting('prueba.emp_a2')::uuid, 'produccion', 90, date '2020-03-01');
  exception when others then
    v_insert := sqlstate;
  end;
  perform pg_temp.registrar(8, 'el lector no registra la resolución de producción (42501 por la RPC y por RLS) y la empresa no queda autorizada',
    v_rpc = '42501' and v_insert = '42501'
    and pg_temp.autorizacion(current_setting('prueba.emp_a2')::uuid) = 'false|-',
    v_rpc || '/' || v_insert || '; ' || pg_temp.autorizacion(current_setting('prueba.emp_a2')::uuid));
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  -- organizacion_id no se pasa: lo hereda trg_00_organizacion desde la empresa.
  insert into public.resoluciones (empresa_id, ambiente, numero, fecha)
  values (current_setting('prueba.emp_a2')::uuid, 'produccion', 90, date '2020-03-01');
  perform pg_temp.registrar(9, 'un insert directo de la resolución de producción (administrador, con RLS) también autoriza la empresa',
    pg_temp.autorizacion(current_setting('prueba.emp_a2')::uuid) like 'true|%'
    and pg_temp.autorizacion(current_setting('prueba.emp_a2')::uuid) <> 'true|-',
    pg_temp.autorizacion(current_setting('prueba.emp_a2')::uuid));
exception when others then
  perform pg_temp.registrar(9, 'un insert directo de la resolución de producción (administrador, con RLS) también autoriza la empresa',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Empresa B: otra organización y el backend
-- ---------------------------------------------------------------------------

do $$
declare
  v_rpc    text := 'no';
  v_insert text := 'no';
begin
  begin
    perform public.registrar_resolucion(current_setting('prueba.emp_b')::uuid, 'produccion', 70, date '2019-05-05');
  exception when others then
    v_rpc := sqlstate;
  end;
  begin
    insert into public.resoluciones (empresa_id, ambiente, numero, fecha)
    values (current_setting('prueba.emp_b')::uuid, 'produccion', 70, date '2019-05-05');
  exception when others then
    v_insert := sqlstate;
  end;
  perform pg_temp.registrar(10, 'el administrador de A no registra resoluciones en la empresa de B (P0002 / 42501) y B no queda autorizada',
    v_rpc = 'P0002' and v_insert = '42501'
    and pg_temp.autorizacion(current_setting('prueba.emp_b')::uuid) = 'false|-',
    v_rpc || '/' || v_insert || '; ' || pg_temp.autorizacion(current_setting('prueba.emp_b')::uuid));
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_b')::uuid, 'certificacion', 0, date '2026-11-12');
  perform public.registrar_resolucion(current_setting('prueba.emp_b')::uuid, 'produccion', 70, date '2019-05-05');
  perform pg_temp.registrar(11, 'service_role (backend) con registrar_resolucion: la de producción autoriza solo a la empresa de B',
    pg_temp.autorizacion(current_setting('prueba.emp_b')::uuid) like 'true|%'
    and pg_temp.autorizacion(current_setting('prueba.emp_b')::uuid) <> 'true|-'
    and pg_temp.autorizacion(current_setting('prueba.emp_a1')::uuid) = current_setting('prueba.autorizada_a1'),
    pg_temp.autorizacion(current_setting('prueba.emp_b')::uuid));
exception when others then
  perform pg_temp.registrar(11, 'service_role (backend) con registrar_resolucion: la de producción autoriza solo a la empresa de B',
    false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 4. Lo que ve la app: el proceso de certificación no se toca
-- ---------------------------------------------------------------------------

select pg_temp.registrar(12, 'el trigger no crea ni mueve procesos de certificación (la app distingue la autorización externa por la etapa)',
  not exists (select 1 from public.procesos_certificacion
               where empresa_id in (current_setting('prueba.emp_a1')::uuid, current_setting('prueba.emp_a2')::uuid,
                                    current_setting('prueba.emp_b')::uuid)),
  null);

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja los usuarios, organizaciones, empresas ni resoluciones de prueba
