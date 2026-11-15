-- =============================================================================
-- 0011 · Folios: anular folios no usados y CAF sin traslapes (PLAN-SAAS Fase 6)
--
-- (El plan reservaba `0011` para `notificaciones` de la Fase 8; el número definitivo es
-- por orden de creación, PLAN-SAAS §6. Las de las fases siguientes se corren un número.)
--
-- 1. `anular_folios(p_caf, p_desde, p_hasta, p_motivo)` → integer (folios que quedaron
--    anulados en esta llamada). Anula un rango de folios NO usados de un CAF: van a
--    `folios_anulados`, que el RCOF informa en `<RangoAnulados>`. Con inserts sueltos la
--    app no podría validar el rango contra el CAF ni contra los documentos, ni bloquear
--    el CAF, ni cerrarlo, y el CAF solo lo escribe el backend (sin políticas de
--    escritura). Por eso una RPC `security definer` que hace todo en una transacción (y
--    el punto 3 cierra el insert directo).
--    Permiso: service_role (`auth.role()`, igual que `asignar_folio`) o administrador
--    (`es_admin`) de la organización del CAF. Un CAF de otra organización se comporta
--    igual que uno que no existe (P0002, sin filtrar su existencia); un miembro que no
--    es administrador (emisor, lector) recibe 42501 (ya ve el CAF por RLS, así que no se
--    le oculta nada).
--    Toma el CAF con `for update`, igual que `asignar_folio`: una emisión simultánea
--    espera a que termine la anulación (o al revés) y cada una ve el `siguiente_folio`
--    que dejó la otra.
--    Dos casos válidos:
--      a. Rango completo por debajo de `siguiente_folio` (folios ya asignados que no se
--         usaron): solo inserta en `folios_anulados`.
--      b. Rango que llega a `siguiente_folio` o más arriba (folios que aún no se
--         asignan): solo se permite si es la COLA COMPLETA del CAF, es decir,
--         `p_desde <= siguiente_folio` y `p_hasta = folio_hasta`. Inserta igual que (a) y
--         deja el CAF con `siguiente_folio = folio_hasta + 1` y `estado = 'anulado'`, así
--         `asignar_folio` ya no lo usa. Si la cola fuera parcial, `asignar_folio`
--         entregaría después un folio anulado (avanza de uno en uno sin mirar
--         `folios_anulados`); y si empezara más arriba del siguiente, los folios entre
--         ambos no quedarían ni emitidos ni anulados al cerrar el CAF.
--    Repetir una anulación no falla: `on conflict (caf_id, folio) do nothing` y devuelve
--    0 (o solo los folios nuevos del rango).
--    Un folio con un documento que no está `anulado` no se anula: ese folio ya se usó y
--    se corrige con nota de crédito (Fase 14). Se buscan los documentos por empresa,
--    ambiente, tipo y folio (la llave única de `documentos`), lo que incluye los que
--    tienen `caf_id = p_caf` (`tg_validar_documento` exige que el CAF sea del mismo
--    ambiente y tipo, y la FK, de la misma empresa).
--    `anulado_por = auth.uid()` (nulo si llama el backend sin usuario). El motivo se
--    guarda sin espacios a los lados.
--    Códigos de error:
--      P0002  El CAF no existe (o es de una organización de la que quien llama no es
--             miembro).
--      42501  Quien llama es miembro pero no administrador de la organización del CAF.
--      22023  Parámetro inválido: folios nulos, `p_desde > p_hasta`, rango fuera del
--             CAF, motivo vacío o de más de 500 caracteres, o cola parcial (caso b sin
--             llegar al último folio, o empezando más arriba del siguiente).
--      23503  Algún folio del rango tiene un documento que no está anulado (el folio
--             está «referenciado» por un documento: el mismo código que una FK).
--
-- 2. `tg_caf_sin_traslape()` + trigger `trg_20_caf_sin_traslape` (before insert or update
--    of folio_desde, folio_hasta, ambiente, tipo_dte, empresa_id en `cafs`): rechaza con
--    23P01 un CAF cuyo rango se cruza con otro CAF de la misma empresa, ambiente y tipo
--    (en cualquier estado: el SII nunca timbra dos veces el mismo folio, así que un cruce
--    es un CAF equivocado o cargado dos veces con otro rango). La llave única
--    `(empresa_id, ambiente, tipo_dte, folio_desde)` de 0001 solo atrapa los que empiezan
--    en el mismo folio. Sin esto `asignar_folio` podría entregar dos veces el mismo
--    folio (y chocar en la llave única de `documentos` al emitir).
--    Antes de buscar toma `for no key update` sobre la fila de la empresa (lo mismo que
--    hace `registrar_caf`): dos inserts simultáneos para la misma empresa no se ven entre
--    sí hasta el commit, así que se ordenan para que el segundo vea al primero. `no key
--    update` no bloquea las FK que apuntan a la empresa, y `registrar_caf` ya lo tiene
--    tomado (volver a tomarlo en la misma transacción no espera).
--    `registrar_caf` (0008) sigue idempotente: con el mismo CAF devuelve antes de
--    insertar, y solo actualiza `solicitud_id` (columna que no dispara el trigger). Las
--    actualizaciones de `asignar_folio` y de `anular_folios` (`siguiente_folio`,
--    `estado`) tampoco lo disparan. Un CAF traslapado que llega por `registrar_caf`
--    aborta la transacción completa con 23P01, también el secreto de Vault.
--    Nombre `trg_20_…`: los triggers BEFORE de un mismo evento corren en orden alfabético,
--    después de `trg_00_organizacion` y `trg_10_caf_inicial`.
--    `security definer` para poder tomar el candado de la empresa y ver todos los CAF sin
--    depender del RLS de quien escribe (hoy solo el backend escribe en `cafs`). Se revoca
--    EXECUTE a PUBLIC, anon y authenticated: los triggers no lo piden a quien dispara.
--
-- 3. `folios_anulados` solo se escribe con `anular_folios` o con service_role: se borra la
--    política `alta` de 0001 (`for insert to authenticated with check (es_admin(...))`),
--    que dejaba a un administrador insertar directo con su sesión y saltarse las
--    validaciones de la RPC, el bloqueo `for update` del CAF y su cierre (por ejemplo,
--    anular folios sueltos por encima de `siguiente_folio`, que `asignar_folio`
--    entregaría después). Y se revocan a `authenticated` INSERT, UPDATE, DELETE y
--    TRUNCATE (los tenía por los grants por defecto de Supabase; TRUNCATE no pasa por
--    RLS), así el intento da `42501 permission denied` antes de llegar a RLS. Queda
--    SELECT con la política `lectura` (`es_miembro`). `anular_folios` no los necesita:
--    es `security definer` (dueño `postgres`). El backend que anula folios del set de
--    pruebas (`server/certificacion/envio-set.ts`) usa service_role, que no cambia.
--    Antes de esta migración nada de la app insertaba con el cliente de sesión.
--
-- 4. `cafs` y `folios_anulados` a la publicación `supabase_realtime`, idempotente como en
--    0006: la vista de folios no se entera de un CAF cargado o de una anulación hecha por
--    otro administrador (o por el backend al emitir) sin volver a consultar. Realtime
--    respeta RLS: cada suscriptor recibe solo las filas que su política SELECT le deja
--    ver, y las dos tablas tienen `lectura` (`for select to authenticated using
--    (es_miembro(organizacion_id))`, 0001) y SELECT para `authenticated`; `anon` no tiene
--    ni SELECT ni políticas. `cafs` no publica nada secreto: el XML del CAF (con
--    `<RSASK>`) vive en Vault y la fila solo trae `caf_secret_id`, un uuid que los
--    miembros ya leen por RLS y que sin service_role no abre nada (`leer_secreto` y
--    `vault` son solo del backend). `replica identity` por defecto (llave primaria), por
--    las mismas razones que en 0006.
--
-- Hoy (2026-11-15) no hay CAF en producción, así que no hay traslapes previos; la
-- verificación lo vuelve a revisar.
--
-- Aditiva salvo el punto 3, que quita una política y privilegios (cierra un permiso; nadie
-- lo usaba). Sin tablas ni columnas nuevas (la tabla `notificaciones` es de la Fase 8).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Anular folios no usados de un CAF
-- -----------------------------------------------------------------------------

