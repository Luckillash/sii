-- =============================================================================
-- 0007 · Bloqueo con arriendo por certificado y ambiente, y una sola operación de
--        efecto global en curso por empresa (PLAN-SAAS Fase 4)
--
-- Por qué: las operaciones del portal del SII (postulación, set de pruebas, solicitud
-- de folios, declaración) entran con una sesión AUT2000 abierta con el certificado
-- digital. El SII frena el re-login seguido con el mismo certificado (~5 ciclos, error
-- `01.01.215.500.771.52`), y `sesiones_sii` guarda las cookies para reutilizarlas. Si
-- dos peticiones con el mismo certificado llegan juntas (dos pestañas, un doble clic,
-- un cron y un usuario) y no encuentran sesión vigente, las dos se autentican a la vez
-- y gastan intentos, o una pisa las cookies de la otra. `bloqueos.ts` toma este bloqueo
-- antes de abrir o reutilizar la sesión y lo suelta al terminar.
--
-- Por qué no advisory locks (el plan proponía `bloquear_certificado(uuid)` con
-- `pg_try_advisory_xact_lock`):
--   - `pg_try_advisory_xact_lock` se suelta al terminar la transacción, y cada llamada
--     RPC de PostgREST es una transacción: el candado dura lo que dura la RPC, no la
--     operación con el SII (segundos o minutos, en otra petición HTTP). No serializa
--     nada.
--   - `pg_try_advisory_lock` (de sesión) queda pegado a la conexión de Postgres, que
--     PostgREST y Supavisor reparten entre peticiones: lo soltaría (o lo heredaría)
--     cualquier otra petición que use esa conexión, y si la función de Vercel muere a
--     la mitad nadie lo suelta.
-- En su lugar, una fila por (certificado, ambiente) con un titular y un vencimiento
-- (arriendo). Quien la toma la suelta con su titular; si la función muere sin
-- soltarla, el arriendo vence solo y otro la puede tomar. El arriendo por defecto de
-- la app (300 s) es el `maxDuration` más largo de las funciones de Vercel: mientras la
-- función que lo tomó sigue viva, el arriendo no vence.
--
-- 1. Tabla `bloqueos_sii`: RLS activo y SIN políticas, sin privilegios para `anon` ni
--    `authenticated` (como `tokens_sii` y `sesiones_sii`): solo el backend la toca, y
--    por las dos funciones. Las filas vencidas que quedan (función muerta) no estorban:
--    la próxima toma las pisa. Al borrar el certificado se borran en cascada.
--
-- 2. `tomar_bloqueo_certificado(certificado, ambiente, titular, segundos)` → boolean:
--    un solo `insert ... on conflict do update ... where` (atómico): si no hay fila, la
--    crea; si la hay y venció, o es del mismo titular, la toma (el mismo titular
--    renueva el arriendo y conserva `tomado_en`). Devuelve true si el bloqueo quedó a
--    nombre de `p_titular`, false si otro titular lo tiene vigente. Dos llamadas
--    simultáneas se ordenan en el índice de la llave primaria: la segunda espera a que
--    la primera termine y evalúa el `where` sobre la fila que dejó.
--    Códigos de error:
--      22004  Falta el certificado, el ambiente o el titular.
--      22023  `p_segundos` nulo o fuera de 1..900.
--      23503  El certificado no existe (FK de la tabla).
--
-- 3. `liberar_bloqueo_certificado(certificado, ambiente, titular)` → boolean: borra la
--    fila solo si el titular coincide (vencida o no). Devuelve true si la borró, false
--    si no había bloqueo o era de otro titular (por ejemplo, el arriendo venció y otro
--    lo tomó: no se le quita).
--
-- Las dos son `security definer` con `search_path` vacío y solo las ejecuta
-- `service_role` (mismo patrón que `registrar_certificado` en 0005): la capa SII llama
-- con el cliente de servicio después de validar a quien pide la operación.
--
-- 4. Índice único parcial `operaciones_sii_efecto_global_en_curso` sobre
--    `operaciones_sii (empresa_id, operacion, ambiente)` donde `resultado = 'en_curso'`,
--    `confirmada` y la operación es de efecto global (`solicitar_folios`, `postular`,
--    `declarar`): una sola de esas operaciones confirmadas en curso por empresa y
--    ambiente.
--    Por qué: `ejecutarOperacion` (apps/web/src/server/sii/operacion.ts) revisaba la
--    última fila y después insertaba la suya, sin atomicidad. Dos `solicitar_folios`
--    simultáneas de la misma empresa pasaban las dos el control («en curso / incierto
--    sin revisar»): el bloqueo del certificado (secciones 1 a 3) las pone en fila, pero
--    no las descarta, y la segunda timbraba otro rango al soltarse el bloqueo (doble
--    timbraje). Con el índice, el insert de la segunda falla con 23505 y no se ejecuta;
--    `ejecutarOperacion` además vuelve a revisar después de insertar, para el incierto
--    que aparece entre su control previo y su insert.
--    - La lista de operaciones está SINCRONIZADA con `OPERACIONES_EFECTO_GLOBAL` de
--      operacion.ts: si cambia una, cambia la otra (y la verificación 0007).
--    - `empresa_id` nulo: en un índice único los NULL no chocan, así que una fila sin
--      empresa no estaría protegida. Esas operaciones siempre son de una empresa:
--      `ejecutarOperacion` rechaza como `uso` (sin insertar) una de efecto global sin
--      `empresaId`. No se agrega un check porque `empresa_id` es `on delete set null`
--      (borrar una empresa dejaría filas históricas con NULL) y tampoco se usa
--      `nulls not distinct`, que haría chocar filas sin empresa de organizaciones
--      distintas (el índice no lleva `organizacion_id`: `empresa_id` ya es único).
--    - Una fila `en_curso` abandonada (la función murió) sigue en el índice y bloquea
--      hasta que alguien la marca como revisada (`marcarInciertaRevisada`, que la pasa
--      a `incierto`): es lo correcto, no se sabe si llegó al SII.
--    - Antes de aplicar (solo lectura), confirma que no hay duplicados que impidan crear
--      el índice; debe devolver 0 filas:
--        select empresa_id, operacion, ambiente, count(*) from public.operaciones_sii
--        where resultado = 'en_curso' and confirmada
--          and operacion in ('solicitar_folios', 'postular', 'declarar')
--        group by 1, 2, 3 having count(*) > 1;
--
-- Aditiva: una tabla, dos funciones y un índice nuevos.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tabla de bloqueos (solo service_role, por las funciones)
-- -----------------------------------------------------------------------------

