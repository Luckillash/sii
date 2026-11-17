---
title: "Checklist de paso a producción"
description: "Lo que debe cumplirse antes de emitir boletas reales; por ahora, el seguimiento y las alertas de la Fase 8 (CRON_SECRET, cron_token, migraciones 0013 y 0014, monitores de Sentry)."
keywords: [checklist, producción, Fase 8, seguimiento, alertas, CRON_SECRET, cron_token, migración 0013, migración 0014, pg_cron, cron-seguimiento, cron-alertas, net._http_response, Resend, NEXT_PUBLIC_APP_URL]
related: ["02-guias/certificacion-empresa.md", "02-guias/seguimiento-envios.md", "08-esquema-supabase/despliegue.md"]
source: ["certificacion-node/docs/piloto-produccion.md", "PLAN-SAAS.md Fase 8 y Fase 13", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql"]
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
