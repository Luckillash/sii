-- Simulación de roles de la Fase 8: deduplicación de alertas por correo (migración 0013).
--
-- Criterio: `reclamar_notificacion` (service_role) entrega el id una sola vez por clave;
-- una notificación `fallida` o `pendiente` abandonada (más de 15 minutos) se vuelve a
-- tomar hasta 5 intentos, y una `enviada`, una `pendiente` reciente o una de otra
-- organización no; los check de la tabla rechazan tipos y claves mal formados y una
-- `enviada` sin fecha; los miembros leen solo las de su organización (también el lector),
-- nadie escribe con su sesión ni ejecuta la función, y anon no ve nada. Además: un
-- reintento devuelve el `grupo` (la misma Idempotency-Key); `notificacion_cerrada` es la
-- negación de «se puede reclamar»; las funciones de candidatos excluyen lo ya avisado, el
-- set de pruebas y lo que está fuera de la ventana, y reparten por turnos entre
-- organizaciones; un administrador no las ejecuta. 26 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0013 APLICADA (tabla notificaciones y sus funciones). Sin ella el
-- script corre igual (cada paso captura su error), pero solo la 1 sale true: las
-- funciones y la tabla no existen (42883 / 42P01).
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase6-folios.sql): crea usuarios ficticios (notif-…@ejemplo.invalid), dos
-- organizaciones, dos empresas, envíos, un CAF de MENTIRA por `registrar_caf` (con su
-- secreto de prueba en Vault), documentos, certificados sin archivo (ids de secretos al
-- azar, sin nada en Vault) y notificaciones de prueba, y al final deshace todo. No envía
-- correos ni llama a pg_net: la tabla solo registra avisos, el envío lo hace la app. Los
-- documentos se insertan ya `rechazado`/`aceptado` (sin update de estado, así que no
-- encolan webhooks).
--
-- Cómo correrlo (con la migración 0013 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true se
--      comportó como se espera; false, ver detalle). Si el error es del script, se corrige
--      el script; si es del esquema, se reporta.
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'notif-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-notif-fase8%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa notificaciones fase 8%') as empresas,
--          (select count(*) from public.certificados where id::text like '00000000-0000-4000-8000-0000000008%') as certificados,
--          (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos,
--          (select count(*) from public.notificaciones where clave like '%:00000000-0000-4000-8000-0000000008%') as notificaciones;
--      (`secretos` puede no ser 0 si una empresa real tiene el RUT 11111111-1: basta con que
--      sea el mismo número que antes de correr el script.)
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 7): `request.jwt.claims` local a la
-- transacción + `set local role authenticated | anon | service_role`; `reset role` vuelve
-- a postgres. Los ids que pasan de un paso a otro van en parámetros locales `prueba.*`.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...8a1 propietario de A    ...8a2 administrador de A    ...8a3 lector de A
--   ...8b1 propietario de B
-- Las referencias de las notificaciones son uuid de mentira ...0008c1 a ...0008c9 (no
-- apuntan a ningún documento real: la columna no tiene FK).

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

-- Llama a reclamar_notificacion con el rol de la sesión: 'id:<uuid>', 'null' o '<sqlstate> <mensaje>'.
create function pg_temp.reclamar(p_org uuid, p_tipo text, p_clave text, p_ref uuid default null,
                                 p_datos jsonb default '{}'::jsonb)
returns text
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.reclamar_notificacion(p_org, p_tipo, p_clave, p_ref, p_datos);
  if not found then
    return 'null';
  end if;
  return 'id:' || r.id::text;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.reclamar(uuid, text, text, uuid, jsonb) to authenticated, anon, service_role;

-- Igual, pero devuelve lo que reclamar_notificacion entrega además del id: 'intentos|grupo'.
create function pg_temp.reclamar_detalle(p_org uuid, p_tipo text, p_clave text)
returns text
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.reclamar_notificacion(p_org, p_tipo, p_clave);
  if not found then
    return 'null';
  end if;
  return r.intentos || '|' || coalesce(r.grupo, '-');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.reclamar_detalle(uuid, text, text) to authenticated, anon, service_role;

