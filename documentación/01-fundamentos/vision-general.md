---
title: "Visión general del SaaS de boleta electrónica"
description: "Qué es el producto, sus piezas (Supabase, backend, librería, SII) y los módulos del esquema."
keywords: [Boletéame, organización, empresa, Vercel, gru1, Supabase, sa-east-1, Resend, Sentry, Turnstile, "@winex/certificacion", server-only, service_role, principios, módulos]
related: ["01-fundamentos/ambientes-y-credenciales.md", "08-esquema-supabase/arquitectura.md"]
source: ["supabase_saas_sii.sql (cabecera)", "certificacion-node/docs/README.md"]
---

# Visión general del SaaS de boleta electrónica

> **Úsalo cuando:** necesitas orientarte: qué hace el producto y qué pieza hace cada cosa.

## Qué es

**Boletéame** es un SaaS para emitir boletas electrónicas (DTE 39 afecta y 41 exenta) ante
el SII de Chile y para certificar empresas como emisoras. El cliente es una
**organización** (una pyme o un estudio contable) que administra una o más **empresas**
emisoras con un equipo de usuarios con roles. Facturas y demás DTE quedan para la Fase 14.

Flujo de una empresa: se registra con su resolución → carga el certificado digital (.pfx)
→ se certifica ante el SII (o se marca como autorizada fuera de Boletéame) → pide folios
(CAF) → emite, firma, timbra y envía boletas → sigue su estado en el SII.

## Piezas

```
Navegador ──▶ Next.js en Vercel (gru1) ──▶ @winex/certificacion ──TLS mutuo──▶ SII
                    │
                    ├──▶ Supabase (sa-east-1): Postgres + RLS, Auth, Vault, Storage, Realtime
                    ├──▶ Resend (correo)       └──▶ Sentry (errores y trazas)
```

| Pieza | Qué hace |
|---|---|
| Next.js (App Router, `apps/web`) | Páginas con la sesión del usuario (RLS), Server Actions, cron, API pública (Fase 11) |
| Capa SII (`apps/web/src/server/sii/`, `server-only`) | Credenciales desde Vault, tokens y sesiones cifrados, bloqueo por certificado y `ejecutarOperacion` con auditoría ([backend](../09-libreria/backend-service-role.md)) |
| `@winex/certificacion` (`packages/certificacion`) | Firma, TED, sobres, clientes REST/SOAP, folios, postulación y declaración. La app no lo reimplementa |
| Supabase | Datos con RLS por organización, Auth (con Turnstile y SMTP de Resend), Vault para .pfx, claves y CAF, Storage para XML y PDF, Realtime para el estado de las operaciones |
| Resend | Correos de Auth, invitaciones y avisos (`no-responder@mail.boleteame.dev`) |
| Sentry | Errores y trazas, con los secretos depurados |
| SII | Certificación: maullin / apicert / pangal (IDK 100). Producción: palena / api / rahue (IDK 300) |

## Principios

1. Lo que firma o habla con el SII vive solo en el servidor; el navegador nunca recibe un
   .pfx, una clave, un CAF ni un token.
2. RLS primero: `service_role` solo en la capa SII, los cron y la API pública, siempre
   filtrando por `organizacion_id`.
3. Las operaciones ⚠️ tienen ensayo y confirmación; un `incierto` bloquea el reintento.
4. Paridad con la librería: la app solo adapta persistencia, secretos y UI.
5. Toda llamada al SII deja una fila en `operaciones_sii`, sin secretos.
6. Una sola base, y es producción: guarda los dos ambientes del SII separados por `ambiente`.
7. Tono y formatos del design system: español de Chile con tú, `$ 1.190.000`,
   `76.354.771-K`, `10-11-2026`.

## Módulos del esquema ↔ librería

| Librería / CLI | Tablas |
|---|---|
| `Certificado`, `FirmaElectronica` | `certificados`, `empresa_certificados` |
| `TokenStore` | `tokens_sii` |
| `SesionSii` (AUT2000) | `sesiones_sii` (+ `bloqueos_sii`, 0007) |
| `SolicitudFolios`, CAF, `Timbre` | `solicitudes_folios`, `cafs`, `folios_anulados`, `asignar_folio()` |
| `GeneradorBoleta`, `ArmadorBoleta`, TED | `documentos`, `documento_detalles` |
| `EnvioBoleta` + clientes REST / DTEWS | `envios`, `envio_estadisticas`, `envio_rechazos`, `consultas_envio` |
| `GeneradorConsumoFolios` (🕰️) | `rcof` |
| `PostulacionSii`, `DeclaracionBoletas`, set de pruebas | `procesos_certificacion`, `set_pruebas_casos` |
| Códigos de salida 0–7, `--confirmar` | `operaciones_sii` |
| Resolución | `resoluciones` |

Más la capa SaaS: organizaciones, miembros, invitaciones, planes, suscripciones, uso
mensual, API keys y webhooks. Detalle en [mapeo librería ↔ tablas](../09-libreria/mapeo-libreria-tablas.md)
y en la [arquitectura del esquema](../08-esquema-supabase/arquitectura.md).
