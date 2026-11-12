# Plan del SaaS «Timbre»: emisión de documentos tributarios electrónicos (SII)

Plan para construir el SaaS de emisión, firma y envío de DTE al SII, y de certificación de
empresas, sobre la librería `@winex/certificacion` (`../certificacion-node`).

- **Fecha del plan:** 2026-11-10
- **Stack:** Next.js (App Router), sin Tailwind (CSS Modules + tokens CSS), Zustand, Supabase
  (Postgres, Auth, Vault, Storage, Realtime), Vercel (hosting, dominio, cron), Resend
  (correo), Cloudflare Turnstile (verificación) y Sentry (monitoreo).
- **Fuentes:**
  - Modelo de datos: [`supabase_saas_sii.sql`](documentación/08-esquema-supabase/supabase_saas_sii.sql) (19 secciones, RLS, Vault, Storage, Realtime).
  - Librería y CLI: `../certificacion-node` (fases 0–7 listas; piloto en producción en curso, 5 boletas reales EPR).
  - Design system «Timbre»: <https://claude.ai/artifact/UCjvbZq6pYi2bYVBcuviwr> (tokens, tono, 8 componentes).
  - Plantillas: <https://claude.ai/artifact/HjnXwP9jcNrawftr55XpRu> (Landing, Ingreso, Tablero, Documentos emitidos, Emitir factura, Certificación SII).
  - Documentación para agentes: [`documentación/`](documentación/) (estructura e índice listos; los archivos todavía son esqueletos `TODO`).

## Estado

Valores de la columna Estado: **Listo**, **En parte** o Pendiente. Se actualiza al terminar cada tarea.

| Fase | Estado | Nota |
|---|---|---|
| 0. Fundaciones y prueba de conectividad | **Listo** | **Criterio de aceptación cumplido** (2026-11-11: token de apicert desde Vercel `gru1`, guardado cifrado en `tokens_sii`); spike del SII retirado. 2026-11-12: Sentry conectado (proyecto `luckillash/timbre-web`), variables en Vercel (solo *Production*) y error real de prueba verificado en producción: release del commit, *source maps* legibles y secretos depurados (también en spans, con `beforeSendSpan`). Rutas de prueba retiradas |
| 1. Design system en Next.js | **Listo** | 2026-11-11: tokens generados, 8 componentes (+ `incierto`, D3), 11 de soporte, 2 layouts, `/_ds` y axe sin violaciones en claro/oscuro/móvil. Deploy `F1` (c307194) verificado en producción con `e2e/despliegue.spec.ts`. 2026-11-12: `incierto` agregado también al artifact del design system y a su copia en `design-system/timbre/` |
| 2. Autenticación, organizaciones y equipo | **En parte** | 2026-11-12: código listo (ingreso, crear cuenta, recuperar/restablecer, `proxy.ts`, callback, onboarding, `[org]`, equipo, invitaciones, Turnstile y Resend opcionales); lint, typecheck, Vitest, build y e2e sin escritura en verde. Simulación de roles en SQL con `rollback` (`rls-fase2-tenancy.sql`): 47/47. Migraciones `0003_preferencias` y `0004_cupo_sin_suscripcion` aplicadas y verificadas (13/13); tipos regenerados sin diferencias. Pendientes en la Fase 2 (§7) |
| 3. Empresas, certificados y resoluciones | Pendiente | |
| 4. Capa de servicio SII (backend) | Pendiente | Núcleo técnico del producto |
| 5. Certificación ante el SII (boleta) | Pendiente | |
| 6. Folios (CAF) | Pendiente | |
| 7. Emisión de boletas | Pendiente | |
| 8. Seguimiento de envíos y documentos | Pendiente | |
| 9. Tablero y reportes | Pendiente | |
| 10. Planes, suscripciones y cuotas | Pendiente | Depende de la decisión D4 (pasarela) |
| 11. API pública y webhooks | Pendiente | |
| 12. Sitio público | Pendiente | |
| 13. Endurecimiento y lanzamiento | Pendiente | |
| 14. Facturas y demás DTE (posterior) | Pendiente | Requiere extender la librería (ver §1) |

---

## 1. Hallazgos al cruzar las fuentes (leer antes de empezar)

Las cuatro fuentes no cubren exactamente lo mismo. Estas brechas condicionan el alcance:

| # | Hallazgo | Consecuencia en el plan |
|---|---|---|
| H1 | **La librería y el esquema solo cubren boleta electrónica (39 y 41).** `tipos_dte` tiene dos filas; no hay generador de factura, `EnvioDTE`, intercambio entre contribuyentes, Libro/RCV ni documentos recibidos. | El MVP emite **boletas 39/41**. Facturas (33, 34), guías (52), notas (56, 61), recibidos y Libro de Compras y Ventas pasan a la **Fase 14**, que exige extender `certificacion-node` y migrar el esquema. |
| H2 | **Las plantillas están diseñadas para factura.** «Emitir factura» pide giro, dirección, comuna, correo de intercambio, forma de pago, vencimiento y referencias; la tabla `documentos` no tiene esas columnas (ni `receptores` tiene giro/dirección). El menú incluye «Documentos recibidos» y «Libro de Compras y Ventas». | La pantalla de emisión se adapta a boleta en el MVP (receptor opcional, precios **brutos**, IVA incluido). Los ítems del menú sin respaldo se ocultan con *feature flags* hasta la Fase 14. |
| H3 | **El proceso de certificación de la plantilla es el de factura** (Postulación → Set → Simulación → Intercambio → Muestras de impresión → Declaración). La librería implementa el de **boleta**: postulación → descarga del set → envío del set → revisión → declaración (P90/P91), que es lo que modela `etapa_certificacion`. | El asistente de certificación del MVP sigue las 8 etapas del enum, agrupadas en 5 pasos visibles (ver §7.5). La versión de 6 pasos queda para la certificación de factura (Fase 14). |
| H4 | **`EstadoDTE` no tiene el estado `incierto`** que sí existe en `estado_documento` (envío sin Track ID: no se sabe si llegó). | Agregar al design system la variante `incierto` (propuesta: «Por verificar», tono `aviso`, glifo de interrogación) y su guía. Ver decisión D3. |
| H5 | **Planes:** el SQL trae `certificacion`, `emprendedor`, `pyme`, `empresa` con precios de ejemplo; la landing muestra «Pyme», «Contador» y «API» con `[TU PRECIO]`. | Definir la grilla comercial (D5) y migrar `planes` antes de la Fase 10. |
| H6 | **Pasarela de pago sin definir.** `suscripciones.proveedor_pago` es texto libre; en el entorno hay MCP de Flow y Transbank, pero el stack pedido no nombra pasarela. | Decisión D4. La Fase 10 se diseña con un adaptador de pasarela. |
| H7 | **La librería es solo Node.js** (`node-forge`, `undici`, TLS mutuo con el certificado, Node ≥ 22.19). El comentario del SQL propone una Supabase Edge Function (Deno) para el seguimiento. | Todo lo que habla con el SII corre en **funciones Node.js de Vercel**, nunca en Edge runtime ni en Edge Functions de Supabase. El cron de Supabase (`pg_cron` + `pg_net`) puede disparar rutas de Vercel. |
| H8 | **Los componentes del design system son un bundle global** (`window.Timbre`, React 18, CSS propio). | Se portan a componentes TSX con CSS Modules dentro de la app (Fase 1); el bundle no se carga en producción. |
| H9 | `operaciones_sii` y `solicitudes_folios` **no están en la publicación de Realtime**; el SQL solo publica `documentos`, `envios` y `procesos_certificacion`. | Migración en la Fase 4 para que la UI vea en vivo las operaciones largas (solicitud de folios, postulación). |
| H10 | La carpeta `documentación/` tiene índice y estructura, pero el contenido es `TODO`. | Cada fase completa los archivos de `documentación/` que toca (criterio de aceptación transversal). |

