-- =============================================================================
-- 0018 · API pública y webhooks (PLAN-SAAS Fase 11)
--
-- La API pública (`/api/v1/*`) autentica una API key por su SHA-256 y trabaja con
-- service_role filtrando por organización; los webhooks se entregan desde
-- `/api/cron/webhooks` (cada minuto, migración 0019) leyendo el outbox `webhook_entregas`
-- que llenan los triggers (`encolar_evento`). Esta migración agrega lo que falta en la base:
--
-- 1. `api_idempotencia`: una fila por `Idempotency-Key` de la organización, con la huella
--    (sha256 hex) del cuerpo, el recurso (`documento`, `lote`, `solicitud_folios`), el
--    estado (`en_curso` / `terminada`), y al terminar el status HTTP y la respuesta JSON
--    para repetirla tal cual. No va en `documentos.metadata` porque la emisión reescribe
--    `metadata` entero, y también sirve para lotes y para el timbraje de folios. Solo
--    service_role (RLS activo sin políticas).
-- 2. `autenticar_api_key(p_clave_hash) → (api_key_id, organizacion_id, empresa_id,
--    alcances, ambiente, motivo)`: siempre UNA fila. `motivo` nulo = clave válida; si no,
--    `invalida` (formato o inexistente), `revocada`, `vencida` o `plan_sin_api`, con los
--    ids nulos (un rechazo no revela a qué organización pertenece la clave). Con una clave
--    válida actualiza `ultimo_uso_en` como mucho una vez por minuto (no escribe en cada
--    petición).
-- 3. Idempotencia: `reclamar_idempotencia(org, clave, recurso, huella, api_key,
--    arriendo)` → `(resultado, status_http, respuesta, recurso_id)` con resultado:
--      nueva      la clave no existía: se crea `en_curso` (la petición sigue);
--      retomada   existía `en_curso` con la MISMA huella y su arriendo venció (la función
--                 anterior murió o soltó la clave): se vuelve a tomar (devuelve recurso_id);
--      en_curso   otra petición la tiene tomada (409, reintentar después);
--      terminada  ya tiene respuesta: se repite (status y cuerpo guardados);
--      conflicto  la clave existe con otra huella u otro recurso (422).
--    `terminar_idempotencia` guarda la respuesta final; `soltar_idempotencia` deja la
--    clave retomable al instante (arriendo vencido) sin borrar la huella, así un reintento
--    con otro cuerpo sigue dando `conflicto`. Las tres solo service_role.
-- 4. `webhook_entregas`: `reenviada_en` / `reenviada_por` (auditoría del reenvío manual) e
--    índices para el cron (`pendiente` y `fallido` por `siguiente_intento_en`), el
--    historial por webhook y por organización.
-- 5. `reclamar_entregas_webhook(p_limite, p_arriendo_segundos)`: descarta lo vencido que ya
--    no corresponde entregar (webhook inactivo, 8 intentos agotados, plan sin webhooks) y
--    toma hasta `p_limite` entregas vencidas por turnos entre organizaciones, con `for
--    update skip locked` (dos corridas no toman la misma), sumando el intento y corriendo
--    `siguiente_intento_en` al fin del arriendo (si la función muere, la entrega vuelve
--    sola). Devuelve la URL y el id del secreto en Vault (el secreto lo lee la app con
--    `leer_secreto`). Solo service_role.
-- 6. `cerrar_entrega_webhook(p_id, p_intento, p_entregada, p_status_http, p_respuesta, p_definitiva)`
--    → estado final: `entregado`; `descartado` (definitiva, p. ej. URL bloqueada, o 8
--    intentos); o `fallido` con el próximo intento a 1 min, 5 min, 30 min, 2 h, 6 h, 12 h
--    o 24 h (±10 %) según el intento hecho. Sincronizado con `ESPERAS_WEBHOOK_MIN` y
--    `MAX_INTENTOS_WEBHOOK` de `apps/web/src/lib/api-publica.ts`. Solo service_role.
-- 7. Acciones del panel (`authenticated` y service_role, `security definer`):
--    `reenviar_entrega_webhook(p_entrega)` reinicia la MISMA fila (el receptor deduplica
--    por id), `probar_webhook(p_webhook)` encola un `webhook.prueba` y
--    `rotar_secreto_webhook(p_webhook)` cambia el secreto HMAC en Vault, borra el viejo y
--    devuelve el nuevo UNA vez. Errores: P0002 no existe o es de otra organización; 42501
--    miembro sin ser administrador; P0001 plan sin webhooks (reenviar y probar); 22023
--    webhook desactivado o entrega ya en cola.
-- 8. `encolar_evento`: igual que en la 0001, pero solo si el plan vigente incluye webhooks
--    (sin plan, el outbox no crece con entregas que nunca saldrían).
-- 9. `tg_evento_documento`: igual que en la 0001, con `estado`, `origen` y
--    `clave_idempotencia` en los datos del evento (un integrador de la API asocia el
--    `documento.aceptado` con su petición).
-- 10. `webhooks_url_permitida`: defensa en profundidad (los administradores pueden
--    cambiar `url` por PostgREST): https, solo puerto 443, sin usuario ni clave, sin IP
--    literal, sin `localhost` ni `.local`, `.localhost` o `.internal`, sin punto final en
--    el host y hasta 2.048 caracteres. Espejo de `validarUrlWebhook` de la app; la
--    resolución DNS a IP privada la bloquea la app al entregar.
-- 11. Índices para RLS, FK y el listado de la API.
--
-- `certificacion:gestionar` sigue en el `check` de `api_keys.alcances` (0001) pero no
-- tiene rutas: queda reservado.
--
-- Aditiva. Se aplica ANTES del deploy de la Fase 11 (la API y el cron la necesitan); el
-- job de pg_cron va aparte en la 0019, que se aplica DESPUÉS del deploy.
--
-- Verificación: supabase/verificaciones/0018_api_webhooks.sql (solo lectura);
-- comportamiento: supabase/verificaciones/rls-fase11-api.sql (con rollback).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Idempotencia de la API pública
-- -----------------------------------------------------------------------------

