-- =============================================================================
-- 0013 · Notificaciones: no repetir alertas por correo (PLAN-SAAS Fase 8, §4.6 y §6)
--
-- `/api/cron/alertas` (cada 10 min, migración 0014) avisa por correo a propietarios y
-- administradores de: documento rechazado por el SII, envío incierto y certificado por
-- vencer (30, 15, 7 y 1 días). La `Idempotency-Key` de Resend solo frena repeticiones
-- durante 24 h, y el cron vuelve a ver el mismo documento rechazado en cada corrida
-- (dentro de la ventana de 48 h) y el mismo certificado durante días: hace falta una
-- marca durable de «este aviso ya salió».
--
-- 1. Tabla `notificaciones`: una fila por aviso, identificada por `clave` (única), que
--    arma la app con el tipo, el id del objeto y, si corresponde, el umbral:
--      documento.rechazado:<documento_id>
--      envio.incierto:<envio_id>
--      certificado.por_vencer:<certificado_id>:<30|15|7|1>
--    - `tipo` es texto con el formato de los eventos de webhook (`documento.rechazado`,
--      como `encolar_evento`), no una lista cerrada ni un enum: un aviso nuevo (fases 10
--      y 11) no necesita migración, y un enum no admite `add value` en la misma
--      transacción que lo usa. La integridad la da el formato y que la clave empiece
--      por `<tipo>:`.
--    - `estado`: `pendiente` (reclamada, el correo está saliendo), `enviada` (Resend la
--      aceptó; `enviado_en` y `resend_id`) o `fallida` (Resend no la aceptó; `error`
--      guarda el motivo acotado, nunca el cuerpo del correo ni la API key).
--    - `grupo`: la `Idempotency-Key` del correo que la lleva. Los documentos rechazados
--      de una misma organización, empresa y ambiente salen en UN correo, pero cada
--      documento tiene su fila (un documento nunca se avisa dos veces aunque cambie el
--      grupo). La app fija `grupo` en las filas nuevas ANTES de enviar, y un reintento
--      reagrupa por `grupo` y reusa la misma clave: si el primer intento sí salió (la
--      función murió antes de cerrar, o Resend no respondió a tiempo), Resend no lo
--      duplica. Todas las del grupo guardan el mismo `resend_id`.
--    - `datos`: lo mínimo para auditar (empresa, ambiente, umbral); sin secretos.
--    - Al borrar la organización se borran sus notificaciones (cascada). `referencia_id`
--      no tiene FK porque apunta a tablas distintas según el tipo, y el registro de que
--      el aviso salió sirve aunque el objeto ya no exista.
--
-- 2. `reclamar_notificacion(p_organizacion, p_tipo, p_clave, p_referencia, p_datos)` →
--    una fila `(id, intentos, grupo)` o ninguna. Un solo `insert ... on conflict (clave)
--    do update ... where` (atómico, como `tomar_bloqueo_certificado` de la 0007): si la
--    clave no existe, crea la fila `pendiente` con `intentos = 1` y `grupo` nulo; si
--    existe, la vuelve a tomar solo si se puede reintentar (y devuelve su `grupo`, para
--    reusar la `Idempotency-Key`); si no, no devuelve nada (= ya enviada o en curso: no
--    se envía). Se puede reintentar si es de la misma organización, tiene menos de 5
--    intentos y está `fallida`, o quedó `pendiente` hace más de 15 minutos (la función
--    murió entre reclamar y cerrar; el `maxDuration` de la ruta es 60 s). Dos corridas
--    simultáneas se ordenan en el índice único: solo una recibe la fila.
--    `security definer`, `search_path` vacío y solo `service_role` (la llama el cron
--    con el cliente de servicio). Fijar `grupo` y cerrar la fila (`enviada` / `fallida`)
--    son `update` directos del mismo cliente.
--    Códigos de error: 22004 falta la organización, el tipo o la clave; 23514 tipo o
--    clave con formato inválido (los `check` de la tabla); 23503 la organización no
--    existe.
--
-- 3. `notificacion_cerrada(p_clave)` → boolean: la negación exacta de «se puede
--    reclamar»: hay fila y está `enviada`, o usó sus 5 intentos, o está `pendiente` hace
--    menos de 15 minutos. La usan las tres funciones del punto 4.
--
-- 4. Candidatos de cada alerta, SIN lo ya notificado y repartidos entre organizaciones
--    (`alertas_documentos_rechazados(p_desde, p_limite)`,
--    `alertas_envios_inciertos(p_desde, p_limite)`, `alertas_certificados_por_vencer(
--    p_limite)`). Por qué en la base y no con `.limit()` desde la app: con un orden
--    global y un tope fijo, una organización con más eventos que el tope (o eventos
--    sin a quién avisar) ocupaba siempre las mismas filas y las demás no avanzaban.
--    Aquí (a) se excluye en la consulta lo que `notificacion_cerrada` da por cerrado, así
--    lo ya avisado nunca ocupa cupo, y (b) se ordena por turno dentro de cada
--    organización (`row_number() over (partition by organizacion_id ...)`): primero el
--    evento más antiguo de cada organización, después el segundo de cada una, etc. Con
--    el tope, todas avanzan en cada corrida.
--    - Rechazos: `documentos` en `rechazado`, sin el set de pruebas (lo sigue el
--      asistente de certificación), con `actualizado_en >= p_desde` (la ventana).
--    - Inciertos: `envios` con `incierto`, de `emision` (el set tiene su bloqueo), en la
--      ventana.
--    - Certificados: `v_certificados_estado` en `por_vencer`, con el umbral que
--      corresponde a `dias_restantes` (1, 7, 15 o 30, el más chico que lo cubre;
--      sincronizado con `umbralCertificado` de la app), excluyendo el aviso de ESE
--      umbral si ya salió. El más urgente primero.
--    `p_limite` entre 1 y 1000 (nulo = 200). `stable`, `security invoker` (las llama
--    service_role, que salta RLS) y solo `service_role`.
--
-- 5. RLS: lectura para los miembros de la organización (`es_miembro`, igual que
--    `envios` o `documentos`): los avisos solo traen ids, estados y los correos de los
--    administradores, que los miembros ya ven en `perfiles`. Nadie escribe con su
--    sesión: se revocan a `authenticated` `insert`, `update`, `delete`, `truncate`,
--    `references` y `trigger` (los tenía por los grants por defecto de Supabase) y a
--    `anon` todo. Escribe solo el backend (service_role). Sin Realtime: ninguna vista
--    la escucha.
--
-- Aditiva: una tabla, cinco funciones, un índice y un trigger nuevos. Conviene aplicarla
-- ANTES del deploy de la ruta; si la ruta corre sin ella, no envía nada (no puede leer
-- candidatos ni reclamar filas) y la corrida queda con error en el resumen y en Sentry.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tabla
-- -----------------------------------------------------------------------------

