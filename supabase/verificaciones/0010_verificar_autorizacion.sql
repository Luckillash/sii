-- Verificación de la migración 0010_verificar_autorizacion en el proyecto de Supabase (producción).
--
-- SOLO LECTURA: no escribe ni crea objetos. Se ejecuta tal cual en el SQL Editor o con el MCP
-- `execute_sql`. Cada fila es una comprobación: todas deben salir con ok = true.
-- La prueba de comportamiento (el backend registra verificar_autorizacion en producción; dos
-- simultáneas no chocan; el índice de efecto global sigue frenando las suyas; un miembro la lee
-- y no la escribe) está en rls-fase5-verificar-autorizacion.sql, con transacción y rollback.
-- 6 comprobaciones: 1-3 el enum; 4 el índice de 0007 no cambió; 5 ninguna verificación quedó
-- abandonada en curso; 6 migración registrada. `operacion::text` deja correr el script antes
-- de migrar (un literal de enum desconocido daría error en vez de false).

with valores as (
  select e.enumlabel as valor, e.enumsortorder as orden,
         row_number() over (order by e.enumsortorder) as posicion
  from pg_enum e
  where e.enumtypid = 'public.operacion_sii'::regtype
),
indice as (
  select pg_get_indexdef(i.indexrelid) as definicion, pg_get_expr(i.indpred, i.indrelid) as predicado,
         i.indisunique, i.indisvalid
  from pg_index i
  where i.indexrelid = to_regclass('public.operaciones_sii_efecto_global_en_curso')
)
select * from (
  select 1 as n, 'operacion_sii tiene el valor verificar_autorizacion' as verificacion,
         exists (select 1 from valores where valor = 'verificar_autorizacion') as ok,
         (select string_agg(valor, ', ' order by orden) from valores) as detalle
  union all
  select 2, 'verificar_autorizacion es el último valor, justo después de seguimiento',
         coalesce((select valor = 'verificar_autorizacion' from valores
                    where posicion = (select max(posicion) from valores)), false)
           and coalesce((select v2.posicion = v1.posicion + 1 from valores v1, valores v2
                          where v1.valor = 'seguimiento' and v2.valor = 'verificar_autorizacion'), false),
         null
  union all
  select 3, 'los 15 valores anteriores siguen en su orden (16 en total)',
         (select array_agg(valor::text order by orden) from valores) = array[
           'autenticar', 'obtener_token', 'postular', 'descargar_set', 'solicitar_folios',
           'enviar_set', 'estado_envio', 'solicitar_revision', 'verificar_portal',
           'estado_declaracion', 'declarar', 'enviar_rcof', 'emitir', 'consultar_envio',
           'seguimiento', 'verificar_autorizacion'
         ]::text[],
         (select count(*) || ' valores' from valores)
  union all
  select 4, 'el índice único de efecto global (0007) sigue válido y con exactamente solicitar_folios, postular y declarar',
         coalesce((select indisunique and indisvalid
                          and predicado like '%solicitar_folios%'
                          and predicado like '%postular%'
                          and predicado like '%declarar%'
                          and predicado not like '%verificar_autorizacion%'
                     from indice), false),
         (select coalesce(predicado, 'NO EXISTE') from indice)
  union all
  select 5, 'ninguna fila verificar_autorizacion quedó en curso hace más de 15 minutos (abandonada)',
         not exists (select 1 from public.operaciones_sii
                      where operacion::text = 'verificar_autorizacion'
                        and resultado = 'en_curso'
                        and iniciada_en < now() - interval '15 minutes'),
         (select count(*) || ' filas verificar_autorizacion' from public.operaciones_sii
           where operacion::text = 'verificar_autorizacion')
  union all
  select 6, 'migración registrada como 0010',
         exists (select 1 from supabase_migrations.schema_migrations where version = '0010'),
         (select string_agg(version || ' ' || coalesce(name, ''), ', ' order by version)
            from supabase_migrations.schema_migrations)
) v
order by n;
