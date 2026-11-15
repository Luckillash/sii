-- =============================================================================
-- 0012 · Un documento no recibe un folio anulado (PLAN-SAAS Fase 7, riesgo de la Fase 6)
--
-- (El plan reservaba `0012` para `notificaciones` de la Fase 8; el número definitivo es
-- por orden de creación, PLAN-SAAS §6. Las de las fases siguientes se corren un número.)
--
-- El riesgo (anotado en la 0011): `asignar_folio` entrega el folio en una llamada y el
-- documento que lo usa se inserta, o se actualiza con el folio, en otra. Entre medio, un
-- administrador puede anular ese folio con `anular_folios` (caso a: folio bajo
-- `siguiente_folio`, sin documento todavía, así que la RPC no lo ve usado), y después el
-- documento entraría igual con un folio que el RCOF informa como anulado. Se cierra en la
-- base, para cualquier camino (panel, API, CLI, set de pruebas), no en la app.
--
-- `create or replace function public.tg_validar_documento()`: el MISMO cuerpo de la 0001
-- (CAF de la misma empresa, ambiente y tipo, folio en su rango; en producción, empresa
-- autorizada y plan que lo permita) con dos cambios:
--
-- 1. La lectura del CAF pasa a `select ... for key share`. Es el mismo candado que toma la
--    FK `documentos (empresa_id, caf_id) → cafs` al final de la sentencia, pero tomado
--    ANTES de mirar `folios_anulados`. `for key share` choca con el `for update` que toman
--    `anular_folios` y `asignar_folio` sobre el CAF, y no con el `update` de
--    `siguiente_folio`/`estado` (que es `no key update`), ni con otro `for key share`:
--    dos emisiones que insertan documentos del mismo CAF no se esperan entre sí.
--
-- 2. Cuando el documento FIJA su folio (INSERT con folio, o UPDATE que cambia `folio` o
--    `caf_id`), después del candado revisa `folios_anulados (caf_id, folio)`: si el folio
--    está anulado, `23514` (check_violation: el documento no cumple una regla de
--    integridad; mismo código que usaría un CHECK) con el folio en el mensaje y la pista
--    de pedir otro folio. Un UPDATE que no cambia folio ni CAF (el `estado = 'anulado'` que
--    hace `envio-set.ts` después de anular los folios del set, o un cambio de `ambiente` o
--    `tipo_dte` sobre un documento ya emitido) no se revisa: ese documento ya tenía el
--    folio antes de la anulación.
--
-- Por qué el orden (candado y después lectura) basta, en READ COMMITTED (el nivel de
-- PostgREST y de la app):
--   - Si `anular_folios` llegó primero, tiene el CAF `for update` hasta su commit. El
--     `for key share` del trigger espera; al seguir, la siguiente sentencia de la función
--     (`select ... from folios_anulados`) toma una foto nueva (en una función volátil cada
--     sentencia toma su propio snapshot en READ COMMITTED), que ya incluye los folios
--     anulados confirmados: el documento se rechaza. Si `anular_folios` se deshizo, no hay
--     fila y el documento entra.
--   - Si el documento llegó primero, su transacción tiene el CAF `for key share` hasta su
--     commit. El `select ... for update` de `anular_folios` espera; al seguir, su
--     siguiente sentencia (la búsqueda de documentos no anulados) ve el documento ya
--     confirmado y la anulación se rechaza con `23503`.
--   Sin el candado previo, las dos transacciones podían leer cada una antes del commit de
--   la otra y pasar las dos. En REPEATABLE READ o SERIALIZABLE la foto es la del inicio de
--   la transacción y el razonamiento no aplica tal cual (la segunda fallaría por
--   serialización); la app no usa esos niveles.
--   PGlite (una sola conexión) no puede probar la concurrencia: la simulación
--   `rls-fase7-folio-anulado.sql` prueba la regla y este comentario documenta el bloqueo.
--
-- Flujos legítimos revisados: el set de pruebas (`envio-set.ts`, Fase 5) asigna los folios,
-- inserta los documentos y solo DESPUÉS, si falla, inserta los anulados y pasa los
-- documentos a `anulado` (UPDATE de `estado`, que ni siquiera dispara el trigger); un
-- reintento usa folios nuevos. La emisión prevista en la Fase 7 (PLAN-SAAS) asigna el
-- folio, firma y recién entonces fija `folio`/`caf_id` en el documento; si falla antes de
-- firmar, anula el folio sin haberlo puesto en el documento. Ninguno fija un folio ya
-- anulado.
--
-- El trigger `trg_10_validar_documento` (0001: before insert or update of folio, caf_id,
-- ambiente, tipo_dte) no cambia; `create or replace` conserva dueño, `security definer`,
-- `search_path` y privilegios (la función no se llama por la API). Nada más cambia.
-- Hoy (2026-11-15) producción no tiene documentos con folio ni folios anulados.
-- =============================================================================

begin;

-- Al asignar folio: el CAF tiene que ser de la misma empresa, ambiente y tipo,
-- y el folio estar en su rango (y no anulado, 0012). En producción, además, la
-- empresa tiene que estar autorizada (P91) y el plan permitirlo.
create or replace function public.tg_validar_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caf public.cafs;
begin
  if new.folio is not null then
    if new.caf_id is null then
      raise exception 'Un documento con folio necesita su CAF';
    end if;
    -- 0012: for key share antes de mirar folios_anulados (se serializa con el for update
    -- de anular_folios; ver el encabezado de la migración).
    select * into v_caf from public.cafs where id = new.caf_id for key share;
    if v_caf.ambiente <> new.ambiente or v_caf.tipo_dte <> new.tipo_dte then
      raise exception 'El CAF % no es de tipo % en %', new.caf_id, new.tipo_dte, new.ambiente;
    end if;
    if new.folio not between v_caf.folio_desde and v_caf.folio_hasta then
      raise exception 'El folio % no está en el CAF (% a %)', new.folio, v_caf.folio_desde, v_caf.folio_hasta;
    end if;
    -- 0012: un folio anulado no se usa. Solo cuando el documento fija su folio.
    if (tg_op = 'INSERT'
        or new.folio is distinct from old.folio
        or new.caf_id is distinct from old.caf_id)
       and exists (select 1 from public.folios_anulados f
                    where f.caf_id = new.caf_id and f.folio = new.folio) then
      raise exception 'El folio % está anulado: no se puede usar en un documento', new.folio
        using errcode = '23514',
              hint = 'Pide otro folio (asignar_folio) y vuelve a armar el documento.';
    end if;
  end if;

  if tg_op = 'INSERT' and new.ambiente = 'produccion' then
    if not (select autorizada_produccion from public.empresas where id = new.empresa_id) then
      raise exception 'La empresa no está autorizada a emitir en producción (estado P91)';
    end if;
    if not coalesce((public.plan_vigente(new.organizacion_id)).permite_produccion, false) then
      raise exception 'El plan vigente no permite emitir en producción';
    end if;
  end if;
  return new;
end;
$$;

commit;
