-- Verificación de la migración 0012_folio_anulado en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no dispara el trigger. Se ejecuta tal cual en el
-- SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas deben salir con
-- ok = true.
-- La prueba de comportamiento (documento con folio anulado rechazado al insertar y al cambiar
-- el folio; un update de estado de un documento cuyo folio se anuló después sí pasa) está en
-- rls-fase7-folio-anulado.sql, con transacción y rollback. La concurrencia (el candado
-- `for key share` antes de leer `folios_anulados`) no se puede probar con una sola sesión: el
-- razonamiento está en el encabezado de la migración.
-- 7 comprobaciones: 1-4 la función; 5 el trigger sin cambios; 6 datos; 7 migración registrada.
--
-- La función se busca con to_regprocedure (firma calificada), así el resultado no depende del
-- search_path de la sesión. Antes de migrar salen true 1, 3, 4, 5 y 6 (la función de la 0001)
-- y false 2 y 7.

with funcion as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, l.lanname,
         pg_get_function_result(p.oid) as resultado
  from (select to_regprocedure('public.tg_validar_documento()') as oid) f
  left join pg_proc p on p.oid = f.oid
  left join pg_language l on l.oid = p.prolang
),
disparador as (
  select t.tgname, t.tgtype, t.tgenabled, t.tgfoid, pg_get_triggerdef(t.oid) as definicion,
         (select array_agg(a.attname::text order by a.attname::text)
            from unnest(t.tgattr::int2[]) as k (attnum)
            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum) as columnas
  from pg_trigger t
  where t.tgrelid = 'public.documentos'::regclass
    and t.tgname = 'trg_10_validar_documento'
    and not t.tgisinternal
)
select * from (
  select 1 as n, 'tg_validar_documento() existe, devuelve trigger, es plpgsql, security definer y fija search_path vacío' as verificacion,
         coalesce((select resultado = 'trigger' and lanname = 'plpgsql' and prosecdef
                          and proconfig @> array['search_path=""']
                     from funcion where oid is not null), false) as ok,
         (select coalesce(resultado, 'NO EXISTE') || ' ' || coalesce(lanname, '-') || ' definer='
                 || coalesce(prosecdef::text, '-') || ' ' || coalesce(array_to_string(proconfig, ', '), '-')
            from funcion) as detalle
  union all
  select 2, 'cuerpo (0012): lee el CAF con for key share ANTES de mirar folios_anulados, solo cuando el documento fija su folio, y rechaza con 23514',
         coalesce((select prosrc like '%from public.cafs where id = new.caf_id for key share%'
                          and prosrc like '%from public.folios_anulados%'
                          and strpos(prosrc, 'for key share') < strpos(prosrc, 'from public.folios_anulados')
                          and prosrc like '%new.folio is distinct from old.folio%'
                          and prosrc like '%new.caf_id is distinct from old.caf_id%'
                          and prosrc like '%f.caf_id = new.caf_id and f.folio = new.folio%'
                          and prosrc like '%errcode = ''23514''%'
                     from funcion where oid is not null), false),
         null
  union all
  select 3, 'cuerpo: conserva las reglas de la 0001 (CAF obligatorio, mismo ambiente y tipo, folio en el rango, P91 y plan en producción)',
         coalesce((select prosrc like '%Un documento con folio necesita su CAF%'
                          and prosrc like '%v_caf.ambiente <> new.ambiente or v_caf.tipo_dte <> new.tipo_dte%'
                          and prosrc like '%new.folio not between v_caf.folio_desde and v_caf.folio_hasta%'
                          and prosrc like '%autorizada_produccion%'
                          and prosrc like '%permite_produccion%'
                     from funcion where oid is not null), false),
         null
  union all
  select 4, 'ni PUBLIC, ni anon, ni authenticated tienen EXECUTE (como en la 0001; no se llama por la API)',
         coalesce((select not has_function_privilege('anon', oid, 'execute')
                          and not has_function_privilege('authenticated', oid, 'execute')
                          and not exists (select 1 from aclexplode(proacl) a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                     from funcion where oid is not null), false),
         (select coalesce(proacl::text, '-') from funcion)
  union all
  select 5, 'trg_10_validar_documento sigue igual: BEFORE, por fila, INSERT y UPDATE OF ambiente, caf_id, folio, tipo_dte, activo, con la función',
         coalesce((select (tgtype & 1) = 1           -- por fila
                          and (tgtype & 2) = 2       -- before
                          and (tgtype & 4) = 4       -- insert
                          and (tgtype & 16) = 16     -- update
                          and (tgtype & 8) = 0       -- no delete
                          and tgenabled = 'O'
                          and tgfoid = (select oid from funcion)
                          and columnas = array['ambiente', 'caf_id', 'folio', 'tipo_dte']
                     from disparador), false),
         (select coalesce(definicion, 'NO EXISTE') from disparador)
  union all
  select 6, 'ningún documento no anulado usa un folio anulado',
         not exists (select 1 from public.documentos d
                       join public.folios_anulados f on f.caf_id = d.caf_id and f.folio = d.folio
                      where d.estado <> 'anulado'),
         (select count(*) || ' documentos con folio; ' || (select count(*) from public.folios_anulados) || ' folios anulados'
            from public.documentos where folio is not null)
  union all
  select 7, 'migración registrada como 0012',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0012'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
