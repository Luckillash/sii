---
title: "Webhooks"
description: "Eventos, outbox webhook_entregas, firma HMAC, reintentos y eventos que emite el backend. Hoy documenta los eventos que produce el asistente de certificación (Fase 5)."
keywords: [webhooks, webhook_entregas, encolar_evento, certificacion.actualizada, tg_certificacion_autorizada, envio.actualizado, documento.aceptado, documento.rechazado, documento.incierto, outbox, set de pruebas]
related: ["03-api-reference/rpc-integraciones.md", "02-guias/certificacion-empresa.md", "04-objetos/objetos-certificacion.md"]
source: ["supabase_saas_sii.sql §14 §15", "apps/web/src/server/certificacion/notificar.ts"]
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