create table public.api_idempotencia (
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  clave            text not null,
  recurso          text not null,
  huella           text not null,
  api_key_id       uuid references public.api_keys (id) on delete set null,
  estado           text not null default 'en_curso',
  status_http      smallint,
  respuesta        jsonb,
  recurso_id       uuid,
  reclamada_en     timestamptz not null default now(),
  terminada_en     timestamptz,
  creado_en        timestamptz not null default now(),
  constraint api_idempotencia_pkey primary key (organizacion_id, clave),
  constraint api_idempotencia_clave_valida check (clave ~ '^[!-~]{1,255}$'),
  constraint api_idempotencia_recurso_valido
    check (recurso in ('documento', 'lote', 'solicitud_folios')),
  constraint api_idempotencia_huella_valida check (huella ~ '^[0-9a-f]{64}$'),
  constraint api_idempotencia_estado_valido check (estado in ('en_curso', 'terminada')),
  constraint api_idempotencia_status_valido check (status_http between 100 and 599),
  constraint api_idempotencia_terminada_completa
    check ((estado = 'terminada') =
           (status_http is not null and respuesta is not null and terminada_en is not null))
);

comment on table public.api_idempotencia is
  'Idempotency-Key de la API pública (Fase 11): huella del cuerpo, estado y respuesta guardada para repetirla. Solo service_role.';

create index api_idempotencia_api_key
  on public.api_idempotencia (api_key_id) where api_key_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Autenticar una API key por su hash
-- -----------------------------------------------------------------------------

