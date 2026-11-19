---
title: "RPC: API keys y webhooks"
description: "crear_api_key y crear_webhook (0001), las RPC de la API pública y de los webhooks de la 0018 (autenticar_api_key, idempotencia, reclamar y cerrar entregas, reenviar, probar y rotar el secreto) y columnas editables."
keywords: [crear_api_key, crear_webhook, autenticar_api_key, reclamar_idempotencia, terminar_idempotencia, soltar_idempotencia, reclamar_entregas_webhook, cerrar_entrega_webhook, reenviar_entrega_webhook, probar_webhook, rotar_secreto_webhook, encolar_evento, api_idempotencia, webhook_entregas, backoff, Idempotency-Key]
related: ["06-integraciones/api-keys.md", "06-integraciones/webhooks.md", "04-objetos/objetos-auditoria-e-integraciones.md", "08-esquema-supabase/rls-y-privilegios.md"]
source: ["supabase_saas_sii.sql §14 §15", "supabase/migrations/0018_api_webhooks.sql", "supabase/verificaciones/rls-fase11-api.sql"]
---

# RPC: API keys y webhooks

> **Úsalo cuando:** necesitas crear una API key o un webhook, autenticar una petición de
> la API pública, manejar una `Idempotency-Key` o entregar webhooks.

> **Estado:** las RPC de la 0001 están aplicadas. Las de la **0018** se aplicaron en
> producción el 2026-11-19, antes del deploy de la Fase 11 (verificación 23/23 y simulación
> `rls-fase11-api.sql` 39/39, con la limpieza en 0). La **0019** (aplicada el mismo día, después
> del deploy) solo agrega los jobs de `pg_cron` que llaman a `/api/cron/webhooks` y limpian
> entregas e idempotencia: no crea RPC.

## Resumen

| RPC | Migración | Quién | Para qué |
|---|---|---|---|
| `crear_api_key(org, nombre, alcances, ambiente, empresa, expira_en) → text` | 0001 | `authenticated` (administrador) | Crea la clave y la devuelve **una vez** (`sk_test_…` / `sk_live_…`) |
| `crear_webhook(org, url, eventos) → (webhook_id, secreto)` | 0001 | `authenticated` (administrador) | Crea el webhook y su secreto HMAC en Vault (`whsec_…`, **una vez**) |
| `autenticar_api_key(clave_hash) → fila` | 0018 | solo `service_role` | Autentica una petición de `/api/v1` |
| `reclamar_idempotencia(…)`, `terminar_idempotencia(…)`, `soltar_idempotencia(…)` | 0018 | solo `service_role` | `Idempotency-Key` de la API |
| `reclamar_entregas_webhook(limite, arriendo)` | 0018 | solo `service_role` | El cron toma entregas por turnos |
| `cerrar_entrega_webhook(id, intento, entregada, status, respuesta, definitiva)` | 0018 | solo `service_role` | Resultado de un intento con backoff |
| `reenviar_entrega_webhook(entrega)` | 0018 | `authenticated` (administrador) y `service_role` | Volver a poner en cola |
| `probar_webhook(webhook) → bigint` | 0018 | `authenticated` (administrador) y `service_role` | Encolar un `webhook.prueba` |
| `rotar_secreto_webhook(webhook) → text` | 0018 | `authenticated` (administrador) y `service_role` | Cambiar el secreto HMAC (lo devuelve **una vez**) |
| `encolar_evento(org, evento, payload)` | 0001, reemplazada en 0018 | solo `service_role` y triggers | Llena el outbox `webhook_entregas` |

Todas son `security definer` con `search_path = ''`. Las de la 0018 revocan `EXECUTE` a
`public`, `anon` y `authenticated` y lo dan a `service_role`; las tres del panel además a
`authenticated`.

## `crear_api_key` (0001)

```sql
public.crear_api_key(
  p_organizacion uuid, p_nombre text,
  p_alcances text[] default '{documentos:leer}',
  p_ambiente public.ambiente_sii default 'certificacion',
  p_empresa uuid default null, p_expira_en timestamptz default null) returns text
```

- `42501` si quien llama no es administrador (`es_admin`); `P0001` «El plan vigente no
  incluye acceso por API» si `plan_vigente().incluye_api` es falso (hoy solo `api` y
  `empresa`); `P0001` «La empresa no pertenece a la organización».
