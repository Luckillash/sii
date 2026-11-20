---
title: "Checklist de paso a producción"
description: "Lo que debe cumplirse antes de emitir boletas reales y antes de cobrar: la lista para habilitar una empresa en producción (plan, empresa, certificado, resolución y autorización, CAF de producción, primera boleta, seguimiento), el lanzamiento de la Fase 13 (seguridad, migración 0020, clave HS256 legada, e2e, PITR y simulacro de restauración, alertas de Sentry, Flow a producción, boleta propia, revisión legal) con el piloto y su registro diario, el seguimiento y las alertas de la Fase 8 (CRON_SECRET, cron_token, migraciones 0013 y 0014, monitores de Sentry), los planes y pagos con Flow de la Fase 10 (sandbox y paso a producción), la API pública y los webhooks de la Fase 11 (migraciones 0018 y 0019, Firewall) y el sitio público de la Fase 12 (CORREO_CONTACTO, Firewall para las Server Actions con Next-Action, datos legales, NEXT_PUBLIC_APP_URL)."
keywords: [checklist, producción, habilitar empresa, autorizada_produccion, resolución de producción, CAF de producción, IDK 300, primera boleta, piloto, registro diario, EPR, Fase 13, lanzamiento, PITR, simulacro de restauración, alertas de Sentry, migración 0020, HS256, e2e, Fase 8, seguimiento, alertas, CRON_SECRET, cron_token, migración 0013, migración 0014, pg_cron, cron-seguimiento, cron-alertas, net._http_response, Resend, NEXT_PUBLIC_APP_URL, Fase 10, Flow, FLOW_API_URL, FLOW_API_KEY, FLOW_SECRET_KEY, planes de Flow, boleta propia, cron-suscripciones, 0017_cron_suscripciones, Fase 11, API pública, webhooks, 0018_api_webhooks, 0019_cron_webhooks, entregar-webhooks, cron-webhooks, Firewall de Vercel, rate limiting, 429, Fase 12, sitio público, CORREO_CONTACTO, /contacto, Next-Action, TURNSTILE_SECRET_KEY, falla cerrado, crear_organizacion, slugs reservados, RESPONSABLE, lib/legal.ts, revisión legal, sitemap]
related: ["07-referencia/runbooks.md", "07-referencia/observabilidad-sentry.md", "07-referencia/respaldo-y-restauracion.md", "02-guias/onboarding-organizacion.md", "02-guias/folios-caf.md", "02-guias/emision-boletas.md", "02-guias/certificacion-empresa.md", "02-guias/seguimiento-envios.md", "08-esquema-supabase/despliegue.md", "02-guias/planes-y-pagos.md", "02-guias/api-publica.md", "02-guias/sitio-publico.md"]
source: ["certificacion-node/docs/piloto-produccion.md", "PLAN-SAAS.md Fase 8, Fase 10, Fase 12 y Fase 13", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql", "supabase/migrations/0017_cron_suscripciones.sql", "apps/web/src/server/env.ts", "supabase/migrations/0018_api_webhooks.sql", "supabase/migrations/0019_cron_webhooks.sql", "apps/web/src/lib/legal.ts", "apps/web/src/app/(publico)/contacto/acciones.ts"]
---

# Checklist de paso a producción

> **Úsalo cuando:** vas a habilitar a una empresa en producción.

Tres partes: [habilitar una empresa](#habilitar-una-empresa-en-producción) (se repite por
cada empresa), [lanzamiento](#lanzamiento-fase-13) (una vez, Fase 13) con el
[piloto](#piloto) y su [registro diario](#registro-diario-del-piloto), y abajo lo que dejó
cada fase (8, 10, 11 y 12). Lo marcado `[x]` está hecho y fechado; lo demás, pendiente.

## Habilitar una empresa en producción

Por cada empresa. Copia la lista en el registro del piloto (o en el ticket del cliente) y
marca con la fecha. Cada paso que sale al SII de producción tiene ensayo antes y se
confirma con el responsable de la empresa: en producción cada boleta es un documento
tributario real y consume un folio.

**1. Organización y plan**

- [ ] La organización tiene un plan con producción (`pyme`, `contador`, `api` o `empresa`;
      `certificacion` no la permite) y la suscripción está `activa`, no `morosa`
      (`plan_vigente(org).permite_produccion`; [planes](../02-guias/planes-y-pagos.md)).
- [ ] Hay al menos un propietario o administrador con correo (destinatarios de las alertas
      de rechazo, incierto, certificado, folios y mora).
- [ ] El cupo del plan alcanza (empresas, usuarios y boletas del mes).

**2. Empresa**

- [ ] Empresa creada con el RUT correcto (no se puede cambiar después), razón social, giro,
      dirección y comuna tal como están en el SII, en ISO-8859-1
      ([onboarding](../02-guias/onboarding-organizacion.md#4-empresa-fase-3)).
- [ ] Empresa **activa**.

**3. Certificado**

- [ ] `.pfx` subido, vigente al menos 30 días más (si vence antes, renovarlo primero) y
      asociado a la empresa como **predeterminado**.
- [ ] El titular es **representante electrónico** de la empresa en el SII (lo exige el
      timbraje de folios) y, para «Verificar autorización», representante legal.

**4. Resolución y autorización**

- [ ] Empresa autorizada en producción (`empresas.autorizada_produccion = true`), por uno de
      dos caminos:
  - certificada en Boletéame: el asistente llegó a «Autorizada» (P91)
    ([certificación](../02-guias/certificacion-empresa.md)); o
  - autorizada fuera de Boletéame: resolución de producción registrada (número ≥ 1 y fecha)
    o «Verificar autorización en el SII» en `ok`
    ([autorización externa](../02-guias/certificacion-empresa.md#empresa-autorizada-fuera-de-boletéame)).
- [ ] Resolución de **producción** vigente con el número y la fecha correctos (van en la
      carátula de cada envío; si es falsa, el SII rechaza).
- [ ] La autorización es de **boleta** (39/41), no solo de factura: el STC muestra
      timbrajes `0039` (riesgo de §10 del plan con `ad_empresa`).

**5. CAF de producción**

- [ ] En `/<org>/folios`, ambiente producción, tipo 39 (y 41 si emite exentas): ensayo →
      **«Revisar con el SII»** → **«Timbrar N folios»** ⚠️, con una cantidad acorde al
      volumen (el aviso llega al 15 %). En el primer timbraje del tipo, el SII pide folio
      inicial (en el piloto de la librería fue 1)
      ([folios](../02-guias/folios-caf.md#solicitar-folios)).
- [ ] El CAF aparece `activo` con IDK 300 y `siguiente_folio = folio_desde`; ninguna
      solicitud queda `incierta` (si queda, [runbook](runbooks.md#envío-u-operación-incierta-código-6)).

**6. Primera boleta**

- [ ] Ensayo en Emitir (ambiente producción, sin banner de certificación) con una venta
      real de bajo monto.
- [ ] Emisión ⚠️ confirmada por el responsable: Track ID recibido, documento `enviado`.
- [ ] PDF carta y rollo generados; el PDF417 se lee y `sii util verificar-ted` da OK con el
      TED de la boleta.
- [ ] Si quedó **incierta**: no reemitir; [runbook](runbooks.md#envío-u-operación-incierta-código-6).

**7. Seguimiento**

- [ ] La corrida de `cron-seguimiento` la consulta y el documento pasa a `aceptado` (EPR)
      sin recargar la página; si hay rechazo, se lee el error del SII y no se emite más
      hasta entender la causa.
- [ ] La empresa entra al [registro diario del piloto](#registro-diario-del-piloto) (o, después
      del lanzamiento, al seguimiento normal con las alertas de Sentry).

## Lanzamiento (Fase 13)

Reúne lo pendiente del plan (`PLAN-SAAS.md`, Fase 13) y de las fases anteriores. El detalle
de cada fase sigue en sus secciones de abajo.

### Seguridad

- [x] (2026-11-19/20: RLS 52/52, `service_role` auditado, `server-only` y `getUser()` con pruebas; deploy `c619a1a` con la CSP en *Report-Only* y, tras revisar en Production 13 páginas con sesión y las públicas sin violaciones, CSP en `enforce` con reportes por `/api/csp` (código listo, falta su deploy)) Revisión de seguridad: RLS por tabla según `acceso-por-tabla` (simulación de roles
      con `rollback`), ninguna ruta con `service_role` sin filtrar por organización (incluida
      `/api/v1`), cabeceras (CSP con Turnstile y Sentry, HSTS), `server-only` en todo
      `server/`, y `getUser()` antes de toda operación ⚠️ y de crear API keys y webhooks.
- [x] (2026-11-20, 01:23 UTC: aplicada; verificación 9/9, `unindexed_foreign_keys` resuelto, tipos sin cambios) **Migración `0020_endurecimiento`**: slugs reservados también
      en `crear_organizacion` (revisar antes que ninguna organización use uno), índices de
      las FK y de `operaciones_sii` (hoy `/estado` recorre la tabla). Aplicarla con su
      verificación, como las demás ([despliegue](../08-esquema-supabase/despliegue.md)).
- [ ] **Retiro de la clave HS256 legada**: confirmar en `edge_logs` que nadie usa claves sin
      prefijo `sb_` y revocar la *Previously used* en *Settings → JWT Keys*
      ([claves](../01-fundamentos/ambientes-y-credenciales.md#claves-api-de-supabase)).

### Pruebas

- [ ] e2e con Playwright del flujo crítico: registro → organización → empresa → certificado
      → certificación (con SII falso) → folios → emisión → seguimiento, en verde.

### Respaldo

Detalle en [respaldo y restauración](respaldo-y-restauracion.md). Estado al 2026-11-19:
**PITR apagado** (`supabase backups list`: `pitr_enabled: false`), respaldos físicos diarios
con 7 días de retención; hoy se puede perder hasta un día de datos.

- [ ] PITR activo (7 días como mínimo; requiere compute Small o mayor). Lo decide y activa
      el usuario.
- [ ] Simulacro de restauración a un proyecto nuevo hecho, con las verificaciones de
      `supabase/verificaciones/` en `ok`, Vault descifrando y la duración anotada; proyecto
      del simulacro borrado. Resultado: _(fecha, respaldo, duración, resultado)_.
- [x] Rotación de `SII_TOKENS_KEY` documentada (2026-11-19,
      [procedimiento](respaldo-y-restauracion.md#rotación-de-sii_tokens_key)).
- [ ] Decidido el respaldo de los archivos de Storage (`documentos-xml`), que no entran en
      ningún respaldo de la base.

### Observabilidad

Detalle en [observabilidad](observabilidad-sentry.md) y qué hacer en
[runbooks](runbooks.md). Estado al 2026-11-19: los 4 *cron monitors* existen y están
`ok`, pero **ninguno tiene una alerta conectada**; no hay alertas de issues ni de métricas
propias ni tableros propios; no hay token de Sentry con `alerts:write`.

- [ ] A1 «Cron: corrida perdida o fallida» conectada a `cron-seguimiento`, `cron-alertas`,
      `cron-webhooks` y `cron-suscripciones`, con el umbral de fallas de cada monitor.
- [ ] A2 «SII: operación incierta (código 6)».
- [ ] A3 «SII: verificación fallida (código 7)».
- [ ] A4 «API pública: error 5xx» (`api_publica_ruta`).
- [ ] M1 «SII: fallas de conexión en producción» (`transporte` con `host_sii`).
- [ ] Tablero «Boletéame — operación».
- [ ] Prueba de una alerta: que un correo de Sentry llegue de verdad (p. ej. con «Send test
      notification» de la regla).
- [x] Runbooks de incierto, caída del SII, CAF agotado, verificación fallida, cron, Flow,
      Resend, certificado vencido y secreto expuesto (2026-11-19, [runbooks](runbooks.md)).

### Cobro y legal

- [ ] Flow a producción ([abajo](#al-lanzar-pasar-flow-a-producción-fase-13)), incluida la
      cancelación de la suscripción de sandbox de `servicio`.
- [ ] **Boleta propia de Boletéame por cada cobro** (la prometen los términos).
- [ ] **Revisión legal** de términos y privacidad ([nota](revision-legal.md)).
- [ ] Precios de la landing = `planes` = planes de Flow de producción.

### Piloto

Criterio de la Fase 13: **dos semanas de piloto sin incidentes de seguridad y con todas las
boletas EPR o explicadas.**

- [ ] **Empresa del piloto de `certificacion-node`** (ya autorizada, con 5 boletas reales
      EPR emitidas con la CLI) habilitada en Boletéame con la lista de
      [arriba](#habilitar-una-empresa-en-producción), con un CAF de producción tipo 39 pedido
      desde Boletéame (sin reutilizar los folios del CAF de la CLI: los dos sistemas no deben
      repartirse un mismo rango).
- [ ] Primera boleta real desde Boletéame en EPR.
- [ ] 3 a 5 clientes en producción, cada uno habilitado con la lista de arriba.
- [ ] Dos semanas de seguimiento diario con el [registro](#registro-diario-del-piloto),
      del _(fecha)_ al _(fecha)_.
- [ ] Al cierre: 0 incidentes de seguridad; todas las boletas del piloto `aceptado` (EPR,
      o con reparos explicados) o con su rechazo explicado; ningún incierto sin resolver;
      registro con una entrada por día.

### Registro diario del piloto

Una entrada por día (aunque no haya novedades) y una fila por boleta con algo que explicar.
Las consultas son de solo lectura.

```sql
-- Boletas de producción del día (ajustar la fecha, hora de Chile)
select o.slug, em.rut, d.tipo_dte, d.folio, d.estado, e.track_id, e.estado_sii, e.incierto
from public.documentos d
join public.envios e on e.id = d.envio_id
join public.empresas em on em.id = d.empresa_id
join public.organizaciones o on o.id = d.organizacion_id
where d.ambiente = 'produccion'
  and d.creado_en >= ('2026-12-01'::date)::timestamp at time zone 'America/Santiago'
  and d.creado_en <  ('2026-12-02'::date)::timestamp at time zone 'America/Santiago'
order by d.creado_en;

-- Pendientes de todo el piloto: no aceptados, inciertos o sin cerrar
select o.slug, d.folio, d.estado, e.estado_sii, e.incierto, e.consultas, e.enviado_en
from public.documentos d
join public.envios e on e.id = d.envio_id
join public.organizaciones o on o.id = d.organizacion_id
where d.ambiente = 'produccion' and d.estado <> 'aceptado'
order by e.enviado_en;
```

Plantilla (copiar un bloque por día):

```markdown
### AAAA-MM-DD — revisó: <nombre>

| Revisión | Resultado |
|---|---|
| Boletas emitidas hoy (producción) | N (por empresa: …) |
| Aceptadas (EPR) / con reparos / rechazadas / en proceso | N / N / N / N |
| Inciertas nuevas / resueltas | N / N |
| Envíos sin cerrar (> 7 días) | N |
| Alertas de Sentry (A1–A4, M1) | ninguna / cuáles |
| Cron monitors | todos ok / cuál falló y cuánto |
| `/estado` | Operativo / Con demoras / Con problemas |
| Folios: empresas bajo el 15 % | ninguna / cuáles |
| Certificados que vencen en < 30 días | ninguno / cuáles |
| Correos de alerta que no salieron (`notificaciones` fallidas) | N |
| Incidentes de seguridad | ninguno / descripción |

| Empresa | Folio | Track ID | Estado | Explicación / acción |
|---|---|---|---|---|
| | | | | |

Conclusión del día: sin novedades / pendiente: …
```

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
      un cron no corre (los dos en `ok` el 2026-11-17; el 2026-11-19 se confirmó por la API
      que **no hay ninguna alerta conectada** a los monitores: falta la A1 de
      [observabilidad](observabilidad-sentry.md#a1-cron-corrida-perdida-o-fallida)).
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

Estado al 2026-11-18: desplegada (`9d2fd8b`), migraciones `0015` a `0017` aplicadas y criterio de
aceptación cumplido en el sandbox de Flow (hallazgos corregidos en `a1f74eb`). Falta lo de
`Al lanzar`.

### Durante la Fase 10 (sandbox)

- [x] Migraciones `0015_planes_comerciales` y `0016_pagos` aplicadas **antes** del deploy
      (2026-11-18; hora previa anotada para PITR 17:01:47 UTC, que no sirve: PITR está apagado,
      ver [respaldo](respaldo-y-restauracion.md#estado-actual-comprobado-el-2026-11-19)); verificaciones 10/10 y 20/20,
      `rls-fase10-pagos.sql` 30/30 y `rls-fase2-tenancy.sql` 52/52, con limpieza en 0.
- [x] `pnpm db:tipos` regenerado (2026-11-18): solo difiere de lo agregado a mano en el orden
      de `estados_sii` y `eventos_pasarela`.
- [x] `FLOW_API_KEY`, `FLOW_SECRET_KEY` (*Sensitive*) y
      `FLOW_API_URL=https://sandbox.flow.cl/api` en Vercel *Production* y en `.env.local`
      (2026-11-18, las cargó el usuario).
- [x] Deploy de la Fase 10 (`9d2fd8b`, 2026-11-18); `/api/cron/suscripciones` sin Bearer → 401;
      `/api/pagos/flow/confirmacion` sin `token` → 400.
- [x] Migración `0017_cron_suscripciones` aplicada **después** del deploy (2026-11-18); job
      `sincronizar-suscripciones` en `cron.job` y corridas de las 17:41 a las 20:41 UTC en
      `succeeded` con respuesta 200 de la ruta.
- [x] Criterio de aceptación en sandbox (2026-11-18): Pyme contratada con la tarjeta de
      prueba, cambio a Contador con el prorrateo de Flow, `suscripciones`, `pagos` y
      `plan_vigente` comprobados, y el cupo nuevo usado por los triggers
      ([registro](../02-guias/planes-y-pagos.md#criterio-de-aceptación-2026-11-18); [cómo](../02-guias/planes-y-pagos.md#probar-en-el-sandbox-de-flow)).
- [x] Los planes `boleteame-pyme`, `boleteame-contador` y `boleteame-api` de la cuenta de
      sandbox con el `urlCallback` de *Production* (no de `localhost`). Comprobado el
      2026-11-19 con `plans/get`: los tres con `https://boleteame.dev/api/pagos/flow/confirmacion`,
      7 días de vencimiento y 3 reintentos (creados el 18-11 y, `boleteame-api`, el 19-11 al
      cambiar `servicio` a API).

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
      Hoy es el caso de `servicio`: su suscripción de Flow sandbox `sus_l78a6791ff` (plan API,
      próximo cobro el 19-12-2026) se dejó a propósito y hay que cancelarla.
- [ ] **Boleta propia de Boletéame por cada cobro** (cumplimiento tributario del SaaS): Flow
      envía su comprobante de pago, que no es un documento tributario. Pendiente, antes del
      lanzamiento. Desde la Fase 12 los términos (`/legal/terminos#planes`) lo prometen
      («Por cada cobro emitiremos el documento tributario que corresponda»).
- [ ] Cambio de tarjeta registrada desde Configuración → Plan (pendiente; hoy solo se
      registra al contratar).
- [x] Términos del servicio con las condiciones de cobro, renovación, mora y cancelación al
      fin del período (Fase 12: `/legal/terminos#planes`, código listo el 2026-11-19, sin
      deploy; falta la revisión legal, ver [sitio público](#sitio-público-fase-12)).

## API pública y webhooks (Fase 11)

Estado (2026-11-19): Fase 11 desplegada en producción (`169e2e5`); `0018` y `0019` aplicadas el
2026-11-19; Firewall configurado; criterio de aceptación cumplido el mismo día
([guía](../02-guias/api-publica.md#criterio-de-aceptación-2026-11-19)).

### Al desplegar la fase

- [x] Antes del `db push` de la `0018`: `select count(*) from webhooks` (o revisar que cada
      `url` pase el check `webhooks_url_permitida`); si alguna no pasa, el `validate
      constraint` hace fallar la migración. Hecho el 2026-11-19: `webhooks`,
      `webhook_entregas` y `api_keys` vacías.
- [x] `0018_api_webhooks` aplicada **antes** del deploy (2026-11-19, 03:40:29 UTC; con la
      `0019` fuera de `supabase/migrations/` durante el `--dry-run` y el push), verificación
      `0018_api_webhooks.sql` 23/23 (2/23 antes) y simulación `rls-fase11-api.sql` 39/39 con la
      limpieza en 0 antes y después, más las regresiones `rls-fase8-notificaciones` 26/26 y
      `rls-fase10-pagos` 30/30 (y las verificaciones `0013` 18/18 y `0016` 20/20); tipos
      regenerados con `pnpm db:tipos` (los retornos de `autenticar_api_key` y
      `reclamar_idempotencia` salen no nulos en el generador: el código los trata como
      nulables; solo 9 líneas de nulabilidad difieren de lo escrito a mano). *Advisors*: solo
      `rls_enabled_no_policy` en `api_idempotencia` y
      `authenticated_security_definer_function_executable` en `probar_webhook`,
      `reenviar_entrega_webhook` y `rotar_secreto_webhook`.
- [x] Deploy `169e2e5` (`READY`) y humo sin sesión (2026-11-19): `GET /api/v1/documentos` →
      401 JSON `no_autenticado` (con una clave bien formada inexistente, 401 `clave_invalida`);
      `GET /api/v1/openapi.json` → 200; `/docs/api` → 200; `POST /api/cron/webhooks` sin
      Bearer → 401 (no 503: `CRON_SECRET` está configurado); `/servicio/configuracion/api` y
      `/webhooks` sin sesión → 307 a `/ingresar?siguiente=…`. Sin errores de runtime.
- [x] `0019_cron_webhooks` aplicada **después** del deploy (2026-11-19, 03:54 UTC; el
      `--dry-run` listó solo la 0019; `db push --yes`): jobs `entregar-webhooks`
      (`* * * * *`, timeout 60 s), `limpiar-webhook-entregas` (`37 4 * * *`) y
      `limpiar-api-idempotencia` (`47 4 * * *`). Verificación `0019_cron_webhooks.sql` 9/9 con
      el MCP `execute_sql` como `postgres`. Primera corrida (03:55) `succeeded`,
      `net._http_response` 200 con `{reclamadas:0,…,errores:0}` y el monitor de Sentry
      `cron-webhooks` en `ok` (Production). La comprobación 10 de `0014_cron.sql` queda en
      `false` (es lo esperado).
- [x] **Firewall de Vercel** (2026-11-19): el proyecto no tenía configuración de Firewall y el
      MCP de Vercel no puede crear la primera regla (404 «Seawall Config not found»), así que
      se creó con el CLI (`vercel firewall rules add` y `vercel firewall publish
      --confirm-name sii --effects-digest …`). Regla «API pública: límite por IP»: ruta que
      empieza con `/api/v1/`, `fixed_window` de 60 s, 120 peticiones por IP, acción
      `rate_limit` (429). Firewall `Enabled`, 1 regla activa; el 429 lo responde Vercel, sin
      cuerpo JSON garantizado. Como la regla solo cubre `/api/v1/`, `/api/cron/*` no queda
      afectado.
- [x] **Criterio de aceptación cumplido (2026-11-19):** `servicio` pasó a API con Flow sandbox;
      clave `sk_test_` de prueba; `webhook.prueba` con firma válida; boleta 39 folio 43 (Track
      ID 34120364) emitida por la API, repetición con la misma clave devuelve el mismo
      documento con `Idempotent-Replayed: true`; `documento.aceptado` entregado con firma
      válida al primer intento
      ([registro](../02-guias/api-publica.md#criterio-de-aceptación-2026-11-19)).
- [ ] Sentry: alerta para los 5xx con la etiqueta `api_publica_ruta` (§4.8 del plan; especificación
      A4 en [observabilidad](observabilidad-sentry.md#a4-api-pública-error-5xx)).

### Antes de abrir la API a clientes

- [ ] Ninguna ruta de `/api/v1` lee o escribe sin filtrar por la organización de la clave
      (revisión de seguridad de la Fase 13).
- [x] Claves y webhooks de prueba del criterio revocados o borrados; receptor de prueba
      apagado (2026-11-19: webhook pausado con 0 entregas en cola, clave revocada, túnel y
      receptor detenidos).
- [ ] `/docs/api` revisada en claro y oscuro; textos sin prometer factura ni otros DTE.
- [ ] Decidir la agrupación de varias boletas en un solo envío para `POST /documentos/lote`
      (hoy cada boleta va en su propio envío).

## Sitio público (Fase 12)

Detalle en la [guía del sitio público](../02-guias/sitio-publico.md). Sin migraciones.

Estado (2026-11-19): código listo, revisado (sin críticos ni altos; 4 medios y 7 bajos,
corregidos salvo `RESPONSABLE` y los slugs en la base) y verificado en local (typecheck,
Vitest de la app 1767 (+1 omitida) en 133 archivos, correos 77 en 9 archivos, Biome, stylelint y `pnpm build`);
sin commit ni deploy.

### Antes del deploy

- [ ] **`NEXT_PUBLIC_APP_URL=https://boleteame.dev`** en Vercel *Production* antes del build:
      es `NEXT_PUBLIC_`, se fija en el build, y de ella salen `metadataBase`, la canónica,
      `og:url`, `/sitemap.xml`, `/robots.txt` y el JSON-LD. Si falta o no es http(s), el
      código usa `https://boleteame.dev`; con un valor equivocado (p. ej. `localhost`) el
      sitemap y las vistas previas quedan apuntando ahí hasta el siguiente deploy. Ya está
      cargada desde la Fase 2; confirmar el valor.
- [x] **`CORREO_CONTACTO`** en Vercel *Production* (cargada el 2026-11-19): solo la dirección del
      buzón del equipo, no *sensitive* (`envContacto()` la valida como correo). Sin ella, el
      formulario de `/contacto` responde «No pudimos enviar tu mensaje» y avisa a Sentry. Junto
      con `RESEND_API_KEY`, `CORREO_REMITENTE` y `TURNSTILE_SECRET_KEY`, que ya están.
- [x] **`TURNSTILE_SECRET_KEY` en *Production*** (confirmado el 2026-11-19, *sensitive*): `/contacto` falla cerrado en
      producción. Sin la clave responde «La verificación de seguridad no está disponible…» y
      avisa a Sentry (`contacto: Turnstile sin configurar en producción`). La respuesta de
      `siteverify` debe traer `action = contacto` y `hostname` = el de `NEXT_PUBLIC_APP_URL`
      (`boleteame.dev`): si el widget se sirve desde otro dominio (un alias de Vercel), el
      formulario rechaza el token como inválido.
- [x] Revisión de código de la fase: sin críticos ni altos; 4 medios y 7 bajos, corregidos
      todos menos los datos de `RESPONSABLE` (los entrega el usuario) y los slugs en la base
      (Fase 13).

### Al desplegar

- [x] (2026-11-19, `fb0f6cf`: todo 200 salvo `/favicon.ico` 404, organizaciones 307, `despliegue.spec.ts` 10 pasan) Deploy a *Production* y humo sin sesión: `/`, `/ayuda`, `/estado`, `/contacto`,
      `/legal`, `/legal/terminos`, `/legal/privacidad`, `/sitemap.xml`, `/robots.txt`,
      `/manifest.webmanifest`, `/opengraph-image`, `/twitter-image`, `/apple-icon` e `/icon.svg`
      → 200 (ninguna 307 a `/ingresar`); `/<org>/tablero` sin sesión → 307; el sitemap y
      `og:url` con `https://boleteame.dev`; `E2E_URL=https://boleteame.dev pnpm --filter web
      test:e2e` (`despliegue.spec.ts`) en verde.
- [x] (2026-11-19: base «Operativo», SII «Sin datos», sin errores de runtime) `/estado` muestra la base de datos «Operativo» y, con operaciones recientes, el nivel
      de la conexión con el SII (sin horas de actividad); el resumen no dice «Todo funciona
      con normalidad» si la base sale «Sin datos»; sin errores de runtime en Vercel ni avisos
      `landing: precios de respaldo` en Sentry.
- [x] (2026-11-19: «Server Actions: límite por IP», `POST` + cabecera `next-action` presente, 60 por 60 s por IP, ventana fija, 429; `live`) **Regla de *rate limit* del Firewall de Vercel para las Server Actions** (como la de
      `/api/v1/*`): por IP, método `POST` **con la cabecera `Next-Action`** (o, si no se
      puede filtrar por cabecera, todos los POST fuera de `/api/`), acción `rate_limit`.
      **No limitarla a la ruta `/contacto`:** Next 16 ejecuta la Server Action desde
      cualquier ruta si el POST trae `Next-Action`, así que un bot la mandaría a `/` o a
      `/ayuda` y se saltaría la regla. Los GET de las páginas no deben contar. Un límite bajo
      basta (p. ej. del orden de 5 a 10 por IP en 10 minutos), pero ojo con las demás Server
      Actions del panel que también quedan cubiertas: revisar que el límite no estorbe el uso
      normal. Turnstile y el honeypot son la primera barrera. El Firewall ya existe (Fase 11),
      así que la regla se puede agregar con el MCP o el CLI y publicar.
- [x] (2026-11-19: mensaje real recibido por el usuario, sin errores en Vercel ni Sentry) Un mensaje de prueba desde `/contacto` llega a `CORREO_CONTACTO` con `reply_to` de quien
      escribe (criterio de la fase, con Turnstile verificado en el servidor). Es el único
      correo: no hay acuse a quien escribe.

### Antes de lanzar

- [x] (2026-11-20: check `organizaciones_slug_no_reservado` de la `0020`; ninguna organización usaba uno) **Slugs reservados en la base (Fase 13):** `crear_organizacion` no conocía
      `SLUGS_RESERVADOS` (`lib/rutas.ts`); una llamada directa a la RPC podría crear una
      organización con un slug reservado (`estado`, `contacto`…). Requiere una migración que
      valide la misma lista en la base, y revisar antes que ninguna organización existente
      use uno.

- [x] **Datos del responsable en `RESPONSABLE`** (`apps/web/src/lib/legal.ts`, 2026-11-19):
      nombre, RUT y domicilio del titular (persona natural). Los correos quedan en `null` a
      propósito: `camposPendientes()` devuelve solo `correoContacto` y `correoPrivacidad`, y
      las páginas llevan al formulario (privacidad, a `/contacto?motivo=privacidad`). Si se
      crea una casilla del dominio, cargarla ahí.
- [ ] **Revisión legal** de `/legal/terminos` y `/legal/privacidad` por un abogado, con los
      puntos de [revision-legal.md](revision-legal.md) (Ley 19.628 y
      Ley 21.719, condiciones de cobro y responsabilidad). Si cambia el texto, actualizar
      `VIGENCIA_TERMINOS` / `VIGENCIA_PRIVACIDAD` y la fecha de esa página en
      `PAGINAS_SITEMAP`.
- [ ] La boleta propia por cada cobro que prometen los términos (Fase 13, arriba en
      [Al lanzar](#al-lanzar-pasar-flow-a-producción-fase-13)).
- [ ] Los precios de la landing coinciden con `planes` y con los planes de Flow de producción.
- [ ] Criterio de aceptación: axe en claro, oscuro y móvil en *Production*, precios iguales a
      `planes` y un mensaje de contacto entregado con Turnstile verificado en el servidor.
