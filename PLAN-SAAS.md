# Plan del SaaS «Boletéame»: emisión de documentos tributarios electrónicos (SII)

Plan para construir el SaaS de emisión, firma y envío de DTE al SII, y de certificación de
empresas, sobre la librería `@winex/certificacion` (`../certificacion-node`).

- **Fecha del plan:** 2026-11-10
- **Stack:** Next.js (App Router), sin Tailwind (CSS Modules + tokens CSS), Zustand, Supabase
  (Postgres, Auth, Vault, Storage, Realtime), Vercel (hosting, dominio, cron), Resend
  (correo), Cloudflare Turnstile (verificación) y Sentry (monitoreo).
- **Fuentes:**
  - Modelo de datos: [`supabase_saas_sii.sql`](documentación/08-esquema-supabase/supabase_saas_sii.sql) (19 secciones, RLS, Vault, Storage, Realtime).
  - Librería y CLI: `../certificacion-node` (fases 0–7 listas; piloto en producción en curso, 5 boletas reales EPR).
  - Design system «Boletéame»: <https://claude.ai/artifact/UCjvbZq6pYi2bYVBcuviwr> (tokens, tono, 8 componentes; renombrado de «Timbre» a «Boletéame» el 2026-11-12, versión 7).
  - Plantillas: <https://claude.ai/artifact/HjnXwP9jcNrawftr55XpRu> (Landing, Ingreso, Tablero, Documentos emitidos, Emitir factura, Certificación SII; marca «Boletéame» desde el 2026-11-12, versión 14, igual a `design-system/boleteame/plantillas/`).
  - Documentación para agentes: [`documentación/`](documentación/) (completa en lo que tocan las Fases 0–5; quedan esqueletos `TODO` en archivos generales y de fases posteriores).

## Estado

Valores de la columna Estado: **Listo**, **En parte** o Pendiente. Se actualiza al terminar cada tarea.

| Fase | Estado | Nota |
|---|---|---|
| 0. Fundaciones y prueba de conectividad | **Listo** | **Criterio de aceptación cumplido** (2026-11-11: token de apicert desde Vercel `gru1`, guardado cifrado en `tokens_sii`); spike del SII retirado. 2026-11-12: Sentry conectado (proyecto `luckillash/sii-web`, antes `timbre-web`), variables en Vercel (solo *Production*) y error real de prueba verificado en producción: release del commit, *source maps* legibles y secretos depurados (también en spans, con `beforeSendSpan`). Rutas de prueba retiradas |
| 1. Design system en Next.js | **Listo** | 2026-11-11: tokens generados, 8 componentes (+ `incierto`, D3), 11 de soporte, 2 layouts, `/_ds` y axe sin violaciones en claro/oscuro/móvil. Deploy `F1` (c307194) verificado en producción con `e2e/despliegue.spec.ts`. 2026-11-12: `incierto` agregado también al artifact del design system y a su copia en `design-system/boleteame/` |
| 2. Autenticación, organizaciones y equipo | **Listo** | **Criterio de aceptación cumplido** (2026-11-13: e2e con dos organizaciones reales en *Production*, con aislamiento en la UI y en SQL; `rls-fase2-tenancy.sql` en producción 1–51 y 53 `ok`, incluida la 21 «un lector no puede crear borradores»; correos reales de invitación *Delivered* por Resend desde `no-responder@mail.boleteame.dev` y con enlace a `/invitacion/…`). 2026-11-12: código listo (ingreso, crear cuenta, recuperar/restablecer, `proxy.ts`, callback, onboarding, `[org]`, equipo, invitaciones); lint, typecheck, Vitest, build y e2e sin escritura en verde. Migraciones `0003_preferencias` y `0004_cupo_sin_suscripcion` aplicadas y verificadas (13/13). En *Production*: dominio `boleteame.dev`, Supabase Auth con plantillas Boletéame y SMTP de Resend, Turnstile, IP real reenviada a Auth y claves legadas desactivadas. La revocación inmediata de sesiones baneadas pasó a las Fases 4 y 13 |
| 3. Empresas, certificados y resoluciones | **Listo** | **Criterio de aceptación cumplido** (2026-11-13: `.pfx` real de IDOK en *Production*: fila en `certificados`, 2 secretos en Vault, RUT extraído del certificado, sin rastros en logs ni Sentry). Código (empresas con resoluciones, certificados `.pfx` a Vault con `registrar_certificado`, asociación empresa ↔ certificado, avisos de vencimiento en el Tablero); lint, typecheck, Vitest (301), stylelint y build en verde; `documentación/` de la fase completa. Migración `0005_certificados_resoluciones` aplicada y verificada (15/15) y simulación de roles `rls-fase3-empresas.sql` 43/43; tipos regenerados. Deploy `b4d799c` verificado en *Production* |
| 4. Capa de servicio SII (backend) | **Listo** | **Criterio de aceptación cumplido** (2026-11-13: 8 resultados y búsqueda de patrones de secretos en pruebas; prueba manual contra certificación con el certificado real en verde: token REST auditado en `operaciones_sii` sin secretos, caché en `tokens_sii` y bloqueo con arriendo por PostgREST). Deploy `2fbc739` verificado en *Production*. Código listo en `server/sii/` (`credenciales`, `sesiones`, `bloqueos`, `transporte`, `operacion`, `almacen`, `errores`); **criterio cubierto en pruebas** (8 resultados de `ejecutarOperacion` y búsqueda de patrones de secretos en `operaciones_sii`, Sentry y consola). Typecheck, Vitest (452), Biome, stylelint y build en verde; `documentación/` de la fase completa; carrera de doble timbraje cerrada con índice único. Migraciones `0006_realtime_operaciones` y `0007_bloqueos_sii` **aplicadas** en producción (verificaciones 9/9 y 14/14, simulación 21/21) y tipos regenerados sin diferencias |
| 5. Certificación ante el SII (boleta) | **En parte** | 2026-11-13: desplegado y verificado en *Production* (`0d27c20`). Asistente `/[org]/certificacion` con los 5 pasos, ensayo + `Dialogo` antes de cada operación ⚠️ y Realtime; `server/certificacion/` sobre la capa SII de la Fase 4; correo de cambio de etapa; empresas autorizadas fuera de Boletéame (resolución de producción → «Autorizada fuera de Boletéame», con la empresa del piloto ya marcada). Typecheck, Vitest (586), Biome, stylelint y build en verde; `documentación/` de la fase completa. Migraciones `0008_certificacion` y `0009_autorizacion_externa` **aplicadas** (10/10 y 16/16; 9/9 y 12/12; tipos sin diferencias). **Pendiente, por decisión del usuario:** el criterio de aceptación contra el SII de certificación, que requiere otra empresa de prueba (ver Pendientes de la fase). **Prevista, sin código:** «Verificar autorización en el SII» con la página «Actualización de datos del contribuyente» (`ad_empresa1/2` de palena), validada en producción el 2026-11-13 en solo lectura: si el titular del certificado es representante legal, el SII confirma la autorización y entrega la resolución de producción. La consulta pública de situación tributaria (STC, timbrajes) queda como fuente de apoyo (ver «Verificar autorización en el SII» en la Fase 5; migración `0010_verificar_autorizacion`) |
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
| H8 | **Los componentes del design system son un bundle global** (`window.Boleteame`, React 18, CSS propio). | Se portan a componentes TSX con CSS Modules dentro de la app (Fase 1); el bundle no se carga en producción. |
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
sii/
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
│   ├── src/components/boleteame/        port de los 8 componentes + layout (CSS Modules)
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
├── packages/correos/                 plantillas React Email con estilos Boletéame en línea
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
- Dominio: `boleteame.dev` (apex, DNS en Vercel); `www.boleteame.dev` redirige con 308 al apex. Sitio público y app en el mismo dominio (D6). DNS de Resend (SPF, DKIM, DMARC) en el mismo dominio.
- Firewall de Vercel: regla de *rate limiting* para `/api/v1/*` y para las rutas de autenticación.
- Fluid compute activo; revisar los límites de `maxDuration` del plan (Hobby 300 s, Pro hasta 800 s) al configurar.

### 4.6 Resend

| Uso | Detalle |
|---|---|
| Correos de Supabase Auth | SMTP personalizado de Supabase apuntando a Resend; plantillas de confirmación, recuperación y cambio de correo traducidas al tono Boletéame |
| Invitaciones | enlace con el token que devuelve `crear_invitacion()` (se guarda solo su hash) |
| Alertas | certificado por vencer (30, 15, 7 y 1 días, desde `v_certificados_estado`), folios por agotarse (umbral del `MedidorFolios`, 15 %), documento rechazado, envío incierto, certificación actualizada |
| Envío del documento | PDF (y XML si se pide) al correo del receptor desde el detalle del documento |
| Facturación | comprobantes de pago y aviso de suscripción morosa (Fase 10) |

