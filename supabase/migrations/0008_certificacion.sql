-- =============================================================================
-- 0008 · Certificación ante el SII: CAF a Vault y set de pruebas (PLAN-SAAS Fase 5)
--
-- (El plan reservaba `0008` para `notificaciones` de la Fase 8; el número definitivo es
-- por orden de creación, PLAN-SAAS §6. Las de las fases siguientes se corren un número.)
--
-- Dos RPC del backend (solo service_role) para escrituras que con sentencias sueltas
-- desde la app quedarían a medias si algo falla entre una y otra:
--
-- 1. `registrar_caf(...)` → uuid: guarda el XML COMPLETO del CAF (con `<RSASK>`, la
--    llave con que se timbra) en Vault con `guardar_secreto` y crea la fila de `cafs`
--    con su id, en la misma transacción; si se pasa `p_solicitud`, enlaza
--    `cafs.solicitud_id` y deja la fila de `solicitudes_folios` como `timbrada` con el
--    rango y el `caf_id` (la bitácora y el CAF no pueden quedar desalineados: si la
--    fila del CAF no entra, la solicitud tampoco cambia, y viceversa).
--    Idempotente: si ya existe el CAF (misma empresa, ambiente, tipo y `folio_desde`,
--    la llave única de `cafs`) con el mismo `folio_hasta`, devuelve su id SIN crear
--    otro secreto (un reintento de la app después de un corte no deja secretos
--    huérfanos). Si existe con otro `folio_hasta`, es otro CAF: 23505.
--    Antes de mirar si existe se toma `for no key update` sobre la fila de la empresa:
--    dos llamadas simultáneas para la misma empresa se ordenan (la segunda ve lo que
--    dejó la primera y devuelve el mismo id) en vez de crear dos secretos y chocar en
--    la llave única. `no key update` no bloquea las FK que apuntan a la empresa.
--    Si igual hay un `unique_violation` al insertar, la excepción aborta la
--    transacción completa y el `vault.create_secret` también se deshace.
--    Es `security definer` porque `guardar_secreto` y la tabla `cafs` (sin políticas
--    de escritura) son del backend; por eso mismo NO la ejecuta `authenticated`. La capa
--    `server/certificacion` la llama con el CAF que entregó `SolicitudFolios` (que ya
--    revisó IDK, RUT y tipo) después de verificar la membresía y el rol.
--    Ningún mensaje de error incluye el XML: nombran el dato, nunca su valor. La
--    descripción del secreto lleva solo datos públicos del CAF (RUT, ambiente, tipo y
--    rango).
--    Códigos de error:
--      P0002  La empresa no existe en esa organización.
--      22023  Datos inválidos: XML vacío, rango, IDK que no es el del ambiente, RUT del
--             emisor que no es el de la empresa, solicitud de otra empresa o ambiente
--             o ya enlazada a otro CAF.
--      23505  Ya hay un CAF que empieza en ese folio con otro rango.
--
-- 2. `guardar_set_pruebas(organizacion, proceso, texto, correo_proveedor, casos)` →
--    integer (casos guardados): reemplaza los `set_pruebas_casos` del proceso por los
--    de `p_casos` (lo que devuelve `parsearSetPruebas`) y deja el proceso en
--    `set_descargado` con `set_pruebas_texto`, `correo_proveedor_set` y
--    `set_descargado_en`, borrando `envio_set_id` y `revision_solicitada_en` (un set
--    nuevo deja sin valor los envíos hechos con el anterior). Todo junto: sin esto, una
--    falla entre el borrado de los casos y la actualización del proceso dejaría el
--    asistente con un texto de set que no calza con sus casos (o sin casos).
--    Rechaza el reemplazo si el proceso ya está en `por_declarar` o `autorizada` (un
--    set nuevo reiniciaría la certificación; la librería ya frena la descarga en P90).
--    `organizacion_id` de los casos lo llena `trg_00_organizacion` desde el proceso.
--    `p_casos`: arreglo de objetos `{ numero_caso, tipo_dte, detalles (arreglo),
--    referencia_codigo, referencia_razon }`.
--    Códigos de error:
--      P0002  El proceso no existe en esa organización.
--      22023  Casos inválidos (no es un arreglo, vacío, caso sin número o sin detalles,
--             números repetidos) o el proceso ya está en `por_declarar` / `autorizada`.
--
-- Las dos fijan `search_path = ''` y califican todo con `public.` / `vault.`.
-- service_role ya salta RLS; las dos filtran explícitamente por `p_organizacion`
-- (principio 2).
--
-- Aditiva: solo funciones nuevas. Sin tablas, columnas, políticas ni grants de tablas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Registrar un CAF (XML a Vault, fila en cafs, solicitud enlazada)
-- -----------------------------------------------------------------------------

