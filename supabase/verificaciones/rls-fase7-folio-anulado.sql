-- Simulación de la migración 0012: un documento no recibe un folio anulado.
--
-- Criterio: el riesgo de la Fase 6 (un folio asignado por asignar_folio cuyo documento aún no
-- existe se anula con anular_folios, y el documento entra después con ese folio) se rechaza
-- en la base; insertar un documento con un folio anulado, o fijarle/cambiarle el folio a uno
-- anulado, da 23514; con un folio no anulado entra; un update que no cambia folio ni CAF
-- (el `estado = 'anulado'` que hace envio-set.ts después de anular los folios del set) sí
-- pasa; un folio anulado en otro CAF con el mismo número no afecta. 9 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0012 APLICADA (y la 0011, por anular_folios). Sin la 0012 el script
-- corre igual (cada paso captura su error) y da 5/9: salen false la 2 (el documento entra con
-- el folio anulado: el riesgo de la Fase 6), la 6 y la 7 (chocan con ese documento en la llave
-- única, no con la regla) y la 9.
--
-- La concurrencia (el `for key share` sobre el CAF antes de leer folios_anulados, que se
-- serializa con el `for update` de anular_folios) no se puede probar con una sola sesión:
-- aquí se prueba la regla en secuencia y el razonamiento está en el encabezado de la 0012.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase6-folios.sql): crea un usuario ficticio (folan-…@ejemplo.invalid), una
-- organización, una empresa, CAF de MENTIRA por registrar_caf (con su secreto de prueba en
-- Vault), documentos y folios anulados, y al final deshace todo. Los documentos quedan en
-- `firmado` o `anulado`, que no encolan webhooks; no llama a pg_net. De Vault solo cuenta
-- filas por descripción.
--
-- Cómo correrlo (con la 0012 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación (ok = true / false
--      con el detalle).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from auth.users where email like 'folan-%@ejemplo.invalid') as usuarios,
--          (select count(*) from public.organizaciones where slug like 'zz-prueba-folio-anulado%') as organizaciones,
--          (select count(*) from public.empresas where razon_social like 'Empresa folio anulado%') as empresas,
--          (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
--      (`secretos`: el mismo número que antes de correrlo.)
--
-- Los documentos con folio los escribe el backend (service_role), como en la emisión y el set
-- de pruebas; el administrador anula con su sesión (anular_folios).
--
-- Datos (empresa de prueba, certificación):
--   CAF39 tipo 39 folios 1 a 10; CAF41 tipo 41 folios 1 a 10.
--   asignar_folio entrega 6 folios de CAF39 (siguiente_folio queda en 7).
--   El administrador anula el 3 de CAF39 (caso a: asignado, sin documento) y la cola completa
--   de CAF41 (1 a 10, caso b), así el 6 queda anulado en el tipo 41.

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

-- Inserta un documento firmado con folio del CAF dado y devuelve 'ok:<id>' o '<sqlstate> <mensaje>'.
create function pg_temp.documento(p_caf uuid, p_tipo smallint, p_folio integer)
returns text
language plpgsql
as $$
declare
  v uuid;
begin
  insert into public.documentos (organizacion_id, empresa_id, ambiente, tipo_dte, folio, caf_id, estado,
                                 mnt_neto, iva, mnt_total)
  values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 'certificacion',
          p_tipo, p_folio, p_caf, 'firmado', 840, 160, 1000)
  returning id into v;
  return 'ok:' || v;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.documento(uuid, smallint, integer) to authenticated, anon, service_role;

-- Documentos de la empresa de prueba con ese folio y tipo (sin RLS).
create function pg_temp.documentos_con(p_tipo smallint, p_folio integer)
returns bigint
language sql
security definer
as $$
  select count(*) from public.documentos
  where empresa_id = current_setting('prueba.emp')::uuid and tipo_dte = p_tipo and folio = p_folio;
$$;
grant execute on function pg_temp.documentos_con(smallint, integer) to authenticated, anon, service_role;

