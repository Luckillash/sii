-- =============================================================================
-- 0015 · Grilla de planes comerciales (PLAN-SAAS Fase 10, decisión D5)
--
-- La 0001 trae cuatro planes de ejemplo (`certificacion`, `emprendedor`, `pyme`,
-- `empresa`). La grilla decidida el 2026-11-17 (PLAN-SAAS §9, D5) es:
--
--   codigo         nombre         $/mes   empresas usuarios boletas/mes prod. API+webhooks autoservicio
--   certificacion  Certificación      0        1        2           0   no    no           no (gratis, por defecto)
--   pyme           Pyme           14.990        1        3       1.000   sí    no           sí
--   contador       Contador       49.990       15       10      10.000   sí    no           sí
--   api            API            39.990        3        5      20.000   sí    sí           sí
--   empresa        Empresa             0     ∞        ∞          ∞       sí    sí           no (a medida)
--   emprendedor    (se fusiona con pyme: activo = false)
--
-- 1. Columnas nuevas de `planes`:
--    - `autoservicio`: el plan se contrata desde Configuración → Plan, con cobro por la
--      pasarela (Flow, D4). `certificacion` no (es el plan gratis con que nace toda
--      organización, y al que vuelve al cancelar) y `empresa` tampoco (lo asigna
--      service_role por contrato; precio 0 en la tabla = sin precio público).
--    - `orden`: orden de la grilla en la UI y en la landing.
-- 2. Valores de la grilla, idempotentes (`on conflict (codigo) do update`). Al
--    2026-11-17 la única suscripción del proyecto es `certificacion`/`prueba` de la
--    organización `servicio`: ningún cliente cambia de límites con esta migración.
--    `emprendedor` queda con `activo = false` (no se borra: `suscripciones.plan_id` lo
--    referencia sin cascada, y la política `lectura` de `planes` ya oculta los inactivos).
--    `plan_vigente()` es `security definer` y no filtra por `activo`: una organización
--    que estuviera en un plan inactivo conserva sus límites.
-- 3. Certificación sin plazo (D5): `crear_organizacion()` deja de fijar
--    `periodo_fin = now() + 30 days` (que nada hacía cumplir: `plan_vigente()` no mira
--    `periodo_fin`), y las suscripciones `certificacion` vigentes pierden esa fecha.
--    `create or replace` conserva los privilegios que la 0001 dio a la función.
--
-- Verificación: supabase/verificaciones/0015_planes_comerciales.sql (solo lectura).
-- =============================================================================

begin;

alter table public.planes
  add column if not exists autoservicio boolean not null default false,
  add column if not exists orden smallint not null default 0;

comment on column public.planes.autoservicio is
  'Se contrata desde Configuración → Plan con cobro por la pasarela (Flow). Los demás los asigna service_role.';
comment on column public.planes.orden is 'Orden de la grilla en la UI y en la landing.';

insert into public.planes
  (codigo, nombre, precio_mensual_clp, max_empresas, max_usuarios, max_boletas_mes,
   permite_produccion, incluye_api, incluye_webhooks, activo, autoservicio, orden) values
  ('certificacion', 'Certificación',     0,    1,    2,     0, false, false, false, true,  false, 0),
  ('pyme',          'Pyme',          14990,    1,    3,  1000, true,  false, false, true,  true,  1),
  ('contador',      'Contador',      49990,   15,   10, 10000, true,  false, false, true,  true,  2),
  ('api',           'API',           39990,    3,    5, 20000, true,  true,  true,  true,  true,  3),
  ('empresa',       'Empresa',           0, null, null,  null, true,  true,  true,  true,  false, 4),
  ('emprendedor',   'Emprendedor',    9990,    1,    2,   500, true,  false, false, false, false, 9)
on conflict (codigo) do update set
  nombre             = excluded.nombre,
  precio_mensual_clp = excluded.precio_mensual_clp,
  max_empresas       = excluded.max_empresas,
  max_usuarios       = excluded.max_usuarios,
  max_boletas_mes    = excluded.max_boletas_mes,
  permite_produccion = excluded.permite_produccion,
  incluye_api        = excluded.incluye_api,
  incluye_webhooks   = excluded.incluye_webhooks,
  activo             = excluded.activo,
  autoservicio       = excluded.autoservicio,
  orden              = excluded.orden;

-- Certificación sin plazo. Mismo cuerpo que la 0001, salvo `periodo_fin`.
create or replace function public.crear_organizacion(p_nombre text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_org     uuid;
begin
  if v_usuario is null then
    raise exception 'Requiere sesión' using errcode = '42501';
  end if;
  insert into public.organizaciones (nombre, slug, creado_por)
  values (p_nombre, lower(p_slug), v_usuario)
  returning id into v_org;

  -- Plan gratis de certificación, sin vencimiento (PLAN-SAAS D5, migración 0015).
  insert into public.suscripciones (organizacion_id, plan_id, estado, periodo_fin)
  select v_org, p.id, 'prueba', null
  from public.planes p where p.codigo = 'certificacion';

  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
  values (v_org, v_usuario, 'propietario');
  return v_org;
end;
$$;

update public.suscripciones s
set periodo_fin = null
from public.planes p
where p.id = s.plan_id
  and p.codigo = 'certificacion'
  and s.estado = 'prueba'
  and s.periodo_fin is not null;

commit;
