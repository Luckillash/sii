-- Simulación de roles de la Fase 2: tenancy, roles e invitaciones.
--
-- Criterio de aceptación de la Fase 2 (PLAN-SAAS): dos usuarios de organizaciones
-- distintas no ven datos del otro, y un lector no puede crear borradores.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK: crea usuarios ficticios
-- (@ejemplo.invalid), dos organizaciones, invitaciones, empresas y borradores, y al final
-- deshace todo. No llama a pg_net ni a nada con efectos fuera de la base. Se ejecuta
-- completo, tal cual, en el SQL Editor o con el MCP `execute_sql` (como `postgres`).
-- Nunca cambiar el `rollback` final por `commit`.
--
-- Resultado: el `select` antes del `rollback` devuelve una fila por comprobación.
--   ok = true   se comportó como se espera
--   ok = false  falló (ver detalle)
--   ok = null   omitida (p. ej. ver_invitacion antes de aplicar la migración 0003)
--
-- Cómo se simula una sesión: `request.jwt.claims` local a la transacción (lo que leen
-- auth.uid() y auth.role()) + `set local role authenticated` (o `anon`). Para volver a
-- `postgres` se usa `reset role`. Los ids que se pasan entre pasos (organizaciones,
-- empresas, tokens) van en parámetros locales `prueba.*` (set_config(..., true)).
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...a1 propietario-a  propietario de la organización A
--   ...a2 administrador-a  administrador de A (por invitación)
--   ...a3 emisor-a  emisor de A (por invitación)
--   ...a4 lector-a  lector de A (por invitación)
--   ...a5 vencida-a  tiene cuenta, pero su invitación vence antes de aceptarla; luego se
--                    reabre y choca con la organización morosa (sección 11)
--   ...b1 propietario-b  propietario de la organización B
--   pendiente-a6@ejemplo.invalid  solo invitado (sin cuenta)

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
grant select, insert on resultados to authenticated, anon;

create function pg_temp.registrar(p_n integer, p_verificacion text, p_ok boolean, p_detalle text default null)
returns void
language sql
as $$
  insert into resultados (n, verificacion, ok, detalle) values (p_n, p_verificacion, p_ok, p_detalle);
$$;
grant execute on function pg_temp.registrar(integer, text, boolean, text) to authenticated, anon;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-0000000000a4', 'lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000000a5', 'vencida-a@ejemplo.invalid',       'authenticated', 'authenticated', '{"nombre":"Vencida A"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

select pg_temp.registrar(1, 'trg_nuevo_usuario crea el perfil de cada usuario nuevo',
  count(*) = 6, count(*) || ' perfiles')
from public.perfiles where correo like '%@ejemplo.invalid';

-- ---------------------------------------------------------------------------
-- 1. Cada propietario crea su organización
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba RLS Fase 2 A', 'zz-prueba-rls-fase2-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba RLS Fase 2 B', 'zz-prueba-rls-fase2-b')::text, true);

reset role;
select pg_temp.registrar(2, 'crear_organizacion deja al creador como propietario',
  count(*) = 2, string_agg(m.rol::text, ', '))
from public.miembros_organizacion m
where (m.organizacion_id, m.usuario_id) in (
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid),
  (current_setting('prueba.org_b')::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid))
  and m.rol = 'propietario';

select pg_temp.registrar(3, 'crear_organizacion suscribe al plan Certificación en prueba',
  count(*) = 2, string_agg(p.codigo || '/' || s.estado, ', '))
from public.suscripciones s join public.planes p on p.id = s.plan_id
where s.organizacion_id in (current_setting('prueba.org_a')::uuid, current_setting('prueba.org_b')::uuid)
  and p.codigo = 'certificacion' and s.estado = 'prueba';

-- B deja una invitación pendiente propia, para probar que A no la ve.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.tok_b', public.crear_invitacion(current_setting('prueba.org_b')::uuid, 'invitado-b@ejemplo.invalid', 'lector'), true);