create function public.autenticar_api_key(p_clave_hash text)
returns table (
  api_key_id      uuid,
  organizacion_id uuid,
  empresa_id      uuid,
  alcances        text[],
  ambiente        public.ambiente_sii,
  motivo          text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.api_keys;
begin
  if p_clave_hash is null or p_clave_hash !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::uuid, null::uuid, null::text[], null::public.ambiente_sii, 'invalida'::text;
    return;
  end if;

  select * into k from public.api_keys a where a.clave_hash = p_clave_hash;
  if not found then
    return query select null::uuid, null::uuid, null::uuid, null::text[], null::public.ambiente_sii, 'invalida'::text;
    return;
  end if;
  if k.revocada_en is not null then
    return query select null::uuid, null::uuid, null::uuid, null::text[], null::public.ambiente_sii, 'revocada'::text;
    return;
  end if;
  if k.expira_en is not null and k.expira_en <= now() then
    return query select null::uuid, null::uuid, null::uuid, null::text[], null::public.ambiente_sii, 'vencida'::text;
    return;
  end if;
  if not coalesce((public.plan_vigente(k.organizacion_id)).incluye_api, false) then
    return query select null::uuid, null::uuid, null::uuid, null::text[], null::public.ambiente_sii, 'plan_sin_api'::text;
    return;
  end if;

  -- Como mucho una escritura por minuto y clave.
  update public.api_keys a
  set ultimo_uso_en = now()
  where a.id = k.id
    and (a.ultimo_uso_en is null or a.ultimo_uso_en < now() - interval '1 minute');

  return query select k.id, k.organizacion_id, k.empresa_id, k.alcances, k.ambiente, null::text;
end;
$$;

comment on function public.autenticar_api_key(text) is
  'Autentica una API key por su sha256 hex: una fila con los datos de la clave y motivo nulo, o ids nulos y motivo invalida | revocada | vencida | plan_sin_api. Solo service_role.';

-- -----------------------------------------------------------------------------
-- 3. Idempotencia: reclamar, terminar y soltar
-- -----------------------------------------------------------------------------

create function public.reclamar_idempotencia(
  p_organizacion      uuid,
  p_clave             text,
  p_recurso           text,
  p_huella            text,
  p_api_key           uuid default null,
  p_arriendo_segundos integer default 120
)
returns table (resultado text, status_http integer, respuesta jsonb, recurso_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arriendo integer := least(greatest(coalesce(p_arriendo_segundos, 120), 10), 900);
  v_fila     public.api_idempotencia;
begin
  if p_organizacion is null or p_clave is null or p_recurso is null or p_huella is null then
    raise exception 'Faltan la organización, la clave, el recurso o la huella' using errcode = '22004';
  end if;

  -- a) Nueva (los check de la tabla validan el formato: 23514).
  insert into public.api_idempotencia as i (organizacion_id, clave, recurso, huella, api_key_id)
  values (p_organizacion, p_clave, p_recurso, p_huella, p_api_key)
  on conflict on constraint api_idempotencia_pkey do nothing
  returning i.* into v_fila;
  if v_fila.clave is not null then
    return query select 'nueva'::text, null::integer, null::jsonb, null::uuid;
    return;
  end if;

  -- b) Retomada: misma huella y recurso, en curso, con el arriendo vencido.
  update public.api_idempotencia i
  set reclamada_en = now(),
      api_key_id = coalesce(p_api_key, i.api_key_id)
  where i.organizacion_id = p_organizacion
    and i.clave = p_clave
    and i.estado = 'en_curso'
    and i.huella = p_huella
    and i.recurso = p_recurso
    and i.reclamada_en < now() - make_interval(secs => v_arriendo)
  returning i.* into v_fila;
  if v_fila.clave is not null then
    return query select 'retomada'::text, null::integer, null::jsonb, v_fila.recurso_id;
    return;
  end if;

  -- c) Existe: conflicto, terminada o en curso.
  select * into v_fila from public.api_idempotencia i
  where i.organizacion_id = p_organizacion and i.clave = p_clave;
  if not found then
    -- Se borró entre el insert y el select (la organización se borró): como en curso.
    return query select 'en_curso'::text, null::integer, null::jsonb, null::uuid;
    return;
  end if;
  if v_fila.huella <> p_huella or v_fila.recurso <> p_recurso then
    return query select 'conflicto'::text, null::integer, null::jsonb, null::uuid;
    return;
  end if;
  if v_fila.estado = 'terminada' then
    return query select 'terminada'::text, v_fila.status_http::integer, v_fila.respuesta, v_fila.recurso_id;
    return;
  end if;
  return query select 'en_curso'::text, null::integer, null::jsonb, v_fila.recurso_id;
end;
$$;

comment on function public.reclamar_idempotencia(uuid, text, text, text, uuid, integer) is
  'Reclama una Idempotency-Key: nueva | retomada | en_curso | terminada (con status y respuesta) | conflicto. Solo service_role.';

