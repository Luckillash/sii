-- Verificación de la migración 0020_endurecimiento en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe nada. Se ejecuta tal cual en el SQL Editor, con el MCP
-- `execute_sql` o con `supabase db query --read-only`. Cada fila es una comprobación:
-- todas deben salir con ok = true.
--
-- 9 comprobaciones: 1 el check de slugs reservados existe, está validado y tiene
-- exactamente la lista de `SLUGS_RESERVADOS` (apps/web/src/lib/rutas.ts; la prueba
-- slugs-reservados-db.test.ts compara la migración con ese archivo); 2 ninguna
-- organización usa un slug reservado; 3 los 53 índices de FK existen y son válidos; 4
-- ninguna FK del esquema public queda sin índice que la cubra (misma regla que el aviso
-- `unindexed_foreign_keys` de Advisors: columnas de la FK como prefijo del índice); 5 y 6
-- los índices por fecha de `operaciones_sii` con sus columnas y predicado; 7
-- `tg_api_key_sin_reactivar` sin EXECUTE para PUBLIC, anon y authenticated, y su trigger
-- sigue activo; 8 `crear_organizacion` sigue igual (security definer, search_path vacío,
-- inserta `lower(p_slug)`); 9 migración registrada.
--
-- Antes de migrar salen true la 2 y la 8 (y la 4 sale false con 54 FK sin índice).

