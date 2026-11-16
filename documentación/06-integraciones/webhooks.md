---
title: "Webhooks"
description: "Eventos, outbox webhook_entregas, firma HMAC, reintentos y eventos que emite el backend. Hoy documenta los eventos del asistente de certificación (Fase 5), folios.por_agotarse (Fase 6) y los que dispara la emisión (Fase 7)."
keywords: [webhooks, webhook_entregas, encolar_evento, certificacion.actualizada, tg_certificacion_autorizada, envio.actualizado, documento.aceptado, documento.rechazado, documento.incierto, outbox, set de pruebas, folios.por_agotarse, alertarSiCruza, umbral, agotado]
related: ["03-api-reference/rpc-integraciones.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md", "04-objetos/objetos-certificacion.md"]
source: ["supabase_saas_sii.sql §14 §15", "apps/web/src/server/certificacion/notificar.ts", "apps/web/src/server/folios/alertas.ts"]
---

# Webhooks

> **Úsalo cuando:** implementas la entrega o la recepción de webhooks.

<!-- TODO (Fase 11): alta de webhooks, firma HMAC, entrega (/api/cron/webhooks), reintentos y catálogo completo de eventos. -->

La entrega todavía no existe (Fase 11). Lo que ya ocurre es el **encolado**: triggers de
la base llaman a `encolar_evento(organizacion, evento, payload)`, que inserta una fila en
`webhook_entregas` por cada webhook **activo** de la organización suscrito a ese evento
(payload `{ evento, creado_en, datos }`). Sin webhooks suscritos, no inserta nada.

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
del lado del webhook (el correo tiene `Idempotency-Key`; la tabla `notificaciones` es de la
Fase 8): el evento sale una vez por cruce.

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
| `documento.aceptado`, `documento.aceptado_con_reparos`, `documento.rechazado` | todavía no desde la emisión: los pone la consulta del estado (Fase 8) |

`firmado`, `enviado` y `anulado` no encolan evento (`tg_evento_documento` solo los cuatro
de arriba).
