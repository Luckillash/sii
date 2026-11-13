-- Simulación del bloqueo con arriendo de la Fase 4 (bloqueos_sii).
--
-- Criterio: dos peticiones no abren sesiones AUT2000 en paralelo con el mismo certificado
-- y ambiente. `tomar_bloqueo_certificado` lo da a un solo titular mientras el arriendo esté
-- vigente (el mismo titular renueva; uno vencido lo toma cualquiera), `liberar_bloqueo_certificado`
-- solo lo suelta su titular, y nada de esto lo ejecuta ni lo lee `authenticated` ni `anon`.
-- Además (sección 7), el índice único parcial `operaciones_sii_efecto_global_en_curso`
-- admite una sola solicitar_folios / postular / declarar confirmada en curso por empresa
-- y ambiente (la segunda choca con 23505), sin afectar ensayos, otras operaciones, filas
-- cerradas ni filas sin empresa. 21 comprobaciones.
--
-- REQUIERE LA MIGRACIÓN 0007 APLICADA (bloqueos_sii, tomar_bloqueo_certificado,
-- liberar_bloqueo_certificado, el índice). Sin ella el script se detiene con «relation ...
-- does not exist» (42P01) o «function ... does not exist» (42883) y la transacción se
-- descarta completa: no hay resultados que leer. Sin el índice, 17 y 18 salen false.
--
-- ESCRIBE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK (mismo patrón que
-- rls-fase3-empresas.sql): crea una organización, un certificado (como postgres, sin
-- secretos en Vault: los ids de los secretos son aleatorios y no apuntan a nada), sus
-- bloqueos, una empresa y filas de operaciones_sii de prueba, y al final deshace todo. No
-- llama a pg_net ni a nada con efectos fuera de la base.
--
-- Cómo correrlo (con la migración 0007 ya aplicada):
--   1. Ejecuta el archivo COMPLETO, tal cual, con el MCP `execute_sql` o en el SQL Editor
--      (como `postgres`). Nunca por partes y nunca cambiando el `rollback` final por `commit`.
--   2. El `select` antes del `rollback` devuelve una fila por comprobación:
--        ok = true   se comportó como se espera
--        ok = false  falló (ver detalle)
--      Si una sale false y el error es del script, se corrige el script; si es del esquema,
--      se reporta (el script no se cambia para que pase).
--   3. Confirma que no quedó nada (todo en 0):
--        select
--          (select count(*) from public.organizaciones where slug = 'zz-prueba-bloqueos-fase4') as organizaciones,
--          (select count(*) from public.certificados where huella_sha256 = repeat('c', 64)) as certificados,
--          (select count(*) from public.empresas where razon_social = 'Empresa de prueba bloqueos') as empresas,
--          (select count(*) from public.bloqueos_sii) as bloqueos;
--      (las filas de operaciones_sii de prueba se van con la organización: on delete cascade,
--      y de todos modos con el rollback.)
--      (bloqueos puede no ser 0 si la app ya está tomando bloqueos reales; en ese caso basta
--      con que ninguno sea del certificado de prueba, que ya no existe.)
--
-- Dentro de una transacción now() no avanza: el arriendo «vencido» se simula moviendo
-- `vence_en` al pasado como postgres, y la renovación se distingue moviendo `tomado_en`.
--
-- Cómo se simula cada rol (igual que en las Fases 2 y 3): `request.jwt.claims` local a la
-- transacción + `set local role service_role | authenticated | anon`; `reset role` vuelve
-- a postgres. Los ids que pasan de un paso a otro van en parámetros locales `prueba.*`.
--
-- Titulares (como los genera bloqueos.ts, uno aleatorio por operación):
--   ...0001  titular 1
--   ...0002  titular 2

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

select set_config('prueba.t1', '00000000-0000-4000-8000-00000000b001', true);
select set_config('prueba.t2', '00000000-0000-4000-8000-00000000b002', true);

do $$
declare
  v_org  uuid;
  v_cert uuid;
begin
  insert into public.organizaciones (nombre, slug)
  values ('Prueba bloqueos Fase 4', 'zz-prueba-bloqueos-fase4')
  returning id into v_org;
  insert into public.certificados (organizacion_id, rut_titular, huella_sha256, pfx_secret_id, clave_secret_id)
  values (v_org, '11111111-1', repeat('c', 64), gen_random_uuid(), gen_random_uuid())
  returning id into v_cert;
  perform set_config('prueba.org', v_org::text, true);
  perform set_config('prueba.cert', v_cert::text, true);
