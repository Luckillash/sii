-- Verificación de la migración 0018_api_webhooks en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe, no crea objetos y no llama a ninguna función. Se ejecuta tal
-- cual en el SQL Editor o con el MCP `execute_sql`. Cada fila es una comprobación: todas
-- deben salir con ok = true.
-- La prueba de comportamiento (autenticar una API key, reclamar y terminar una
-- Idempotency-Key, reclamar y cerrar entregas con su backoff, reenviar, probar y rotar el
-- secreto con cada rol, el filtro por plan de encolar_evento y el check de la URL) está en
-- rls-fase11-api.sql, con transacción y rollback.
--
-- 23 comprobaciones: 1-3 api_idempotencia (columnas; llaves, FK y check; RLS sin políticas,
-- privilegios e índice); 4-5 webhook_entregas (columnas de reenvío, índices); 6 check
-- webhooks_url_permitida validado; 7 índices de RLS, FK y el listado; 8-10 las 9 funciones
-- nuevas (firmas y retornos, definer y search_path vacío, privilegios); 11-17 cuerpos
-- (autenticar_api_key, reclamar_idempotencia, terminar y soltar, reclamar_entregas_webhook,
-- cerrar_entrega_webhook, acciones del panel, rotar_secreto_webhook); 18 encolar_evento
-- filtra por plan; 19 tg_evento_documento con estado, origen y clave; 20 crear_api_key y
-- crear_webhook siguen para authenticated y las políticas de la 0001 intactas; 21 fuera de
-- Realtime; 22 migración registrada; 23 revocar es definitivo (trigger de api_keys y
-- authenticated sin update de expira_en).
--
-- Las tablas se buscan con to_regclass y las funciones con to_regprocedure (nombres
-- calificados), así el resultado no depende del search_path de la sesión y la consulta no
-- falla antes de migrar. Antes de migrar salen true solo la 20 y la 21 (lo de la 0001 que
-- no cambia).

