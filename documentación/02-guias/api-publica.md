---
title: "API pública y webhooks"
description: "Fase 11: API REST /api/v1 con API keys (sha256, alcances, ambiente por prefijo, empresa), idempotencia con api_idempotencia, emisión por la API reutilizando emitirDocumento, lote, folios, envíos, XML/PDF por stream, errores y paginación; webhooks con outbox webhook_entregas, firma HMAC-SHA256, SSRF, backoff y cron; OpenAPI y /docs/api; cliente de ejemplo y cómo probar el criterio."
keywords: [Fase 11, API pública, /api/v1, API key, sk_test_, sk_live_, crear_api_key, autenticar_api_key, alcances, documentos:leer, documentos:emitir, folios:leer, folios:solicitar, envios:leer, certificacion:gestionar, Idempotency-Key, Idempotent-Replayed, api_idempotencia, reclamar_idempotencia, terminar_idempotencia, soltar_idempotencia, huella, clave_idempotencia, origen api, api_key_id, emitirDocumento, POST /documentos, /documentos/lote, GET /documentos, /xml, /pdf, /folios, /folios/solicitudes, /envios, cursor, CuerpoError, CODIGOS_ERROR, MENSAJES_ERROR, webhooks, crear_webhook, webhook_entregas, reclamar_entregas_webhook, cerrar_entrega_webhook, reenviar_entrega_webhook, probar_webhook, rotar_secreto_webhook, webhook.prueba, Boleteame-Firma, HMAC-SHA256, whsec_, SSRF, lookupSeguro, backoff, descartado, /api/cron/webhooks, entregar-webhooks, cron-webhooks, OpenAPI, openapi.json, /docs/api, scripts/ejemplo-api, Firewall de Vercel, 429]
related: ["06-integraciones/overview.md", "06-integraciones/api-keys.md", "06-integraciones/webhooks.md", "03-api-reference/rpc-integraciones.md", "02-guias/emision-boletas.md", "02-guias/folios-caf.md", "02-guias/planes-y-pagos.md", "07-referencia/trampas-conocidas.md", "07-referencia/reglas-y-limites.md", "07-referencia/ejemplos-de-codigo.md", "04-objetos/codigos-y-enumeraciones.md"]
source: ["PLAN-SAAS.md Fase 11", "apps/web/src/lib/api-publica.ts", "apps/web/src/lib/openapi-v1.ts", "apps/web/src/app/api/v1/", "apps/web/src/server/api-publica/", "apps/web/src/server/webhooks/", "apps/web/src/app/api/cron/webhooks/route.ts", "apps/web/src/app/[org]/configuracion/api/", "apps/web/src/app/[org]/configuracion/webhooks/", "apps/web/src/app/docs/api/page.tsx", "supabase/migrations/0018_api_webhooks.sql", "supabase/migrations/0019_cron_webhooks.sql", "scripts/ejemplo-api/"]
---

# API pública y webhooks

> **Úsalo cuando:** tocas `/api/v1/*`, la entrega de webhooks (`/api/cron/webhooks`),
> Configuración → API o Webhooks, la especificación OpenAPI o la página `/docs/api`, o
> tienes que explicarle a un cliente cómo integrar su sistema.

