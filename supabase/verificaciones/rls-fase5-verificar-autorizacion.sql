-- Simulación de la operación verificar_autorizacion (migración 0010).
--
-- Criterio: el backend (service_role) registra la consulta de autorización en
-- `operaciones_sii` con `operacion = 'verificar_autorizacion'` y `ambiente = 'produccion'`,
-- en curso y después terminada; como es de lectura (no está en OPERACIONES_EFECTO_GLOBAL),
-- dos simultáneas de la misma empresa no chocan con el índice único de la 0007, que sigue
-- frenando las de efecto global; un miembro de la organización la lee y no la escribe. 7
-- comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0010 APLICADA. Sin ella el script corre igual, pero las
-- comprobaciones 2, 3, 5 y 6 salen false (el valor del enum no existe).
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase5-certificacion.sql): crea un usuario ficticio (@ejemplo.invalid), una
-- organización, una empresa y filas de operaciones_sii de prueba, y al final deshace todo.
-- No llama a pg_net ni a nada con efectos fuera de la base, y no toca Vault.
--
-- Cómo correrlo (con la migración 0010 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true se
--      comportó como se espera; false: ver detalle).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'veraut-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-verificar-autorizacion%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa verificar autorizacion%') as empresas;
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 5): `request.jwt.claims` local a la
-- transacción + `set local role service_role | authenticated`; `reset role` vuelve a
-- postgres. Los ids que pasan de un paso a otro van en parámetros locales `prueba.*`.

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

do $$
declare
  v_usuario uuid := '00000000-0000-4000-8000-0000000010e1';
  v_org     uuid;
  v_emp     uuid;
begin
  insert into auth.users (id, email, aud, role)
  values (v_usuario, 'veraut-propietario@ejemplo.invalid', 'authenticated', 'authenticated');
  insert into public.organizaciones (nombre, slug)
  values ('Prueba verificar autorización', 'zz-prueba-verificar-autorizacion')
  returning id into v_org;
  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
  values (v_org, v_usuario, 'propietario');
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (v_org, '11111111-1', 'Empresa verificar autorizacion', 'Servicios de prueba',
          'Calle Falsa 123', 'Santiago')
  returning id into v_emp;
  perform set_config('prueba.usuario', v_usuario::text, true);
  perform set_config('prueba.org', v_org::text, true);
  perform set_config('prueba.emp', v_emp::text, true);
end $$;

select pg_temp.registrar(1, 'preparación: usuario propietario, organización y empresa de prueba',
  (select count(*) from public.empresas where id = current_setting('prueba.emp')::uuid) = 1);

-- ---------------------------------------------------------------------------
-- 1. Backend (service_role): dos verificaciones en curso a la vez, y se cierran
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_a      uuid;
  v_b      uuid;
  v_estado text := 'ok';
begin
  begin
    insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
    values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
            'verificar_autorizacion', 'produccion', true)
    returning id into v_a;
    insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
    values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
            'verificar_autorizacion', 'produccion', true)
    returning id into v_b;
    perform set_config('prueba.op', v_a::text, true);
  exception when others then
    v_estado := sqlstate;
  end;
  perform pg_temp.registrar(2, 'service_role registra verificar_autorizacion confirmada en producción',
    v_a is not null, v_estado);
  perform pg_temp.registrar(3, 'dos verificar_autorizacion en curso de la misma empresa y ambiente no chocan (no es de efecto global)',
    v_b is not null, v_estado);
end $$;

do $$
declare
  v_estado text := 'no';
begin
  insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
  values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
          'solicitar_folios', 'produccion', true);
  begin
    insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
    values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
            'solicitar_folios', 'produccion', true);
  exception when unique_violation then
    v_estado := '23505';
  end;
  perform pg_temp.registrar(4, 'control: el índice de la 0007 sigue frenando una segunda solicitar_folios en curso (23505)',
    v_estado = '23505', v_estado);
end $$;

do $$
declare
  v_filas integer := 0;
  v_estado text := 'ok';
begin
  begin
    update public.operaciones_sii
    set resultado = 'ok',
        terminada_en = now(),
        mensaje = 'El SII confirma que la empresa está autorizada',
        detalle = jsonb_build_object('respuesta', 'autorizada', 'nro_resol', 80,
                                     'fch_resol', '2014-08-22', 'fecha_autorizacion', '2026-11-06',
                                     'stc', 'boleta', 'stc_ultimo_anio', 2026)
    where id = nullif(current_setting('prueba.op', true), '')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_estado := sqlstate;
  end;
  perform pg_temp.registrar(5, 'service_role la cierra en ok con terminada_en y el detalle de la consulta',
    v_filas = 1, v_estado);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 2. Miembro (authenticated): la lee, no la escribe
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('prueba.usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;

select pg_temp.registrar(6, 'el propietario ve las verificar_autorizacion de su organización',
  (select count(*) from public.operaciones_sii where operacion::text = 'verificar_autorizacion') = 2,
  (select count(*) || ' visibles' from public.operaciones_sii where operacion::text = 'verificar_autorizacion'));

do $$
declare
  v_estado text := 'insertó';
begin
  begin
    insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
    values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
            'verificar_autorizacion', 'produccion', true);
  exception when others then
    v_estado := sqlstate;
  end;
  perform pg_temp.registrar(7, 'un authenticated no inserta en operaciones_sii (solo el backend escribe)',
    v_estado <> 'insertó', v_estado);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja el usuario, la organización, la empresa ni las operaciones de prueba
