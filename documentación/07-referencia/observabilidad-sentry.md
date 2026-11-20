---
title: "Observabilidad: inventario de Sentry y alertas por crear"
description: "Qué hay hoy en Sentry (luckillash/sii-web): 4 cron monitors sin alerta conectada, ninguna regla de alerta de issues ni de métricas propia y ningún tablero propio. Qué etiquetas y niveles manda el código de verdad, y la especificación exacta de cada alerta y del tablero que faltan para cumplir §4.8 del plan (transporte por host del SII, incierto, verificación fallida, 5xx de la API pública, cron que no corre)."
keywords: [Sentry, observabilidad, alertas, cron monitors, cron-seguimiento, cron-alertas, cron-webhooks, cron-suscripciones, monitor_check_in_failure, detectors, workflows, issue alert, metric alert, tablero, dashboard, host_sii, resultado, operacion_sii, ambiente, organizacion, empresa, api_publica_ruta, transporte, incierto, verificacion_fallida, envio_sin_cerrar, failureIssueThreshold, checkinMargin, SENTRY_LECTURA_TOKEN, alerts:write, event.type:default, Fase 13]
related: ["07-referencia/runbooks.md", "01-fundamentos/errores-y-resultados.md", "02-guias/seguimiento-envios.md", "02-guias/api-publica.md", "07-referencia/checklist-produccion.md"]
source: ["PLAN-SAAS.md §4.8 y Fase 13", "apps/web/src/instrumentation.ts", "apps/web/src/lib/sentry/opciones.ts", "apps/web/src/server/sii/operacion.ts", "apps/web/src/server/sii/errores.ts", "apps/web/src/server/api-publica/manejar.ts", "apps/web/src/server/api-publica/lote.ts", "apps/web/src/server/cron/autorizacion.ts", "apps/web/src/app/api/cron/", "apps/web/src/server/seguimiento/cron.ts", "apps/web/src/server/webhooks/dependencias.ts", "API de Sentry (solo lectura), 2026-11-19"]
---

# Observabilidad: inventario de Sentry y alertas por crear

> **Úsalo cuando:** vas a crear o revisar las alertas y tableros de Sentry, o quieres
> saber qué etiqueta filtra qué evento.

Proyecto `luckillash/sii-web` (id `4512419768107008`). El inventario se hizo el 2026-11-19
con la API de Sentry y `SENTRY_LECTURA_TOKEN`, **solo lectura**. Nada se creó ni se cambió.

## Inventario (2026-11-19)

**Token.** `SENTRY_LECTURA_TOKEN` tiene los alcances `event:read`, `org:read` y
`project:read`: no tiene `alerts:read` (por eso `GET /projects/…/rules/` y
`/organizations/…/alert-rules/` responden 404) ni `alerts:write`. `SENTRY_AUTH_TOKEN` es el
token del build (source maps) y la API le responde 403. **No hay token de escritura de
alertas**: para crearlas por API hay que generar uno con `alerts:write` (más `org:read` y
`project:read`). Si no, todo se crea en la UI. Lo que sigue se leyó por los endpoints del
motor nuevo de alertas (`/organizations/luckillash/detectors/` y `/workflows/`), que sí
responden con ese token y reflejan también las reglas clásicas.

### Cron monitors

Los cuatro los crea el SDK con su primer check-in (`Sentry.withMonitor` en
`conMonitorCron`, `server/cron/autorizacion.ts`; `isUpserting: true`):

| Monitor | Horario (UTC) | `max_runtime` | `checkin_margin` | Umbral de falla / recuperación | Estado en *production* | Alerta conectada |
|---|---|---|---|---|---|---|
| `cron-seguimiento` | `*/5 * * * *` | 5 min | 2 min | por defecto (1 / 1) | `ok` (último 21:00) | **ninguna** |
| `cron-alertas` | `*/10 * * * *` | 2 min | 2 min | por defecto (1 / 1) | `ok` (último 21:00) | **ninguna** |
| `cron-webhooks` | `* * * * *` | 2 min | 2 min | por defecto (1 / 1) | `ok` (último 21:04) | **ninguna** |
| `cron-suscripciones` | `41 * * * *` | 3 min | 2 min | por defecto (1 / 1) | `ok` (último 20:41) | **ninguna** |

