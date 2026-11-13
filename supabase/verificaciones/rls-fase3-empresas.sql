-- Simulación de roles de la Fase 3: empresas, certificados y resoluciones.
--
-- Criterio de la Fase 3 (PLAN-SAAS): solo los administradores configuran la empresa
-- (empresas, resoluciones, certificados asociados); el .pfx y su clave van a Vault por
-- `registrar_certificado` (solo service_role) y no quedan secretos huérfanos ni al fallar
-- ni al borrar el certificado; nadie ve los certificados de otra organización.
--
-- REQUIERE LA MIGRACIÓN 0005 APLICADA (registrar_certificado, fijar_certificado_predeterminado,
-- registrar_resolucion). Sin ella el script se detiene a la mitad con «function ... does
-- not exist» (42883) y la transacción se descarta completa: no hay resultados que leer.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase2-tenancy.sql): crea usuarios ficticios (@ejemplo.invalid), dos organizaciones,
-- empresas, resoluciones, certificados de prueba (con secretos de prueba en Vault) y al
-- final deshace todo, también los secretos. No llama a pg_net ni a nada con efectos fuera de
-- la base. No lee el contenido de ningún secreto: de `vault.secrets` solo cuenta filas y mira
-- ids y descripciones.
--
-- Cómo correrlo (con la migración 0005 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación:
--        ok = true   se comportó como se espera
--        ok = false  falló (ver detalle)
--      Si una sale false y el error es del script, se corrige el script; si es del esquema,
--      se reporta (el script no se cambia para que pase).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like '%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-rls-fase3%') as organizaciones,
--          (select count(*) from public.certificados where huella_sha256 in (repeat('a', 64), repeat('b', 64))) as certificados,
--          (select count(*) from vault.secrets where description like 'certificado:' || repeat('a', 64) || '%'
--                                                 or description like 'certificado:' || repeat('b', 64) || '%') as secretos;
--
-- Cómo se simula una sesión (igual que en la Fase 2): `request.jwt.claims` local a la
-- transacción (lo leen auth.uid() y auth.role()) + `set local role authenticated` (o `anon`,
-- o `service_role` para el backend). Para volver a `postgres`: `reset role`. Antes de las
-- acciones «del backend» como `postgres` se vacían los claims, para que los triggers que
-- miran auth.role() no crean que es un usuario. Los ids que pasan de un paso a otro van en
-- parámetros locales `prueba.*` (set_config(..., true)).
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...a1 propietario-a    propietario de la organización A
--   ...a2 administrador-a  administrador de A
--   ...a3 emisor-a         emisor de A
--   ...a4 lector-a         lector de A
--   ...b1 propietario-b    propietario de la organización B
-- A pasa al plan Pyme (5 usuarios, 3 empresas) y su equipo se da de alta directo, como lo
-- haría el backend (las invitaciones ya las prueba la Fase 2). B queda en Certificación
-- (1 empresa), para probar tg_limite_empresas.

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

-- Valores de prueba del «.pfx» y su clave: se buscan en los mensajes de error para
-- comprobar que nunca aparecen.
select set_config('prueba.pfx', 'UFJVRUJBLVBGWC1GQVNFMw==', true);
select set_config('prueba.clave', 'clave-secreta-fase3', true);
select set_config('prueba.errores', '', true);

-- Anota el texto completo de un error (mensaje, detalle, pista y contexto) para la
-- comprobación de que ningún error de registrar_certificado arrastra la clave o el base64.
create function pg_temp.anotar_error(p_texto text)
returns void
language sql
as $$
  select set_config('prueba.errores', current_setting('prueba.errores', true) || ' | ' || coalesce(p_texto, ''), true);
$$;
grant execute on function pg_temp.anotar_error(text) to authenticated, anon, service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-0000000000a4', 'lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

-- Cada propietario crea su organización.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba RLS Fase 3 A', 'zz-prueba-rls-fase3-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba RLS Fase 3 B', 'zz-prueba-rls-fase3-b')::text, true);

-- El backend sube a A al plan Pyme y da de alta a su equipo.
reset role;
select set_config('request.jwt.claims', '', true);
update public.suscripciones
set plan_id = (select id from public.planes where codigo = 'pyme')
where organizacion_id = current_setting('prueba.org_a')::uuid;
insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000a2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000a3', 'emisor'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000a4', 'lector');