---

## 2. Principios

1. **Lo que firma o habla con el SII vive solo en el servidor**, con `service_role`, en módulos marcados `import 'server-only'`. El navegador nunca recibe un `.pfx`, una clave, un CAF ni un token.
2. **RLS primero.** La app lee con la sesión del usuario (cliente `authenticated`); `service_role` se usa solo en la capa SII, los cron y la API pública, siempre filtrando por `organizacion_id`.
3. **Las operaciones ⚠️ no se repiten a ciegas.** Cada operación que graba en el SII tiene ensayo (equivalente a no pasar `--confirmar`) y confirmación explícita. Un resultado `incierto` bloquea el reintento y explica cómo revisar en el SII.
4. **Paridad con la librería.** No se reimplementa nada que `@winex/certificacion` ya haga (firma, TED, sobres, clientes REST/SOAP, folios, postulación). La app solo adapta persistencia, secretos y UI.
5. **Auditoría total.** Toda llamada al SII deja una fila en `operaciones_sii`, con `resultado` equivalente al código de salida de la CLI (0–7). Nunca tokens, claves ni cookies en mensajes, logs ni Sentry.
6. **Una sola base, y es producción.** Hay un único proyecto de Supabase en la nube (`rbrntkztzijaxsnpgpqn`); el desarrollo local y *Production* lo usan. Sin base local, ramas ni datos semilla: cada migración es aditiva y se verifica con SQL de solo lectura. La base de producción guarda los dos ambientes del SII (`certificacion` y `produccion`), separados por la columna `ambiente`.
7. **El tono y los formatos del design system son ley:** español de Chile con tú, sin exclamaciones ni emoji, nombres oficiales del SII, `$ 1.190.000`, `76.354.771-K`, `10-11-2026`, 24 h.

---

## 3. Arquitectura

```
                     ┌───────────────────────── Vercel (región gru1) ─────────────────────────┐
 Navegador ──HTTPS──▶│ Next.js App Router                                                     │
  (React 19,         │  ├─ RSC / páginas (lectura con sesión del usuario, RLS)                 │
   Zustand,          │  ├─ Server Actions (mutaciones del panel)                               │
   Turnstile)        │  ├─ /api/v1/*      API pública (API keys, alcances, Idempotency-Key)    │
                     │  ├─ /api/cron/*    seguimiento · webhooks · alertas · limpieza          │
                     │  ├─ /api/pagos/*   webhooks de la pasarela                              │
                     │  └─ server/sii/*   capa de servicio SII (runtime Node.js)               │
                     │        └─ @winex/certificacion (workspace)  ──TLS mutuo──▶  SII         │
                     └──────────┬──────────────────────────┬──────────────────────┬───────────┘
                                │                          │                      │
               Supabase (sa-east-1)                      Resend                Sentry
   Postgres + RLS · Auth (Turnstile, SMTP Resend)   (auth, invitaciones,   (errores, trazas,
   Vault (.pfx, claves, CAF, secretos HMAC)          alertas, envío de DTE)  cron monitors)
   Storage `documentos-xml` · Realtime · pg_cron/pg_net
```

**Rutas del SII por ambiente** (de `certificacion-node/docs/canales.md`): certificación
`apicert` / `pangal` / `maullin` (IDK 100); producción `api` / `rahue` / `palena` (IDK 300).

**Regiones:** Supabase en São Paulo (`sa-east-1`) y funciones de Vercel en `gru1`, lo más
cerca de Chile disponible para ambos. Se valida en el spike de la Fase 0.

### 3.1 Estructura del repositorio (monorepo pnpm)

```
timbre/
├── apps/web/                         Next.js
│   ├── src/app/
│   │   ├── (publico)/                landing, precios, legal
│   │   ├── (auth)/                   ingresar, crear-cuenta, recuperar, restablecer, invitacion/[token]
│   │   ├── auth/callback/route.ts    intercambio de código de Supabase Auth
│   │   ├── bienvenida/               onboarding: organización → empresa → certificado
│   │   ├── [org]/                    app autenticada (slug de la organización)
│   │   │   ├── tablero/
│   │   │   ├── emitir/
│   │   │   ├── documentos/  [id]/
│   │   │   ├── envios/      [id]/
│   │   │   ├── folios/
│   │   │   ├── certificacion/
│   │   │   └── configuracion/        empresa · certificados · equipo · plan · api · webhooks
│   │   └── api/  v1/ · cron/ · pagos/ · monitoring/ (túnel de Sentry)
│   ├── src/components/timbre/        port de los 8 componentes + layout (CSS Modules)
│   ├── src/stores/                   Zustand
│   ├── src/server/
│   │   ├── supabase/                 clientes: servidor (sesión), service-role (server-only)
│   │   ├── sii/                      capa de servicio SII (Fase 4)
│   │   ├── correo/                   Resend + plantillas
│   │   └── pdf/                      representación impresa con PDF417
│   ├── src/styles/                   tokens.css (generado), globals.css
│   ├── instrumentation.ts            Sentry (servidor/edge) + onRequestError
│   ├── instrumentation-client.ts     Sentry navegador
│   └── proxy.ts                      refresco de sesión y protección de rutas (ex middleware.ts)
├── packages/certificacion/           git subtree de certificacion-node completo (LICENSE, NOTICE, paridad/);
│                                     @winex/certificacion = packages/core, CLI sii = apps/cli
├── packages/correos/                 plantillas React Email con estilos Timbre en línea
├── supabase/
│   ├── migrations/0001_esquema_inicial.sql   ← supabase_saas_sii.sql tal cual
│   ├── migrations/00NN_*.sql                 cambios posteriores (nunca editar 0001)
│   └── verificaciones/                        SQL de solo lectura por migración (se corre en producción)
├── scripts/  generar-tokens.ts · tipos-supabase.ts
└── documentación/                    la carpeta actual, completada fase a fase
```

