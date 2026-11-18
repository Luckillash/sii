-- =============================================================================
-- 0016 · Pagos y suscripciones con la pasarela (PLAN-SAAS Fase 10, decisión D4: Flow)
--
-- El cobro recurrente lo hace Flow (planes, cliente con tarjeta registrada, importes
-- mensuales con reintentos). La base guarda lo necesario para saber qué plan rige, qué
-- se cobró y cómo volver a consultar a Flow. Todo lo escribe el backend (service_role):
-- los usuarios solo leen, y solo propietarios y administradores (datos de facturación).
--
-- 1. `clientes_pago`: una fila por organización con su cliente en la pasarela
--    (`cliente_externo` = `customerId` de Flow), la tarjeta registrada (marca y últimos
--    4 dígitos; nunca el número) y el plan elegido antes de ir a registrar la tarjeta
--    (`plan_pendiente_id`). El retorno de Flow es un POST del navegador desde flow.cl, sin
--    las cookies de sesión (SameSite=Lax): la app identifica a la organización por el
--    `customerId` que confirma Flow con el token, y el plan por esta columna, que dejó un
--    administrador con su sesión.
-- 2. `pagos`: un importe (invoice) de la pasarela por fila, identificado por
--    `(proveedor, factura_externa)` (único: la sincronización hace upsert). `estado`:
--    `pendiente` (sin pagar, no vencido), `vencido` (pasó `vence_en` sin pago), `pagado`
--    o `anulado`. `enlace_pago` es el link de pago de Flow para un importe impago.
-- 3. `eventos_pasarela`: cada notificación recibida de la pasarela (registro de tarjeta,
--    pago), única por `(proveedor, tipo, token)`. Flow solo manda un `token` y la app
--    consulta el resultado firmado; el token no sirve sin la llave secreta. Sirve para
--    auditar y para no procesar dos veces el mismo aviso. Sin acceso para los usuarios.
-- 4. `suscripciones`: `cancelar_al_fin_periodo` (cancelación pedida en Flow, rige hasta
--    `periodo_fin`), `sincronizada_en` (última lectura de Flow) e índice único de
--    `(proveedor_pago, id_externo)` (columnas de la 0001).
-- 5. `activar_suscripcion(p_organizacion, p_plan, p_estado, p_proveedor, p_id_externo,
--    p_periodo_inicio, p_periodo_fin) → uuid`: deja vigente el plan pedido en UNA
--    transacción. Bloquea las suscripciones de la organización (`for update`); si la
--    vigente ya es esa misma suscripción externa (o el mismo plan sin proveedor, p. ej.
--    volver a `certificacion`), la actualiza y devuelve su id (idempotente: el retorno de
--    Flow y el cron pueden llegar dos veces); si no, la deja `cancelada` (con
--    `periodo_fin = now()` si no tenía) e inserta la nueva. Así nunca choca con el índice
--    `suscripciones_vigente_unica` ni deja a la organización sin plan entre dos pasos.
--    `p_estado` solo `prueba` o `activa` (la mora la marca la sincronización con un
--    update). Solo service_role. Errores: 22004 faltan datos; 22023 estado no permitido,
--    proveedor sin id externo o id externo de una suscripción ya cancelada (aviso tardío
--    de Flow); P0002 la organización o el plan no existen.
--
-- RLS: `clientes_pago` y `pagos` con lectura `es_admin(organizacion_id)`; `authenticated`
-- solo `select`, `anon` nada. `eventos_pasarela` sin políticas (solo service_role).
-- Ninguna en Realtime.
--
-- Verificación: supabase/verificaciones/0016_pagos.sql (solo lectura); comportamiento:
-- supabase/verificaciones/rls-fase10-pagos.sql (con rollback).
-- =============================================================================

begin;

-- 1. Cliente de la pasarela por organización -----------------------------------

create table public.clientes_pago (
  organizacion_id      uuid primary key references public.organizaciones (id) on delete cascade,
  proveedor            text not null check (proveedor in ('flow')),
  cliente_externo      text not null check (length(cliente_externo) between 1 and 100),
  tarjeta_marca        text check (length(tarjeta_marca) <= 40),
  tarjeta_ultimos4     text check (tarjeta_ultimos4 ~ '^[0-9]{4}$'),
  tarjeta_registrada_en timestamptz,
  plan_pendiente_id    uuid references public.planes (id),
  plan_pendiente_por   uuid references auth.users (id) on delete set null,
  plan_pendiente_en    timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  unique (proveedor, cliente_externo)
);

comment on table public.clientes_pago is
  'Cliente de la organización en la pasarela de pagos (Flow) y tarjeta registrada. Solo lo escribe el backend.';

create trigger trg_90_actualizado_en before update on public.clientes_pago
  for each row execute function public.tg_actualizado_en();

-- 2. Pagos (importes de la pasarela) -------------------------------------------

create table public.pagos (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  suscripcion_id   uuid references public.suscripciones (id) on delete set null,
  proveedor        text not null check (proveedor in ('flow')),
  factura_externa  text not null check (length(factura_externa) between 1 and 100),
  orden_externa    text check (length(orden_externa) <= 100),
  monto_clp        integer not null check (monto_clp >= 0),
  estado           text not null check (estado in ('pendiente', 'vencido', 'pagado', 'anulado')),
  periodo_inicio   date,
  periodo_fin      date,
  vence_en         date,
  pagado_en        timestamptz,
  medio            text check (length(medio) <= 60),
  enlace_pago      text check (enlace_pago ~ '^https://'),
  intentos         integer not null default 0 check (intentos >= 0),
  error            text check (length(error) <= 500),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (proveedor, factura_externa)
);

comment on table public.pagos is
  'Importes cobrados por la pasarela (invoices de Flow), sincronizados por el backend.';