select pg_temp.registrar(1, 'preparación: A (Pyme) con propietario, administrador, emisor y lector; B (Certificación) con su propietario',
  (select string_agg(m.rol::text, ',' order by m.rol) from public.miembros_organizacion m
    where m.organizacion_id = current_setting('prueba.org_a')::uuid) = 'propietario,administrador,emisor,lector'
  and (select p.codigo from public.suscripciones s join public.planes p on p.id = s.plan_id
        where s.organizacion_id = current_setting('prueba.org_b')::uuid) = 'certificacion',
  (select count(*) from public.perfiles where correo like '%@ejemplo.invalid') || ' perfiles');

-- ---------------------------------------------------------------------------
-- 1. Empresas: crear, editar, límite del plan y autorizada_produccion
-- ---------------------------------------------------------------------------

-- B crea su empresa (y choca con el tope de 1 empresa del plan Certificación).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_b')::uuid, '11111111-1', 'Empresa de prueba B', 'Servicios de prueba',
          'Avenida Siempre Viva 742', 'Providencia')
  returning id into v;
  perform set_config('prueba.emp_b', v::text, true);

  begin
    insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
    values (current_setting('prueba.org_b')::uuid, '66666666-6', 'Segunda empresa B', 'Servicios de prueba',
            'Avenida Siempre Viva 742', 'Providencia');
    perform pg_temp.registrar(2, 'tg_limite_empresas: Certificación no deja pasar de 1 empresa', false, 'se creó la segunda');
  exception when raise_exception then
    perform pg_temp.registrar(2, 'tg_limite_empresas: Certificación no deja pasar de 1 empresa',
                              sqlerrm like 'El plan % permite como máximo 1 empresa(s)', sqlerrm);
  end;
end $$;

-- El administrador de A.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v uuid;
  v_org uuid;
  v_autorizada boolean;
  v_filas integer;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna, autorizada_produccion)
  values (current_setting('prueba.org_a')::uuid, '76543210-3', 'Empresa de prueba A', 'Venta de artículos de prueba',
          'Calle Falsa 123', 'Santiago', true)
  returning id, organizacion_id, autorizada_produccion into v, v_org, v_autorizada;
  perform set_config('prueba.emp_a', v::text, true);
  perform pg_temp.registrar(3, 'el administrador de A crea una empresa en A', v_org = current_setting('prueba.org_a')::uuid, null);
  perform pg_temp.registrar(4, 'autorizada_produccion se fuerza a false al crear la empresa', not v_autorizada,
                            'autorizada_produccion = ' || v_autorizada);

  update public.empresas set razon_social = 'Empresa de prueba A editada', comuna = 'Ñuñoa' where id = v;
  get diagnostics v_filas = row_count;
  perform pg_temp.registrar(5, 'el administrador de A edita la empresa de A', v_filas = 1, v_filas || ' filas editadas');