- Plantillas en `packages/correos` con React Email, estilos en línea tomados de los tokens (los clientes de correo no leen custom properties).
- Idempotencia: `Idempotency-Key` de Resend con el id del evento; tabla `notificaciones` para no repetir una alerta (migración en la Fase 8).

### 4.7 Turnstile

- **Supabase Auth trae soporte nativo de captcha con Turnstile:** se activa en *Authentication → Attack Protection* (antes *Bot and abuse protection*) con la clave secreta, y el cliente pasa `options.captchaToken` en `signUp`, `signInWithPassword`, `resetPasswordForEmail` y `signInWithOtp`. Sin endpoints propios de verificación.
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
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | público | clave `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | servidor, *sensitive* | clave `sb_secret_…`; `server/supabase/service.ts` (service_role) y `server/supabase/clave-auth.ts` (reenvía la IP real a Auth con `sb-forwarded-for`; esos clientes nunca para datos) |
| `SII_TOKENS_KEY` | servidor, *sensitive* | 32 bytes base64; AES-256-GCM de tokens y cookies |
| `CRON_SECRET` | servidor, *sensitive* | mismo valor que `cron_token` en Vault |
| `RESEND_API_KEY`, `CORREO_REMITENTE` | servidor | |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | público / servidor, *sensitive* | la secreta también va en Supabase Auth (*Attack Protection*); la pública se incrusta al compilar |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | público / build | |
| `PAGOS_*` | servidor | según D4 |
| `NEXT_PUBLIC_APP_URL` | público | enlaces en correos; `https://boleteame.dev` en *Production*, `http://localhost:3000` en local |

No hay variables `SII_CERT_*` ni `SII_CAF_*` como en la CLI: en el SaaS esos datos son de
cada empresa y viven en Vault.

Solo claves API nuevas, y `env.ts` rechaza las demás por prefijo. Las legadas (`anon` / `service_role`, JWT `eyJ…`) están **desactivadas** en Supabase desde el 2026-11-13 (responden 401). Falta el retiro definitivo, que es revocar la clave HS256 legada en *JWT Keys* (Fase 13). Los JWT de sesión se firman con ES256 y se verifican localmente con el JWKS, así que una sesión revocada sigue sirviendo hasta su `exp` (≤ 1 h). Detalle y reglas en `documentación/01-fundamentos/ambientes-y-credenciales.md`.

---

## 6. Migraciones previstas sobre el esquema

| Migración | Fase | Contenido |
|---|---|---|
| `0002_extensiones_cron` | 0 | `pg_cron` y `pg_net` (el `cron_token` se crea a mano en Vault) |
| `0003_preferencias` | 2 | **Aplicada** (2026-11-12): `perfiles.tema`, `perfiles.ultima_organizacion`, `perfiles.ultima_empresa` y RPC `ver_invitacion(token)` (anon) para `/invitacion/[token]`. Verificación: `supabase/verificaciones/0003_preferencias.sql` |
| `0004_cupo_sin_suscripcion` | 2 | **Aplicada** (2026-11-12): `exigir_cupo_usuarios` rechaza si no hay suscripción vigente (una organización `morosa` o `cancelada` aceptaba miembros sin tope; lo detectó `supabase/verificaciones/rls-fase2-tenancy.sql`). Verificación: `supabase/verificaciones/0004_cupo_sin_suscripcion.sql` |
| `0005_certificados_resoluciones` | 3 | **Aplicada** (2026-11-13, verificación 15/15 y simulación 43/43): RPC `registrar_certificado` (solo service_role; .pfx y clave a Vault y fila en `certificados` en una transacción), `fijar_certificado_predeterminado` y `registrar_resolucion` (invoker, RLS de administradores). Verificación: `supabase/verificaciones/0005_certificados_resoluciones.sql`; simulación de roles: `rls-fase3-empresas.sql` |
| `0006_realtime_operaciones` | 4 | **Aplicada** (2026-11-13, verificación 9/9): agrega `operaciones_sii` y `solicitudes_folios` a `supabase_realtime` (idempotente; *replica identity* por defecto). Verificación: `supabase/verificaciones/0006_realtime_operaciones.sql` (9) |
| `0007_bloqueos_sii` | 4 | **Aplicada** (2026-11-13, verificación 14/14 y simulación 21/21): bloqueo **con arriendo** por certificado y ambiente para serializar sesiones AUT2000 (el SII frena el re-login, error `01.01.215.500.771.52`): tabla `bloqueos_sii` y RPC `tomar_bloqueo_certificado` / `liberar_bloqueo_certificado` (solo service_role). Reemplaza al `bloquear_certificado` con `pg_try_advisory_xact_lock` que proponía el plan: ese bloqueo se suelta al terminar la transacción de la RPC (cada llamada de PostgREST es una) y no serializa nada entre peticiones; uno de sesión se filtraría con el pool. Incluye el índice único parcial `operaciones_sii_efecto_global_en_curso`, que impide dos `solicitar_folios`/`postular`/`declarar` confirmadas en curso a la vez por empresa y ambiente. Verificación: `supabase/verificaciones/0007_bloqueos_sii.sql` (14); comportamiento: `rls-fase4-bloqueos.sql` (21, con `rollback`) |
| `0008_certificacion` | 5 | **Aplicada** (2026-11-13, verificación 10/10 y simulación 16/16): RPC `registrar_caf` (XML del CAF a Vault + fila en `cafs` + solicitud `timbrada`, en una transacción; idempotente; la reutiliza la Fase 6) y `guardar_set_pruebas` (reemplaza los casos y deja el proceso en `set_descargado`, junto). Solo service_role; sin tablas ni políticas. Verificación: `supabase/verificaciones/0008_certificacion.sql` (10); simulación: `rls-fase5-certificacion.sql` (16, con `rollback`). En PGlite 10/10 y 16/16 |
| `0009_autorizacion_externa` | 5 | **Aplicada** (2026-11-13, verificación 9/9 y simulación 12/12): trigger en `resoluciones` que, con una resolución de producción vigente, marca `empresas.autorizada_produccion` (empresas certificadas fuera de Boletéame: el SII les responde «sin trámite», no P91). Nunca desmarca. Verificación: `supabase/verificaciones/0009_autorizacion_externa.sql` (9); simulación: `rls-fase5-autorizacion-externa.sql` (12, con `rollback`). En PGlite 9/9 y 12/12 |
| `0010_verificar_autorizacion` | 5 | **Prevista** (decisión del usuario 2026-11-13): agrega el valor `verificar_autorizacion` (🔁, lectura) al enum `operacion_sii`, para auditar la consulta de `ad_empresa` (Fase 5, «Verificar autorización en el SII»). Solo eso: `alter type … add value` no se puede usar en la misma transacción que lo agrega. Sin tablas ni políticas nuevas (la resolución se registra con lo que ya existe y la marca la pone el trigger de la 0009). Verificación: `supabase/verificaciones/0010_verificar_autorizacion.sql` |
| `0011_notificaciones` | 8 | Tabla `notificaciones` (tipo, clave de deduplicación, enviado_en) para alertas por correo |
| `0012_planes_comerciales` | 10 | Grilla de planes definitiva (D5) |
| `0013_pagos` | 10 | `pagos` y `eventos_pasarela` (idempotencia de webhooks de la pasarela) |
| `0014_indices_fk` | 13 (o antes, con volumen) | Índices `concurrently` para las FK sin índice que reporta *Advisors* (sobre todo `organizacion_id`, que filtran las políticas RLS); una migración por índice o sin transacción |
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