create function public.anular_folios(
  p_caf    uuid,
  p_desde  integer,
  p_hasta  integer,
  p_motivo text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backend boolean := (select auth.role()) is not distinct from 'service_role';
  v_org     uuid;
  v_caf     public.cafs;
  v_motivo  text := btrim(p_motivo);
  v_usado   integer;
  v_total   integer;
begin
  -- Permiso antes de bloquear y de validar: quien no es de la organización no bloquea
  -- el CAF ni sabe si existe.
  select c.organizacion_id into v_org from public.cafs c where c.id = p_caf;
  if not found or (not v_backend and not public.es_miembro(v_org)) then
    raise exception 'El CAF no existe' using errcode = 'P0002';
  end if;
  if not v_backend and not public.es_admin(v_org) then
    raise exception 'Solo un administrador de la organización puede anular folios'
      using errcode = '42501';
  end if;

  -- Mismo candado que asignar_folio: no compite con una emisión.
  select * into v_caf from public.cafs c where c.id = p_caf for update;

  if p_desde is null or p_hasta is null then
    raise exception 'Faltan el folio inicial o el final del rango a anular' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'El folio inicial (%) es mayor que el final (%)', p_desde, p_hasta
      using errcode = '22023';
  end if;
  if p_desde < v_caf.folio_desde or p_hasta > v_caf.folio_hasta then
    raise exception 'El rango % a % no está dentro del CAF (folios % a %)',
      p_desde, p_hasta, v_caf.folio_desde, v_caf.folio_hasta
      using errcode = '22023';
  end if;
  if v_motivo is null or v_motivo = '' then
    raise exception 'Falta el motivo de la anulación' using errcode = '22023';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo de la anulación no puede pasar de 500 caracteres'
      using errcode = '22023';
  end if;

  -- Caso b: folios que aún no se asignan. Solo la cola completa (ver encabezado).
  if p_hasta >= v_caf.siguiente_folio then
    if p_hasta <> v_caf.folio_hasta or p_desde > v_caf.siguiente_folio then
      raise exception 'Para anular folios que aún no se usan hay que anular desde el folio % hasta el último del CAF (%)',
        v_caf.siguiente_folio, v_caf.folio_hasta
        using errcode = '22023';
    end if;
  end if;

  -- Un folio usado no se anula: se corrige con nota de crédito.
  select d.folio into v_usado
  from public.documentos d
  where d.empresa_id = v_caf.empresa_id
    and d.ambiente = v_caf.ambiente
    and d.tipo_dte = v_caf.tipo_dte
    and d.folio between p_desde and p_hasta
    and d.estado <> 'anulado'
  order by d.folio
  limit 1;
  if found then
    raise exception 'El folio % ya tiene un documento emitido: no se puede anular', v_usado
      using errcode = '23503',
            hint = 'Un documento emitido se corrige con una nota de crédito.';
  end if;

  -- organizacion_id también lo fija trg_00_organizacion desde el CAF.
  insert into public.folios_anulados (organizacion_id, caf_id, folio, motivo, anulado_por)
  select v_caf.organizacion_id, v_caf.id, f, v_motivo, (select auth.uid())
  from generate_series(p_desde, p_hasta) as f
  on conflict (caf_id, folio) do nothing;
  get diagnostics v_total = row_count;

  if p_hasta >= v_caf.siguiente_folio then
    update public.cafs
    set siguiente_folio = folio_hasta + 1,
        estado = 'anulado'
    where id = v_caf.id;
  end if;

  return v_total;
end;
$$;

comment on function public.anular_folios(uuid, integer, integer, text) is
  'Anula folios no usados de un CAF (folios_anulados). Un rango bajo siguiente_folio solo se registra; la cola completa (desde siguiente_folio hasta folio_hasta) además deja el CAF anulado. Rechaza folios con documento no anulado (23503). service_role o administrador de la organización del CAF.';

revoke execute on function public.anular_folios(uuid, integer, integer, text)
  from public, anon;
grant execute on function public.anular_folios(uuid, integer, integer, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Dos CAF de la misma empresa, ambiente y tipo no se traslapan
-- -----------------------------------------------------------------------------

create function public.tg_caf_sin_traslape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otro public.cafs;
begin
  -- Ordena los inserts simultáneos de la misma empresa (ver encabezado).
  perform 1 from public.empresas where id = new.empresa_id for no key update;

  select * into v_otro
  from public.cafs c
  where c.empresa_id = new.empresa_id
    and c.ambiente = new.ambiente
    and c.tipo_dte = new.tipo_dte
    and c.id <> new.id
    and c.folio_desde <= new.folio_hasta
    and new.folio_desde <= c.folio_hasta
  order by c.folio_desde
  limit 1;

  if found then
    raise exception 'El CAF de folios % a % se traslapa con otro CAF de la empresa (folios % a %) del mismo tipo y ambiente',
      new.folio_desde, new.folio_hasta, v_otro.folio_desde, v_otro.folio_hasta
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

comment on function public.tg_caf_sin_traslape() is
  'Rechaza (23P01) un CAF cuyo rango se cruza con otro CAF de la misma empresa, ambiente y tipo.';

revoke execute on function public.tg_caf_sin_traslape()
  from public, anon, authenticated;

create trigger trg_20_caf_sin_traslape
  before insert or update of folio_desde, folio_hasta, ambiente, tipo_dte, empresa_id
  on public.cafs
  for each row execute function public.tg_caf_sin_traslape();

-- -----------------------------------------------------------------------------
-- 3. folios_anulados: sin insert directo con la sesión (solo anular_folios o service_role)
-- -----------------------------------------------------------------------------

drop policy if exists alta on public.folios_anulados;

revoke insert, update, delete, truncate on public.folios_anulados from authenticated;

-- -----------------------------------------------------------------------------
-- 4. Realtime para cafs y folios_anulados (idempotente, como 0006)
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cafs', 'folios_anulados'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

commit;
