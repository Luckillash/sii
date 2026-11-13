-- =============================================================================
-- 0005 · Certificados y resoluciones (PLAN-SAAS Fase 3)
--
-- (El plan reservaba `0005` para `realtime_operaciones`; el número definitivo es por
-- orden de creación, PLAN-SAAS §6. Las de la Fase 4 se corren un número.)
--
-- Tres RPC que la configuración de la empresa necesita y que con escrituras sueltas
-- desde la app quedarían a medias si algo falla entre una sentencia y otra:
--
-- 1. `registrar_certificado(...)` (solo service_role): guarda el .pfx (base64) y su
--    clave en Vault y crea la fila de `certificados` con los dos ids, todo en la misma
--    transacción. Si la fila no entra (huella repetida, RUT inválido, lo que sea), la
--    excepción deshace también los `vault.create_secret`: no quedan secretos huérfanos.
--    Es `security definer` porque `guardar_secreto` y la tabla `certificados` (sin
--    políticas de escritura) son del backend; por eso mismo NO la ejecuta
--    `authenticated`: la Server Action valida el .pfx con la librería y comprueba que
--    quien sube sea administrador de la organización antes de llamarla (principio 2:
--    service_role siempre filtra por `organizacion_id`).
--    Ningún mensaje de error incluye la clave ni el base64; las descripciones de los
--    secretos llevan solo la huella, que es pública (identifica el certificado, no lo
--    abre).
--    Códigos de error:
--      23503  La organización no existe (o, desde la FK, `p_subido_por` no es un usuario).
--      22023  Datos inválidos (huella que no es sha256 hex, RUT del titular inválido,
--             .pfx vacío, clave nula).
--      23505  El certificado (misma huella) ya está registrado en la organización.
--
-- 2. `fijar_certificado_predeterminado(empresa, certificado)` (`security invoker`):
--    el índice único parcial `empresa_certificados_predeterminado_unico` se revisa
--    fila a fila, no al final de la sentencia, así que primero se apaga el
--    predeterminado actual y después se enciende el nuevo (al revés, o con un solo
--    UPDATE, chocaría consigo mismo según el orden en que Postgres recorra las filas).
--    Corre con el RLS de quien llama: solo administradores escriben en
--    `empresa_certificados`.
--    Códigos de error:
--      P0002  El certificado no está asociado a la empresa (o RLS no deja verla: para
--             otra organización es lo mismo que no existir).
--      42501  Sin permiso: la asociación se ve (miembro) pero quien llama no es
--             administrador.
--
-- 3. `registrar_resolucion(empresa, ambiente, numero, fecha)` (`security invoker`):
--    deja `vigente = false` la resolución vigente de esa empresa y ambiente e inserta
--    la nueva como vigente (índice único parcial `resoluciones_vigente_unica`, mismo
--    orden que en 2). `organizacion_id` no se pasa: lo llena `trg_00_organizacion`
--    (`tg_heredar_organizacion`) desde la empresa, antes del WITH CHECK de RLS.
--    Códigos de error:
--      P0002  La empresa no existe (o RLS no deja verla).
--      42501  Sin permiso (quien llama no es administrador de la organización).
--      22004  Falta el ambiente, el número o la fecha.
--      23514  Número negativo, o distinto de 0 en certificación (el mismo check de la
--             tabla, adelantado para dar un mensaje claro).
--
-- En 2 y 3 se toma `for no key update` sobre la fila de la empresa antes de escribir:
-- dos llamadas simultáneas para la misma empresa se ordenan en vez de chocar con el
-- índice único (la segunda espera y, como en READ COMMITTED cada sentencia toma una
-- foto nueva, ve lo que dejó la primera). `no key update` no bloquea las FK que apuntan
-- a la empresa. El candado exige pasar la política UPDATE de `empresas` (solo
-- administradores), así que va después de la revisión de permisos.
-- Con service_role (backend, sin auth.uid()) las dos funciones invoker también sirven:
-- la revisión de administrador se salta, igual que en `tg_limite_empresas`, porque
-- service_role ya salta RLS.
--
-- Privilegios: `authenticated` ya tiene SELECT/INSERT/UPDATE sobre `empresas`,
-- `resoluciones` y `empresa_certificados` (grants por defecto de Supabase; RLS decide
-- las filas) y EXECUTE sobre `es_admin`. Los triggers no piden EXECUTE a quien
-- dispara. No hace falta ningún grant nuevo de tablas. `certificados` sigue sin
-- políticas de escritura: `authenticated` no inserta, edita ni borra certificados
-- (RLS lo rechaza), y el borrado lo hace el backend; `trg_borrar_secretos` (0001)
-- borra de Vault el .pfx y la clave al borrar la fila, también en cascada.
--
-- Aditiva: solo funciones nuevas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Registrar un certificado (.pfx + clave a Vault, fila con los ids)
-- -----------------------------------------------------------------------------

