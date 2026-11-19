---
title: "Esquema: RLS y privilegios"
description: "Políticas por tabla, grants de columnas y funciones, y protección de campos del sistema."
keywords: [RLS, políticas, es_miembro, tiene_rol, es_admin, puede_emitir, comparte_organizacion, anon, service_role, grants de columnas, tg_proteger_autorizacion, tg_proteger_proceso, tokens_sii, sesiones_sii, registrar_certificado, registrar_resolucion, fijar_certificado_predeterminado, security definer, security invoker, grant execute, anular_folios, tg_caf_sin_traslape, migración 0011, folios_anulados, notificaciones, migración 0013, reclamar_notificacion, notificacion_cerrada, alertas_documentos_rechazados, alertas_envios_inciertos, alertas_certificados_por_vencer, migración 0016, clientes_pago, pagos, eventos_pasarela, activar_suscripcion, migración 0018, api_idempotencia, autenticar_api_key, reenviar_entrega_webhook, probar_webhook, rotar_secreto_webhook]
related: ["03-api-reference/acceso-por-tabla.md", "02-guias/planes-y-pagos.md"]
source: ["supabase_saas_sii.sql §17", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0016_pagos.sql", "supabase/migrations/0018_api_webhooks.sql"]
---

# Esquema: RLS y privilegios

> **Úsalo cuando:** necesitas modificar o auditar los permisos.

Base: §17 de `supabase_saas_sii.sql` (migración `0001`). Las migraciones posteriores
agregan funciones y tablas con sus propios grants (abajo, la `0005`; las demás en
[acceso por tabla](../03-api-reference/acceso-por-tabla.md) y en la referencia de RPC de cada fase).

## Reglas generales

- **RLS activo en las 37 tablas de `public`** (33 de la `0001` y 3 de la `0016`, aplicada el 2026-11-18; la `0018`, aplicada el 2026-11-19, suma `api_idempotencia`: 37). Una tabla sin política para una acción la
  niega a `authenticated`; `service_role` omite RLS.
- **Autoridad = RLS, no la UI.** La UI oculta acciones según el rol, pero la base decide.
- **Helpers** (`security definer`, con `execute` para `authenticated`):
  `es_miembro(org)`, `tiene_rol(org, roles[])`, `es_admin(org)` (propietario o administrador),
  `puede_emitir(org)` (admin o emisor) y `comparte_organizacion(usuario)`.
- **`anon`** solo lee los catálogos `tipos_dte`, `estados_sii` y `planes` (activos), y
  ejecuta `rut_valido` y `correo_sii_valido`. `revoke all on all tables ... from anon`.
- **Secretos fuera de la API:** `tokens_sii` y `sesiones_sii` tienen RLS sin políticas y
  `revoke all` a `anon` y `authenticated`; solo las usa el backend con `service_role`.
- **Funciones:** `revoke execute on all functions ... from public, anon, authenticated` y se
  vuelven a conceder una por una. `service_role` las ejecuta todas.

## Políticas por tabla (0001)

| Tabla | `select` | `insert` | `update` | `delete` |
|---|---|---|---|---|
| `tipos_dte`, `estados_sii` | todos (`anon` incluido) | — | — | — |
| `planes` | todos, si `activo` | — | — | — |
| `perfiles` | el propio o quien comparte organización | (trigger) | solo el propio | — |
| `organizaciones` | miembro | `crear_organizacion()` | admin | propietario |
| `miembros_organizacion` | miembro | admin¹ | admin¹ | uno mismo, o admin¹ |
| `invitaciones` | admin | `crear_invitacion()` | — | admin |
| `empresas`, `resoluciones`, `empresa_certificados`, `procesos_certificacion` | miembro | admin | admin | admin |
| `receptores`, `productos` | miembro | `puede_emitir` | `puede_emitir` | admin |
| `documentos` | miembro | `puede_emitir`, solo `borrador` sin folio | ídem | ídem, solo `borrador` |
| `documento_detalles` | miembro | `puede_emitir` si el documento es `borrador` | ídem | ídem |
| `folios_anulados` | miembro | admin (hasta la 0011; con ella, solo `anular_folios()` o backend) | — | — |
| `api_keys`, `webhooks` | admin | `crear_api_key()` / `crear_webhook()` | admin² | admin |
| `webhook_entregas` | admin | — | — | — |
| `suscripciones`, `uso_mensual`, `certificados`, `cafs`, `solicitudes_folios`, `envios`, `envio_estadisticas`, `consultas_envio`, `envio_rechazos`, `rcof`, `set_pruebas_casos`, `operaciones_sii` | miembro | backend | backend | backend |
| `tokens_sii`, `sesiones_sii` | backend | backend | backend | backend |
| `notificaciones` (migración 0013, aplicada el 2026-11-17) | miembro | backend (`reclamar_notificacion`) | backend | backend |
| `clientes_pago`, `pagos` (migración 0016, aplicada el 2026-11-18) | admin | backend | backend | backend |
| `eventos_pasarela` (migración 0016, aplicada el 2026-11-18) | backend | backend | backend | backend |

¹ Solo un `propietario` puede dar, cambiar o quitar el rol `propietario`; además,
`tg_proteger_ultimo_propietario` impide dejar la organización sin propietario.
² Solo las columnas concedidas (ver abajo).

## Grants de columnas

`revoke insert, update` sobre `api_keys`, `webhooks` e `invitaciones` para `authenticated`
(se crean con sus RPC), y luego:

| Tabla | Columnas que `authenticated` puede actualizar |
|---|---|
| `api_keys` | `nombre`, `revocada_en` (la 0001 también daba `expira_en`; la 0018 lo quita) |
| `webhooks` | `url`, `eventos`, `activo` |

El resto (`clave_hash`, `secreto_secret_id`, …) no se puede cambiar desde la API. Con la
migración 0018 (aplicada el 2026-11-19), el `update` de `url` además pasa por el check
`webhooks_url_permitida` (`23514`), y el secreto se cambia solo con `rotar_secreto_webhook`.

## Campos del sistema protegidos por triggers

Las políticas dejan a un admin editar la fila, pero estos triggers impiden cambiar a mano
lo que fija el SII o el backend (se omiten con `service_role` o `current_user = postgres`,
es decir, desde otra función `security definer`):

| Trigger | Tabla | Qué protege |
|---|---|---|
| `trg_05_proteger_autorizacion` (`tg_proteger_autorizacion`) | `empresas` | `autorizada_produccion` y `autorizada_en`: al insertar se fuerzan a `false`/`null`; cambiarlos lanza error (los fija P91 o, desde la `0009`, la resolución de producción) |
| `trg_05_proteger_proceso` (`tg_proteger_proceso`) | `procesos_certificacion` | `etapa`, `codigo_estado_sii`, `glosa_estado_sii`, `paso_sii`: al insertar, `borrador` y `null`; cambiarlos lanza error |

## Funciones con `execute` para `authenticated` (0001)

`rut_valido`, `correo_sii_valido`, `uuid_o_nulo`, `clasificar_envio` (las usan `check`,
dominios y columnas generadas), los 5 helpers de RLS, `crear_organizacion`,
`aceptar_invitacion`, `crear_invitacion`, `crear_api_key` y `crear_webhook`.

Solo backend (`service_role`): `asignar_folio`, `token_*`, `guardar_secreto`,
`leer_secreto`, `sincronizar_documentos_envio` y `encolar_evento` (la emisión firma con la
llave del CAF, que vive en Vault).

## Funciones de la migración 0005 (aplicada el 2026-11-13)

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `registrar_certificado(...)` | `security definer`, `search_path = ''` | solo `service_role` (`revoke` a `public`, `anon`, `authenticated`) | escribe en Vault (`guardar_secreto`) y en `certificados`, que no tiene políticas de escritura; no revisa membresía, así que solo la llama el backend tras validar rol y .pfx |
| `registrar_resolucion(uuid, ambiente_sii, integer, date)` | `security invoker`, `search_path = ''` | `authenticated`, `service_role` | corre con el RLS de quien llama (escritura de administradores en `resoluciones` y candado `for no key update` sobre `empresas`) |
| `fijar_certificado_predeterminado(uuid, uuid)` | `security invoker`, `search_path = ''` | `authenticated`, `service_role` | ídem, sobre `empresa_certificados` |

No agrega grants de tablas: `authenticated` ya tenía `select`/`insert`/`update` sobre
`empresas`, `resoluciones` y `empresa_certificados` (RLS decide las filas) y `execute`
sobre `es_admin`. `certificados` sigue sin políticas de escritura. Lo comprueba
`supabase/verificaciones/0005_certificados_resoluciones.sql` (comprobaciones 4–10 y 13).
Contratos en [RPC de organización](../03-api-reference/rpc-organizacion.md#empresa-resolución-y-certificado-predeterminado-migración-0005)
y [RPC del backend](../03-api-reference/rpc-backend.md#registrar_certificado-migración-0005).

## Funciones de la migración 0011 (aplicada el 2026-11-15)

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `anular_folios(uuid, integer, integer, text)` | `security definer`, `search_path = ''` | `authenticated`, `service_role` (`revoke` a `public`, `anon`) | escribe en `folios_anulados` y cierra el CAF en `cafs` (sin políticas de escritura); revisa por dentro el permiso: `service_role` o `es_admin` de la organización del CAF (`42501` a emisor y lector, `P0002` a otra organización) |
| `tg_caf_sin_traslape()` (trigger `trg_20_caf_sin_traslape` en `cafs`) | `security definer`, `search_path = ''` | nadie (`revoke` a `public`, `anon`, `authenticated`; los triggers no lo piden a quien dispara) | toma el candado de la empresa y ve todos los CAF sin depender del RLS de quien escribe |

No agrega políticas ni grants. **Quita** la política `alta` de `folios_anulados` (0001,
`insert` para `es_admin`), que dejaba a un administrador insertar folios anulados sueltos
sin las validaciones, el bloqueo ni el cierre del CAF de la RPC, y revoca a
`authenticated` `insert`, `update`, `delete` y `truncate` en esa tabla (los tenía por los
grants por defecto de Supabase; `truncate` no pasa por RLS). Queda la política `lectura`
(`es_miembro`) con `select`. `anular_folios` no los necesita (es `security definer`) y el
backend escribe con `service_role`. *Advisors* listará `anular_folios` en
`authenticated_security_definer_function_executable`: es esperado.
Lo comprueban `supabase/verificaciones/0011_folios.sql` (4–7, 10, 13 y 14) y
`rls-fase6-folios.sql` (12–15 y 26)
([contratos](../03-api-reference/rpc-backend.md#anular_folios-migración-0011)).

## Tabla y funciones de la migración 0013 (aplicada el 2026-11-17)

`notificaciones` (alertas por correo de la Fase 8):

- RLS activo con una sola política, `lectura` (`for select to authenticated using
  (es_miembro(organizacion_id))`): cualquier miembro, también un lector, ve los avisos de su
  organización.
- `revoke all` a `anon`; a `authenticated` se le revocan `insert`, `update`, `delete`,
  `truncate`, `references` y `trigger` (los tenía por los grants por defecto de Supabase) y
  queda `select`; `grant all` a `service_role`. Nadie escribe con su sesión.
- No está en `supabase_realtime`.

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `reclamar_notificacion(uuid, text, text, uuid, jsonb)` | `security definer`, `search_path = ''` | solo `service_role` (`revoke` a `public`, `anon`, `authenticated`) | insert/update atómico sobre la clave única; la llama el cron con el cliente de servicio |
| `notificacion_cerrada(text)` | `stable`, invoker, `search_path = ''` | solo `service_role` | la usan las tres de candidatos |
| `alertas_documentos_rechazados(timestamptz, integer)`, `alertas_envios_inciertos(timestamptz, integer)`, `alertas_certificados_por_vencer(integer)` | `stable`, invoker, `search_path = ''` | solo `service_role` | leen `documentos`, `envios` y `v_certificados_estado` de todas las organizaciones (service_role salta RLS); un administrador con su sesión recibe `42501` |

*Advisors* no debería listar ninguna en `authenticated_security_definer_function_executable`
(ninguna la ejecuta `authenticated`). Lo comprueban
`supabase/verificaciones/0013_notificaciones.sql` (7, 8, 11, 12 y 15) y
`rls-fase8-notificaciones.sql` (15–20 y 26), que en producción dieron 18/18 y 26/26 el
2026-11-17 ([contratos](../03-api-reference/rpc-backend.md#notificaciones-migración-0013)).

## Tablas y función de la migración 0016 (aplicada el 2026-11-18)

Pagos con Flow (Fase 10). **Aplicada en producción el 2026-11-18**, antes del deploy de la
fase.

| Tabla | RLS y política | Privilegios |
|---|---|---|
| `clientes_pago` | activo; `lectura` `for select to authenticated using (es_admin(organizacion_id))` | `revoke all` a `anon` y `authenticated`; `grant select` a `authenticated`; `grant all` a `service_role` |
| `pagos` | activo; `lectura` igual, con `es_admin` | igual que `clientes_pago` |
| `eventos_pasarela` | activo, **sin políticas** | `revoke all` a `anon` y `authenticated`; `grant all` a `service_role` (como `tokens_sii`) |

- La lectura es de **administradores**, no de miembros: la tarjeta (marca y últimos 4) y
  los cobros son datos de facturación. Un emisor o un lector recibe 0 filas, sin error.
- Nadie escribe con su sesión: todo lo escribe `server/pagos/` con `service_role`.
- Ninguna de las tres está en `supabase_realtime`.
- La `0016` también agrega columnas a `suscripciones` (`cancelar_al_fin_periodo`,
  `sincronizada_en`), que siguen con la política de la 0001 (lectura para miembros,
  escritura del backend).

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `activar_suscripcion(uuid, uuid, estado_suscripcion, text, text, timestamptz, timestamptz)` | `security definer`, `search_path = ''` | solo `service_role` (`revoke` a `public`, `anon`, `authenticated`) | cancela la suscripción vigente e inserta la nueva en una transacción, con candado sobre la organización; no revisa membresía: la llama el backend después del retorno de Flow o de la sincronización |

La `0015` no cambia políticas ni privilegios: `crear_organizacion` se reemplaza con
`create or replace`, que conserva sus grants (la verificación 0015, comprobación 8, lo
revisa). La política `lectura` de `planes` (`using (activo)`) ya ocultaba los planes
inactivos: con la 0015, `emprendedor` deja de verse para `anon` y `authenticated`.

*Advisors* (2026-11-18) lista `rls_enabled_no_policy` en `eventos_pasarela` (INFO,
esperado) y no lista `activar_suscripcion` como ejecutable por `anon` ni `authenticated`.
Lo comprueban `supabase/verificaciones/0016_pagos.sql` (11–13 y 18) y
`rls-fase10-pagos.sql` (18 y 22–28): 20/20 y 30/30 en producción el 2026-11-18 (y en PGlite)
([contrato](../03-api-reference/rpc-backend.md#activar_suscripcion-migración-0016)).

## Tabla y funciones de la migración 0018 (aplicada el 2026-11-19)

API pública y webhooks (Fase 11). Se aplicó antes del deploy de la fase.

| Tabla | RLS y política | Privilegios |
|---|---|---|
| `api_idempotencia` | activo, **sin políticas** | `revoke all` a `anon` y `authenticated`; `grant all` a `service_role` (como `eventos_pasarela`) |

`api_keys`, `webhooks` y `webhook_entregas` no cambian de políticas (lectura `es_admin`;
edición de columnas permitidas en `api_keys` y `webhooks`). En `api_keys` la 0018 quita
`expira_en` del grant de `authenticated` (queda `nombre` y `revocada_en`) y agrega el
trigger `trg_10_api_key_sin_reactivar` (todos los roles): revocar es definitivo y la
expiración no se alarga ni se quita (`22023`). Ninguna de las
cuatro está en `supabase_realtime`.

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `autenticar_api_key(text)` | `security definer`, `search_path = ` | solo `service_role` | lee `api_keys` por hash y escribe `ultimo_uso_en`; la llama la API pública, sin sesión |
| `reclamar_idempotencia(uuid, text, text, text, uuid, integer)`, `terminar_idempotencia(uuid, text, integer, jsonb, uuid)`, `soltar_idempotencia(uuid, text, uuid)` | ídem | solo `service_role` | escriben `api_idempotencia`; la API filtra por la organización de la clave |
| `reclamar_entregas_webhook(integer, integer)`, `cerrar_entrega_webhook(bigint, integer, boolean, integer, text, boolean)` | ídem | solo `service_role` | el cron toma y cierra entregas de todas las organizaciones |
| `reenviar_entrega_webhook(bigint)`, `probar_webhook(uuid)`, `rotar_secreto_webhook(uuid)` | ídem | `authenticated` y `service_role` (`revoke` a `public`, `anon`) | las llama el administrador con su sesión; revisan por dentro `service_role` o `es_admin` (`P0002` a otra organización, `42501` a un miembro sin serlo); escriben `webhook_entregas` o Vault, sin políticas de escritura |

`encolar_evento` y `tg_evento_documento` se reemplazan con `create or replace`, que
conserva sus privilegios (`encolar_evento` sigue solo para `service_role`).

*Advisors* debería listar `rls_enabled_no_policy` en `api_idempotencia` (INFO, esperado) y
las tres del panel en `authenticated_security_definer_function_executable` (WARN, esperado,
como `anular_folios`); ninguna de las otras seis. Lo comprueban
`supabase/verificaciones/0018_api_webhooks.sql` (3, 9 y 10) y `rls-fase11-api.sql` (8, 17,
31, 35, 36 y 39) y la 23 de la verificación (trigger y grant de `api_keys`), 23/23 y 39/39 en
PGlite
([contratos](../03-api-reference/rpc-integraciones.md)).