-- Ids que devuelve una función de candidatos, en orden, separados por coma, o '<sqlstate>'.
create function pg_temp.candidatos(p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, '');
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.candidatos(text) to authenticated, anon, service_role;

-- Estado de una notificación sin RLS: 'estado|intentos|org A o B|error nulo'.
create function pg_temp.fila(p_clave text)
returns text
language plpgsql
security definer
as $$
declare
  r record;
begin
  select * into r from public.notificaciones where clave = p_clave;
  if not found then
    return 'no existe';
  end if;
  return r.estado || '|' || r.intentos || '|'
         || case r.organizacion_id when current_setting('prueba.org_a')::uuid then 'A'
                                   when current_setting('prueba.org_b')::uuid then 'B' else '?' end
         || '|' || case when r.error is null then 'sin error' else 'con error' end;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.fila(text) to authenticated, anon, service_role;

-- Notificaciones de prueba (sin RLS), para comparar con lo que ve cada rol.
create function pg_temp.total(p_org uuid)
returns bigint
language plpgsql
security definer
as $$
begin
  return (select count(*) from public.notificaciones where organizacion_id = p_org);
exception when others then
  return -1;
end;
$$;
grant execute on function pg_temp.total(uuid) to authenticated, anon, service_role;

-- Cuántas ve el rol de la sesión ('<n>' o '<sqlstate>').
create function pg_temp.visibles()
returns text
language plpgsql
as $$
begin
  return (select count(*)::text from public.notificaciones
           where clave like '%:00000000-0000-4000-8000-0000000008%');
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.visibles() to authenticated, anon, service_role;

-- Ejecuta SQL con el rol de la sesión: 'ok' o '<sqlstate>' (así el script sigue aunque
-- falte la tabla y se puede correr antes de migrar para ver que las comprobaciones fallan).
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

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000008a1', 'notif-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-0000000008a2', 'notif-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-0000000008a3', 'notif-lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-0000000008b1', 'notif-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba notificaciones Fase 8 A', 'zz-prueba-notif-fase8-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba notificaciones Fase 8 B', 'zz-prueba-notif-fase8-b')::text, true);

-- El backend sube a A al plan Pyme y da de alta a su equipo.
reset role;
select set_config('request.jwt.claims', '', true);
update public.suscripciones
set plan_id = (select id from public.planes where codigo = 'pyme')
where organizacion_id = current_setting('prueba.org_a')::uuid;
insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008a2', 'administrador'),
  (current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008a3', 'lector');

select pg_temp.registrar(1, 'preparación: A (Pyme) con propietario, administrador y lector; B con su propietario',
  (select string_agg(m.rol::text, ',' order by m.rol) from public.miembros_organizacion m
    where m.organizacion_id = current_setting('prueba.org_a')::uuid) = 'propietario,administrador,lector'
  and (select count(*) from public.miembros_organizacion m
        where m.organizacion_id = current_setting('prueba.org_b')::uuid) = 1,
  null);

-- ---------------------------------------------------------------------------
-- 1. service_role: reclamar, no repetir, reintentar
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c1',
                             '00000000-0000-4000-8000-0000000008c1', '{"ambiente":"certificacion"}');
begin
  perform set_config('prueba.n1', coalesce(substring(r from '^id:(.*)$'), ''), true);
  perform pg_temp.registrar(2, 'una clave nueva devuelve su id y deja la fila pendiente, 1 intento, con tipo, referencia y datos',
    r like 'id:%'
    and pg_temp.valor(format(
          $q$select count(*) from public.notificaciones
              where id = %L and organizacion_id = %L and tipo = 'documento.rechazado'
                and referencia_id = '00000000-0000-4000-8000-0000000008c1'
                and datos = '{"ambiente":"certificacion"}'::jsonb
                and estado = 'pendiente' and intentos = 1 and enviado_en is null
                and destinatarios = '{}'$q$,
          current_setting('prueba.n1'), current_setting('prueba.org_a'))) = '1',
    r);