create function pg_temp.caf(p_tipo smallint)
returns uuid
language sql
as $$
  select public.registrar_caf(current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid,
                              'certificacion', p_tipo, 1, 10, date '2026-11-15', 100::smallint,
                              '11111111-1', 'EMPRESA FOLIO ANULADO',
                              '<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>',
                              null);
$$;
grant execute on function pg_temp.caf(smallint) to authenticated, anon, service_role;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000007a1', 'folan-propietario@ejemplo.invalid', 'authenticated', 'authenticated', '{"nombre":"Propietario"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.org', public.crear_organizacion('Prueba folio anulado Fase 7', 'zz-prueba-folio-anulado')::text, true);

reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v uuid;
begin
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org')::uuid, '11111111-1', 'Empresa folio anulado', 'Servicios de prueba',
          'Calle Falsa 123', 'Santiago')
  returning id into v;
  perform set_config('prueba.emp', v::text, true);
end $$;

-- Como service_role: los dos CAF y 6 folios asignados de CAF39.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('prueba.caf39', pg_temp.caf(39::smallint)::text, true);
select set_config('prueba.caf41', pg_temp.caf(41::smallint)::text, true);
do $$
declare
  v_folios text := '';
  v_folio  integer;
begin
  for i in 1 .. 6 loop
    select a.folio into v_folio
    from public.asignar_folio(current_setting('prueba.emp')::uuid, 'certificacion', 39::smallint) a;
    v_folios := v_folios || case when i > 1 then ',' else '' end || v_folio;
  end loop;
  perform set_config('prueba.asignados', v_folios, true);
end $$;

-- El propietario (administrador) anula con su sesión el 3 de CAF39 y la cola de CAF41.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.anulados',
  public.anular_folios(current_setting('prueba.caf39')::uuid, 3, 3, 'Folio saltado')::text || ','
  || public.anular_folios(current_setting('prueba.caf41')::uuid, 1, 10, 'Cola del tipo 41')::text, true);

reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(1, 'preparación: CAF39 con 6 folios asignados (1-6) y el 3 anulado; CAF41 con su cola completa (1-10) anulada; sin documentos',
  current_setting('prueba.asignados') = '1,2,3,4,5,6'
  and current_setting('prueba.anulados') = '1,10'
  and (select count(*) from public.documentos where empresa_id = current_setting('prueba.emp')::uuid) = 0,
  'asignados ' || current_setting('prueba.asignados') || '; anulados ' || current_setting('prueba.anulados'));

-- ---------------------------------------------------------------------------
-- 1. Insertar documentos (como service_role, el backend)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  r text := pg_temp.documento(current_setting('prueba.caf39')::uuid, 39::smallint, 3);
begin
  perform pg_temp.registrar(2, 'el riesgo de la Fase 6: folio 3 asignado, anulado antes de que exista su documento; insertar el documento da 23514 (con el folio y la pista) y no entra',
    r like '23514 %' and r like '%folio 3%' and pg_temp.documentos_con(39::smallint, 3) = 0, r);
end $$;

do $$
declare
  r text := pg_temp.documento(current_setting('prueba.caf39')::uuid, 39::smallint, 4);
begin
  perform set_config('prueba.doc4', substr(r, 4), true);
  perform pg_temp.registrar(3, 'con un folio no anulado (4) el documento entra',
    r like 'ok:%' and pg_temp.documentos_con(39::smallint, 4) = 1, r);
end $$;

do $$
declare
  r text := pg_temp.documento(current_setting('prueba.caf39')::uuid, 39::smallint, 6);
begin
  perform pg_temp.registrar(4, 'un folio anulado en otro CAF con el mismo número (el 6 del tipo 41) no afecta al tipo 39',
    r like 'ok:%' and pg_temp.documentos_con(39::smallint, 6) = 1, r);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Updates
-- ---------------------------------------------------------------------------

-- Como envio-set.ts: documento con folio 2, después el folio va a folios_anulados (insert
-- directo con service_role) y el documento pasa a anulado.
do $$
declare
  r   text := pg_temp.documento(current_setting('prueba.caf39')::uuid, 39::smallint, 2);
  v_id uuid;
  v_ok boolean := false;
  v_det text;
