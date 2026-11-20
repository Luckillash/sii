---
title: "Esquema: arquitectura"
description: "Secciones del SQL, relaciones entre tablas y decisiones de diseño."
keywords: [secciones, migraciones, 0001_esquema_inicial, organizacion_id, relaciones, empresas, tenant, Vault, secret_id, ambiente, aditiva, verificaciones, 0010_verificar_autorizacion, 0011_folios, 0012_folio_anulado, 0013_notificaciones, notificaciones, 0014_cron, 0015_planes_comerciales, 0016_pagos, 0017_cron_suscripciones]
related: ["01-fundamentos/vision-general.md"]
source: ["supabase_saas_sii.sql"]
---

# Esquema: arquitectura

> **Úsalo cuando:** vas a entender o modificar supabase_saas_sii.sql.

`supabase_saas_sii.sql` es la migración `0001_esquema_inicial.sql`, tal cual. **Nunca se
edita la `0001`**: todo cambio va en una migración nueva, aditiva, con su verificación de
solo lectura en `supabase/verificaciones/` ([despliegue](despliegue.md)).

## Secciones del SQL

| § | Contenido |
|---|---|
| 1 | Tipos (enums): [códigos y enumeraciones](../04-objetos/codigos-y-enumeraciones.md) |
| 2 | Validaciones: `rut_valido`, `correo_sii_valido`, `uuid_o_nulo`, `clasificar_envio` y dominios |
| 3 | Catálogos: `tipos_dte`, `estados_sii`, `planes` |
| 4 | Tenancy: `perfiles`, `organizaciones`, `miembros_organizacion`, `invitaciones`, `suscripciones`, `uso_mensual` ([objetos](../04-objetos/objetos-tenancy.md)) |
| 5 | Funciones de acceso para RLS: `es_miembro`, `tiene_rol`, `es_admin`, `puede_emitir`, `comparte_organizacion` |
| 6 | Empresas y credenciales: `empresas`, `resoluciones`, `certificados`, `empresa_certificados`, `tokens_sii`, `sesiones_sii` |
| 7 | Folios: `cafs`, `solicitudes_folios`, `folios_anulados` |
| 8 | Catálogo comercial: `receptores`, `productos` |
| 9 | Envíos: `envios`, `envio_estadisticas`, `consultas_envio` |
| 10 | Documentos: `documentos`, `documento_detalles`, `envio_rechazos` |
| 11 | RCOF (🕰️, hasta 2022-07) |
| 12 | Certificación: `procesos_certificacion`, `set_pruebas_casos` |
| 13 | Auditoría: `operaciones_sii` |
| 14 | Integraciones: `api_keys`, `webhooks`, `webhook_entregas` (outbox) |
| 15 | Triggers y funciones ([triggers](triggers-y-logica.md), [RPC](../03-api-reference/rpc-backend.md)) |
| 16 | Vistas `security_invoker` (respetan el RLS de quien consulta) |
| 17 | RLS y privilegios ([RLS](rls-y-privilegios.md)) |
| 18 | Storage: bucket de XML y PDF, ruta `<organizacion_id>/<empresa_id>/<ambiente>/<archivo>` |
| 19 | Realtime (envíos y documentos) |

## Migraciones posteriores

