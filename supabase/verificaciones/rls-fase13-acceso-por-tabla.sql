-- Simulación de roles de la Fase 13: acceso por tabla (select, insert, update, delete).
--
-- Criterio: cada tabla del esquema `public` (39) y cada vista (4) se comporta como dice
-- `documentación/03-api-reference/acceso-por-tabla.md` para siete roles: `anon`,
-- `authenticated` de OTRA organización (propietario de B), lector, emisor, administrador y
-- propietario de A, y `service_role`. Una fila de resultado por tabla o vista (1-43), con
-- la matriz observada de los siete roles; más 8 comprobaciones de las notas de la matriz
-- (44-51: fila propia en `perfiles` y `miembros_organizacion`, documento con folio, filas
-- de propietarios, columnas de `api_keys`) y una de preparación (0). 52 filas.
--
-- Cómo se lee cada celda (cuatro caracteres, en orden S I U D):
--   S / I / U / D  la operación pasó (select ve la fila objetivo; insert insertó 1 fila;
--                  update o delete afectó al menos 1 fila)
--   0              sin error pero 0 filas (RLS la oculta: el caso «sin error» del documento)
--   x              42501 (sin privilegio de tabla o columna, o insert que no pasa el
--                  WITH CHECK / sin política de insert)
--   !              otro error (inesperado: ver `detalle`)
--   ·              no aplica (vistas: solo select)
-- El esperado se calcula a partir de dos datos por tabla tomados del documento: las
-- operaciones permitidas a cada rol (la matriz) y los privilegios de tabla de
-- `authenticated` (párrafo «Cómo se decide» y notas). Una operación permitida → su letra;
-- sin privilegio → `x`; con privilegio pero sin política: insert → `x`, el resto → `0`.
-- `anon` solo tiene `select` en los catálogos; `service_role` tiene todo y salta RLS.
--
-- Fila objetivo: cada operación apunta a una fila sembrada en la organización A, elegida
-- para que un delete permitido no choque con una FK (p. ej. la empresa E3, sin hijos). En
-- `perfiles` y `miembros_organizacion` la fila objetivo es la de un miembro X (emisor de A,
-- distinto del que actúa): por eso lector y emisor muestran `Sx00` (la fila propia, nota 3
-- y nota 4, va en las comprobaciones 44 y 45). En `organizaciones` la fila objetivo es A
-- misma (el delete del propietario borra A en cascada, dentro del savepoint).
--
-- REQUIERE LAS MIGRACIONES 0001-0019 APLICADAS (la matriz describe el esquema con la 0018).
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase10-pagos.sql y rls-fase11-api.sql): crea usuarios ficticios
-- (rls13-…@ejemplo.invalid), dos organizaciones (zz-prueba-rls-fase13-a y -b), una fila de
-- prueba en cada tabla (incluidos catálogos: tipo DTE 998, estado `ZZ8`, plan
-- `zz-fase13`), y cada operación se ejecuta en su propio savepoint que SIEMPRE se deshace
-- (pg_temp.probar lanza un error propio después de ejecutar y lo captura): ninguna
-- operación de prueba afecta a la siguiente. Al final, `rollback` deshace todo. No crea
-- secretos en Vault (los ids de secreto son uuid al azar), no llama al SII, a Flow, a pg_net
-- ni a ninguna URL.
--
-- Cómo correrlo:
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true se
--      comportó como se espera; false, ver detalle: «observado ≠ esperado» por rol, con el
--      error crudo de cada celda distinta).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'rls13-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-rls-fase13%') as organizaciones,
--          (select count(*) from public.tipos_dte where codigo in (997, 998)) as tipos_dte,
--          (select count(*) from public.estados_sii where codigo in ('ZZ7', 'ZZ8')) as estados_sii,
--          (select count(*) from public.planes where codigo like 'zz-fase13%') as planes,
--          (select count(*) from public.tokens_sii where huella_certificado in (repeat('13', 32), repeat('31', 32))) as tokens;
--
-- Cómo se simula cada rol (igual que en las Fases 2 a 11): `request.jwt.claims` local a la
-- transacción + `set local role authenticated | anon | service_role`; `reset role` vuelve
-- a postgres (con los claims vacíos). pg_temp.correr(rol) recorre la tabla `casos` y
-- guarda en `observado` la celda de cada tabla para ese rol.
--
-- Usuarios ficticios (auth.users; trg_nuevo_usuario crea el perfil):
--   ...13a01 propietario de A   ...13a02 administrador de A   ...13a03 emisor de A
--   ...13a04 lector de A        ...13a05 X, emisor de A (fila objetivo de miembros/perfiles)
--   ...13a06 Y, sin organización (el insert de miembros lo agrega a A)
--   ...13a07 Z, sin perfil (el insert de perfiles lo crea)
--   ...13b01 propietario de B (el rol «otra organización»)
-- Ids fijos: 00000000-0000-4000-8000-000000013xxx (empresas e0x, certificados c0x, CAF f0x,
-- documentos d0x, envíos e1x, etc.; ver la sección 0).

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

-- Ejecuta SQL con el rol de la sesión y SIEMPRE lo deshace (savepoint del bloque
-- exception): 'ok:<filas>' o '<sqlstate> <mensaje>'.
create function pg_temp.probar(p_sql text)
returns text
language plpgsql
as $$
declare
  v_filas bigint;
begin
  execute p_sql;
  get diagnostics v_filas = row_count;
  raise exception using errcode = 'P0099', message = v_filas::text;
exception
  when sqlstate 'P0099' then
    return 'ok:' || sqlerrm;
  when others then
    return sqlstate || ' ' || left(sqlerrm, 160);
end;
$$;
grant execute on function pg_temp.probar(text) to authenticated, anon, service_role;

-- Valor escalar de una consulta con el rol de la sesión, como texto, o '<sqlstate> <mensaje>'.
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
  return sqlstate || ' ' || left(sqlerrm, 160);
end;
$$;
grant execute on function pg_temp.valor(text) to authenticated, anon, service_role;

-- Reemplaza {A} y {B} por los ids de las organizaciones de prueba.
create function pg_temp.sql(p_plantilla text)
returns text
language sql
as $$
  select replace(replace(p_plantilla, '{A}', current_setting('prueba.org_a')),
                 '{B}', current_setting('prueba.org_b'));
$$;
grant execute on function pg_temp.sql(text) to authenticated, anon, service_role;

-- Celda de select: S (ve la fila), 0 (no la ve), x (42501), ! (otro error).
create function pg_temp.celda_s(p_crudo text)
returns text
language sql
immutable
as $$
  select case
           when p_crudo ~ '^[0-9]+$' and p_crudo::bigint > 0 then 'S'
           when p_crudo = '0' then '0'
           when p_crudo like '42501%' then 'x'
           else '!'
         end;
$$;
grant execute on function pg_temp.celda_s(text) to authenticated, anon, service_role;

-- Celda de insert/update/delete: la letra (≥ 1 fila), 0, x o !.
create function pg_temp.celda(p_crudo text, p_letra text)
returns text
language sql
immutable
as $$
  select case
           when p_crudo ~ '^ok:[0-9]+$' and substr(p_crudo, 4)::bigint > 0 then p_letra
           when p_crudo = 'ok:0' then '0'
           when p_crudo like '42501%' then 'x'
           else '!'
         end;
