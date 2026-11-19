---
title: "Esquema: triggers y lógica"
description: "Cada trigger, su orden de ejecución y lo que hace."
keywords: [tg_resolucion_autoriza_produccion, trg_50_resolucion_autoriza_produccion, autorizada_produccion, autorizada_en, resoluciones, tg_proteger_autorizacion, tg_certificacion_autorizada, autorizada fuera de Boletéame, migración 0009, trg_20_caf_sin_traslape, tg_caf_sin_traslape, 23P01, traslape, migración 0011, tg_validar_documento, folio anulado, for key share, migración 0012, sincronizar_documentos_envio, trg_50_envio_actualizado, trg_50_envio_rechazo_sincronizar, orden de escritura, seguimiento, Fase 8, documento.aceptado, notificaciones, encolar_evento, tg_evento_documento, migración 0018, incluye_webhooks, clave_idempotencia]
related: ["02-guias/seguimiento-envios.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md", "04-objetos/objetos-certificacion.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/despliegue.md"]
source: ["supabase_saas_sii.sql §15", "supabase/migrations/0009_autorizacion_externa.sql", "supabase/migrations/0011_folios.sql", "supabase/migrations/0012_folio_anulado.sql", "supabase/migrations/0013_notificaciones.sql", "apps/web/src/server/seguimiento/persistencia.ts", "supabase/migrations/0018_api_webhooks.sql"]
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
| `trg_90_actualizado_en` (`tg_actualizado_en`) | `perfiles`, `organizaciones`, `suscripciones`, `empresas`, `certificados`, `cafs`, `receptores`, `productos`, `envios`, `documentos`, `procesos_certificacion`, `webhooks`; también `notificaciones` (migración 0013, aplicada el 2026-11-17) | `before update` | `actualizado_en = now()`. Lo usan las ventanas de 48 h de las alertas y el Realtime de la Fase 8 para quedarse con el estado más nuevo |
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
| `trg_20_caf_sin_traslape` (`tg_caf_sin_traslape`, `security definer`; migración 0011, **aplicada el 2026-11-15**) | `cafs` | `before insert or update of folio_desde, folio_hasta, ambiente, tipo_dte, empresa_id` | Toma `for no key update` sobre la empresa y rechaza con `23P01` un rango que se cruza con otro CAF de la misma empresa, ambiente y tipo, en cualquier estado. No lo disparan `asignar_folio`, `anular_folios` ni el enlace de `solicitud_id` ([contrato](../03-api-reference/rpc-backend.md#trg_20_caf_sin_traslape-migración-0011)) |
| `trg_10_validar_documento` (`tg_validar_documento`, `security definer`; reemplazada por la migración 0012, **aplicada el 2026-11-15**) | `documentos` | `before insert or update of folio, caf_id, ambiente, tipo_dte` | El CAF debe ser de la misma empresa, ambiente y tipo, y el folio estar en su rango; en producción, empresa autorizada (P91) y plan con `permite_produccion`. Con la 0012: lee el CAF con `for key share` y, si el documento fija su folio (INSERT con folio, o UPDATE que cambia `folio` o `caf_id`), rechaza con `23514` un folio que esté en `folios_anulados` ([abajo](#tg_validar_documento-migración-0012)) |
| `trg_20_contar_uso` (`tg_contar_uso_documento`) | `documentos` | `before insert or update of folio` | Suma en `uso_mensual` cuando el documento recibe folio (no los borradores); las de producción se controlan contra `max_boletas_mes` |
| `trg_60_contar_uso` (`tg_contar_uso_otros`) | `cafs`, `envios` | `after insert` | Suma `folios_timbrados` y `envios` en `uso_mensual` |
| `trg_50_evento_documento` (`tg_evento_documento`, `security definer`) | `documentos` | `after update of estado`, si cambió | Encola `documento.<estado>` (solo `aceptado`, `aceptado_con_reparos`, `rechazado` e `incierto`) con `encolar_evento`. Con la migración 0018 (**aplicada el 2026-11-19**) los datos llevan además `estado`, `origen` y `clave_idempotencia`, y no se encola nada si el plan no incluye webhooks ([abajo](#webhooks-encolar_evento-y-tg_evento_documento-migración-0018)) |
| `trg_50_envio_actualizado` | `envios` | `after update` de `estado_sii`, `incierto` o los contadores, si cambiaron (no `consultas` ni `ultima_consulta_en`) | Lleva el estado del envío a sus documentos (`sincronizar_documentos_envio`) y encola `envio.actualizado` |
| `trg_10_envio_rechazo` (`security definer`) | `envio_rechazos` | `before insert` | Si falta `documento_id`, lo busca por empresa, ambiente, tipo y folio del envío |
| `trg_50_envio_rechazo_sincronizar` (`security definer`) | `envio_rechazos` | `after insert or update` | Llama a `sincronizar_documentos_envio(envio_id)` |

### Cómo los aprovecha el seguimiento (Fase 8)

`sincronizar_documentos_envio` decide el estado de cada documento con la clasificación del
envío y, con `EPR`, con lo que haya en `envio_rechazos` **en ese momento**
([contrato](../03-api-reference/rpc-backend.md#sincronizar_documentos_envio)). El
seguimiento (`guardarRespuesta`) escribe en este orden:

1. `envio_estadisticas` (sin triggers);
2. `envio_rechazos`: `trg_10_envio_rechazo` enlaza el documento y
   `trg_50_envio_rechazo_sincronizar` sincroniza con el envío **todavía en su estado
   anterior** (en proceso o pendiente), así que los documentos quedan `enviado` o sin
   cambio;
3. `envios`: si cambian estado o conteos, `trg_50_envio_actualizado` sincroniza ya con los
   rechazos guardados y encola `envio.actualizado`; `trg_50_evento_documento` encola
   `documento.<estado>` por cada documento que cambia;
4. `consultas_envio` (sin triggers).

Con el orden inverso, un `EPR` con rechazos dejaría primero todos los documentos `aceptado`
y encolaría webhooks `documento.aceptado` falsos (comprobado en PGlite). Un intento fallido
solo cambia `consultas` y `ultima_consulta_en`, que no disparan `trg_50_envio_actualizado`
([seguimiento](../02-guias/seguimiento-envios.md#qué-se-escribe-por-consulta-y-en-qué-orden)).

## `tg_validar_documento` (migración 0012)

**Estado: aplicada en producción el 2026-11-15** (verificación 7/7 y simulación 9/9;
[despliegue](despliegue.md#fase-7-migración-0012)).

Cierra el riesgo anotado en la Fase 6: `asignar_folio` entrega el folio en una llamada y el
documento se inserta, o se le fija el folio, en otra; entre medio un administrador podía
anular ese folio con `anular_folios` (caso a, sin documento todavía) y el documento entraba
igual. `create or replace` con el cuerpo de la 0001 más dos cambios:

1. La lectura del CAF es `select … for key share`, **antes** de mirar `folios_anulados`.
2. Si el documento fija su folio (INSERT con folio, o UPDATE con `folio` o `caf_id`
   distintos), y `(caf_id, folio)` está en `folios_anulados`: `23514` «El folio N está
   anulado: no se puede usar en un documento», pista «Pide otro folio (asignar_folio) y
   vuelve a armar el documento.».

Un UPDATE que no cambia folio ni CAF no se revisa: el `estado = 'anulado'` que hace
`envio-set.ts` después de anular los folios del set (ni siquiera dispara el trigger) o uno
que repite el mismo folio en el `set`.

**Por qué el candado va antes de la lectura** (READ COMMITTED, el nivel de PostgREST):
`for key share` choca con el `for update` que toman `anular_folios` y `asignar_folio` sobre
el CAF (no con el `update` de `siguiente_folio`, ni con otro `for key share`: dos emisiones
del mismo CAF no se esperan entre sí).

- Si `anular_folios` llegó primero, el trigger espera su commit y la sentencia siguiente
  (la lectura de `folios_anulados`) toma una foto nueva que ya ve la anulación: rechazo.
- Si el documento llegó primero, `anular_folios` espera su commit y su búsqueda de
  documentos ve el documento: `23503`.

Sin el candado, las dos podían leer antes del commit de la otra y pasar. PGlite (una
conexión) no prueba la concurrencia; `rls-fase7-folio-anulado.sql` prueba la regla en
secuencia. El trigger, el dueño, `security definer`, `search_path` y los privilegios no
cambian.

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

`verificarAutorizacion` (Fase 5, migración `0010`) registra la resolución de producción que
informa el SII (`ad_empresa2`) con service_role; este mismo trigger hace la marca. Después,
si la empresa no estaba autorizada, la app fija `autorizada_en` en la fecha de autorización
del SII (medianoche de Chile), cosa que `tg_proteger_autorizacion` le permite a
service_role. El trigger no cambia
([guía](../02-guias/certificacion-empresa.md#verificar-la-autorización-en-el-sii)).

La migración además marca, una vez y de forma idempotente, las empresas que ya tuvieran una
resolución de producción vigente (al escribirla no había ninguna).

Pruebas: verificación de solo lectura `supabase/verificaciones/0009_autorizacion_externa.sql`
y simulación con `rollback` `rls-fase5-autorizacion-externa.sql`
([cómo](../05-pruebas/probar-el-esquema.md#7-simulación-de-la-autorización-externa-rls-fase5-autorizacion-externasql)).

## Webhooks: `encolar_evento` y `tg_evento_documento` (migración 0018)

**Escrita, pendiente de aplicar** (Fase 11, antes del deploy). Las dos funciones se
reemplazan con `create or replace` (los triggers y los privilegios no cambian):

- `encolar_evento(org, evento, payload)` inserta, igual que en la 0001, una fila en
  `webhook_entregas` por cada webhook **activo** de la organización suscrito al evento,
  pero ahora solo si `plan_vigente(org).incluye_webhooks` (hoy los planes `api` y
  `empresa`). Sin plan con webhooks, los triggers de documentos, envíos y certificación y
  `folios.por_agotarse` no dejan entregas. Lo que ya estaba en cola cuando la organización
  bajó de plan lo descarta `reclamar_entregas_webhook` con el motivo «El plan vigente no
  incluye webhooks.».
- `tg_evento_documento` arma los mismos datos que en la 0001 (`documento_id`,
  `empresa_id`, `ambiente`, `tipo_dte`, `folio`, `mnt_total`, `envio_id`) más `estado`,
  `origen` (`panel`, `api`, `set_pruebas`) y `clave_idempotencia` (la `Idempotency-Key`
  de la boleta emitida por la API, o `null`), para que un integrador asocie el
  `documento.aceptado` con su petición.

No hay triggers nuevos en la 0018. La entrega la hace `/api/cron/webhooks` con
`reclamar_entregas_webhook` y `cerrar_entrega_webhook`
([RPC](../03-api-reference/rpc-integraciones.md#entregas-de-webhooks-0018)).

Pruebas: `supabase/verificaciones/0018_api_webhooks.sql` (18 y 19) y
`rls-fase11-api.sql` (20 y 21)
([cómo](../05-pruebas/probar-el-esquema.md#14-simulación-de-la-api-pública-y-los-webhooks-de-la-fase-11-rls-fase11-apisql)).