- [x] **Dominio** `boleteame.dev` en Vercel (DNS de Vercel), `www` con redirección 308 al apex, y `NEXT_PUBLIC_APP_URL=https://boleteame.dev` en *Production* (2026-11-12). `timbre-livid.vercel.app` redirige con 308 a `boleteame.dev` conservando ruta y query (2026-11-13; antes servía la app, pero sin poder ingresar porque Turnstile no lo admite).
- [x] **Supabase Auth, URL Configuration** (2026-11-12): Site URL `https://boleteame.dev`; Redirect URLs `https://boleteame.dev/auth/callback**`, `http://localhost:3000/auth/callback**` (agregada y verificada el 2026-11-12; sin ella, en desarrollo local los correos enlazan a la Site URL y se pierde `siguiente`). La transitoria `https://timbre-livid.vercel.app/auth/callback**` se quitó el 2026-11-13, cuando ese dominio pasó a redirigir con 308 a `boleteame.dev`.
- [x] **Supabase Auth (panel), resto** (2026-11-12): «Confirm email» activo; contraseña mínima 8; las 6 plantillas de Auth (confirmación, enlace mágico, recuperación, cambio de correo, invitación, reautenticación) en el tono Boletéame. Se generan desde `packages/correos/src/auth.ts` a `supabase/templates/*.html` (`pnpm --filter @sii/correos test -u`) y se pegan en el panel. 2026-11-12 (D8): las 6 plantillas y sus asuntos (los de `supabase/config.toml`) se reemplazaron por las de la marca «Boletéame» con la Management API (`PATCH /v1/projects/{ref}/config/auth`, solo esos campos), tras comprobar que el panel coincidía con el repo. Enlaces `token_hash`: confirmación, enlace mágico y recuperación usan `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email|magiclink|recovery` y, si Supabase no recibió un `redirectTo` aceptado ({{ .RedirectTo }} = {{ .SiteURL }}, p. ej. envíos desde el panel), `{{ .SiteURL }}/auth/callback?token_hash=…`; cada rama del `{{ if }}` lleva la URL entera porque Supabase usa `html/template` y un token tras el `{{ end }}` falla con «ambiguous context within a URL» (500 al enviar). Cambio de correo e invitación usan `{{ .SiteURL }}/auth/callback?token_hash=…&type=email_change|invite`. Auth guarda las plantillas en caché unos minutos tras cambiarlas.
- [x] **Resend** (2026-11-12): cuenta, dominio verificado (SPF, DKIM, DMARC), SMTP personalizado de Supabase Auth apuntando a Resend, y `RESEND_API_KEY` + `CORREO_REMITENTE` en `.env.local` y Vercel (*Production*). La prueba del correo real de invitación pasó al e2e de dos organizaciones.
  - [x] Dominio de envío `mail.boleteame.dev` en Resend, región São Paulo (sa-east-1), **Verified** (2026-11-12): DKIM `resend._domainkey.mail` y SPF/retorno `send.mail` + `rsend.mail` (CNAME a `*.forge.rmta.net`) en el DNS de Vercel.
  - [x] `CORREO_REMITENTE=Boletéame <no-responder@mail.boleteame.dev>` en `.env.local` y Vercel (*Production*) (antes `Timbre <…>`; cambiado el 2026-11-12, D8).
  - [x] DMARC: TXT `_dmarc` = `v=DMARC1; p=none;` en `boleteame.dev` (cubre el subdominio), resuelve en DNS público (2026-11-12). 2026-11-13: subido a `v=DMARC1; p=quarantine; adkim=r; aspf=r;` (el único remitente es Resend, con DKIM alineado en `mail.boleteame.dev`); verificado en 1.1.1.1, 8.8.8.8 y `ns1.vercel-dns.com`. Revertir = volver a `p=none`. Un remitente nuevo en `@boleteame.dev` (p. ej. un buzón propio) necesita SPF/DKIM antes de enviar, o sus correos irán a spam. Siguiente paso posible: `p=reject`.
  - [x] Dos API keys de Resend de solo envío restringidas a `mail.boleteame.dev`: `sii-supabase-auth` (SMTP de Supabase) y la de la app (`RESEND_API_KEY` en `.env.local` y Vercel *Production*, *Sensitive*).
  - [x] SMTP de Supabase Auth: `smtp.resend.com:465`, usuario `resend`, remitente `Boletéame <no-responder@mail.boleteame.dev>` (nombre cambiado desde «Timbre» el 2026-11-12, D8). *Rate Limits*: 30 correos/h y 60 s entre correos a un mismo usuario (suficiente antes del lanzamiento).
  - [x] Correos de Auth probados (2026-11-12, dev local contra producción, destinatario de prueba `delivered@resend.dev`): confirmación y recuperación **Delivered** en Resend con las plantillas de Auth; sus enlaces verifican el token y llevan a `/bienvenida` y `/restablecer`. Queda a propósito la cuenta de prueba `delivered@resend.dev` (confirmada, con perfil, sin organización): no borrarla.
- [x] **Turnstile** (2026-11-12): widget en Cloudflare (modo *Managed*); `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` (*Sensitive*) en `.env.local` y Vercel (*Production*); deploy `219d8fe` con la site key en el bundle y el widget en `/ingresar`, `/crear-cuenta` y `/recuperar` («¡Operación exitosa!»). **Después** se activó el captcha en Supabase Auth (*Attack Protection*, Turnstile, misma clave secreta). Verificado: `/auth/v1/recover` sin token → 400 `captcha_failed`; recuperación desde `/recuperar` con token (Server Action desde Vercel) → 200 `user_recovery_requested`. Si Auth empieza a fallar con `captcha_failed`, desactivar el captcha en Supabase lo revierte al instante, sin redesplegar. Hostnames del widget: `boleteame.dev` y `localhost` (para desarrollo local contra producción, con las mismas claves en `.env.local`).
- [x] **Deploy** a *Production* (commit y push a `main`) y humo de las rutas nuevas (2026-11-12, `daa781d`, READY): `/ingresar`, `/crear-cuenta`, `/recuperar`, `/restablecer` e `/invitacion/…` responden 200; `/auth/callback` sin token o con token inválido → `/ingresar?error=enlace`; `/bienvenida` sin sesión → `/ingresar`; `/_ds` 404. Sin errores de runtime. Recuperación real en producción con `delivered@resend.dev`: correo *Delivered* con el enlace normal (`/auth/callback?siguiente=/restablecer&token_hash=…&type=recovery`) que termina en `/restablecer`.
- [x] **e2e con dos organizaciones reales en *Production*** (escribe en la base; requiere autorización y borrar los datos de prueba al terminar): crear cuenta y organización, invitar (confirmar que el correo real de invitación llega por Resend desde `no-responder@mail.boleteame.dev` y que su enlace abre `/invitacion/…`), aceptar con el correo correcto y con otro, cambiar rol, quitar, salir, último propietario, cupo del plan y aislamiento entre las dos organizaciones.
  - [x] 2026-11-12, en `boleteame.dev` (Chrome real) con 3 cuentas `+e2e-*` (A1 por `/crear-cuenta`; A2 y B1 creadas con la API de administración y todas con enlace mágico de `generateLink` por `/auth/callback`, porque Outlook web no cargaba) y 2 organizaciones (`e2e-a-…`, `e2e-b-…`). En verde: crear organización; invitar (la app respondió «Invitación enviada», es decir Resend 200, y Vercel sin errores); invitación abierta con otro correo (aviso, sin botón de aceptar); aceptar con el correo correcto; token de un solo uso; emisor sin formulario de invitar; cupo al invitar (aviso temprano) y al aceptar (`P0001` del plan Certificación, 2 usuarios); cambiar rol; último propietario (degradarse o salir, bloqueado en la UI); quitar; salir (lleva a la otra organización); aislamiento en la UI («No encontramos esta organización»). En SQL, simulando `authenticated` con la excepción final que lo deshace todo: aislamiento A↔B en organizaciones, miembros, invitaciones y suscripciones; `crear_invitacion` ajena → `42501`; `aceptar_invitacion` con otro correo → `42501`; último propietario → `P0001`; miembro quitado sin acceso. Como el token real solo viajó en el correo, se reemplazó por SQL el `token_hash` de las dos invitaciones creadas por la UI por el de un token conocido. Datos de prueba borrados (quedan solo `delivered@resend.dev` y su perfil).
  - [x] Encontrado y corregido (sin desplegar): «Cerrar sesión» en `/invitacion/…` respondía 403 «Origen no permitido». Con `referrer: no-referrer`, Chrome manda `Origin: null` y `mismoOrigen()` lo rechazaba. Ahora `/auth/salir` acepta `Origin: null` solo con `Sec-Fetch-Site: same-origin`, con pruebas en `e2e/ingreso.spec.ts`. Verificado en *Production* (deploy `8f21e9e`, READY): con `curl`, `Origin: null` + `same-origin` → 303 que conserva `siguiente`; sin `Sec-Fetch-Site`, o con `cross-site` o `same-site` → 403; otro origen → 403; GET → 405. En Chrome, una cuenta temporal abrió una invitación para otro correo y pulsó «Cerrar sesión»: llevó a `/ingresar?siguiente=/invitacion/…`, la sesión quedó revocada en Auth y Vercel no registró errores. Datos temporales borrados.
  - [x] Ver en Outlook que llegaron los correos de invitación a `+e2e-a2` y `+e2e-b1` desde `no-responder@mail.boleteame.dev` y que su enlace abre `/invitacion/…`. Ahora mostrará «La invitación venció, ya se usó o no existe», porque las invitaciones se borraron; basta con que abra esa página. 2026-11-13, verificado en el panel de Resend (Outlook web caído): los dos correos («Invitación a E2E Org A en Timbre», roles Emisor y Lector) salieron el 12-11 a las 21:05 desde `Timbre <no-responder@mail.boleteame.dev>` y quedaron **Delivered** el 13-11 (09:29 `b1`, 10:34 `a2`, hora del panel) tras unas 12–13 h de *Delivery Delayed* de Outlook. El enlace del texto plano de cada uno (`https://boleteame.dev/invitacion/<token>`) abrió en el navegador la página «La invitación venció, ya se usó o no existe». Remitente y asunto aún decían «Timbre» porque se enviaron antes del renombrado; el correo de confirmación posterior ya sale como «Boletéame».
