-- =============================================================================
-- 0020 · Endurecimiento antes del lanzamiento (PLAN-SAAS Fase 13)
--
-- Aditiva: no borra ni cambia columnas, políticas ni funciones existentes. Cuatro partes:
--
-- 1. Slugs reservados en la base. `organizaciones.slug` no puede ser una de las rutas de
--    primer nivel de la app (`/[org]` cuelga de la raíz): check
--    `organizaciones_slug_no_reservado` con la MISMA lista que `SLUGS_RESERVADOS` de
--    `apps/web/src/lib/rutas.ts`. Al ser un check (y no una validación dentro de
--    `crear_organizacion`) cubre todas las vías que fijan el slug: `crear_organizacion()`,
--    el `update` de un administrador con su sesión (la política `edicion` de
--    `organizaciones` deja cambiar cualquier columna) y service_role. Falla con 23514
--    (`check_violation`), que `traducirErrorOrganizacion` ya traduce. Antes de escribirla
--    se revisó que ninguna organización existente use uno (2026-11-19: la única es
--    `servicio`). La lista va entre los marcadores `slugs-reservados:inicio/fin`: la prueba
--    `apps/web/src/lib/slugs-reservados-db.test.ts` la lee de la última migración que los
--    tenga y la compara con `SLUGS_RESERVADOS`. Para agregar un slug: agregarlo en
--    `rutas.ts` y en una migración nueva que reemplace el check (drop + add) con los
--    mismos marcadores.
-- 2. Índices para las 54 claves foráneas sin índice que reporta Advisors
--    (`unindexed_foreign_keys`; en la documentación figuraban como `0018_indices_fk` /
--    `0020_indices_fk`). 53 índices: el de `empresa_certificados (organizacion_id,
--    certificado_id)` cubre también la FK simple de `organizacion_id`. Las columnas que
--    admiten null (quién lo hizo, referencias opcionales) llevan índice parcial `where …
--    is not null`: la búsqueda de la FK (borrar el padre) siempre es por un valor no nulo.
--    Sirven a las políticas RLS (filtran por `organizacion_id`), a los borrados en cascada
--    o `set null` (un usuario de auth, una organización) y a los embeds de PostgREST.
-- 3. Índices de `operaciones_sii` por fecha para `/estado` (`server/estado/`), que lee sin
--    organización con service_role: conteo por `ambiente`, `resultado` y `terminada_en`
--    desde hace 60 min, y la última corrida `seguimiento`/`ok` por `terminada_en desc`.
--    Sin ellos ambas recorren la tabla (trampas-conocidas, «Sitio público»).
-- 4. `tg_api_key_sin_reactivar()` (0018) quedó ejecutable por PUBLIC (anon y
--    authenticated). Una función de trigger no se puede llamar directo, así que no era un
--    riesgo, pero las demás `tg_*` revocan EXECUTE: se alinea. El trigger sigue
--    disparando (el privilegio solo se exige al crear el trigger).
--
-- Índices sin `concurrently`: `supabase db push` corre cada migración en una transacción
-- (y esta trae su `begin`/`commit`, como las anteriores), donde `create index
-- concurrently` no se puede usar. Las tablas tienen hoy de 0 a decenas de filas: cada
-- índice toma un bloqueo SHARE de milisegundos. `lock_timeout` evita quedar en cola
-- detrás de una transacción larga (si salta, se reintenta el push; no queda nada a medias).
-- Si algún día una tabla tiene volumen, sus índices nuevos van en una migración aparte,
-- sin transacción y con `concurrently`.
--
-- Verificación de solo lectura: supabase/verificaciones/0020_endurecimiento.sql.
-- =============================================================================

begin;

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Slugs reservados (misma lista que SLUGS_RESERVADOS en apps/web/src/lib/rutas.ts)
-- -----------------------------------------------------------------------------

