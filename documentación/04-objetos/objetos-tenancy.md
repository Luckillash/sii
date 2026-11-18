---
title: "Objetos: tenancy"
description: "Columnas de perfiles, organizaciones, miembros_organizacion, invitaciones, planes, suscripciones, uso_mensual, clientes_pago, pagos y eventos_pasarela."
keywords: [perfiles, organizaciones, miembros_organizacion, invitaciones, planes, suscripciones, uso_mensual, rol_miembro, estado_suscripcion, slug, token_hash, tema, ultima_organizacion, ultima_empresa, autoservicio, orden, clientes_pago, pagos, eventos_pasarela, cancelar_al_fin_periodo, sincronizada_en, suscripciones_externa_unica, Flow]
related: ["01-fundamentos/tenancy-y-roles.md", "03-api-reference/rpc-organizacion.md", "03-api-reference/acceso-por-tabla.md", "02-guias/planes-y-pagos.md"]
source: ["supabase_saas_sii.sql §3 §4", "supabase/migrations/0003_preferencias.sql", "supabase/migrations/0015_planes_comerciales.sql", "supabase/migrations/0016_pagos.sql"]
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

Catálogo (lo carga la `0001` y lo redefine la `0015_planes_comerciales`; no se edita desde
la app).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `codigo` | `text` único | `certificacion`, `pyme`, `contador`, `api`, `empresa` (y `emprendedor`, inactivo) |
| `nombre` | `text` | Texto visible |
| `precio_mensual_clp` | `integer` ≥ 0 | IVA incluido. Debe coincidir con el `amount` del plan en Flow (`boleteame-<codigo>`): si difiere, contratar y cambiar fallan |
| `max_empresas` | `integer` > 0 o `null` | `null` = sin límite (`tg_limite_empresas`) |
| `max_usuarios` | `integer` > 0 o `null` | Se aplica al aceptar la invitación y en altas directas (`P0001`) |
| `max_boletas_mes` | `integer` ≥ 0 o `null` | Cuota mensual de producción de **toda la organización** (bloqueo duro en `tg_contar_uso_documento`) |
| `permite_produccion` | `boolean` | `false` solo en `certificacion` |
| `incluye_api`, `incluye_webhooks` | `boolean` | Fase 11 |
| `activo` | `boolean` | La política `lectura` (`using (activo)`) oculta los inactivos a `anon` y `authenticated` |
| `autoservicio` | `boolean`, defecto `false` | `0015`. Se contrata desde Configuración → Plan con cobro por Flow. Los demás los asigna `service_role` |
| `orden` | `smallint`, defecto 0 | `0015`. Orden de la grilla en la UI y en la landing |
| `creado_en` | `timestamptz` | |

Grilla de la `0015` (PLAN-SAAS D5; **aplicada en producción el 2026-11-18**; reemplazó los
valores de la `0001`: `emprendedor` 9.990 · 1 · 2 · 500; `pyme` 24.990 · 3 empresas · 5
usuarios · 3.000 con API; `empresa` 79.990 sin límites):

| Código | Precio (IVA incl.) | Empresas | Usuarios | Boletas/mes | Producción | API/webhooks | `autoservicio` | `orden` | `activo` |
|---|--:|--:|--:|--:|:-:|:-:|:-:|--:|:-:|
| `certificacion` | 0 | 1 | 2 | 0 | no | no | no | 0 | sí |
| `pyme` | 14.990 | 1 | 3 | 1.000 | sí | no | sí | 1 | sí |
| `contador` | 49.990 | 15 | 10 | 10.000 | sí | no | sí | 2 | sí |
| `api` | 39.990 | 3 | 5 | 20.000 | sí | sí | sí | 3 | sí |
| `empresa` | 0 (a medida, sin precio público) | ∞ | ∞ | ∞ | sí | sí | no | 4 | sí |
| `emprendedor` | 9.990 | 1 | 2 | 500 | sí | no | no | 9 | **no** |

