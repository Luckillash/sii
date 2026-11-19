---
title: "Webhooks"
description: "Alta y administración, outbox webhook_entregas, entrega por /api/cron/webhooks, firma HMAC-SHA256 (Boleteame-Firma), verificación, SSRF, reintentos con backoff, estados y catálogo de eventos con sus payloads (certificación, folios, emisión, seguimiento, prueba)."
keywords: [webhooks, webhook_entregas, encolar_evento, crear_webhook, probar_webhook, rotar_secreto_webhook, reenviar_entrega_webhook, reclamar_entregas_webhook, cerrar_entrega_webhook, /api/cron/webhooks, entregar-webhooks, cron-webhooks, Boleteame-Firma, Boleteame-Evento, Boleteame-Entrega, Boleteame-Intento, HMAC-SHA256, whsec_, verificarFirma, SSRF, backoff, descartado, webhook.prueba, certificacion.actualizada, tg_certificacion_autorizada, envio.actualizado, documento.aceptado, documento.rechazado, documento.incierto, outbox, set de pruebas, folios.por_agotarse, certificado.por_vencer, alertarSiCruza, umbral, agotado, Fase 11]
related: ["03-api-reference/rpc-integraciones.md", "02-guias/api-publica.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md", "04-objetos/objetos-certificacion.md", "07-referencia/ejemplos-de-codigo.md"]
source: ["supabase_saas_sii.sql §14 §15", "supabase/migrations/0018_api_webhooks.sql", "supabase/migrations/0019_cron_webhooks.sql", "apps/web/src/server/webhooks/", "apps/web/src/app/api/cron/webhooks/route.ts", "apps/web/src/app/[org]/configuracion/webhooks/", "apps/web/src/lib/api-publica.ts", "apps/web/src/server/certificacion/notificar.ts", "apps/web/src/server/folios/alertas.ts", "scripts/ejemplo-api/verificar-firma.mjs"]
---

# Webhooks

> **Úsalo cuando:** implementas la entrega o la recepción de webhooks.