with columnas as (
  select c.relname::text as tabla, a.attname::text as columna,
         format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  where a.attrelid in (to_regclass('public.api_idempotencia'), to_regclass('public.webhook_entregas'))
    and a.attnum > 0 and not a.attisdropped
),
esperadas(columna, tipo, nn) as (
  values
    ('organizacion_id', 'uuid', true),
    ('clave', 'text', true),
    ('recurso', 'text', true),
    ('huella', 'text', true),
    ('api_key_id', 'uuid', false),
    ('estado', 'text', true),
    ('status_http', 'smallint', false),
    ('respuesta', 'jsonb', false),
    ('recurso_id', 'uuid', false),
    ('reclamada_en', 'timestamp with time zone', true),
    ('terminada_en', 'timestamp with time zone', false),
    ('creado_en', 'timestamp with time zone', true)
),
restricciones as (
  select t.relname::text as tabla, c.conname::text as nombre, c.contype, c.convalidated,
         pg_get_constraintdef(c.oid) as definicion, c.confrelid, c.confdeltype
  from pg_constraint c join pg_class t on t.oid = c.conrelid
  where c.conrelid in (to_regclass('public.api_idempotencia'), to_regclass('public.webhook_entregas'),
                       to_regclass('public.webhooks'))
),
indices as (
  select i.indexrelid::regclass::text as nombre, t.relname::text as tabla,
         pg_get_indexdef(i.indexrelid) as definicion
  from pg_index i join pg_class t on t.oid = i.indrelid
  where t.relnamespace = 'public'::regnamespace
),
firmas(nombre, firma, resultado, panel) as (
  values
    ('autenticar_api_key', 'public.autenticar_api_key(text)',
     'TABLE(api_key_id uuid, organizacion_id uuid, empresa_id uuid, alcances text[], ambiente ambiente_sii, motivo text)', false),
    ('reclamar_idempotencia', 'public.reclamar_idempotencia(uuid, text, text, text, uuid, integer)',
     'TABLE(resultado text, status_http integer, respuesta jsonb, recurso_id uuid)', false),
    ('terminar_idempotencia', 'public.terminar_idempotencia(uuid, text, integer, jsonb, uuid)', 'boolean', false),
    ('soltar_idempotencia', 'public.soltar_idempotencia(uuid, text, uuid)', 'boolean', false),
    ('reclamar_entregas_webhook', 'public.reclamar_entregas_webhook(integer, integer)',
     'TABLE(id bigint, organizacion_id uuid, webhook_id uuid, evento text, payload jsonb, intentos integer, url text, secreto_secret_id uuid)', false),
    ('cerrar_entrega_webhook', 'public.cerrar_entrega_webhook(bigint, integer, boolean, integer, text, boolean)',
     'estado_entrega_webhook', false),
    ('reenviar_entrega_webhook', 'public.reenviar_entrega_webhook(bigint)', 'void', true),
    ('probar_webhook', 'public.probar_webhook(uuid)', 'bigint', true),
    ('rotar_secreto_webhook', 'public.rotar_secreto_webhook(uuid)', 'text', true)
),
funciones as (
  select f.nombre, f.panel, f.resultado as esperado, p.oid, p.prosecdef, p.proconfig, p.prosrc,
         p.pronargdefaults, l.lanname,
         replace(pg_get_function_result(p.oid), 'public.', '') as resultado
  from firmas f
  left join pg_proc p on p.oid = to_regprocedure(f.firma)
  left join pg_language l on l.oid = p.prolang
),
cuerpo(nombre, src) as (
  select nombre, coalesce(prosrc, '') from funciones
),
encolar as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc
  from pg_proc p where p.oid = to_regprocedure('public.encolar_evento(uuid, text, jsonb)')
),
evento_doc as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc
  from pg_proc p where p.oid = to_regprocedure('public.tg_evento_documento()')
)
select * from (
  select 1 as n, 'la tabla api_idempotencia existe con sus 12 columnas, tipos y not null' as verificacion,
         (select count(*) from esperadas e join columnas c
            on c.tabla = 'api_idempotencia' and c.columna = e.columna and c.tipo = e.tipo and c.attnotnull = e.nn) = 12
         and (select count(*) from columnas where tabla = 'api_idempotencia') = 12 as ok,
         (select string_agg(columna || ' ' || tipo || case when attnotnull then ' not null' else '' end, ', ')
            from columnas where tabla = 'api_idempotencia') as detalle
  union all
  select 2, 'api_idempotencia: llave primaria (organizacion_id, clave); FK organizacion_id → organizaciones on delete cascade y api_key_id → api_keys on delete set null; check de clave, recurso, huella, estado, status y terminada completa',
         exists (select 1 from restricciones where tabla = 'api_idempotencia' and contype = 'p'
                  and definicion = 'PRIMARY KEY (organizacion_id, clave)')
         and exists (select 1 from restricciones where tabla = 'api_idempotencia' and contype = 'f'
                      and confrelid = 'public.organizaciones'::regclass and confdeltype = 'c'
                      and definicion like 'FOREIGN KEY (organizacion_id)%')
         and exists (select 1 from restricciones where tabla = 'api_idempotencia' and contype = 'f'
                      and confrelid = to_regclass('public.api_keys') and confdeltype = 'n'
                      and definicion like 'FOREIGN KEY (api_key_id)%')
         and (select count(*) from restricciones where tabla = 'api_idempotencia' and contype = 'c'
               and nombre in ('api_idempotencia_clave_valida', 'api_idempotencia_recurso_valido',
                              'api_idempotencia_huella_valida', 'api_idempotencia_estado_valido',
                              'api_idempotencia_status_valido', 'api_idempotencia_terminada_completa')) = 6
         and exists (select 1 from restricciones where nombre = 'api_idempotencia_recurso_valido'
                      and definicion like '%documento%' and definicion like '%lote%'
                      and definicion like '%solicitud_folios%'),
         (select string_agg(nombre || ' ' || contype::text, ', ' order by nombre) from restricciones
           where tabla = 'api_idempotencia')
  union all
  select 3, 'api_idempotencia: RLS activo y SIN políticas; anon y authenticated sin privilegios, service_role todos; índice parcial por api_key_id',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.api_idempotencia')), false)
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_idempotencia')
         and coalesce(not has_table_privilege('anon', to_regclass('public.api_idempotencia'), 'select,insert,update,delete'), false)
         and coalesce(not has_table_privilege('authenticated', to_regclass('public.api_idempotencia'), 'select,insert,update,delete'), false)
         and coalesce(has_table_privilege('service_role', to_regclass('public.api_idempotencia'), 'select,insert,update,delete'), false)
         and exists (select 1 from indices where nombre = 'api_idempotencia_api_key'
                      and definicion like '%(api_key_id)%' and definicion like '%WHERE (api_key_id IS NOT NULL)%'),
         (select string_agg(policyname, ', ') from pg_policies
           where schemaname = 'public' and tablename = 'api_idempotencia')
  union all
  select 4, 'webhook_entregas: reenviada_en (timestamptz) y reenviada_por (uuid, FK → auth.users on delete set null), ambas nulables',
         exists (select 1 from columnas where tabla = 'webhook_entregas' and columna = 'reenviada_en'
                  and tipo = 'timestamp with time zone' and not attnotnull)
         and exists (select 1 from columnas where tabla = 'webhook_entregas' and columna = 'reenviada_por'
                      and tipo = 'uuid' and not attnotnull)
         and exists (select 1 from restricciones where tabla = 'webhook_entregas' and contype = 'f'
                      and confrelid = 'auth.users'::regclass and confdeltype = 'n'
                      and definicion like 'FOREIGN KEY (reenviada_por)%'),
         (select string_agg(columna || ' ' || tipo, ', ') from columnas
           where tabla = 'webhook_entregas' and columna like 'reenviada%')
  union all
  select 5, 'webhook_entregas: índices por_entregar (parcial pendiente y fallido), historial (webhook_id, id desc) y organizacion (organizacion_id, id desc); el de la 0001 sigue',
         exists (select 1 from indices where nombre = 'webhook_entregas_por_entregar'
                  and definicion like '%(siguiente_intento_en)%'
                  and definicion like '%pendiente%' and definicion like '%fallido%')
         and exists (select 1 from indices where nombre = 'webhook_entregas_historial'
                      and definicion like '%(webhook_id, id DESC)%')
         and exists (select 1 from indices where nombre = 'webhook_entregas_organizacion'
                      and definicion like '%(organizacion_id, id DESC)%')
         and exists (select 1 from indices where nombre = 'webhook_entregas_pendientes'),
         (select string_agg(nombre, ', ' order by nombre) from indices where tabla = 'webhook_entregas')
  union all
  select 6, 'webhooks: check webhooks_url_permitida validado (https, solo 443, sin IP ni localhost, .local, .localhost o .internal, sin punto final, hasta 2048)',
         exists (select 1 from restricciones where tabla = 'webhooks' and nombre = 'webhooks_url_permitida'
                  and contype = 'c' and convalidated
                  and definicion like '%2048%' and definicion like '%https://[A-Za-z0-9.-]+(:443)?%'
                  and definicion like '%localhost%' and definicion like '%internal%'),
         (select definicion from restricciones where nombre = 'webhooks_url_permitida')
  union all
  select 7, 'índices: api_keys_organizacion, webhooks_organizacion, operaciones_sii_api_key (parcial) y documentos_api_listado (organizacion_id, ambiente, creado_en desc, id desc)',
         exists (select 1 from indices where nombre = 'api_keys_organizacion' and definicion like '%(organizacion_id)%')
         and exists (select 1 from indices where nombre = 'webhooks_organizacion' and definicion like '%(organizacion_id)%')
         and exists (select 1 from indices where nombre = 'operaciones_sii_api_key'
                      and definicion like '%(api_key_id)%' and definicion like '%WHERE (api_key_id IS NOT NULL)%')
         and exists (select 1 from indices where nombre = 'documentos_api_listado'
                      and definicion like '%(organizacion_id, ambiente, creado_en DESC, id DESC)%'),
         (select string_agg(nombre, ', ' order by nombre) from indices
           where nombre in ('api_keys_organizacion', 'webhooks_organizacion', 'operaciones_sii_api_key', 'documentos_api_listado'))
  union all
  select 8, 'las 9 funciones nuevas existen con su firma exacta y su retorno (cerrar_entrega_webhook con 3 parámetros por defecto)',
         (select count(*) from funciones where oid is not null and resultado = esperado) = 9
         and coalesce((select pronargdefaults = 3 from funciones where nombre = 'cerrar_entrega_webhook'), false),
         (select string_agg(nombre || ': ' || coalesce(resultado, 'NO EXISTE'), ' | ' order by nombre)
            from funciones where oid is null or resultado <> esperado)
  union all
  select 9, 'las 9: plpgsql, security definer y search_path vacío',
         (select count(*) from funciones
           where lanname = 'plpgsql' and prosecdef
             and proconfig @> array['search_path=""']) = 9,
         (select string_agg(nombre || ' definer=' || coalesce(prosecdef::text, '-') || ' ' || coalesce(proconfig::text, '-'), ' | ')
            from funciones where not (coalesce(prosecdef, false) and coalesce(proconfig @> array['search_path=""'], false)))
  union all
  select 10, 'privilegios: service_role ejecuta las 9; anon ninguna; authenticated solo reenviar_entrega_webhook, probar_webhook y rotar_secreto_webhook',
         (select count(*) from funciones f
           where f.oid is not null
             and has_function_privilege('service_role', f.oid, 'execute')
             and not has_function_privilege('anon', f.oid, 'execute')
             and has_function_privilege('authenticated', f.oid, 'execute') = f.panel) = 9,
         (select string_agg(nombre || ' auth=' || has_function_privilege('authenticated', oid, 'execute')::text
                            || ' anon=' || has_function_privilege('anon', oid, 'execute')::text, ', ' order by nombre)
            from funciones where oid is not null)
  union all
  select 11, 'autenticar_api_key: valida el formato del hash, distingue invalida, revocada, vencida y plan_sin_api, y actualiza ultimo_uso_en como mucho una vez por minuto',
         (select src like '%^[0-9a-f]{64}$%' and src like '%''invalida''%' and src like '%''revocada''%'
                 and src like '%''vencida''%' and src like '%''plan_sin_api''%' and src like '%incluye_api%'
                 and src like '%ultimo_uso_en < now() - interval ''1 minute''%'
            from cuerpo where nombre = 'autenticar_api_key'),
         null
  union all
  select 12, 'reclamar_idempotencia: insert con on conflict sobre la llave primaria, retoma solo con la misma huella y recurso y el arriendo vencido, y devuelve nueva, retomada, en_curso, terminada o conflicto',
         (select src like '%on conflict on constraint api_idempotencia_pkey do nothing%'
                 and src like '%i.huella = p_huella%' and src like '%i.recurso = p_recurso%'
                 and src like '%make_interval(secs => v_arriendo)%'
                 and src like '%''nueva''%' and src like '%''retomada''%' and src like '%''en_curso''%'
                 and src like '%''terminada''%' and src like '%''conflicto''%' and src like '%22004%'
            from cuerpo where nombre = 'reclamar_idempotencia'),
         null
  union all
  select 13, 'terminar_idempotencia y soltar_idempotencia: solo tocan claves en curso; soltar vence el arriendo (-infinity) sin borrar la huella',
         (select src like '%estado = ''terminada''%' and src like '%i.estado = ''en_curso''%'
            from cuerpo where nombre = 'terminar_idempotencia')
         and (select src like '%reclamada_en = ''-infinity''%' and src like '%i.estado = ''en_curso''%'
                     and src not like '%huella =%'
                from cuerpo where nombre = 'soltar_idempotencia'),
         null
  union all
  select 14, 'reclamar_entregas_webhook: descarta (inactivo, 8 intentos, plan sin webhooks), toma por turnos entre organizaciones con for update skip locked, suma el intento y corre el arriendo',
         (select src like '%estado = ''descartado''%' and src like '%incluye_webhooks%'
                 and src like '%v.hechos >= 8%'
                 and src like '%row_number() over (partition by e.organizacion_id%'
                 and src like '%for update of e skip locked%'
                 and src like '%intentos = e.intentos + 1%'
                 and src like '%make_interval(secs => v_arriendo)%'
            from cuerpo where nombre = 'reclamar_entregas_webhook'),
         null
  union all
  select 15, 'cerrar_entrega_webhook: solo cierra pendiente o fallido en el intento reclamado (for update), descarta con definitiva o 8 intentos y reprograma con 1m-5m-30m-2h-6h-12h-24h ±10 %',
         (select src like '%e.estado in (''pendiente'', ''fallido'') and e.intentos = p_intento%'
                 and src like '%for update%'
                 and src like '%v_entrega.intentos >= 8%'
                 and src like '%array[''1 minute'', ''5 minutes'', ''30 minutes'', ''2 hours'',%'
                 and src like '%''6 hours'', ''12 hours'', ''24 hours'']::interval[]%'
                 and src like '%(0.9 + random() * 0.2)%' and src like '%left(p_respuesta, 1000)%'
            from cuerpo where nombre = 'cerrar_entrega_webhook'),
         null
  union all
  select 16, 'reenviar_entrega_webhook y probar_webhook: P0002 sin ser miembro, 42501 sin ser administrador, P0001 plan sin webhooks, 22023 desactivado; reenviar reinicia la misma fila y probar encola webhook.prueba',
         (select count(*) from cuerpo
           where nombre in ('reenviar_entrega_webhook', 'probar_webhook')
             and src like '%es_miembro%' and src like '%es_admin%' and src like '%''P0002''%'
             and src like '%''42501''%' and src like '%''P0001''%' and src like '%''22023''%'
             and src like '%service_role%') = 2
         and (select src like '%intentos = 0%' and src like '%reenviada_por = (select auth.uid())%'
                from cuerpo where nombre = 'reenviar_entrega_webhook')
         and (select src like '%''webhook.prueba''%' from cuerpo where nombre = 'probar_webhook'),
         null
  union all
  select 17, 'rotar_secreto_webhook: P0002 / 42501, crea el secreto nuevo whsec_ en Vault, actualiza secreto_secret_id y borra el anterior',
         (select src like '%''whsec_'' || public.token_aleatorio()%' and src like '%vault.create_secret%'
                 and src like '%set secreto_secret_id = v_secret_id%'
                 and src like '%delete from vault.secrets s where s.id = v_webhook.secreto_secret_id%'
                 and src like '%''P0002''%' and src like '%''42501''%'
            from cuerpo where nombre = 'rotar_secreto_webhook'),
         null
  union all
  select 18, 'encolar_evento: sigue security definer con search_path vacío y solo para service_role, y ahora encola solo si el plan vigente incluye webhooks',
         coalesce((select prosecdef and proconfig @> array['search_path=""']
                          and prosrc like '%(public.plan_vigente(p_organizacion)).incluye_webhooks%'
                          and prosrc like '%w.activo%' and prosrc like '%p_evento = any (w.eventos)%'
                          and has_function_privilege('service_role', oid, 'execute')
                          and not has_function_privilege('authenticated', oid, 'execute')
                          and not has_function_privilege('anon', oid, 'execute')
                     from encolar), false),
         null
  union all
  select 19, 'tg_evento_documento: agrega estado, origen y clave_idempotencia a los datos (los demás campos siguen) y trg_50_evento_documento la usa',
         coalesce((select prosecdef and proconfig @> array['search_path=""']
                          and prosrc like '%''estado'', new.estado%' and prosrc like '%''origen'', new.origen%'
                          and prosrc like '%''clave_idempotencia'', new.clave_idempotencia%'
                          and prosrc like '%''documento_id'', new.id%' and prosrc like '%''envio_id'', new.envio_id%'
                     from evento_doc), false)
         and exists (select 1 from pg_trigger
                      where tgrelid = 'public.documentos'::regclass and tgname = 'trg_50_evento_documento'
                        and tgfoid = to_regprocedure('public.tg_evento_documento()')),
         null
  union all
  select 20, 'sin cambios en lo de la 0001: crear_api_key y crear_webhook ejecutables por authenticated (no anon) y políticas lectura/edición/borrado de api_keys y webhooks y lectura de webhook_entregas',
         has_function_privilege('authenticated', 'public.crear_api_key(uuid, text, text[], public.ambiente_sii, uuid, timestamp with time zone)', 'execute')
         and has_function_privilege('authenticated', 'public.crear_webhook(uuid, text, text[])', 'execute')
         and not has_function_privilege('anon', 'public.crear_webhook(uuid, text, text[])', 'execute')
         and (select count(*) from pg_policies where schemaname = 'public'
               and ((tablename in ('api_keys', 'webhooks') and policyname in ('lectura', 'edicion', 'borrado'))
                    or (tablename = 'webhook_entregas' and policyname = 'lectura'))) = 7,
         (select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname) from pg_policies
           where schemaname = 'public' and tablename in ('api_keys', 'webhooks', 'webhook_entregas'))
  union all
  select 21, 'api_idempotencia, api_keys, webhooks y webhook_entregas fuera de la publicación supabase_realtime',
         not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename in ('api_idempotencia', 'api_keys', 'webhooks', 'webhook_entregas')),
         (select string_agg(tablename, ', ') from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename in ('api_idempotencia', 'api_keys', 'webhooks', 'webhook_entregas'))
  union all
  select 22, 'migración registrada como 0018',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0018'),
         (select string_agg(version, ', ' order by version) from supabase_migrations.schema_migrations
           where version >= '0015')
  union all
  select 23, 'api_keys: trg_10_api_key_sin_reactivar (before update, revocar es definitivo y la expiración no se alarga); authenticated actualiza solo nombre y revocada_en',
         exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.api_keys')
                    and t.tgname = 'trg_10_api_key_sin_reactivar' and not t.tgisinternal
                    and t.tgenabled = 'O'
                    and t.tgfoid = to_regprocedure('public.tg_api_key_sin_reactivar()'))
         and coalesce((select prosrc like '%old.revocada_en is not null and new.revocada_en is distinct from old.revocada_en%'
                              and prosrc like '%new.expira_en > old.expira_en%'
                              and prosrc like '%''22023''%'
                         from pg_proc where oid = to_regprocedure('public.tg_api_key_sin_reactivar()')), false)
         and not has_table_privilege('authenticated', 'public.api_keys', 'UPDATE')
         and has_column_privilege('authenticated', 'public.api_keys', 'nombre', 'UPDATE')
         and has_column_privilege('authenticated', 'public.api_keys', 'revocada_en', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.api_keys', 'expira_en', 'UPDATE'),
         null
) v
order by n;
