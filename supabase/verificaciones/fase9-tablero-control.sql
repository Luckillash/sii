-- Consulta de control del Tablero (PLAN-SAAS Fase 9, criterio de aceptación): «las cifras
-- del tablero cuadran con una consulta SQL de control sobre `documentos` aceptados».
--
-- SOLO LECTURA: no escribe ni crea objetos. Se ejecuta tal cual en el SQL Editor o con el
-- MCP `execute_sql`, después de ajustar los parámetros del primer CTE (slug de la
-- organización, RUT de la empresa como se guarda, `20630500-2`, ambiente y período).
--
-- Calcula DIRECTO desde `documentos`, no desde `v_ventas_diarias` (que es lo que lee la
-- app), con las mismas reglas que el Tablero (`server/tablero/`):
--   - período: `fecha_emision` desde el día 1 del mes hasta antes del día 1 del siguiente;
--   - sin el set de pruebas (`origen = 'set_pruebas'`), como la lista de Documentos;
--   - ventas (neto, IVA, exento, total): aceptados y aceptados con reparos;
--   - documentos emitidos: todo menos borradores y anulados, y con folio;
--   - esperando al SII: `enviado`.
-- Una fila por cifra, con el texto que muestra el Tablero en `cifra` y el valor en `valor`
-- (montos en pesos, sin formato). Compárala con la tarjeta del Tablero para la misma
-- empresa, ambiente y período.

with parametros as (
  select
    'servicio'::text      as slug,
    '20630500-2'::text    as rut_empresa,
    'certificacion'::public.ambiente_sii as ambiente,
    '2026-11'::text       as periodo
),
alcance as (
  select o.id as organizacion_id, e.id as empresa_id, p.ambiente,
         to_date(p.periodo || '-01', 'YYYY-MM-DD') as desde,
         (to_date(p.periodo || '-01', 'YYYY-MM-DD') + interval '1 month')::date as hasta
  from parametros p
  join public.organizaciones o on o.slug = p.slug
  join public.empresas e on e.organizacion_id = o.id and e.rut = p.rut_empresa
),
docs as (
  select d.*
  from public.documentos d
  join alcance a
    on d.organizacion_id = a.organizacion_id
   and d.empresa_id = a.empresa_id
   and d.ambiente = a.ambiente
   and d.fecha_emision >= a.desde
   and d.fecha_emision < a.hasta
  where d.origen <> 'set_pruebas'
),
aceptados as (
  select * from docs where estado in ('aceptado', 'aceptado_con_reparos')
),
con_folio as (
  select * from docs where folio is not null
)
select 1 as orden, 'Ventas netas' as cifra, coalesce(sum(mnt_neto), 0)::bigint as valor from aceptados
union all
select 2, 'IVA débito', coalesce(sum(iva), 0)::bigint from aceptados
union all
select 3, 'Exento', coalesce(sum(mnt_exe), 0)::bigint from aceptados
union all
select 4, 'Total', coalesce(sum(mnt_total), 0)::bigint from aceptados
union all
select 5, 'Boletas aceptadas (con o sin reparos)', count(*) from aceptados
union all
select 6, 'Documentos emitidos', count(*) from con_folio where estado not in ('borrador', 'anulado')
union all
select 7, '  aceptados', count(*) from con_folio where estado = 'aceptado'
union all
select 8, '  con reparos', count(*) from con_folio where estado = 'aceptado_con_reparos'
union all
select 9, '  rechazados', count(*) from con_folio where estado = 'rechazado'
union all
select 10, '  enviados', count(*) from con_folio where estado = 'enviado'
union all
select 11, '  por verificar', count(*) from con_folio where estado = 'incierto'
union all
select 12, '  firmados', count(*) from con_folio where estado = 'firmado'
union all
select 13, 'Anulados (no cuentan)', count(*) from con_folio where estado = 'anulado'
union all
select 14, 'Esperando al SII', count(*) from con_folio where estado = 'enviado'
union all
-- Si sale 0, los parámetros no calzan con ninguna empresa: todo lo de arriba sería 0.
select 15, 'Empresas que calzan con los parámetros', count(*) from alcance
order by orden;