end $$;

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c1');
begin
  perform pg_temp.registrar(3, 'reclamar otra vez la misma clave (pendiente reciente) devuelve null y no suma intentos',
    r = 'null'
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1') = 'pendiente|1|A|sin error',
    r || ' / ' || pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1'));
end $$;

-- Resend falló: la app la cierra como fallida.
select pg_temp.ejecutar($q$
  update public.notificaciones
  set estado = 'fallida', error = 'red: Resend no respondió a tiempo.'
  where clave = 'documento.rechazado:00000000-0000-4000-8000-0000000008c1'
$q$);

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c1');
begin
  perform pg_temp.registrar(4, 'una fallida se vuelve a tomar: el mismo id, pendiente, 2 intentos y sin error',
    r = 'id:' || current_setting('prueba.n1')
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1') = 'pendiente|2|A|sin error',
    r || ' / ' || pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1'));
end $$;

-- Esta vez salió: la app la cierra como enviada.
select pg_temp.ejecutar($q$
  update public.notificaciones
  set estado = 'enviada', enviado_en = now(), resend_id = 'id-de-prueba',
      destinatarios = array['notif-propietario-a@ejemplo.invalid']
  where clave = 'documento.rechazado:00000000-0000-4000-8000-0000000008c1'
$q$);

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c1');
begin
  perform pg_temp.registrar(5, 'una enviada no se vuelve a tomar (null) y no cambia',
    r = 'null'
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1') = 'enviada|2|A|sin error',
    r || ' / ' || pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1'));
end $$;

-- Una fallida que ya usó sus 5 intentos.
do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'envio.incierto',
                              'envio.incierto:00000000-0000-4000-8000-0000000008c2',
                              '00000000-0000-4000-8000-0000000008c2');
  r2 text;
begin
  perform pg_temp.ejecutar($q$
    update public.notificaciones set estado = 'fallida', intentos = 5, error = 'rechazado: dominio sin verificar'
    where clave = 'envio.incierto:00000000-0000-4000-8000-0000000008c2'
  $q$);
  r2 := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'envio.incierto',
                         'envio.incierto:00000000-0000-4000-8000-0000000008c2');
  perform pg_temp.registrar(6, 'una fallida con 5 intentos ya no se toma (null) y conserva su error',
    r1 like 'id:%' and r2 = 'null'
    and pg_temp.fila('envio.incierto:00000000-0000-4000-8000-0000000008c2') = 'fallida|5|A|con error',
    r1 || ' / ' || r2 || ' / ' || pg_temp.fila('envio.incierto:00000000-0000-4000-8000-0000000008c2'));
end $$;

-- Una pendiente abandonada: la función murió hace 20 minutos sin cerrarla. Se inserta como
-- postgres con actualizado_en en el pasado (el trigger solo corre en los update).
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.ejecutar(format($q$
  insert into public.notificaciones (organizacion_id, tipo, referencia_id, clave, estado, intentos,
                                     creado_en, actualizado_en)
  values (%L, 'certificado.por_vencer', '00000000-0000-4000-8000-0000000008c3',
          'certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:7', 'pendiente', 1,
          now() - interval '20 minutes', now() - interval '20 minutes')
$q$, current_setting('prueba.org_a')));

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'certificado.por_vencer',
                             'certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:7',
                             '00000000-0000-4000-8000-0000000008c3', '{"umbral":7}');
begin
  perform pg_temp.registrar(7, 'una pendiente de hace 20 minutos (abandonada) se vuelve a tomar: 2 intentos y los datos nuevos',
    r like 'id:%'
    and pg_temp.fila('certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:7') = 'pendiente|2|A|sin error'
    and pg_temp.valor($q$select (datos = '{"umbral":7}'::jsonb)::text from public.notificaciones
          where clave = 'certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:7'$q$) = 'true',
    r || ' / ' || pg_temp.fila('certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:7'));