**Por qué `git subtree` y no un paquete publicado:** la librería es `private`, no está en un
registro y sigue cambiando (piloto en curso). Con subtree se versiona junto a la app, se
compila con `tsup` antes de `next build` y se actualiza con `git subtree pull`. Si más
adelante se publica en GitHub Packages, se cambia la dependencia sin tocar la app.

---

## 4. Decisiones por tecnología

### 4.1 Next.js

- App Router, TypeScript estricto, React 19. Fijar versiones exactas en `package.json`.
- **Runtime Node.js** en todo lo que toque `server/sii` (`export const runtime = 'nodejs'`); nada de Edge.
- `next.config.ts`: `serverExternalPackages: ['node-forge', 'undici']` para no empaquetarlas; `serverActions.bodySizeLimit` en `'2mb'` (un `.pfx` o un CAF caben sobrados).
- **Lecturas** en Server Components con el cliente de sesión (RLS). **Mutaciones** en Server Actions que validan con `zod` (la CLI ya usa zod) y devuelven errores con el formato del design system: qué pasó y qué hacer.
- `maxDuration` por ruta: 60 s para emisión; 300 s para solicitud de folios, postulación y declaración (varias peticiones al SII de hasta 45 s cada una, según `TransporteUndici`).

### 4.2 Estilos sin Tailwind

- `scripts/generar-tokens.ts` lee el `tokens.json` del design system y genera `src/styles/tokens.css` con custom properties (`--surface`, `--sello`, `--space-4`, `--radius-md`, `--shadow-sm`, `--focus-ring`, etc.) para tema claro y oscuro: `:root`, `@media (prefers-color-scheme: dark)` y `[data-theme="dark"|"light"]`.
- Componentes y páginas con **CSS Modules**; nada de colores literales fuera de `tokens.css`. Regla de lint (stylelint) que rechaza hex en `*.module.css`.
- Tipografía con `next/font/google`: IBM Plex Sans (400/500/600) e IBM Plex Mono (400/500), expuestas como `--font-sans` y `--font-mono`. `font-variant-numeric: tabular-nums` en montos.
- Íconos: `lucide-react`, 16 px en texto y 20 px en navegación, trazo 1,5.
- Movimiento: 120 ms hover/foco, 200 ms menús, `prefers-reduced-motion` respetado.

### 4.3 Zustand

Solo **estado de cliente**. Los datos del servidor llegan por RSC; Zustand no los duplica,
salvo lo que se actualiza en vivo por Realtime. Patrón recomendado para App Router: cada
store se crea por petición dentro de un *provider* de contexto (`createStore` + `useStore`),
para no compartir estado entre usuarios en el servidor.

| Store | Contenido | Persistencia |
|---|---|---|
| `useContextoStore` | organización, empresa activa y **ambiente** (certificación/producción) | cookie (la leen los RSC) |
| `useEmisionStore` | borrador del documento: tipo, receptor, líneas, descuento global; totales derivados (neto/IVA/exento con la regla `round(bruto/1,19)` de boleta) | `sessionStorage` (borrador sin guardar) |
| `useFiltrosStore` | período, tipo, estado, búsqueda y página de Documentos y Envíos | URL (`searchParams`) como fuente; el store solo sincroniza |
| `useEnVivoStore` | cambios de `documentos`, `envios`, `procesos_certificacion`, `operaciones_sii` recibidos por Realtime | memoria |
| `useUiStore` | tema, menú lateral, panel de detalle abierto, diálogos de confirmación | `localStorage` (tema) |

### 4.4 Supabase

- **Migración inicial = `supabase_saas_sii.sql` sin cambios.** Todo cambio va en migraciones nuevas y aditivas, aplicadas con `supabase db push` sobre el único proyecto (producción) y verificadas con su archivo de `supabase/verificaciones/`.
- Clientes con `@supabase/ssr`: navegador, servidor (cookies) y `service-role` (archivo `server-only`, jamás importable desde un componente cliente).
- Tipos generados (`supabase gen types typescript`, `pnpm db:tipos`) y versionados; se regeneran después de cada migración.
- **Vault** con `guardar_secreto()` / `leer_secreto()` (solo `service_role`) para `.pfx`, clave, XML del CAF y secretos HMAC.
- **Tokens del SII y cookies AUT2000:** AES-256-GCM en la app (`iv || ciphertext || tag`), llave `SII_TOKENS_KEY` en variables de entorno de Vercel marcadas como *sensitive*; nunca en la base.
- **Storage** `documentos-xml`: rutas `<org>/<empresa>/<ambiente>/<archivo>`; descargas con URL firmada de corta duración.
- **Realtime** para el panel en vivo (más la migración de H9).
- **Sin Branching ni base local:** el desarrollo local usa el mismo proyecto que *Production* (principio 6).
- **Cron:** `pg_cron` + `pg_net` llaman a `/api/cron/*` con un token en Vault (`cron_token`). Funciona en cualquier plan de Vercel; Vercel Cron solo permite frecuencias de minutos en Pro.

### 4.5 Vercel