- [x] Volver a correr `supabase/verificaciones/rls-fase2-tenancy.sql` para activar las comprobaciones 48–51 de `ver_invitacion` y sumar una para `0004` (organización `morosa` que no acepta miembros). 2026-11-12: comprobación 53 agregada (A queda `morosa` con cupo libre y una invitación válida; `aceptar_invitacion` rechaza con «La organización no tiene una suscripción vigente»). Corrida en producción: 1–51 y 53 con `ok = true`, sin omitidas; el `rollback` no dejó usuarios ni organizaciones de prueba.
- [x] Reenviar la IP real a Supabase Auth (`sb-forwarded-for`, requiere clave `sb_secret`) para que los límites por IP no vean solo la IP de Vercel. Cerrado el 2026-11-13: código en *Production* (`f82b10b`), *IP Address Forwarding* activo y verificado en los logs de Auth (`/token`, `/verify` y refresco con la IP del cliente); claves legadas desactivadas.
  - [x] Código (2026-11-12, sin desplegar): `server/supabase/clave-auth.ts` + `clienteAuth()` en `servidor.ts`. Ingresar, crear cuenta, recuperar, `/auth/callback` y el refresco del proxy llaman a Auth con `SUPABASE_SECRET_KEY` y `sb-forwarded-for` = primer valor de `x-forwarded-for`. Sin la clave, o sin IP, usan la publicable. Dos cuidados: (1) con credenciales de administrador Auth **omite el captcha** (`verifyCaptcha` en supabase/auth), así que esas acciones verifican Turnstile en la app (`siteverify`) y no reenvían el token; si la app no tiene `TURNSTILE_SECRET_KEY`, las acciones con captcha siguen con la publicable; (2) sin sesión, la Data API correría como service_role, así que esos clientes son **solo** para `supabase.auth.*` (los datos siguen con `clienteServidor()`). Pruebas en `clave-auth.test.ts`.
  - [x] Solo claves API nuevas (2026-11-12, sin desplegar; las legadas se retiran en 2027): `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (una sola clave secreta para `service.ts` y el reenvío de IP). `env.ts` y el cliente del navegador exigen los prefijos `sb_publishable_` / `sb_secret_`. En `.env.local` ya eran claves nuevas: solo se renombraron.
  - [x] Supabase (panel): *IP Address Forwarding* activo en *Authentication → Rate Limits* (2026-11-12). Verificado con `curl` a `/auth/v1/token?grant_type=password` (credenciales falsas, nada se escribe): antes, con la clave secreta, los logs de Auth registraban la IP de origen; tras la recarga de configuración (00:52:17 UTC) registran `remote_addr = 203.0.113.7`, la enviada en `sb-forwarded-for`. Con la clave secreta y sin `captcha_token` → `invalid_credentials`; con la publicable → `captcha_failed`.
  - [x] Vercel (*Production*, 2026-11-12): `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` (*Sensitive*) creadas; `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` borradas. Deploy `f82b10b` READY. Los dos builds anteriores (`8920ee8`, `f82b10b`) fallaron antes de crear las variables, en el prerender de `/bienvenida` con «Configuración incompleta (Supabase público): revisa NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY»; producción siguió con la versión previa.
  - [x] Verificado en *Production* (2026-11-12): `/`, `/ingresar`, `/crear-cuenta`, `/recuperar`, `/restablecer` → 200; `/bienvenida` sin sesión → `/ingresar`; `/auth/callback` con `token_hash` inventado → `/ingresar?error=enlace`, y en los logs de Auth esa verificación (hecha desde Vercel, `gru1`) quedó con `remote_addr` = IP pública del cliente, no la de Vercel (`otp_expired`, 403). Anti-suplantación: con la clave **publicable** y `sb-forwarded-for: 198.51.100.9`, Auth registró la IP real (la cabecera se ignora sin clave secreta). Sin errores de runtime en Vercel. Revertir = *Instant Rollback* en Vercel.
  - [x] Verificar en el navegador: ingreso con contraseña en `boleteame.dev` (Turnstile por `siteverify` + clave secreta) y que el log de Auth (`/token`, `grant_type=password`) tenga la IP del cliente. 2026-11-13 (Chrome real, `/ingresar`, correo inexistente y contraseña falsa, nada se escribe): el widget dio «¡Operación exitosa!» y la app mostró «El correo o la contraseña no coinciden». En los logs de Auth (01:01:34 UTC): `/token`, `grant_type=password`, `invalid_credentials` (400) y `remote_addr` = IP pública del cliente (la misma de la verificación de `/auth/callback` de arriba), no la de Vercel. Como la app no reenvía el `captcha_token`, que Auth respondiera `invalid_credentials` y no `captcha_failed` prueba que la llamada fue con la clave secreta, tras pasar `siteverify` en la app. Ingreso **exitoso** (01:06:01 UTC): cuenta temporal `e2e-ingreso-…@example.com` creada con la API de administración (confirmada, perfil por `tg_nuevo_usuario`); en Chrome, Turnstile y la contraseña llevaron a `/bienvenida` («Ingresaste como…»); en los logs de Auth, `/token` `grant_type=password` → 200 (`login`, `login_method=password`) con `remote_addr` = IP del cliente. Cuenta borrada después (sin usuario, perfil ni sesiones; queda solo `delivered@resend.dev`).
  - [x] Ensayo del retiro: desactivar las claves legadas en *Settings → API Keys* (reversible) y repetir el humo. 2026-11-13: antes, sin dependencias (sin jobs de `pg_cron`, sin Edge Functions, sin JWT en Vault ni en funciones; en 24 h de logs del gateway ninguna petición con clave `eyJ…`, solo `sb_publishable_`, `sb_secret_` y `sb_temp_` del panel). Desactivadas a las 01:12:30 UTC (*Disable JWT-based API keys*); **quedan desactivadas**. Con `anon` → 401 «Legacy API keys are disabled» en `/auth/v1` y `/rest/v1`; con la publicable → 200. Humo en *Production*: `/`, `/ingresar`, `/crear-cuenta`, `/recuperar`, `/restablecer` → 200; `/bienvenida` sin sesión → `/ingresar`; `/auth/callback` con `token_hash` inventado → `/ingresar?error=enlace` (Auth: `/verify` con `sb_secret_`, `otp_expired` 403, `remote_addr` = IP del cliente); en Chrome, ingreso con correo inexistente → «El correo o la contraseña no coinciden» (Turnstile OK; Auth: `/token` `grant_type=password` con `sb_secret_`, `invalid_credentials` 400, IP del cliente). Desde la desactivación, todo el tráfico usa claves nuevas y Vercel no registra errores de runtime. Revertir = *Re-enable JWT-based API keys* en la misma página (instantáneo).
  - [x] Observado durante el ensayo (no lo causó el cambio): la cookie de la cuenta temporal `e2e-ingreso-…`, borrada minutos antes, todavía abría `/bienvenida` con «Ingresaste como…», porque `getClaims()` verifica el JWT localmente (JWKS) hasta su `exp`. «Cerrar sesión» → Auth `403 user_not_found`, pero `/auth/salir` borró las cookies igual. Sin riesgo de datos (la cascada borró `perfiles` y `miembros_organizacion`), pero un usuario **baneado** conservaría sus membresías hasta una hora. Documentado en `ambientes-y-credenciales.md` («Sesiones de usuario y revocación»), `tenancy-y-roles.md` y `trampas-conocidas.md`. Las reglas pasaron a la Fase 4 (`operacion.ts` con `getUser()` en las operaciones ⚠️) y a la Fase 13 (revisión de seguridad).

### Fase 3 — Empresas, certificados y resoluciones

1. CRUD de empresas (RUT con `CampoRut`, razón social ≤ 100, giro ≤ 80 sin abreviaciones, dirección ≤ 70, comuna ≤ 20, correo de intercambio con la regla `correo_sii`). `tg_limite_empresas` aplica el plan.
2. **Carga de certificado (.pfx)** por Server Action: `Certificado.desdeContenido(bytes, clave)` valida en el servidor; se extraen titular, CN, emisor, vigencia, huella SHA-256 y `pfx_legacy`; `.pfx` (base64) y clave van a Vault; la fila guarda solo los ids. Nunca se escribe el archivo en disco ni en Storage.
3. Asociación certificado ↔ empresa (`empresa_certificados`), con «representante electrónico» y «predeterminado».
4. Resoluciones: certificación (número 0, fecha del SII) y producción (número y fecha de la autorización).
5. Estado de certificados (`v_certificados_estado`) con `Alerta` `aviso` cuando faltan 30 días, como en el Tablero.

**Criterio:** subir un `.pfx` real deja la fila en `certificados`, los dos secretos en Vault y ningún rastro del archivo o la clave en logs ni en Sentry.

**Pendientes** (el código está listo y probado sin red ni base):

- [x] Aplicar `0005_certificados_resoluciones` en producción y correr `supabase/verificaciones/0005_certificados_resoluciones.sql`. 2026-11-13: `supabase db push --remote` (el ensayo con `--dry-run` mostró solo la `0005`); verificación 15/15 con `ok = true`.
- [x] Correr `supabase/verificaciones/rls-fase3-empresas.sql` y su consulta de control. 2026-11-13: 43/43 con `ok = true`; el `rollback` no dejó usuarios, organizaciones, certificados ni secretos de prueba (todo en 0).
- [x] `pnpm db:tipos` (2026-11-13): el resultado coincide con las 3 funciones agregadas a mano a `tipos.ts`; typecheck en verde.
- [x] Deploy a *Production* y humo de `/[org]/configuracion/empresas`, `/nueva`, `/[id]`, `/[id]/certificados` y `/[org]/configuracion/certificados`. 2026-11-13: deploy `b4d799c` READY; sin sesión, las 5 rutas nuevas (y `/configuracion`, `/tablero`) → 307 a `/ingresar?siguiente=…` conservando la ruta; `/`, `/ingresar` → 200; `/bienvenida` → `/ingresar`; `/_ds` → 404. Sin errores de runtime en Vercel.
- [x] Criterio de aceptación con un `.pfx` real. 2026-11-13, en `boleteame.dev` con la cuenta real del propietario (confirmada con un enlace `magiclink` de `generateLink`, porque Outlook estaba caído), organización con plan Certificación y 1 empresa: un `.pfx` real de IDOK FIRMA ELECTRONICA V4 dejó la fila en `certificados` (titular, CN, emisor, vigencia hasta 2028-05-26, huella, `pfx_legacy = true`, `subido_por` correcto, estado `vigente`), sus 2 secretos en Vault (`certificado:<huella>:pfx|clave`, sin secretos huérfanos) y la asociación a la empresa como representante electrónico y predeterminado. Vercel no registró ninguna línea de log (ni errores ni avisos). El formulario no pidió el RUT: salió del certificado real (otherName del SAN), y Sentry quedó sin issues ni rastros de la clave o del nombre del archivo (revisado por el usuario en el panel; el token de `.env.local` no tiene permiso de lectura, 403). Pasos originales: subirlo como administrador; con SQL de solo lectura, la fila en `certificados` y dos filas `certificado:<huella>:pfx|clave` en `vault.secrets` (sin leer `decrypted_secret`); confirmar que el RUT del titular se extrajo del certificado (solo se probó con certificados sintéticos); buscar en logs de Vercel y en Sentry un fragmento de la clave y el nombre del archivo, sin resultados.

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`): 3DES no cuenta como `pfx_legacy` (paridad con la librería: OpenSSL 3 lo lee sin el proveedor legacy); textos de la empresa limitados a ISO-8859-1; no hay «borrar empresa» (arrastraría documentos), sino desactivar; `empresas.activa` deberán exigirla las Fases 6 y 7; la Fase 4 debe excluir certificados con `revocado_en`; Sentry filtra todos los campos de formularios de Server Actions; el onboarding de `/bienvenida` solo crea la organización (empresa y certificado se cargan desde Configuración).