end $$;

do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'certificado.por_vencer',
                              'certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:1',
                              '00000000-0000-4000-8000-0000000008c3');
begin
  perform pg_temp.registrar(8, 'el mismo certificado con otro umbral es otra clave: se reclama aparte',
    r1 like 'id:%'
    and pg_temp.valor($q$select count(*) from public.notificaciones
          where referencia_id = '00000000-0000-4000-8000-0000000008c3'$q$) = '2',
    r1);
end $$;

-- B no puede tomar una clave de A, aunque esté fallida.
do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                              'documento.rechazado:00000000-0000-4000-8000-0000000008c4');
  r2 text;
begin
  perform pg_temp.ejecutar($q$
    update public.notificaciones set estado = 'fallida', error = 'limite'
    where clave = 'documento.rechazado:00000000-0000-4000-8000-0000000008c4'
  $q$);
  r2 := pg_temp.reclamar(current_setting('prueba.org_b')::uuid, 'documento.rechazado',
                         'documento.rechazado:00000000-0000-4000-8000-0000000008c4');
  perform pg_temp.registrar(9, 'otra organización con la misma clave recibe null y la fila sigue siendo de A, fallida y con 1 intento',
    r1 like 'id:%' and r2 = 'null'
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c4') = 'fallida|1|A|con error',
    r2 || ' / ' || pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c4'));
end $$;

-- Una de B, para el RLS.
do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_b')::uuid, 'envio.incierto',
                             'envio.incierto:00000000-0000-4000-8000-0000000008c5',
                             '00000000-0000-4000-8000-0000000008c5');
begin
  perform pg_temp.registrar(10, 'B reclama su propia notificación',
    r like 'id:%' and pg_temp.fila('envio.incierto:00000000-0000-4000-8000-0000000008c5') = 'pendiente|1|B|sin error',
    r);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Validaciones de la función y de la tabla
-- ---------------------------------------------------------------------------

do $$
declare
  r1 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'Documento rechazado',
                              'Documento rechazado:00000000-0000-4000-8000-0000000008c6');
  r2 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                              'envio.incierto:00000000-0000-4000-8000-0000000008c6');
  r3 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                              'documento.rechazado:');
  r4 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                              'documento.rechazado:' || repeat('x', 200));
begin
  perform pg_temp.registrar(11, 'tipo con mayúsculas o espacios, clave que no empieza por <tipo>:, clave vacía tras el tipo o de más de 200 caracteres: 23514 y no entra nada',
    r1 like '23514 %' and r2 like '23514 %' and r3 like '23514 %' and r4 like '23514 %'
    and pg_temp.fila('envio.incierto:00000000-0000-4000-8000-0000000008c6') = 'no existe',
    r1 || ' / ' || r2 || ' / ' || r3 || ' / ' || r4);
end $$;

do $$
declare
  r1 text := pg_temp.reclamar(null, 'documento.rechazado', 'documento.rechazado:00000000-0000-4000-8000-0000000008c7');
  r2 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, null, 'documento.rechazado:00000000-0000-4000-8000-0000000008c7');
  r3 text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado', null);
begin
  perform pg_temp.registrar(12, 'sin organización, tipo o clave: 22004',
    r1 like '22004 %' and r2 like '22004 %' and r3 like '22004 %',
    r1 || ' / ' || r2 || ' / ' || r3);
end $$;

