-- =============================================================================
-- 0009 · Autorización a producción obtenida fuera de Boletéame (PLAN-SAAS Fase 5)
--
-- Por qué: una empresa que se certificó FUERA de Boletéame (con la CLI, con otro
-- proveedor o por su cuenta) ya está autorizada en el SII, pero el SII responde a
-- `obtenerEstadoAutorizaEmp` «sin trámite» (`codigo: null`), no P91: es lo mismo que
-- responde a una empresa que nunca postuló. Hasta ahora `empresas.autorizada_produccion`
-- solo la ponía `tg_certificacion_autorizada` (0001) al ver P91 en el proceso de
-- certificación, y `tg_proteger_autorizacion` (0001) impide que la ponga un usuario. Así
-- la empresa quedaba sin poder emitir en producción, el asistente en `borrador`
-- invitándola a postular de nuevo (lo que la devolvería a certificación) y sin los
-- candados que miran la autorización.
--
-- Decisión del usuario (2026-11-13): registrar la resolución de PRODUCCIÓN de una
-- empresa equivale a declarar que ya está autorizada a emitir boletas en producción. Si
-- la declaración es falsa, el SII rechaza igual los envíos de producción (valida la
-- resolución y la autorización de la empresa en cada envío), así que no abre nada que el
-- SII no controle. Registrar la resolución ya es solo de administradores
-- (`registrar_resolucion`, 0005, y la política de escritura de `resoluciones`).
--
-- 1. `tg_resolucion_autoriza_produccion()` + trigger `trg_50_resolucion_autoriza_produccion`
--    (after insert or update en `resoluciones`, solo cuando la fila queda
--    `ambiente = 'produccion'` y `vigente`): marca la empresa con
--    `autorizada_produccion = true` y `autorizada_en = coalesce(autorizada_en, now())`.
--    Nunca la desmarca (igual que P91): dejar la resolución sin vigencia, reemplazarla o
--    borrarla no cambia la autorización. Idempotente: si la empresa ya está autorizada
--    con fecha, el UPDATE no toca la fila (no dispara `actualizado_en` ni conserva otra
--    fecha).
--    Filtra por `empresa_id` Y `organizacion_id` de la fila (principio 2; el
--    `organizacion_id` ya lo fijó `trg_00_organizacion` desde la empresa, antes del
--    WITH CHECK de RLS, así que siempre calzan).
--    Es `security definer` (dueño `postgres`) por la misma razón que
--    `tg_certificacion_autorizada`: `tg_proteger_autorizacion` deja cambiar la columna
--    solo a service_role o a `current_user = postgres`, y quien registra la resolución
--    es un administrador (`authenticated`). Un authenticated sigue sin poder poner
--    `autorizada_produccion` a mano. El trigger no pide EXECUTE a quien dispara: se
--    revoca a PUBLIC, anon y authenticated (no se llama por la API).
--
-- 2. Ajuste de datos, idempotente: marca las empresas que YA tienen una resolución de
--    producción vigente (hoy no hay ninguna; queda por si una base la tiene). Corre como
--    `postgres`, así que `tg_proteger_autorizacion` lo deja pasar.
--
-- Aditiva: una función, un trigger y un UPDATE acotado. Sin tablas, columnas, políticas
-- ni grants de tablas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. La resolución de producción vigente marca la empresa como autorizada
-- -----------------------------------------------------------------------------

create function public.tg_resolucion_autoriza_produccion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Decisión del usuario 2026-11-13: registrar la resolución de producción equivale a
  -- declarar que la empresa ya está autorizada (se certificó fuera de Boletéame). Si es
  -- falsa, el SII rechaza los envíos de producción igual.
  if new.ambiente = 'produccion' and new.vigente then
    update public.empresas
    set autorizada_produccion = true,
        autorizada_en = coalesce(autorizada_en, now())
    where id = new.empresa_id
      and organizacion_id = new.organizacion_id
      and (not autorizada_produccion or autorizada_en is null);
  end if;
  -- Nunca desmarca: una resolución sin vigencia o de certificación no cambia nada.
  return null;
end;
$$;

comment on function public.tg_resolucion_autoriza_produccion() is
  'Al quedar vigente una resolución de producción, marca la empresa como autorizada a producción (nunca la desmarca). Decisión del usuario 2026-11-13: registrar la resolución de producción equivale a declarar la autorización.';

revoke execute on function public.tg_resolucion_autoriza_produccion()
  from public, anon, authenticated;

create trigger trg_50_resolucion_autoriza_produccion
  after insert or update on public.resoluciones
  for each row
  when (new.ambiente = 'produccion' and new.vigente)
  execute function public.tg_resolucion_autoriza_produccion();

-- -----------------------------------------------------------------------------
-- 2. Empresas que ya tienen una resolución de producción vigente (idempotente)
-- -----------------------------------------------------------------------------

update public.empresas e
set autorizada_produccion = true,
    autorizada_en = coalesce(e.autorizada_en, now())
from public.resoluciones r
where r.empresa_id = e.id
  and r.organizacion_id = e.organizacion_id
  and r.ambiente = 'produccion'
  and r.vigente
  and (not e.autorizada_produccion or e.autorizada_en is null);

commit;