create function public.registrar_certificado(
  p_organizacion   uuid,
  p_rut_titular    text,
  p_nombre_titular text,
  p_cn             text,
  p_emisor_ca      text,
  p_vigente_desde  timestamptz,
  p_vigente_hasta  timestamptz,
  p_huella_sha256  text,
  p_pfx_base64     text,
  p_clave          text,
  p_pfx_legacy     boolean,
  p_subido_por     uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_huella   text := lower(btrim(p_huella_sha256));
  v_pfx_id   uuid;
  v_clave_id uuid;
  v_id       uuid;
begin
  if p_organizacion is null
     or not exists (select 1 from public.organizaciones where id = p_organizacion) then
    raise exception 'La organización no existe' using errcode = '23503';
  end if;

  -- Validaciones antes de tocar Vault. Los mensajes nombran el dato, nunca su valor:
  -- así un error que llegue a los logs o a Sentry no arrastra nada del .pfx.
  if v_huella is null or v_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del certificado debe ser un sha256 en hexadecimal (64 caracteres)'
      using errcode = '22023';
  end if;
  if not coalesce(public.rut_valido(p_rut_titular), false) then
    raise exception 'El RUT del titular no es válido' using errcode = '22023';
  end if;
  if p_pfx_base64 is null or length(p_pfx_base64) = 0 then
    raise exception 'Falta el archivo del certificado' using errcode = '22023';
  end if;
  -- La clave puede ser vacía (hay .pfx sin contraseña), pero no nula.
  if p_clave is null then
    raise exception 'Falta la clave del certificado' using errcode = '22023';
  end if;

  -- Revisión temprana para no crear secretos que se van a deshacer. La carrera entre
  -- dos subidas simultáneas la cierra el unique de la tabla, más abajo.
  if exists (
    select 1 from public.certificados
    where organizacion_id = p_organizacion and huella_sha256 = v_huella
  ) then
    raise exception 'El certificado ya está registrado en la organización' using errcode = '23505';
  end if;

  v_pfx_id   := public.guardar_secreto(p_pfx_base64, 'certificado:' || v_huella || ':pfx');
  v_clave_id := public.guardar_secreto(p_clave, 'certificado:' || v_huella || ':clave');

  begin
    insert into public.certificados
      (organizacion_id, rut_titular, nombre_titular, cn, emisor_ca, vigente_desde, vigente_hasta,
       huella_sha256, pfx_secret_id, clave_secret_id, pfx_legacy, subido_por)
    values
      (p_organizacion, p_rut_titular, p_nombre_titular, p_cn, p_emisor_ca, p_vigente_desde,
       p_vigente_hasta, v_huella, v_pfx_id, v_clave_id, coalesce(p_pfx_legacy, false), p_subido_por)
    returning id into v_id;
  exception when unique_violation then
    -- Se relanza con el mismo código y un mensaje claro. La excepción aborta la
    -- transacción completa, así que los dos secretos de arriba también se deshacen.
    raise exception 'El certificado ya está registrado en la organización' using errcode = '23505';
  end;

  return v_id;
end;
$$;

comment on function public.registrar_certificado(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, boolean, uuid
) is
  'Guarda el .pfx (base64) y su clave en Vault y crea la fila de certificados con sus ids, en una transacción. Solo service_role. 23505 si la huella ya está en la organización.';

revoke execute on function public.registrar_certificado(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.registrar_certificado(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, boolean, uuid
) to service_role;

-- -----------------------------------------------------------------------------
-- 2. Certificado predeterminado de una empresa
-- -----------------------------------------------------------------------------

create function public.fijar_certificado_predeterminado(p_empresa uuid, p_certificado uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid;
begin
  -- Con el RLS de quien llama: de otra organización no se ve, y es lo mismo que no existir.
  select ec.organizacion_id into v_organizacion
  from public.empresa_certificados ec
  where ec.empresa_id = p_empresa and ec.certificado_id = p_certificado;
  if not found then
    raise exception 'El certificado no está asociado a la empresa' using errcode = 'P0002';
  end if;

  if (select auth.role()) is distinct from 'service_role'
     and not public.es_admin(v_organizacion) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  -- Serializa con otras llamadas para la misma empresa (ver encabezado).
  perform 1 from public.empresas where id = p_empresa for no key update;

  -- Primero se apaga el actual y después se enciende el nuevo: el índice único parcial
  -- se revisa fila a fila.
  update public.empresa_certificados
  set predeterminado = false
  where empresa_id = p_empresa and predeterminado and certificado_id <> p_certificado;

  update public.empresa_certificados
  set predeterminado = true
  where empresa_id = p_empresa and certificado_id = p_certificado;
  if not found then
    -- No debería pasar tras las revisiones de arriba; si RLS filtra la fila, no se
    -- devuelve éxito sin haber cambiado nada.
    raise exception 'El certificado no está asociado a la empresa' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.fijar_certificado_predeterminado(uuid, uuid) is
  'Deja el certificado como el único predeterminado de la empresa. Con el RLS de quien llama (administradores). P0002 si no hay asociación visible; 42501 sin permiso.';

revoke execute on function public.fijar_certificado_predeterminado(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fijar_certificado_predeterminado(uuid, uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Resolución vigente de una empresa y ambiente
-- -----------------------------------------------------------------------------

create function public.registrar_resolucion(
  p_empresa  uuid,
  p_ambiente public.ambiente_sii,
  p_numero   integer,
  p_fecha    date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid;
  v_id           uuid;
begin
  select e.organizacion_id into v_organizacion
  from public.empresas e
  where e.id = p_empresa;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  if (select auth.role()) is distinct from 'service_role'
     and not public.es_admin(v_organizacion) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  if p_ambiente is null or p_numero is null or p_fecha is null then
    raise exception 'Faltan el ambiente, el número o la fecha de la resolución'
      using errcode = '22004';
  end if;
  if p_numero < 0 then
    raise exception 'El número de resolución no puede ser negativo' using errcode = '23514';
  end if;
  if p_ambiente = 'certificacion' and p_numero <> 0 then
    raise exception 'En certificación el número de resolución es 0' using errcode = '23514';
  end if;

  -- Serializa con otras llamadas para la misma empresa (ver encabezado).
  perform 1 from public.empresas where id = p_empresa for no key update;

  -- Se conserva la anterior como historial; el índice único parcial exige apagarla antes.
  update public.resoluciones
  set vigente = false
  where empresa_id = p_empresa and ambiente = p_ambiente and vigente;

  -- organizacion_id lo hereda trg_00_organizacion desde la empresa.
  insert into public.resoluciones (empresa_id, ambiente, numero, fecha, vigente)
  values (p_empresa, p_ambiente, p_numero, p_fecha, true)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_resolucion(uuid, public.ambiente_sii, integer, date) is
  'Reemplaza la resolución vigente de la empresa en el ambiente (la anterior queda con vigente = false). Con el RLS de quien llama (administradores).';

revoke execute on function public.registrar_resolucion(uuid, public.ambiente_sii, integer, date)
  from public, anon, authenticated;
grant execute on function public.registrar_resolucion(uuid, public.ambiente_sii, integer, date)
  to authenticated, service_role;

commit;