### Fase 4 — Capa de servicio SII (backend)

El corazón técnico. Todo en `apps/web/src/server/sii/`, `server-only`, runtime Node.js.

| Pieza | Responsabilidad |
|---|---|
| `credenciales.ts` | Lee `.pfx` + clave desde Vault y devuelve `Certificado` / `FirmaElectronica` en memoria, con caché por invocación |
| `token-store-supabase.ts` | Implementa el `TokenStore` de la librería sobre `token_obtener` / `token_guardar` / `token_borrar`, cifrando con `SII_TOKENS_KEY` |
| `sesiones.ts` | Guarda y recupera cookies de `SesionSii` (`aArreglo` / `desdeArreglo`) cifradas en `sesiones_sii`; reutiliza antes de volver a autenticar |
| `bloqueos.ts` | `conBloqueoCertificado()` sobre `tomar_bloqueo_certificado` / `liberar_bloqueo_certificado` (arriendo, migración `0007`) para que dos peticiones no abran sesiones AUT2000 en paralelo con el mismo certificado |
| `transporte.ts` | Un `TransporteUndici` por invocación, cerrado con `await using` |
| `operacion.ts` | `ejecutarOperacion({ operacion, ambiente, confirmada, ... }, fn)`: si la operación es ⚠️, primero confirma la sesión con `supabase.auth.getUser()` (le pregunta a Auth; `getClaims()` no detecta una sesión revocada ni un usuario borrado hasta el `exp`, ver `ambientes-y-credenciales.md` → «Sesiones de usuario y revocación»); inserta `operaciones_sii` en `en_curso`, ejecuta, traduce el error tipado de la librería (`SiiError` y derivados) a `resultado_operacion` (ok/error/uso/config/transporte/rechazo_sii/incierto/verificacion_fallida), registra en Sentry con etiquetas y cierra la fila |
| `almacen.ts` | Sube XML (ISO-8859-1, `Buffer` tal cual) y PDF a Storage; URLs firmadas |
| `errores.ts` | Mensajes para el usuario según el design system: qué pasó y qué hacer; el detalle técnico queda en `operaciones_sii.detalle` |

Migraciones `realtime_operaciones` y `bloqueos_sii` (§6). Pruebas con `TransporteFalso` de la librería (sin red) para
cada traducción de error, y una prueba de integración opcional contra certificación.

**Criterio:** `ejecutarOperacion` cubre los 8 resultados con pruebas; ningún token o cookie aparece en `operaciones_sii`, logs ni Sentry (prueba que busca patrones).

**Pendientes** (el código está listo y probado sin red ni base):

- [x] Código y pruebas (2026-11-13): los 7 módulos de la tabla con sus `*.test.ts`; `operacion.test.ts` cubre los 8 resultados y la búsqueda de patrones (token, cookie, PEM, JWT y clave en `message`, `cause` y detalle; nada llega a `operaciones_sii`, al registro de Sentry ni a `console.*`). Typecheck, Vitest (445), Biome, stylelint y build en verde.
- [x] Aplicar `0006_realtime_operaciones` y `0007_bloqueos_sii` en producción. 2026-11-13: `supabase db push --remote` (el `--dry-run` mostró solo esas dos; duplicados para el índice = 0); verificaciones 9/9 y 14/14 con `ok = true`; `rls-fase4-bloqueos.sql` 21/21 y el `rollback` no dejó organizaciones, certificados, empresas, bloqueos ni operaciones de prueba (todo en 0). Antes de migrar habían dado lo esperado (0006: 7/9; 0007: todo `false`).
- [x] `pnpm db:tipos` (2026-11-13): el resultado es idéntico a lo agregado a mano a `tipos.ts` (`bloqueos_sii` y las 2 RPC); sin diferencias.
- [x] `documentación/` de la fase (2026-11-13): `errores-y-resultados`, `autenticacion-sii`, `backend-service-role`, `realtime-y-storage` completos; secciones nuevas en `rpc-backend`, `objetos-*`, `trampas-conocidas`, `despliegue`, `vault-y-secretos`, `probar-el-esquema`, `acceso-por-tabla`, `servicios-sii`, `mapeo-libreria-tablas` y `README`. Al aplicar 0006/0007, `despliegue.md` lista los archivos donde cambiar «pendiente».
- [x] Carrera en `ejecutarOperacion` (la detectó la documentación): consultaba la última fila y después insertaba la suya, así que dos `solicitar_folios` simultáneas podían pasar las dos el control (riesgo de doble timbraje). Cerrada el 2026-11-13: índice único parcial `operaciones_sii_efecto_global_en_curso` en la `0007` (`en_curso` + `confirmada` + `solicitar_folios`/`postular`/`declarar`, sincronizado con `OPERACIONES_EFECTO_GLOBAL`); un 23505 al insertar no ejecuta; control repetido después del insert; operación de efecto global sin empresa → `uso` sin insertar. Verificaciones: `0007` 14 comprobaciones y `rls-fase4-bloqueos.sql` 21 (en PGlite 14/14 y 21/21; sin el índice fallan justo las nuevas). Vitest 452. Antes de aplicar: `db push --remote --dry-run` muestra solo `0006` y `0007`; consulta de duplicados en producción = 0 (`operaciones_sii` vacía).
- [x] Deploy a *Production* (2026-11-13): `2fbc739` READY; `/`, `/ingresar`, `/crear-cuenta`, `/recuperar`, `/restablecer` → 200; `/bienvenida` → `/ingresar`; `/[org]/tablero` y `/[org]/configuracion/certificados` sin sesión → 307 a `/ingresar?siguiente=…`; `/auth/callback` con token inventado → `/ingresar?error=enlace`; `/_ds` → 404. Sin errores de runtime en Vercel (6 h).
- [x] Prueba de integración manual contra certificación (2026-11-13): `src/server/sii/integracion-certificacion.test.ts` (se omite sin `SII_INTEGRACION=1`), con el certificado real de IDOK de la empresa de la organización del propietario. En verde en 7,6 s: `ejecutarOperacion('obtener_token')` por REST en apicert dejó la fila `ok` en `operaciones_sii` (1,54 s; sin usuario, `canal = rest`, sin el token en la fila ni en lo que recibió Sentry) y el token cifrado en `tokens_sii` (vigencia 50 min); la segunda operación salió del caché (0,74 s, `tokens_sii` sin cambios); el bloqueo con arriendo rechazó a un segundo titular por PostgREST y quedó libre (`bloqueos_sii` en 0). Observado: `sanearDetalle` filtra `largo_token` por contener «token» (a propósito; documentado).