-- ---------------------------------------------------------------------------
-- 2. A invita a su equipo; cupo de usuarios del plan
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.tok_admin',  public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'Administrador-A@ejemplo.invalid', 'administrador'), true);
select set_config('prueba.tok_emisor', public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'emisor-a@ejemplo.invalid', 'emisor'), true);
select set_config('prueba.tok_lector', public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'lector-a@ejemplo.invalid', 'lector'), true);
select set_config('prueba.tok_a6',     public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'pendiente-a6@ejemplo.invalid'), true);

select pg_temp.registrar(4, 'crear_invitacion guarda el correo en minúsculas y solo el sha256 del token',
  count(*) = 1 and bool_and(i.token_hash = encode(sha256(convert_to(current_setting('prueba.tok_admin'), 'UTF8')), 'hex')),
  string_agg(i.correo || ' ' || i.rol, ', '))
from public.invitaciones i
where i.organizacion_id = current_setting('prueba.org_a')::uuid and i.correo = 'administrador-a@ejemplo.invalid';

do $$
begin
  perform public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'otro@ejemplo.invalid', 'propietario');
  perform pg_temp.registrar(5, 'no se puede invitar con rol propietario', false, 'la invitación se creó');
exception when check_violation then
  perform pg_temp.registrar(5, 'no se puede invitar con rol propietario', true, sqlstate || ' ' || sqlerrm);
end $$;

-- El administrador acepta (2 de 2 usuarios del plan Certificación).
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if public.aceptar_invitacion(current_setting('prueba.tok_admin')) = current_setting('prueba.org_a')::uuid then
    perform pg_temp.registrar(6, 'aceptar_invitacion (correo que calza) devuelve la organización', true);
  else
    perform pg_temp.registrar(6, 'aceptar_invitacion (correo que calza) devuelve la organización', false, 'otra organización');
  end if;
end $$;

-- El emisor choca con el cupo (max_usuarios = 2 en Certificación).
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.aceptar_invitacion(current_setting('prueba.tok_emisor'));
  perform pg_temp.registrar(7, 'aceptar_invitacion respeta el cupo de usuarios del plan', false, 'entró un tercer usuario');
exception when raise_exception then
  perform pg_temp.registrar(7, 'aceptar_invitacion respeta el cupo de usuarios del plan', sqlerrm like 'El plan % permite como máximo 2 usuario(s)', sqlerrm);
end $$;

-- El backend sube a A al plan Pyme (5 usuarios); así entran el emisor y el lector.
reset role;
update public.suscripciones
set plan_id = (select id from public.planes where codigo = 'pyme')
where organizacion_id = current_setting('prueba.org_a')::uuid;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
select public.aceptar_invitacion(current_setting('prueba.tok_emisor'));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
select public.aceptar_invitacion(current_setting('prueba.tok_lector'));

reset role;
select pg_temp.registrar(8, 'el equipo de A queda con propietario, administrador, emisor y lector',
  string_agg(m.rol::text, ',' order by m.rol) = 'propietario,administrador,emisor,lector',
  string_agg(m.rol::text, ',' order by m.rol))
from public.miembros_organizacion m
where m.organizacion_id = current_setting('prueba.org_a')::uuid;

select pg_temp.registrar(9, 'aceptar_invitacion marca aceptada_en',
  count(*) = 3, count(*) || ' aceptadas')
from public.invitaciones
where organizacion_id = current_setting('prueba.org_a')::uuid and aceptada_en is not null;

-- ---------------------------------------------------------------------------
-- 3. Invitaciones que deben fallar
-- ---------------------------------------------------------------------------

-- B intenta usar la invitación de pendiente-a6 (otro correo).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.aceptar_invitacion(current_setting('prueba.tok_a6'));
  perform pg_temp.registrar(10, 'aceptar_invitacion falla si el correo no calza', false, 'B entró a A');