alter table public.organizaciones
  add constraint organizaciones_slug_no_reservado check (slug <> all (array[
    -- slugs-reservados:inicio
    'admin',
    'api',
    'app',
    'apple-icon',
    'auth',
    'ayuda',
    'bienvenida',
    'configuracion',
    'contacto',
    'crear-cuenta',
    'cuenta',
    'docs',
    'estado',
    'icon',
    'ingresar',
    'invitacion',
    'legal',
    'monitoring',
    'opengraph-image',
    'precios',
    'privacidad',
    'recuperar',
    'restablecer',
    'soporte',
    'terminos',
    'twitter-image'
    -- slugs-reservados:fin
  ]::text[]));

comment on constraint organizaciones_slug_no_reservado on public.organizaciones is
  'El slug no puede ser una ruta de primer nivel de la app. Misma lista que SLUGS_RESERVADOS (apps/web/src/lib/rutas.ts); la prueba slugs-reservados-db.test.ts las compara. Migración 0020.';

-- -----------------------------------------------------------------------------
-- 2. Índices de claves foráneas (Advisors: unindexed_foreign_keys)
-- -----------------------------------------------------------------------------

create index if not exists api_keys_creado_por_idx on public.api_keys (creado_por) where creado_por is not null;
create index if not exists api_keys_empresa_id_idx on public.api_keys (empresa_id) where empresa_id is not null;
create index if not exists cafs_organizacion_id_idx on public.cafs (organizacion_id);
create index if not exists cafs_solicitud_id_idx on public.cafs (solicitud_id) where solicitud_id is not null;
create index if not exists cafs_tipo_dte_idx on public.cafs (tipo_dte);
create index if not exists certificados_subido_por_idx on public.certificados (subido_por) where subido_por is not null;
create index if not exists clientes_pago_plan_pendiente_id_idx on public.clientes_pago (plan_pendiente_id) where plan_pendiente_id is not null;
create index if not exists clientes_pago_plan_pendiente_por_idx on public.clientes_pago (plan_pendiente_por) where plan_pendiente_por is not null;
create index if not exists consultas_envio_organizacion_id_idx on public.consultas_envio (organizacion_id);
create index if not exists documento_detalles_organizacion_id_idx on public.documento_detalles (organizacion_id);
create index if not exists documento_detalles_producto_id_idx on public.documento_detalles (producto_id) where producto_id is not null;
create index if not exists documentos_creado_por_idx on public.documentos (creado_por) where creado_por is not null;
create index if not exists documentos_empresa_id_caf_id_idx on public.documentos (empresa_id, caf_id) where caf_id is not null;
create index if not exists documentos_empresa_id_envio_id_idx on public.documentos (empresa_id, envio_id) where envio_id is not null;
create index if not exists documentos_receptor_id_idx on public.documentos (receptor_id) where receptor_id is not null;
create index if not exists documentos_tipo_dte_idx on public.documentos (tipo_dte);
create index if not exists empresa_certificados_certificado_id_idx on public.empresa_certificados (certificado_id);
-- Cubre empresa_certificados_organizacion_id_fkey y …_organizacion_id_certificado_id_fkey.
create index if not exists empresa_certificados_organizacion_id_certificado_id_idx on public.empresa_certificados (organizacion_id, certificado_id);
create index if not exists envio_estadisticas_organizacion_id_idx on public.envio_estadisticas (organizacion_id);
create index if not exists envio_rechazos_documento_id_idx on public.envio_rechazos (documento_id) where documento_id is not null;
create index if not exists envio_rechazos_organizacion_id_idx on public.envio_rechazos (organizacion_id);
create index if not exists envios_certificado_id_idx on public.envios (certificado_id) where certificado_id is not null;
create index if not exists envios_organizacion_id_idx on public.envios (organizacion_id);
create index if not exists eventos_pasarela_organizacion_id_idx on public.eventos_pasarela (organizacion_id) where organizacion_id is not null;
create index if not exists folios_anulados_anulado_por_idx on public.folios_anulados (anulado_por) where anulado_por is not null;
create index if not exists folios_anulados_organizacion_id_idx on public.folios_anulados (organizacion_id);
create index if not exists invitaciones_invitado_por_idx on public.invitaciones (invitado_por) where invitado_por is not null;
create index if not exists operaciones_sii_documento_id_idx on public.operaciones_sii (documento_id) where documento_id is not null;
create index if not exists operaciones_sii_envio_id_idx on public.operaciones_sii (envio_id) where envio_id is not null;
create index if not exists operaciones_sii_solicitud_id_idx on public.operaciones_sii (solicitud_id) where solicitud_id is not null;
create index if not exists operaciones_sii_usuario_id_idx on public.operaciones_sii (usuario_id) where usuario_id is not null;
create index if not exists organizaciones_creado_por_idx on public.organizaciones (creado_por) where creado_por is not null;
create index if not exists pagos_suscripcion_id_idx on public.pagos (suscripcion_id) where suscripcion_id is not null;
create index if not exists perfiles_ultima_empresa_idx on public.perfiles (ultima_empresa) where ultima_empresa is not null;
create index if not exists perfiles_ultima_organizacion_idx on public.perfiles (ultima_organizacion) where ultima_organizacion is not null;
create index if not exists procesos_certificacion_empresa_id_envio_set_id_idx on public.procesos_certificacion (empresa_id, envio_set_id) where envio_set_id is not null;
create index if not exists procesos_certificacion_organizacion_id_idx on public.procesos_certificacion (organizacion_id);
create index if not exists productos_organizacion_id_idx on public.productos (organizacion_id);
create index if not exists rcof_empresa_id_envio_id_idx on public.rcof (empresa_id, envio_id) where envio_id is not null;
create index if not exists rcof_organizacion_id_idx on public.rcof (organizacion_id);
create index if not exists receptores_organizacion_id_idx on public.receptores (organizacion_id);
create index if not exists resoluciones_organizacion_id_idx on public.resoluciones (organizacion_id);
create index if not exists set_pruebas_casos_documento_id_idx on public.set_pruebas_casos (documento_id) where documento_id is not null;
create index if not exists set_pruebas_casos_organizacion_id_idx on public.set_pruebas_casos (organizacion_id);
create index if not exists set_pruebas_casos_tipo_dte_idx on public.set_pruebas_casos (tipo_dte);
create index if not exists solicitudes_folios_caf_id_idx on public.solicitudes_folios (caf_id) where caf_id is not null;
create index if not exists solicitudes_folios_certificado_id_idx on public.solicitudes_folios (certificado_id) where certificado_id is not null;
create index if not exists solicitudes_folios_empresa_id_idx on public.solicitudes_folios (empresa_id);
create index if not exists solicitudes_folios_organizacion_id_idx on public.solicitudes_folios (organizacion_id);
create index if not exists solicitudes_folios_solicitado_por_idx on public.solicitudes_folios (solicitado_por) where solicitado_por is not null;
create index if not exists solicitudes_folios_tipo_dte_idx on public.solicitudes_folios (tipo_dte);
create index if not exists suscripciones_plan_id_idx on public.suscripciones (plan_id);
create index if not exists webhook_entregas_reenviada_por_idx on public.webhook_entregas (reenviada_por) where reenviada_por is not null;

-- -----------------------------------------------------------------------------
-- 3. operaciones_sii por fecha (/estado, server/estado/index.ts)
-- -----------------------------------------------------------------------------

-- medirSii: count(*) where ambiente = $1 and resultado in (…) and terminada_en >= $2.
-- `include (resultado)` permite contarlo solo con el índice.
create index if not exists operaciones_sii_ambiente_terminada_en_idx
  on public.operaciones_sii (ambiente, terminada_en) include (resultado)
  where terminada_en is not null;

-- medirSeguimiento: where operacion = 'seguimiento' and resultado = 'ok' and terminada_en
-- is not null order by terminada_en desc limit 1.
create index if not exists operaciones_sii_operacion_resultado_terminada_en_idx
  on public.operaciones_sii (operacion, resultado, terminada_en desc)
  where terminada_en is not null;

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------

revoke execute on function public.tg_api_key_sin_reactivar() from public, anon, authenticated;

commit;
