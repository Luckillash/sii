---
title: "Objetos: auditoría e integraciones"
description: "Columnas de operaciones_sii (y qué guarda la capa SII en mensaje y detalle), api_keys, webhooks, webhook_entregas, api_idempotencia (migración 0018) y notificaciones (migración 0013)."
keywords: [operaciones_sii, auditoría, resultado, resultado_operacion, en_curso, confirmada, ensayo, mensaje, detalle, revisada_en, revisada_por, abandonada, detalleSeguro, sanearDetalle, agregarDetalle, operacion_sii, canal_sii, api_key_id, envio_id, solicitud_id, documento_id, iniciada_en, terminada_en, Realtime, api_keys, webhooks, webhook_entregas, seguimiento, consultar_envio, cerrarAbandonadas, notificaciones, migración 0013, reclamar_notificacion, api_idempotencia, migración 0018, reenviada_en, webhooks_url_permitida]
related: ["01-fundamentos/errores-y-resultados.md", "09-libreria/backend-service-role.md", "06-integraciones/realtime-y-storage.md", "06-integraciones/overview.md", "03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §13 §14 §17", "supabase/migrations/0006_realtime_operaciones.sql", "apps/web/src/server/sii/operacion.ts", "apps/web/src/server/sii/errores.ts", "apps/web/src/server/seguimiento/cron.ts", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0018_api_webhooks.sql"]
---

# Objetos: auditoría e integraciones

> **Úsalo cuando:** necesitas los campos de auditoría, API keys o webhooks.

Leyenda: ✔ obligatoria (`not null` sin default útil) · 🔒 solo `service_role`.

> **Migración 0018 (Fase 11): aplicada en producción el 2026-11-19.** Lo marcado «0018» abajo
> (`api_idempotencia`, columnas de reenvío, índices y el check de la URL) ya existe en
> producción.

## `operaciones_sii`

Una fila por operación que sale (o habría salido, en un ensayo) al SII (§13 de `0001`).
**La escribe solo la capa SII** con `service_role`, desde `ejecutarOperacion()` y
`marcarInciertaRevisada()` (`server/sii/operacion.ts`). Los miembros la leen (política
`lectura`, `es_miembro(organizacion_id)`; `authenticated` no tiene políticas de escritura)
y, con la migración 0006, la reciben por Realtime
([Realtime](../06-integraciones/realtime-y-storage.md#realtime)).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()`. Es el `operacionId` que devuelve `ejecutarOperacion` |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade`. Toda consulta de la capa filtra por ella |
| `empresa_id` | `uuid` | FK `empresas`, `on delete set null`. Nulo si la operación no es de una empresa; las de efecto global siempre la llevan (sin ella, `ejecutarOperacion` devuelve `motivo: 'uso'` sin insertar) |
| `usuario_id` | `uuid` | FK `auth.users`, `on delete set null`. Nulo en cron y API pública |
| `api_key_id` | `uuid` | FK `api_keys` (`operaciones_api_key_fk`), `on delete set null`. Lo pone la API pública (Fase 11) con `usuario_id` nulo; índice parcial `operaciones_sii_api_key` (0018) |
| `operacion` ✔ | `operacion_sii` | qué se hizo (tabla abajo) |
| `ambiente` ✔ | `ambiente_sii` | `certificacion` o `produccion` |
| `canal` | `canal_sii` | `rest` o `soap`, si aplica |
| `confirmada` | `boolean` | default `false` = **ensayo** (sin `--confirmar`). `true` = se ejecutó de verdad |
| `resultado` | `resultado_operacion` | default `en_curso`; al cerrar, el equivalente al código de la CLI 0–7 ([tabla](../01-fundamentos/errores-y-resultados.md#resultado_operacion-y-los-códigos-de-la-cli)) |
| `mensaje` | `text` | lo que vio el usuario, en una línea (`titulo. detalle`, `mensajeEnTexto()`). Nulo si `ok`. Nunca tokens, claves ni cookies |
| `detalle` | `jsonb` | default `'{}'`. Datos técnicos **saneados** (abajo) |
| `envio_id` | `uuid` | FK `envios`, `on delete set null` |
| `solicitud_id` | `uuid` | FK `solicitudes_folios`, `on delete set null` |
| `documento_id` | `uuid` | FK `documentos`, `on delete set null` |
| `iniciada_en` | `timestamptz` | default `now()`; la capa **no** la envía: la pone la base, así el orden de las filas no depende del reloj de cada función |
| `terminada_en` | `timestamptz` | `check (resultado = 'en_curso' or terminada_en is not null)` |

Índices: `(organizacion_id, iniciada_en desc)` (listado del panel),
`(empresa_id, operacion, iniciada_en desc)` y, con la migración 0007, el índice **único
parcial** `operaciones_sii_efecto_global_en_curso` sobre `(empresa_id, operacion, ambiente)`
`where resultado = 'en_curso' and confirmada and operacion in ('solicitar_folios', 'postular', 'declarar')`:
una sola operación de efecto global confirmada en curso por empresa y ambiente. La lista es
`OPERACIONES_EFECTO_GLOBAL` de `operacion.ts` (van juntas); un insert que choca da 23505 y
la capa no ejecuta. Los NULL de `empresa_id` no chocan; los ensayos, las demás operaciones y
las filas cerradas no entran al índice. La consulta del bloqueo por incierto filtra por
organización, empresa, operación, ambiente, `confirmada = true` y
`resultado not in ('uso', 'config')`, y toma la más reciente
([regla del incierto](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)).

### `operacion` (enum `operacion_sii`)

| Valor | ⚠️ graba en el SII (`OPERACIONES_QUE_GRABAN`) | Bloqueo por incierto (`OPERACIONES_EFECTO_GLOBAL`) |
|---|---|---|
| `autenticar` (login AUT2000), `obtener_token` (semilla + token) | 🔁 no | no |
| `postular` | ⚠️ sí | **sí** |
| `descargar_set` | ⚠️ sí | no |
| `solicitar_folios` | ⚠️ sí | **sí** |
| `enviar_set` | ⚠️ sí | no aquí: lo bloquea el asistente con `bloqueoEnvioSet` (Fase 5), sin índice único |
| `estado_envio`, `verificar_portal`, `estado_declaracion` | 🔁 no | no |
| `solicitar_revision` | ⚠️ sí | no |
| `declarar` | ⚠️ sí | **sí** |
| `enviar_rcof` 🕰️ | ⚠️ sí | no |
| `emitir` | ⚠️ sí | no aquí: por documento (`envios.incierto`; el documento `incierto` no se reemite) y, en la pantalla, por sesión del navegador (Fase 7) |
| `consultar_envio`, `seguimiento` | 🔁 no | no |
| `verificar_autorizacion` (migración `0010_verificar_autorizacion`, aplicada el 2026-11-14; `verificarAutorizacion`) | 🔁 no | no |

### Qué guarda la capa en `detalle`

Siempre un objeto JSON pasado por `sanearDetalle()`
([reglas](../08-esquema-supabase/vault-y-secretos.md#capa-sii-serversiierrorests)):

| Clave | Cuándo | Contenido |
|---|---|---|
| lo que pase `fn` | `agregarDetalle(datos)` durante la operación | datos acotados (tipo de documento, cantidad, folios, Track ID…), saneados y combinados |
| `error` | al cerrar con un resultado que no es `ok` | `detalleSeguro(error)`: `nombre`, y según el error `status` y `host` (transporte), `estado` y `glosa` (respuesta del SII), `folio_desde`/`folio_hasta`/`ambiente` (folios sin CAF), `folio_sugerido`/`ambiente` (folio inicial), `rut_empresa` (declaración incierta). Nunca `cause`, stack ni el `message` de un error desconocido |
| `revisada_en`, `revisada_por` | `marcarInciertaRevisada()` | ISO y id del usuario. Con `revisada_en` presente, la fila ya no bloquea reintentos |
| `abandonada` | `marcarInciertaRevisada()` sobre una `en_curso` de más de 15 min | `true`; además la fila pasa a `resultado = 'incierto'` con `terminada_en` |

Ejemplo de una solicitud de folios incierta, ya revisada:

```json
{
  "tipo_dte": 39,
  "cantidad": 5,
  "error": { "nombre": "FoliosSinCafError", "folio_desde": 101, "folio_hasta": 105, "ambiente": "certificacion" },
  "revisada_en": "2026-11-13T15:02:11.000Z",
  "revisada_por": "0b8f2c1e-5a4d-4c3b-9e2f-1a2b3c4d5e6f"
}
```

`detalle` y `mensaje` los ve cualquier miembro de la organización (también un lector) y
llegan por Realtime: no pongas ahí nada que un lector no deba ver.

**Lo que agrega el asistente de certificación (Fase 5)** con `agregarDetalle`, todo en
`ambiente = 'certificacion'`:

| `operacion` | Claves de `detalle` | Enlaces |
|---|---|---|
| `verificar_portal` | `problemas` (cantidad) y, si hay, `faltantes` | — |
| `postular` | `avisos_sii` (cantidad) | — |
| `descargar_set` | `codigo_estado`; `casos` o `set_ilegible: true` | — |
| `solicitar_folios` | `cantidad`, `solicitud_id`; con CAF, `folio_desde`, `folio_hasta` | `solicitud_id` |
| `enviar_set` | `folios` (los asignados); `track_id`, o `incierto: true`, o `folios_anulados` (cantidad) | `envio_id`; `canal = 'rest'` |
| `estado_envio` | `estado`, `informados` | `envio_id`; `canal = 'rest'` |
| `solicitar_revision` | `track_id` | — |
| `estado_declaracion` | `codigo_estado`, `paso` | — |
| `declarar` | `codigo_estado` | — |
| `verificar_autorizacion` (la única con `ambiente = 'produccion'`) | `respuesta` (`autorizada`, `sin_representacion` o `no_autorizada`); si está autorizada, `nro_resol`, `fch_resol`, `fecha_autorizacion` y `resolucion` (`igual`, `registrada` o `reemplazada`); del STC, `stc` (`boleta`, `sin_boleta` o `no_disponible`) y, con `boleta`, `stc_ultimo_anio`. Nunca correos, URL ni nombre del software, ni otros datos del STC | — |

Desde la Fase 6, `solicitar_folios` (del asistente y de `/folios`) pasa por
`solicitarEnSii` (`server/folios/sii.ts`), que agrega además `nivel` (`revision` o
`timbrar`) y `tipo_dte`. La de `/folios` puede ser de producción, y la **revisión con el
SII** deja una fila `confirmada = false` que sí salió al SII (no timbra; la solicitud queda
`simulada`). La carga manual de un CAF y la anulación no dejan fila
([folios](../02-guias/folios-caf.md)).

Los ensayos del asistente no dejan fila
([guía](../02-guias/certificacion-empresa.md#ensayo-y-confirmación)).

**La emisión (Fase 7)** deja una fila `emitir` por boleta confirmada (`canal = 'rest'`,
`confirmada = true`, en el ambiente del borrador), con la columna `documento_id` (por eso
llama a `ejecutarOperacion` directo) y `envio_id` (el envío del último intento). En
`detalle`: `documento_id`, `tipo_dte`, `folio`, `caf_id`, `intentos` (sube con cada folio
anulado en paralelo, hasta 3) y, según cómo termine, `track_id`, `incierto: true` o
`folios_anulados` (la **lista** de folios anulados, no la cantidad como en `enviar_set`).
El ensayo no deja fila; tampoco una validación previa que falla ni «Guardar borrador»
([guía](../02-guias/emision-boletas.md#qué-queda-en-operaciones_sii)).

**El seguimiento (Fase 8)** deja dos tipos de fila, ambas 🔁 y `confirmada = true`:

| `operacion` | Cuándo | Columnas | `detalle` |
|---|---|---|---|
| `seguimiento` | una por grupo (organización + empresa + ambiente + canal) y corrida del cron | `usuario_id` nulo, `ambiente` y `canal` del grupo, sin `envio_id` | `envios`, `consultados`, `cambiados`, `errores`, `postergados`, `sinCerrar` |
| `consultar_envio` | una por «Consultar estado en el SII» que sale al SII | `usuario_id`, `envio_id`, ambiente y canal del envío | `estado`, `informados` y `cambio`, o `sin_detalle: true` / `ya_final: true` |

El resultado de `seguimiento` es `ok` si al menos una consulta respondió; si fallaron todas,
el de la última falla (p. ej. `transporte`). Si Vercel corta la función, la fila queda
`en_curso` y la corrida siguiente la cierra como `error` con `detalle = { abandonada: true }`
pasados 15 minutos (`cerrarAbandonadas`). «Ya lo revisé» de un envío incierto marca
`revisada_en` / `revisada_por` en la fila `emitir` incierta enlazada al envío
([seguimiento](../02-guias/seguimiento-envios.md#envíos-inciertos-y-ya-lo-revisé)).

## `notificaciones` (migración 0013)

**Aplicada** (2026-11-17). Una fila por alerta por correo ya reclamada o enviada (Fase 8);
la escribe solo el backend (`reclamar_notificacion` y `update` con `service_role`), la leen
los miembros de la organización. Sin Realtime.

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade` |
| `tipo` ✔ | `text` | formato de evento (`documento.rechazado`, `envio.incierto`, `certificado.por_vencer`); `check` `^[a-z][a-z_]*\.[a-z][a-z_]*$`. Texto, no enum: un aviso nuevo no pide migración |
| `referencia_id` | `uuid` | documento, envío o certificado; sin FK (apunta a tablas distintas) |
| `clave` ✔ | `text` | única; empieza por `<tipo>:` (`documento.rechazado:<id>`, `envio.incierto:<id>`, `certificado.por_vencer:<id>:<umbral>`), hasta 200 |
| `grupo` | `text` | `Idempotency-Key` del correo que la lleva (los rechazos de una organización, empresa y ambiente van juntos); se fija antes de enviar |
| `datos` | `jsonb` | objeto; lo mínimo para auditar (empresa, ambiente, umbral, envío) |
| `destinatarios` | `text[]` | hasta 50 correos |
| `estado` | `text` | `pendiente` (reclamada, saliendo), `enviada` (con `enviado_en`, obligatorio) o `fallida` |
| `intentos` | `integer` | 1–100; después de 5 no se reclama más |
| `resend_id`, `error` | `text` | id de Resend; motivo acotado (≤ 500), nunca el cuerpo del correo ni la API key |
| `creado_en`, `actualizado_en`, `enviado_en` | `timestamptz` | `actualizado_en` por `trg_90_actualizado_en` |

Contratos en [RPC del backend](../03-api-reference/rpc-backend.md#notificaciones-migración-0013).

### Ciclo de vida de una fila

```
insert (resultado = en_curso, terminada_en = null)
  └─ update al terminar: resultado, mensaje, detalle, terminada_en
     └─ (solo incierto) update de marcarInciertaRevisada: detalle.revisada_en / revisada_por
```

- Si la operación no llegó a ejecutarse (sesión inválida, incierto pendiente, otra en
  curso, falla al consultar), **no hay fila**.
- Si el cierre falla, la fila queda `en_curso`; pasados 15 min cuenta como abandonada.
- No hay `delete` desde la app; las filas se van en cascada con la organización.

## `api_keys` (0001)

API keys de la API pública (Fase 11). Se crean solo con `crear_api_key` (la clave en claro
se devuelve una vez); la fila guarda su sha256. Lectura, edición (`nombre`, `revocada_en`,
`expira_en`) y borrado: administradores (`es_admin`). La API las autentica con
`autenticar_api_key` 🔒 (0018).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK; va en `operaciones_sii.api_key_id` y `api_idempotencia.api_key_id` |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade`; índice `api_keys_organizacion` (0018) |
| `empresa_id` | `uuid` | FK `empresas`, `on delete cascade`. Nulo = todas las empresas de la organización |
| `nombre` ✔ | `text` | lo pone el administrador |
| `prefijo` ✔ | `text` | 6–16 caracteres visibles; `crear_api_key` guarda los 12 primeros (`sk_test_ab12`) |
| `clave_hash` ✔ | `text` | sha256 hex (64), único. No se puede cambiar con la sesión |
| `alcances` | `text[]` | default `{documentos:leer}`; ⊆ los 6 alcances (`certificacion:gestionar` reservado) |
| `ambiente` | `ambiente_sii` | default `certificacion`; `sk_test_` = certificación, `sk_live_` = producción |
| `ultimo_uso_en` | `timestamptz` | lo marca `autenticar_api_key`, como mucho una vez por minuto |
| `expira_en`, `revocada_en` | `timestamptz` | vencida o revocada → la API responde 401 |
| `creado_por`, `creado_en` | | FK `auth.users` `on delete set null` |

## `webhooks` (0001)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade`; índice `webhooks_organizacion` (0018) |
| `url` ✔ | `text` | `^https://` (0001) y check `webhooks_url_permitida` (0018: puerto 443, sin usuario, IP literal, `localhost`, `.local`, `.localhost`, `.internal` ni punto final; ≤ 2.048) |
| `eventos` ✔ | `text[]` | al menos uno de los 8 eventos del catálogo |
| `secreto_secret_id` ✔ | `uuid` | secreto HMAC en Vault (`whsec_…`); lo cambia `rotar_secreto_webhook`; al borrar la fila, `tg_borrar_secretos` lo saca de Vault |
| `activo` | `boolean` | default `true`. Inactivo: no se encola y lo pendiente se descarta al reclamar |
| `creado_en`, `actualizado_en` | `timestamptz` | |

Editables con la sesión (administradores): `url`, `eventos`, `activo`.

## `webhook_entregas` (0001, columnas e índices en la 0018)

Outbox: una fila por evento y webhook suscrito, insertada por `encolar_evento` (triggers) o
por `probar_webhook`. La entrega la hace `/api/cron/webhooks` con
`reclamar_entregas_webhook` y `cerrar_entrega_webhook` 🔒. Lectura: administradores.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` identity | PK. Es el id de entrega que recibe el cliente (`Boleteame-Entrega`); un reenvío conserva el mismo |
| `organizacion_id` ✔, `webhook_id` ✔ | `uuid` | FK en cascada |
| `evento` ✔ | `text` | uno del catálogo, o `webhook.prueba` |
| `payload` ✔ | `jsonb` | `{evento, creado_en, datos}` |
| `estado` | `estado_entrega_webhook` | `pendiente` · `fallido` (reintento programado) · `entregado` · `descartado` |
| `intentos` | `integer` | lo suma `reclamar_entregas_webhook`; 8 = último |
| `ultimo_status_http`, `ultima_respuesta` | | respuesta del receptor (≤ 1.000 caracteres) o el motivo del descarte |
| `siguiente_intento_en` | `timestamptz` | vencida = se puede tomar; al tomarla se corre al fin del arriendo |
| `entregado_en` | `timestamptz` | solo `entregado` |
| `reenviada_en`, `reenviada_por` | | 0018: último reenvío manual (FK `auth.users` `on delete set null`) |
| `creado_en` | `timestamptz` | |

Índices: `webhook_entregas_pendientes` (0001), y en la 0018 `webhook_entregas_por_entregar`
(`siguiente_intento_en` donde `pendiente` o `fallido`), `webhook_entregas_historial`
(`webhook_id, id desc`) y `webhook_entregas_organizacion` (`organizacion_id, id desc`). El
job `limpiar-webhook-entregas` (0019) borra las `entregado`/`descartado` de más de 30 días.

## `api_idempotencia` (0018)

🔒 Solo `service_role` (RLS activo sin políticas). Una fila por `Idempotency-Key` de la
organización. Se maneja con `reclamar_idempotencia`, `terminar_idempotencia` y
`soltar_idempotencia` ([contratos](../03-api-reference/rpc-integraciones.md#idempotencia-0018)).

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id` ✔, `clave` ✔ | `uuid`, `text` | llave primaria; `clave` `^[!-~]{1,255}$` |
| `recurso` ✔ | `text` | `documento`, `lote` o `solicitud_folios` |
| `huella` ✔ | `text` | sha256 hex del cuerpo normalizado: otra huella con la misma clave = conflicto |
| `api_key_id` | `uuid` | FK `api_keys`, `on delete set null` (índice parcial) |
| `estado` | `text` | `en_curso` o `terminada` |
| `status_http`, `respuesta`, `terminada_en` | | obligatorios juntos cuando está `terminada` (check) |
| `recurso_id` | `uuid` | documento, borrador o solicitud asociada |
| `reclamada_en` | `timestamptz` | inicio del arriendo; `-infinity` = soltada (retomable) |
| `creado_en` | `timestamptz` | |

No va en `documentos.metadata` porque la emisión reescribe `metadata` entero; además sirve
para lotes y folios. La boleta emitida por la API guarda la clave en
`documentos.clave_idempotencia` (único por organización, 0001) con `origen = 'api'`.