exception when others then
  perform pg_temp.registrar(3, 'el administrador de A crea una empresa en A', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_b')::uuid, '66666666-6', 'Intrusa en B', 'Servicios de prueba', 'Calle 1', 'Santiago');
  perform pg_temp.registrar(6, 'el administrador de A no crea empresas en B', false, 'se creó en B');
exception when insufficient_privilege then
  perform pg_temp.registrar(6, 'el administrador de A no crea empresas en B', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v integer;
begin
  update public.empresas set razon_social = 'Editada por A' where id = current_setting('prueba.emp_b')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(7, 'el administrador de A no edita la empresa de B', v = 0, v || ' filas editadas');
end $$;

do $$
begin
  update public.empresas set autorizada_produccion = true where id = current_setting('prueba.emp_a')::uuid;
  perform pg_temp.registrar(8, 'un usuario (administrador) no cambia autorizada_produccion', false, 'la cambió');
exception when raise_exception then
  perform pg_temp.registrar(8, 'un usuario (administrador) no cambia autorizada_produccion',
    sqlerrm like 'autorizada_produccion solo la cambia el sistema%', sqlerrm);
end $$;

-- El emisor y el lector de A no crean ni editan empresas.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v integer;
begin
  begin
    insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
    values (current_setting('prueba.org_a')::uuid, '66666666-6', 'Empresa del emisor', 'Servicios de prueba', 'Calle 1', 'Santiago');
    perform pg_temp.registrar(9, 'un emisor no crea empresas', false, 'el emisor creó una empresa');
  exception when insufficient_privilege then
    perform pg_temp.registrar(9, 'un emisor no crea empresas', true, sqlstate || ' ' || sqlerrm);
  end;
  update public.empresas set razon_social = 'Editada por el emisor' where id = current_setting('prueba.emp_a')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(10, 'un emisor no edita empresas', v = 0, v || ' filas editadas');
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v integer;
begin
  begin
    insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
    values (current_setting('prueba.org_a')::uuid, '66666666-6', 'Empresa del lector', 'Servicios de prueba', 'Calle 1', 'Santiago');
    perform pg_temp.registrar(11, 'un lector no crea empresas', false, 'el lector creó una empresa');
  exception when insufficient_privilege then
    perform pg_temp.registrar(11, 'un lector no crea empresas', true, sqlstate || ' ' || sqlerrm);
  end;
  update public.empresas set razon_social = 'Editada por el lector' where id = current_setting('prueba.emp_a')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(12, 'un lector no edita empresas (pero la ve)',
    v = 0 and (select count(*) from public.empresas where id = current_setting('prueba.emp_a')::uuid) = 1,
    v || ' filas editadas');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Resoluciones (registrar_resolucion)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_r1 uuid;
  v_r2 uuid;
  v_rp uuid;
  v_org uuid;
begin
  v_r1 := public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-01');
  select organizacion_id into v_org from public.resoluciones where id = v_r1;
  perform pg_temp.registrar(13, 'registrar_resolucion (administrador) crea la vigente y hereda organizacion_id de la empresa',
    v_org = current_setting('prueba.org_a')::uuid
      and (select vigente from public.resoluciones where id = v_r1),
    'organizacion_id = ' || coalesce(v_org::text, 'null'));

  v_r2 := public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-10');
  perform set_config('prueba.res_cert', v_r2::text, true);
  perform pg_temp.registrar(14, 'registrar_resolucion reemplaza la vigente: una sola vigente por empresa y ambiente (la nueva)',
    (select count(*) from public.resoluciones
      where empresa_id = current_setting('prueba.emp_a')::uuid and ambiente = 'certificacion' and vigente) = 1
    and (select vigente from public.resoluciones where id = v_r2)
    and not (select vigente from public.resoluciones where id = v_r1),
    (select string_agg(fecha || ' vigente=' || vigente, ', ' order by fecha) from public.resoluciones
      where empresa_id = current_setting('prueba.emp_a')::uuid and ambiente = 'certificacion'));

  v_rp := public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'produccion', 80, '2014-08-22');
  perform set_config('prueba.res_prod', v_rp::text, true);
  perform pg_temp.registrar(15, 'la resolución de producción (número ≠ 0) no toca la vigente de certificación',
    (select vigente from public.resoluciones where id = v_rp)
    and (select vigente from public.resoluciones where id = v_r2),
    null);
exception when others then
  perform pg_temp.registrar(13, 'registrar_resolucion (administrador) crea la vigente y hereda organizacion_id de la empresa',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 5, '2026-11-11');
  perform pg_temp.registrar(16, 'registrar_resolucion rechaza número ≠ 0 en certificación', false, 'la aceptó');
exception when check_violation then
  perform pg_temp.registrar(16, 'registrar_resolucion rechaza número ≠ 0 en certificación', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(16, 'registrar_resolucion rechaza número ≠ 0 en certificación', false, sqlstate || ' ' || sqlerrm);
end $$;

-- El emisor y el lector de A no registran resoluciones.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-12');
  perform pg_temp.registrar(17, 'un emisor no registra resoluciones', false, 'la registró');
exception when insufficient_privilege then
  perform pg_temp.registrar(17, 'un emisor no registra resoluciones', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(17, 'un emisor no registra resoluciones', false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-12');
  perform pg_temp.registrar(18, 'un lector no registra resoluciones', false, 'la registró');
exception when insufficient_privilege then
  perform pg_temp.registrar(18, 'un lector no registra resoluciones', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(18, 'un lector no registra resoluciones', false, sqlstate || ' ' || sqlerrm);
end $$;

-- El propietario de B (administrador en su organización) no ve la empresa de A.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-12');
  perform pg_temp.registrar(19, 'un administrador de otra organización no registra resoluciones (la empresa no existe para él)', false, 'la registró');
exception when no_data_found then
  perform pg_temp.registrar(19, 'un administrador de otra organización no registra resoluciones (la empresa no existe para él)', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(19, 'un administrador de otra organización no registra resoluciones (la empresa no existe para él)', false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(20, 'tras los intentos fallidos sigue una vigente por ambiente (las mismas)',
  string_agg(id::text, ',' order by ambiente) = current_setting('prueba.res_cert') || ',' || current_setting('prueba.res_prod'),
  count(*) || ' vigentes')
from public.resoluciones
where empresa_id = current_setting('prueba.emp_a')::uuid and vigente;

-- ---------------------------------------------------------------------------
-- 3. Certificados (registrar_certificado, solo service_role)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_antes   bigint;
  v_despues bigint;
  v_id      uuid;
  v_pfx     uuid;
  v_clave   uuid;
  v_descs   text;
begin
  select count(*) into v_antes from vault.secrets;
  v_id := public.registrar_certificado(
    current_setting('prueba.org_a')::uuid, '11111111-1', 'Titular de prueba A', 'TITULAR DE PRUEBA A',
    'CA de prueba', now() - interval '1 year', now() + interval '20 days', repeat('a', 64),
    current_setting('prueba.pfx'), current_setting('prueba.clave'), false,
    '00000000-0000-4000-8000-0000000000a2');
  select count(*) into v_despues from vault.secrets;
  select pfx_secret_id, clave_secret_id into v_pfx, v_clave from public.certificados where id = v_id;
  select string_agg(description, ', ' order by description) into v_descs
  from vault.secrets where id in (v_pfx, v_clave);
  perform set_config('prueba.cert_1', v_id::text, true);
  perform pg_temp.registrar(21, 'registrar_certificado (service_role) crea la fila y 2 secretos en Vault con descripciones sin datos sensibles',
    v_despues = v_antes + 2
      and v_pfx <> v_clave
      and v_descs = 'certificado:' || repeat('a', 64) || ':clave, certificado:' || repeat('a', 64) || ':pfx',
    format('secretos %s → %s; descripciones: %s', v_antes, v_despues, v_descs));

  -- Segundo certificado de A (vigente un año) y uno de B con la MISMA huella que el primero
  -- de A: la huella es única por organización, no global.
  v_id := public.registrar_certificado(
    current_setting('prueba.org_a')::uuid, '11111111-1', 'Titular de prueba A', 'TITULAR DE PRUEBA A',
    'CA de prueba', now() - interval '1 day', now() + interval '1 year', repeat('b', 64),
    current_setting('prueba.pfx'), current_setting('prueba.clave'), true, null);
  perform set_config('prueba.cert_2', v_id::text, true);
  v_id := public.registrar_certificado(
    current_setting('prueba.org_b')::uuid, '66666666-6', 'Titular de prueba B', 'TITULAR DE PRUEBA B',
    'CA de prueba', now() - interval '1 day', now() + interval '1 year', repeat('a', 64),
    current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
  perform set_config('prueba.cert_b', v_id::text, true);
  perform pg_temp.registrar(22, 'la misma huella se puede registrar en otra organización',
    (select organizacion_id from public.certificados where id = v_id) = current_setting('prueba.org_b')::uuid, null);
exception when others then
  perform pg_temp.registrar(21, 'registrar_certificado (service_role) crea la fila y 2 secretos en Vault con descripciones sin datos sensibles',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_antes   bigint;
  v_despues bigint;
  v_filas   bigint;
  v_msg text; v_det text; v_hint text; v_ctx text;
begin
  select count(*) into v_antes from vault.secrets;
  select count(*) into v_filas from public.certificados where organizacion_id = current_setting('prueba.org_a')::uuid;
  begin
    perform public.registrar_certificado(
      current_setting('prueba.org_a')::uuid, '11111111-1', 'Titular de prueba A', 'TITULAR DE PRUEBA A',
      'CA de prueba', now(), now() + interval '1 year', repeat('a', 64),
      current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
    perform pg_temp.registrar(23, 'huella repetida en la organización: 23505 y ningún secreto nuevo', false, 'se registró dos veces');
  exception when unique_violation then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail,
                            v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    perform pg_temp.anotar_error(concat_ws(' / ', v_msg, v_det, v_hint, v_ctx));
    select count(*) into v_despues from vault.secrets;
    perform pg_temp.registrar(23, 'huella repetida en la organización: 23505 y ningún secreto nuevo',
      v_despues = v_antes
        and (select count(*) from public.certificados where organizacion_id = current_setting('prueba.org_a')::uuid) = v_filas
        and v_msg = 'El certificado ya está registrado en la organización',
      format('secretos %s → %s; %s', v_antes, v_despues, v_msg));
  end;

  begin
    perform public.registrar_certificado(
      current_setting('prueba.org_a')::uuid, '11111111-1', null, null, null, null, null, 'no-es-una-huella',
      current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
    perform pg_temp.registrar(24, 'huella inválida: 22023 y ningún secreto nuevo', false, 'la aceptó');
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail,
                            v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    perform pg_temp.anotar_error(concat_ws(' / ', v_msg, v_det, v_hint, v_ctx));
    select count(*) into v_despues from vault.secrets;
    perform pg_temp.registrar(24, 'huella inválida: 22023 y ningún secreto nuevo', v_despues = v_antes,
      format('secretos %s → %s; %s', v_antes, v_despues, v_msg));
  end;

  begin
    perform public.registrar_certificado(
      '00000000-0000-4000-8000-00000000dead', '11111111-1', null, null, null, null, null, repeat('c', 64),
      current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
    perform pg_temp.registrar(25, 'organización inexistente: 23503', false, 'la aceptó');
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail,
                            v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    perform pg_temp.anotar_error(concat_ws(' / ', v_msg, v_det, v_hint, v_ctx));
    perform pg_temp.registrar(25, 'organización inexistente: 23503', v_msg = 'La organización no existe', v_msg);
  end;

  begin
    perform public.registrar_certificado(
      current_setting('prueba.org_a')::uuid, '11111111-2', null, null, null, null, null, repeat('c', 64),
      current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
    perform pg_temp.registrar(26, 'RUT del titular inválido: 22023', false, 'lo aceptó');
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail,
                            v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    perform pg_temp.anotar_error(concat_ws(' / ', v_msg, v_det, v_hint, v_ctx));
    perform pg_temp.registrar(26, 'RUT del titular inválido: 22023', true, v_msg);
  end;
end $$;

select pg_temp.registrar(27, 'ningún error de registrar_certificado contiene la clave ni el base64 del .pfx',
  current_setting('prueba.errores') <> ''
    and position(current_setting('prueba.clave') in current_setting('prueba.errores')) = 0
    and position(current_setting('prueba.pfx') in current_setting('prueba.errores')) = 0,
  left(current_setting('prueba.errores'), 500));

-- authenticated (aunque sea propietario) no ejecuta registrar_certificado ni escribe en certificados.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.registrar_certificado(
    current_setting('prueba.org_a')::uuid, '11111111-1', null, null, null, null, null, repeat('d', 64),
    current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
  perform pg_temp.registrar(28, 'authenticated no ejecuta registrar_certificado', false, 'la ejecutó');
exception when insufficient_privilege then
  perform pg_temp.registrar(28, 'authenticated no ejecuta registrar_certificado',
    sqlerrm like 'permission denied for function%', sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.certificados (organizacion_id, rut_titular, huella_sha256, pfx_secret_id, clave_secret_id)
  values (current_setting('prueba.org_a')::uuid, '11111111-1', repeat('d', 64), gen_random_uuid(), gen_random_uuid());
  perform pg_temp.registrar(29, 'authenticated no inserta en certificados directamente', false, 'insertó');
exception when insufficient_privilege then
  perform pg_temp.registrar(29, 'authenticated no inserta en certificados directamente', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(29, 'authenticated no inserta en certificados directamente', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_editados integer;
  v_borrados integer;
begin
  update public.certificados set revocado_en = now() where id = current_setting('prueba.cert_1')::uuid;
  get diagnostics v_editados = row_count;
  delete from public.certificados where id = current_setting('prueba.cert_1')::uuid;
  get diagnostics v_borrados = row_count;
  perform pg_temp.registrar(30, 'authenticated (propietario) ve el certificado pero no lo edita ni lo borra',
    v_editados = 0 and v_borrados = 0
      and (select count(*) from public.certificados where id = current_setting('prueba.cert_1')::uuid) = 1,
    format('editados %s, borrados %s', v_editados, v_borrados));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Certificado predeterminado (fijar_certificado_predeterminado)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  insert into public.empresa_certificados (empresa_id, certificado_id, es_representante_electronico) values
    (current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid, true),
    (current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_2')::uuid, false);
  perform pg_temp.registrar(31, 'el administrador asocia dos certificados de A a la empresa de A (organizacion_id heredado)',
    (select count(*) from public.empresa_certificados
      where empresa_id = current_setting('prueba.emp_a')::uuid
        and organizacion_id = current_setting('prueba.org_a')::uuid) = 2, null);

  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid);
  perform pg_temp.registrar(32, 'fijar_certificado_predeterminado deja uno solo predeterminado (el indicado)',
    (select string_agg(certificado_id::text, ',') from public.empresa_certificados
      where empresa_id = current_setting('prueba.emp_a')::uuid and predeterminado) = current_setting('prueba.cert_1'),
    null);

  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_2')::uuid);
  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_2')::uuid);
  perform pg_temp.registrar(33, 'cambiar el predeterminado (y repetirlo) respeta el índice único: queda solo el nuevo',
    (select string_agg(certificado_id::text, ',') from public.empresa_certificados
      where empresa_id = current_setting('prueba.emp_a')::uuid and predeterminado) = current_setting('prueba.cert_2'),
    null);
exception when others then
  perform pg_temp.registrar(31, 'el administrador asocia dos certificados de A a la empresa de A (organizacion_id heredado)',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.empresa_certificados (empresa_id, certificado_id)
  values (current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_b')::uuid);
  perform pg_temp.registrar(34, 'no se asocia un certificado de B a una empresa de A', false, 'se asoció');
exception when foreign_key_violation or insufficient_privilege then
  perform pg_temp.registrar(34, 'no se asocia un certificado de B a una empresa de A', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_b')::uuid);
  perform pg_temp.registrar(35, 'fijar_certificado_predeterminado con un certificado no asociado: P0002', false, 'lo fijó');
exception when no_data_found then
  perform pg_temp.registrar(35, 'fijar_certificado_predeterminado con un certificado no asociado: P0002', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(35, 'fijar_certificado_predeterminado con un certificado no asociado: P0002', false, sqlstate || ' ' || sqlerrm);
end $$;

-- El emisor y el lector de A no lo cambian.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid);
  perform pg_temp.registrar(36, 'un emisor no cambia el certificado predeterminado', false, 'lo cambió');
exception when insufficient_privilege then
  perform pg_temp.registrar(36, 'un emisor no cambia el certificado predeterminado', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(36, 'un emisor no cambia el certificado predeterminado', false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid);
  perform pg_temp.registrar(37, 'un lector no cambia el certificado predeterminado', false, 'lo cambió');
exception when insufficient_privilege then
  perform pg_temp.registrar(37, 'un lector no cambia el certificado predeterminado', true, sqlstate || ' ' || sqlerrm);
when others then
  perform pg_temp.registrar(37, 'un lector no cambia el certificado predeterminado', false, sqlstate || ' ' || sqlerrm);
end $$;

-- Entre organizaciones: B no ve la asociación de A, ni puede fijar en su empresa un certificado ajeno.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid);
    perform pg_temp.registrar(38, 'fijar_certificado_predeterminado no funciona entre organizaciones (P0002)', false, 'B lo cambió en A');
  exception when no_data_found then
    begin
      perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_b')::uuid, current_setting('prueba.cert_1')::uuid);
      perform pg_temp.registrar(38, 'fijar_certificado_predeterminado no funciona entre organizaciones (P0002)', false, 'B fijó un certificado de A');
    exception when no_data_found then
      perform pg_temp.registrar(38, 'fijar_certificado_predeterminado no funciona entre organizaciones (P0002)', true, sqlstate || ' ' || sqlerrm);
    end;
  end;
exception when others then
  perform pg_temp.registrar(38, 'fijar_certificado_predeterminado no funciona entre organizaciones (P0002)', false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(39, 'tras los intentos fallidos el predeterminado de A sigue siendo el mismo',
  string_agg(certificado_id::text, ',') = current_setting('prueba.cert_2'), count(*) || ' predeterminado(s)')
from public.empresa_certificados
where empresa_id = current_setting('prueba.emp_a')::uuid and predeterminado;

-- ---------------------------------------------------------------------------
-- 5. anon no ejecuta ninguna de las tres
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
-- Se exige «permission denied for function»: el 42501 propio de las funciones (o el de las
-- tablas, que anon tampoco lee) no prueba que falte el EXECUTE.
do $$
declare
  v_negadas  integer := 0;
  v_mensajes text := '';
begin
  begin
    perform public.registrar_resolucion(current_setting('prueba.emp_a')::uuid, 'certificacion', 0, '2026-11-12');
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform public.fijar_certificado_predeterminado(current_setting('prueba.emp_a')::uuid, current_setting('prueba.cert_1')::uuid);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform public.registrar_certificado(
      current_setting('prueba.org_a')::uuid, '11111111-1', null, null, null, null, null, repeat('e', 64),
      current_setting('prueba.pfx'), current_setting('prueba.clave'), false, null);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  perform pg_temp.registrar(40, 'anon no ejecuta registrar_resolucion, fijar_certificado_predeterminado ni registrar_certificado',
    v_negadas = 3, v_negadas || ' de 3 sin EXECUTE: ' || v_mensajes);
exception when others then
  perform pg_temp.registrar(40, 'anon no ejecuta registrar_resolucion, fijar_certificado_predeterminado ni registrar_certificado',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Borrar un certificado borra sus 2 secretos (trg_borrar_secretos)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_pfx    uuid;
  v_clave  uuid;
  v_antes  bigint;
  v_quedan bigint;
begin
  select pfx_secret_id, clave_secret_id into v_pfx, v_clave
  from public.certificados where id = current_setting('prueba.cert_2')::uuid;
  select count(*) into v_antes from vault.secrets where id in (v_pfx, v_clave);
  delete from public.certificados where id = current_setting('prueba.cert_2')::uuid;
  select count(*) into v_quedan from vault.secrets where id in (v_pfx, v_clave);
  perform pg_temp.registrar(41, 'borrar el certificado (backend) borra sus 2 secretos de Vault y su asociación',
    v_antes = 2 and v_quedan = 0
      and (select count(*) from public.empresa_certificados
            where certificado_id = current_setting('prueba.cert_2')::uuid) = 0,
    format('secretos del certificado: %s → %s', v_antes, v_quedan));
exception when others then
  perform pg_temp.registrar(41, 'borrar el certificado (backend) borra sus 2 secretos de Vault y su asociación',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 7. v_certificados_estado: cada organización ve solo los suyos
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(42, 'el lector de A ve v_certificados_estado de A (por vencer a 20 días) y nada de B',
  (select count(*) from public.v_certificados_estado) = 1
    and (select estado from public.v_certificados_estado where id = current_setting('prueba.cert_1')::uuid) = 'por_vencer'
    and (select count(*) from public.v_certificados_estado
          where organizacion_id = current_setting('prueba.org_b')::uuid) = 0,
  (select string_agg(estado || ' ' || dias_restantes || ' días', ', ') from public.v_certificados_estado));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(43, 'B ve solo su certificado en v_certificados_estado (y ninguna resolución ni asociación de A)',
  (select count(*) from public.v_certificados_estado) = 1
    and (select count(*) from public.v_certificados_estado where id = current_setting('prueba.cert_b')::uuid) = 1
    and (select count(*) from public.resoluciones where organizacion_id = current_setting('prueba.org_a')::uuid) = 0
    and (select count(*) from public.empresa_certificados where organizacion_id = current_setting('prueba.org_a')::uuid) = 0,
  (select count(*) from public.v_certificados_estado) || ' certificado(s) visibles');

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

reset role;
select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones, certificados ni secretos de prueba