- Proyecto con raíz `apps/web`, comando de build `pnpm --dir ../.. build` (compila la librería y luego la app; ver `apps/web/vercel.json`).
- **Solo se trabaja en *Production*:** no se usan deploys de *Preview* ni ramas; cada push a `main` despliega directo a producción. Las variables de entorno se cargan solo en *Production* (las públicas de Supabase también en *Development*, para `vercel env pull`). Los cron de `pg_cron` apuntan a la URL de *Production*.
- Dominio: `app.<dominio>` para la aplicación y el apex para el sitio público (o todo en uno; ver D6). DNS de Resend (SPF, DKIM, DMARC) en el mismo dominio.
- Firewall de Vercel: regla de *rate limiting* para `/api/v1/*` y para las rutas de autenticación.
- Fluid compute activo; revisar los límites de `maxDuration` del plan (Hobby 300 s, Pro hasta 800 s) al configurar.

### 4.6 Resend

| Uso | Detalle |
|---|---|
| Correos de Supabase Auth | SMTP personalizado de Supabase apuntando a Resend; plantillas de confirmación, recuperación y cambio de correo traducidas al tono Timbre |
| Invitaciones | enlace con el token que devuelve `crear_invitacion()` (se guarda solo su hash) |
| Alertas | certificado por vencer (30, 15, 7 y 1 días, desde `v_certificados_estado`), folios por agotarse (umbral del `MedidorFolios`, 15 %), documento rechazado, envío incierto, certificación actualizada |
| Envío del documento | PDF (y XML si se pide) al correo del receptor desde el detalle del documento |
| Facturación | comprobantes de pago y aviso de suscripción morosa (Fase 10) |

- Plantillas en `packages/correos` con React Email, estilos en línea tomados de los tokens (los clientes de correo no leen custom properties).
- Idempotencia: `Idempotency-Key` de Resend con el id del evento; tabla `notificaciones` para no repetir una alerta (migración en la Fase 8).

### 4.7 Turnstile

- **Supabase Auth trae soporte nativo de captcha con Turnstile:** se activa en *Auth → Bot and abuse protection* con la clave secreta, y el cliente pasa `options.captchaToken` en `signUp`, `signInWithPassword`, `resetPasswordForEmail` y `signInWithOtp`. Sin endpoints propios de verificación.
- Turnstile verificado en el servidor (`siteverify`) para formularios que no pasan por Auth: contacto/ventas del sitio público y aceptación de invitaciones.
- Widget en modo *managed*, con tema según `data-theme`, y mensaje de error con el tono del design system.

### 4.8 Sentry

- `@sentry/nextjs` con `instrumentation.ts`, `instrumentation-client.ts`, `onRequestError` y `global-error.tsx`; *source maps* subidos en el build de Vercel; túnel en `/api/monitoring` para que los bloqueadores no lo frenen.
- **Depuración obligatoria en `beforeSend` y `beforeSendSpan`:** quitar cabeceras `Authorization` y `Cookie`, cuerpos de peticiones, y cualquier campo `token`, `clave`, `pfx`, `cookies`, `secreto`, `RSASK`, `api_key`. Prueba automática que lo verifica.
- Etiquetas: `organizacion`, `empresa`, `ambiente`, `operacion_sii`, `resultado`. Usuario solo por id.
- *Cron monitors* para seguimiento, webhooks y alertas; alerta si un cron no corre.
- Alertas: tasa de `transporte` (código 4) por host del SII, cualquier `incierto` (código 6), cualquier `verificacion_fallida` (código 7), y errores 5xx de la API pública.
- Session Replay apagado en la app (datos tributarios) o con enmascaramiento total; activo solo en el sitio público.

---

## 5. Variables de entorno

| Variable | Dónde | Nota |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor, *sensitive* | solo `server/supabase/service.ts` |
| `SII_TOKENS_KEY` | servidor, *sensitive* | 32 bytes base64; AES-256-GCM de tokens y cookies |
| `CRON_SECRET` | servidor, *sensitive* | mismo valor que `cron_token` en Vault |
| `RESEND_API_KEY`, `CORREO_REMITENTE` | servidor | |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | público / servidor | la secreta también va en Supabase Auth |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | público / build | |
| `PAGOS_*` | servidor | según D4 |
| `NEXT_PUBLIC_APP_URL` | público | enlaces en correos |

No hay variables `SII_CERT_*` ni `SII_CAF_*` como en la CLI: en el SaaS esos datos son de
cada empresa y viven en Vault.

---

## 6. Migraciones previstas sobre el esquema

| Migración | Fase | Contenido |
|---|---|---|
| `0002_extensiones_cron` | 0 | `pg_cron` y `pg_net` (el `cron_token` se crea a mano en Vault) |
| `0003_preferencias` | 2 | **Aplicada** (2026-11-12): `perfiles.tema`, `perfiles.ultima_organizacion`, `perfiles.ultima_empresa` y RPC `ver_invitacion(token)` (anon) para `/invitacion/[token]`. Verificación: `supabase/verificaciones/0003_preferencias.sql` |
| `0004_cupo_sin_suscripcion` | 2 | **Aplicada** (2026-11-12): `exigir_cupo_usuarios` rechaza si no hay suscripción vigente (una organización `morosa` o `cancelada` aceptaba miembros sin tope; lo detectó `supabase/verificaciones/rls-fase2-tenancy.sql`). Verificación: `supabase/verificaciones/0004_cupo_sin_suscripcion.sql` |
| `0005_realtime_operaciones` | 4 | Agregar `operaciones_sii` y `solicitudes_folios` a `supabase_realtime` |
| `0006_bloqueos_sii` | 4 | RPC `bloquear_certificado(uuid)` con `pg_try_advisory_xact_lock` para serializar sesiones AUT2000 por certificado (el SII frena el re-login, error `01.01.215.500.771.52`) |
| `0007_notificaciones` | 8 | Tabla `notificaciones` (tipo, clave de deduplicación, enviado_en) para alertas por correo |
| `0008_planes_comerciales` | 10 | Grilla de planes definitiva (D5) |
| `0009_pagos` | 10 | `pagos` y `eventos_pasarela` (idempotencia de webhooks de la pasarela) |
| `0010_indices_fk` | 13 (o antes, con volumen) | Índices `concurrently` para las FK sin índice que reporta *Advisors* (sobre todo `organizacion_id`, que filtran las políticas RLS); una migración por índice o sin transacción |
| `00NN_dte_factura` | 14 | Tipos 33/34/52/56/61, columnas de receptor (giro, dirección, comuna), forma de pago, vencimiento, tabla `documento_referencias`, documentos recibidos, RCV |