exception when insufficient_privilege then
  perform pg_temp.registrar(10, 'aceptar_invitacion falla si el correo no calza', sqlerrm = 'Invitación inválida o vencida', sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.aceptar_invitacion('token-que-no-existe');
  perform pg_temp.registrar(11, 'aceptar_invitacion falla con un token inventado', false, 'aceptó');
exception when insufficient_privilege then
  perform pg_temp.registrar(11, 'aceptar_invitacion falla con un token inventado', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'intruso@ejemplo.invalid', 'lector');
  perform pg_temp.registrar(12, 'un no miembro no invita a otra organización', false, 'B invitó en A');
exception when insufficient_privilege then
  perform pg_temp.registrar(12, 'un no miembro no invita a otra organización', true, sqlstate || ' ' || sqlerrm);
end $$;

-- El lector y el emisor no invitan.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'amigo@ejemplo.invalid', 'lector');
  perform pg_temp.registrar(13, 'un lector no puede invitar', false, 'el lector invitó');
exception when insufficient_privilege then
  perform pg_temp.registrar(13, 'un lector no puede invitar', sqlerrm = 'Sin permiso', sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.aceptar_invitacion(current_setting('prueba.tok_lector'));
  perform pg_temp.registrar(14, 'aceptar_invitacion falla con un token ya aceptado', false, 'aceptó dos veces');
exception when insufficient_privilege then
  perform pg_temp.registrar(14, 'aceptar_invitacion falla con un token ya aceptado', true, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'amigo@ejemplo.invalid', 'lector');
  perform pg_temp.registrar(15, 'un emisor no puede invitar', false, 'el emisor invitó');
exception when insufficient_privilege then
  perform pg_temp.registrar(15, 'un emisor no puede invitar', true, sqlstate || ' ' || sqlerrm);
end $$;

-- El administrador invita a vencida-a; la invitación vence antes de que la acepte.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.tok_a5', public.crear_invitacion(current_setting('prueba.org_a')::uuid, 'vencida-a@ejemplo.invalid', 'lector'), true);
select pg_temp.registrar(16, 'un administrador puede invitar', current_setting('prueba.tok_a5') ~ '^[0-9a-f]{64}$', null);

reset role;
update public.invitaciones set expira_en = now() - interval '1 minute'
where organizacion_id = current_setting('prueba.org_a')::uuid and correo = 'vencida-a@ejemplo.invalid';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.aceptar_invitacion(current_setting('prueba.tok_a5'));
  perform pg_temp.registrar(17, 'aceptar_invitacion falla con un token vencido', false, 'aceptó una invitación vencida');
exception when insufficient_privilege then
  perform pg_temp.registrar(17, 'aceptar_invitacion falla con un token vencido', true, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Empresas (necesarias para los borradores) y límite del plan
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v uuid;
  v_autorizada boolean;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna, autorizada_produccion)
  values (current_setting('prueba.org_a')::uuid, '76543210-3', 'Empresa de prueba A', 'Venta de artículos de prueba',
          'Calle Falsa 123', 'Santiago', true)
  returning id, autorizada_produccion into v, v_autorizada;
  perform set_config('prueba.emp_a', v::text, true);
  perform pg_temp.registrar(18, 'el propietario crea una empresa', true, null);
  perform pg_temp.registrar(19, 'autorizada_produccion no se puede fijar al crear la empresa', not v_autorizada,
                            'autorizada_produccion = ' || v_autorizada);
end $$;

reset role;
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
    perform pg_temp.registrar(20, 'tg_limite_empresas: Certificación permite una sola empresa', false, 'se creó la segunda');
  exception when raise_exception then
    perform pg_temp.registrar(20, 'tg_limite_empresas: Certificación permite una sola empresa',
                              sqlerrm like 'El plan % permite como máximo 1 empresa(s)', sqlerrm);
  end;

  -- B crea su propio borrador, para probar que A no lo ve.
  insert into public.documentos (empresa_id, ambiente) values (v, 'certificacion');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Borradores: el lector no, el emisor sí
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  insert into public.documentos (empresa_id, ambiente) values (current_setting('prueba.emp_a')::uuid, 'certificacion');
  perform pg_temp.registrar(21, 'un lector no puede crear borradores', false, 'el lector creó un borrador');
exception when insufficient_privilege then
  perform pg_temp.registrar(21, 'un lector no puede crear borradores', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '66666666-6', 'Empresa del lector', 'Servicios de prueba', 'Calle 1', 'Santiago');
  perform pg_temp.registrar(22, 'un lector no puede crear empresas', false, 'el lector creó una empresa');
exception when insufficient_privilege then
  perform pg_temp.registrar(22, 'un lector no puede crear empresas', true, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v uuid;
begin
  insert into public.documentos (empresa_id, ambiente, organizacion_id)
  values (current_setting('prueba.emp_a')::uuid, 'certificacion', current_setting('prueba.org_b')::uuid)
  returning id into v;
  perform set_config('prueba.doc_a', v::text, true);
  perform pg_temp.registrar(23, 'un emisor puede crear un borrador (organizacion_id heredado de la empresa)',
    (select organizacion_id from public.documentos where id = v) = current_setting('prueba.org_a')::uuid,
    'se pasó organizacion_id de B y quedó el de la empresa');
end $$;

do $$
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org_a')::uuid, '66666666-6', 'Empresa del emisor', 'Servicios de prueba', 'Calle 1', 'Santiago');
  perform pg_temp.registrar(24, 'un emisor no puede crear empresas', false, 'el emisor creó una empresa');
exception when insufficient_privilege then
  perform pg_temp.registrar(24, 'un emisor no puede crear empresas', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform * from public.asignar_folio(current_setting('prueba.emp_a')::uuid, 'certificacion', 39::smallint);
  perform pg_temp.registrar(25, 'un emisor no ejecuta asignar_folio (solo service_role)', false, 'se ejecutó');
exception when insufficient_privilege then
  perform pg_temp.registrar(25, 'un emisor no ejecuta asignar_folio (solo service_role)', true, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_editados integer;
  v_borrados integer;
  v_visibles integer;
begin
  update public.documentos set receptor_razon_social = 'Editado por el lector'
  where id = current_setting('prueba.doc_a')::uuid;
  get diagnostics v_editados = row_count;
  delete from public.documentos where id = current_setting('prueba.doc_a')::uuid;
  get diagnostics v_borrados = row_count;
  select count(*) into v_visibles from public.documentos where id = current_setting('prueba.doc_a')::uuid;
  perform pg_temp.registrar(26, 'un lector ve el borrador pero no lo edita ni lo borra',
    v_visibles = 1 and v_editados = 0 and v_borrados = 0,
    format('visibles %s, editados %s, borrados %s', v_visibles, v_editados, v_borrados));
end $$;

-- B intenta colgar un borrador de la empresa de A.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  insert into public.documentos (empresa_id, ambiente, organizacion_id)
  values (current_setting('prueba.emp_a')::uuid, 'certificacion', current_setting('prueba.org_b')::uuid);
  perform pg_temp.registrar(27, 'B no crea borradores en una empresa de A (aunque pase su organizacion_id)', false, 'B escribió en A');
exception when insufficient_privilege then
  perform pg_temp.registrar(27, 'B no crea borradores en una empresa de A (aunque pase su organizacion_id)', true, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Aislamiento entre organizaciones
-- ---------------------------------------------------------------------------

-- B mira los datos de A (sigue con la sesión de B).
select pg_temp.registrar(28, 'B no ve nada de A (organizaciones, miembros, invitaciones, suscripciones, perfiles, empresas, documentos)',
  v.total = 0, v.detalle)
from (
  select sum(c) as total, string_agg(t || '=' || c, ', ') as detalle
  from (
    select 'organizaciones' as t, count(*) as c from public.organizaciones where id = current_setting('prueba.org_a')::uuid
    union all select 'miembros', count(*) from public.miembros_organizacion where organizacion_id = current_setting('prueba.org_a')::uuid
    union all select 'invitaciones', count(*) from public.invitaciones where organizacion_id = current_setting('prueba.org_a')::uuid
    union all select 'suscripciones', count(*) from public.suscripciones where organizacion_id = current_setting('prueba.org_a')::uuid
    union all select 'perfiles', count(*) from public.perfiles where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4')
    union all select 'empresas', count(*) from public.empresas where organizacion_id = current_setting('prueba.org_a')::uuid
    union all select 'documentos', count(*) from public.documentos where organizacion_id = current_setting('prueba.org_a')::uuid
  ) x
) v;

select pg_temp.registrar(29, 'B solo ve su organización y su propio perfil',
  (select count(*) from public.organizaciones) = 1 and (select count(*) from public.perfiles) = 1,
  format('organizaciones %s, perfiles %s', (select count(*) from public.organizaciones), (select count(*) from public.perfiles)));

-- A (propietario) mira los datos de B.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(30, 'A no ve nada de B (organizaciones, miembros, invitaciones, suscripciones, perfiles, empresas, documentos)',
  v.total = 0, v.detalle)
from (
  select sum(c) as total, string_agg(t || '=' || c, ', ') as detalle
  from (
    select 'organizaciones' as t, count(*) as c from public.organizaciones where id = current_setting('prueba.org_b')::uuid
    union all select 'miembros', count(*) from public.miembros_organizacion where organizacion_id = current_setting('prueba.org_b')::uuid
    union all select 'invitaciones', count(*) from public.invitaciones where organizacion_id = current_setting('prueba.org_b')::uuid
    union all select 'suscripciones', count(*) from public.suscripciones where organizacion_id = current_setting('prueba.org_b')::uuid
    union all select 'perfiles', count(*) from public.perfiles where id = '00000000-0000-4000-8000-0000000000b1'
    union all select 'empresas', count(*) from public.empresas where organizacion_id = current_setting('prueba.org_b')::uuid
    union all select 'documentos', count(*) from public.documentos where organizacion_id = current_setting('prueba.org_b')::uuid
  ) x
) v;

select pg_temp.registrar(31, 'A ve a su equipo: 4 miembros y sus 4 perfiles',
  (select count(*) from public.miembros_organizacion) = 4 and (select count(*) from public.perfiles) = 4,
  format('miembros %s, perfiles %s', (select count(*) from public.miembros_organizacion), (select count(*) from public.perfiles)));

-- El lector de A ve la organización y los documentos, pero no las invitaciones (solo administradores).
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(32, 'el lector ve organización, empresa y borrador de A, pero no las invitaciones',
  (select count(*) from public.organizaciones) = 1
    and (select count(*) from public.empresas) = 1
    and (select count(*) from public.documentos) = 1
    and (select count(*) from public.invitaciones) = 0,
  format('organizaciones %s, empresas %s, documentos %s, invitaciones %s',
    (select count(*) from public.organizaciones), (select count(*) from public.empresas),
    (select count(*) from public.documentos), (select count(*) from public.invitaciones)));

do $$
declare
  v integer;
begin
  update public.organizaciones set nombre = 'Cambiada por el lector' where id = current_setting('prueba.org_a')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(33, 'un lector no edita la organización', v = 0, v || ' filas editadas');
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(34, 'el administrador ve las invitaciones de A (y ninguna de B)',
  (select count(*) from public.invitaciones) > 0
    and (select count(*) from public.invitaciones where organizacion_id <> current_setting('prueba.org_a')::uuid) = 0,
  (select count(*) from public.invitaciones) || ' invitaciones visibles');

-- ---------------------------------------------------------------------------
-- 7. Roles: el administrador no toca propietarios
-- ---------------------------------------------------------------------------

do $$
begin
  update public.miembros_organizacion set rol = 'propietario'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a4';
  perform pg_temp.registrar(35, 'un administrador no asciende a otro miembro a propietario', false, 'el lector quedó propietario');
exception when insufficient_privilege then
  perform pg_temp.registrar(35, 'un administrador no asciende a otro miembro a propietario', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  update public.miembros_organizacion set rol = 'propietario'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a2';
  perform pg_temp.registrar(36, 'un administrador no se asciende a sí mismo a propietario', false, 'se ascendió');
exception when insufficient_privilege then
  perform pg_temp.registrar(36, 'un administrador no se asciende a sí mismo a propietario', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_editados integer;
  v_borrados integer;
begin
  update public.miembros_organizacion set rol = 'lector'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics v_editados = row_count;
  delete from public.miembros_organizacion
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics v_borrados = row_count;
  perform pg_temp.registrar(37, 'un administrador no degrada ni quita a un propietario',
    v_editados = 0 and v_borrados = 0, format('editados %s, borrados %s', v_editados, v_borrados));
end $$;

do $$
begin
  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
  values (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000000a5', 'propietario');
  perform pg_temp.registrar(38, 'un administrador no da de alta a un propietario', false, 'se creó un propietario');
exception when insufficient_privilege then
  perform pg_temp.registrar(38, 'un administrador no da de alta a un propietario', true, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  update public.miembros_organizacion set rol = 'emisor'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a4';
  perform pg_temp.registrar(39, 'un administrador cambia el rol de un no propietario (lector → emisor)',
    (select rol from public.miembros_organizacion
      where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a4') = 'emisor',
    null);
  update public.miembros_organizacion set rol = 'lector'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a4';
end $$;

do $$
declare
  v integer;
begin
  delete from public.organizaciones where id = current_setting('prueba.org_a')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(40, 'un administrador no borra la organización', v = 0, v || ' filas borradas');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Regla del último propietario
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  delete from public.miembros_organizacion
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  perform pg_temp.registrar(41, 'el único propietario no puede salir de la organización', false, 'salió');
exception when raise_exception then
  perform pg_temp.registrar(41, 'el único propietario no puede salir de la organización',
    sqlerrm = 'La organización debe tener al menos un propietario', sqlerrm);
end $$;

do $$
begin
  update public.miembros_organizacion set rol = 'administrador'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  perform pg_temp.registrar(42, 'el único propietario no puede degradarse', false, 'se degradó');
exception when raise_exception then
  perform pg_temp.registrar(42, 'el único propietario no puede degradarse',
    sqlerrm = 'La organización debe tener al menos un propietario', sqlerrm);
end $$;

do $$
begin
  update public.miembros_organizacion set rol = 'propietario'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a2';
  update public.miembros_organizacion set rol = 'administrador'
  where organizacion_id = current_setting('prueba.org_a')::uuid and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  perform pg_temp.registrar(43, 'un propietario nombra a otro propietario y entonces puede degradarse',
    (select string_agg(usuario_id::text, ',') from public.miembros_organizacion
      where organizacion_id = current_setting('prueba.org_a')::uuid and rol = 'propietario')
      = '00000000-0000-4000-8000-0000000000a2', null);
exception when others then
  perform pg_temp.registrar(43, 'un propietario nombra a otro propietario y entonces puede degradarse', false, sqlstate || ' ' || sqlerrm);
end $$;

-- El propietario de B borra su organización completa (la cascada no choca con la regla).
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v integer;
begin
  delete from public.organizaciones where id = current_setting('prueba.org_b')::uuid;
  get diagnostics v = row_count;
  perform pg_temp.registrar(44, 'el propietario borra su organización (cascada permitida)', v = 1, v || ' filas borradas');
exception when others then
  perform pg_temp.registrar(44, 'el propietario borra su organización (cascada permitida)', false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 9. anon no ve nada de tenancy
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  t text;
  c bigint;
  v_visibles text := '';
  v_negadas  integer := 0;
begin
  foreach t in array array['perfiles', 'organizaciones', 'miembros_organizacion', 'invitaciones',
                           'suscripciones', 'uso_mensual', 'empresas', 'documentos'] loop
    begin
      execute format('select count(*) from public.%I', t) into c;
      if c > 0 then
        v_visibles := v_visibles || t || '=' || c || ' ';
      end if;
    exception when insufficient_privilege then
      v_negadas := v_negadas + 1;
    end;
  end loop;
  perform pg_temp.registrar(45, 'anon no lee ninguna tabla de tenancy', v_visibles = '',
    format('%s de 8 con permiso denegado; visibles: %s', v_negadas, coalesce(nullif(v_visibles, ''), 'ninguna')));
end $$;

do $$
begin
  perform public.crear_organizacion('Anónima', 'zz-prueba-rls-anon');
  perform pg_temp.registrar(46, 'anon no ejecuta crear_organizacion ni aceptar_invitacion', false, 'creó una organización');
exception when insufficient_privilege then
  begin
    perform public.aceptar_invitacion(current_setting('prueba.tok_a6'));
    perform pg_temp.registrar(46, 'anon no ejecuta crear_organizacion ni aceptar_invitacion', false, 'aceptó una invitación');
  exception when insufficient_privilege then
    perform pg_temp.registrar(46, 'anon no ejecuta crear_organizacion ni aceptar_invitacion', true, sqlstate || ' ' || sqlerrm);
  end;
end $$;

select pg_temp.registrar(47, 'anon sí lee los catálogos (planes activos)', count(*) > 0, count(*) || ' planes')
from public.planes;

-- ---------------------------------------------------------------------------
-- 10. ver_invitacion (migración 0003), solo si ya está aplicada
-- ---------------------------------------------------------------------------

do $$
declare
  v_filas integer;
  v_org   text;
  v_correo text;
  v_rol   text;
begin
  if to_regprocedure('public.ver_invitacion(text)') is null then
    perform pg_temp.registrar(48, 'ver_invitacion: token correcto devuelve la invitación', null, 'omitida: ver_invitacion no existe (migración 0003 sin aplicar)');
    perform pg_temp.registrar(49, 'ver_invitacion: token malo devuelve cero filas', null, 'omitida');
    perform pg_temp.registrar(50, 'ver_invitacion: token ya aceptado devuelve cero filas', null, 'omitida');
    perform pg_temp.registrar(51, 'ver_invitacion: token vencido devuelve cero filas', null, 'omitida');
    return;
  end if;

  -- Como anon (sigue la sesión anon de la sección 9).
  execute 'select count(*), max(organizacion_nombre::text), max(correo::text), max(rol::text) from public.ver_invitacion($1)'
    into v_filas, v_org, v_correo, v_rol using current_setting('prueba.tok_a6');
  perform pg_temp.registrar(48, 'ver_invitacion: token correcto devuelve la invitación',
    v_filas = 1 and v_org = 'Prueba RLS Fase 2 A' and v_correo = 'pendiente-a6@ejemplo.invalid' and v_rol = 'lector',
    format('%s fila(s): %s / %s / %s', v_filas, v_org, v_correo, v_rol));

  execute 'select count(*) from public.ver_invitacion($1)' into v_filas using 'token-que-no-existe';
  perform pg_temp.registrar(49, 'ver_invitacion: token malo devuelve cero filas', v_filas = 0, v_filas || ' fila(s)');

  execute 'select count(*) from public.ver_invitacion($1)' into v_filas using current_setting('prueba.tok_lector');
  perform pg_temp.registrar(50, 'ver_invitacion: token ya aceptado devuelve cero filas', v_filas = 0, v_filas || ' fila(s)');

  execute 'select count(*) from public.ver_invitacion($1)' into v_filas using current_setting('prueba.tok_a5');
  perform pg_temp.registrar(51, 'ver_invitacion: token vencido devuelve cero filas', v_filas = 0, v_filas || ' fila(s)');
exception when others then
  perform pg_temp.registrar(52, 'ver_invitacion: error inesperado', false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 11. Organización morosa no acepta miembros (migración 0004)
-- ---------------------------------------------------------------------------

-- El backend deja a A `morosa` (Pyme, 4 de 5 usuarios: el cupo no es el motivo) y
-- reabre la invitación de vencida-a, que ahora sí calza en correo y fecha.
reset role;
update public.suscripciones set estado = 'morosa'
where organizacion_id = current_setting('prueba.org_a')::uuid;
update public.invitaciones set expira_en = now() + interval '1 day'
where organizacion_id = current_setting('prueba.org_a')::uuid and correo = 'vencida-a@ejemplo.invalid';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.aceptar_invitacion(current_setting('prueba.tok_a5'));
  perform pg_temp.registrar(53, 'aceptar_invitacion rechaza si la organización está morosa', false,
    'entró un miembro sin suscripción vigente (¿falta la migración 0004?)');
exception when raise_exception then
  perform pg_temp.registrar(53, 'aceptar_invitacion rechaza si la organización está morosa',
    sqlerrm = 'La organización no tiene una suscripción vigente', sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

reset role;
select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones ni nada de lo anterior