create index pagos_organizacion on public.pagos (organizacion_id, periodo_inicio desc nulls last);

create trigger trg_90_actualizado_en before update on public.pagos
  for each row execute function public.tg_actualizado_en();

-- 3. Notificaciones recibidas de la pasarela -----------------------------------

create table public.eventos_pasarela (
  id               uuid primary key default gen_random_uuid(),
  proveedor        text not null check (proveedor in ('flow')),
  tipo             text not null check (tipo in ('registro', 'pago')),
  token            text not null check (length(token) between 1 and 200),
  organizacion_id  uuid references public.organizaciones (id) on delete set null,
  estado           text not null default 'recibido'
                   check (estado in ('recibido', 'procesado', 'ignorado', 'fallido')),
  intentos         integer not null default 1 check (intentos >= 1),
  datos            jsonb not null default '{}'::jsonb,
  error            text check (length(error) <= 500),
  recibido_en      timestamptz not null default now(),
  procesado_en     timestamptz,
  unique (proveedor, tipo, token)
);

comment on table public.eventos_pasarela is
  'Avisos de la pasarela (solo traen un token); auditoría e idempotencia. Solo service_role.';

-- 4. Suscripciones ---------------------------------------------------------------

alter table public.suscripciones
  add column cancelar_al_fin_periodo boolean not null default false,
  add column sincronizada_en timestamptz;

create unique index suscripciones_externa_unica
  on public.suscripciones (proveedor_pago, id_externo) where id_externo is not null;

-- 5. Cambiar la suscripción vigente en una transacción -------------------------

create function public.activar_suscripcion(
  p_organizacion   uuid,
  p_plan           uuid,
  p_estado         public.estado_suscripcion,
  p_proveedor      text default null,
  p_id_externo     text default null,
  p_periodo_inicio timestamptz default null,
  p_periodo_fin    timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vigente public.suscripciones;
  v_id      uuid;
begin
  if p_organizacion is null or p_plan is null or p_estado is null then
    raise exception 'Faltan la organización, el plan o el estado' using errcode = '22004';
  end if;
  if p_estado not in ('prueba', 'activa') then
    raise exception 'Estado no permitido al activar: %', p_estado using errcode = '22023';
  end if;
  if (p_proveedor is null) <> (p_id_externo is null) then
    raise exception 'El proveedor y el id externo van juntos' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizaciones where id = p_organizacion) then
    raise exception 'La organización no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.planes where id = p_plan) then
    raise exception 'El plan no existe' using errcode = 'P0002';
  end if;

  -- Serializa los cambios de plan de la organización (retorno de Flow, cron, cancelación).
  -- `for no key update` y no `for update`: no choca con el `for key share` que toman las
  -- FK al insertar documentos, envíos o `uso_mensual`, así no frena la emisión.
  perform 1 from public.organizaciones where id = p_organizacion for no key update;

  -- Un id externo que ya terminó (suscripción cancelada) no se reactiva: el índice
  -- `suscripciones_externa_unica` lo impediría con un 23505 genérico.
  if p_id_externo is not null and exists (
       select 1 from public.suscripciones
       where proveedor_pago = p_proveedor and id_externo = p_id_externo and estado = 'cancelada'
     ) then
    raise exception 'La suscripción externa % ya terminó', p_id_externo using errcode = '22023';
  end if;

  select * into v_vigente
  from public.suscripciones
  where organizacion_id = p_organizacion and estado in ('prueba', 'activa', 'morosa')
  for update;

  if found and (
       (p_id_externo is not null and v_vigente.proveedor_pago = p_proveedor
          and v_vigente.id_externo = p_id_externo)
       or (p_id_externo is null and v_vigente.id_externo is null and v_vigente.plan_id = p_plan)
     ) then
    update public.suscripciones
    set plan_id        = p_plan,
        estado         = p_estado,
        periodo_inicio = coalesce(p_periodo_inicio, periodo_inicio),
        periodo_fin    = case when p_id_externo is null then p_periodo_fin
                              else coalesce(p_periodo_fin, periodo_fin) end,
        cancelar_al_fin_periodo = false
    where id = v_vigente.id;
    return v_vigente.id;
  end if;

  if found then
    update public.suscripciones
    set estado = 'cancelada',
        periodo_fin = coalesce(least(periodo_fin, now()), now())
    where id = v_vigente.id;
  end if;

  insert into public.suscripciones
    (organizacion_id, plan_id, estado, periodo_inicio, periodo_fin, proveedor_pago, id_externo,
     sincronizada_en)
  values
    (p_organizacion, p_plan, p_estado, coalesce(p_periodo_inicio, now()), p_periodo_fin,
     p_proveedor, p_id_externo, case when p_proveedor is not null then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.activar_suscripcion is
  'Deja vigente un plan (cancela la suscripción anterior e inserta la nueva, o actualiza la misma). Solo service_role.';

-- RLS y privilegios ----------------------------------------------------------------

alter table public.clientes_pago enable row level security;
alter table public.pagos enable row level security;
alter table public.eventos_pasarela enable row level security;

create policy lectura on public.clientes_pago for select to authenticated
  using (public.es_admin(organizacion_id));
create policy lectura on public.pagos for select to authenticated
  using (public.es_admin(organizacion_id));

revoke all on public.clientes_pago, public.pagos, public.eventos_pasarela from anon, authenticated;
grant select on public.clientes_pago, public.pagos to authenticated;
grant all on public.clientes_pago, public.pagos, public.eventos_pasarela to service_role;

revoke execute on function public.activar_suscripcion(uuid, uuid, public.estado_suscripcion, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.activar_suscripcion(uuid, uuid, public.estado_suscripcion, text, text, timestamptz, timestamptz)
  to service_role;

commit;