- Devuelve `sk_live_` (producción) o `sk_test_` (certificación) + 64 hex
  (`token_aleatorio`). Guarda solo `sha256` en hex (`clave_hash`, único) y los primeros 12
  caracteres en `prefijo`. La clave en claro no queda en ninguna parte.
- `alcances` ⊆ `documentos:leer`, `documentos:emitir`, `folios:leer`, `folios:solicitar`,
  `envios:leer`, `certificacion:gestionar` (check de la tabla). `certificacion:gestionar`
  queda **reservado**: la API no tiene rutas de certificación y la UI no lo ofrece.
- Columnas que el administrador puede cambiar con su sesión: `nombre` y `revocada_en`
  (revocar = `update … set revocada_en = now()`). Borrar: política `borrado`. La 0001
  también dejaba `expira_en`; la 0018 lo quita del grant.
- **Revocar es definitivo** (0018, trigger `trg_10_api_key_sin_reactivar`, para todos los
  roles, también `service_role`): una clave revocada no vuelve a `revocada_en = null` ni
  cambia su fecha de revocación, y `expira_en` no se alarga ni se quita (sí se puede
  acortar, con `service_role`). Ambos casos dan `22023`. Sin el trigger, un administrador
  podría revivir por PostgREST una clave filtrada. Si hace falta, se crea otra clave.
- La Server Action confirma la sesión con `getUser()` antes de llamarla (Fase 13 lo exige
  para todo lo que crea credenciales).

## `crear_webhook` (0001)

```sql
public.crear_webhook(p_organizacion uuid, p_url text, p_eventos text[])
  returns table (webhook_id uuid, secreto text)
```

- `42501` sin ser administrador; `P0001` «El plan vigente no incluye webhooks».
- El secreto (`whsec_` + 64 hex) va a Vault con la descripción `webhook <url>`; la fila
  guarda solo `secreto_secret_id`. Al borrar el webhook, `tg_borrar_secretos` lo saca de
  Vault y sus entregas se borran en cascada.
- `eventos` ⊆ `documento.aceptado`, `documento.aceptado_con_reparos`,
  `documento.rechazado`, `documento.incierto`, `envio.actualizado`, `folios.por_agotarse`,
  `certificado.por_vencer`, `certificacion.actualizada` (check, al menos uno).
- `url`: `^https://` (0001) y, desde la 0018, el check `webhooks_url_permitida`: solo
  puerto 443, sin usuario ni clave, sin IP literal (v4 ni v6), sin `localhost`, `.local`,
  `.localhost` ni `.internal`, sin punto final en el host y hasta 2.048 caracteres. Una URL
  así da `23514`, también al editarla por PostgREST. La resolución DNS a una IP privada la
  bloquea la app al entregar (no se puede revisar en un `check`).
- Columnas editables con la sesión: `url`, `eventos`, `activo`.

## `autenticar_api_key` (0018)

```sql
public.autenticar_api_key(p_clave_hash text)
  returns table (api_key_id uuid, organizacion_id uuid, empresa_id uuid,
                 alcances text[], ambiente public.ambiente_sii, motivo text)
```

Siempre devuelve **una** fila. `motivo` nulo = clave válida, con sus datos. Si no:

| `motivo` | Cuándo |
|---|---|
| `invalida` | el hash no es sha256 hex o no existe ninguna clave con él |
| `revocada` | `revocada_en` no es nulo |
| `vencida` | `expira_en <= now()` |
| `plan_sin_api` | `plan_vigente(org).incluye_api` es falso (o no hay plan vigente) |

En los rechazos **todos los ids van nulos**: un rechazo no revela a qué organización
pertenece la clave. Con una clave válida actualiza `ultimo_uso_en`, como mucho una vez por
minuto (`ultimo_uso_en < now() - interval '1 minute'`), para no escribir en cada petición.
La app calcula el sha256 de la clave del `Authorization: Bearer` y comprueba que el prefijo
(`sk_test` / `sk_live`) coincida con `ambiente`.

## Idempotencia (0018)