Cada migración trae su verificación de solo lectura en `supabase/verificaciones/`. Los números son provisorios: el
definitivo se asigna al crear el archivo, en orden de creación (la de preferencias, de la
Fase 2, se crea antes que las de la Fase 4).

---

## 7. Fases

Cada fase termina con: código en `main` con lint, typecheck y tests en verde (locales), verificación en *Production* después del deploy, archivos de
`documentación/` correspondientes completos, y esta tabla de estado actualizada.

### Fase 0 — Fundaciones y prueba de conectividad

1. Monorepo pnpm, Biome (igual que `certificacion-node`), TypeScript estricto, `packages/certificacion` por subtree con su `LICENSE` y `NOTICE`. Se incorpora el monorepo completo de la librería: solo `packages/core` rompería las pruebas de paridad, que leen `paridad/` de la raíz.
2. **Spike de red:** una ruta Node.js en Vercel (`gru1`) que ejecuta el equivalente de `pnpm humo:tls` contra los 5 hosts de certificación, y una obtención de semilla/token en `apicert` con un certificado de prueba. Si el SII no responde desde Vercel, se decide antes de seguir (otra región o un worker propio con IP fija).
3. Proyecto Supabase (sa-east-1, el único, producción): migraciones `0001` y `0002` aplicadas con `supabase db push`; Vault, `pg_cron`, `pg_net`, bucket y Realtime verificados con `supabase/verificaciones/0001_esquema.sql`.
4. Proyecto Vercel en *Production*, con dominio y variables (apunta al mismo proyecto de Supabase que el desarrollo local).
5. Sentry conectado (error de prueba visible con *source maps*) y depuración de secretos probada.

**Criterio de aceptación:** un deploy de *Production* obtiene un token del SII de certificación desde Vercel y lo guarda cifrado en `tokens_sii`.

### Fase 1 — Design system en Next.js

1. `generar-tokens.ts` → `tokens.css` (claro/oscuro).
2. Port a TSX + CSS Modules de los 8 componentes con la misma API de `index.d.ts`: `Boton`, `EstadoDTE` (más la variante `incierto`, D3), `TipoDTE`, `Monto`, `CampoRut`, `Alerta`, `MedidorFolios`, `TablaDTE`. Utilidades `formatearMonto`, `formatearRut`, `validarRut`, `calcularDv` en `lib/formatos.ts`, compartidas con el servidor.
3. Componentes de soporte que las plantillas usan como clases `tb-*`: `Campo`, `Input`, `Select`, `Tarjeta`, `Tabla`, `NavItem`, `Dialogo` (confirmación de operaciones ⚠️), `PanelDetalle`, `Paginacion`, `BannerAmbiente` (franja visible siempre que el ambiente sea certificación).
4. *Layouts*: `LayoutApp` (menú lateral + selector de empresa + usuario, como Tablero/Emitir) y `LayoutIngreso` (panel `sello` con perforación + formulario).
5. Página interna `/_ds` (solo desarrollo) con todos los componentes en ambos temas; pruebas de accesibilidad con axe en Playwright (contraste 4,5:1, foco visible con `focus-ring`).

**Criterio:** cada componente se ve igual que su `preview.html` del design system en claro y oscuro, y pasa axe.

### Fase 2 — Autenticación, organizaciones y equipo

1. Supabase Auth con correo y contraseña (+ enlace mágico opcional), SMTP con Resend, Turnstile nativo de Auth.
2. Pantallas según la plantilla «Ingreso»: ingresar, crear cuenta, recuperar y restablecer contraseña. `proxy.ts` refresca la sesión y protege `/[org]/*`.
3. Onboarding `/bienvenida`: `crear_organizacion(nombre, slug)` (queda como propietario y con plan Certificación en prueba).
4. Equipo: `crear_invitacion()` + correo Resend; `/invitacion/[token]` llama a `aceptar_invitacion()` (el correo debe calzar); cambio de rol y baja según RLS (`tg_proteger_ultimo_propietario`).
5. Permisos en la UI derivados del rol (`propietario`, `administrador`, `emisor`, `lector`): se ocultan acciones, pero la autoridad es RLS.

**Criterio:** dos usuarios de organizaciones distintas no ven datos del otro (prueba e2e con dos organizaciones de prueba + simulación de roles en SQL con `rollback`); un `lector` no puede crear borradores.

**Pendientes** (el código está listo; Turnstile y Resend son opcionales en el código y se activan al cargar las claves):

- [ ] **Supabase Auth (panel):** Site URL `https://timbre-livid.vercel.app`; Redirect URLs `https://timbre-livid.vercel.app/auth/callback**` y `http://localhost:3000/auth/callback**`; «Confirm email» activo; contraseña mínima 8; plantillas de correo traducidas al tono Timbre con enlaces `token_hash` (`{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email|magiclink|recovery`).
- [ ] **Resend:** cuenta, dominio verificado (SPF, DKIM, DMARC), SMTP personalizado de Supabase Auth apuntando a Resend, y `RESEND_API_KEY` + `CORREO_REMITENTE` en `.env.local` y Vercel (*Production*). Probar el correo real de invitación.
- [ ] **Turnstile:** sitio en Cloudflare; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en Vercel (*Production*); desplegar **antes** de activar el captcha en Supabase Auth (*Bot and abuse protection*), o todo Auth falla con `captcha_failed`.
- [ ] **Deploy** a *Production* (commit y push a `main`) y humo de las rutas nuevas.
- [ ] **e2e con dos organizaciones reales en *Production*** (escribe en la base; requiere autorización y borrar los datos de prueba al terminar): crear cuenta y organización, invitar, aceptar con el correo correcto y con otro, cambiar rol, quitar, salir, último propietario, cupo del plan y aislamiento entre las dos organizaciones.
- [ ] Volver a correr `supabase/verificaciones/rls-fase2-tenancy.sql` para activar las comprobaciones 48–51 de `ver_invitacion` y sumar una para `0004` (organización `morosa` que no acepta miembros).
- [ ] Más adelante: reenviar la IP real a Supabase Auth (`sb-forwarded-for`, requiere clave `sb_secret`) para que los límites por IP no vean solo la IP de Vercel.

### Fase 3 — Empresas, certificados y resoluciones

