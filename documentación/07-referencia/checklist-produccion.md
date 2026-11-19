---
title: "Checklist de paso a producción"
description: "Lo que debe cumplirse antes de emitir boletas reales y antes de cobrar: el seguimiento y las alertas de la Fase 8 (CRON_SECRET, cron_token, migraciones 0013 y 0014, monitores de Sentry), los planes y pagos con Flow de la Fase 10 (sandbox y paso a producción), la API pública y los webhooks de la Fase 11 (migraciones 0018 y 0019, Firewall) y el sitio público de la Fase 12 (CORREO_CONTACTO, Firewall para las Server Actions con Next-Action, datos legales, NEXT_PUBLIC_APP_URL)."
keywords: [checklist, producción, Fase 8, seguimiento, alertas, CRON_SECRET, cron_token, migración 0013, migración 0014, pg_cron, cron-seguimiento, cron-alertas, net._http_response, Resend, NEXT_PUBLIC_APP_URL, Fase 10, Flow, FLOW_API_URL, FLOW_API_KEY, FLOW_SECRET_KEY, planes de Flow, boleta propia, cron-suscripciones, 0017_cron_suscripciones, Fase 11, API pública, webhooks, 0018_api_webhooks, 0019_cron_webhooks, entregar-webhooks, cron-webhooks, Firewall de Vercel, rate limiting, 429, Fase 12, sitio público, CORREO_CONTACTO, /contacto, Next-Action, TURNSTILE_SECRET_KEY, falla cerrado, crear_organizacion, slugs reservados, RESPONSABLE, lib/legal.ts, revisión legal, sitemap]
related: ["02-guias/certificacion-empresa.md", "02-guias/seguimiento-envios.md", "08-esquema-supabase/despliegue.md", "02-guias/planes-y-pagos.md", "02-guias/api-publica.md", "02-guias/sitio-publico.md"]
source: ["certificacion-node/docs/piloto-produccion.md", "PLAN-SAAS.md Fase 8, Fase 10, Fase 12 y Fase 13", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql", "supabase/migrations/0017_cron_suscripciones.sql", "apps/web/src/server/env.ts", "supabase/migrations/0018_api_webhooks.sql", "supabase/migrations/0019_cron_webhooks.sql", "apps/web/src/lib/legal.ts", "apps/web/src/app/(publico)/contacto/acciones.ts"]
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

Estado al 2026-11-18: desplegada (`9d2fd8b`), migraciones `0015` a `0017` aplicadas y criterio de
aceptación cumplido en el sandbox de Flow (hallazgos corregidos en `a1f74eb`). Falta lo de
`Al lanzar`.

### Durante la Fase 10 (sandbox)

- [x] Migraciones `0015_planes_comerciales` y `0016_pagos` aplicadas **antes** del deploy
      (2026-11-18; hora previa para PITR 17:01:47 UTC); verificaciones 10/10 y 20/20,
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
- [ ] Sentry: alerta para los 5xx con la etiqueta `api_publica_ruta` (§4.8 del plan).

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

- [ ] **Slugs reservados en la base (Fase 13):** `crear_organizacion` no conoce
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
