---
title: "Integraciones: visión general"
description: "Cómo se integra el sistema de un cliente con Boletéame: API REST /api/v1 con API keys e idempotencia, webhooks firmados, OpenAPI y /docs/api; además Realtime y Storage para el panel."
keywords: [integraciones, API pública, /api/v1, API key, webhooks, OpenAPI, /docs/api, Realtime, Storage, Fase 11]
related: ["02-guias/api-publica.md", "06-integraciones/api-keys.md", "06-integraciones/webhooks.md", "06-integraciones/realtime-y-storage.md", "07-referencia/ejemplos-de-codigo.md"]
source: ["supabase_saas_sii.sql §14 §18 §19", "PLAN-SAAS.md Fase 11", "apps/web/src/lib/api-publica.ts", "apps/web/src/lib/openapi-v1.ts"]
---

# Integraciones: visión general

> **Úsalo cuando:** el cliente quiere integrar su sistema con el SaaS.

**Estado (2026-11-19).** Fase 11 con el código escrito; migración `0018` aplicada el
2026-11-19 y `0019` escrita, pendiente de aplicar (después del deploy); criterio de
aceptación pendiente
([guía](../02-guias/api-publica.md)).

| Mecanismo | Para qué | Quién | Detalle |
|---|---|---|---|
| **API REST** `https://boleteame.dev/api/v1` | Emitir boletas (de a una o en lote), listarlas, descargar XML y PDF, ver folios y pedirlos, ver envíos | El sistema del cliente, de servidor a servidor, con una API key | [API keys](api-keys.md), [guía](../02-guias/api-publica.md), página pública `/docs/api` |
| **Webhooks** | Enterarse sin consultar: el SII aceptó o rechazó una boleta, un envío quedó incierto, quedan pocos folios, avanza la certificación | Una URL https pública del cliente; firma HMAC-SHA256 | [webhooks](webhooks.md) |
| **OpenAPI 3.1** `/api/v1/openapi.json` | Generar clientes, importar en Postman o similares | Público | `lib/openapi-v1.ts` |
| Realtime y Storage | El panel en vivo y los archivos XML/PDF | Solo la app (sesión del usuario) | [Realtime y Storage](realtime-y-storage.md) |

Requisitos del plan: la API exige `planes.incluye_api` y los webhooks
`planes.incluye_webhooks` (hoy los planes `api` y `empresa`; [planes](../02-guias/planes-y-pagos.md)).
Si la organización baja a un plan sin API, las claves responden `403 plan_sin_api` y los
webhooks dejan de acumular entregas.

Flujo típico de un integrador:

1. Un administrador crea una API key de certificación (`sk_test_…`) en Configuración → API
   y un webhook en Configuración → Webhooks (guarda el secreto `whsec_…`).
2. El sistema emite con `POST /documentos` y una `Idempotency-Key` por venta. Si la
   conexión se corta, repite con la misma clave.
3. Recibe `documento.aceptado` (o `documento.rechazado`, `documento.incierto`) en su URL,
   verifica la firma y actualiza su venta. Para el estado actual consulta
   `GET /documentos/{id}`.
4. Terminada la certificación de la empresa, crea una clave de producción (`sk_live_…`).

Cliente de ejemplo: `scripts/ejemplo-api/` ([ejemplos de código](../07-referencia/ejemplos-de-codigo.md)).
