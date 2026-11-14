---
title: "Esquema: RLS y privilegios"
description: "Políticas por tabla, grants de columnas y funciones, y protección de campos del sistema."
keywords: [RLS, políticas, es_miembro, tiene_rol, es_admin, puede_emitir, comparte_organizacion, anon, service_role, grants de columnas, tg_proteger_autorizacion, tg_proteger_proceso, tokens_sii, sesiones_sii, registrar_certificado, registrar_resolucion, fijar_certificado_predeterminado, security definer, security invoker, grant execute]
related: ["03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §17"]
---

# Esquema: RLS y privilegios

> **Úsalo cuando:** necesitas modificar o auditar los permisos.

Base: §17 de `supabase_saas_sii.sql` (migración `0001`). Las migraciones posteriores
agregan funciones y tablas con sus propios grants (abajo, la `0005`; las demás en
[acceso por tabla](../03-api-reference/acceso-por-tabla.md) y en la referencia de RPC de cada fase).

## Reglas generales

- **RLS activo en las 33 tablas de `public`.** Una tabla sin política para una acción la
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
| `folios_anulados` | miembro | admin | — | — |
| `api_keys`, `webhooks` | admin | `crear_api_key()` / `crear_webhook()` | admin² | admin |
| `webhook_entregas` | admin | — | — | — |
| `suscripciones`, `uso_mensual`, `certificados`, `cafs`, `solicitudes_folios`, `envios`, `envio_estadisticas`, `consultas_envio`, `envio_rechazos`, `rcof`, `set_pruebas_casos`, `operaciones_sii` | miembro | backend | backend | backend |
| `tokens_sii`, `sesiones_sii` | backend | backend | backend | backend |

¹ Solo un `propietario` puede dar, cambiar o quitar el rol `propietario`; además,
`tg_proteger_ultimo_propietario` impide dejar la organización sin propietario.
² Solo las columnas concedidas (ver abajo).

## Grants de columnas

`revoke insert, update` sobre `api_keys`, `webhooks` e `invitaciones` para `authenticated`
(se crean con sus RPC), y luego:

| Tabla | Columnas que `authenticated` puede actualizar |
|---|---|
| `api_keys` | `nombre`, `revocada_en`, `expira_en` |
| `webhooks` | `url`, `eventos`, `activo` |

El resto (`clave_hash`, `secreto_secret_id`, …) no se puede cambiar desde la API.

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