Decisiones tomadas en la fase (detalle en `documentación/`):

- Toda operación que no es `ok` lanza; un rechazo detectado por la app se lanza como `ErrorRespuestaSii`. `ErrorIncierto` (app) cubre los dos casos en que la CLI devuelve 6 sin error de la librería (CAF timbrado sin guardar; envío de `emitir` sin Track ID).
- Bloqueo de reintento por empresa + operación + ambiente para `solicitar_folios`, `postular` y `declarar`: un `incierto` sin revisar o una `en_curso` reciente impiden repetir; una `en_curso` de más de 15 min se trata como incierta. `marcarInciertaRevisada` (deja `detalle.revisada_en`) **no verifica el rol**: lo hace quien la llama. `emitir` se bloquea por documento en la Fase 7 (`envios.incierto`).
- Sin fila en `operaciones_sii` no se llama al SII (`motivo: 'sin_registro'`).
- `FolioInicialRequeridoError` queda en `rechazo_sii` por paridad con `codigoDeError` (el comando `solicitar-folios` de la CLI lo devuelve como 3); la Fase 6 puede envolverlo en `ErrorConfig`.
- `BloqueoOcupadoError` → `transporte` (nada salió al SII; se puede reintentar). El bloqueo no es reentrante.
- Credenciales: por empresa se usa el certificado predeterminado (si está revocado, error: no se cambia de firmante sin avisar); con `representante: true`, el predeterminado si es representante vigente o el representante vigente que vence más tarde. Caché por invocación, nunca global.
- `AlmacenDocumentos` recibe la organización en el constructor y rechaza rutas de otra; `content-type` exacto `application/xml` / `application/pdf` (sin `charset`; el XML lo declara).

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

**Pendientes** (el código está listo y probado sin red ni base):

- [x] Código y pruebas (2026-11-13): contrato compartido `src/lib/certificacion.ts` (etapas, pasos, `ResultadoPaso`); `server/certificacion/` (lectura, datos, postulación, set, folios, envío y estado del set, revisión, declaración, marcar revisada, correo de etapa) con Supabase falso y dobles de la librería; UI en `app/[org]/certificacion/` (selector de empresa por `?empresa=`, `Dialogo` de ensayo, «Marcar como revisada», Realtime con `router.refresh()`, `maxDuration = 300`); plantilla de correo en `packages/correos`; `e2e/certificacion.spec.ts` (sin sesión → `/ingresar?siguiente=…`). Typecheck, Vitest (555), Biome, stylelint y `pnpm build` en verde.
- [x] Revisión de la documentación (2026-11-13): encontró y se corrigieron (con pruebas) cuatro defectos: dos `enviarSet` simultáneos salían los dos (ahora dentro de `conBloqueoCertificado`, con el control repetido adentro); una `en_curso` abandonada bloqueaba la UI sin salida (ahora a los 15 min cuenta como incierta y ofrece «Marcar como revisada»); un set aceptado con reparos no ofrecía reenviar; un envío incierto no quedaba en `envio_set_id` y el aviso del paso 3 no aparecía.
- [x] Aplicar `0008_certificacion` en producción. 2026-11-13: `supabase db push --remote` a las 19:59 UTC (el `--dry-run` mostró solo la 0008); verificación 10/10 con `ok = true`; `rls-fase5-certificacion.sql` 16/16 y la consulta de limpieza en 0 (organizaciones, empresas, secretos); `pnpm db:tipos` idéntico a lo agregado a mano; Advisors de seguridad sin avisos nuevos (las dos RPC no las ejecutan `anon` ni `authenticated`). Documentación actualizada de «pendiente de aplicar» a aplicada.
- [x] Deploy a *Production* (2026-11-13): `d2a7a3b` READY; `/servicio/certificacion` sin sesión → 307 a `/ingresar?siguiente=%2Fservicio%2Fcertificacion`; `/ingresar` → 200; sin errores de runtime en Vercel (2 h).
- [x] Estado de la declaración de la única empresa de producción (RUT 20630500-2, la del piloto de la librería), solo lectura con el certificado real desde Vault (2026-11-13): el SII responde **sin trámite** (`codigo null`), que es lo que responde a una empresa ya autorizada (certificada el 2026-11-06 con la librería; `packages/certificacion/docs/validaciones.md`). No sirve para recorrer el flujo: postular la devolvería a certificación.
- [x] **Empresas autorizadas fuera de Boletéame** (decisión del usuario 2026-11-13, «caso (a)»): el SII no distingue «autorizada» de «nunca postuló» (ambas sin trámite), así que registrar una resolución de producción vigente marca la empresa como autorizada (trigger, migración `0009_autorizacion_externa`); el asistente lo muestra como «Autorizada fuera de Boletéame» y bloquea postular, descargar set, folios, envío, revisión y declaración; «Consultar estado en el SII» disponible desde el paso 1 (crea el proceso solo después de que el SII responde). Código listo sin desplegar (2026-11-13): trigger `trg_50_resolucion_autoriza_produccion` (nunca desmarca; idempotente; con ajuste de datos para resoluciones ya cargadas), candado `cargarEmpresaPorCertificar` en las 6 acciones (ensayo y confirmada, sin fila en `operaciones_sii`), `VistaAsistente.autorizacionExterna` y `resolucionProduccion`, aviso en Configuración → resoluciones. En PGlite: verificación 0009 9/9, simulación `rls-fase5-autorizacion-externa.sql` 12/12, y las de las Fases 3 y 5 siguen 43/43 y 16/16. Typecheck, Vitest (586), Biome, stylelint y build en verde. 0009 aplicada en producción el 2026-11-13 (21:05 UTC): verificación 9/9, simulación 12/12 con limpieza en 0, tipos sin diferencias, Advisors sin avisos nuevos. Deploy `581d124` READY. Resolución de producción de la empresa del piloto (20630500-2) registrada con `registrar_resolucion` como service_role: n.º 80 del 22-08-2014; el trigger la marcó `autorizada_produccion` y `autorizada_en` se fijó en la fecha real de autorización (06-11-2026); sin proceso de certificación creado. En *Production* (Chrome, sesión del propietario) `/servicio/certificacion` muestra «Autorizada fuera de Boletéame» con la resolución, sin pasos ni acciones; sin errores de consola ni de runtime en Vercel. Detalle menor visto y corregido (deploy `0d27c20`, verificado en *Production*: la sección ya no aparece para la empresa del piloto y Vercel sin errores de runtime): la columna lateral mostraba «Aún no hay folios de certificación. Se piden en el paso 3» y «La resolución de certificación se registra al postular» a una empresa autorizada; ahora, si la empresa está autorizada (P91 o fuera de Boletéame), esas indicaciones no aparecen y la sección «Folios de certificación» solo se muestra si tiene CAF o resolución de certificación.
- [ ] Criterio de aceptación contra el SII de certificación — **pendiente por decisión del usuario (2026-11-13)**: hace falta otra empresa de prueba (certificado cuyo titular sea su representante legal), porque la única de producción ya está autorizada. Recorrido: postular → descargar set → solicitar folios → enviar set (EPR limpio) → solicitar revisión → P90 → declarar → P91, comparando las filas con las que deja la CLI y que ninguna fila, log ni Sentry tenga secretos.

#### Verificar autorización en el SII (prevista, sin código)

Decisión del usuario (2026-11-13): reemplazar, cuando se pueda, el registro manual de la
resolución de producción (migración 0009) por una consulta al SII. El asistente
«Actualización de datos del contribuyente» del portal de producción
(`https://palena.sii.cl/cvc_cgi/dte/ad_empresa1` → `ad_empresa2`, con sesión AUT2000) dice
si la empresa está autorizada para emitir con software de mercado y con qué resolución.

**Validación** (2026-11-13, producción, solo lectura): script con
`SolicitudFolios.autenticar` de la librería y el certificado del piloto; 3 logins; nunca se
envió el formulario de actualización.

| RUT consultado | Respuesta de `ad_empresa2` |
|---|---|
| Empresa autorizada que el titular representa (20630500-2) | «Antecedentes del Contribuyente registrados»: RUT, razón social, fecha de autorización (06-11-2026), fecha de resolución (22-08-2014), resolución (80), nombre del software, tres correos de contacto y URL. Trae un formulario con los botones `MOD_EMP` / `MOD_USU`, que actualizan los datos: **no se envía nunca** |
| Empresa que el titular no representa, autorizada (90749000-9) o no (11111111-1, 12345678-5) | «Usted no está registrado en la empresa Rut … como Representante Legal, por lo que no podrá Actualizar los datos del Contribuyente.» |
| RUT del titular con el DV malo (20630500-3) | «No ha sido posible completar su solicitud. Esto debido a que el Contribuyente no está autorizado para operar en esta modalidad.» |

