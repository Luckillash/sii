---
title: "Checklist de paso a producción"
description: "Lo que debe cumplirse antes de emitir boletas reales y antes de cobrar: el seguimiento y las alertas de la Fase 8 (CRON_SECRET, cron_token, migraciones 0013 y 0014, monitores de Sentry) y los planes y pagos con Flow de la Fase 10 (sandbox y paso a producción)."
keywords: [checklist, producción, Fase 8, seguimiento, alertas, CRON_SECRET, cron_token, migración 0013, migración 0014, pg_cron, cron-seguimiento, cron-alertas, net._http_response, Resend, NEXT_PUBLIC_APP_URL, Fase 10, Flow, FLOW_API_URL, FLOW_API_KEY, FLOW_SECRET_KEY, planes de Flow, boleta propia, cron-suscripciones, 0017_cron_suscripciones]
related: ["02-guias/certificacion-empresa.md", "02-guias/seguimiento-envios.md", "08-esquema-supabase/despliegue.md", "02-guias/planes-y-pagos.md"]
source: ["certificacion-node/docs/piloto-produccion.md", "PLAN-SAAS.md Fase 8, Fase 10 y Fase 13", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql", "supabase/migrations/0017_cron_suscripciones.sql", "apps/web/src/server/env.ts"]
---

# Checklist de paso a producción

> **Úsalo cuando:** vas a habilitar a una empresa en producción.

<!-- TODO (Fase 13): redactar el checklist completo (empresa, certificado, resolución, CAF de producción, plan, piloto). -->

## Seguimiento de envíos y alertas (Fase 8)

Sin esto, las boletas emitidas quedan `enviado` para siempre (nadie consulta su estado) y
nadie se entera de un rechazo o de un envío incierto. Detalle en la
[guía de seguimiento](../02-guias/seguimiento-envios.md) y los pasos en
[despliegue](../08-esquema-supabase/despliegue.md#fase-8-migraciones-0013-y-0014).

Estado al 2026-11-17: Fase 8 desplegada (`3ade4c9`), migraciones 0013 y 0014 aplicadas y
cron verificado en producción. El arreglo de Realtime en cargas completas está desplegado
(`b84a5b2`, deploy `326be87`) y verificado
([trampa](trampas-conocidas.md#realtime-en-una-carga-completa-bug-visto-en-production-2026-11-17)),
y el criterio de aceptación quedó cumplido.

- [x] `cron_token` en Vault (una fila; no se lee su valor para comprobarlo).
- [x] `CRON_SECRET` en Vercel *Production* (*Sensitive*), igual a `cron_token`, 16
      caracteres o más (2026-11-17).
- [x] Migración `0013_notificaciones` aplicada **antes** del deploy (2026-11-17);
      verificación 18/18 y `rls-fase8-notificaciones.sql` 26/26 con limpieza en 0.
- [x] Deploy de la Fase 8; `/api/cron/seguimiento` y `/api/cron/alertas` sin Bearer → 401
      (`3ade4c9`, 2026-11-17).
- [x] Migración `0014_cron` aplicada **después** del deploy; verificación 12/12 (2026-11-17,
      18:31 UTC; la verificación, como `postgres` con `execute_sql`).
- [x] `net._http_response` con `status_code` 200 en las dos rutas y `cron.job_run_details`
      sin fallas (2026-11-17: `seguimiento-envios` 3 corridas y `alertas` 1, todas
      `succeeded`).
- [ ] *Cron monitors* `cron-seguimiento` y `cron-alertas` en verde en Sentry, con alerta si
      un cron no corre (los dos en `ok` el 2026-11-17; la alerta por corrida perdida, sin
      confirmar).
- [x] Resend y `NEXT_PUBLIC_APP_URL` configurados (sin ellos las alertas cuentan pero no
      envían: el resumen dice `sin_configurar` o `sin_url`). La primera corrida de alertas
      (2026-11-17) dijo `correo: "configurado"`, con 0 correos.
- [ ] Al menos un propietario o administrador con correo en cada organización (son los
      destinatarios de las alertas).
- [x] Criterio de aceptación de la Fase 8 cumplido (2026-11-17): boleta folio 42 (Track ID
      34017110) de «Enviado» a «Aceptado» sin recargar, con la página abierta desde una carga
      completa y la corrida del cron de las 19:05 UTC
      ([guía](../02-guias/seguimiento-envios.md#criterio-de-aceptación-cumplido-el-2026-11-17)).
      El rechazo real sigue cubierto solo por pruebas.

## Planes y pagos con Flow (Fase 10)

Detalle en [planes y pagos](../02-guias/planes-y-pagos.md) y los pasos de las migraciones en
[despliegue](../08-esquema-supabase/despliegue.md#fase-10-migraciones-0015-0016-y-0017).

Estado al 2026-11-17: código escrito y migraciones probadas en PGlite. **Nada de lo
siguiente está hecho en producción.**

### Durante la Fase 10 (sandbox)

- [ ] Migraciones `0015_planes_comerciales` y `0016_pagos` aplicadas **antes** del deploy;
      verificaciones 10/10 y 20/20, `rls-fase10-pagos.sql` 30/30 con limpieza en 0, y de nuevo
      `rls-fase2-tenancy.sql` 52/52 y `rls-fase3-empresas.sql` 43/43.
- [ ] `pnpm db:tipos` comparado con lo agregado a mano y versionado.
- [ ] `FLOW_API_KEY`, `FLOW_SECRET_KEY` (*Sensitive*) y
      `FLOW_API_URL=https://sandbox.flow.cl/api` en Vercel *Production* y en `.env.local`.
- [ ] Deploy de la Fase 10; `/api/cron/suscripciones` sin Bearer → 401;
      `/api/pagos/flow/confirmacion` sin `token` → 400.
- [ ] Migración `0017_cron_suscripciones` aplicada **después** del deploy; job
      `sincronizar-suscripciones` en `cron.job`, `net._http_response` con 200 y el monitor
      `cron-suscripciones` en verde en Sentry.
- [ ] Criterio de aceptación en sandbox: contratar Pyme con la tarjeta de prueba, cambiar a
      Contador y comprobar `suscripciones`, `pagos` y que la siguiente emisión usa el cupo
      nuevo ([cómo](../02-guias/planes-y-pagos.md#probar-en-el-sandbox-de-flow)).
- [ ] Los planes `boleteame-pyme`, `boleteame-contador` y `boleteame-api` de la cuenta de
      sandbox con el `urlCallback` de *Production* (no de `localhost`).

### Al lanzar (pasar Flow a producción, Fase 13)

- [ ] Cuenta de Flow de producción activa (comercio verificado) y sus credenciales:
      `FLOW_API_KEY` y `FLOW_SECRET_KEY` **de producción** en Vercel *Production*, junto con
      `FLOW_API_URL=https://www.flow.cl/api`. Las tres se cambian a la vez y se redespliega:
      una clave de sandbox con la URL de producción (o al revés) hace fallar cada firma.
- [ ] Planes de producción con el precio correcto: `boleteame-pyme` 14.990,
      `boleteame-contador` 49.990 y `boleteame-api` 39.990 (CLP, IVA incluido, mensuales,
      `days_until_due = 7`, 3 reintentos), iguales a `planes.precio_mensual_clp`. Si no
      existen, la app los crea en la primera contratación; si existen con otro monto,
      contratar falla. Revisar con `plans/get` después de la primera contratación.
- [ ] URLs públicas que Flow pueda alcanzar: `NEXT_PUBLIC_APP_URL=https://boleteame.dev`, de
      donde salen la URL de retorno (`/api/pagos/flow/registro`) y el `urlCallback` de los
      planes (`/api/pagos/flow/confirmacion`). Ninguna de las dos pasa por el proxy de sesión
      (`/api/*` es público, `lib/rutas.ts`).
- [ ] Suscripciones de prueba del sandbox: no existen en la cuenta de producción. Las
      organizaciones que contrataron en sandbox quedan con una suscripción `activa` cuyo
      `id_externo` Flow de producción no conoce: devolverlas a Certificación con
      `activar_suscripcion` (como `service_role`) antes de cambiar las credenciales.
- [ ] **Boleta propia de Boletéame por cada cobro** (cumplimiento tributario del SaaS): Flow
      envía su comprobante de pago, que no es un documento tributario. Pendiente, antes del
      lanzamiento.
- [ ] Cambio de tarjeta registrada desde Configuración → Plan (pendiente; hoy solo se
      registra al contratar).
- [ ] Términos del servicio con las condiciones de cobro, renovación, mora y cancelación al
      fin del período (Fase 12).