do $$
declare
  r text := pg_temp.reclamar('00000000-0000-4000-8000-0000000008ff', 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c8');
begin
  perform pg_temp.registrar(13, 'una organización que no existe: 23503', r like '23503 %', r);
end $$;

do $$
declare
  v1 text := 'no';
  v2 text := 'no';
begin
  begin
    update public.notificaciones set estado = 'enviada'
    where clave = 'envio.incierto:00000000-0000-4000-8000-0000000008c5';
  exception when others then
    v1 := sqlstate;
  end;
  begin
    update public.notificaciones set estado = 'cancelada'
    where clave = 'envio.incierto:00000000-0000-4000-8000-0000000008c5';
  exception when others then
    v2 := sqlstate;
  end;
  perform pg_temp.registrar(14, 'service_role no puede dejar una enviada sin enviado_en ni un estado fuera de los 3: 23514',
    v1 = '23514' and v2 = '23514'
    and pg_temp.fila('envio.incierto:00000000-0000-4000-8000-0000000008c5') = 'pendiente|1|B|sin error',
    v1 || ' / ' || v2);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sesiones de usuario: lectura por organización, sin escritura
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_ve text := pg_temp.visibles();
  v_b  text := pg_temp.valor(format('select count(*) from public.notificaciones where organizacion_id = %L',
                                    current_setting('prueba.org_b')));
begin
  perform pg_temp.registrar(15, 'el administrador de A ve las 5 notificaciones de A y ninguna de B',
    v_ve = pg_temp.total(current_setting('prueba.org_a')::uuid)::text and v_ve = '5' and v_b = '0',
    've ' || v_ve || ', de B ' || v_b);
end $$;

do $$
declare
  v_ins text := 'no';
  v_upd text := 'no';
  v_del text := 'no';
begin
  begin
    insert into public.notificaciones (organizacion_id, tipo, clave)
    values (current_setting('prueba.org_a')::uuid, 'documento.rechazado',
            'documento.rechazado:00000000-0000-4000-8000-0000000008c9');
  exception when others then
    v_ins := sqlstate;
  end;
  begin
    update public.notificaciones set estado = 'fallida'
    where organizacion_id = current_setting('prueba.org_a')::uuid;
  exception when others then
    v_upd := sqlstate;
  end;
  begin
    delete from public.notificaciones where organizacion_id = current_setting('prueba.org_a')::uuid;
  exception when others then
    v_del := sqlstate;
  end;
  perform pg_temp.registrar(16, 'el administrador de A con su sesión no inserta, edita ni borra notificaciones (42501)',
    v_ins = '42501' and v_upd = '42501' and v_del = '42501'
    and pg_temp.total(current_setting('prueba.org_a')::uuid) = 5
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c1') = 'enviada|2|A|sin error',
    v_ins || '/' || v_upd || '/' || v_del);
end $$;

do $$
declare
  r text := pg_temp.reclamar(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                             'documento.rechazado:00000000-0000-4000-8000-0000000008c4');
begin
  perform pg_temp.registrar(17, 'el administrador de A no puede ejecutar reclamar_notificacion (42501), ni siquiera sobre una fallida de su organización',
    r like '42501 %'
    and pg_temp.fila('documento.rechazado:00000000-0000-4000-8000-0000000008c4') = 'fallida|1|A|con error',
    r);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(18, 'el lector de A también lee las de su organización (es_miembro)',
  pg_temp.visibles() = '5', pg_temp.visibles());

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.registrar(19, 'el propietario de B ve solo la suya',
  pg_temp.visibles() = '1'
  and pg_temp.valor(format('select count(*) from public.notificaciones where organizacion_id = %L',
                           current_setting('prueba.org_a'))) = '0',
  pg_temp.visibles());

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.registrar(20, 'anon no puede leer la tabla (42501)', pg_temp.visibles() = '42501', pg_temp.visibles());

-- ---------------------------------------------------------------------------
-- 4. Grupo, notificacion_cerrada y candidatos (sin lo ya avisado, por turnos)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r1 text := pg_temp.reclamar_detalle(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                                      'documento.rechazado:00000000-0000-4000-8000-0000000008d9');
  r2 text;
begin
  perform pg_temp.ejecutar($q$
    update public.notificaciones
    set estado = 'fallida', error = 'red', grupo = 'documento.rechazado/A/abc'
    where clave = 'documento.rechazado:00000000-0000-4000-8000-0000000008d9'
  $q$);
  r2 := pg_temp.reclamar_detalle(current_setting('prueba.org_a')::uuid, 'documento.rechazado',
                                 'documento.rechazado:00000000-0000-4000-8000-0000000008d9');
  perform pg_temp.registrar(21, 'reclamar devuelve intentos y grupo: nueva 1 sin grupo; al reintentar una fallida, 2 y el mismo grupo (la misma Idempotency-Key)',
    r1 = '1|-' and r2 = '2|documento.rechazado/A/abc', r1 || ' / ' || r2);
end $$;

select pg_temp.registrar(22, 'notificacion_cerrada: true para enviada, 5 intentos y pendiente reciente; false para fallida con intentos y para una clave sin fila',
  pg_temp.valor($q$select public.notificacion_cerrada('documento.rechazado:00000000-0000-4000-8000-0000000008c1')::text$q$) = 'true'
  and pg_temp.valor($q$select public.notificacion_cerrada('envio.incierto:00000000-0000-4000-8000-0000000008c2')::text$q$) = 'true'
  and pg_temp.valor($q$select public.notificacion_cerrada('certificado.por_vencer:00000000-0000-4000-8000-0000000008c3:1')::text$q$) = 'true'
  and pg_temp.valor($q$select public.notificacion_cerrada('documento.rechazado:00000000-0000-4000-8000-0000000008c4')::text$q$) = 'false'
  and pg_temp.valor($q$select public.notificacion_cerrada('documento.rechazado:00000000-0000-4000-8000-0000000008ce')::text$q$) = 'false',
  pg_temp.valor($q$select public.notificacion_cerrada('documento.rechazado:00000000-0000-4000-8000-0000000008c1')::text$q$));

-- Datos para los candidatos (como postgres): una empresa en A y otra en B; envíos, un CAF
-- de mentira con documentos y certificados con ids fijos (terminan en e*, d* y f*), y
-- avisos ya enviados para algunos. `actualizado_en` se fija al insertar (el trigger solo
-- corre en los update).
select set_config('prueba.caf', '', true);
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  insert into public.empresas (id, organizacion_id, rut, razon_social, giro, direccion, comuna) values
    ('00000000-0000-4000-8000-0000000008ea', current_setting('prueba.org_a')::uuid, '11111111-1',
     'Empresa notificaciones fase 8 A', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago'),
    ('00000000-0000-4000-8000-0000000008eb', current_setting('prueba.org_b')::uuid, '22222222-2',
     'Empresa notificaciones fase 8 B', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago');

  insert into public.envios (id, empresa_id, ambiente, proposito, rut_envia, nro_resol, fch_resol,
                             incierto, actualizado_en) values
    ('00000000-0000-4000-8000-0000000008e1', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'emision',     '11111111-1', 0, date '2026-11-06', true,  now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000008e2', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'emision',     '11111111-1', 0, date '2026-11-06', true,  now() - interval '2 hours'),
    ('00000000-0000-4000-8000-0000000008e3', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'emision',     '11111111-1', 0, date '2026-11-06', true,  now() - interval '1 hour'),
    ('00000000-0000-4000-8000-0000000008e4', '00000000-0000-4000-8000-0000000008eb', 'certificacion', 'emision',     '22222222-2', 0, date '2026-11-06', true,  now() - interval '30 minutes'),
    ('00000000-0000-4000-8000-0000000008e5', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'emision',     '11111111-1', 0, date '2026-11-06', false, now() - interval '1 hour'),
    ('00000000-0000-4000-8000-0000000008e6', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'emision',     '11111111-1', 0, date '2026-11-06', true,  now() - interval '3 days'),
    ('00000000-0000-4000-8000-0000000008e7', '00000000-0000-4000-8000-0000000008ea', 'certificacion', 'set_pruebas', '11111111-1', 0, date '2026-11-06', true,  now() - interval '1 hour');

  insert into public.certificados (id, organizacion_id, rut_titular, huella_sha256, pfx_secret_id,
                                   clave_secret_id, vigente_hasta, revocado_en) values
    ('00000000-0000-4000-8000-0000000008f1', current_setting('prueba.org_a')::uuid, '11111111-1', repeat('1', 64), gen_random_uuid(), gen_random_uuid(), now() + interval '10 days 1 hour', null),
    ('00000000-0000-4000-8000-0000000008f2', current_setting('prueba.org_a')::uuid, '11111111-1', repeat('2', 64), gen_random_uuid(), gen_random_uuid(), now() + interval '40 days', null),
    ('00000000-0000-4000-8000-0000000008f3', current_setting('prueba.org_a')::uuid, '11111111-1', repeat('3', 64), gen_random_uuid(), gen_random_uuid(), now() + interval '12 hours', null),
    ('00000000-0000-4000-8000-0000000008f4', current_setting('prueba.org_a')::uuid, '11111111-1', repeat('4', 64), gen_random_uuid(), gen_random_uuid(), now() + interval '3 days', now()),
    ('00000000-0000-4000-8000-0000000008f5', current_setting('prueba.org_a')::uuid, '11111111-1', repeat('5', 64), gen_random_uuid(), gen_random_uuid(), now() + interval '20 days 1 hour', null);
exception when others then
  raise notice 'preparación de candidatos: % %', sqlstate, sqlerrm;
end $$;

-- CAF de mentira de la empresa de A (por registrar_caf, como service_role) y documentos.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
begin
  perform set_config('prueba.caf', public.registrar_caf(
    current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea'::uuid,
    'certificacion', 39::smallint, 1, 10, date '2026-11-16', 100::smallint, '11111111-1',
    'EMPRESA NOTIFICACIONES FASE 8',
    '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>', null)::text, true);
exception when others then
  raise notice 'CAF de prueba: % %', sqlstate, sqlerrm;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  insert into public.documentos (id, organizacion_id, empresa_id, ambiente, tipo_dte, folio, caf_id, estado,
                                 origen, caso_set, mnt_neto, iva, mnt_total, actualizado_en) values
    ('00000000-0000-4000-8000-0000000008d1', current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea', 'certificacion', 39, 1, current_setting('prueba.caf')::uuid, 'rechazado', 'panel', null, 840, 160, 1000, now() - interval '2 hours'),
    ('00000000-0000-4000-8000-0000000008d2', current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea', 'certificacion', 39, 2, current_setting('prueba.caf')::uuid, 'rechazado', 'panel', null, 840, 160, 1000, now() - interval '1 hour'),
    ('00000000-0000-4000-8000-0000000008d3', current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea', 'certificacion', 39, 3, current_setting('prueba.caf')::uuid, 'aceptado',  'panel', null, 840, 160, 1000, now() - interval '1 hour'),
    ('00000000-0000-4000-8000-0000000008d4', current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea', 'certificacion', 39, 4, current_setting('prueba.caf')::uuid, 'rechazado', 'panel', null, 840, 160, 1000, now() - interval '3 days'),
    ('00000000-0000-4000-8000-0000000008d5', current_setting('prueba.org_a')::uuid, '00000000-0000-4000-8000-0000000008ea', 'certificacion', 39, 5, current_setting('prueba.caf')::uuid, 'rechazado', 'set_pruebas', 1, 840, 160, 1000, now() - interval '1 hour');
exception when others then
  raise notice 'documentos de prueba: % %', sqlstate, sqlerrm;
end $$;

-- Avisos ya enviados: el envío e1, el documento d1, el certificado f3 en su umbral (1) y
-- el f5 en un umbral que no es el suyo (15; le corresponde 30).
select pg_temp.ejecutar(format($q$
  insert into public.notificaciones (organizacion_id, tipo, clave, estado, enviado_en) values
    (%1$L, 'envio.incierto', 'envio.incierto:00000000-0000-4000-8000-0000000008e1', 'enviada', now()),
    (%1$L, 'documento.rechazado', 'documento.rechazado:00000000-0000-4000-8000-0000000008d1', 'enviada', now()),
    (%1$L, 'certificado.por_vencer', 'certificado.por_vencer:00000000-0000-4000-8000-0000000008f3:1', 'enviada', now()),
    (%1$L, 'certificado.por_vencer', 'certificado.por_vencer:00000000-0000-4000-8000-0000000008f5:15', 'enviada', now())
$q$, current_setting('prueba.org_a')));

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v2  text := pg_temp.candidatos($q$select string_agg(right(x.id::text, 2), ',' order by x.ord)
                                    from public.alertas_envios_inciertos(now() - interval '48 hours', 2)
                                         with ordinality as x(id, organizacion_id, empresa_id, ambiente, creado_en, ord)$q$);
  v10 text := pg_temp.candidatos($q$select string_agg(right(x.id::text, 2), ',' order by x.ord)
                                    from public.alertas_envios_inciertos(now() - interval '48 hours', 10)
                                         with ordinality as x(id, organizacion_id, empresa_id, ambiente, creado_en, ord)$q$);
begin
  perform pg_temp.registrar(23, 'envíos inciertos: sin el ya avisado (e1), ni el no incierto, ni el viejo, ni el del set; por turnos: con tope 2 sale uno de A (e2) y uno de B (e4), con 10 e2,e4,e3',
    v2 = 'e2,e4' and v10 = 'e2,e4,e3', 'tope 2: ' || v2 || ' / tope 10: ' || v10);
end $$;

do $$
declare
  v text := pg_temp.candidatos($q$select string_agg(right(x.id::text, 2), ',' order by x.ord)
                                  from public.alertas_documentos_rechazados(now() - interval '48 hours', 10)
                                       with ordinality as x(id, organizacion_id, empresa_id, ambiente, tipo_dte,
                                                            folio, mnt_total, fecha_emision, envio_id, ord)$q$);
begin
  perform pg_temp.registrar(24, 'documentos rechazados: solo d2 (d1 ya avisado, d3 aceptado, d4 fuera de la ventana, d5 del set de pruebas)',
    v = 'd2', v);
end $$;

do $$
declare
  v text := pg_temp.candidatos($q$select string_agg(right(x.id::text, 2) || ':' || x.umbral, ',' order by x.ord)
                                  from public.alertas_certificados_por_vencer(10)
                                       with ordinality as x(id, organizacion_id, rut_titular, nombre_titular, cn,
                                                            vigente_hasta, dias_restantes, umbral, ord)$q$);
begin
  perform pg_temp.registrar(25, 'certificados: f1 con umbral 15 y f5 con 30 (f2 vence en 40 días, f3 ya avisado en su umbral, f4 revocado), el más urgente primero',
    v = 'f1:15,f5:30', v);
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r1 text := pg_temp.candidatos($q$select count(*)::text from public.alertas_envios_inciertos(now() - interval '48 hours', 10)$q$);
  r2 text := pg_temp.candidatos($q$select count(*)::text from public.alertas_documentos_rechazados(now() - interval '48 hours', 10)$q$);
  r3 text := pg_temp.candidatos($q$select count(*)::text from public.alertas_certificados_por_vencer(10)$q$);
  r4 text := pg_temp.candidatos($q$select public.notificacion_cerrada('x.y:z')::text$q$);
begin
  perform pg_temp.registrar(26, 'el administrador de A no puede ejecutar las funciones de candidatos ni notificacion_cerrada (42501)',
    r1 = '42501' and r2 = '42501' and r3 = '42501' and r4 = '42501',
    r1 || '/' || r2 || '/' || r3 || '/' || r4);
end $$;

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones ni notificaciones de prueba