Qué se concluye:

- **El SII revisa primero la representación legal y después la autorización.** Sin
  representación la respuesta es la misma, esté o no autorizada la empresa: no sirve para
  consultar cualquier RUT. El reporte original decía que un no representante de una empresa
  no certificada recibe «no autorizado»; no se reprodujo.
- **Con representación legal resuelve lo que «sin trámite» no distingue** (autorizada o
  nunca postuló) y trae `NroResol` / `FchResol` sin que el usuario los escriba. Es la misma
  página de la que se sacó a mano el 80 / 2014-08-22 del piloto
  (`packages/certificacion/docs/validaciones.md`).
- **Exige representante legal en el SII.** No basta el representante electrónico
  (`empresa_certificados.representante`) ni un usuario autorizado: en ese caso se vuelve al
  registro manual de la 0009.
- **Sin validar: boleta frente a factura.** La página habla de «esta modalidad» (software de
  mercado), no de boleta. La fecha de autorización del piloto coincide con su certificación
  de boleta (2026-11-06), pero falta una empresa certificada solo para factura con que
  comparar. Si una así aparece como autorizada, la marca sería falsa para boletas. La
  mitigación es la misma que la de la 0009: el SII rechaza igual los envíos de producción.
- **La página trae datos personales** (correos, URL, nombre del software): no se guardan
  ni se registran, y el HTML nunca va a logs ni a Sentry.

**Fuente de apoyo: situación tributaria de terceros (STC).** La consulta pública
<https://www2.sii.cl/stc/noauthz> es una SPA. Por detrás llama a
`POST https://www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/` con
`{ rut, dv, reAction: "consultaSTC", reToken }`, sin login ni certificado. Usa reCAPTCHA
Enterprise v3, pero `GET /app/stc/recurso/v1/recaptcha/key` respondía `enable: false` y la
consulta funcionaba con `reToken: " "`. La tabla «Documentos autorizados» sale del campo
`timbrajes` (`codigo`, `descripcion`, `fechaTimbraje` = año del último timbraje,
`folioFinal` = último folio timbrado): es el **historial de timbraje**, no las
autorizaciones. Validado el 2026-11-13 con 2 consultas:

| RUT | `timbrajes` |
|---|---|
| 20630500-2 (piloto, certificado solo en boleta) | solo `0039 Boleta Electronica`, año 2026, folio final 5, que es el CAF de producción 1–5 |
| 90749000-9 | 25 tipos: papel (30, 35, 50…), electrónicos 33, 34, 46, 52, 56, 61, 110–112, libros |

- **Un tipo aparece solo cuando ya se le timbraron folios.** La boleta exenta (41) del piloto
  no aparece porque nunca se le pidieron folios. Tampoco aparece la factura: la
  certificación de boleta solo autoriza 39/41, y la factura tiene la suya (H3, Fase 14).
- **`0039` o `0041` en `timbrajes` prueba que la empresa está autorizada para boletas**,
  porque el SII no timbra folios de producción de esos tipos sin autorización. Sirve para
  **cualquier RUT**, sin representación legal.
- **Que falten no prueba nada**: una empresa recién certificada no tiene timbrajes (el
  piloto no los tuvo entre el 06-11 y el 10-11).
- **No resuelve la duda de boleta frente a factura en `ad_empresa`**: para una empresa
  solo-factura no hay representación con la que consultar `ad_empresa`.
- **Es frágil**: el SII puede encender el captcha cuando quiera. Por eso solo apoya y nunca
  es requisito. Tampoco se intenta resolver el captcha.
- La respuesta trae mucho más (nombre, giros, observaciones, actividades): solo se usa
  `timbrajes`.

**Diseño:**

1. **Librería** (principio 4: la app no reimplementa nada). Clase `ConsultaAutorizacion` en
   `packages/certificacion/packages/core`, junto a `SolicitudFolios` (usa la misma sesión
   AUT2000). Solo producción (`palena.sii.cl`). `consultar(sesion, rut)` devuelve
   `{ tipo: 'autorizada', rut, razonSocial, fechaAutorizacion, resolucion: { numero, fecha } }`,
   `{ tipo: 'sin_representacion' }` o `{ tipo: 'no_autorizada' }`. Candados:
   - solo `GET ad_empresa1` y `POST ad_empresa2`, con `RUT_EMP`, `DV_EMP` y `ACEPTAR`, por
     https al host del ambiente;
   - nunca envía un formulario de `ad_empresa2`, porque ese actualiza los datos;
   - el RUT de la respuesta tiene que ser el pedido;
   - una página que no reconoce lanza un error de verificación (código 7), sin copiar el
     HTML.

   Pruebas con páginas grabadas (sin los correos) en `paridad/`. CLI
   `sii produccion autorizacion [rut]` (🔁, sin `--confirmar`) y herramienta MCP
   `produccion_autorizacion`.

   Para el STC, la clase `SituacionTributaria` (sin sesión ni certificado, solo
   `www2.sii.cl` por https). `timbrajes(rut)` devuelve `{ tipo: 'ok', timbrajes: [{ tipoDte,
   ultimoAnio, folioFinal }] }`, con los números ya limpios (`"0039"` → 39, el folio sin los
   espacios de relleno), o `{ tipo: 'captcha' }` si `recaptcha/key` dice `enable: true`;
   en ese caso no consulta. Descarta el resto de la respuesta y lanza un error de
   verificación (7) si cambia la forma. CLI `sii util situacion-tributaria <rut>` y
   herramienta MCP `util_situacion_tributaria`.
2. **Migración `0010_verificar_autorizacion`**: el valor `verificar_autorizacion` en
   `operacion_sii` (§6). No entra en `OPERACIONES_QUE_GRABAN` ni en
   `OPERACIONES_EFECTO_GLOBAL`.
3. **App**: `verificarAutorizacion(ctx)` en `server/certificacion/autorizacion.ts` (Server
   Action `verificarAutorizacion`, propietario o administrador). Es 🔁 y no tiene ensayo,
   igual que `consultarEstadoDeclaracion`. La fila de `operaciones_sii` va con
   `ambiente = 'produccion'` (el resto del asistente usa `certificacion`). Usa el
   certificado predeterminado y la sesión de producción con `conBloqueoCertificado` +
   `conSesionReutilizada` (el SII frena el re-login). Según la respuesta:
   - `autorizada`: registra la resolución de producción con el número y la fecha del SII.
     Si ya hay una vigente igual, no hace nada; si es distinta, la del SII queda vigente y
     la anterior pasa al historial. El trigger de la 0009 marca `autorizada_produccion`. Si
     la empresa no estaba autorizada, fija `autorizada_en` en la fecha de autorización del
     SII (service_role). Mensaje: «El SII confirma que la empresa está autorizada desde el
     06-11-2026 (Resolución n.º 80 del 22-08-2014)».
   - `sin_representacion`: no cambia nada. «El titular del certificado no figura como
     representante legal de la empresa en el SII, así que no pudimos verificar la
     autorización. Si la empresa ya está certificada, registra su resolución de
     producción.»
   - `no_autorizada`: no cambia nada (la marca nunca se quita). «El SII indica que la
     empresa no está autorizada para emitir con software propio: certifícala con el
     asistente.» Si ya estaba marcada por una resolución registrada a mano, muestra un
     aviso para revisarla.
   - **STC, en la misma operación** (una fila, sin otro valor del enum): después de
     `ad_empresa`, y con cualquier respuesta, se consultan los timbrajes. Su resultado
     nunca bloquea ni cambia lo de arriba, solo el mensaje:
     - `autorizada` y timbrajes 39/41: «… y ya timbró folios de boleta electrónica».
     - `autorizada` sin timbrajes 39/41: la marca se pone igual, con un aviso: «El SII
       todavía no registra folios de boleta timbrados. Si la empresa se certificó solo para
       factura, no podrá emitir boletas.»
     - `sin_representacion` y timbrajes 39/41: no se marca (el STC no trae la resolución).
       «El SII registra folios de boleta electrónica timbrados (el último en <año>): la
       empresa ya emite boletas. Registra su resolución de producción.»
     - STC con captcha, error o sin timbrajes: no cambia nada.
   - `detalle`: `respuesta` (uno de los tres tipos) y, si está autorizada, `nro_resol`,
     `fch_resol` y `fecha_autorizacion`; además `stc` (`boleta`, `sin_boleta` o
     `no_disponible`) y, con `boleta`, `stc_ultimo_anio`. Nunca correos, URL ni nombre del
     software, ni nada más del STC.