Cada monitor tiene su *detector* `monitor_check_in_failure` (ids `10986825`, `10986913`,
`11002356` y `10997674`) con `workflowIds: []`: una corrida perdida o fallida abre un issue
de categoría *Crons*, pero **no hay ninguna automatización conectada que avise**. La regla
por defecto «Send a notification for high priority issues» está conectada solo al detector
*Issue Stream*; no está comprobado que cubra los issues de cron. Sin muteos ni incidentes
activos.

### Reglas de alerta

| Automatización (workflow) | Qué hace | ¿Sirve para §4.8? |
|---|---|---|
| «Send a notification for high priority issues» (`6334663`, creada con el proyecto) | correo a los dueños del issue (si no hay, a los miembros activos) cuando aparece un issue nuevo de prioridad alta o uno existente pasa a alta; todos los ambientes | solo de rebote: avisa la **primera** vez que aparece cada issue (ver [agrupación](#cómo-agrupa-sentry-estos-eventos)) |
| «Send a notification when pull requests are ready» (`6334628`) | actividad de Seer | no |

No hay detectores de métricas (`metric_issue`): **ninguna alerta de métricas**. Tampoco
reglas propias de issues.

### Tableros

20 tableros, todos *prebuilt* de Sentry (Backend Overview, Next.js Overview, etc.).
**Ningún tablero propio.**

### Eventos recibidos hasta hoy

4 issues: los tres errores de prueba de la Fase 0 (resueltos) y un `NetworkError` del
navegador (16-11). Las etiquetas `host_sii` y `api_publica_ruta` todavía no existen en el
proyecto porque no ha habido ningún `transporte` ni 5xx real; una regla con esas etiquetas
se puede crear igual (el filtro es texto). Ambientes: `production` y `development`.

## Qué manda el código

Inicialización (`lib/sentry/opciones.ts`): `environment` = `NEXT_PUBLIC_VERCEL_ENV`
(`production` en Vercel), `release` = SHA del commit, `sendDefaultPii: false`, trazas al
10 % en producción y depuración de secretos en `beforeSend`, `beforeSendSpan` y
`beforeBreadcrumb`. `onRequestError = Sentry.captureRequestError` (`instrumentation.ts`)
captura las excepciones no manejadas de rutas y Server Components.

### Operaciones con el SII (`server/sii/operacion.ts`, `registrarResultado`)

Etiquetas de todo evento de operación: `organizacion` (uuid), `empresa` (uuid, si hay),
`ambiente` (`certificacion` | `produccion`, el del SII, **no** el de Sentry),
`operacion_sii` (`emitir`, `seguimiento`, `consultar_envio`, `solicitar_folios`,
`postular`, `declarar`, `enviar_set`…) y `resultado`. Usuario solo por id.

| `resultado` (código) | Qué llega | Nivel | Etiqueta extra | Mensaje |
|---|---|---|---|---|
| `incierto` (6) | `captureMessage` | `error` | — | `Operación SII <op> terminó en incierto` |
| `verificacion_fallida` (7) | `captureMessage` | `error` | — | `Operación SII <op> terminó en verificacion_fallida` |
| `transporte` (4) | `captureMessage` | `warning` | `host_sii` (solo el host, de `hostDelError`, `server/sii/errores.ts`) | `Operación SII <op> terminó en transporte` |
| `error` (1) | `captureException` (copia saneada) | `error` | — | el del error |
| `ok`, `uso`, `config`, `rechazo_sii` | **solo breadcrumb** (no es evento) | `info` / `warning` | — | — |

- Un `transporte` por `BloqueoOcupadoError` (otra operación con el mismo certificado) llega
  **sin** `host_sii`: no es el SII, y el filtro `has:host_sii` lo deja fuera.
- `envio_sin_cerrar` (`server/seguimiento/cron.ts`, `avisarSinCerrar`): `captureMessage`
  `warning`, `operacion_sii: seguimiento`, `resultado: envio_sin_cerrar`, para envíos sin
  estado final después de 7 días.
- **Sentry no ve los éxitos** (`ok` es breadcrumb). Una tasa de fallas en porcentaje no se
  puede calcular con eventos de error: las alertas cuentan fallas absolutas y la tasa real
  sale de `operaciones_sii` (lo que hace `/estado`, `server/estado/index.ts`).

### API pública (`server/api-publica/manejar.ts` y `lote.ts`)

- Excepción no esperada → `captureException` con la etiqueta `api_publica_ruta` (`POST
  /documentos`, `GET /documentos/{id}/pdf`, `POST /documentos/lote`…) y respuesta 500
  `error_interno`.
- `ErrorApi` con código `error_interno` → también va a Sentry, con `api_publica_ruta` y las
  etiquetas `api_publica_motivo` y `api_publica_resultado` (del `diagnostico`).
- Los demás 4xx y el **503 `sii_no_disponible`** (transporte con el SII) **no** van a
  Sentry por la API: el `transporte` ya lo registró `ejecutarOperacion`.

### Cron (`app/api/cron/*/route.ts`)

- Cada ruta corre dentro de `conMonitorCron(slug, horario, …)` con `checkinMargin: 2`,
  `timezone: 'UTC'` y `maxRuntime` 5 / 2 / 2 / 3 min. Un 401 (Bearer distinto), un 503
  (`CRON_SECRET` ausente, o Flow sin configurar en `suscripciones`) o una ruta que no se
  llama nunca **no hacen check-in**: el monitor los ve como corrida perdida.
- Avisos `warning` con la etiqueta `cron` = slug: `alertas: corrida con errores`,
  `suscripciones: corrida con errores`, `webhooks: corrida con errores` y los de
  `server/webhooks/dependencias.ts` (`webhooks: no se pudieron reclamar entregas`,
  `webhooks: entrega sin cerrar`…). El seguimiento no tiene aviso de resumen: sus fallas
  llegan como eventos de operación.
- Pagos (`app/api/pagos/flow/*`): `captureMessage` con `tags: { pasarela: 'flow' }`.

### Cómo agrupa Sentry estos eventos

Los `captureMessage` de operación llevan *fingerprint* `['operacion_sii', <op>,
<resultado>]` (`registrarEnSentry`): **un issue por operación y resultado**, sin separar
por organización, empresa ni host. Consecuencias:

- «Avisar cuando se crea un issue nuevo» avisa solo la primera vez que una operación queda
  `incierto`; los siguientes caen en el mismo issue. Las reglas de abajo usan además la
  regresión y la frecuencia de eventos.
- Después de atender un incierto, **resolver el issue** en Sentry: el siguiente lo hace
  regresar y vuelve a avisar.
- Los `captureMessage` son `event.type:default`, no `error`: en consultas y alertas de
  métricas no filtres por `event.type:error` (el *dataset* «Errors» de las alertas de
  métricas incluye los dos tipos).

## Brechas frente a §4.8

| §4.8 pide | Hoy | Qué falta |
|---|---|---|
| *Cron monitors* para seguimiento, webhooks y alertas (y suscripciones) | los 4 existen y están `ok` | — |
| Alerta si un cron no corre | **no** (detectores sin automatización) | [A1](#a1-cron-corrida-perdida-o-fallida) y el umbral de fallas por monitor |
| Tasa de `transporte` (código 4) por host del SII | no | [M1](#m1-sii-fallas-de-conexión-en-producción) (y M2 por host, opcional) + widget por host en el [tablero](#tablero-boletéame--operación) |
| Cualquier `incierto` (6) | solo la primera vez, por la regla de prioridad alta | [A2](#a2-sii-operación-incierta-código-6) |
| Cualquier `verificacion_fallida` (7) | ídem | [A3](#a3-sii-verificación-fallida-código-7) |
| 5xx de la API pública (`api_publica_ruta`) | ídem | [A4](#a4-api-pública-error-5xx) |
| Tableros | ninguno propio | [tablero](#tablero-boletéame--operación) |

## Especificación de lo que falta

Para todas: proyecto `sii-web`, **ambiente `production`**, acción **correo** (al dueño del
issue y, si no hay, a los miembros activos; o directo al usuario). Los nombres son
sugerencias. Los cuerpos JSON son para la API clásica con un token con `alerts:write`
(`POST https://sentry.io/api/0/projects/luckillash/sii-web/rules/` para las de issues y
`POST https://sentry.io/api/0/organizations/luckillash/alert-rules/` para las de métricas);
en la UI se eligen los mismos campos. Revisar en la UI después de crear por API: el motor
nuevo de alertas las migra a *workflows*.

### A1. Cron: corrida perdida o fallida

| Campo | Valor |
|---|---|
| Tipo | alerta de issues conectada a los monitores (UI: *Alerts → Create alert*, conectar los 4 monitores `cron-seguimiento`, `cron-alertas`, `cron-webhooks`, `cron-suscripciones`; o desde cada monitor, *Alerts / Connect automation*) |
| Disparadores (cualquiera) | se crea un issue nuevo; el issue regresa (resuelto → sin resolver) |
| Ambiente | `production` |
| Acción | correo; intervalo entre avisos 30 min |
| Ajuste de cada monitor (*Failure tolerance* / *Recovery tolerance*) | `cron-webhooks`: 3 check-ins fallidos seguidos (corre cada minuto y una corrida perdida suelta es ruido); `cron-seguimiento`: 2; `cron-alertas` y `cron-suscripciones`: 1. Recuperación: 1 |

El SDK reescribe la configuración del monitor en cada check-in (`isUpserting`): si el umbral
puesto en la UI se pierde, hay que pasarlo en el código (`failureIssueThreshold` y
`recoveryThreshold` en las opciones de `Sentry.withMonitor`, dentro de `conMonitorCron`).
**Pendiente de código** (no es parte de esta tarea).

Por API clásica, como regla de issues con el filtro de categoría (comprobar en la UI que el
valor `4` corresponde a *Crons*):

```json
{
  "name": "Cron: corrida perdida o fallida",
  "environment": "production",
  "actionMatch": "any",
  "filterMatch": "all",
  "frequency": 30,
  "conditions": [
    { "id": "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition" },
    { "id": "sentry.rules.conditions.regression_event.RegressionEventCondition" }
  ],
  "filters": [
    { "id": "sentry.rules.filters.issue_category.IssueCategoryFilter", "value": "4" }
  ],
  "actions": [
    { "id": "sentry.mail.actions.NotifyEmailAction", "targetType": "IssueOwners", "fallthroughType": "ActiveMembers" }
  ]
}
```

### A2. SII: operación incierta (código 6)

| Campo | Valor |
|---|---|
| Tipo | alerta de issues |
| Disparadores (cualquiera) | issue nuevo; el issue regresa; el issue tiene **más de 0 eventos en 1 minuto** (para avisar cada incierto nuevo dentro de un issue abierto) |
| Filtros (todos) | etiqueta `resultado` **igual a** `incierto` |
| Ambiente | `production` (los dos ambientes del SII: un incierto de certificación también bloquea) |
| Acción | correo; intervalo 5 min |
| Después | atender con el [runbook](runbooks.md#envío-u-operación-incierta-código-6) y **resolver** el issue |

```json
{
  "name": "SII: operación incierta (código 6)",
  "environment": "production",
  "actionMatch": "any",
  "filterMatch": "all",
  "frequency": 5,
  "conditions": [
    { "id": "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition" },
    { "id": "sentry.rules.conditions.regression_event.RegressionEventCondition" },
    { "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition", "value": 0, "interval": "1m", "comparisonType": "count" }
  ],
  "filters": [
    { "id": "sentry.rules.filters.tagged_event.TaggedEventFilter", "key": "resultado", "match": "eq", "value": "incierto" }
  ],
  "actions": [
    { "id": "sentry.mail.actions.NotifyEmailAction", "targetType": "IssueOwners", "fallthroughType": "ActiveMembers" }
  ]
}
```

Si la API rechaza `value: 0`, usar `1` con `interval: "1m"` (avisa desde el segundo evento
del minuto; el primero lo cubren «nuevo» y «regresa» si el issue se resolvió).

### A3. SII: verificación fallida (código 7)

Igual que A2 con `resultado` **igual a** `verificacion_fallida` y el nombre «SII:
verificación fallida (código 7)». Suele indicar un cambio del portal o de una respuesta del
SII ([runbook](runbooks.md#verificación-fallida-código-7)).

### A4. API pública: error 5xx

| Campo | Valor |
|---|---|
| Tipo | alerta de issues |
| Disparadores (cualquiera) | issue nuevo; regresa; más de 0 eventos en 1 minuto |
| Filtros (todos) | etiqueta `api_publica_ruta` **está definida** (*is set*) |
| Ambiente | `production` |
| Acción | correo; intervalo 5 min |

```json
{
  "name": "API pública: error 5xx",
  "environment": "production",
  "actionMatch": "any",
  "filterMatch": "all",
  "frequency": 5,
  "conditions": [
    { "id": "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition" },
    { "id": "sentry.rules.conditions.regression_event.RegressionEventCondition" },
    { "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition", "value": 0, "interval": "1m", "comparisonType": "count" }
  ],
  "filters": [
    { "id": "sentry.rules.filters.tagged_event.TaggedEventFilter", "key": "api_publica_ruta", "match": "is", "value": "" }
  ],
  "actions": [
    { "id": "sentry.mail.actions.NotifyEmailAction", "targetType": "IssueOwners", "fallthroughType": "ActiveMembers" }
  ]
}
```

Una excepción que escape antes de `manejarApi` (p. ej. al cargar el módulo de la ruta) la
captura `onRequestError` **sin** `api_publica_ruta`. Opcional, una segunda regla igual con
el filtro de atributo «`url` contiene `/api/v1/`» y nivel `error`.

### M1. SII: fallas de conexión en producción

| Campo | Valor |
|---|---|
| Tipo | alerta de métricas, *dataset* Errors (tipos de evento `error` y `default`) |
| Consulta | `resultado:transporte has:host_sii ambiente:produccion` |
| Ambiente | `production` |
| Agregado y ventana | `count()` en 15 minutos |
| Umbrales | *warning*: más de 2; *critical*: más de 9; se resuelve sola al bajar del *warning* |
| Acción | correo en *warning* y en *critical* |
| Atender con | [runbook de caída o lentitud del SII](runbooks.md#caída-o-lentitud-del-sii-código-4) |

```json
{
  "name": "SII: fallas de conexión en producción",
  "dataset": "events",
  "eventTypes": ["error", "default"],
  "query": "resultado:transporte has:host_sii ambiente:produccion",
  "aggregate": "count()",
  "timeWindow": 15,
  "environment": "production",
  "projects": ["sii-web"],
  "thresholdType": 0,
  "resolveThreshold": null,
  "triggers": [
    { "label": "critical", "alertThreshold": 9, "actions": [ { "type": "email", "targetType": "user", "targetIdentifier": "<id de usuario de Sentry>" } ] },
    { "label": "warning", "alertThreshold": 2, "actions": [ { "type": "email", "targetType": "user", "targetIdentifier": "<id de usuario de Sentry>" } ] }
  ]
}
```

Los umbrales son para el volumen del piloto (seguimiento cada 5 minutos con una operación
por grupo, más las emisiones): súbelos cuando crezca el tráfico. Las alertas de métricas no
agrupan por etiqueta: el desglose por host está en el tablero y en el issue (pestaña de
etiquetas, `host_sii`).

**M2 (opcional).** Una por host crítico de producción, con la misma forma: `host_sii:rahue.sii.cl`
(envío de boletas: una falla después de enviar deja la boleta **incierta**), critical más de 4
en 15 min; y `host_sii:api.sii.cl` (semilla, token y consulta de estado), critical más de 9.
Para certificación (`ambiente:certificacion`, hosts `apicert`, `pangal`, `maullin`) no se
recomienda alerta: es inestable y no afecta a clientes en producción.

### Extras recomendados (fuera de §4.8)

| Regla | Filtro | Disparador | Intervalo |
|---|---|---|---|
| Cron: corrida con errores | etiqueta `cron` está definida | más de 2 eventos en 1 hora | 60 min |
| Seguimiento: envío sin cerrar | `resultado` igual a `envio_sin_cerrar` | issue nuevo o regresa | 1 día |
| Pagos con Flow | etiqueta `pasarela` igual a `flow` | issue nuevo o regresa | 30 min |

### Tablero «Boletéame — operación»

*Dashboards → Create dashboard*, proyecto `sii-web`, ambiente `production`, período 7 días.
Todos los widgets con el *dataset* Errors (incluye `default`):

| # | Widget | Tipo | Consulta | Columnas / agrupación |
|---|---|---|---|---|
| 1 | Fallas de conexión por host del SII | línea | `resultado:transporte has:host_sii` | `count()` por `host_sii` (top 5) |
| 2 | Fallas de conexión por ambiente | barras | `resultado:transporte has:host_sii` | `count()` por `ambiente` |
| 3 | Operaciones inciertas | tabla | `resultado:incierto` | `operacion_sii`, `ambiente`, `organizacion`, `empresa`, `count()`, `max(timestamp)` |
| 4 | Verificaciones fallidas | tabla | `resultado:verificacion_fallida` | `operacion_sii`, `ambiente`, `count()`, `max(timestamp)` |
| 5 | API pública: errores por ruta | barras | `has:api_publica_ruta` | `count()` por `api_publica_ruta` |
| 6 | Avisos de cron | tabla | `has:cron` | `cron`, `message`, `count()`, `max(timestamp)` |
| 7 | Envíos sin cerrar | tabla | `resultado:envio_sin_cerrar` | `ambiente`, `empresa`, `count()` |
| 8 | Otros errores | número | `level:error !has:operacion_sii !has:api_publica_ruta !has:cron` | `count()` |

Opcional (*dataset* Spans, muestra del 10 %): `span.op:http.client span.domain:*.sii.cl`,
`failure_rate()` y `p95(span.duration)` por `span.domain`, para ver la latencia del SII por
host. Comprobar antes que las peticiones salientes aparecen en *Insights → Requests*.

El estado de los cron monitors no es un widget: se ve en *Insights → Crons*.

## Tasa real de fallas (SQL)

Sentry solo cuenta fallas; la proporción sale de `operaciones_sii` (solo lectura):

```sql
select ambiente, operacion,
       count(*) filter (where resultado in ('ok', 'rechazo_sii')) as respondidas,
       count(*) filter (where resultado = 'transporte') as transporte,
       count(*) filter (where resultado = 'incierto') as inciertas
from public.operaciones_sii
where terminada_en > now() - interval '1 hour'
group by 1, 2
order by 1, 2;
```

`/estado` usa la misma idea (ventana de 60 minutos, «Con demoras» desde 10 % de fallas,
«Con problemas» desde 50 % con al menos 3; `lib/estado.ts`).
