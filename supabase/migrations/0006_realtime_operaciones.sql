-- =============================================================================
-- 0006 · Realtime para operaciones con el SII y solicitudes de folios (PLAN-SAAS Fase 4)
--
-- Hallazgo H9 del plan: la publicación `supabase_realtime` solo trae `documentos`,
-- `envios` y `procesos_certificacion` (0001, sección 19). Las operaciones largas
-- (solicitud de folios, postulación, declaración) dejan su avance en `operaciones_sii`
-- y `solicitudes_folios`; sin publicarlas, la UI tendría que consultar a cada rato en
-- vez de escuchar los cambios (Fases 5 y 6: «no hay spinners por fila»).
--
-- Realtime respeta RLS: a cada suscriptor de `postgres_changes` le entrega solo las
-- filas que su política SELECT le deja ver. Las dos tablas ya tienen RLS activo y la
-- política `lectura` (`for select to authenticated using (es_miembro(organizacion_id))`,
-- 0001, sección 17), y `authenticated` tiene SELECT sobre ellas: un miembro recibe los
-- cambios de su organización y nada de las demás. No se publica nada que el miembro no
-- pudiera leer ya con un SELECT (`operaciones_sii.mensaje` y `detalle` nunca llevan
-- tokens, claves ni cookies, principio 5). `anon` no tiene SELECT ni políticas: no
-- recibe nada.
--
-- `replica identity`: se deja la de siempre (la llave primaria, `id`). Con ella los
-- INSERT y UPDATE llegan con la fila nueva completa, que es lo que la UI necesita (y
-- el filtro `organizacion_id=eq.…` de la suscripción se evalúa sobre esa fila). Lo
-- único que se pierde es la fila anterior completa en UPDATE y DELETE, que la UI no
-- usa. `replica identity full` agrandaría el WAL de cada UPDATE y, en los DELETE (que
-- aquí solo ocurren en cascada, al borrar la organización o la empresa), Realtime no
-- puede aplicar RLS: entrega solo la llave primaria, con o sin `full`.
--
-- Idempotente: agrega cada tabla solo si la publicación existe y la tabla todavía no
-- está en ella (`alter publication ... add table` falla si ya lo está). Si la
-- publicación no existe (no debería: Supabase la crea con el proyecto) no hace nada,
-- igual que 0001; la verificación 0006 lo detecta.
--
-- Aditiva: no cambia tablas, políticas ni privilegios.
-- =============================================================================

begin;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['operaciones_sii', 'solicitudes_folios'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

commit;