1. CRUD de empresas (RUT con `CampoRut`, razón social ≤ 100, giro ≤ 80 sin abreviaciones, dirección ≤ 70, comuna ≤ 20, correo de intercambio con la regla `correo_sii`). `tg_limite_empresas` aplica el plan.
2. **Carga de certificado (.pfx)** por Server Action: `Certificado.desdeContenido(bytes, clave)` valida en el servidor; se extraen titular, CN, emisor, vigencia, huella SHA-256 y `pfx_legacy`; `.pfx` (base64) y clave van a Vault; la fila guarda solo los ids. Nunca se escribe el archivo en disco ni en Storage.
3. Asociación certificado ↔ empresa (`empresa_certificados`), con «representante electrónico» y «predeterminado».
4. Resoluciones: certificación (número 0, fecha del SII) y producción (número y fecha de la autorización).
5. Estado de certificados (`v_certificados_estado`) con `Alerta` `aviso` cuando faltan 30 días, como en el Tablero.

**Criterio:** subir un `.pfx` real deja la fila en `certificados`, los dos secretos en Vault y ningún rastro del archivo o la clave en logs ni en Sentry.

### Fase 4 — Capa de servicio SII (backend)

El corazón técnico. Todo en `apps/web/src/server/sii/`, `server-only`, runtime Node.js.

| Pieza | Responsabilidad |
|---|---|
| `credenciales.ts` | Lee `.pfx` + clave desde Vault y devuelve `Certificado` / `FirmaElectronica` en memoria, con caché por invocación |
| `token-store-supabase.ts` | Implementa el `TokenStore` de la librería sobre `token_obtener` / `token_guardar` / `token_borrar`, cifrando con `SII_TOKENS_KEY` |
| `sesiones.ts` | Guarda y recupera cookies de `SesionSii` (`aArreglo` / `desdeArreglo`) cifradas en `sesiones_sii`; reutiliza antes de volver a autenticar |
| `bloqueos.ts` | `bloquear_certificado()` para que dos peticiones no abran sesiones AUT2000 en paralelo con el mismo certificado |
| `transporte.ts` | Un `TransporteUndici` por invocación, cerrado con `await using` |
| `operacion.ts` | `ejecutarOperacion({ operacion, ambiente, confirmada, ... }, fn)`: inserta `operaciones_sii` en `en_curso`, ejecuta, traduce el error tipado de la librería (`SiiError` y derivados) a `resultado_operacion` (ok/error/uso/config/transporte/rechazo_sii/incierto/verificacion_fallida), registra en Sentry con etiquetas y cierra la fila |
| `almacen.ts` | Sube XML (ISO-8859-1, `Buffer` tal cual) y PDF a Storage; URLs firmadas |
| `errores.ts` | Mensajes para el usuario según el design system: qué pasó y qué hacer; el detalle técnico queda en `operaciones_sii.detalle` |

Migraciones `realtime_operaciones` y `bloqueos_sii` (§6). Pruebas con `TransporteFalso` de la librería (sin red) para
cada traducción de error, y una prueba de integración opcional contra certificación.

**Criterio:** `ejecutarOperacion` cubre los 8 resultados con pruebas; ningún token o cookie aparece en `operaciones_sii`, logs ni Sentry (prueba que busca patrones).

### Fase 5 — Certificación ante el SII (boleta)

Asistente en `/[org]/certificacion`, con el diseño de la plantilla pero con los pasos del
proceso de boleta que implementa la librería:

| Paso visible | Etapas (`etapa_certificacion`) | Operación de la librería | ⚠️ |
|---|---|---|---|
| 1. Postulación | `borrador` → `postulada` | `PostulacionSii.postular` (muestra `avisos_postulacion`) | sí |
| 2. Set de pruebas | `set_descargado` | `DeclaracionBoletas.descargarSetPruebas` + `parsearSetPruebas` → `set_pruebas_casos` | sí |
| 3. Folios y envío del set | `set_enviado` → `set_aceptado` | `SolicitudFolios` (certificación) → `ArmadorBoleta` por caso (`CodRef SET`, `CASO-N`) → `EnvioBoleta` → REST o DTEUpload → estado del envío | sí |
| 4. Revisión | `revision_solicitada` → `por_declarar` (P90) | `DeclaracionBoletas.solicitarRevisionSet`, `EstadoDeclaracion` | sí |
| 5. Declaración de cumplimiento | `autorizada` (P91) | `DeclaracionBoletas` (declarar) + `EstadoDeclaracion`; el trigger marca `empresas.autorizada_produccion` | sí |

- Cada acción ⚠️ muestra primero el **ensayo** (qué se enviará, con qué certificado, a qué ambiente) y pide confirmar en un `Dialogo`.
- La UI escucha `procesos_certificacion` y `operaciones_sii` por Realtime; no hay spinners por fila.
- `verificar_portal` (versión GWT del portal) se ejecuta antes de postular o declarar; si falla (código 7), se bloquea el paso y se avisa.
- Correo y webhook `certificacion.actualizada` en cada cambio de etapa.

**Criterio:** con un RUT de prueba en certificación, el asistente reproduce lo que hace la CLI (`sii certificacion ...`) y deja las mismas filas que documenta el esquema.

### Fase 6 — Folios (CAF)

1. Vista `/[org]/folios`: un `MedidorFolios` por tipo y ambiente (`v_folios_disponibles`), historial de CAF y de `solicitudes_folios`.
2. **Solicitar folios** con `SolicitudFolios` (asistente `of_*`): ensayo (`simulada`) y confirmación (`timbrada`). `folio_inicial` solo si el SII lo pide (primer timbraje). Requiere certificado de representante electrónico.
3. **Estado `incierta`:** bloquear el reintento y guiar para bajar el CAF desde «Folios ya autorizados» del SII.
4. **Subir un CAF** existente (XML): validar IDK (100/300) contra el ambiente, RUT y tipo; el XML completo (con `RSASK`) va a Vault.
5. Anular folios no usados (`folios_anulados`, administradores).
6. Alerta `folios.por_agotarse` (correo + webhook) al cruzar el 15 %; el botón de emitir se deshabilita si el CAF se agotó, como pide la guía del `MedidorFolios`.

**Criterio:** solicitar un CAF de certificación desde la UI deja el CAF en Vault y en `cafs`, con `siguiente_folio` en `folio_desde`.

### Fase 7 — Emisión de boletas