create table public.bloqueos_sii (
  certificado_id uuid not null references public.certificados (id) on delete cascade,
  ambiente       public.ambiente_sii not null,
  titular        uuid not null,                          -- quien lo tomó (aleatorio por operación)
  vence_en       timestamptz not null,                   -- fin del arriendo
  tomado_en      timestamptz not null default now(),
  primary key (certificado_id, ambiente)
);

comment on table public.bloqueos_sii is
  'Bloqueo con arriendo por certificado y ambiente: serializa las sesiones AUT2000 del SII entre peticiones. Solo por tomar_bloqueo_certificado y liberar_bloqueo_certificado (service_role).';

alter table public.bloqueos_sii enable row level security;
-- Sin políticas: RLS rechaza todo lo que no sea service_role (o el dueño, en las funciones).
revoke all on public.bloqueos_sii from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tomar (o renovar) el bloqueo
-- -----------------------------------------------------------------------------

create function public.tomar_bloqueo_certificado(
  p_certificado uuid,
  p_ambiente    public.ambiente_sii,
  p_titular     uuid,
  p_segundos    integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_certificado is null or p_ambiente is null or p_titular is null then
    raise exception 'Faltan el certificado, el ambiente o el titular del bloqueo'
      using errcode = '22004';
  end if;
  if p_segundos is null or p_segundos not between 1 and 900 then
    raise exception 'La duración del bloqueo debe estar entre 1 y 900 segundos'
      using errcode = '22023';
  end if;

  insert into public.bloqueos_sii as b (certificado_id, ambiente, titular, vence_en, tomado_en)
  values (p_certificado, p_ambiente, p_titular, now() + make_interval(secs => p_segundos), now())
  on conflict (certificado_id, ambiente) do update
    set titular   = excluded.titular,
        vence_en  = excluded.vence_en,
        -- El mismo titular renueva: conserva cuándo lo tomó.
        tomado_en = case when b.titular = excluded.titular then b.tomado_en
                         else excluded.tomado_en end
    where b.vence_en <= now() or b.titular = excluded.titular;

  -- found: la fila se insertó o se actualizó (si el where la descartó, es de otro y vigente).
  return found;
end;
$$;

comment on function public.tomar_bloqueo_certificado(uuid, public.ambiente_sii, uuid, integer) is
  'Toma (o renueva, si es el mismo titular) el bloqueo del certificado en el ambiente por p_segundos (1..900). true si quedó a nombre de p_titular; false si otro lo tiene vigente. Solo service_role.';

revoke execute on function public.tomar_bloqueo_certificado(uuid, public.ambiente_sii, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.tomar_bloqueo_certificado(uuid, public.ambiente_sii, uuid, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. Liberar el bloqueo (solo su titular)
-- -----------------------------------------------------------------------------

create function public.liberar_bloqueo_certificado(
  p_certificado uuid,
  p_ambiente    public.ambiente_sii,
  p_titular     uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.bloqueos_sii
  where certificado_id = p_certificado and ambiente = p_ambiente and titular = p_titular;
  return found;
end;
$$;

comment on function public.liberar_bloqueo_certificado(uuid, public.ambiente_sii, uuid) is
  'Suelta el bloqueo del certificado en el ambiente si p_titular es quien lo tiene. true si lo soltó; false si no había o era de otro. Solo service_role.';

revoke execute on function public.liberar_bloqueo_certificado(uuid, public.ambiente_sii, uuid)
  from public, anon, authenticated;
grant execute on function public.liberar_bloqueo_certificado(uuid, public.ambiente_sii, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 4. Una sola operación de efecto global confirmada en curso por empresa y ambiente
-- -----------------------------------------------------------------------------

-- La lista de operaciones es OPERACIONES_EFECTO_GLOBAL de
-- apps/web/src/server/sii/operacion.ts: mantenerlas iguales.
create unique index operaciones_sii_efecto_global_en_curso
  on public.operaciones_sii (empresa_id, operacion, ambiente)
  where resultado = 'en_curso'
    and confirmada
    and operacion in ('solicitar_folios', 'postular', 'declarar');

comment on index public.operaciones_sii_efecto_global_en_curso is
  'Una sola solicitar_folios / postular / declarar confirmada en curso por empresa y ambiente: la segunda de dos simultáneas falla con 23505 y no se ejecuta (evita el doble timbraje). Lista sincronizada con OPERACIONES_EFECTO_GLOBAL de operacion.ts.';

commit;