$$;
grant execute on function pg_temp.celda(text, text) to authenticated, anon, service_role;

-- Celda esperada para una operación según lo permitido y los privilegios de tabla.
create function pg_temp.esperado(p_permitido text, p_privilegios text, p_vista boolean)
returns text
language sql
immutable
as $$
  select string_agg(
           case
             when p_vista and op <> 'S' then '·'
             when position(op in p_permitido) > 0 then op
             when position(op in p_privilegios) = 0 then 'x'
             when op = 'I' then 'x'
             else '0'
           end, '' order by ord)
  from unnest(array['S', 'I', 'U', 'D']) with ordinality as t(op, ord);
$$;

-- Casos: una fila por tabla o vista. `anon`: lo permitido a anon (= sus privilegios).
-- `priv`: privilegios de tabla de authenticated (de la página: `S` = solo select, `SD` +
-- update de columnas = `SUD`, nada = ''). `otra` … `prop`: lo permitido a cada rol sobre la
-- fila objetivo de A. service_role: siempre SIUD (S en las vistas).
create temp table casos (
  orden   integer primary key,
  tabla   text not null,
  vista   boolean not null default false,
  anon    text not null,
  priv    text not null,
  otra    text not null,
  lector  text not null,
  emisor  text not null,
  admin   text not null,
  prop    text not null,
  sql_s   text not null,
  sql_i   text,
  sql_u   text,
  sql_d   text
) on commit drop;
grant select on casos to authenticated, anon, service_role;

create temp table observado (
  orden  integer not null,
  rol    text not null,
  celda  text not null,
  crudo  text not null,
  primary key (orden, rol)
) on commit drop;
grant select, insert on observado to authenticated, anon, service_role;

-- Prefijo de los ids fijos: '00000000-0000-4000-8000-000000013' || 3 hex.
insert into casos (orden, tabla, vista, anon, priv, otra, lector, emisor, admin, prop, sql_s, sql_i, sql_u, sql_d) values
-- Catálogos
(1, 'tipos_dte', false, 'S', 'SIUD', 'S', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.tipos_dte where codigo = 998$q$,
 $q$insert into public.tipos_dte (codigo, nombre, afecto_iva) values (997, 'Prueba rls fase 13 I', true)$q$,
 $q$update public.tipos_dte set nombre = nombre where codigo = 998$q$,
 $q$delete from public.tipos_dte where codigo = 998$q$),
(2, 'estados_sii', false, 'S', 'SIUD', 'S', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.estados_sii where codigo = 'ZZ8'$q$,
 $q$insert into public.estados_sii (codigo, glosa) values ('ZZ7', 'Prueba rls fase 13 I')$q$,
 $q$update public.estados_sii set glosa = glosa where codigo = 'ZZ8'$q$,
 $q$delete from public.estados_sii where codigo = 'ZZ8'$q$),
(3, 'planes', false, 'S', 'SIUD', 'S', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.planes where codigo = 'zz-fase13'$q$,
 $q$insert into public.planes (codigo, nombre, activo) values ('zz-fase13-i', 'Prueba rls fase 13 I', true)$q$,
 $q$update public.planes set nombre = nombre where codigo = 'zz-fase13'$q$,
 $q$delete from public.planes where codigo = 'zz-fase13'$q$),
-- Tenancy
(4, 'perfiles', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.perfiles where id = '00000000-0000-4000-8000-000000013a05'$q$,
 $q$insert into public.perfiles (id, nombre) values ('00000000-0000-4000-8000-000000013a07', 'Z')$q$,
 $q$update public.perfiles set nombre = nombre where id = '00000000-0000-4000-8000-000000013a05'$q$,
 $q$delete from public.perfiles where id = '00000000-0000-4000-8000-000000013a05'$q$),
(5, 'organizaciones', false, '', 'SIUD', '', 'S', 'S', 'SU', 'SUD',
 $q$select count(*) from public.organizaciones where id = '{A}'$q$,
 $q$insert into public.organizaciones (nombre, slug) values ('Prueba rls fase 13 I', 'zz-prueba-rls-fase13-i')$q$,
 $q$update public.organizaciones set nombre = nombre where id = '{A}'$q$,
 $q$delete from public.organizaciones where id = '{A}'$q$),
(6, 'miembros_organizacion', false, '', 'SIUD', '', 'S', 'S', 'SIUD', 'SIUD',
 $q$select count(*) from public.miembros_organizacion where organizacion_id = '{A}' and usuario_id = '00000000-0000-4000-8000-000000013a05'$q$,
 $q$insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values ('{A}', '00000000-0000-4000-8000-000000013a06', 'lector')$q$,
 $q$update public.miembros_organizacion set rol = rol where organizacion_id = '{A}' and usuario_id = '00000000-0000-4000-8000-000000013a05'$q$,
 $q$delete from public.miembros_organizacion where organizacion_id = '{A}' and usuario_id = '00000000-0000-4000-8000-000000013a05'$q$),
(7, 'invitaciones', false, '', 'SD', '', '', '', 'SD', 'SD',
 $q$select count(*) from public.invitaciones where id = '00000000-0000-4000-8000-0000000130e1'$q$,
 $q$insert into public.invitaciones (id, organizacion_id, correo, rol, token_hash) values ('00000000-0000-4000-8000-0000000130e2', '{A}', 'rls13-invitado-i@ejemplo.invalid', 'lector', repeat('e2', 32))$q$,
 $q$update public.invitaciones set correo = correo where id = '00000000-0000-4000-8000-0000000130e1'$q$,
 $q$delete from public.invitaciones where id = '00000000-0000-4000-8000-0000000130e1'$q$),
(8, 'suscripciones', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.suscripciones where organizacion_id = '{A}'$q$,
 $q$insert into public.suscripciones (organizacion_id, plan_id, estado) select '{A}', id, 'cancelada' from public.planes where codigo = 'certificacion'$q$,
 $q$update public.suscripciones set estado = estado where organizacion_id = '{A}'$q$,
 $q$delete from public.suscripciones where organizacion_id = '{A}'$q$),
(9, 'uso_mensual', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.uso_mensual where organizacion_id = '{A}' and periodo = date '2026-01-01'$q$,
 $q$insert into public.uso_mensual (organizacion_id, periodo) values ('{A}', date '2026-02-01')$q$,
 $q$update public.uso_mensual set envios = envios where organizacion_id = '{A}' and periodo = date '2026-01-01'$q$,
 $q$delete from public.uso_mensual where organizacion_id = '{A}' and periodo = date '2026-01-01'$q$),
-- Pagos (0016)
(10, 'clientes_pago', false, '', 'S', '', '', '', 'S', 'S',
 $q$select count(*) from public.clientes_pago where organizacion_id = '{A}'$q$,
 $q$insert into public.clientes_pago (organizacion_id, proveedor, cliente_externo) values ('{B}', 'flow', 'cus-rls-fase13-b')$q$,
 $q$update public.clientes_pago set tarjeta_marca = tarjeta_marca where organizacion_id = '{A}'$q$,
 $q$delete from public.clientes_pago where organizacion_id = '{A}'$q$),