**Estado (2026-11-19).** Fase 11 desplegada en producción (`169e2e5`): alta, entrega y
panel funcionando. Migración `0018_api_webhooks` aplicada el 2026-11-19 (antes del deploy) y
`0019_cron_webhooks` (job `entregar-webhooks`) aplicada el mismo día a las 03:54 UTC, después
del deploy; sin la 0019 las filas se encolarían pero nadie las entregaría. Criterio de
aceptación cumplido el 2026-11-19: `webhook.prueba` y `documento.aceptado` (folio 43)
entregados con firma válida, `envio.actualizado` también, todos `entregado` al primer
intento ([registro](../02-guias/api-publica.md#criterio-de-aceptación-2026-11-19)).
Implementación en la
[guía de la API pública](../02-guias/api-publica.md#webhooks).

## Alta y administración

Configuración → Webhooks (propietario o administrador; plan con `incluye_webhooks`):

| Acción | Cómo | Notas |
|---|---|---|
| Crear | `crear_webhook(org, url, eventos)` con la sesión (0001) | Secreto `whsec_…` en Vault, mostrado **una vez** |
| Editar URL, eventos, pausar/activar | `update webhooks` con la sesión (grant de columnas `url`, `eventos`, `activo`) | URL validada con `validarUrlWebhook` y el check `webhooks_url_permitida` (0018) |
| Borrar | `delete` con la sesión | `tg_borrar_secretos` borra el secreto de Vault; las entregas se van en cascada |
| Enviar prueba | `probar_webhook(webhook)` (0018) | Encola `webhook.prueba` (no suscribible) |
| Rotar secreto | `rotar_secreto_webhook(webhook)` (0018) | Nuevo secreto, el viejo se borra de Vault en el acto (sin período de gracia); se muestra una vez |
| Reenviar una entrega | `reenviar_entrega_webhook(entrega)` (0018) | Reinicia la misma fila: `pendiente`, 0 intentos, conserva el `id` |

URL permitida: `https://`, puerto 443 (o sin puerto), sin usuario ni clave, sin IP literal
(v4 o v6), sin `localhost` ni dominios `.local`, `.localhost` o `.internal`, hasta 2.048
caracteres.

## Entrega

`pg_cron` `entregar-webhooks` (cada minuto) → `POST /api/cron/webhooks` → reclama hasta 32
entregas vencidas (`pendiente` o `fallido`), por turnos entre organizaciones, y las envía
con concurrencia 8.

Cada entrega es un `POST` con:

```
Content-Type: application/json; charset=utf-8
User-Agent: Boleteame-Webhooks/1.0 (+https://boleteame.dev/docs/api#webhooks)
Boleteame-Evento: documento.aceptado
Boleteame-Entrega: 1842
Boleteame-Intento: 1
Boleteame-Firma: t=1763496312,v1=5f2b…(64 hex)

{"id":"1842","evento":"documento.aceptado","creado_en":"…","datos":{…}}
```

- `id` (= `Boleteame-Entrega`) es el id de la fila de `webhook_entregas`: el mismo en todos
  los intentos y en los reenvíos manuales. El receptor deduplica por él.
- **Firma:** `v1` = HMAC-SHA256 en hex con el secreto `whsec_…` completo (UTF-8) como
  clave, sobre `"<t>.<cuerpo>"` (el cuerpo exacto, antes de parsear). `t` cambia en cada
  intento; el receptor rechaza `t` a más de 300 s. Puede haber varios `v1`: basta que
  calce uno. Verificación de referencia: `server/webhooks/firma.ts`; copia para clientes:
  `scripts/ejemplo-api/verificar-firma.mjs` (misma lógica y mismos motivos:
  `cabecera_invalida`, `fuera_de_tolerancia`, `firma_invalida`).
- **Entregado** = cualquier 2xx en menos de 10 s. Un 3xx cuenta como falla (no se siguen
  redirecciones), igual que un timeout o un error de red.
- **SSRF:** antes de conectar se resuelve el DNS y se rechaza si alguna dirección es
  privada, loopback, link-local, CGNAT, multicast o reservada; la conexión va a la IP ya
  validada. Una URL bloqueada se descarta sin reintentos.

## Reintentos y estados

| Estado | Etiqueta en la UI | Significa |
|---|---|---|
| `pendiente` | Pendiente | En cola, sin intentos (o reenviada) |
| `fallido` | Reintentando | Falló; tiene otro intento programado en `siguiente_intento_en` |
| `entregado` | Entregada | Respondió 2xx (`entregado_en`, `ultimo_status_http`) |
| `descartado` | Descartada | 8 intentos agotados, webhook inactivo, plan sin webhooks o URL bloqueada |

Esperas después de cada intento fallido: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h y 24 h
(±10 %); después del intento 8 (unas 44 h) queda `descartado`. `ultima_respuesta` guarda
hasta 1.000 caracteres de la respuesta. Las `entregado` y `descartado` de más de 30 días
las borra el job diario `limpiar-webhook-entregas` (0019). No hay autodesactivación del
webhook: la UI avisa si las últimas entregas fallaron.

## Encolado

Triggers de la base y la app llaman a `encolar_evento(organizacion, evento, payload)`, que
inserta una fila en `webhook_entregas` por cada webhook **activo** de la organización
suscrito a ese evento (payload `{ evento, creado_en, datos }`). Sin webhooks suscritos, no
inserta nada. Desde la 0018, tampoco si el plan vigente no incluye webhooks.

## `webhook.prueba` (Fase 11)

Lo encola `probar_webhook`. No se puede suscribir.

```json
{
  "evento": "webhook.prueba",
  "creado_en": "<now()>",
  "datos": { "webhook_id": "<uuid>", "mensaje": "<texto de prueba>" }
}
```

## `documento.*`: datos agregados en la Fase 11

La 0018 reemplaza `tg_evento_documento` para agregar a los datos de los cuatro eventos
`documento.*` los campos `estado`, `origen` (`panel`, `api`, `set_pruebas`…) y
`clave_idempotencia` (la `Idempotency-Key` con que se emitió por la API, o `null`), además
de los que ya traía (`documento_id`, `empresa_id`, `ambiente`, `tipo_dte`, `folio`,
`mnt_total`, `envio_id`).

## `certificacion.actualizada` (Fase 5)

Lo encola el trigger `tg_certificacion_autorizada` de `procesos_certificacion`, **no la
app**: en cada `update` que cambia `etapa` (también los que hace la propia base: P90 →
`por_declarar`, P91 → `autorizada`). Un `insert` no lo encola (el proceso nace en
`borrador`).

```json
{
  "evento": "certificacion.actualizada",
  "creado_en": "<now()>",
  "datos": { "empresa_id": "<uuid>", "etapa": "set_enviado", "codigo_estado_sii": null }
}
```

Por eso cada paso del asistente que mueve la etapa (postular, descargar el set con
`guardar_set_pruebas`, enviar el set, consultar su estado, pedir la revisión, guardar
P90/P91) encola el evento sin código extra. El correo a los administradores, en cambio, sí
lo manda la app (`notificar.ts`,
[avisos](../02-guias/certificacion-empresa.md#avisos-por-correo-y-webhook)).

## `folios.por_agotarse` (Fase 6)

Lo encola **la app** (`server/folios/alertas.ts`, `alertarSiCruza`, con `service_role`)
cuando los folios de una empresa, en un ambiente y para un tipo, cruzan el 15 % o se agotan
([guía](../02-guias/folios-caf.md#alerta-foliospor_agotarse)). Hoy lo dispara anular la cola
de un CAF y, desde la Fase 7, cada emisión `ok` cuyo folio cruce. El evento ya estaba en
la lista permitida de `webhooks.eventos` (0001).

```json
{
  "evento": "folios.por_agotarse",
  "creado_en": "<now()>",
  "datos": {
    "empresa_id": "<uuid>",
    "rut_empresa": "76354771-K",
    "ambiente": "produccion",
    "tipo_dte": 39,
    "folios_disponibles": 12,
    "folios_total": 100,
    "umbral": 0.15,
    "agotado": false,
    "caf_id": "<uuid del CAF en uso, o null>"
  }
}
```

`agotado: true` con `folios_disponibles: 0` cuando se acabaron (y entonces `folios_total`
puede ser 0: ya no queda ningún CAF con folios libres). Sin secretos. No hay deduplicación
del lado del webhook (el correo tiene `Idempotency-Key`; la tabla `notificaciones` de la
Fase 8 solo cubre los correos de rechazos, inciertos y certificados): el evento sale una vez
por cruce.

## Eventos del set de pruebas

El envío del set es una fila normal de `envios` (`proposito = 'set_pruebas'`) con sus
`documentos`, así que también dispara los triggers de envíos y documentos (no filtran por
propósito; solo excluyen `rcof`):

| Evento | Cuándo, en el asistente |
|---|---|
| `envio.actualizado` | al cambiar `estado_sii`, `incierto` o los conteos del envío del set (subida con estado, envío incierto, cada consulta de estado que cambia algo) |
| `documento.aceptado`, `documento.aceptado_con_reparos`, `documento.rechazado`, `documento.incierto` | cuando la sincronización con el envío deja una boleta del set en ese estado |

Un integrador que solo quiera la operación real tiene que mirar `ambiente` en el payload de
`envio.actualizado` (`certificacion` para el set).

## Eventos de la emisión (Fase 7)

La emisión del panel tampoco encola eventos con código propio (salvo
`folios.por_agotarse`, arriba): los mismos triggers de envíos y documentos los encolan.

| Evento | Cuándo, al emitir |
|---|---|
| `envio.actualizado` | al guardar el Track ID con un `estado_sii` de subida, o al marcar el envío `incierto` |
| `documento.incierto` | cuando el envío queda `incierto` y el trigger pasa la boleta a `incierto` |
| `documento.aceptado`, `documento.aceptado_con_reparos`, `documento.rechazado` | no al emitir: los pone la consulta del estado del seguimiento (Fase 8, cron o «Consultar estado en el SII»), cuando el envío llega a `EPR` o a un rechazo del sobre. El seguimiento guarda los rechazos **antes** que el estado del envío para no encolar un `documento.aceptado` falso ([seguimiento](../02-guias/seguimiento-envios.md#qué-se-escribe-por-consulta-y-en-qué-orden)); `envio.actualizado` sale con cada cambio de estado o conteos |

`firmado`, `enviado` y `anulado` no encolan evento (`tg_evento_documento` solo los cuatro
de arriba).

## Catálogo

| Evento | Quién lo encola | Desde |
|---|---|---|
| `documento.aceptado`, `documento.aceptado_con_reparos`, `documento.rechazado`, `documento.incierto` | trigger `tg_evento_documento` (base) | 0001; datos ampliados en la 0018 |
| `envio.actualizado` | trigger de `envios` (base) | 0001 |
| `certificacion.actualizada` | trigger `tg_certificacion_autorizada` (base) | 0001 |
| `folios.por_agotarse` | la app (`server/folios/alertas.ts`) | Fase 6 |
| `certificado.por_vencer` | en el catálogo de la 0001; si el cron de alertas lo encola, va con `{ certificado_id, rut_titular, vigente_hasta, dias_restantes, umbral }` (opcional en la Fase 11: revisar `server/alertas/` antes de prometerlo a un cliente) | — |
| `webhook.prueba` | `probar_webhook` (0018) | Fase 11 |

Los eventos del set de pruebas de la certificación salen con `ambiente = 'certificacion'`:
un integrador que solo quiera la operación real filtra por `ambiente` (y, en los
`documento.*`, por `origen`).