end $$;

select pg_temp.registrar(1, 'preparación: organización y certificado de prueba, sin bloqueos',
  (select count(*) from public.bloqueos_sii where certificado_id = current_setting('prueba.cert')::uuid) = 0,
  current_setting('prueba.cert'));

-- ---------------------------------------------------------------------------
-- 1. Tomar, rechazar a otro titular, renovar (como service_role)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                        current_setting('prueba.t1')::uuid, 60);
  perform pg_temp.registrar(2, 'el titular 1 toma el bloqueo libre (true, vence en 60 s)',
    v and (select titular = current_setting('prueba.t1')::uuid and vence_en = now() + interval '60 seconds'
             from public.bloqueos_sii
            where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion'),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(2, 'el titular 1 toma el bloqueo libre (true, vence en 60 s)', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                        current_setting('prueba.t2')::uuid, 60);
  perform pg_temp.registrar(3, 'el titular 2 no lo toma mientras el del titular 1 está vigente (false, la fila no cambia)',
    not v and (select titular = current_setting('prueba.t1')::uuid and vence_en = now() + interval '60 seconds'
                 from public.bloqueos_sii
                where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion'),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(3, 'el titular 2 no lo toma mientras el del titular 1 está vigente (false, la fila no cambia)',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- Para distinguir la renovación (conserva tomado_en) se mueve tomado_en al pasado.
reset role;
update public.bloqueos_sii set tomado_en = now() - interval '10 seconds'
where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion';
set local role service_role;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                        current_setting('prueba.t1')::uuid, 300);
  perform pg_temp.registrar(4, 'el titular 1 renueva su bloqueo (true, vence en 300 s y conserva tomado_en)',
    v and (select titular = current_setting('prueba.t1')::uuid
                  and vence_en = now() + interval '300 seconds'
                  and tomado_en = now() - interval '10 seconds'
             from public.bloqueos_sii
            where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion'),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(4, 'el titular 1 renueva su bloqueo (true, vence en 300 s y conserva tomado_en)',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'produccion',
                                        current_setting('prueba.t2')::uuid, 60);
  perform pg_temp.registrar(5, 'el mismo certificado en otro ambiente es otro bloqueo (el titular 2 toma producción)',
    v and (select count(*) from public.bloqueos_sii
            where certificado_id = current_setting('prueba.cert')::uuid) = 2,
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(5, 'el mismo certificado en otro ambiente es otro bloqueo (el titular 2 toma producción)',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Arriendo vencido
-- ---------------------------------------------------------------------------

reset role;
update public.bloqueos_sii set vence_en = now() - interval '1 second'
where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion';
set local role service_role;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                        current_setting('prueba.t2')::uuid, 120);
  perform pg_temp.registrar(6, 'con el arriendo del titular 1 vencido, el titular 2 lo toma (true, tomado_en nuevo)',
    v and (select titular = current_setting('prueba.t2')::uuid
                  and vence_en = now() + interval '120 seconds'
                  and tomado_en = now()
             from public.bloqueos_sii
            where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion'),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(6, 'con el arriendo del titular 1 vencido, el titular 2 lo toma (true, tomado_en nuevo)',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Liberar
-- ---------------------------------------------------------------------------

do $$
declare
  v boolean;
begin
  v := public.liberar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                          current_setting('prueba.t1')::uuid);
  perform pg_temp.registrar(7, 'el titular 1 (cuyo arriendo venció) no libera el bloqueo que ahora es del titular 2',
    not v and exists (select 1 from public.bloqueos_sii
                       where certificado_id = current_setting('prueba.cert')::uuid
                         and ambiente = 'certificacion'
                         and titular = current_setting('prueba.t2')::uuid),
    'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(7, 'el titular 1 (cuyo arriendo venció) no libera el bloqueo que ahora es del titular 2',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v1 boolean;
  v2 boolean;
begin
  v1 := public.liberar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                           current_setting('prueba.t2')::uuid);
  v2 := public.liberar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                           current_setting('prueba.t2')::uuid);
  perform pg_temp.registrar(8, 'el titular 2 libera su bloqueo (true); liberar otra vez devuelve false; producción sigue tomado',
    v1 and not v2
      and not exists (select 1 from public.bloqueos_sii
                       where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'certificacion')
      and exists (select 1 from public.bloqueos_sii
                   where certificado_id = current_setting('prueba.cert')::uuid and ambiente = 'produccion'),
    format('primera %s, segunda %s', v1, v2));
exception when others then
  perform pg_temp.registrar(8, 'el titular 2 libera su bloqueo (true); liberar otra vez devuelve false; producción sigue tomado',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v boolean;
begin
  v := public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                        current_setting('prueba.t1')::uuid, 60);
  perform pg_temp.registrar(9, 'liberado, cualquiera lo vuelve a tomar (el titular 1)', v, 'devolvió ' || v);
exception when others then
  perform pg_temp.registrar(9, 'liberado, cualquiera lo vuelve a tomar (el titular 1)', false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Validaciones y códigos de error
-- ---------------------------------------------------------------------------

do $$
declare
  v_codigos text := '';
  v_segundos integer;
begin
  foreach v_segundos in array array[0, 901, -5] loop
    begin
      perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                               current_setting('prueba.t1')::uuid, v_segundos);
      v_codigos := v_codigos || v_segundos || ':sin error ';
    exception when others then
      v_codigos := v_codigos || v_segundos || ':' || sqlstate || ' ';
    end;
  end loop;
  begin
    perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                             current_setting('prueba.t1')::uuid, null);
    v_codigos := v_codigos || 'null:sin error';
  exception when others then
    v_codigos := v_codigos || 'null:' || sqlstate;
  end;
  perform pg_temp.registrar(10, 'p_segundos 0, 901, negativo o nulo → 22023',
    v_codigos = '0:22023 901:22023 -5:22023 null:22023', v_codigos);
end $$;

do $$
declare
  v_codigos text := '';
begin
  begin
    perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion', null, 60);
    v_codigos := v_codigos || 'titular:sin error ';
  exception when others then
    v_codigos := v_codigos || 'titular:' || sqlstate || ' ';
  end;
  begin
    perform public.tomar_bloqueo_certificado(null, 'certificacion', current_setting('prueba.t1')::uuid, 60);
    v_codigos := v_codigos || 'certificado:sin error ';
  exception when others then
    v_codigos := v_codigos || 'certificado:' || sqlstate || ' ';
  end;
  begin
    perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, null,
                                             current_setting('prueba.t1')::uuid, 60);
    v_codigos := v_codigos || 'ambiente:sin error';
  exception when others then
    v_codigos := v_codigos || 'ambiente:' || sqlstate;
  end;
  perform pg_temp.registrar(11, 'sin titular, certificado o ambiente → 22004',
    v_codigos = 'titular:22004 certificado:22004 ambiente:22004', v_codigos);
end $$;

do $$
begin
  perform public.tomar_bloqueo_certificado(gen_random_uuid(), 'certificacion',
                                           current_setting('prueba.t1')::uuid, 60);
  perform pg_temp.registrar(12, 'certificado inexistente → 23503 (FK)', false, 'no dio error');
exception when others then
  perform pg_temp.registrar(12, 'certificado inexistente → 23503 (FK)', sqlstate = '23503', sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 5. authenticated y anon: sin EXECUTE y sin acceso a la tabla
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_negadas  integer := 0;
  v_mensajes text := '';
begin
  begin
    perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                             current_setting('prueba.t2')::uuid, 60);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform public.liberar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                               current_setting('prueba.t1')::uuid);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform 1 from public.bloqueos_sii;
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for table%' then v_negadas := v_negadas + 1; end if;
  end;
  perform pg_temp.registrar(13, 'authenticated no ejecuta tomar ni liberar, ni lee bloqueos_sii',
    v_negadas = 3, v_negadas || ' de 3 negadas: ' || v_mensajes);
exception when others then
  perform pg_temp.registrar(13, 'authenticated no ejecuta tomar ni liberar, ni lee bloqueos_sii',
    false, sqlstate || ' ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare
  v_negadas  integer := 0;
  v_mensajes text := '';
begin
  begin
    perform public.tomar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                             current_setting('prueba.t2')::uuid, 60);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform public.liberar_bloqueo_certificado(current_setting('prueba.cert')::uuid, 'certificacion',
                                               current_setting('prueba.t1')::uuid);
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for function%' then v_negadas := v_negadas + 1; end if;
  end;
  begin
    perform 1 from public.bloqueos_sii;
  exception when insufficient_privilege then
    v_mensajes := v_mensajes || sqlerrm || '; ';
    if sqlerrm like 'permission denied for table%' then v_negadas := v_negadas + 1; end if;
  end;
  perform pg_temp.registrar(14, 'anon no ejecuta tomar ni liberar, ni lee bloqueos_sii',
    v_negadas = 3, v_negadas || ' de 3 negadas: ' || v_mensajes);
exception when others then
  perform pg_temp.registrar(14, 'anon no ejecuta tomar ni liberar, ni lee bloqueos_sii',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- El bloqueo del titular 1 sigue intacto tras los intentos de authenticated y anon.
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.registrar(15, 'los intentos de authenticated y anon no cambiaron el bloqueo del titular 1',
  exists (select 1 from public.bloqueos_sii
           where certificado_id = current_setting('prueba.cert')::uuid
             and ambiente = 'certificacion'
             and titular = current_setting('prueba.t1')::uuid),
  null);

-- ---------------------------------------------------------------------------
-- 6. Borrar el certificado borra sus bloqueos (on delete cascade)
-- ---------------------------------------------------------------------------

do $$
begin
  delete from public.certificados where id = current_setting('prueba.cert')::uuid;
  perform pg_temp.registrar(16, 'borrar el certificado borra sus bloqueos de los dos ambientes',
    not exists (select 1 from public.bloqueos_sii where certificado_id = current_setting('prueba.cert')::uuid),
    null);
exception when others then
  perform pg_temp.registrar(16, 'borrar el certificado borra sus bloqueos de los dos ambientes',
    false, sqlstate || ' ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Índice único parcial operaciones_sii_efecto_global_en_curso (como service_role,
--    igual que ejecutarOperacion): una sola solicitar_folios / postular / declarar
--    confirmada en curso por empresa y ambiente.
-- ---------------------------------------------------------------------------

do $$
declare
  v_emp uuid;
begin
  -- Como postgres: tg_limite_empresas no exige suscripción sin usuario ni service_role.
  insert into public.empresas (organizacion_id, rut, razon_social, giro, direccion, comuna)
  values (current_setting('prueba.org')::uuid, '11111111-1', 'Empresa de prueba bloqueos',
          'Servicios de prueba', 'Calle Falsa 123', 'Santiago')
  returning id into v_emp;
  perform set_config('prueba.emp', v_emp::text, true);
end $$;

-- Inserta una fila de operaciones_sii y devuelve 'ok' o el SQLSTATE con que falló.
create function pg_temp.insertar_operacion(
  p_operacion text, p_ambiente text, p_confirmada boolean, p_empresa uuid,
  p_resultado text default 'en_curso'
)
returns text
language plpgsql
as $$
begin
  insert into public.operaciones_sii
    (organizacion_id, empresa_id, operacion, ambiente, confirmada, resultado, terminada_en)
  values (current_setting('prueba.org')::uuid, p_empresa, p_operacion::public.operacion_sii,
          p_ambiente::public.ambiente_sii, p_confirmada, p_resultado::public.resultado_operacion,
          case when p_resultado = 'en_curso' then null else now() end);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.insertar_operacion(text, text, boolean, uuid, text) to service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_emp     uuid := current_setting('prueba.emp')::uuid;
  v_primera text;
  v_segunda text;
  v_mensaje text;
begin
  v_primera := pg_temp.insertar_operacion('solicitar_folios', 'certificacion', true, v_emp);
  v_segunda := pg_temp.insertar_operacion('solicitar_folios', 'certificacion', true, v_emp);
  begin
    insert into public.operaciones_sii (organizacion_id, empresa_id, operacion, ambiente, confirmada)
    values (current_setting('prueba.org')::uuid, v_emp, 'solicitar_folios', 'certificacion', true);
    v_mensaje := 'sin error';
  exception when unique_violation then
    v_mensaje := sqlerrm;
  end;
  perform pg_temp.registrar(17, 'dos solicitar_folios confirmadas en curso de la misma empresa y ambiente: la segunda choca con 23505 en el índice',
    v_primera = 'ok' and v_segunda = '23505'
      and v_mensaje like '%operaciones_sii_efecto_global_en_curso%',
    format('primera %s, segunda %s: %s', v_primera, v_segunda, v_mensaje));
exception when others then
  perform pg_temp.registrar(17, 'dos solicitar_folios confirmadas en curso de la misma empresa y ambiente: la segunda choca con 23505 en el índice',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v_emp uuid := current_setting('prueba.emp')::uuid;
  v     text := '';
begin
  -- postular y declarar también están en el índice.
  v := v || 'postular:' || pg_temp.insertar_operacion('postular', 'certificacion', true, v_emp) || '/'
         || pg_temp.insertar_operacion('postular', 'certificacion', true, v_emp) || ' ';
  v := v || 'declarar:' || pg_temp.insertar_operacion('declarar', 'certificacion', true, v_emp) || '/'
         || pg_temp.insertar_operacion('declarar', 'certificacion', true, v_emp) || ' ';
  -- La misma operación en el otro ambiente es otra llave.
  v := v || 'produccion:' || pg_temp.insertar_operacion('solicitar_folios', 'produccion', true, v_emp);
  perform pg_temp.registrar(18, 'postular y declarar chocan igual; la misma operación en el otro ambiente no choca',
    v = 'postular:ok/23505 declarar:ok/23505 produccion:ok', v);
end $$;

do $$
declare
  v_emp uuid := current_setting('prueba.emp')::uuid;
  v     text := '';
begin
  -- Ensayos (confirmada = false) de una operación de la lista, con una confirmada en curso.
  v := v || 'ensayos:' || pg_temp.insertar_operacion('solicitar_folios', 'certificacion', false, v_emp) || '/'
         || pg_temp.insertar_operacion('solicitar_folios', 'certificacion', false, v_emp) || ' ';
  -- Operaciones fuera de la lista, confirmadas y en curso.
  v := v || 'emitir:' || pg_temp.insertar_operacion('emitir', 'certificacion', true, v_emp) || '/'
         || pg_temp.insertar_operacion('emitir', 'certificacion', true, v_emp) || ' ';
  v := v || 'enviar_set:' || pg_temp.insertar_operacion('enviar_set', 'certificacion', true, v_emp) || '/'
         || pg_temp.insertar_operacion('enviar_set', 'certificacion', true, v_emp);
  perform pg_temp.registrar(19, 'ensayos y operaciones fuera de la lista (emitir, enviar_set) no chocan',
    v = 'ensayos:ok/ok emitir:ok/ok enviar_set:ok/ok', v);
end $$;

do $$
declare
  v_emp uuid := current_setting('prueba.emp')::uuid;
  v     text;
begin
  -- Cerrar la que está en curso (incierto) la saca del índice: la próxima entra. Por eso
  -- ejecutarOperacion vuelve a revisar después de insertar (el índice solo cubre en_curso).
  update public.operaciones_sii set resultado = 'incierto', terminada_en = now()
  where empresa_id = v_emp and operacion = 'solicitar_folios' and ambiente = 'certificacion'
    and confirmada and resultado = 'en_curso';
  v := pg_temp.insertar_operacion('solicitar_folios', 'certificacion', true, v_emp);
  -- Filas cerradas (cualquier resultado) no cuentan.
  v := v || '/' || pg_temp.insertar_operacion('solicitar_folios', 'certificacion', true, v_emp, 'ok');
  perform pg_temp.registrar(20, 'cerrada la que estaba en curso, otra entra; las filas cerradas no chocan',
    v = 'ok/ok', v);
exception when others then
  perform pg_temp.registrar(20, 'cerrada la que estaba en curso, otra entra; las filas cerradas no chocan',
    false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  v text;
begin
  -- En un índice único los NULL no chocan: por eso ejecutarOperacion rechaza como `uso`
  -- una operación de efecto global sin empresa, antes de insertar.
  v := pg_temp.insertar_operacion('declarar', 'certificacion', true, null) || '/'
       || pg_temp.insertar_operacion('declarar', 'certificacion', true, null);
  perform pg_temp.registrar(21, 'sin empresa (empresa_id nulo) no chocan: lo cubre ejecutarOperacion (uso)',
    v = 'ok/ok', v);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Resultado y rollback
-- ---------------------------------------------------------------------------

select n, verificacion, ok, detalle from resultados order by n;

rollback;   -- obligatorio: no deja la organización, el certificado ni sus bloqueos de prueba