create function public.terminar_idempotencia(
  p_organizacion uuid,
  p_clave        text,
  p_status_http  integer,
  p_respuesta    jsonb,
  p_recurso_id   uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if p_organizacion is null or p_clave is null or p_status_http is null or p_respuesta is null then
    raise exception 'Faltan la organización, la clave, el status o la respuesta' using errcode = '22004';
  end if;
  update public.api_idempotencia i
  set estado = 'terminada',
      status_http = p_status_http,
      respuesta = p_respuesta,
      recurso_id = coalesce(p_recurso_id, i.recurso_id),
      terminada_en = now()
  where i.organizacion_id = p_organizacion and i.clave = p_clave and i.estado = 'en_curso';
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;

comment on function public.terminar_idempotencia(uuid, text, integer, jsonb, uuid) is
  'Guarda la respuesta final de una Idempotency-Key en curso (true si la cerró). Solo service_role.';

create function public.soltar_idempotencia(
  p_organizacion uuid,
  p_clave        text,
  p_recurso_id   uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if p_organizacion is null or p_clave is null then
    raise exception 'Faltan la organización o la clave' using errcode = '22004';
  end if;
  update public.api_idempotencia i
  set reclamada_en = '-infinity',
      recurso_id = coalesce(p_recurso_id, i.recurso_id)
  where i.organizacion_id = p_organizacion and i.clave = p_clave and i.estado = 'en_curso';
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;

comment on function public.soltar_idempotencia(uuid, text, uuid) is
  'Deja una Idempotency-Key en curso retomable al instante (conserva la huella). Solo service_role.';

-- -----------------------------------------------------------------------------
-- 4. webhook_entregas: auditoría del reenvío e índices
-- -----------------------------------------------------------------------------

alter table public.webhook_entregas
  add column reenviada_en  timestamptz,
  add column reenviada_por uuid references auth.users (id) on delete set null;

-- `webhook_entregas_pendientes` (0001, solo `pendiente`) se deja: la 0018 es aditiva.
create index webhook_entregas_por_entregar
  on public.webhook_entregas (siguiente_intento_en) where estado in ('pendiente', 'fallido');
create index webhook_entregas_historial
  on public.webhook_entregas (webhook_id, id desc);
create index webhook_entregas_organizacion
  on public.webhook_entregas (organizacion_id, id desc);

-- -----------------------------------------------------------------------------
-- 5. Reclamar un lote de entregas (cron)
-- -----------------------------------------------------------------------------

create function public.reclamar_entregas_webhook(
  p_limite            integer default 32,
  p_arriendo_segundos integer default 120
)
returns table (
  id                bigint,
  organizacion_id   uuid,
  webhook_id        uuid,
  evento            text,
  payload           jsonb,
  intentos          integer,
  url               text,
  secreto_secret_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite   integer := least(greatest(coalesce(p_limite, 32), 1), 100);
  v_arriendo integer := least(greatest(coalesce(p_arriendo_segundos, 120), 30), 900);
begin
  -- a) Lo vencido que ya no corresponde entregar se descarta con su motivo. Las columnas
  --    de salida (id, organizacion_id, ...) son variables: todo va calificado.
  with vencidas as (
    select e.id as entrega, e.organizacion_id as org, e.intentos as hechos, w.activo
    from public.webhook_entregas e
    join public.webhooks w on w.id = e.webhook_id
    where e.estado in ('pendiente', 'fallido') and e.siguiente_intento_en <= now()
  ),
  planes as (
    select o.org, coalesce((public.plan_vigente(o.org)).incluye_webhooks, false) as incluye
    from (select distinct v.org from vencidas v) o
  )
  update public.webhook_entregas e
  set estado = 'descartado',
      ultima_respuesta = case
        when not v.activo then 'El webhook está desactivado.'
        when v.hechos >= 8 then 'Se agotaron los 8 intentos.'
        else 'El plan vigente no incluye webhooks.'
      end
  from vencidas v
  join planes p on p.org = v.org
  where e.id = v.entrega
    and (not v.activo or v.hechos >= 8 or not p.incluye);

  -- b) Por turnos entre organizaciones: primero la entrega más antigua de cada una, luego
  --    la segunda de cada una, etc. `skip locked`: dos corridas no toman la misma fila.
  return query
  with candidatas as (
    select e.id as entrega,
           row_number() over (partition by e.organizacion_id
                              order by e.siguiente_intento_en, e.id) as turno
    from public.webhook_entregas e
    where e.estado in ('pendiente', 'fallido') and e.siguiente_intento_en <= now()
  ),
  elegidas as (
    select e.id as entrega
    from public.webhook_entregas e
    join candidatas c on c.entrega = e.id
    where e.estado in ('pendiente', 'fallido') and e.siguiente_intento_en <= now()
    order by c.turno, e.siguiente_intento_en, e.id
    limit v_limite
    for update of e skip locked
  ),
  tomadas as (
    update public.webhook_entregas e
    set intentos = e.intentos + 1,
        siguiente_intento_en = now() + make_interval(secs => v_arriendo)
    from elegidas x
    where e.id = x.entrega
    returning e.id as entrega, e.organizacion_id as org, e.webhook_id as wh, e.evento as ev,
              e.payload as pl, e.intentos as hechos
  )
  select t.entrega, t.org, t.wh, t.ev, t.pl, t.hechos, w.url, w.secreto_secret_id
  from tomadas t
  join public.webhooks w on w.id = t.wh
  order by t.entrega;
end;
$$;

comment on function public.reclamar_entregas_webhook(integer, integer) is
  'Descarta lo que ya no corresponde entregar y toma hasta p_limite entregas vencidas por turnos entre organizaciones (skip locked), sumando el intento. Solo service_role.';

-- -----------------------------------------------------------------------------
-- 6. Cerrar una entrega
-- -----------------------------------------------------------------------------

-- `p_intento` es el `intentos` que devolvió `reclamar_entregas_webhook` (ya sumado): solo
-- se cierra si la fila sigue en ese intento. Un reenvío manual en medio de la entrega
-- (reinicia `intentos` a 0) o un reclamo posterior hacen que el cierre viejo devuelva
-- null sin pisar la fila.
create function public.cerrar_entrega_webhook(
  p_id          bigint,
  p_intento     integer,
  p_entregada   boolean,
  p_status_http integer default null,
  p_respuesta   text default null,
  p_definitiva  boolean default false
)
returns public.estado_entrega_webhook
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrega public.webhook_entregas;
  v_estado  public.estado_entrega_webhook;
  v_esperas interval[] := array['1 minute', '5 minutes', '30 minutes', '2 hours',
                                '6 hours', '12 hours', '24 hours']::interval[];
begin
  if p_id is null or p_intento is null or p_entregada is null then
    raise exception 'Faltan la entrega, el intento o el resultado' using errcode = '22004';
  end if;

  select * into v_entrega from public.webhook_entregas e
  where e.id = p_id and e.estado in ('pendiente', 'fallido') and e.intentos = p_intento
  for update;
  if not found then
    return null;   -- ya cerrada, reenviada o reclamada de nuevo (o no existe): nada que hacer
  end if;

  if p_entregada then
    v_estado := 'entregado';
  elsif coalesce(p_definitiva, false) or v_entrega.intentos >= 8 then
    v_estado := 'descartado';
  else
    v_estado := 'fallido';
  end if;

  update public.webhook_entregas e
  set estado = v_estado,
      ultimo_status_http = p_status_http,
      ultima_respuesta = left(p_respuesta, 1000),
      entregado_en = case when v_estado = 'entregado' then now() else e.entregado_en end,
      siguiente_intento_en = case
        when v_estado = 'fallido' then
          now() + v_esperas[least(greatest(v_entrega.intentos, 1), 7)] * (0.9 + random() * 0.2)
        else e.siguiente_intento_en
      end
  where e.id = p_id;

  return v_estado;
end;
$$;

comment on function public.cerrar_entrega_webhook(bigint, integer, boolean, integer, text, boolean) is
  'Cierra un intento de entrega: entregado, descartado (definitiva o 8 intentos) o fallido con backoff 1m-5m-30m-2h-6h-12h-24h (±10 %). Solo service_role.';

-- -----------------------------------------------------------------------------
-- 7. Acciones del panel: reenviar, probar, rotar el secreto
-- -----------------------------------------------------------------------------

create function public.reenviar_entrega_webhook(p_entrega bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servicio boolean := (select auth.role()) is not distinct from 'service_role';
  v_org      uuid;
  v_estado   public.estado_entrega_webhook;
  v_activo   boolean;
begin
  select e.organizacion_id, e.estado, w.activo into v_org, v_estado, v_activo
  from public.webhook_entregas e
  join public.webhooks w on w.id = e.webhook_id
  where e.id = p_entrega
  for update of e;
  if not found or (not v_servicio and not public.es_miembro(v_org)) then
    raise exception 'La entrega no existe' using errcode = 'P0002';
  end if;
  if not v_servicio and not public.es_admin(v_org) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not coalesce((public.plan_vigente(v_org)).incluye_webhooks, false) then
    raise exception 'El plan vigente no incluye webhooks' using errcode = 'P0001';
  end if;
  if not v_activo then
    raise exception 'El webhook está desactivado' using errcode = '22023';
  end if;
  if v_estado = 'pendiente' then
    raise exception 'La entrega ya está en cola' using errcode = '22023';
  end if;

  update public.webhook_entregas e
  set estado = 'pendiente',
      intentos = 0,
      siguiente_intento_en = now(),
      entregado_en = null,
      reenviada_en = now(),
      reenviada_por = (select auth.uid())
  where e.id = p_entrega;
end;
$$;

comment on function public.reenviar_entrega_webhook(bigint) is
  'Vuelve a poner en cola una entrega (la misma fila, intentos en 0). Administradores de la organización o service_role.';

create function public.probar_webhook(p_webhook uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servicio boolean := (select auth.role()) is not distinct from 'service_role';
  v_org      uuid;
  v_activo   boolean;
  v_id       bigint;
begin
  select w.organizacion_id, w.activo into v_org, v_activo
  from public.webhooks w where w.id = p_webhook;
  if not found or (not v_servicio and not public.es_miembro(v_org)) then
    raise exception 'El webhook no existe' using errcode = 'P0002';
  end if;
  if not v_servicio and not public.es_admin(v_org) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not coalesce((public.plan_vigente(v_org)).incluye_webhooks, false) then
    raise exception 'El plan vigente no incluye webhooks' using errcode = 'P0001';
  end if;
  if not v_activo then
    raise exception 'El webhook está desactivado' using errcode = '22023';
  end if;

  insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload)
  values (v_org, p_webhook, 'webhook.prueba',
          jsonb_build_object(
            'evento', 'webhook.prueba',
            'creado_en', now(),
            'datos', jsonb_build_object(
              'webhook_id', p_webhook,
              'mensaje', 'Entrega de prueba de Boletéame. Si la firma es válida, tu endpoint está listo.')))
  returning webhook_entregas.id into v_id;
  return v_id;
end;
$$;

comment on function public.probar_webhook(uuid) is
  'Encola una entrega webhook.prueba para el webhook. Administradores de la organización o service_role.';

create function public.rotar_secreto_webhook(p_webhook uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servicio  boolean := (select auth.role()) is not distinct from 'service_role';
  v_webhook   public.webhooks;
  v_secreto   text := 'whsec_' || public.token_aleatorio();
  v_secret_id uuid;
begin
  select * into v_webhook from public.webhooks w where w.id = p_webhook for update;
  if not found or (not v_servicio and not public.es_miembro(v_webhook.organizacion_id)) then
    raise exception 'El webhook no existe' using errcode = 'P0002';
  end if;
  if not v_servicio and not public.es_admin(v_webhook.organizacion_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  v_secret_id := vault.create_secret(v_secreto, null, 'webhook ' || v_webhook.url);
  update public.webhooks w set secreto_secret_id = v_secret_id where w.id = p_webhook;
  delete from vault.secrets s where s.id = v_webhook.secreto_secret_id;
  return v_secreto;
end;
$$;

comment on function public.rotar_secreto_webhook(uuid) is
  'Cambia el secreto HMAC del webhook en Vault (borra el anterior) y devuelve el nuevo UNA vez. Administradores de la organización o service_role.';

-- -----------------------------------------------------------------------------
-- 8. encolar_evento: solo con un plan que incluya webhooks
-- -----------------------------------------------------------------------------

create or replace function public.encolar_evento(p_organizacion uuid, p_evento text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload)
  select w.organizacion_id, w.id, p_evento,
         jsonb_build_object('evento', p_evento, 'creado_en', now(), 'datos', p_payload)
  from public.webhooks w
  where w.organizacion_id = p_organizacion
    and w.activo
    and p_evento = any (w.eventos)
    and coalesce((public.plan_vigente(p_organizacion)).incluye_webhooks, false);
$$;

-- -----------------------------------------------------------------------------
-- 9. tg_evento_documento: estado, origen y clave de idempotencia en los datos
-- -----------------------------------------------------------------------------

create or replace function public.tg_evento_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado in ('aceptado', 'aceptado_con_reparos', 'rechazado', 'incierto') then
    perform public.encolar_evento(
      new.organizacion_id,
      'documento.' || new.estado::text,
      jsonb_build_object(
        'documento_id', new.id, 'empresa_id', new.empresa_id, 'ambiente', new.ambiente,
        'tipo_dte', new.tipo_dte, 'folio', new.folio, 'mnt_total', new.mnt_total,
        'envio_id', new.envio_id, 'estado', new.estado, 'origen', new.origen,
        'clave_idempotencia', new.clave_idempotencia
      )
    );
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. URL permitida para los webhooks
-- -----------------------------------------------------------------------------

alter table public.webhooks add constraint webhooks_url_permitida check (
  length(url) <= 2048
  and url ~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
  and url !~* '^https://(localhost|[0-9.]+)(:443)?(/|$)'
  and url !~* '^https://[^/]*\.(local|localhost|internal)(:443)?(/|$)'
  and url !~ '^https://[^/:]*\.(:443)?(/|$)'
) not valid;
alter table public.webhooks validate constraint webhooks_url_permitida;

-- -----------------------------------------------------------------------------
-- 11. Índices para RLS, FK y el listado de la API
-- -----------------------------------------------------------------------------

create index api_keys_organizacion on public.api_keys (organizacion_id);
create index webhooks_organizacion on public.webhooks (organizacion_id);
create index operaciones_sii_api_key
  on public.operaciones_sii (api_key_id) where api_key_id is not null;
create index documentos_api_listado
  on public.documentos (organizacion_id, ambiente, creado_en desc, id desc);

-- -----------------------------------------------------------------------------
-- 12. API keys: revocar es definitivo y la expiración no se alarga
-- -----------------------------------------------------------------------------

-- La 0001 deja a los administradores editar (nombre, revocada_en, expira_en) por
-- PostgREST. Desde que `autenticar_api_key` existe, eso permitiría revivir una clave
-- filtrada (`revocada_en = null` o `expira_en` en el futuro). Se quita `expira_en` del
-- grant y un trigger lo impide para TODOS los roles, también service_role: la UI y la
-- documentación prometen que revocar es definitivo, y un caso excepcional se resuelve
-- creando otra clave (o, a mano, desactivando el trigger en una migración).
create function public.tg_api_key_sin_reactivar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revocada_en is not null and new.revocada_en is distinct from old.revocada_en then
    raise exception 'Una API key revocada no se puede reactivar ni cambiar su revocación'
      using errcode = '22023';
  end if;
  if new.expira_en is distinct from old.expira_en
     and (new.expira_en is null or (old.expira_en is not null and new.expira_en > old.expira_en)) then
    raise exception 'La expiración de una API key no se puede alargar ni quitar'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_10_api_key_sin_reactivar
  before update on public.api_keys
  for each row execute function public.tg_api_key_sin_reactivar();

revoke update on public.api_keys from authenticated;
grant update (nombre, revocada_en) on public.api_keys to authenticated;

-- -----------------------------------------------------------------------------
-- 13. RLS y privilegios
-- -----------------------------------------------------------------------------

alter table public.api_idempotencia enable row level security;   -- sin políticas
revoke all on public.api_idempotencia from anon, authenticated;
grant all on public.api_idempotencia to service_role;

revoke execute on function
  public.autenticar_api_key(text),
  public.reclamar_idempotencia(uuid, text, text, text, uuid, integer),
  public.terminar_idempotencia(uuid, text, integer, jsonb, uuid),
  public.soltar_idempotencia(uuid, text, uuid),
  public.reclamar_entregas_webhook(integer, integer),
  public.cerrar_entrega_webhook(bigint, integer, boolean, integer, text, boolean),
  public.reenviar_entrega_webhook(bigint),
  public.probar_webhook(uuid),
  public.rotar_secreto_webhook(uuid)
from public, anon, authenticated;

grant execute on function
  public.autenticar_api_key(text),
  public.reclamar_idempotencia(uuid, text, text, text, uuid, integer),
  public.terminar_idempotencia(uuid, text, integer, jsonb, uuid),
  public.soltar_idempotencia(uuid, text, uuid),
  public.reclamar_entregas_webhook(integer, integer),
  public.cerrar_entrega_webhook(bigint, integer, boolean, integer, text, boolean),
  public.reenviar_entrega_webhook(bigint),
  public.probar_webhook(uuid),
  public.rotar_secreto_webhook(uuid)
to service_role;

grant execute on function
  public.reenviar_entrega_webhook(bigint),
  public.probar_webhook(uuid),
  public.rotar_secreto_webhook(uuid)
to authenticated;

commit;