| Migración | Qué agrega |
|---|---|
| `0002_extensiones_cron` | Extensiones `pg_cron` y `pg_net` |
| `0003_preferencias` | `perfiles.tema`, `ultima_organizacion`, `ultima_empresa` |
| `0004_cupo_sin_suscripcion` | `exigir_cupo_usuarios` rechaza organizaciones sin suscripción vigente |
| `0005_certificados_resoluciones` | `registrar_certificado`, `registrar_resolucion`, `fijar_certificado_predeterminado` |
| `0006_realtime_operaciones` | `operaciones_sii` en Realtime |
| `0007_bloqueos_sii` | `bloqueos_sii` con arriendo e índice único contra el doble timbraje |
| `0008_certificacion` | `registrar_caf`, `guardar_set_pruebas` |
| `0009_autorizacion_externa` | `tg_resolucion_autoriza_produccion` |
| `0010_verificar_autorizacion` | valor `verificar_autorizacion` en el enum `operacion_sii` |
| `0011_folios` (**aplicada el 2026-11-15**) | RPC `anular_folios` y trigger `trg_20_caf_sin_traslape` en `cafs`; quita la política `alta` de `folios_anulados` (solo se escribe con la RPC o `service_role`); publica `cafs` y `folios_anulados` en Realtime ([despliegue](despliegue.md#fase-6-migración-0011)) |
| `0012_folio_anulado` (**aplicada el 2026-11-15**) | `tg_validar_documento` lee el CAF con `for key share` y rechaza (`23514`) un documento que fija un folio anulado ([triggers](triggers-y-logica.md#tg_validar_documento-migración-0012)) |
| `0013_notificaciones` (**aplicada el 2026-11-17**, antes del deploy de la Fase 8) | Tabla `notificaciones` (deduplicación de alertas por correo) y las RPC `reclamar_notificacion`, `notificacion_cerrada`, `alertas_documentos_rechazados`, `alertas_envios_inciertos` y `alertas_certificados_por_vencer`, solo `service_role` ([despliegue](despliegue.md#fase-8-migraciones-0013-y-0014)) |
| `0014_cron` (**aplicada el 2026-11-17**, después del deploy de la Fase 8; verificación 12/12) | Jobs de `pg_cron`: `seguimiento-envios`, `alertas`, `limpiar-tokens-sii`, `limpiar-historial-cron` (Bearer leído de Vault) |
| `0015_planes_comerciales` (**aplicada el 2026-11-18**, antes del deploy de la Fase 10; verificación 10/10) | `planes.autoservicio` y `planes.orden`; grilla D5 (`pyme`, `contador`, `api`, `empresa`; `emprendedor` inactivo); `crear_organizacion` sin `periodo_fin` (Certificación sin plazo) ([despliegue](despliegue.md#fase-10-migraciones-0015-0016-y-0017)) |
| `0016_pagos` (**aplicada el 2026-11-18**, antes del deploy de la Fase 10; verificación 20/20) | Tablas `clientes_pago`, `pagos`, `eventos_pasarela`; `suscripciones.cancelar_al_fin_periodo`, `sincronizada_en` e índice `suscripciones_externa_unica`; RPC `activar_suscripcion` (solo `service_role`) |
| `0017_cron_suscripciones` (**aplicada el 2026-11-18**, después del deploy de la Fase 10) | Job de `pg_cron` `sincronizar-suscripciones` (`41 * * * *`, `/api/cron/suscripciones`) |
| `0018_api_webhooks` (**aplicada el 2026-11-19**, antes del deploy de la Fase 11; verificación 23/23) | Tabla `api_idempotencia`; RPC de la API pública y de los webhooks (`autenticar_api_key`, idempotencia, `reclamar_entregas_webhook`, `cerrar_entrega_webhook`, `reenviar_entrega_webhook`, `probar_webhook`, `rotar_secreto_webhook`); `encolar_evento` filtrado por plan ([despliegue](despliegue.md#fase-11-migraciones-0018-y-0019)) |
| `0019_cron_webhooks` (**aplicada el 2026-11-19**, después del deploy de la Fase 11; verificación 9/9) | Jobs de `pg_cron` `entregar-webhooks` (`* * * * *`, `/api/cron/webhooks`), `limpiar-webhook-entregas` (`37 4 * * *`) y `limpiar-api-idempotencia` (`47 4 * * *`) |
| `0020_endurecimiento` (**aplicada** el 2026-11-20 a las 01:23 UTC; verificación 9/9) | Check `organizaciones_slug_no_reservado` (los 26 `SLUGS_RESERVADOS` de `lib/rutas.ts`); 53 índices para las 54 FK sin índice (`unindexed_foreign_keys`); índices de `operaciones_sii` por `(ambiente, terminada_en)` y `(operacion, resultado, terminada_en desc)` para `/estado`; `revoke execute` de `tg_api_key_sin_reactivar` a PUBLIC ([despliegue](despliegue.md#fase-13-migración-0020)) |

Aplicadas en producción: `0001`–`0019` (la `0011` y la `0012`, el 2026-11-15; la `0013` y la
`0014`, el 2026-11-17, la 0014 después del deploy de la Fase 8; la `0015` y la `0016`, el
2026-11-18, la `0017` después del deploy de la Fase 10; la `0018` y la `0019` el 2026-11-19, la 0019 después del deploy de la Fase 11). Los índices de FK
(`unindexed_foreign_keys`) los agregó la `0020_endurecimiento` (Fase 13, aplicada el 2026-11-20).

## Relaciones

```
organizaciones ─┬─ miembros_organizacion ── auth.users ── perfiles
                ├─ invitaciones · suscripciones ── planes · uso_mensual
                ├─ api_keys · webhooks ── webhook_entregas
                ├─ certificados ──┐
                └─ empresas ──────┴─ empresa_certificados
                     ├─ resoluciones
                     ├─ cafs ── folios_anulados        solicitudes_folios
                     ├─ receptores · productos
                     ├─ documentos ── documento_detalles
                     ├─ envios ─┬─ envio_estadisticas · consultas_envio
                     │          └─ envio_rechazos ── (documento)
                     ├─ rcof
                     └─ procesos_certificacion ── set_pruebas_casos
operaciones_sii (organización, empresa opcional) · tokens_sii · sesiones_sii · bloqueos_sii
```

## Decisiones de diseño

- **`organizacion_id` en toda tabla de negocio**, heredado del padre por `trg_00_organizacion`
  (no lo elige el cliente). RLS filtra por membresía con las funciones de la §5.
- **Secretos en Vault**, nunca en columnas: las tablas guardan solo `*_secret_id`, y
  `trg_borrar_secretos` limpia al borrar. Tokens y cookies van cifrados por el backend
  (AES-256-GCM, llave fuera de la base) en tablas sin políticas.
- **Escritura repartida**: el usuario escribe configuración y borradores (RLS); lo que viene
  del SII (certificados, CAF, envíos, estados, operaciones) lo escribe solo `service_role`, y
  los campos que fija el SII están protegidos por triggers.
- **Ambiente como columna** (`ambiente_sii`): certificación y producción conviven en la misma
  base de producción.
- **Montos en pesos enteros** (`bigint`; la librería rechaza desde 1e15) y fechas del SII en
  hora de Chile.
- **Paridad con la librería**: enums y estados copian los de la CLI (`resultado_operacion` =
  códigos 0–7, `clasificacion_envio` = `sii produccion seguimiento`).