(11, 'pagos', false, '', 'S', '', '', '', 'S', 'S',
 $q$select count(*) from public.pagos where id = '00000000-0000-4000-8000-0000000130f1'$q$,
 $q$insert into public.pagos (id, organizacion_id, proveedor, factura_externa, monto_clp, estado) values ('00000000-0000-4000-8000-0000000130f2', '{A}', 'flow', 'inv-rls-fase13-2', 1000, 'pendiente')$q$,
 $q$update public.pagos set intentos = intentos where id = '00000000-0000-4000-8000-0000000130f1'$q$,
 $q$delete from public.pagos where id = '00000000-0000-4000-8000-0000000130f1'$q$),
(12, 'eventos_pasarela', false, '', '', '', '', '', '', '',
 $q$select count(*) from public.eventos_pasarela where id = '00000000-0000-4000-8000-0000000131c1'$q$,
 $q$insert into public.eventos_pasarela (proveedor, tipo, token, organizacion_id) values ('flow', 'pago', 'tok-rls-fase13-2', '{A}')$q$,
 $q$update public.eventos_pasarela set intentos = intentos where id = '00000000-0000-4000-8000-0000000131c1'$q$,
 $q$delete from public.eventos_pasarela where id = '00000000-0000-4000-8000-0000000131c1'$q$),
-- Empresas y credenciales
(13, 'empresas', false, '', 'SIUD', '', 'S', 'S', 'SIUD', 'SIUD',
 $q$select count(*) from public.empresas where id = '00000000-0000-4000-8000-000000013e03'$q$,
 $q$insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna) values ('{A}', '44444444-4', 'Empresa rls fase 13 I', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago')$q$,
 $q$update public.empresas set giro = giro where id = '00000000-0000-4000-8000-000000013e03'$q$,
 $q$delete from public.empresas where id = '00000000-0000-4000-8000-000000013e03'$q$),
(14, 'resoluciones', false, '', 'SIUD', '', 'S', 'S', 'SIUD', 'SIUD',
 $q$select count(*) from public.resoluciones where id = '00000000-0000-4000-8000-0000000138a1'$q$,
 $q$insert into public.resoluciones (organizacion_id, empresa_id, ambiente, numero, fecha, vigente) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', 0, date '2026-11-02', false)$q$,
 $q$update public.resoluciones set fecha = fecha where id = '00000000-0000-4000-8000-0000000138a1'$q$,
 $q$delete from public.resoluciones where id = '00000000-0000-4000-8000-0000000138a1'$q$),
(15, 'certificados', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.certificados where id = '00000000-0000-4000-8000-000000013c02'$q$,
 $q$insert into public.certificados (organizacion_id, rut_titular, huella_sha256, pfx_secret_id, clave_secret_id) values ('{A}', '11111111-1', repeat('e3', 32), gen_random_uuid(), gen_random_uuid())$q$,
 $q$update public.certificados set nombre_titular = nombre_titular where id = '00000000-0000-4000-8000-000000013c02'$q$,
 $q$delete from public.certificados where id = '00000000-0000-4000-8000-000000013c02'$q$),
(16, 'empresa_certificados', false, '', 'SIUD', '', 'S', 'S', 'SIUD', 'SIUD',
 $q$select count(*) from public.empresa_certificados where empresa_id = '00000000-0000-4000-8000-000000013e01' and certificado_id = '00000000-0000-4000-8000-000000013c01'$q$,
 $q$insert into public.empresa_certificados (organizacion_id, empresa_id, certificado_id) values ('{A}', '00000000-0000-4000-8000-000000013e01', '00000000-0000-4000-8000-000000013c02')$q$,
 $q$update public.empresa_certificados set es_representante_electronico = es_representante_electronico where empresa_id = '00000000-0000-4000-8000-000000013e01' and certificado_id = '00000000-0000-4000-8000-000000013c01'$q$,
 $q$delete from public.empresa_certificados where empresa_id = '00000000-0000-4000-8000-000000013e01' and certificado_id = '00000000-0000-4000-8000-000000013c01'$q$),
(17, 'tokens_sii', false, '', '', '', '', '', '', '',
 $q$select count(*) from public.tokens_sii where huella_certificado = repeat('13', 32)$q$,
 $q$insert into public.tokens_sii (canal, ambiente, rut_empresa, huella_certificado, token_cifrado, vence_en) values ('rest', 'certificacion', '11111111-1', repeat('31', 32), '\x00'::bytea, now() + interval '1 hour')$q$,
 $q$update public.tokens_sii set vence_en = vence_en where huella_certificado = repeat('13', 32)$q$,
 $q$delete from public.tokens_sii where huella_certificado = repeat('13', 32)$q$),
(18, 'sesiones_sii', false, '', '', '', '', '', '', '',
 $q$select count(*) from public.sesiones_sii where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$,
 $q$insert into public.sesiones_sii (certificado_id, ambiente, cookies_cifradas) values ('00000000-0000-4000-8000-000000013c01', 'produccion', '\x00'::bytea)$q$,
 $q$update public.sesiones_sii set expira_en = expira_en where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$,
 $q$delete from public.sesiones_sii where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$),
(19, 'bloqueos_sii', false, '', '', '', '', '', '', '',
 $q$select count(*) from public.bloqueos_sii where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$,
 $q$insert into public.bloqueos_sii (certificado_id, ambiente, titular, vence_en) values ('00000000-0000-4000-8000-000000013c01', 'produccion', gen_random_uuid(), now() + interval '1 minute')$q$,
 $q$update public.bloqueos_sii set vence_en = vence_en where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$,
 $q$delete from public.bloqueos_sii where certificado_id = '00000000-0000-4000-8000-000000013c01' and ambiente = 'certificacion'$q$),
-- Folios
(20, 'cafs', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.cafs where id = '00000000-0000-4000-8000-000000013f02'$q$,
 $q$insert into public.cafs (organizacion_id, empresa_id, ambiente, tipo_dte, folio_desde, folio_hasta, siguiente_folio, fecha_autorizacion, idk, rut_emisor, caf_secret_id) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', 39, 201, 300, 201, date '2026-11-19', 100, '11111111-1', gen_random_uuid())$q$,
 $q$update public.cafs set razon_social = razon_social where id = '00000000-0000-4000-8000-000000013f02'$q$,
 $q$delete from public.cafs where id = '00000000-0000-4000-8000-000000013f02'$q$),
(21, 'solicitudes_folios', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.solicitudes_folios where id = '00000000-0000-4000-8000-0000000135a1'$q$,
 $q$insert into public.solicitudes_folios (organizacion_id, empresa_id, ambiente, tipo_dte, cantidad, confirmada) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', 39, 5, true)$q$,
 $q$update public.solicitudes_folios set mensaje = mensaje where id = '00000000-0000-4000-8000-0000000135a1'$q$,
 $q$delete from public.solicitudes_folios where id = '00000000-0000-4000-8000-0000000135a1'$q$),
(22, 'folios_anulados', false, '', 'S', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.folios_anulados where id = '00000000-0000-4000-8000-0000000131b1'$q$,
 $q$insert into public.folios_anulados (organizacion_id, caf_id, folio, motivo) values ('{A}', '00000000-0000-4000-8000-000000013f01', 51, 'Prueba rls fase 13 I')$q$,
 $q$update public.folios_anulados set motivo = motivo where id = '00000000-0000-4000-8000-0000000131b1'$q$,
 $q$delete from public.folios_anulados where id = '00000000-0000-4000-8000-0000000131b1'$q$),
