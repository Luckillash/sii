---
title: "Esquema: triggers y lógica"
description: "Cada trigger, su orden de ejecución y lo que hace."
keywords: [tg_resolucion_autoriza_produccion, trg_50_resolucion_autoriza_produccion, autorizada_produccion, autorizada_en, resoluciones, tg_proteger_autorizacion, tg_certificacion_autorizada, autorizada fuera de Boletéame, migración 0009]
related: ["02-guias/seguimiento-envios.md", "02-guias/certificacion-empresa.md", "04-objetos/objetos-certificacion.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/despliegue.md"]
source: ["supabase_saas_sii.sql §15", "supabase/migrations/0009_autorizacion_externa.sql"]
---

# Esquema: triggers y lógica

> **Úsalo cuando:** necesitas entender un efecto automático de la base.

Los triggers de un mismo evento corren en orden alfabético: por eso los nombres llevan un
prefijo numérico (`trg_00_…` primero, `trg_90_…` al final). Los `before` corren antes del
`with check` de RLS, así que lo que fijan (p. ej. `organizacion_id`) ya está cuando RLS evalúa.

## Triggers de la 0001 (§15 y §17)

### Transversales

| Trigger | Tablas | Cuándo | Qué hace |
|---|---|---|---|
| `trg_00_organizacion` (`tg_heredar_organizacion(padre, columna)`, `security definer`) | `resoluciones`, `empresa_certificados`, `cafs`, `solicitudes_folios`, `receptores`, `productos`, `envios`, `documentos`, `rcof`, `procesos_certificacion` (padre `empresas`); `folios_anulados` (`cafs`); `envio_estadisticas`, `consultas_envio`, `envio_rechazos` (`envios`); `documento_detalles` (`documentos`); `set_pruebas_casos` (`procesos_certificacion`) | `before insert or update` | Copia `organizacion_id` del padre: nadie puede colgar filas de otra organización. FK nula → error; padre inexistente → `foreign_key_violation` |
| `trg_90_actualizado_en` (`tg_actualizado_en`) | `perfiles`, `organizaciones`, `suscripciones`, `empresas`, `certificados`, `cafs`, `receptores`, `productos`, `envios`, `documentos`, `procesos_certificacion`, `webhooks` | `before update` | `actualizado_en = now()` |
| `trg_borrar_secretos` (`tg_borrar_secretos(columnas…)`, `security definer`) | `certificados` (`pfx_secret_id`, `clave_secret_id`), `cafs` (`caf_secret_id`), `webhooks` (`secreto_secret_id`) | `after delete` | Borra esos secretos de `vault.secrets`: no quedan huérfanos |

### Tenancy y plan

| Trigger | Tabla | Cuándo | Qué hace |
|---|---|---|---|
| `trg_nuevo_usuario` (`security definer`) | `auth.users` | `after insert` | Crea el `perfiles` con `correo` y `nombre` (de `raw_user_meta_data`); `on conflict do nothing` |
| `trg_proteger_ultimo_propietario` (`security definer`) | `miembros_organizacion` | `before update or delete` | Impide degradar o quitar al último `propietario`; se permite si la organización entera se está borrando (cascada) |
| `trg_10_limite_empresas` | `empresas` | `before insert` | `max_empresas` del plan vigente (`plan_vigente()`). Solo se revisa para quien puede escribir: a un no miembro lo rechaza RLS sin revelar el plan ajeno |
| `trg_10_limite_usuarios` | `miembros_organizacion` | `before insert` | `max_usuarios` en altas directas; `aceptar_invitacion()` revisa el cupo por su cuenta y `crear_organizacion()` agrega al primer miembro |

### Empresas y certificación

| Trigger | Tabla | Cuándo | Qué hace |
|---|---|---|---|
| `trg_05_proteger_autorizacion` | `empresas` | `before insert or update` | `autorizada_produccion` y `autorizada_en` solo los cambia `service_role` o una función `security definer` (ver [RLS y privilegios](rls-y-privilegios.md#campos-del-sistema-protegidos-por-triggers)) |
| `trg_05_proteger_proceso` | `procesos_certificacion` | `before insert or update` | `etapa`, `codigo_estado_sii`, `glosa_estado_sii` y `paso_sii` solo los cambia el sistema |
| `trg_10_certificacion_autorizada` (`security definer`) | `procesos_certificacion` | `before insert or update of codigo_estado_sii, etapa` | Al quedar autorizada (P91) marca la empresa (`autorizada_produccion`); nunca desmarca |

### Folios, documentos y envíos (Fases 6–8)

| Trigger | Tabla | Cuándo | Qué hace |
|---|---|---|---|
| `trg_10_caf_inicial` | `cafs` | `before insert` | `siguiente_folio = coalesce(siguiente_folio, folio_desde)` |
| `trg_10_validar_documento` | `documentos` | `before insert or update of folio, caf_id, ambiente, tipo_dte` | El CAF debe ser de la misma empresa, ambiente y tipo, y el folio estar en su rango; en producción, empresa autorizada (P91) y plan con `permite_produccion` |
| `trg_20_contar_uso` (`tg_contar_uso_documento`) | `documentos` | `before insert or update of folio` | Suma en `uso_mensual` cuando el documento recibe folio (no los borradores); las de producción se controlan contra `max_boletas_mes` |
| `trg_60_contar_uso` (`tg_contar_uso_otros`) | `cafs`, `envios` | `after insert` | Suma `folios_timbrados` y `envios` en `uso_mensual` |
| `trg_50_evento_documento` | `documentos` | `after update of estado`, si cambió | Encola un evento de webhook (`encolar_evento`) |
| `trg_50_envio_actualizado` | `envios` | `after update` de `estado_sii`, `incierto` o los contadores, si cambiaron | Lleva el estado del envío a sus documentos (`sincronizar_documentos_envio`) |
| `trg_10_envio_rechazo` (`security definer`) | `envio_rechazos` | `before insert` | Si falta `documento_id`, lo busca por empresa, ambiente, tipo y folio del envío |
| `trg_50_envio_rechazo_sincronizar` (`security definer`) | `envio_rechazos` | `after insert or update` | Llama a `sincronizar_documentos_envio(envio_id)` |

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

**Previsto:** `verificarAutorizacion` (Fase 5, migración `0010`) registrará la resolución
de producción que informa el SII (`ad_empresa2`) con service_role; este mismo trigger hace
la marca. Después la app fija `autorizada_en` en la fecha de autorización del SII, cosa que
`tg_proteger_autorizacion` le permite a service_role. El trigger no cambia
([guía](../02-guias/certificacion-empresa.md#verificar-la-autorización-en-el-sii-prevista)).

La migración además marca, una vez y de forma idempotente, las empresas que ya tuvieran una
resolución de producción vigente (al escribirla no había ninguna).

Pruebas: verificación de solo lectura `supabase/verificaciones/0009_autorizacion_externa.sql`
y simulación con `rollback` `rls-fase5-autorizacion-externa.sql`
([cómo](../05-pruebas/probar-el-esquema.md#7-simulación-de-la-autorización-externa-rls-fase5-autorizacion-externasql)).