create table public.notificaciones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  tipo             text not null,
  referencia_id    uuid,                                  -- documento, envío o certificado
  clave            text not null,                         -- deduplicación (ver arriba)
  grupo            text,                                  -- Idempotency-Key del correo
  datos            jsonb not null default '{}'::jsonb,
  destinatarios    text[] not null default '{}',
  estado           text not null default 'pendiente',
  intentos         integer not null default 1,
  resend_id        text,
  error            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  enviado_en       timestamptz,
  constraint notificaciones_clave_unica unique (clave),
  constraint notificaciones_tipo_valido
    check (tipo ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  constraint notificaciones_clave_valida
    check (length(clave) <= 200 and length(clave) > length(tipo) + 1
           and starts_with(clave, tipo || ':')),
  constraint notificaciones_estado_valido
    check (estado in ('pendiente', 'enviada', 'fallida')),
  constraint notificaciones_enviada_con_fecha
    check ((estado = 'enviada') = (enviado_en is not null)),
  constraint notificaciones_intentos_validos
    check (intentos between 1 and 100),
  constraint notificaciones_datos_objeto
    check (jsonb_typeof(datos) = 'object'),
  constraint notificaciones_destinatarios_acotados
    check (cardinality(destinatarios) <= 50),
  constraint notificaciones_textos_acotados
    check ((error is null or length(error) <= 500)
           and (resend_id is null or length(resend_id) <= 200)
           and (grupo is null or length(grupo) between 1 and 256))
);

comment on table public.notificaciones is
  'Alertas por correo ya reclamadas o enviadas (Fase 8): una fila por aviso, clave única de deduplicación, grupo = Idempotency-Key del correo. Escribe solo el backend (service_role, reclamar_notificacion); los miembros leen.';

-- Listados por organización (y las políticas, que filtran por organizacion_id).
create index notificaciones_organizacion
  on public.notificaciones (organizacion_id, creado_en desc);

create trigger trg_90_actualizado_en
  before update on public.notificaciones
  for each row execute function public.tg_actualizado_en();

-- -----------------------------------------------------------------------------
-- 2. Reclamar (o volver a tomar) un aviso
-- -----------------------------------------------------------------------------