Pantalla `/[org]/emitir` adaptada de la plantilla «Emitir» a boleta (H2): tipo 39/41,
receptor opcional (por defecto `66666666-6` «Cliente General») con autocompletado de
`receptores`, líneas con productos del catálogo, descuento global, resumen con folio que se
asignará y totales. Cálculo en `useEmisionStore` con la misma regla que la librería
(precio bruto; neto = `round(bruto / 1,19)`; IVA = bruto − neto).

Flujo del servidor (`emitirDocumento`):

```
1. Validar rol (puede_emitir), empresa activa, ambiente y, en producción, autorizada_produccion + plan.
2. Guardar el borrador (documentos + documento_detalles) si viene del formulario.
3. service_role: asignar_folio(empresa, ambiente, tipo) → caf_id, folio  (bloquea el CAF)
4. Leer CAF y certificado desde Vault → ArmadorBoleta.armar(datos, caf) → DTE firmado (Buffer ISO-8859-1)
5. Subir el XML a Storage; documentos ← folio, caf_id, ted_xml, timbrado_en, firmado_en, estado 'firmado'
6. Crear envios (rest, emision, carátula con resolución vigente) → EnvioBoleta.empaquetar → ClienteBoletaRest.enviar
7. Con Track ID → estado 'enviado'.  Sin Track ID → envios.incierto = true, documento 'incierto' (no reenviar sin revisar).
8. Error antes de firmar con folio ya asignado → folios_anulados (regla del esquema).
9. Todo dentro de ejecutarOperacion('emitir'); cuota contada por tg_contar_uso_documento.
```

- **Representación impresa (PDF):** `server/pdf/` con `pdfkit` y `bwip-js` (código PDF417 del `ted_xml`), formato carta y rollo de 80 mm; se guarda en Storage junto al XML.
- Envío del PDF por correo (Resend) al receptor, si tiene correo.
- «Guardar borrador» usa RLS directo (los emisores pueden crear y editar borradores).
- Agrupación de varias boletas en un mismo envío: en la Fase 11 para la API (lotes); el panel envía de a una.

**Criterio:** en certificación, una boleta emitida desde la UI llega a EPR aceptada y su PDF muestra un PDF417 que `sii util verificar-ted` valida.

### Fase 8 — Seguimiento de envíos y documentos

1. `/api/cron/seguimiento` cada 5 minutos (pg_cron): lee `v_envios_por_consultar`, agrupa por empresa y ambiente, **un token por empresa**, consulta estado (REST `EstadoEnvioRest` o SOAP `EstadoEnvio`), guarda `envios`, `envio_estadisticas`, `envio_rechazos` y `consultas_envio`; los triggers propagan a `documentos` y encolan webhooks. *Cron monitor* de Sentry.
2. Envíos `incierto`: nunca se reintentan solos; aparecen en el Tablero con una `Alerta` y la guía para revisar en el SII.
3. `/[org]/documentos` según la plantilla: filtros (período, tipo, estado, búsqueda) en la URL, `TablaDTE` paginada en el servidor, panel de detalle con acciones (descargar XML y PDF, consultar estado en el SII, reenviar al receptor). «Anular con nota de crédito» queda oculto hasta la Fase 14.
4. `/[org]/envios/[id]`: carátula, Track ID, bitácora de consultas, rechazos y reparos con sus errores (`seccion`, `linea`, `codigo`, `descripcion`), mostrando el XML solo como detalle.
5. Realtime: los badges `EstadoDTE` cambian solos.
6. Alertas por correo con `notificaciones` (migración `notificaciones`, §6): rechazo, incierto, certificado por vencer.

**Criterio:** un envío pasa de `enviado` a `aceptado` en la UI sin recargar, y un rechazo muestra el error del SII con el texto del design system.

### Fase 9 — Tablero y reportes

1. Tablero como la plantilla: cifras del período (ventas netas, IVA débito, documentos emitidos por estado, esperando al SII) desde `v_ventas_diarias` y `documentos`; medidores de folios; últimos documentos; alertas de certificado y folios.
2. Exportación CSV/Excel de documentos del período y resumen diario por tipo.
3. Selector de período tributario y de ambiente.

**Criterio:** las cifras del tablero cuadran con una consulta SQL de control sobre `documentos` aceptados.

### Fase 10 — Planes, suscripciones y cuotas

1. Grilla definitiva (D5) en `planes`; página de plan en Configuración con uso del mes (`uso_mensual`) y límites (empresas, usuarios, boletas, producción, API, webhooks).
2. Adaptador de pasarela (`server/pagos/`) con la implementación elegida en D4: alta de suscripción, cobro recurrente, webhook firmado → `suscripciones` (`activa`, `morosa`, `cancelada`) y `pagos`.
3. Comportamiento al exceder cuota o quedar `morosa`: los triggers ya lo aplican; la UI lo explica antes de que el usuario choque con el error.

**Criterio:** cambiar de plan en *sandbox* de la pasarela actualiza `suscripciones` y los límites se aplican en la siguiente emisión.

### Fase 11 — API pública y webhooks

1. Configuración → API: `crear_api_key()` (la clave se muestra **una vez**), alcances, ambiente, expiración, revocación, último uso.
2. `/api/v1/*` (Node.js, `service_role` tras autenticar la clave por su SHA-256):
   - `POST /documentos` (emitir; header `Idempotency-Key` → `documentos.clave_idempotencia`), `POST /documentos/lote`, `GET /documentos`, `GET /documentos/{id}`, `GET /documentos/{id}/xml|pdf`
   - `GET /folios`, `POST /folios/solicitudes` (alcance `folios:solicitar`)
   - `GET /envios/{id}`
   - Alcances: `documentos:leer`, `documentos:emitir`, `folios:leer`, `folios:solicitar`, `envios:leer`, `certificacion:gestionar`.
   - `operaciones_sii.api_key_id` en cada operación; `origen = 'api'`.
3. Especificación OpenAPI y página de documentación de la API (la landing ya tiene la sección «Una API para tu sistema»).
4. Webhooks: `crear_webhook()` (secreto HMAC una vez); `/api/cron/webhooks` cada minuto entrega `webhook_entregas` pendientes con firma `HMAC-SHA256` (secreto desde Vault), reintentos con *backoff* exponencial y `descartado` tras N intentos; UI con historial de entregas y botón de reenvío.
5. *Rate limiting* con el Firewall de Vercel por clave/IP.

