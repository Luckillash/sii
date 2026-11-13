---
title: "Esquema: triggers y lógica"
description: "Cada trigger, su orden de ejecución y lo que hace."
keywords: [tg_resolucion_autoriza_produccion, trg_50_resolucion_autoriza_produccion, autorizada_produccion, autorizada_en, resoluciones, tg_proteger_autorizacion, tg_certificacion_autorizada, autorizada fuera de Boletéame, migración 0009]
related: ["02-guias/seguimiento-envios.md", "02-guias/certificacion-empresa.md", "04-objetos/objetos-certificacion.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/despliegue.md"]
source: ["supabase_saas_sii.sql §15", "supabase/migrations/0009_autorizacion_externa.sql"]
---

# Esquema: triggers y lógica

> **Úsalo cuando:** necesitas entender un efecto automático de la base.

<!-- TODO: redactar contenido (el resto de los triggers de la 0001) -->

Los triggers de un mismo evento corren en orden alfabético: por eso los nombres llevan un
prefijo numérico (`trg_00_…` primero, `trg_90_…` al final).

## `tg_resolucion_autoriza_produccion` (migración 0009)

**Estado: aplicada en producción el 2026-11-13**
([despliegue](despliegue.md#fase-5-migración-0009)).

| | |
|---|---|
| Trigger | `trg_50_resolucion_autoriza_produccion` en `public.resoluciones` |
| Cuándo | `after insert or update`, por fila, `when (new.ambiente = 'produccion' and new.vigente)` |
| Función | `public.tg_resolucion_autoriza_produccion()`: `plpgsql`, `security definer` (dueño `postgres`), `search_path = ''`; sin `EXECUTE` para PUBLIC, `anon` ni `authenticated` |
| Efecto | `update public.empresas set autorizada_produccion = true, autorizada_en = coalesce(autorizada_en, now()) where id = new.empresa_id and organizacion_id = new.organizacion_id`, solo si la empresa no estaba ya autorizada con fecha |

**Por qué** (decisión del usuario, 2026-11-13): una empresa que se certificó fuera de
Boletéame ya está autorizada en el SII, pero el SII responde «sin trámite» a
`obtenerEstadoAutorizaEmp` (no P91), lo mismo que a una empresa que nunca postuló. Registrar
la resolución de **producción** equivale a declarar que la empresa ya está autorizada; si la
declaración es falsa, el SII rechaza igual los envíos de producción.

Reglas:

- **Nunca desmarca**, igual que P91 (`tg_certificacion_autorizada`): dejar la resolución sin
  vigencia, reemplazarla o borrarla no cambia `autorizada_produccion`. Una resolución de
  certificación no hace nada.
- **Idempotente**: con la empresa ya autorizada y con fecha, el `update` no toca la fila (no
  cambia `autorizada_en` ni dispara `trg_90_actualizado_en`).
- **Filtra por organización** (principio 2): `organizacion_id` de la resolución lo fija
  antes `trg_00_organizacion` desde la empresa, así que siempre calza.
- **Por qué `security definer`**: `tg_proteger_autorizacion` (`trg_05_proteger_autorizacion`
  en `empresas`) deja cambiar `autorizada_produccion` solo a `service_role` o con
  `current_user = postgres`. Quien registra la resolución es un administrador
  (`authenticated`, por `registrar_resolucion` o un `insert` con RLS); el trigger corre como
  `postgres`. Un `authenticated` sigue sin poder cambiar la columna a mano.
- **No toca `procesos_certificacion`**: la app deduce la autorización externa (empresa
  autorizada y proceso que no está en `autorizada`), `autorizacionExterna` en
  `leerAsistente` ([guía](../02-guias/certificacion-empresa.md#empresa-autorizada-fuera-de-boletéame)).

La migración además marca, una vez y de forma idempotente, las empresas que ya tuvieran una
resolución de producción vigente (al escribirla no había ninguna).

Pruebas: verificación de solo lectura `supabase/verificaciones/0009_autorizacion_externa.sql`
y simulación con `rollback` `rls-fase5-autorizacion-externa.sql`
([cómo](../05-pruebas/probar-el-esquema.md#7-simulación-de-la-autorización-externa-rls-fase5-autorizacion-externasql)).