-- Catálogo comercial y documentos
(23, 'receptores', false, '', 'SIUD', '', 'S', 'SIU', 'SIUD', 'SIUD',
 $q$select count(*) from public.receptores where id = '00000000-0000-4000-8000-0000000137a1'$q$,
 $q$insert into public.receptores (organizacion_id, empresa_id, rut, razon_social) values ('{A}', '00000000-0000-4000-8000-000000013e01', '66666666-6', 'Receptor rls fase 13 I')$q$,
 $q$update public.receptores set razon_social = razon_social where id = '00000000-0000-4000-8000-0000000137a1'$q$,
 $q$delete from public.receptores where id = '00000000-0000-4000-8000-0000000137a1'$q$),
(24, 'productos', false, '', 'SIUD', '', 'S', 'SIU', 'SIUD', 'SIUD',
 $q$select count(*) from public.productos where id = '00000000-0000-4000-8000-0000000137b1'$q$,
 $q$insert into public.productos (organizacion_id, empresa_id, codigo, nombre, precio_bruto) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'P13-2', 'Producto rls fase 13 I', 1190)$q$,
 $q$update public.productos set nombre = nombre where id = '00000000-0000-4000-8000-0000000137b1'$q$,
 $q$delete from public.productos where id = '00000000-0000-4000-8000-0000000137b1'$q$),
(25, 'documentos', false, '', 'SIUD', '', 'S', 'SIUD', 'SIUD', 'SIUD',
 $q$select count(*) from public.documentos where id = '00000000-0000-4000-8000-000000013d02'$q$,
 $q$insert into public.documentos (organizacion_id, empresa_id, ambiente, tipo_dte, estado) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', 39, 'borrador')$q$,
 $q$update public.documentos set receptor_razon_social = receptor_razon_social where id = '00000000-0000-4000-8000-000000013d02'$q$,
 $q$delete from public.documentos where id = '00000000-0000-4000-8000-000000013d02'$q$),
(26, 'documento_detalles', false, '', 'SIUD', '', 'S', 'SIUD', 'SIUD', 'SIUD',
 $q$select count(*) from public.documento_detalles where id = '00000000-0000-4000-8000-000000013d12'$q$,
 $q$insert into public.documento_detalles (organizacion_id, documento_id, nro_linea, nombre, cantidad, precio, monto_item) values ('{A}', '00000000-0000-4000-8000-000000013d02', 2, 'Línea rls fase 13 I', 1, 100, 100)$q$,
 $q$update public.documento_detalles set nombre = nombre where id = '00000000-0000-4000-8000-000000013d12'$q$,
 $q$delete from public.documento_detalles where id = '00000000-0000-4000-8000-000000013d12'$q$),
-- Envíos, RCOF y certificación
(27, 'envios', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.envios where id = '00000000-0000-4000-8000-000000013e12'$q$,
 $q$insert into public.envios (organizacion_id, empresa_id, ambiente, proposito, rut_envia, nro_resol, fch_resol) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', 'emision', '11111111-1', 0, date '2026-11-01')$q$,
 $q$update public.envios set glosa_sii = glosa_sii where id = '00000000-0000-4000-8000-000000013e12'$q$,
 $q$delete from public.envios where id = '00000000-0000-4000-8000-000000013e12'$q$),
(28, 'envio_estadisticas', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.envio_estadisticas where envio_id = '00000000-0000-4000-8000-000000013e11' and tipo_dte = 39$q$,
 $q$insert into public.envio_estadisticas (organizacion_id, envio_id, tipo_dte) values ('{A}', '00000000-0000-4000-8000-000000013e11', 41)$q$,
 $q$update public.envio_estadisticas set informados = informados where envio_id = '00000000-0000-4000-8000-000000013e11' and tipo_dte = 39$q$,
 $q$delete from public.envio_estadisticas where envio_id = '00000000-0000-4000-8000-000000013e11' and tipo_dte = 39$q$),
(29, 'consultas_envio', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.consultas_envio where envio_id = '00000000-0000-4000-8000-000000013e11'$q$,
 $q$insert into public.consultas_envio (organizacion_id, envio_id, estado_sii) values ('{A}', '00000000-0000-4000-8000-000000013e11', 'REC')$q$,
 $q$update public.consultas_envio set glosa_sii = glosa_sii where envio_id = '00000000-0000-4000-8000-000000013e11'$q$,
 $q$delete from public.consultas_envio where envio_id = '00000000-0000-4000-8000-000000013e11'$q$),
(30, 'envio_rechazos', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.envio_rechazos where id = '00000000-0000-4000-8000-0000000131a1'$q$,
 $q$insert into public.envio_rechazos (organizacion_id, envio_id, tipo_dte, folio, estado, tipo_observacion) values ('{A}', '00000000-0000-4000-8000-000000013e11', 39, 8, 'RCH', 'rechazo')$q$,
 $q$update public.envio_rechazos set descripcion = descripcion where id = '00000000-0000-4000-8000-0000000131a1'$q$,
 $q$delete from public.envio_rechazos where id = '00000000-0000-4000-8000-0000000131a1'$q$),
(31, 'rcof', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.rcof where id = '00000000-0000-4000-8000-0000000131e1'$q$,
 $q$insert into public.rcof (organizacion_id, empresa_id, ambiente, fch_inicio, fch_final, sec_envio, resumenes) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'certificacion', date '2022-07-01', date '2022-07-01', 2, '[]')$q$,
 $q$update public.rcof set resumenes = resumenes where id = '00000000-0000-4000-8000-0000000131e1'$q$,
 $q$delete from public.rcof where id = '00000000-0000-4000-8000-0000000131e1'$q$),
(32, 'procesos_certificacion', false, '', 'SIUD', '', 'S', 'S', 'SIUD', 'SIUD',
 $q$select count(*) from public.procesos_certificacion where id = '00000000-0000-4000-8000-0000000139a2'$q$,
 $q$insert into public.procesos_certificacion (organizacion_id, empresa_id) values ('{A}', '00000000-0000-4000-8000-000000013e03')$q$,
 $q$update public.procesos_certificacion set nombre_software = nombre_software where id = '00000000-0000-4000-8000-0000000139a2'$q$,
 $q$delete from public.procesos_certificacion where id = '00000000-0000-4000-8000-0000000139a2'$q$),
(33, 'set_pruebas_casos', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.set_pruebas_casos where id = '00000000-0000-4000-8000-0000000139b1'$q$,
 $q$insert into public.set_pruebas_casos (organizacion_id, proceso_id, numero_caso, tipo_dte, detalles, referencia_razon) values ('{A}', '00000000-0000-4000-8000-0000000139a1', 2, 39, '[]', 'CASO 2')$q$,
 $q$update public.set_pruebas_casos set detalles = detalles where id = '00000000-0000-4000-8000-0000000139b1'$q$,
 $q$delete from public.set_pruebas_casos where id = '00000000-0000-4000-8000-0000000139b1'$q$),
-- Auditoría e integraciones
(34, 'operaciones_sii', false, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.operaciones_sii where id = '00000000-0000-4000-8000-0000000130a1'$q$,
 $q$insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente) values ('{A}', '00000000-0000-4000-8000-000000013e01', 'verificar_portal', 'certificacion')$q$,
 $q$update public.operaciones_sii set mensaje = mensaje where id = '00000000-0000-4000-8000-0000000130a1'$q$,
 $q$delete from public.operaciones_sii where id = '00000000-0000-4000-8000-0000000130a1'$q$),