4. **UI**: en el paso 1, «Verificar autorización en el SII» es la primera opción para una
   empresa que ya está certificada, antes de registrar la resolución a mano. También se
   ofrece después de un «sin trámite» y en *Configuración → Empresas → Resoluciones*
   («Traer del SII»). No tiene el candado `empresa_autorizada`: es de lectura y sirve para
   actualizar la resolución.
5. **Otros usos del STC, solo si hacen falta** (no comprometidos; cada uno se decide con el
   usuario). Como no exige certificado, puede ir donde `ad_empresa` no llega:
   - **Alta de la empresa** (Fase 3, antes de subir el certificado): una pista en el
     formulario si la empresa ya timbró boletas electrónicas («parece que ya emite boletas
     electrónicas: no hace falta certificarla»), sin marcar nada.
   - **Folios** (Fase 6): comparar `folioFinal` de 39/41 con los CAF registrados, para
     avisar que hay folios timbrados fuera de Boletéame (otro software) antes del primer
     timbraje.
   - **Facturas** (Fase 14): la misma evidencia para 33, 34, 56 y 61.

   Si se activa alguno, se usa la misma clase de la librería, se registra en
   `operaciones_sii` como parte de la operación que lo origina y se respetan las mismas
   reglas: nunca es requisito y con captcha se omite.

**Pendientes:**

- [ ] Validar con una empresa certificada solo para factura si la respuesta distingue
  boleta de factura. Si no la distingue, decidir con el usuario si la marca automática se
  queda o si la consulta solo propone la resolución.
- [ ] Librería: `ConsultaAutorizacion` y `SituacionTributaria`, CLI, MCP y pruebas con
  páginas y respuestas grabadas (también `enable: true` en `recaptcha/key` y una forma de
  respuesta desconocida).
- [ ] Migración `0010_verificar_autorizacion` aplicada y verificada; tipos regenerados.
- [ ] App y UI con pruebas (Supabase falso y doble de la librería): los tres tipos de
  respuesta de `ad_empresa` combinados con `boleta` / `sin_boleta` / `no_disponible` del
  STC, página desconocida, RUT distinto, sin certificado, y ninguna fila con secretos ni
  correos.
- [ ] Prueba real en *Production* con la empresa del piloto. Como ya está marcada, todo
  tiene que quedar igual (misma resolución), con una fila `verificar_autorizacion` en `ok`
  y `stc = 'boleta'`.
- [ ] Documentación: pasar de «prevista» a hecha
  (`documentación/02-guias/certificacion-empresa.md`, `07-referencia/trampas-conocidas.md`,
  `03-api-reference/servicios-sii.md`, `indice-operaciones.md` y
  `04-objetos/objetos-auditoria-e-integraciones.md`).

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`, «Fase 5»): el ensayo nunca sale al SII ni deja filas (la simulación de folios contra el SII queda para la Fase 6); el paso 3 son dos operaciones confirmables (solicitar folios y enviar el set) para no pasar `maxDuration`; el set va por REST (D7); `enviar_set` tiene su propio bloqueo por incierto (`bloqueoEnvioSet`) porque no es de efecto global; `postular` registra la resolución de certificación (número 0, fecha de la postulación en Chile) si falta; P91 no descarga set; un set ilegible no avanza la etapa; un rechazo sin Track ID anula los folios y un Track ID que no se pudo guardar es incierto; `declarar` exige `por_declarar` (consultar antes el estado).

### Fase 6 — Folios (CAF)

1. Vista `/[org]/folios`: un `MedidorFolios` por tipo y ambiente (`v_folios_disponibles`), historial de CAF y de `solicitudes_folios`.
2. **Solicitar folios** con `SolicitudFolios` (asistente `of_*`): ensayo (`simulada`) y confirmación (`timbrada`). `folio_inicial` solo si el SII lo pide (primer timbraje). Requiere certificado de representante electrónico.
3. **Estado `incierta`:** bloquear el reintento y guiar para bajar el CAF desde «Folios ya autorizados» del SII.
4. *(Opcional, si hace falta; Fase 5, «Otros usos del STC»)*: avisar si el STC muestra folios de 39/41 timbrados más allá de los CAF registrados (folios de otro software).
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

1. Revisión de seguridad: RLS (simulación de roles por tabla según `acceso-por-tabla`, en transacciones con `rollback`), que ninguna ruta use `service_role` sin filtrar por organización, cabeceras (CSP con Turnstile y Sentry, HSTS), `server-only` en todo `server/`. Además, que toda operación ⚠️ (y la creación de API keys y webhooks) confirme la sesión con `getUser()` antes de ejecutar.
   - Retiro definitivo de las claves legadas: con las legadas desactivadas desde el 2026-11-13 y sin incidentes, revocar la clave HS256 *Previously used* en *Settings → JWT Keys* (antes, confirmar en `edge_logs` que nadie usa claves sin prefijo `sb_`).
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
- Certificación de factura: set, simulación, intercambio y muestras de impresión (los 6 pasos de la plantilla). Es aparte de la de boleta: certificarse en boleta no habilita factura (el STC del piloto solo muestra `0039`). Para empresas ya autorizadas fuera de Boletéame, los timbrajes 33/34/56/61 del STC sirven de evidencia (Fase 5, «Otros usos del STC»).
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
| D6 | Dominio | Sitio público y app en el mismo dominio (`/` y `/[org]`) para compartir sesión y simplificar; subdominio si se separa el marketing. **Dominio asignado el 2026-11-12: `boleteame.dev`** |
| D7 | Canal de envío por defecto | REST para emisión (pangal/rahue); SOAP DTEUpload como respaldo configurable por empresa |
| D8 | Nombre del producto | **Decidido el 2026-11-12:** el nombre comercial es «Boletéame» (antes «Timbre»), en línea con el dominio `boleteame.dev`. Todo texto visible (UI, títulos, correos, plantillas de Auth, design system) dice «Boletéame»; en identificadores donde la tilde no cabe (namespace JS, carpetas) se escribe `boleteame`. Por detrás, los servicios y paquetes se llaman `sii` / `SII` (paquete raíz `sii`, `@sii/correos`, `project_id` de Supabase `sii`). «timbre» en minúscula sigue siendo el término del SII (timbre electrónico, TED) y no se renombra. **Fuera del repo, hecho el 2026-11-12:** `CORREO_REMITENTE` en Vercel, remitente SMTP y las 6 plantillas de Supabase Auth, el artifact del design system (título, textos, portada y `window.Boleteame`) y el de plantillas (textos de las 6 pantallas, título del lienzo y design system reinstalado en `ds/boleteame/`). El proyecto de Vercel se renombró de `timbre` a `sii` (2026-11-12; Vercel no admite mayúsculas). También el proyecto de Sentry, de `timbre-web` a `sii-web` (mismo ID y DSN; `SENTRY_PROJECT=sii-web` en Vercel *Production* y `.env.local`). Solo queda con el nombre anterior, a propósito, el dominio `timbre-livid.vercel.app`, que desde el 2026-11-13 redirige con 308 a `boleteame.dev` |

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El SII bloquea o ralentiza conexiones desde IPs de Vercel | Spike en la Fase 0; plan B: worker Node con IP fija en Chile para la capa SII |
| Operaciones largas exceden `maxDuration` | `maxDuration` por ruta, progreso por Realtime, y operaciones idempotentes desde `operaciones_sii` |
| Re-login AUT2000 frenado por el SII | Reutilizar `sesiones_sii` y bloqueo por certificado (migración `bloqueos_sii`) |
| Doble envío tras un resultado incierto | Bloqueo de reintento en UI y API; guía para revisar en el SII |
| Fuga de secretos (pfx, tokens, CAF) | Vault, cifrado AES-GCM, `server-only`, depuración en Sentry con prueba automática |
| `ad_empresa` (verificar autorización) da por autorizada para boletas a una empresa certificada solo para factura | Validarlo antes de activar la marca automática (Fase 5); el STC avisa cuando no hay timbrajes de boleta; si la marca es falsa, el SII rechaza igual los envíos de producción; la consulta nunca quita una marca |
| El SII enciende el reCAPTCHA de la consulta de situación tributaria (STC) | Solo es fuente de apoyo: con `enable: true` se omite (`stc = 'no_disponible'`) y nada depende de ella; no se intenta resolver el captcha |
| Cambios del portal del SII (GWT, formularios `of_*`) | `verificar_portal` antes de operar; alertas de código 7; la librería tiene pruebas de paridad para ajustar rápido |
| Una sola base (producción) para desarrollo y *Production*: un error de desarrollo o una migración mala toca datos reales | Migraciones aditivas con `db push --dry-run` y respaldo previo; verificación de solo lectura después; pruebas de escritura solo dentro de `begin … rollback`; organizaciones de prueba identificadas y borradas al terminar; PITR (Fase 13) |
| Expectativa de factura por las plantillas | Ocultar lo no soportado y textos del sitio honestos sobre el alcance |