`emprendedor` no se borra porque `suscripciones.plan_id` lo referencia sin cascada.
`plan_vigente()` no filtra por `activo`: una organización en un plan inactivo conserva sus
límites, aunque la UI no lo vea (ver [trampas](../07-referencia/trampas-conocidas.md#pagos-y-suscripciones-fase-10)).

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
`propietario` y con una suscripción `prueba` del plan `certificacion`, sin `periodo_fin`
desde la `0015` (antes, `now() + 30 días`).

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
| `periodo_fin` | `timestamptz` | `null` = abierta (Certificación no tiene plazo). En una de Flow, el fin del período pagado |
| `proveedor_pago`, `id_externo` | `text` | Pasarela (D4: `flow`) y `subscriptionId` de Flow. Ojo: la columna es `proveedor_pago`; en las tablas nuevas de la `0016` se llama `proveedor` |
| `cancelar_al_fin_periodo` | `boolean`, defecto `false` | `0016`. Cancelación pedida en Flow; rige hasta `periodo_fin` |
| `sincronizada_en` | `timestamptz` | `0016`. Última lectura de Flow; el cron sincroniza primero las más antiguas (nulas primero) |
| `creado_en`, `actualizado_en` | `timestamptz` | |

Índice único `suscripciones_vigente_unica`: una sola suscripción en `prueba`, `activa` o
`morosa` por organización. `plan_vigente()` la resuelve (solo `prueba` y `activa`: una
`morosa` deja a la organización sin plan vigente).

Índice único parcial `suscripciones_externa_unica (proveedor_pago, id_externo) where
id_externo is not null` (`0016`). **Incluye las canceladas**: un id externo ya usado no se
puede volver a insertar, y `activar_suscripcion` rechaza con `22023` el id de una
suscripción cancelada (aviso tardío de Flow).

El cambio de plan lo hace siempre `activar_suscripcion()` (solo `service_role`): cancela la
vigente e inserta la nueva en una transacción, o actualiza la misma fila si es la misma
suscripción de Flow ([contrato](../03-api-reference/rpc-backend.md#activar_suscripcion)).
La mora (`activa` ↔ `morosa`), el plan, el período y `cancelar_al_fin_periodo` los
actualiza la sincronización con un `update` directo.

## `clientes_pago`

Cliente de la organización en la pasarela y tarjeta registrada (`0016`). Una fila por
organización. Solo la escribe el backend; la leen propietarios y administradores.

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` | `uuid` PK → `organizaciones` | Cascada |
| `proveedor` | `text` | `check (proveedor in ('flow'))` |
| `cliente_externo` | `text` (1–100) | `customerId` de Flow. Único con `proveedor` |
| `tarjeta_marca` | `text` (≤ 40) | `creditCardType` de Flow |
| `tarjeta_ultimos4` | `text` | `^[0-9]{4}$`. Nunca el número completo |
| `tarjeta_registrada_en` | `timestamptz` | |
| `plan_pendiente_id` | `uuid` → `planes` | Plan elegido antes de ir a Flow a registrar la tarjeta; el retorno lo usa y lo limpia |
| `plan_pendiente_por` | `uuid` → `auth.users` | Quién lo eligió; `on delete set null` |
| `plan_pendiente_en` | `timestamptz` | |
| `creado_en`, `actualizado_en` | `timestamptz` | `trg_90_actualizado_en` |

El retorno del registro de tarjeta llega sin cookies de sesión: la organización sale del
`customerId` (único por `(proveedor, cliente_externo)`) y el plan, de `plan_pendiente_id`.

## `pagos`

Importes (invoices) de la pasarela, sincronizados por el backend (`0016`). Un upsert por
`(proveedor, factura_externa)`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `organizacion_id` | `uuid` → `organizaciones` | Cascada |
| `suscripcion_id` | `uuid` → `suscripciones` | `on delete set null` |
| `proveedor` | `text` | `flow` |
| `factura_externa` | `text` (1–100) | `id` del invoice de Flow. Único con `proveedor` |
| `orden_externa` | `text` (≤ 100) | `flowOrder` del pago |
| `monto_clp` | `integer` ≥ 0 | |
| `estado` | `text` | `pendiente` (sin pagar, no vencido), `vencido` (pasó `vence_en`), `pagado`, `anulado` |
| `periodo_inicio`, `periodo_fin`, `vence_en` | `date` | Días de Flow (hora de Chile) |
| `pagado_en` | `timestamptz` | |
| `medio` | `text` (≤ 60) | Medio de pago informado por Flow, o `externo` |
| `enlace_pago` | `text` | `check (enlace_pago ~ '^https://')`. Link de pago de Flow para un importe impago |
| `intentos` | `integer` ≥ 0 | Reintentos de cobro de Flow |
| `error` | `text` (≤ 500) | `errorDescription` de Flow |
| `creado_en`, `actualizado_en` | `timestamptz` | `trg_90_actualizado_en` |

Índice `pagos_organizacion (organizacion_id, periodo_inicio desc nulls last)`. Flow manda el
comprobante de cada cobro al correo del pagador; la app no manda un correo propio de
comprobante.

## `eventos_pasarela`

Cada aviso recibido de la pasarela (`0016`): auditoría e idempotencia. **Solo
`service_role`** (sin políticas; `authenticated` y `anon` sin privilegios).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `proveedor` | `text` | `flow` |
| `tipo` | `text` | `registro` (retorno del registro de tarjeta) o `pago` (callback de los planes) |
| `token` | `text` (1–200) | El único dato que manda Flow; solo sirve con la llave secreta |
| `organizacion_id` | `uuid` → `organizaciones` | `on delete set null` |
| `estado` | `text` | `recibido` (defecto, en curso), `procesado`, `ignorado`, `fallido` |
| `intentos` | `integer` ≥ 1 | Sube al retomar un aviso fallido o abandonado |
| `datos` | `jsonb` | P. ej. `resultado`, `plan`, `suscripcion_externa` (el retorno la reusa para no crear dos suscripciones) |
| `error` | `text` (≤ 500) | |
| `recibido_en`, `procesado_en` | `timestamptz` | |

Único `(proveedor, tipo, token)`: el insert es el reclamo. Un aviso en `recibido` de hace
menos de 2 minutos se considera en curso; uno `fallido` o abandonado se retoma.

## `uso_mensual`

Contadores por mes calendario (hora de Chile) para cuotas y cobro; los escribe el backend.

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` | `uuid` → `organizaciones` | PK compuesta; cascada |
| `periodo` | `date` | PK compuesta; siempre día 1 |
| `boletas_produccion`, `boletas_certificacion`, `envios`, `folios_timbrados` | `integer` | Defecto 0 |
