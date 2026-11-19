---
title: "Reglas y límites"
description: "Datos rápidos: vigencias, topes, largos, límites de plan y plazos. Hoy cubre los límites de la API pública y de los webhooks (Fase 11)."
keywords: [límites, topes, API pública, LIMITE_LOTE, LIMITE_PAGINA, MAXIMO_CUERPO_BYTES, Idempotency-Key, arriendo, webhooks, MAX_INTENTOS_WEBHOOK, ESPERAS_WEBHOOK_MIN, TIMEOUT_ENTREGA_MS, TOLERANCIA_FIRMA_S, 429, Fase 11]
related: ["01-fundamentos/formatos-y-validaciones.md", "02-guias/api-publica.md", "06-integraciones/webhooks.md", "02-guias/planes-y-pagos.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/glosario.md", "apps/web/src/lib/api-publica.ts", "apps/web/src/lib/emision.ts", "supabase/migrations/0018_api_webhooks.sql"]
---

# Reglas y límites

> **Úsalo cuando:** necesitas un dato rápido.

<!-- TODO: vigencias, largos y plazos del SII y del esquema (Fases 3–8). Los límites de plan están en 02-guias/planes-y-pagos.md. -->

## API pública (Fase 11)

Fuente: `apps/web/src/lib/api-publica.ts` (constantes sincronizadas con la 0018 donde se indica).

| Límite | Valor | Qué pasa al pasarlo |
|---|---|---|
| Cuerpo de una petición | 256 KB (`MAXIMO_CUERPO_BYTES`) | `413 cuerpo_muy_grande` |
| Líneas por boleta | 100 (`MAXIMO_LINEAS` de `lib/emision.ts`) | `422 datos_invalidos` |
| Boletas por lote | 25 (`LIMITE_LOTE`) | `422 datos_invalidos` |
| Tiempo de un lote | No se empieza una boleta después de los 200 s (`maxDuration = 300`; una emisión puede tardar 60 s) | Lo que falta queda `pendiente`; se repite con la misma clave |
| Página de un listado | 20 por defecto, 100 como máximo (`LIMITE_PAGINA`, `LIMITE_PAGINA_MAXIMO`) | `400 parametro_invalido` |
| `Idempotency-Key` | 1 a 200 caracteres ASCII visibles (`FORMATO_IDEMPOTENCIA`; la base acepta 255 por el `#n` del lote) | `400 idempotencia_invalida` |
| Arriendo de una clave en curso | 120 s (`SEGUNDOS_ARRIENDO_IDEMPOTENCIA`) | Después, otra petición con la misma clave la retoma |
| Peticiones por IP | Regla «API pública: límite por IP» del Firewall de Vercel en `/api/v1/*` (configurada el 2026-11-19): ventana fija de 60 s, 120 por IP | `429` del firewall, sin el JSON de error de la API |
| `ultimo_uso_en` de una clave | Se actualiza como máximo una vez por minuto | — |
| Boletas del mes | Cupo del plan (`plan_vigente`) | `403 cuota_agotada` |
| Revisión antes de timbrar folios (producción) | 30 minutos, un solo uso | `422 revision_requerida` |

## Webhooks (Fase 11)

| Límite | Valor |
|---|---|
| URL | `https://`, puerto 443, hasta 2.048 caracteres (`MAXIMO_URL_WEBHOOK`), sin IP ni dominios locales |
| Tiempo para responder | 10 s (`TIMEOUT_ENTREGA_MS`); se cuenta como falla |
| Tolerancia de la firma | 300 s entre `t` y el reloj del receptor (`TOLERANCIA_FIRMA_S`) |
| Intentos | 8 (`MAX_INTENTOS_WEBHOOK`, sincronizado con la 0018) |
| Esperas entre intentos | 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, ±10 % (`ESPERAS_WEBHOOK_MIN`); unas 44 h en total |
| Entregas por corrida del cron | 32, concurrencia 8, ninguna empieza después del segundo 45 |
| Respuesta guardada | 1.000 caracteres (`ultima_respuesta`) |
| Historial | `entregado` y `descartado` se borran a los 30 días (job `limpiar-webhook-entregas`, 0019) |