(35, 'api_keys', false, '', 'SUD', '', '', '', 'SUD', 'SUD',
 $q$select count(*) from public.api_keys where id = '00000000-0000-4000-8000-0000000130b1'$q$,
 $q$insert into public.api_keys (organizacion_id, nombre, prefijo, clave_hash) values ('{A}', 'Prueba rls fase 13 I', 'sk_test_3131', repeat('31', 32))$q$,
 $q$update public.api_keys set nombre = nombre where id = '00000000-0000-4000-8000-0000000130b1'$q$,
 $q$delete from public.api_keys where id = '00000000-0000-4000-8000-0000000130b1'$q$),
(36, 'webhooks', false, '', 'SUD', '', '', '', 'SUD', 'SUD',
 $q$select count(*) from public.webhooks where id = '00000000-0000-4000-8000-0000000130c2'$q$,
 $q$insert into public.webhooks (organizacion_id, url, eventos, secreto_secret_id) values ('{A}', 'https://receptor-fase13-i.ejemplo.com/hooks', '{documento.aceptado}', gen_random_uuid())$q$,
 $q$update public.webhooks set activo = activo where id = '00000000-0000-4000-8000-0000000130c2'$q$,
 $q$delete from public.webhooks where id = '00000000-0000-4000-8000-0000000130c2'$q$),
(37, 'webhook_entregas', false, '', 'SIUD', '', '', '', 'S', 'S',
 $q$select count(*) from public.webhook_entregas where organizacion_id = '{A}' and webhook_id = '00000000-0000-4000-8000-0000000130c1'$q$,
 $q$insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload) values ('{A}', '00000000-0000-4000-8000-0000000130c1', 'documento.aceptado', '{}')$q$,
 $q$update public.webhook_entregas set intentos = intentos where organizacion_id = '{A}' and webhook_id = '00000000-0000-4000-8000-0000000130c1'$q$,
 $q$delete from public.webhook_entregas where organizacion_id = '{A}' and webhook_id = '00000000-0000-4000-8000-0000000130c1'$q$),
(38, 'notificaciones', false, '', 'S', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.notificaciones where id = '00000000-0000-4000-8000-0000000130d1'$q$,
 $q$insert into public.notificaciones (organizacion_id, tipo, clave) values ('{A}', 'documento.rechazado', 'documento.rechazado:rls-fase13-2')$q$,
 $q$update public.notificaciones set intentos = intentos where id = '00000000-0000-4000-8000-0000000130d1'$q$,
 $q$delete from public.notificaciones where id = '00000000-0000-4000-8000-0000000130d1'$q$),
(39, 'api_idempotencia', false, '', '', '', '', '', '', '',
 $q$select count(*) from public.api_idempotencia where organizacion_id = '{A}' and clave = 'fase13-1'$q$,
 $q$insert into public.api_idempotencia (organizacion_id, clave, recurso, huella) values ('{A}', 'fase13-2', 'documento', repeat('ab', 32))$q$,
 $q$update public.api_idempotencia set reclamada_en = reclamada_en where organizacion_id = '{A}' and clave = 'fase13-1'$q$,
 $q$delete from public.api_idempotencia where organizacion_id = '{A}' and clave = 'fase13-1'$q$),
-- Vistas (security_invoker: el RLS de las tablas de origen; solo select)
(40, 'v_folios_disponibles', true, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.v_folios_disponibles where organizacion_id = '{A}'$q$, null, null, null),
(41, 'v_certificados_estado', true, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.v_certificados_estado where organizacion_id = '{A}'$q$, null, null, null),
(42, 'v_envios_por_consultar', true, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.v_envios_por_consultar where organizacion_id = '{A}'$q$, null, null, null),
(43, 'v_ventas_diarias', true, '', 'SIUD', '', 'S', 'S', 'S', 'S',
 $q$select count(*) from public.v_ventas_diarias where organizacion_id = '{A}'$q$, null, null, null);

-- Corre los casos con el rol de la sesión y guarda la celda observada.
create function pg_temp.correr(p_rol text)
returns void
language plpgsql
as $$
declare
  c   record;
  s   text;
  i   text;
  u   text;
  d   text;
begin
  for c in select * from casos order by orden loop
    s := pg_temp.valor(pg_temp.sql(c.sql_s));
    if c.vista then
      insert into observado values (c.orden, p_rol, pg_temp.celda_s(s) || '···', 'S=' || s);
    else
      i := pg_temp.probar(pg_temp.sql(c.sql_i));
      u := pg_temp.probar(pg_temp.sql(c.sql_u));
      d := pg_temp.probar(pg_temp.sql(c.sql_d));
      insert into observado values (
        c.orden, p_rol,
        pg_temp.celda_s(s) || pg_temp.celda(i, 'I') || pg_temp.celda(u, 'U') || pg_temp.celda(d, 'D'),
        'S=' || s || ' | I=' || i || ' | U=' || u || ' | D=' || d);
    end if;
  end loop;
end;
$$;
grant execute on function pg_temp.correr(text) to authenticated, anon, service_role;

-- Usuarios ficticios.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000013a01', 'rls13-propietario-a@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario A"}'),
  ('00000000-0000-4000-8000-000000013a02', 'rls13-administrador-a@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Administrador A"}'),
  ('00000000-0000-4000-8000-000000013a03', 'rls13-emisor-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Emisor A"}'),
  ('00000000-0000-4000-8000-000000013a04', 'rls13-lector-a@ejemplo.invalid',        'authenticated', 'authenticated', '{"nombre":"Lector A"}'),
  ('00000000-0000-4000-8000-000000013a05', 'rls13-x@ejemplo.invalid',               'authenticated', 'authenticated', '{"nombre":"X"}'),
  ('00000000-0000-4000-8000-000000013a06', 'rls13-y@ejemplo.invalid',               'authenticated', 'authenticated', '{"nombre":"Y"}'),
  ('00000000-0000-4000-8000-000000013a07', 'rls13-z@ejemplo.invalid',               'authenticated', 'authenticated', '{"nombre":"Z"}'),
  ('00000000-0000-4000-8000-000000013b01', 'rls13-propietario-b@ejemplo.invalid',   'authenticated', 'authenticated', '{"nombre":"Propietario B"}');
delete from public.perfiles where id = '00000000-0000-4000-8000-000000013a07';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013a01","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_a', public.crear_organizacion('Prueba rls Fase 13 A', 'zz-prueba-rls-fase13-a')::text, true);

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013b01","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org_b', public.crear_organizacion('Prueba rls Fase 13 B', 'zz-prueba-rls-fase13-b')::text, true);

reset role;
select set_config('request.jwt.claims', '', true);

-- Datos de A (como postgres, sin claims: el backend). Sin captura de errores: si algo
-- falla, el script entero falla y no queda nada.
do $$
declare
  a uuid := current_setting('prueba.org_a')::uuid;
  p text := '00000000-0000-4000-8000-000000013';
