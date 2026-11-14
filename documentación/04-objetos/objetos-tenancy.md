---
title: "Objetos: tenancy"
description: "Columnas de perfiles, organizaciones, miembros_organizacion, invitaciones, planes, suscripciones y uso_mensual."
keywords: [perfiles, organizaciones, miembros_organizacion, invitaciones, planes, suscripciones, uso_mensual, rol_miembro, estado_suscripcion, slug, token_hash, tema, ultima_organizacion, ultima_empresa]
related: ["01-fundamentos/tenancy-y-roles.md", "03-api-reference/rpc-organizacion.md", "03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §3 §4", "supabase/migrations/0003_preferencias.sql"]
---

# Objetos: tenancy

> **Úsalo cuando:** necesitas los campos de una tabla de tenancy.

La organización es el *tenant*: todo dato de negocio cuelga de `organizacion_id` y RLS
lo filtra por membresía. Las reglas de roles están en
[tenancy y roles](../01-fundamentos/tenancy-y-roles.md); quién lee y escribe cada tabla, en
[acceso por tabla](../03-api-reference/acceso-por-tabla.md).

## Enumeraciones

| Tipo | Valores |
|---|---|
| `rol_miembro` | `propietario`, `administrador`, `emisor`, `lector` |
| `estado_suscripcion` | `prueba`, `activa`, `morosa`, `cancelada` |

## `planes`

Catálogo (lo carga la `0001`; no se edita desde la app).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `codigo` | `text` único | `certificacion`, `emprendedor`, `pyme`, `empresa` |
| `nombre` | `text` | Texto visible |
| `precio_mensual_clp` | `integer` ≥ 0 | |
| `max_empresas` | `integer` > 0 o `null` | `null` = sin límite (`tg_limite_empresas`) |
| `max_usuarios` | `integer` > 0 o `null` | Se aplica al invitar y al aceptar (`P0001`) |
| `max_boletas_mes` | `integer` ≥ 0 o `null` | Cuota mensual de producción |
| `permite_produccion` | `boolean` | `false` solo en `certificacion` |
| `incluye_api`, `incluye_webhooks` | `boolean` | Fase 11 |
| `activo` | `boolean` | |
| `creado_en` | `timestamptz` | |

| Código | Precio | Empresas | Usuarios | Boletas/mes | Producción | API/webhooks |
|---|---|---|---|---|---|---|
| `certificacion` | 0 | 1 | 2 | 0 | no | no |
| `emprendedor` | 9.990 | 1 | 2 | 500 | sí | no |
| `pyme` | 24.990 | 3 | 5 | 3.000 | sí | sí |
| `empresa` | 79.990 | ∞ | ∞ | ∞ | sí | sí |

## `perfiles`

Una fila por usuario de Auth, creada por `tg_nuevo_usuario`; se borra en cascada con el usuario.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK → `auth.users` | `on delete cascade` |
| `nombre`, `correo` | `text` | |
| `rut` | `rut` (dominio) | Opcional |
| `tema` | `text` | `sistema` (defecto), `claro`, `oscuro` — migración `0003` |
| `ultima_organizacion` | `uuid` → `organizaciones` | `on delete set null` — `0003` |
| `ultima_empresa` | `uuid` → `empresas` | `on delete set null` — `0003` |
| `creado_en`, `actualizado_en` | `timestamptz` | |

## `organizaciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `nombre` | `text` | No vacío |
| `slug` | `text` único | `^[a-z0-9][a-z0-9-]{1,62}$`; va en la URL `/[org]` |
| `creado_por` | `uuid` → `auth.users` | `on delete set null` |
| `creado_en`, `actualizado_en` | `timestamptz` | |

Se crea solo con `crear_organizacion(nombre, slug)`, que deja a quien llama como
`propietario` y con una suscripción `prueba` del plan `certificacion`.

## `miembros_organizacion`

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` | `uuid` → `organizaciones` | PK compuesta; cascada |
| `usuario_id` | `uuid` → `auth.users` | PK compuesta; cascada; índice propio |
| `rol` | `rol_miembro` | Defecto `lector` |
| `creado_en` | `timestamptz` | |

`tg_proteger_ultimo_propietario` impide degradar o quitar al último `propietario` (`P0001`).

## `invitaciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `organizacion_id` | `uuid` → `organizaciones` | Cascada |
| `correo` | `text` | En minúsculas; debe calzar con el de quien acepta |
| `rol` | `rol_miembro` | Nunca `propietario` |
| `token_hash` | `text` único | SHA-256 hex del token del enlace; el token no se guarda |
| `invitado_por` | `uuid` → `auth.users` | `on delete set null` |
| `expira_en` | `timestamptz` | Defecto `now() + 7 días` |
| `aceptada_en` | `timestamptz` | `null` = pendiente; el token es de un solo uso |
| `creado_en` | `timestamptz` | |

Índice único `invitaciones_pendiente_unica (organizacion_id, correo) where aceptada_en is null`.
Flujo: `crear_invitacion()` → correo Resend → `/invitacion/[token]` → `ver_invitacion()` /
`aceptar_invitacion()`. Desde la `0004`, una organización sin suscripción vigente (p. ej.
`morosa` sin cupo) no acepta miembros.

## `suscripciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `organizacion_id` | `uuid` → `organizaciones` | Cascada |
| `plan_id` | `uuid` → `planes` | |
| `estado` | `estado_suscripcion` | Defecto `prueba` |
| `periodo_inicio` | `timestamptz` | |
| `periodo_fin` | `timestamptz` | `null` = abierta |
| `proveedor_pago`, `id_externo` | `text` | Pasarela (D4, Fase 10) |
| `creado_en`, `actualizado_en` | `timestamptz` | |

Índice único `suscripciones_vigente_unica`: una sola suscripción en `prueba`, `activa` o
`morosa` por organización. `plan_vigente()` la resuelve.

## `uso_mensual`

Contadores por mes calendario (hora de Chile) para cuotas y cobro; los escribe el backend.

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` | `uuid` → `organizaciones` | PK compuesta; cascada |
| `periodo` | `date` | PK compuesta; siempre día 1 |
| `boletas_produccion`, `boletas_certificacion`, `envios`, `folios_timbrados` | `integer` | Defecto 0 |