create function public.registrar_caf(
  p_organizacion       uuid,
  p_empresa            uuid,
  p_ambiente           public.ambiente_sii,
  p_tipo_dte           smallint,
  p_folio_desde        integer,
  p_folio_hasta        integer,
  p_fecha_autorizacion date,
  p_idk                smallint,
  p_rut_emisor         text,
  p_razon_social       text,
  p_caf_xml            text,
  p_solicitud          uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa   public.empresas;
  v_existente public.cafs;
  v_solicitud public.solicitudes_folios;
  v_rut       text := upper(replace(btrim(coalesce(p_rut_emisor, '')), '.', ''));
  v_secreto   uuid;
  v_id        uuid;
begin
  select * into v_empresa
  from public.empresas e
  where e.id = p_empresa and e.organizacion_id = p_organizacion;
  if not found then
    raise exception 'La empresa no existe en la organización' using errcode = 'P0002';
  end if;

  -- Validaciones antes de tocar Vault. Los mensajes nombran el dato, nunca su valor.
  if p_caf_xml is null or length(btrim(p_caf_xml)) = 0 then
    raise exception 'Falta el XML del CAF' using errcode = '22023';
  end if;
  if p_ambiente is null or p_tipo_dte is null or p_fecha_autorizacion is null or p_idk is null then
    raise exception 'Faltan el ambiente, el tipo, la fecha de autorización o el IDK del CAF'
      using errcode = '22023';
  end if;
  if p_folio_desde is null or p_folio_hasta is null
     or p_folio_desde < 1 or p_folio_hasta < p_folio_desde then
    raise exception 'El rango de folios del CAF no es válido' using errcode = '22023';
  end if;
  -- Mismo candado que el check de la tabla (y que SolicitudFolios), con un mensaje claro.
  if not ((p_ambiente = 'certificacion' and p_idk = 100)
          or (p_ambiente = 'produccion' and p_idk = 300)) then
    raise exception 'El IDK del CAF no corresponde al ambiente' using errcode = '22023';
  end if;
  if v_rut <> v_empresa.rut then
    raise exception 'El CAF es de otra empresa (RUT del emisor distinto)' using errcode = '22023';
  end if;

  if p_solicitud is not null then
    select * into v_solicitud
    from public.solicitudes_folios s
    where s.id = p_solicitud and s.organizacion_id = p_organizacion;
    if not found
       or v_solicitud.empresa_id <> p_empresa
       or v_solicitud.ambiente <> p_ambiente
       or v_solicitud.tipo_dte <> p_tipo_dte then
      raise exception 'La solicitud de folios no es de esta empresa, ambiente y tipo'
        using errcode = '22023';
    end if;
  end if;

  -- Serializa con otras llamadas para la misma empresa (ver encabezado).
  perform 1 from public.empresas where id = p_empresa for no key update;

  select * into v_existente
  from public.cafs c
  where c.empresa_id = p_empresa
    and c.ambiente = p_ambiente
    and c.tipo_dte = p_tipo_dte
    and c.folio_desde = p_folio_desde;

  if found then
    if v_existente.folio_hasta <> p_folio_hasta then
      raise exception 'Ya hay un CAF que empieza en el folio % con otro rango', p_folio_desde
        using errcode = '23505';
    end if;
    -- Idempotente: mismo CAF, sin secreto nuevo.
    v_id := v_existente.id;
    if p_solicitud is not null and v_existente.solicitud_id is null then
      update public.cafs set solicitud_id = p_solicitud where id = v_id;
    end if;
  else
    v_secreto := public.guardar_secreto(
      p_caf_xml,
      'caf:' || v_empresa.rut || ':' || p_ambiente::text || ':' || p_tipo_dte::text || ':'
        || p_folio_desde::text || '-' || p_folio_hasta::text
    );
    begin
      insert into public.cafs
        (organizacion_id, empresa_id, ambiente, tipo_dte, folio_desde, folio_hasta,
         siguiente_folio, fecha_autorizacion, idk, rut_emisor, razon_social, caf_secret_id,
         solicitud_id)
      values
        (p_organizacion, p_empresa, p_ambiente, p_tipo_dte, p_folio_desde, p_folio_hasta,
         p_folio_desde, p_fecha_autorizacion, p_idk, v_rut, nullif(btrim(p_razon_social), ''), v_secreto,
         p_solicitud)
      returning id into v_id;
    exception when unique_violation then
      -- Aborta la transacción completa: el secreto de arriba también se deshace.
      raise exception 'Ya hay un CAF que empieza en el folio % con otro rango', p_folio_desde
        using errcode = '23505';
    end;
  end if;

  if p_solicitud is not null then
    if v_solicitud.caf_id is not null and v_solicitud.caf_id <> v_id then
      raise exception 'La solicitud de folios ya está enlazada a otro CAF' using errcode = '22023';
    end if;
    update public.solicitudes_folios
    set estado = 'timbrada',
        confirmada = true,
        folio_desde = p_folio_desde,
        folio_hasta = p_folio_hasta,
        caf_id = v_id,
        terminado_en = coalesce(terminado_en, now())
    where id = p_solicitud;
  end if;

  return v_id;
end;
$$;

comment on function public.registrar_caf(
  uuid, uuid, public.ambiente_sii, smallint, integer, integer, date, smallint, text, text, text, uuid
) is
  'Guarda el XML del CAF en Vault y crea la fila de cafs (y deja timbrada la solicitud), en una transacción. Idempotente por (empresa, ambiente, tipo, folio_desde) con el mismo folio_hasta. Solo service_role.';

revoke execute on function public.registrar_caf(
  uuid, uuid, public.ambiente_sii, smallint, integer, integer, date, smallint, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.registrar_caf(
  uuid, uuid, public.ambiente_sii, smallint, integer, integer, date, smallint, text, text, text, uuid
) to service_role;

-- -----------------------------------------------------------------------------
-- 2. Guardar el set de pruebas descargado (casos y proceso, juntos)
-- -----------------------------------------------------------------------------

create function public.guardar_set_pruebas(
  p_organizacion      uuid,
  p_proceso           uuid,
  p_texto             text,
  p_correo_proveedor  text,
  p_casos             jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proceso public.procesos_certificacion;
  v_caso    jsonb;
  v_total   integer;
begin
  select * into v_proceso
  from public.procesos_certificacion p
  where p.id = p_proceso and p.organizacion_id = p_organizacion
  for update;
  if not found then
    raise exception 'El proceso de certificación no existe en la organización'
      using errcode = 'P0002';
  end if;

  if v_proceso.etapa >= 'por_declarar' then
    raise exception 'La empresa ya está lista para declarar o autorizada: no se reemplaza el set'
      using errcode = '22023';
  end if;

  if p_casos is null or jsonb_typeof(p_casos) <> 'array' or jsonb_array_length(p_casos) = 0 then
    raise exception 'El set no trae casos' using errcode = '22023';
  end if;
  -- Caso a caso (SQL no garantiza el orden de evaluación de un `or`: un cast antes de
  -- revisar el tipo podría lanzar otro error).
  for v_caso in select value from jsonb_array_elements(p_casos) loop
    if jsonb_typeof(v_caso) <> 'object'
       or coalesce(v_caso ->> 'numero_caso', '') !~ '^[1-9][0-9]{0,8}$'
       or coalesce(jsonb_typeof(v_caso -> 'detalles'), '') <> 'array'
       or coalesce(btrim(v_caso ->> 'referencia_razon'), '') = ''
       or coalesce(v_caso ->> 'tipo_dte', '39') !~ '^[0-9]{1,4}$' then
      raise exception 'Un caso del set no trae número, detalles o referencia' using errcode = '22023';
    end if;
    if jsonb_array_length(v_caso -> 'detalles') = 0 then
      raise exception 'Un caso del set no trae detalles' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct (c ->> 'numero_caso')::integer) from jsonb_array_elements(p_casos) c)
     <> jsonb_array_length(p_casos) then
    raise exception 'El set trae números de caso repetidos' using errcode = '22023';
  end if;

  delete from public.set_pruebas_casos where proceso_id = p_proceso;

  -- organizacion_id lo hereda trg_00_organizacion desde el proceso.
  insert into public.set_pruebas_casos
    (organizacion_id, proceso_id, numero_caso, tipo_dte, detalles, referencia_codigo,
     referencia_razon)
  select p_organizacion, p_proceso, (c ->> 'numero_caso')::integer,
         coalesce((c ->> 'tipo_dte')::smallint, 39::smallint), c -> 'detalles',
         coalesce(nullif(btrim(c ->> 'referencia_codigo'), ''), 'SET'),
         btrim(c ->> 'referencia_razon')
  from jsonb_array_elements(p_casos) c;
  get diagnostics v_total = row_count;

  update public.procesos_certificacion
  set etapa = 'set_descargado',
      set_pruebas_texto = p_texto,
      correo_proveedor_set = coalesce(p_correo_proveedor, correo_proveedor_set),
      set_descargado_en = now(),
      envio_set_id = null,
      revision_solicitada_en = null
  where id = p_proceso;

  return v_total;
end;
$$;

comment on function public.guardar_set_pruebas(uuid, uuid, text, text, jsonb) is
  'Reemplaza los casos del set de pruebas y deja el proceso en set_descargado (texto, correo del proveedor, fecha), en una transacción. Solo service_role.';

revoke execute on function public.guardar_set_pruebas(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.guardar_set_pruebas(uuid, uuid, text, text, jsonb)
  to service_role;

commit;