begin
  -- Plan sin límites (empresa) para que los límites de empresas y usuarios no interfieran.
  update public.suscripciones
  set plan_id = (select id from public.planes where codigo = 'empresa'), estado = 'activa'
  where organizacion_id = a;

  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol) values
    (a, (p || 'a02')::uuid, 'administrador'),
    (a, (p || 'a03')::uuid, 'emisor'),
    (a, (p || 'a04')::uuid, 'lector'),
    (a, (p || 'a05')::uuid, 'emisor');

  insert into public.empresas (id, organizacion_id, rut, razon_social, giro, direccion, comuna) values
    ((p || 'e01')::uuid, a, '11111111-1', 'Empresa rls fase 13 E1', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago'),
    ((p || 'e02')::uuid, a, '22222222-2', 'Empresa rls fase 13 E2', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago'),
    ((p || 'e03')::uuid, a, '33333333-3', 'Empresa rls fase 13 E3', 'Servicios de prueba', 'Calle Falsa 123', 'Santiago');

  insert into public.certificados (id, organizacion_id, rut_titular, huella_sha256, pfx_secret_id, clave_secret_id, vigente_hasta) values
    ((p || 'c01')::uuid, a, '11111111-1', repeat('c1', 32), gen_random_uuid(), gen_random_uuid(), now() + interval '1 year'),
    ((p || 'c02')::uuid, a, '11111111-1', repeat('c2', 32), gen_random_uuid(), gen_random_uuid(), now() + interval '1 year');

  insert into public.empresa_certificados (organizacion_id, empresa_id, certificado_id)
  values (a, (p || 'e01')::uuid, (p || 'c01')::uuid);

  insert into public.resoluciones (id, organizacion_id, empresa_id, ambiente, numero, fecha, vigente)
  values ((p || '8a1')::uuid, a, (p || 'e01')::uuid, 'certificacion', 0, date '2026-11-01', false);

  insert into public.cafs (id, organizacion_id, empresa_id, ambiente, tipo_dte, folio_desde, folio_hasta,
                           siguiente_folio, fecha_autorizacion, idk, rut_emisor, caf_secret_id) values
    ((p || 'f01')::uuid, a, (p || 'e01')::uuid, 'certificacion', 39, 1, 100, 2, date '2026-11-19', 100, '11111111-1', gen_random_uuid()),
    ((p || 'f02')::uuid, a, (p || 'e01')::uuid, 'certificacion', 39, 101, 200, 101, date '2026-11-19', 100, '11111111-1', gen_random_uuid());

  insert into public.solicitudes_folios (id, organizacion_id, empresa_id, ambiente, tipo_dte, cantidad, confirmada)
  values ((p || '5a1')::uuid, a, (p || 'e01')::uuid, 'certificacion', 39, 5, true);

  insert into public.folios_anulados (id, organizacion_id, caf_id, folio, motivo)
  values ((p || '1b1')::uuid, a, (p || 'f01')::uuid, 50, 'Prueba rls fase 13');

  insert into public.receptores (id, organizacion_id, empresa_id, rut, razon_social)
  values ((p || '7a1')::uuid, a, (p || 'e01')::uuid, '55555555-5', 'Receptor rls fase 13');
  insert into public.productos (id, organizacion_id, empresa_id, codigo, nombre, precio_bruto)
  values ((p || '7b1')::uuid, a, (p || 'e01')::uuid, 'P13-1', 'Producto rls fase 13', 1190);

  insert into public.envios (id, organizacion_id, empresa_id, ambiente, proposito, rut_envia, certificado_id,
                             nro_resol, fch_resol, track_id, enviado_en, estado_sii) values
    ((p || 'e11')::uuid, a, (p || 'e01')::uuid, 'certificacion', 'emision', '11111111-1', (p || 'c01')::uuid,
     0, date '2026-11-01', '1313', now() - interval '1 hour', 'REC'),
    ((p || 'e12')::uuid, a, (p || 'e01')::uuid, 'certificacion', 'emision', '11111111-1', null,
     0, date '2026-11-01', null, null, null);

  -- Sin envio_id: si colgara de E11, el trigger de envio_rechazos (sincronizar_documentos_envio)
  -- lo pasaría a `enviado` y v_ventas_diarias (solo aceptados) quedaría vacía.
  insert into public.documentos (id, organizacion_id, empresa_id, ambiente, tipo_dte, folio, caf_id, estado,
                                 mnt_neto, iva, mnt_total) values
    ((p || 'd01')::uuid, a, (p || 'e01')::uuid, 'certificacion', 39, 1, (p || 'f01')::uuid, 'aceptado',
     840, 160, 1000);
  insert into public.documentos (id, organizacion_id, empresa_id, ambiente, tipo_dte, estado)
  values ((p || 'd02')::uuid, a, (p || 'e01')::uuid, 'certificacion', 39, 'borrador');

  insert into public.documento_detalles (id, organizacion_id, documento_id, nro_linea, nombre, cantidad, precio, monto_item) values
    ((p || 'd11')::uuid, a, (p || 'd01')::uuid, 1, 'Línea con folio', 1, 1000, 1000),
    ((p || 'd12')::uuid, a, (p || 'd02')::uuid, 1, 'Línea de borrador', 1, 1000, 1000);

  insert into public.envio_estadisticas (organizacion_id, envio_id, tipo_dte, informados)
  values (a, (p || 'e11')::uuid, 39, 1);
  insert into public.consultas_envio (organizacion_id, envio_id, estado_sii)
  values (a, (p || 'e11')::uuid, 'REC');
  insert into public.envio_rechazos (id, organizacion_id, envio_id, tipo_dte, folio, estado, tipo_observacion)
  values ((p || '1a1')::uuid, a, (p || 'e11')::uuid, 39, 7, 'RCH', 'rechazo');
  insert into public.rcof (id, organizacion_id, empresa_id, ambiente, fch_inicio, fch_final, sec_envio, resumenes)
  values ((p || '1e1')::uuid, a, (p || 'e01')::uuid, 'certificacion', date '2022-07-01', date '2022-07-01', 1, '[]');

  insert into public.procesos_certificacion (id, organizacion_id, empresa_id) values
    ((p || '9a1')::uuid, a, (p || 'e01')::uuid),
    ((p || '9a2')::uuid, a, (p || 'e02')::uuid);
  insert into public.set_pruebas_casos (id, organizacion_id, proceso_id, numero_caso, tipo_dte, detalles, referencia_razon)
  values ((p || '9b1')::uuid, a, (p || '9a1')::uuid, 1, 39, '[]', 'CASO 1');

  insert into public.operaciones_sii (id, organizacion_id, empresa_id, operacion, ambiente, resultado, terminada_en)
  values ((p || '0a1')::uuid, a, (p || 'e01')::uuid, 'verificar_portal', 'certificacion', 'ok', now());

  insert into public.api_keys (id, organizacion_id, nombre, prefijo, clave_hash)
  values ((p || '0b1')::uuid, a, 'Prueba rls fase 13', 'sk_test_1313', repeat('13', 32));
  insert into public.webhooks (id, organizacion_id, url, eventos, secreto_secret_id) values
    ((p || '0c1')::uuid, a, 'https://receptor-fase13-1.ejemplo.com/hooks', '{documento.aceptado}', gen_random_uuid()),
    ((p || '0c2')::uuid, a, 'https://receptor-fase13-2.ejemplo.com/hooks', '{documento.aceptado}', gen_random_uuid());
  insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload)
  values (a, (p || '0c1')::uuid, 'documento.aceptado', '{}');

  insert into public.notificaciones (id, organizacion_id, tipo, clave)
  values ((p || '0d1')::uuid, a, 'documento.rechazado', 'documento.rechazado:rls-fase13-1');
  insert into public.api_idempotencia (organizacion_id, clave, recurso, huella)
  values (a, 'fase13-1', 'documento', repeat('ab', 32));

  insert into public.clientes_pago (organizacion_id, proveedor, cliente_externo)
  values (a, 'flow', 'cus-rls-fase13-a');
  insert into public.pagos (id, organizacion_id, proveedor, factura_externa, monto_clp, estado)
  values ((p || '0f1')::uuid, a, 'flow', 'inv-rls-fase13-1', 1000, 'pendiente');
  insert into public.eventos_pasarela (id, proveedor, tipo, token, organizacion_id)
  values ((p || '1c1')::uuid, 'flow', 'pago', 'tok-rls-fase13-1', a);

  insert into public.invitaciones (id, organizacion_id, correo, rol, token_hash)
  values ((p || '0e1')::uuid, a, 'rls13-invitado@ejemplo.invalid', 'lector', repeat('e1', 32));

  insert into public.uso_mensual (organizacion_id, periodo) values (a, date '2026-01-01');

  insert into public.tipos_dte (codigo, nombre, afecto_iva) values (998, 'Prueba rls fase 13', true);
  insert into public.estados_sii (codigo, glosa) values ('ZZ8', 'Prueba rls fase 13');
  insert into public.planes (codigo, nombre, activo) values ('zz-fase13', 'Prueba rls fase 13', true);

  insert into public.tokens_sii (canal, ambiente, rut_empresa, huella_certificado, token_cifrado, vence_en)
  values ('rest', 'certificacion', '11111111-1', repeat('13', 32), '\x00'::bytea, now() + interval '1 hour');
  insert into public.sesiones_sii (certificado_id, ambiente, cookies_cifradas)
  values ((p || 'c01')::uuid, 'certificacion', '\x00'::bytea);
  insert into public.bloqueos_sii (certificado_id, ambiente, titular, vence_en)
  values ((p || 'c01')::uuid, 'certificacion', gen_random_uuid(), now() + interval '1 minute');
end $$;

-- Como postgres, cada fila objetivo existe (si no, un 0 se leería como «RLS la oculta»).
select pg_temp.registrar(0, 'preparación: como postgres, la fila objetivo de cada tabla y vista existe (select = S en los 43 casos)',
  (select count(*) from casos c where pg_temp.celda_s(pg_temp.valor(pg_temp.sql(c.sql_s))) = 'S') = 43,
  (select string_agg(c.tabla, ', ' order by c.orden) from casos c
    where pg_temp.celda_s(pg_temp.valor(pg_temp.sql(c.sql_s))) <> 'S'));

-- ---------------------------------------------------------------------------
-- 1. anon
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.correr('anon');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Otra organización (propietario de B, sin membresía en A)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013b01","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.correr('otra');

select pg_temp.registrar(44, 'otra organización: la sesión funciona (ve su organización B y su suscripción), y actualiza su propio perfil (1 fila)',
  pg_temp.valor($q$select count(*) from public.organizaciones where slug = 'zz-prueba-rls-fase13-b'$q$) = '1'
  and pg_temp.valor($q$select count(*) from public.suscripciones where organizacion_id = '$q$ || current_setting('prueba.org_b') || $q$'$q$) = '1'
  and pg_temp.probar($q$update public.perfiles set nombre = nombre where id = (select auth.uid())$q$) = 'ok:1',
  pg_temp.probar($q$update public.perfiles set nombre = nombre where id = (select auth.uid())$q$));
reset role;

-- ---------------------------------------------------------------------------
-- 3. Lector de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013a04","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.correr('lector');

do $$
declare
  u text := pg_temp.probar($q$update public.perfiles set nombre = nombre where id = (select auth.uid())$q$);
  i text := pg_temp.probar($q$insert into public.perfiles (id, nombre) values ((select auth.uid()), 'otro')$q$);
  d text := pg_temp.probar($q$delete from public.perfiles where id = (select auth.uid())$q$);
begin
  perform pg_temp.registrar(45, 'perfiles, notas 2 y 3: el lector edita su propio perfil (1 fila); no inserta (42501) ni borra (0 filas) perfiles, tampoco el suyo',
    u = 'ok:1' and i like '42501%' and d = 'ok:0',
    'U=' || u || ' | I=' || i || ' | D=' || d);
end $$;

do $$
declare
  d text := pg_temp.probar($q$delete from public.miembros_organizacion where usuario_id = (select auth.uid()) and organizacion_id = '$q$
                           || current_setting('prueba.org_a') || $q$'$q$);
  u text := pg_temp.probar($q$update public.miembros_organizacion set rol = 'administrador' where usuario_id = (select auth.uid())$q$);
begin
  perform pg_temp.registrar(46, 'miembros_organizacion, nota 4: el lector sale de la organización (borra su propia fila, 1) pero no cambia su rol (0 filas)',
    d = 'ok:1' and u = 'ok:0',
    'D propia=' || d || ' | U propia=' || u);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Emisor de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013a03","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.correr('emisor');

do $$
declare
  u  text := pg_temp.probar($q$update public.documentos set receptor_razon_social = receptor_razon_social where id = '00000000-0000-4000-8000-000000013d01'$q$);
  d  text := pg_temp.probar($q$delete from public.documentos where id = '00000000-0000-4000-8000-000000013d01'$q$);
  ul text := pg_temp.probar($q$update public.documento_detalles set nombre = nombre where id = '00000000-0000-4000-8000-000000013d11'$q$);
  i  text := pg_temp.probar($q$insert into public.documentos (organizacion_id, empresa_id, ambiente, tipo_dte, folio, caf_id, estado, mnt_neto, iva, mnt_total)
                               values ('$q$ || current_setting('prueba.org_a') || $q$', '00000000-0000-4000-8000-000000013e01', 'certificacion', 39, 2,
                                       '00000000-0000-4000-8000-000000013f01', 'firmado', 840, 160, 1000)$q$);
  -- Con su CAF, para que tg_validar_documento (BEFORE, corre antes del WITH CHECK) no lo rechace primero.
  b  text := pg_temp.probar($q$update public.documentos set estado = 'firmado', folio = 2, caf_id = '00000000-0000-4000-8000-000000013f01',
                                      mnt_neto = 840, iva = 160, mnt_total = 1000
                               where id = '00000000-0000-4000-8000-000000013d02'$q$);
begin
  perform pg_temp.registrar(47, 'documentos y detalles, notas 9 y 10: el emisor no edita ni borra un documento con folio ni sus líneas (0 filas), no inserta uno con folio ni firma un borrador con su sesión (42501)',
    u = 'ok:0' and d = 'ok:0' and ul = 'ok:0' and i like '42501%' and b like '42501%',
    'U=' || u || ' | D=' || d || ' | U línea=' || ul || ' | I con folio=' || i || ' | firmar borrador=' || b);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Administrador de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013a02","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.correr('admin');

do $$
declare
  u text := pg_temp.probar($q$update public.miembros_organizacion set rol = 'lector' where usuario_id = '00000000-0000-4000-8000-000000013a01'$q$);
  d text := pg_temp.probar($q$delete from public.miembros_organizacion where usuario_id = '00000000-0000-4000-8000-000000013a01'$q$);
  i text := pg_temp.probar($q$insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
                              values ('$q$ || current_setting('prueba.org_a') || $q$', '00000000-0000-4000-8000-000000013a06', 'propietario')$q$);
  a text := pg_temp.probar($q$update public.miembros_organizacion set rol = 'propietario' where usuario_id = '00000000-0000-4000-8000-000000013a05'$q$);
begin
  perform pg_temp.registrar(48, 'miembros_organizacion, nota 5: el administrador no cambia ni quita al propietario (0 filas), no agrega un propietario ni asciende a nadie a propietario (42501)',
    u = 'ok:0' and d = 'ok:0' and i like '42501%' and a like '42501%',
    'U prop=' || u || ' | D prop=' || d || ' | I prop=' || i || ' | ascender=' || a);
end $$;

do $$
declare
  n text := pg_temp.probar($q$update public.api_keys set nombre = nombre, revocada_en = revocada_en where id = '00000000-0000-4000-8000-0000000130b1'$q$);
  e text := pg_temp.probar($q$update public.api_keys set expira_en = now() + interval '1 day' where id = '00000000-0000-4000-8000-0000000130b1'$q$);
  w text := pg_temp.probar($q$update public.webhooks set url = url, eventos = eventos, activo = activo where id = '00000000-0000-4000-8000-0000000130c2'$q$);
  s text := pg_temp.probar($q$update public.webhooks set secreto_secret_id = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000130c2'$q$);
begin
  perform pg_temp.registrar(49, 'api_keys y webhooks, notas 12 y 13: el administrador edita solo nombre y revocada_en de una clave (expira_en da 42501 desde la 0018) y url, eventos y activo de un webhook (el secreto, 42501)',
    n = 'ok:1' and e like '42501%' and w = 'ok:1' and s like '42501%',
    'clave nombre/revocada=' || n || ' | clave expira_en=' || e || ' | webhook url/eventos/activo=' || w || ' | webhook secreto=' || s);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Propietario de A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000013a01","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.correr('prop');

do $$
declare
  i text := pg_temp.probar($q$insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
                              values ('$q$ || current_setting('prueba.org_a') || $q$', '00000000-0000-4000-8000-000000013a06', 'propietario')$q$);
  d text := pg_temp.probar($q$delete from public.miembros_organizacion where usuario_id = (select auth.uid())$q$);
begin
  perform pg_temp.registrar(50, 'miembros_organizacion, nota 6: el propietario nombra a otro propietario (1 fila), pero no puede quitarse siendo el último (error de tg_proteger_ultimo_propietario)',
    i = 'ok:1' and d not like 'ok:%' and d not like '42501%',
    'I prop=' || i || ' | D último prop=' || d);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. service_role
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.correr('service');
reset role;
select set_config('request.jwt.claims', '', true);

-- Privilegios de tabla de anon y authenticated contra la página (párrafo «Cómo se
-- decide»): anon solo select en los 3 catálogos; authenticated sin nada en las 5 tablas
-- solo de backend, solo select en las 4 de lectura y select + delete en invitaciones,
-- api_keys y webhooks (update solo de columnas en las dos últimas).
select pg_temp.registrar(51, 'privilegios de tabla: anon solo select en tipos_dte, estados_sii y planes; authenticated sin nada en tokens_sii, sesiones_sii, bloqueos_sii, eventos_pasarela y api_idempotencia; solo select en folios_anulados, notificaciones, clientes_pago y pagos; select y delete (sin update de tabla) en invitaciones, api_keys y webhooks',
  (select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
           or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete')))
    = 'estados_sii,planes,tipos_dte'
  and (select bool_and(not has_table_privilege('anon', t, 'insert') and not has_table_privilege('anon', t, 'update')
                       and not has_table_privilege('anon', t, 'delete'))
       from unnest(array['public.tipos_dte', 'public.estados_sii', 'public.planes']::regclass[]) t)
  and (select bool_and(not has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                       and not has_table_privilege('authenticated', t, 'update') and not has_table_privilege('authenticated', t, 'delete'))
       from unnest(array['public.tokens_sii', 'public.sesiones_sii', 'public.bloqueos_sii', 'public.eventos_pasarela',
                         'public.api_idempotencia']::regclass[]) t)
  and (select bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                       and not has_table_privilege('authenticated', t, 'update') and not has_table_privilege('authenticated', t, 'delete'))
       from unnest(array['public.folios_anulados', 'public.notificaciones', 'public.clientes_pago', 'public.pagos']::regclass[]) t)
  and (select bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                       and not has_table_privilege('authenticated', t, 'update') and has_table_privilege('authenticated', t, 'delete'))
       from unnest(array['public.invitaciones', 'public.api_keys', 'public.webhooks']::regclass[]) t)
  and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity) = 39
  and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') = 39,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity)::text
  || ' tablas con RLS de ' || (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r')::text);

-- ---------------------------------------------------------------------------
-- Matriz: una fila por tabla o vista (1-43)
-- ---------------------------------------------------------------------------

insert into resultados (n, verificacion, ok, detalle)
select c.orden,
       c.tabla || ': anon ' || e.anon || ' · otra ' || e.otra || ' · lector ' || e.lector || ' · emisor ' || e.emisor
         || ' · admin ' || e.admin || ' · prop ' || e.prop || ' · service ' || e.service,
       bool_and(o.celda = case o.rol when 'anon' then e.anon when 'otra' then e.otra when 'lector' then e.lector
                                     when 'emisor' then e.emisor when 'admin' then e.admin when 'prop' then e.prop
                                     else e.service end)
         and count(o.*) = 7,
       coalesce(string_agg(o.rol || ': observado ' || o.celda || ' ≠ esperado '
                           || case o.rol when 'anon' then e.anon when 'otra' then e.otra when 'lector' then e.lector
                                         when 'emisor' then e.emisor when 'admin' then e.admin when 'prop' then e.prop
                                         else e.service end || ' (' || o.crudo || ')', ' || ')
                  filter (where o.celda <> case o.rol when 'anon' then e.anon when 'otra' then e.otra when 'lector' then e.lector
                                                      when 'emisor' then e.emisor when 'admin' then e.admin when 'prop' then e.prop
                                                      else e.service end),
                count(o.*)::text || ' roles corridos')
from casos c
cross join lateral (
  select pg_temp.esperado(c.anon, c.anon, c.vista)  as anon,
         pg_temp.esperado(c.otra, c.priv, c.vista)   as otra,
         pg_temp.esperado(c.lector, c.priv, c.vista) as lector,
         pg_temp.esperado(c.emisor, c.priv, c.vista) as emisor,
         pg_temp.esperado(c.admin, c.priv, c.vista)  as admin,
         pg_temp.esperado(c.prop, c.priv, c.vista)   as prop,
         pg_temp.esperado('SIUD', 'SIUD', c.vista)   as service
) e
left join observado o on o.orden = c.orden
group by c.orden, c.tabla, e.anon, e.otra, e.lector, e.emisor, e.admin, e.prop, e.service;

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuarios, organizaciones ni filas de prueba