**Criterio:** un cliente de ejemplo emite una boleta por la API, repite la petición con la misma `Idempotency-Key` sin duplicar, y recibe el webhook `documento.aceptado` con firma válida.

### Fase 12 — Sitio público

1. Landing según la plantilla «Landing» (hero, ciclo del documento, certificación paso a paso, API, precios con la grilla de D5, llamado a empezar por la certificación). Textos ajustados a boleta mientras no exista la Fase 14 (sin prometer factura ni Libro de Compras y Ventas).
2. Términos, privacidad (tratamiento de certificados y datos tributarios), página de estado/soporte.
3. SEO: metadatos, `sitemap.ts`, `robots.ts`, imágenes OG.
4. Formulario de contacto con Turnstile verificado en el servidor y correo por Resend.

### Fase 13 — Endurecimiento y lanzamiento

1. Revisión de seguridad: RLS (simulación de roles por tabla según `acceso-por-tabla`, en transacciones con `rollback`), que ninguna ruta use `service_role` sin filtrar por organización, cabeceras (CSP con Turnstile y Sentry, HSTS), `server-only` en todo `server/`.
2. Pruebas e2e con Playwright de los flujos críticos: registro → organización → empresa → certificado → certificación (con SII falso) → folios → emisión → seguimiento.
3. Respaldo: PITR de Supabase; procedimiento de restauración probado; rotación de `SII_TOKENS_KEY` documentada.
4. Observabilidad: tableros y alertas de Sentry de §4.8; *runbook* para `incierto`, caída del SII y CAF agotado.
5. `documentación/07-referencia/checklist-produccion.md` completo y ejecutado.
6. **Piloto:** primero la empresa ya autorizada del piloto de `certificacion-node` (CAF de producción, tipo 39), después 3–5 clientes en producción durante dos semanas con seguimiento diario, igual que la Fase 8 del plan de la librería.

**Criterio:** dos semanas de piloto sin incidentes de seguridad y con todas las boletas EPR o explicadas.

### Fase 14 — Facturas y demás DTE (posterior al lanzamiento)

Lo que las plantillas muestran y la librería todavía no hace (H1–H3). Requiere un plan
propio en `certificacion-node` con la misma disciplina de paridad y validación en
certificación:

- Generador y armador de DTE 33, 34, 52, 56 y 61 (con referencias), y sobre `EnvioDTE` por DTEUpload.
- Intercambio entre contribuyentes (recepción, acuse de recibo, aceptación/reclamo), documentos recibidos.
- Registro de Compras y Ventas.
- Certificación de factura: set, simulación, intercambio y muestras de impresión (los 6 pasos de la plantilla).
- Migración `00NN_dte_factura` y activación de los ítems ocultos del menú y de «Anular con nota de crédito».

---

## 8. Estrategia de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Librería | Vitest (existente, ~1.900 tests y paridad) | Se corren con `pnpm test` del monorepo sin cambios |
| Unitarias de la app | Vitest | formatos, cálculo de totales, traducción de errores, cifrado de tokens, firma HMAC |
| Capa SII | Vitest + `TransporteFalso` | cada operación y cada resultado 0–7, sin red |
| Base de datos | SQL de solo lectura (`supabase/verificaciones/`) y simulación de roles con `rollback`, sobre el único proyecto (producción) | esquema tras cada migración, RLS por tabla y rol, triggers de cuotas, `asignar_folio` concurrente |
| e2e | Playwright (el proyecto ya tiene el MCP) | flujos críticos con SII falso; accesibilidad con axe |
| Integración real | ejecución manual contra certificación (`pnpm humo:tls`) | humo TLS, token, estado de un envío conocido; nunca automática |

---

## 9. Decisiones pendientes

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Alcance del MVP: ¿solo boleta (39/41) o esperar facturas? | **Solo boleta**: es lo que la librería ya probó en producción; factura en la Fase 14 |
| D2 | Cómo incorporar la librería | **git subtree** en `packages/certificacion` (§3.1) |
| D3 | Nombre y tono del estado `incierto` en `EstadoDTE` | «Por verificar», tono `aviso`, glifo de interrogación; agregarlo al design system. **Aplicada en la Fase 1** (app) y reflejada en el artifact el 2026-11-12 |
| D4 | Pasarela de pagos | **Flow** (suscripciones recurrentes en CLP, ya tienes su MCP); Transbank Oneclick como alternativa |
| D5 | Grilla de planes y precios | Unificar la landing (Pyme / Contador / API) con `planes`; «Contador» = varias empresas por organización |
| D6 | Dominio | Sitio público y app en el mismo dominio (`/` y `/[org]`) para compartir sesión y simplificar; subdominio si se separa el marketing |
| D7 | Canal de envío por defecto | REST para emisión (pangal/rahue); SOAP DTEUpload como respaldo configurable por empresa |
| D8 | Nombre del producto | «Timbre», como en el design system (verificar disponibilidad de marca y dominio) |

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El SII bloquea o ralentiza conexiones desde IPs de Vercel | Spike en la Fase 0; plan B: worker Node con IP fija en Chile para la capa SII |
| Operaciones largas exceden `maxDuration` | `maxDuration` por ruta, progreso por Realtime, y operaciones idempotentes desde `operaciones_sii` |
| Re-login AUT2000 frenado por el SII | Reutilizar `sesiones_sii` y bloqueo por certificado (migración `bloqueos_sii`) |
| Doble envío tras un resultado incierto | Bloqueo de reintento en UI y API; guía para revisar en el SII |
| Fuga de secretos (pfx, tokens, CAF) | Vault, cifrado AES-GCM, `server-only`, depuración en Sentry con prueba automática |
| Cambios del portal del SII (GWT, formularios `of_*`) | `verificar_portal` antes de operar; alertas de código 7; la librería tiene pruebas de paridad para ajustar rápido |
| Una sola base (producción) para desarrollo y *Production*: un error de desarrollo o una migración mala toca datos reales | Migraciones aditivas con `db push --dry-run` y respaldo previo; verificación de solo lectura después; pruebas de escritura solo dentro de `begin … rollback`; organizaciones de prueba identificadas y borradas al terminar; PITR (Fase 13) |
| Expectativa de factura por las plantillas | Ocultar lo no soportado y textos del sitio honestos sobre el alcance |