create function public.reclamar_notificacion(
  p_organizacion uuid,
  p_tipo         text,
  p_clave        text,
  p_referencia   uuid default null,
  p_datos        jsonb default '{}'::jsonb
)
returns table (id uuid, intentos integer, grupo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organizacion is null or p_tipo is null or p_clave is null then
    raise exception 'Faltan la organización, el tipo o la clave de la notificación'
      using errcode = '22004';
  end if;

  -- CTE con el insert: los nombres de la salida (id, intentos, grupo) no chocan con las
  -- columnas porque todo va calificado con `n.` o `r.`.
  return query
  with reclamada as (
    insert into public.notificaciones as n (organizacion_id, tipo, referencia_id, clave, datos)
    values (p_organizacion, p_tipo, p_referencia, p_clave, coalesce(p_datos, '{}'::jsonb))
    on conflict on constraint notificaciones_clave_unica do update
      set estado = 'pendiente',
          intentos = n.intentos + 1,
          error = null,
          datos = excluded.datos
      where n.organizacion_id = excluded.organizacion_id
        and n.intentos < 5
        and (n.estado = 'fallida'
             or (n.estado = 'pendiente' and n.actualizado_en < now() - interval '15 minutes'))
    returning n.id, n.intentos, n.grupo
  )
  select r.id, r.intentos, r.grupo from reclamada r;
  -- Sin filas: ya enviada, en curso, de otra organización o sin más intentos.
end;
$$;

comment on function public.reclamar_notificacion(uuid, text, text, uuid, jsonb) is
  'Reclama un aviso por su clave: (id, intentos, grupo) si hay que enviarlo (nuevo, o fallido/abandonado con menos de 5 intentos), ninguna fila si ya salió o está en curso. Solo service_role.';

-- -----------------------------------------------------------------------------
-- 3. ¿Aviso cerrado? (la negación de «se puede reclamar»)
-- -----------------------------------------------------------------------------

create function public.notificacion_cerrada(p_clave text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.notificaciones n
    where n.clave = p_clave
      and (n.estado = 'enviada'
           or n.intentos >= 5
           or (n.estado = 'pendiente' and n.actualizado_en >= now() - interval '15 minutes'))
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Candidatos de cada alerta (sin lo ya avisado, por turnos entre organizaciones)
-- -----------------------------------------------------------------------------

create function public.alertas_documentos_rechazados(p_desde timestamptz, p_limite integer default 200)
returns table (
  id uuid, organizacion_id uuid, empresa_id uuid, ambiente public.ambiente_sii,
  tipo_dte smallint, folio integer, mnt_total bigint, fecha_emision date, envio_id uuid
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.organizacion_id, c.empresa_id, c.ambiente, c.tipo_dte, c.folio, c.mnt_total,
         c.fecha_emision, c.envio_id
  from (
    select d.*, row_number() over (partition by d.organizacion_id
                                   order by d.actualizado_en, d.id) as turno
    from public.documentos d
    where d.estado = 'rechazado'
      and d.origen <> 'set_pruebas'
      and d.actualizado_en >= p_desde
      and not public.notificacion_cerrada('documento.rechazado:' || d.id::text)
  ) c
  order by c.turno, c.actualizado_en, c.id
  limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;

create function public.alertas_envios_inciertos(p_desde timestamptz, p_limite integer default 200)
returns table (
  id uuid, organizacion_id uuid, empresa_id uuid, ambiente public.ambiente_sii, creado_en timestamptz
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.organizacion_id, c.empresa_id, c.ambiente, c.creado_en
  from (
    select e.*, row_number() over (partition by e.organizacion_id
                                   order by e.actualizado_en, e.id) as turno
    from public.envios e
    where e.incierto
      and e.proposito = 'emision'
      and e.actualizado_en >= p_desde
      and not public.notificacion_cerrada('envio.incierto:' || e.id::text)
  ) c
  order by c.turno, c.actualizado_en, c.id
  limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;

create function public.alertas_certificados_por_vencer(p_limite integer default 200)
returns table (
  id uuid, organizacion_id uuid, rut_titular text, nombre_titular text, cn text,
  vigente_hasta timestamptz, dias_restantes integer, umbral integer
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.organizacion_id, c.rut_titular, c.nombre_titular, c.cn, c.vigente_hasta,
         c.dias_restantes, c.umbral
  from (
    select u.*, row_number() over (partition by u.organizacion_id
                                   order by u.vigente_hasta, u.id) as turno
    from (
      select v.id, v.organizacion_id, v.rut_titular::text as rut_titular, v.nombre_titular,
             v.cn, v.vigente_hasta, v.dias_restantes,
             case when v.dias_restantes <= 1 then 1
                  when v.dias_restantes <= 7 then 7
                  when v.dias_restantes <= 15 then 15
                  else 30
             end as umbral
      from public.v_certificados_estado v
      where v.estado = 'por_vencer'
    ) u
    where not public.notificacion_cerrada(
      'certificado.por_vencer:' || u.id::text || ':' || u.umbral::text)
  ) c
  order by c.turno, c.vigente_hasta, c.id
  limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;

-- Solo service_role ejecuta las cinco.
revoke execute on function
  public.reclamar_notificacion(uuid, text, text, uuid, jsonb),
  public.notificacion_cerrada(text),
  public.alertas_documentos_rechazados(timestamptz, integer),
  public.alertas_envios_inciertos(timestamptz, integer),
  public.alertas_certificados_por_vencer(integer)
  from public, anon, authenticated;
grant execute on function
  public.reclamar_notificacion(uuid, text, text, uuid, jsonb),
  public.notificacion_cerrada(text),
  public.alertas_documentos_rechazados(timestamptz, integer),
  public.alertas_envios_inciertos(timestamptz, integer),
  public.alertas_certificados_por_vencer(integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS y privilegios
-- -----------------------------------------------------------------------------

alter table public.notificaciones enable row level security;

create policy lectura on public.notificaciones for select to authenticated
  using (public.es_miembro(organizacion_id));

revoke all on public.notificaciones from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.notificaciones from authenticated;
grant select on public.notificaciones to authenticated;
grant all on public.notificaciones to service_role;

commit;