with esperados(slug) as (
  values ('admin'), ('api'), ('app'), ('apple-icon'), ('auth'), ('ayuda'), ('bienvenida'),
         ('configuracion'), ('contacto'), ('crear-cuenta'), ('cuenta'), ('docs'), ('estado'),
         ('icon'), ('ingresar'), ('invitacion'), ('legal'), ('monitoring'), ('opengraph-image'),
         ('precios'), ('privacidad'), ('recuperar'), ('restablecer'), ('soporte'), ('terminos'),
         ('twitter-image')
),
chequeo as (
  select c.convalidated,
         pg_get_constraintdef(c.oid) as def,
         -- Los literales del array, en el orden en que aparecen.
         array(select m[1] from regexp_matches(pg_get_constraintdef(c.oid), '''([a-z0-9-]+)''', 'g') as m) as slugs
  from pg_constraint c
  where c.conrelid = 'public.organizaciones'::regclass and c.conname = 'organizaciones_slug_no_reservado'
),
indices_fk(nombre) as (
  values ('api_keys_creado_por_idx'), ('api_keys_empresa_id_idx'), ('cafs_organizacion_id_idx'),
         ('cafs_solicitud_id_idx'), ('cafs_tipo_dte_idx'), ('certificados_subido_por_idx'),
         ('clientes_pago_plan_pendiente_id_idx'), ('clientes_pago_plan_pendiente_por_idx'),
         ('consultas_envio_organizacion_id_idx'), ('documento_detalles_organizacion_id_idx'),
         ('documento_detalles_producto_id_idx'), ('documentos_creado_por_idx'),
         ('documentos_empresa_id_caf_id_idx'), ('documentos_empresa_id_envio_id_idx'),
         ('documentos_receptor_id_idx'), ('documentos_tipo_dte_idx'),
         ('empresa_certificados_certificado_id_idx'), ('empresa_certificados_organizacion_id_certificado_id_idx'),
         ('envio_estadisticas_organizacion_id_idx'), ('envio_rechazos_documento_id_idx'),
         ('envio_rechazos_organizacion_id_idx'), ('envios_certificado_id_idx'), ('envios_organizacion_id_idx'),
         ('eventos_pasarela_organizacion_id_idx'), ('folios_anulados_anulado_por_idx'),
         ('folios_anulados_organizacion_id_idx'), ('invitaciones_invitado_por_idx'),
         ('operaciones_sii_documento_id_idx'), ('operaciones_sii_envio_id_idx'),
         ('operaciones_sii_solicitud_id_idx'), ('operaciones_sii_usuario_id_idx'),
         ('organizaciones_creado_por_idx'), ('pagos_suscripcion_id_idx'), ('perfiles_ultima_empresa_idx'),
         ('perfiles_ultima_organizacion_idx'), ('procesos_certificacion_empresa_id_envio_set_id_idx'),
         ('procesos_certificacion_organizacion_id_idx'), ('productos_organizacion_id_idx'),
         ('rcof_empresa_id_envio_id_idx'), ('rcof_organizacion_id_idx'), ('receptores_organizacion_id_idx'),
         ('resoluciones_organizacion_id_idx'), ('set_pruebas_casos_documento_id_idx'),
         ('set_pruebas_casos_organizacion_id_idx'), ('set_pruebas_casos_tipo_dte_idx'),
         ('solicitudes_folios_caf_id_idx'), ('solicitudes_folios_certificado_id_idx'),
         ('solicitudes_folios_empresa_id_idx'), ('solicitudes_folios_organizacion_id_idx'),
         ('solicitudes_folios_solicitado_por_idx'), ('solicitudes_folios_tipo_dte_idx'),
         ('suscripciones_plan_id_idx'), ('webhook_entregas_reenviada_por_idx')
),
fk_sin_indice as (
  select c.conrelid::regclass::text as tabla, c.conname
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indisvalid
        and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey)
),
indice(nombre, def, valido) as (
  select ic.relname::text, pg_get_indexdef(ic.oid), i.indisvalid
  from pg_index i join pg_class ic on ic.oid = i.indexrelid
  where ic.relnamespace = 'public'::regnamespace
)
select * from (
  select 1 as n, 'organizaciones_slug_no_reservado existe, está validado y su lista es exactamente SLUGS_RESERVADOS (26 slugs)' as verificacion,
         coalesce((select convalidated
                          and (select array_agg(s order by s) from unnest(slugs) s)
                              = (select array_agg(slug order by slug) from esperados)
                   from chequeo), false) as ok,
         coalesce((select array_length(slugs, 1)::text || ' slugs en el check' from chequeo), 'no existe el check') as detalle
  union all
  select 2, 'ninguna organización usa un slug reservado',
         not exists (select 1 from public.organizaciones o join esperados e on e.slug = o.slug),
         (select string_agg(o.slug, ', ') from public.organizaciones o join esperados e on e.slug = o.slug)
  union all
  select 3, 'los 53 índices de FK de la 0020 existen y son válidos',
         (select count(*) from indices_fk f join indice x on x.nombre = f.nombre and x.valido) = 53,
         (select count(*) from indices_fk f join indice x on x.nombre = f.nombre and x.valido)::text || '/53; faltan: '
         || coalesce((select string_agg(f.nombre, ', ') from indices_fk f
                       where not exists (select 1 from indice x where x.nombre = f.nombre and x.valido)), 'ninguno')
  union all
  select 4, 'ninguna FK de public queda sin un índice que la cubra (regla de unindexed_foreign_keys)',
         not exists (select 1 from fk_sin_indice),
         (select count(*)::text || ' sin índice: ' || coalesce(string_agg(tabla || '.' || conname, ', '), '') from fk_sin_indice)
  union all
  select 5, 'operaciones_sii_ambiente_terminada_en_idx: (ambiente, terminada_en) include (resultado) where terminada_en is not null',
         coalesce((select valido
                          and def like '%ON public.operaciones_sii USING btree (ambiente, terminada_en) INCLUDE (resultado) WHERE (terminada_en IS NOT NULL)'
                   from indice where nombre = 'operaciones_sii_ambiente_terminada_en_idx'), false),
         (select def from indice where nombre = 'operaciones_sii_ambiente_terminada_en_idx')
  union all
  select 6, 'operaciones_sii_operacion_resultado_terminada_en_idx: (operacion, resultado, terminada_en desc) where terminada_en is not null',
         coalesce((select valido
                          and def like '%ON public.operaciones_sii USING btree (operacion, resultado, terminada_en DESC) WHERE (terminada_en IS NOT NULL)'
                   from indice where nombre = 'operaciones_sii_operacion_resultado_terminada_en_idx'), false),
         (select def from indice where nombre = 'operaciones_sii_operacion_resultado_terminada_en_idx')
  union all
  select 7, 'tg_api_key_sin_reactivar: sin EXECUTE para PUBLIC, anon ni authenticated; trg_10_api_key_sin_reactivar sigue activo',
         to_regprocedure('public.tg_api_key_sin_reactivar()') is not null
         and not has_function_privilege('anon', 'public.tg_api_key_sin_reactivar()', 'execute')
         and not has_function_privilege('authenticated', 'public.tg_api_key_sin_reactivar()', 'execute')
         and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where p.oid = 'public.tg_api_key_sin_reactivar()'::regprocedure
                           and a.grantee = 0 and a.privilege_type = 'EXECUTE')
         and exists (select 1 from pg_trigger t
                     where t.tgrelid = 'public.api_keys'::regclass and t.tgname = 'trg_10_api_key_sin_reactivar'
                       and t.tgenabled = 'O'),
         null
  union all
  select 8, 'crear_organizacion sin cambios: security definer, search_path vacío, inserta lower(p_slug) (el check se aplica igual)',
         coalesce((select prosecdef and proconfig = array['search_path=""']
                          and prosrc like '%insert into public.organizaciones (nombre, slug, creado_por)%'
                          and prosrc like '%lower(p_slug)%'
                   from pg_proc where oid = to_regprocedure('public.crear_organizacion(text, text)')), false),
         null
  union all
  select 9, 'migración 0020 registrada',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0020'),
         (select string_agg(version, ', ' order by version) from supabase_migrations.schema_migrations
           where version >= '0018')
) v
order by n;