**Estado (2026-11-19).** Fase 11 **desplegada en producción** (`169e2e5`) y con el
[criterio de aceptación cumplido](#criterio-de-aceptación-2026-11-19) el mismo día. Migración
`0018_api_webhooks` aplicada el 2026-11-19, antes del deploy; `0019_cron_webhooks` aplicada
el 2026-11-19 a las 03:54 UTC, después del deploy. Firewall de Vercel con la regla de
límite por IP en `/api/v1/*` configurada. El criterio: un cliente de ejemplo emite una
boleta por la API, repite la petición con la misma `Idempotency-Key` sin duplicar y recibe
el webhook `documento.aceptado` con firma válida.

La documentación para los clientes es la página pública **`/docs/api`** (sale del mismo
objeto que `/api/v1/openapi.json`); esta guía es la de quien mantiene el código.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Contrato | `lib/api-publica.ts` | Alcances, eventos, cabeceras, límites, `CODIGOS_ERROR` y `MENSAJES_ERROR`, formas de las respuestas (`DocumentoApi`, `EnvioApi`, `FoliosApi`…), `validarUrlWebhook`. Puro: lo comparten las rutas, la entrega, la UI, OpenAPI y la página de docs |
| API | `app/api/v1/**/route.ts` + `server/api-publica/` | Autenticación por API key, idempotencia, emisión, lote, lecturas, folios, envíos, XML y PDF |
| Entrega de webhooks | `app/api/cron/webhooks/route.ts` + `server/webhooks/` | Reclama entregas, firma, protege contra SSRF, envía y cierra con backoff |
| Panel | `app/[org]/configuracion/api/`, `app/[org]/configuracion/webhooks/` + `server/integraciones/` | Crear y revocar claves; crear, editar, pausar, borrar, probar y rotar webhooks; historial y reenvío |
| Especificación | `lib/openapi-v1.ts`, `app/api/v1/openapi.json/route.ts` | OpenAPI 3.1 pública (`Cache-Control: public, max-age=300`) |
| Docs públicas | `app/docs/api/page.tsx` | Estática, sin librerías; `/docs` es prefijo público en `lib/rutas.ts` |
| Base | `0018_api_webhooks`, `0019_cron_webhooks` | `api_idempotencia`, `autenticar_api_key`, idempotencia, reclamar/cerrar/reenviar/probar/rotar, `encolar_evento` filtrado por plan, check de URL; jobs `entregar-webhooks` y `limpiar-webhook-entregas` |
| Ejemplo | `scripts/ejemplo-api/` | `emitir.mjs`, `receptor.mjs`, `verificar-firma.mjs` (Node puro) |

## API keys

- Las crea un **administrador** en Configuración → API con `crear_api_key` (RPC de la 0001,
  con la sesión: `es_admin` y plan con `incluye_api`). La Server Action confirma antes la
  sesión con `getUser()` (`confirmarSesion`), como pide la Fase 13. La clave se muestra
  **una vez**; la base guarda solo su SHA-256 en hex (`clave_hash`) y el prefijo visible
  (`prefijo`, 12 caracteres: `sk_test_ab12`).
- Formato: `sk_test_<64 hex>` (certificación) o `sk_live_<64 hex>` (producción).
  `FORMATO_CLAVE` lo valida antes de ir a la base.
- **Alcances** que ofrece la UI: `documentos:leer`, `documentos:emitir`, `folios:leer`,
  `folios:solicitar`, `envios:leer`. `certificacion:gestionar` existe en el check de la base
  pero queda **reservado** (la certificación tiene pasos humanos en el portal del SII y
  sesiones AUT2000; el asistente del panel la cubre).
- **Empresa:** `api_keys.empresa_id` nulo = todas las empresas de la organización.
- **Revocar:** `update api_keys set revocada_en = now()` con la sesión (grant de columna
  de la 0001). Deja de funcionar en la siguiente petición.
- **Autenticación de cada petición:** `autenticar_api_key(sha256)` (0018, solo
  `service_role`) devuelve siempre una fila: `motivo` nulo = válida; si no, `invalida`,
  `revocada`, `vencida` o `plan_sin_api` con los ids nulos. Actualiza `ultimo_uso_en` como
  máximo una vez por minuto. El ambiente de la fila tiene que calzar con el prefijo (si no,
  `401 clave_invalida`). Nunca se registra la clave: Sentry depura `sk_(test|live)_…` y
  `whsec_…` (`lib/sentry/depurar.ts`).

## Convenciones de la API

- Todas las rutas: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration` 60 s
  (300 s en `documentos/lote` y `folios/solicitudes`), `Cache-Control: no-store`, sin
  CORS (servidor a servidor).
- Después de autenticar, todo corre con `service_role` filtrando **siempre** por la
  organización de la clave (y por su empresa y ambiente).
- **Ambiente:** lo fija la clave. Un `ambiente` distinto en el cuerpo o la consulta →
  `422 ambiente_no_coincide`.
- **Empresa:** clave de una empresa → solo esa (`403 empresa_no_permitida` si se pide
  otra). Clave para todas → el `POST` exige `empresa` (RUT con o sin puntos, o UUID;
  `422 empresa_requerida`); en los listados es un filtro opcional.
- **Errores:** `{ "error": { "codigo", "mensaje", "campos"?, "documento"?, "operacion_pendiente_id"? } }`
  con los códigos y textos de `CODIGOS_ERROR` / `MENSAJES_ERROR` (tabla en
  [códigos y enumeraciones](../04-objetos/codigos-y-enumeraciones.md#errores-de-la-api-pública-fase-11)).
  Los errores de zod vuelven en `campos` con rutas snake_case (`lineas.0.precio`).
- **Paginación:** `?limite=1..100` (20) y `?cursor=` opaco (keyset `(creado_en desc, id desc)`);
  respuesta `{ objeto: 'lista', datos, tiene_mas, siguiente_cursor }`.
- **Campos** en snake_case y en español, igual que los payloads de los webhooks.
- Un 5xx se captura en Sentry con la etiqueta `api_publica_ruta`.

## Rutas

| Método y ruta | Alcance | Éxito |
|---|---|---|
| `POST /documentos` (`Idempotency-Key` obligatoria) | `documentos:emitir` | 201 emitido (`Location`); 202 incierto |
| `POST /documentos/lote` (`Idempotency-Key`; ítem *n* usa `<clave>#<n>`) | `documentos:emitir` | 200 con un resultado por ítem |
| `GET /documentos` | `documentos:leer` | lista sin líneas; nunca `set_pruebas`; sin filtro de estado no trae borradores, con `estado=borrador` sí (también los del panel) |
| `GET /documentos/{id}` | `documentos:leer` | con líneas y envío (Track ID y estado); los rechazos están en `GET /envios/{id}`; una boleta del set de pruebas es 404 |
| `GET /documentos/{id}/xml` | `documentos:leer` | stream `application/xml; charset=ISO-8859-1` |
| `GET /documentos/{id}/pdf?formato=carta\|rollo` | `documentos:leer` | stream `application/pdf` (regenera el PDF si falta) |
| `GET /folios` | `folios:leer` | folios por tipo con sus CAF |
| `POST /folios/solicitudes` (`nivel` `ensayo`/`revision`/`timbrar`) | `folios:solicitar` | 200 ensayo o revisión; 201 timbrado; 202 incierto |
| `GET /envios/{id}` | `envios:leer` | carátula, estado, conteos, documentos, rechazos |
| `GET /openapi.json` | pública | OpenAPI 3.1 |

Los ids de otra empresa, otro ambiente u otra organización responden `404 no_encontrado`
(no se distingue «no existe» de «no es tuyo»). XML y PDF se sirven como stream (la ruta
descarga la URL firmada de Storage y reenvía los bytes): la URL firmada nunca sale.

## Emisión por la API

La API emite con **el mismo** `emitirDocumento` de la Fase 7, sin cambiar su flujo (token
antes del folio, un solo update a `firmado`, reintento ante `23514`, incierto). Lo único
que cambia es el contexto:

- `ContextoEmision.usuarioId` es `null` y viene `apiKeyId`: `ejecutarOperacion` no llama a
  `getUser()` y deja `operaciones_sii.api_key_id`.
- El borrador se guarda con el cliente de servicio (filtrando por organización y empresa),
  con `origen = 'api'` y `clave_idempotencia`.

### Idempotencia

`api_idempotencia` (0018, solo `service_role`) guarda por `(organizacion_id, clave)` la
huella de la petición (SHA-256 del JSON con llaves ordenadas de
`{recurso, empresa_id, borrador}`), el estado (`en_curso` / `terminada`), el status y el
cuerpo de la respuesta. No se usa `documentos.metadata` porque la emisión lo reescribe
entero.

Algoritmo de `POST /documentos`:

1. Autenticar, exigir el alcance, leer `Idempotency-Key` (`/^[!-~]{1,200}$/`), leer el
   cuerpo (hasta 256 KB; 415, 400, 413), validar con `esquemaBorrador`, resolver la empresa.
2. `reclamar_idempotencia(org, clave, 'documento', huella, api_key, 120)`:
   - `conflicto` (misma clave, otra huella) → `422 idempotencia_conflicto`.
   - `en_curso` (otra petición la tiene, arriendo de 120 s) → `409 idempotencia_en_curso` con `Retry-After: 5`.
   - `terminada` → la respuesta guardada, mismo status y cuerpo, con `Idempotent-Replayed: true`.
   - `nueva` o `retomada` (arriendo vencido) → seguir.
3. Buscar `documentos` por `(organizacion_id, clave_idempotencia)`: si existe y ya no es
   `borrador` (la función anterior murió después de emitir), responder su representación
   actual y `terminar`; si es `borrador`, emitir ese mismo borrador.
4. `emitirDocumento(...)`. `ok` → 201 y `terminar`. Error con documento (incierto → 202;
   anulado por rechazo 4xx del SII → `422 rechazado_por_sii`) → `terminar`. Error sin
   documento (validación, folios, cuota, el SII no respondió antes de enviar) →
   `soltar_idempotencia` y responder el error: no se guarda, y reintentar con la misma
   clave retoma el mismo borrador.
5. Cualquier excepción después de reclamar → `soltar` en un `finally` y 500.

`soltar` conserva la huella: reintentar con otro cuerpo da `conflicto`. La unicidad
`documentos (organizacion_id, clave_idempotencia)` de la 0001 es la segunda red: un
`23505` en el insert del borrador se traduce como clave en uso.

### Lote

`POST /documentos/lote`: hasta 25 boletas. Se validan todas antes de emitir la primera
(una inválida → 422 sin emitir nada). Cada una es una emisión independiente con su propio
envío y la clave `<clave>#<n>`, en secuencia; no se empieza una boleta después de los 200 s
(una emisión puede tardar 60 s y la ruta tiene `maxDuration = 300`); lo que no
alcanza queda `pendiente` y se completa repitiendo el lote con la misma clave. **No** se
agrupan varias boletas en un solo EnvioBOLETA (pendiente de decidir; ver
[trampas](../07-referencia/trampas-conocidas.md#api-pública-y-webhooks-fase-11)).

### Folios por la API

`POST /folios/solicitudes` reutiliza `solicitarFolios` con un `ContextoFoliosApi`
(`usuarioId: null`, `apiKeyId`): sin `confirmarSesion`, con el mismo control de operación
pendiente (`revisarOperacionPendiente`). Igual que en el panel, **en producción timbrar
exige el `revision_id`** de una revisión de la misma solicitud de menos de 30 minutos
(`422 revision_requerida`). `timbrar` exige `Idempotency-Key`.

## Webhooks

### Alta y administración (panel)

- `crear_webhook(org, url, eventos)` (0001, con la sesión: `es_admin` y plan con
  `incluye_webhooks`): crea el secreto `whsec_…` en Vault y lo devuelve **una vez**.
- Editar URL, eventos y `activo` con la sesión (grant de columnas de la 0001), validando con
  `validarUrlWebhook`; la base lo vuelve a exigir con el check `webhooks_url_permitida`
  (0018): https, puerto 443, sin usuario, sin IP literal ni dominios locales, hasta 2.048
  caracteres.
- Borrar: `tg_borrar_secretos` limpia el secreto de Vault.
- `probar_webhook(webhook)` encola `webhook.prueba`; `rotar_secreto_webhook(webhook)` crea un
  secreto nuevo, borra el viejo (rotación inmediata) y devuelve el nuevo una vez;
  `reenviar_entrega_webhook(entrega)` reinicia la **misma** fila (conserva el `id` para que
  el receptor deduplique). Las tres: `authenticated` (administrador) y `service_role`.

### Encolado

Los triggers y la app llaman a `encolar_evento(org, evento, datos)`, que inserta una fila
en `webhook_entregas` por cada webhook activo suscrito. Desde la 0018 además exige que el
plan vigente incluya webhooks (una organización que bajó de plan deja de acumular
entregas). `tg_evento_documento` agrega `estado`, `origen` y `clave_idempotencia` a los
datos. Catálogo de eventos y payloads en [webhooks](../06-integraciones/webhooks.md).

### Entrega (`/api/cron/webhooks`)

- `pg_cron` `entregar-webhooks` cada minuto (0019, aplicada el 2026-11-19 después del deploy) → `POST
  /api/cron/webhooks` con el Bearer de Vault. `autorizarCron`, monitor de Sentry
  `cron-webhooks`, `maxDuration = 60`; responde solo conteos.
- `reclamar_entregas_webhook(32, 120)`: descarta primero las que ya no corresponden
  (webhook inactivo, 8 intentos, plan sin webhooks) y reclama por turnos entre
  organizaciones con `for update skip locked`, sumando el intento y corriendo
  `siguiente_intento_en` como arriendo.
- Concurrencia 8, 10 s por entrega, no empieza ninguna después del segundo 45. El secreto
  se lee con `leer_secreto` (caché por webhook dentro de la corrida).
- Cuerpo `{ id, evento, creado_en, datos }` con `id` = id de la entrega (estable entre
  intentos). Cabeceras `Boleteame-Firma: t=<unix>,v1=<hex>`, `Boleteame-Evento`,
  `Boleteame-Entrega`, `Boleteame-Intento`, `User-Agent: Boleteame-Webhooks/1.0`.
- Firma: HMAC-SHA256 con el secreto `whsec_…` completo (UTF-8) sobre `"<t>.<cuerpo>"`; `t`
  nuevo en cada intento. `server/webhooks/firma.ts` y `scripts/ejemplo-api/verificar-firma.mjs`
  son equivalentes (prueba en `lib/ejemplo-api.test.ts`).
- Entregado = cualquier 2xx. Un 3xx es falla (no se siguen redirecciones). Se guardan
  hasta 1.000 caracteres de la respuesta, sin `\u0000` y depurados.
- `cerrar_entrega_webhook`: `entregado`, `fallido` con la siguiente espera (1 min, 5 min,
  30 min, 2 h, 6 h, 12 h, 24 h, ±10 %) o `descartado` en el intento 8 (unas 44 h).
- **SSRF:** `server/webhooks/ssrf.ts` resuelve el DNS y rechaza si **alguna** dirección cae
  en rangos privados, loopback, link-local, CGNAT, multicast o reservados (IPv4, IPv6 y
  `::ffff:`); la conexión usa `node:https` con un `lookup` que fija la IP ya validada
  (sin *DNS rebinding*). Una URL bloqueada se descarta sin reintentos.
- Sin autodesactivación: la UI avisa si las últimas entregas fallaron.
- `limpiar-webhook-entregas` (diario) borra las `entregado`/`descartado` de más de 30 días.

## Rate limiting

Regla del Firewall de Vercel por IP en `/api/v1/*`, **configurada el 2026-11-19** (ver
[checklist](../07-referencia/checklist-produccion.md#api-pública-y-webhooks-fase-11)):
«API pública: límite por IP», ruta que empieza con `/api/v1/`, ventana fija (`fixed_window`)
de 60 s, **120 peticiones por IP**, acción `rate_limit` (429). El Firewall quedó `Enabled`
con 1 regla activa. Responde 429 **antes de llegar a la app**: su cuerpo no es el JSON de error de la API (puede
ser HTML o vacío), así que el cliente no debe leer `error.codigo`; espera y repite con la misma
`Idempotency-Key`. `limite_excedido` sigue en el contrato pero la app no lo emite, y el
OpenAPI documenta el 429 sin cuerpo. No hay limitador en la base: la cuota
del plan y los folios ya acotan las emisiones.

## Cliente de ejemplo y criterio de aceptación

`scripts/ejemplo-api/` ([README](../../scripts/ejemplo-api/README.md)):

1. Aplicar la 0018 (con la 0019 fuera de la carpeta), verificación, simulación
   `rls-fase11-api.sql`, tipos. Deploy y humo: `/api/v1/documentos` sin clave → 401 JSON;
   `/api/v1/openapi.json` → 200; `/docs/api` → 200; `/api/cron/webhooks` sin Bearer → 401.
   Aplicar la 0019 y configurar el Firewall.
2. Organización con un plan que incluya API y webhooks (`servicio` estaba en Contador, que no
   los incluye: el 2026-11-19 se pasó a API con Flow sandbox, ver el
   [registro](#criterio-de-aceptación-2026-11-19)).
3. En Configuración → API, una clave `sk_test` de la empresa del piloto (`documentos:emitir`,
   `documentos:leer`, `envios:leer`).
4. Receptor `receptor.mjs` publicado en una URL https:443 (Vercel Sandbox o túnel), webhook
   con `documento.*` y `envio.actualizado`, «Enviar prueba» → `webhook.prueba` con firma
   válida en el log.
5. `node scripts/ejemplo-api/emitir.mjs`: 201 y, al repetir, el mismo documento y folio con
   `Idempotent-Replayed: true`. En SQL: un solo documento con esa clave y `origen = 'api'`,
   una operación `emitir` con `api_key_id` y `usuario_id` nulo, `api_idempotencia`
   `terminada`.
6. Cuando el seguimiento deja la boleta `aceptado`, el receptor registra
   `documento.aceptado` con firma válida y `webhook_entregas` queda `entregado` con 200.
7. Limpieza: revocar la clave, pausar o borrar el webhook, cerrar el receptor.

## Criterio de aceptación (2026-11-19)

Cumplido en producción el 2026-11-19, con el OK del usuario y contra el sandbox de Flow y la
certificación del SII (sin folios de producción).

**Despliegue y humo** (deploy `169e2e5`, `READY`):

- `/api/v1/documentos` sin clave → 401 `no_autenticado`; con una clave bien formada que no
  existe → 401 `clave_invalida`.
- `/api/v1/openapi.json` y `/docs/api` → 200.
- `POST /api/cron/webhooks` sin Bearer → 401.
- `/servicio/configuracion/api` y `/servicio/configuracion/webhooks` sin sesión → 307 a
  `/ingresar?siguiente=…`.
- Sin errores de runtime.

**`0019` y cron.** Aplicada a las 03:54 UTC, después del deploy (`--dry-run` con solo la
0019; `db push --yes`); verificación `0019_cron_webhooks.sql` 9/9 con el MCP `execute_sql`
como `postgres`. La primera corrida de `entregar-webhooks` (03:55) quedó `succeeded`, con
`net._http_response` 200 y `{reclamadas:0,…,errores:0}`, y el monitor `cron-webhooks` de
Sentry en `ok` (Production). La comprobación 10 de `0014_cron.sql` queda en `false`
(esperado).

**Firewall.** El proyecto no tenía configuración de Firewall: el MCP de Vercel responde 404
«Seawall Config not found» y no puede crear la primera regla, así que se creó con el CLI
(`vercel firewall rules add` y `vercel firewall publish --confirm-name sii --effects-digest …`).
Regla «API pública: límite por IP»: ruta que empieza con `/api/v1/`, `fixed_window` de 60 s,
120 peticiones por IP, acción `rate_limit` (429). Firewall `Enabled`, 1 regla activa. El 429
lo responde Vercel, sin cuerpo JSON garantizado.

**Plan.** `servicio` pasó de Contador a API desde `/servicio/configuracion/plan` con Flow
sandbox (saldo a favor $ 8.334, próximo cobro 19-12-2026; período del 19-11 al 18-12-2026;
misma suscripción de Flow sandbox).

**Recorrido:**

1. Clave `sk_test_fba8…` «Prueba criterio Fase 11» (empresa 20.630.500-2; alcances
   `documentos:leer`, `documentos:emitir`, `envios:leer`; 30 días). Receptor
   `scripts/ejemplo-api/receptor.mjs` en el puerto 3000, expuesto con un túnel rápido de
   `cloudflared` (`*.trycloudflare.com`). Webhook con `documento.aceptado`,
   `documento.aceptado_con_reparos`, `documento.rechazado`, `documento.incierto` y
   `envio.actualizado`.
2. «Enviar prueba»: `webhook.prueba` entregado a las 04:07:01 UTC con firma válida (entrega
   17, HTTP 200).
3. `emitir.mjs --clave=criterio-fase11-20261119-01`: 201, boleta 39 folio 43, Track ID
   34120364. Repetición con la misma clave: 201, mismo documento y folio, con
   `Idempotent-Replayed: true`.
4. En la base: 1 documento con esa clave y `origen = 'api'`; `siguiente_folio = 44`; 1
   operación `emitir` `ok` con `api_key_id` y `usuario_id` nulo; `api_idempotencia`
   `terminada` con 201; 0 folios anulados.
5. Seguimiento: envío EPR (1 aceptado, 0 rechazos, 0 reparos) y boleta `aceptado`.
   `documento.aceptado` del folio 43 entregado a las 04:11:01 UTC con firma válida (entrega
   19, intento 1, HTTP 200); también `envio.actualizado` (entregas 18 y 20). Todas
   `entregado` al primer intento.
6. Limpieza: webhook pausado (0 entregas en cola), clave revocada (la API responde 401
   `clave_revocada`), túnel y receptor detenidos. Quedan 2 folios de certificación (44–45).