Tabla `api_idempotencia` (llave `(organizacion_id, clave)`; detalle en
[objetos](../04-objetos/objetos-auditoria-e-integraciones.md#api_idempotencia-0018)).

```sql
public.reclamar_idempotencia(p_organizacion uuid, p_clave text, p_recurso text,
  p_huella text, p_api_key uuid default null, p_arriendo_segundos integer default 120)
  returns table (resultado text, status_http integer, respuesta jsonb, recurso_id uuid)
```

| `resultado` | Qué pasó | Qué hace la API |
|---|---|---|
| `nueva` | la clave no existía; queda `en_curso` | sigue con la petición |
| `retomada` | estaba `en_curso` con la **misma** huella y recurso, y el arriendo venció (la función anterior murió o soltó la clave); se vuelve a tomar | sigue, con `recurso_id` (p. ej. el borrador ya guardado) |
| `en_curso` | otra petición la tiene tomada | 409 `idempotencia_en_curso` con `Retry-After` |
| `terminada` | ya tiene respuesta | repite `status_http` y `respuesta` con `Idempotent-Replayed: true` |
| `conflicto` | la clave existe con otra huella u otro recurso | 422 `idempotencia_conflicto` |

- `p_recurso` ∈ `documento`, `lote`, `solicitud_folios`; `p_huella` = sha256 hex del
  cuerpo normalizado; `p_clave` = 1 a 255 caracteres ASCII visibles (`^[!-~]{1,255}$`; la
  API acepta 200 y el lote agrega `#n`). Formato inválido → `23514`; datos nulos → `22004`.
- El arriendo se acota entre 10 y 900 s.
- `terminar_idempotencia(org, clave, status, respuesta, recurso_id) → boolean`: guarda la
  respuesta final (solo si estaba `en_curso`; `false` si ya estaba terminada).
- `soltar_idempotencia(org, clave, recurso_id) → boolean`: deja la clave retomable al
  instante (`reclamada_en = '-infinity'`) sin borrar la huella: un reintento con otro cuerpo
  sigue dando `conflicto`. La API la usa cuando la petición falla **antes** de que algo
  salga al SII (validación, folios, cuota): repetir con la misma clave retoma el mismo
  borrador.
- Las claves son por organización: la misma clave en otra organización es `nueva`.
- Además, `documentos.clave_idempotencia` (único por organización, 0001) guarda la clave en
  la boleta emitida por la API.

## Entregas de webhooks (0018)

El outbox `webhook_entregas` lo llenan los triggers con `encolar_evento`. Desde la 0018,
`encolar_evento` **solo encola si el plan vigente incluye webhooks** (`plan_vigente().
incluye_webhooks`), y `documento.*` (`tg_evento_documento`) lleva además `estado`, `origen`
y `clave_idempotencia` en los datos.

### `reclamar_entregas_webhook`

```sql
public.reclamar_entregas_webhook(p_limite integer default 32, p_arriendo_segundos integer default 120)
  returns table (id bigint, organizacion_id uuid, webhook_id uuid, evento text, payload jsonb,
                 intentos integer, url text, secreto_secret_id uuid)
```

1. **Descarta** las entregas vencidas (`pendiente` o `fallido` con `siguiente_intento_en
   <= now()`) que ya no corresponde entregar, con su motivo en `ultima_respuesta`: «El
   webhook está desactivado.», «Se agotaron los 8 intentos.» o «El plan vigente no incluye
   webhooks.».
2. **Toma** hasta `p_limite` (1 a 100) entregas vencidas **por turnos entre
   organizaciones** (`row_number() over (partition by organizacion_id …)`: la más antigua de
   cada organización, después la segunda de cada una…), con `for update skip locked` (dos
   corridas no toman la misma).
3. A cada una le suma el intento y corre `siguiente_intento_en` al fin del arriendo (30 a
   900 s): si la función muere, la entrega vuelve sola cuando vence.
4. Devuelve la URL y el **id** del secreto; la app lo lee con `leer_secreto` (service_role)
   y firma con HMAC-SHA256.

### `cerrar_entrega_webhook`

```sql
public.cerrar_entrega_webhook(p_id bigint, p_intento integer, p_entregada boolean,
  p_status_http integer default null, p_respuesta text default null,
  p_definitiva boolean default false) returns public.estado_entrega_webhook
```

- `p_intento` es el `intentos` que devolvió `reclamar_entregas_webhook` (ya sumado). Solo
  cierra entregas `pendiente` o `fallido` **en ese intento** (con `for update`); si ya
  estaba cerrada, si la reenviaron a mitad (`reenviar_entrega_webhook` reinicia
  `intentos` a 0) o si otra corrida la reclamó después, devuelve `null` sin pisarla.
- `p_entregada` → `entregado` con `entregado_en`.
- `p_definitiva` (p. ej. URL bloqueada por SSRF) o 8 intentos hechos → `descartado`.
- Si no → `fallido` con el próximo intento según el intento hecho, ±10 %:

  | Intento hecho | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
  |---|---|---|---|---|---|---|---|---|
  | Próximo intento | 1 min | 5 min | 30 min | 2 h | 6 h | 12 h | 24 h | descartada |

  Sincronizado con `ESPERAS_WEBHOOK_MIN` y `MAX_INTENTOS_WEBHOOK` de
  `apps/web/src/lib/api-publica.ts` (unas 44 h en total).
- `ultima_respuesta` se guarda truncada a 1.000 caracteres; un timeout va sin status
  (parámetros por defecto).

### Estados de una entrega

| Estado | Significado |
|---|---|
| `pendiente` | nueva o reenviada, sin intentos (o reclamada y en curso) |
| `fallido` | falló un intento; hay otro programado en `siguiente_intento_en` |
| `entregado` | el receptor respondió 2xx |
| `descartado` | sin más intentos: 8 agotados, falla definitiva, webhook desactivado o plan sin webhooks |

## Acciones del panel (0018)

Las tres aceptan `authenticated` (administradores de la organización) y `service_role`.
Errores comunes: `P0002` si no existe o es de otra organización (también para miembros de
otra organización: no se distingue), `42501` si es miembro sin ser administrador.

| RPC | Además | Efecto |
|---|---|---|
| `reenviar_entrega_webhook(p_entrega bigint)` | `P0001` plan sin webhooks; `22023` webhook desactivado o la entrega ya está `pendiente` | Reinicia **la misma fila** (el receptor deduplica por id): `pendiente`, `intentos = 0`, vencida ya, sin `entregado_en`, con `reenviada_en` y `reenviada_por` |
| `probar_webhook(p_webhook uuid) → bigint` | `P0001` plan sin webhooks; `22023` desactivado | Encola `webhook.prueba` con `datos: {webhook_id, mensaje}`; devuelve el id de la entrega |
| `rotar_secreto_webhook(p_webhook uuid) → text` | — | Crea un `whsec_` nuevo en Vault, lo deja en `secreto_secret_id`, borra el anterior y lo devuelve **una vez**. Rige desde la próxima entrega |

## Errores y su traducción

| Código | Origen | Mensaje para el usuario |
|---|---|---|
| `42501` | sin ser administrador | Solo propietarios y administradores pueden gestionar la API y los webhooks. |
| `P0001` | plan sin API o sin webhooks | Tu plan no incluye la API (o los webhooks). Revisa tu plan. |
| `P0002` | no existe o es de otra organización | No encontramos ese webhook (o esa entrega). |
| `22023` | webhook desactivado / entrega en cola | Activa el webhook antes de reenviar o probar. / Esa entrega ya está en cola. |
| `23514` | `webhooks_url_permitida` o check de `api_idempotencia` | La URL no está permitida: usa https en el puerto 443 con un dominio público. |

Los textos definitivos están en `apps/web/src/server/integraciones/errores.ts` y en
`MENSAJES_ERROR` de `lib/api-publica.ts`.

## Ver también

- [API keys](../06-integraciones/api-keys.md) y [webhooks](../06-integraciones/webhooks.md).
- [Tablas](../04-objetos/objetos-auditoria-e-integraciones.md) y
  [acceso por tabla](acceso-por-tabla.md).
- Pruebas: `supabase/verificaciones/0018_api_webhooks.sql` (23) y `rls-fase11-api.sql` (39);
  [probar el esquema §14](../05-pruebas/probar-el-esquema.md#14-simulación-de-la-api-pública-y-los-webhooks-de-la-fase-11-rls-fase11-apisql).
