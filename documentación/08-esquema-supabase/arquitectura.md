---
title: "Esquema: arquitectura"
description: "Secciones del SQL, relaciones entre tablas y decisiones de diseño."
keywords: [secciones, migraciones, 0001_esquema_inicial, organizacion_id, relaciones, empresas, tenant, Vault, secret_id, ambiente, aditiva, verificaciones]
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
