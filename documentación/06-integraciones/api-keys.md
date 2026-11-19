---
title: "API keys de la API pública"
description: "Alcances, ambiente por prefijo, empresa, expiración, revocación, verificación por hash (autenticar_api_key) e idempotencia."
keywords: [API key, api_keys, crear_api_key, autenticar_api_key, sk_test_, sk_live_, prefijo, clave_hash, sha256, alcances, ALCANCES_OFRECIDOS, certificacion:gestionar, empresa_id, expira_en, revocada_en, ultimo_uso_en, plan_sin_api, Idempotency-Key, api_idempotencia, Fase 11]
related: ["03-api-reference/rpc-integraciones.md", "02-guias/api-publica.md", "06-integraciones/overview.md", "01-fundamentos/ambientes-y-credenciales.md"]
source: ["supabase_saas_sii.sql §14", "supabase/migrations/0018_api_webhooks.sql", "apps/web/src/lib/api-publica.ts", "apps/web/src/server/api-publica/autenticacion.ts", "apps/web/src/app/[org]/configuracion/api/"]
---

# API keys de la API pública

> **Úsalo cuando:** implementas o usas la autenticación por API key.

**Estado (2026-11-19).** Fase 11 desplegada en producción; `autenticar_api_key` y
`api_idempotencia` llegan con la migración `0018` (aplicada el 2026-11-19). Criterio de
aceptación cumplido el mismo día con una clave `sk_test_` de prueba, ya revocada (la API
responde 401 `clave_revocada`)
([registro](../02-guias/api-publica.md#criterio-de-aceptación-2026-11-19)).

## Crear

Configuración → API (solo propietario o administrador; plan con `incluye_api`). La Server
Action confirma la sesión con `getUser()` y llama con la sesión a
`crear_api_key(org, nombre, alcances, ambiente, empresa, expira_en)` (0001,
`security definer`, `es_admin`). La clave se muestra **una sola vez** en la UI.

| Campo | Valores | Notas |
|---|---|---|
| `ambiente` | `certificacion` → `sk_test_<64 hex>`; `produccion` → `sk_live_<64 hex>` | Producción solo si el plan la permite. El ambiente de cada petición lo fija la clave |
| `empresa_id` | una empresa o `null` | `null` = todas las de la organización (la petición indica `empresa`) |
| `alcances` | `documentos:leer`, `documentos:emitir`, `folios:leer`, `folios:solicitar`, `envios:leer` | Por defecto en la UI: `documentos:leer`, `documentos:emitir`, `envios:leer`. `certificacion:gestionar` está en el check de la base pero **reservado** (sin rutas) |
| `expira_en` | sin plazo, 30, 90 o 365 días | Vencida → `401 clave_vencida` |
| `prefijo` | 12 primeros caracteres | Lo único visible después (`sk_test_ab12…`) |
| `clave_hash` | SHA-256 en hex | La base nunca guarda la clave |

## Revocar

`update api_keys set revocada_en = now()` con la sesión (grant de columna: `nombre` y
`revocada_en`; la 0018 quitó `expira_en`). La siguiente petición responde `401 clave_revocada`.
**Revocar es definitivo:** el trigger `trg_10_api_key_sin_reactivar` (0018) impide volver
`revocada_en` a nulo y alargar o quitar `expira_en`, también con `service_role` (`22023`).
No se borran: `operaciones_sii.api_key_id` las referencia para la auditoría.

## Cómo se autentica una petición

1. `Authorization: Bearer <clave>`; sin cabecera → `401 no_autenticado`; formato distinto de
   `FORMATO_CLAVE` → `401 clave_invalida` sin ir a la base.
2. `autenticar_api_key(sha256_hex)` (0018, solo `service_role`) devuelve una fila con
   `api_key_id`, `organizacion_id`, `empresa_id`, `alcances`, `ambiente` y `motivo`:
   `null` (válida), `invalida`, `revocada`, `vencida` o `plan_sin_api` (en los rechazos,
   ids nulos). Actualiza `ultimo_uso_en` como máximo una vez por minuto.
3. El ambiente de la fila tiene que coincidir con el prefijo de la clave.
4. Cada ruta exige su alcance (`403 alcance_insuficiente`).
5. Después, todo corre con `service_role` filtrando por la organización de la clave.

La clave nunca va a logs ni a Sentry (`lib/sentry/depurar.ts` reemplaza `sk_(test|live)_…`
y `whsec_…`).

## Idempotencia

`POST /documentos` y `POST /documentos/lote` exigen `Idempotency-Key` (1 a 200 caracteres
ASCII visibles); `POST /folios/solicitudes` la exige con `nivel = timbrar`. La respuesta de
una petición terminada se guarda en `api_idempotencia` y se repite tal cual con
`Idempotent-Replayed: true`; la misma clave con otro cuerpo da `422 idempotencia_conflicto`
y, mientras la primera sigue en curso, `409 idempotencia_en_curso`. Algoritmo completo en
la [guía](../02-guias/api-publica.md#idempotencia).