begin
  v_id := substr(r, 4)::uuid;
  update public.documentos set estado = 'anulado' where id = v_id;
  insert into public.folios_anulados (organizacion_id, caf_id, folio, motivo)
  values (current_setting('prueba.org')::uuid, current_setting('prueba.caf39')::uuid, 2,
          'El set no se alcanzó a enviar al SII.');
  -- Otro update de estado, y uno que repite el mismo folio y CAF en el SET (dispara el
  -- trigger, pero no fija un folio nuevo).
  update public.documentos set estado = 'anulado', metadata = '{"prueba": 1}' where id = v_id;
  update public.documentos set folio = folio, caf_id = caf_id where id = v_id;
  v_ok := (select estado = 'anulado' and folio = 2 from public.documentos where id = v_id);
  perform pg_temp.registrar(5, 'un documento cuyo folio se anuló después (como envio-set.ts): los updates de estado y uno con el mismo folio y CAF pasan',
    v_ok, r);
exception when others then
  get stacked diagnostics v_det = message_text;
  perform pg_temp.registrar(5, 'un documento cuyo folio se anuló después (como envio-set.ts): los updates de estado y uno con el mismo folio y CAF pasan',
    false, sqlstate || ' ' || v_det);
end $$;

do $$
declare
  v_estado text := 'no';
begin
  begin
    update public.documentos set folio = 3 where id = current_setting('prueba.doc4')::uuid;
  exception when others then
    v_estado := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.registrar(6, 'cambiar el folio de un documento (4 → 3, anulado) da 23514 y el documento conserva el 4',
    v_estado like '23514 %'
    and (select folio = 4 from public.documentos where id = current_setting('prueba.doc4')::uuid),
    v_estado);
end $$;

-- Flujo de la Fase 7: borrador sin folio y después se le fija el folio.
do $$
declare
  v_id uuid;
  v_r1 text := 'no';
  v_r2 text := 'no';
begin
  insert into public.documentos (organizacion_id, empresa_id, ambiente, tipo_dte, estado)
  values (current_setting('prueba.org')::uuid, current_setting('prueba.emp')::uuid, 'certificacion', 39, 'borrador')
  returning id into v_id;
  begin
    update public.documentos set folio = 3, caf_id = current_setting('prueba.caf39')::uuid, estado = 'firmado',
                                 mnt_neto = 840, iva = 160, mnt_total = 1000
    where id = v_id;
    v_r1 := 'entró';
  exception when others then
    v_r1 := sqlstate || ' ' || sqlerrm;
  end;
  begin
    update public.documentos set folio = 5, caf_id = current_setting('prueba.caf39')::uuid, estado = 'firmado',
                                 mnt_neto = 840, iva = 160, mnt_total = 1000
    where id = v_id;
    v_r2 := 'ok';
  exception when others then
    v_r2 := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.registrar(7, 'a un borrador no se le fija un folio anulado (3: 23514); uno libre (5) sí',
    v_r1 like '23514 %' and v_r2 = 'ok'
    and (select folio = 5 and estado = 'firmado' from public.documentos where id = v_id),
    v_r1 || ' / ' || v_r2);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lo de la 0011 sigue: anular un folio usado da 23503
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r text;
begin
  begin
    r := 'ok:' || public.anular_folios(current_setting('prueba.caf39')::uuid, 4, 4, 'Ya emitido');
  exception when others then
    r := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.registrar(8, 'al revés: anular_folios sobre un folio con documento firmado (4) sigue dando 23503',
    r like '23503 %', r);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp.registrar(9, 'al final: ningún documento no anulado de la empresa usa un folio anulado',
  not exists (select 1 from public.documentos d
                join public.folios_anulados f on f.caf_id = d.caf_id and f.folio = d.folio
               where d.empresa_id = current_setting('prueba.emp')::uuid and d.estado <> 'anulado'),
  (select string_agg(tipo_dte || '-' || folio || ':' || estado, ', ' order by tipo_dte, folio)
     from public.documentos where empresa_id = current_setting('prueba.emp')::uuid));

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja usuario, organización, empresa, CAF, documentos, folios ni secretos de prueba
