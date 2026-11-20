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
  - Documentación para agentes: [`documentación/`](documentación/) (completa en lo que tocan las Fases 0–8; quedan esqueletos `TODO` en archivos generales y de fases posteriores).

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
| 6. Folios (CAF) | **Listo** | **Criterio de aceptación cumplido** (2026-11-15: CAF de certificación 41–45 pedido desde la UI en *Production*, en Vault y en `cafs` con `siguiente_folio = folio_desde`). 2026-11-15: código. Vista `/[org]/folios` (medidores por tipo y ambiente, historial de CAF y solicitudes, Realtime), solicitar folios en tres niveles (ensayo local, revisión con el SII `simulada`, obligatoria en producción, y timbrado), guía de `incierta` resuelta al subir el CAF, carga manual de CAF, anulación (`anular_folios`) y alerta `folios.por_agotarse` (correo + webhook). Typecheck, Vitest (697), Biome, stylelint y build en verde. Migración `0011_folios` escrita y **aplicada** en producción el 2026-11-15 (verificación 18/18, simulación 27/27, tipos sin diferencias). Deploy `4f26921` verificado en *Production* |
| 7. Emisión de boletas | **Listo** | **Criterio de aceptación cumplido** (2026-11-16): boleta de certificación emitida desde la UI en *Production* (folio 41, Track ID 34015200) aceptada por el SII (**EPR**, 1 aceptado, 0 rechazos y 0 reparos); el PDF417 de los PDF carta y rollo guardados se decodifica a bytes idénticos al TED y `sii util verificar-ted` da OK. Deploy `4cb6e9f` verificado. 2026-11-15: código. Pantalla `/[org]/emitir` (store Zustand por montaje con `sessionStorage`, autocompletado de receptores y productos, ensayo en `Dialogo`, borradores, descargas XML/PDF), `server/emision/` (token antes del folio, `asignar_folio`, firma, Storage, `envios`, envío REST, incierto, reintento ante `23514`), `server/pdf/` (carta y rollo 80 mm con PDF417 del TED verificado contra el CAF) y correo al receptor con el PDF adjunto. Sin migraciones nuevas. Typecheck, Vitest (863 + 1 omitida; correos 56), Biome, stylelint y build en verde |
| 8. Seguimiento de envíos y documentos | **Listo** | **Criterio de aceptación cumplido** (2026-11-17): boleta de certificación folio 42 emitida desde la UI (Track ID 34017110); con su página `/servicio/envios/<id>` abierta desde una carga completa, el cron de las 19:05 UTC la consultó (EPR, 1 aceptado) y la página pasó de «Enviado» a «Aceptado» sin recargar. Deploy del arreglo de Realtime `326be87` verificado. 2026-11-17: desplegado (`3ade4c9`, verificado en *Production*). `/api/cron/seguimiento` (`server/seguimiento/`: una operación `seguimiento` por empresa + ambiente + canal, un token por grupo con una renovación, lotes de 100 con presupuesto de tiempo bajo `maxDuration = 300`, *backoff* por `consultas` en el filtro de PostgREST, lista blanca de estados, EPR con detalle incompleto sin guardar, rechazos antes que el estado del envío y sin pisar estados finales), «Consultar estado en el SII» (`consultar_envio`), `/[org]/documentos` y `/[org]/envios/[id]` con Realtime (`useEnVivoStore`), alerta de inciertos en el Tablero con «Ya lo revisé» (sin migración, `marcarInciertaRevisada`) y alertas por correo (`/api/cron/alertas`: rechazo, incierto, certificado por vencer). Typecheck, Vitest de la app 1056 (+1 omitida), correos 63, librería 1775, CLI 217, Biome, stylelint y build en verde; revisión de código con 10 hallazgos, todos corregidos; `documentación/` de la fase completa. Migración `0013_notificaciones` **aplicada** en producción el 2026-11-17 (verificación 18/18, simulación 26/26 con limpieza en 0; tipos regenerados, 7 líneas de nulabilidad distinta en los retornos de funciones). `0014_cron` **aplicada** después del deploy (verificación 12/12); cron verificado: la primera corrida dejó el envío 34015200 en EPR y su documento `aceptado`, monitores de Sentry en `ok`. Al probar el criterio apareció un bug de Realtime en las cargas completas (el canal se unía como `anon` y Realtime rechazaba el filtro sin avisar), que afectaba también a Certificación y Folios: corregido (`lib/supabase/realtime.ts`) y desplegado; Vitest 1064. El rechazo con el texto del design system queda cubierto por pruebas hasta que haya uno real |
| 9. Tablero y reportes | **Listo** | **Criterio de aceptación cumplido** (2026-11-17): deploy `f5f8927` verificado en *Production*; `/servicio/tablero` (empresa 20.630.500-2, certificación, noviembre 2026) muestra $ 2.000 de ventas netas, $ 380 de IVA, 2 documentos emitidos (2 aceptados) y 0 esperando al SII, idéntico a `fase9-tablero-control.sql` corrida en ese momento; las 6 descargas responden 200 con sesión y cuadran con la consulta, y los dos Excel (boletas y resumen diario) se ven bien en Excel. Tablero `/[org]/tablero` (empresa, ambiente y período en la URL; ventas de `v_ventas_diarias` menos el set de pruebas, conteos por estado con `count: 'exact', head: true`, medidores y alertas de folios con `armarResumen` y los mismos números, últimos documentos, alertas de inciertos y certificados, Realtime y falla por sección) y exportación CSV/Excel `/[org]/reportes/exportar` (boletas del período y resumen diario por tipo; CSV con BOM y `;`, fórmulas neutralizadas, XLSX propio sin dependencias, tope de 50.000 filas), también desde Documentos emitidos. Sin migraciones nuevas. Typecheck, Vitest de la app 1149 (+1 omitida), Biome, stylelint y build en verde; revisión de código con 5 hallazgos, todos corregidos; `documentación/` de la fase completa. Consulta de control `fase9-tablero-control.sql` corrida en producción (solo lectura) |
| 10. Planes, suscripciones y cuotas | **Listo** | D4 (Flow) y D5 decididas el 2026-11-17 (precios confirmados). 2026-11-17: código (`server/pagos/` con adaptador de pasarela y Flow, `/[org]/configuracion/plan`, `/api/pagos/flow/registro`, `/api/pagos/flow/confirmacion`, `/api/cron/suscripciones`, avisos de cuota en Emitir y Equipo, correo de mora) y migraciones `0015`, `0016` y `0017` escritas y probadas en PGlite. **Criterio de aceptación cumplido** (2026-11-18, Flow sandbox en *Production*): Pyme contratado desde la UI (tarjeta de prueba ingresada por el usuario), cambio a Contador con el prorrateo de Flow, `suscripciones`, `pagos` y `eventos_pasarela` al día y `plan_vigente` con los cupos nuevos; callback de Flow recibido. `0015`, `0016` y `0017` aplicadas (10/10, 20/20, simulación 30/30, cron corriendo cada hora), deploy `9d2fd8b`. Dos arreglos de la prueba (fecha del pago con `invoice/get` y suscripción leída de la orden de Flow) desplegados en `a1f74eb` y verificados |
| 11. API pública y webhooks | **Listo** | **Criterio de aceptación cumplido** (2026-11-19, en *Production*): con `servicio` en el plan API, `scripts/ejemplo-api/emitir.mjs` emitió por la API la boleta 39 folio 43 (201, Track ID 34120364), la repetición con la misma `Idempotency-Key` devolvió el mismo documento con `Idempotent-Replayed: true` sin usar otro folio, y el receptor de ejemplo (túnel `cloudflared`) recibió `documento.aceptado` con firma válida cuando el SII dio EPR. 2026-11-19: código. `/api/v1/*` (claves por SHA-256 con `autenticar_api_key`, alcances, ambiente por prefijo, idempotencia con `api_idempotencia`, emisión con `emitirDocumento` y `origen = api`, lote de hasta 25 emisiones independientes, folios con revisión obligatoria en producción, XML/PDF por stream), entrega de webhooks `/api/cron/webhooks` (HMAC-SHA256 `Boleteame-Firma`, SSRF con `lookup` fijado, *backoff* de 1 min a 24 h, descartada tras 8), Configuración → API y Webhooks, OpenAPI 3.1 en `/api/v1/openapi.json`, `/docs/api` y cliente de ejemplo `scripts/ejemplo-api/`. Migraciones `0018_api_webhooks` y `0019_cron_webhooks` escritas y probadas en PGlite (23/23, 39/39, 8/9). Typecheck, Vitest de la app 1597 (+1 omitida), correos 67, Biome, stylelint y build en verde; revisión de código con 8 hallazgos medios o bajos, todos corregidos. `0018` **aplicada** el 2026-11-19 (23/23, simulación 39/39), deploy `169e2e5` verificado y `0019` **aplicada** (9/9, cron corriendo cada minuto) y regla del Firewall de Vercel para `/api/v1/*` (120 por minuto por IP) |
| 12. Sitio público | **Listo** | **Criterio de aceptación cumplido** (2026-11-19, en *Production*, deploy `fb0f6cf`): axe sin violaciones en claro, oscuro y móvil en las 6 páginas públicas (`e2e/sitio-publico.spec.ts` 71 pasan), precios de la landing iguales a `planes`, y un mensaje real de `/contacto` llegó al buzón de `CORREO_CONTACTO` con Turnstile verificado en el servidor, sin errores en Vercel ni Sentry. Regla de *rate limit* del Firewall para las Server Actions (POST con `Next-Action`, 60 por minuto por IP) publicada el mismo día. Datos del titular cargados en `lib/legal.ts`. **Pendiente fuera del criterio:** la revisión legal de términos y privacidad antes del lanzamiento (puntos en `documentación/07-referencia/revision-legal.md`). Código listo y verificado en local (landing con precios de `planes`, layout público, `/ayuda`, `/estado`, `/contacto` con Turnstile y Resend, `/legal/terminos` y `/legal/privacidad`, SEO; typecheck, Vitest de la app 1767 +1 omitida, correos 77, Biome, stylelint, build y `e2e/sitio-publico.spec.ts` 71 en verde; revisión de código corregida); sin migraciones. `CORREO_CONTACTO` cargada en Vercel |
| 13. Endurecimiento y lanzamiento | **En parte** | 2026-11-20: deploy `c619a1a` verificado en *Production* (cabeceras, humo sin sesión, sin violaciones de CSP en las páginas públicas) y `0020_endurecimiento` aplicada (verificación 9/9). 2026-11-19: Revisión de seguridad de la app (`server-only` en todo `server/` con prueba, `getUser()` en equipo, plan y «marcar revisada», `service_role` auditado con pruebas, cabeceras con CSP en *Report-Only*); simulación RLS por tabla `rls-fase13-acceso-por-tabla.sql` 52/52 en producción; migración `0020_endurecimiento` escrita y probada con `rollback` (sin aplicar); e2e del flujo crítico con SII falso en verde (destapó y arregló un bug de `descargarSet`); runbooks, respaldo (**PITR apagado**), observabilidad (alertas por crear) y checklist de lanzamiento redactados. 2026-11-20: navegación con sesión sin violaciones y CSP en *enforce* con reportes por `/api/csp`, desplegada (`ed5df22`) y verificada; clave HS256 legada revocada sin incidentes. Faltan: alertas de Sentry, PITR y restauración probada, revocar la HS256, Flow a producción, boleta propia por cobro, revisión legal y el piloto |
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
| H5 | **Planes:** el SQL trae `certificacion`, `emprendedor`, `pyme`, `empresa` con precios de ejemplo; la landing muestra «Pyme», «Contador» y «API» con `[TU PRECIO]`. | D5 decidida el 2026-11-17 (§9); migrar `planes` en la Fase 10 (`0015_planes_comerciales`). |
| H6 | **Pasarela de pago sin definir.** `suscripciones.proveedor_pago` es texto libre; en el entorno hay MCP de Flow y Transbank, pero el stack pedido no nombra pasarela. | D4 decidida el 2026-11-17: Flow (§9). La Fase 10 se diseña con un adaptador de pasarela. |
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
| `CORREO_CONTACTO` | servidor | Fase 12: buzón del equipo que recibe el formulario de `/contacto` (solo la dirección); sin ella el formulario responde «No pudimos enviar tu mensaje» |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | público / servidor, *sensitive* | la secreta también va en Supabase Auth (*Attack Protection*); la pública se incrusta al compilar |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | público / build | |
| `FLOW_API_KEY`, `FLOW_SECRET_KEY`, `FLOW_API_URL` | servidor, *sensitive* (las dos claves) | Pasarela Flow (D4). `FLOW_API_URL` solo `https://sandbox.flow.cl/api` (Fase 10) o `https://www.flow.cl/api` (lanzamiento); las claves son del mismo ambiente. Sin ellas, la página de plan muestra la grilla sin contratar y `/api/pagos/*` y `/api/cron/suscripciones` responden 503 |
| `NEXT_PUBLIC_APP_URL` | público | enlaces en correos; desde la Fase 12 también `metadataBase`, sitemap, `robots.txt` y JSON-LD (se fija en el build); `https://boleteame.dev` en *Production*, `http://localhost:3000` en local |

No hay variables `SII_CERT_*` ni `SII_CAF_*` como en la CLI: en el SaaS esos datos son de
cada empresa y viven en Vault.

Solo claves API nuevas, y `env.ts` rechaza las demás por prefijo. Las legadas (`anon` / `service_role`, JWT `eyJ…`) están **desactivadas** en Supabase desde el 2026-11-13 (responden 401). El retiro definitivo se hizo el 2026-11-20 (Fase 13): la clave HS256 legada está **revocada** en *JWT Keys*. Los JWT de sesión se firman con ES256 y se verifican localmente con el JWKS, así que una sesión revocada sigue sirviendo hasta su `exp` (≤ 1 h). Detalle y reglas en `documentación/01-fundamentos/ambientes-y-credenciales.md`.

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
| `0010_verificar_autorizacion` | 5 | **Aplicada** (2026-11-14, 00:59 UTC; verificación 6/6 y simulación 7/7): agrega el valor `verificar_autorizacion` (🔁, lectura) al final del enum `operacion_sii`, para auditar la consulta de `ad_empresa` y el STC (Fase 5, «Verificar autorización en el SII»). Solo eso: `alter type … add value` no se puede usar en la misma transacción que lo agrega, y no se puede quitar después. El índice de efecto global de la 0007 no cambia. Sin tablas ni políticas nuevas (la resolución se registra con lo que ya existe y la marca la pone el trigger de la 0009). Verificación: `supabase/verificaciones/0010_verificar_autorizacion.sql` (6); simulación: `rls-fase5-verificar-autorizacion.sql` (7, con `rollback`). En PGlite 6/6 y 7/7 |
| `0011_folios` | 6 | **Aplicada** (2026-11-15; en producción verificación 18/18 y simulación 27/27 con limpieza en 0; tipos sin diferencias. PGlite: verificación 18/18 y simulación 27/27; sin la 0011, 3/18 y 1/27; las simulaciones de las Fases 3–5 y la verificación 0006 siguen en verde): RPC `anular_folios(caf, desde, hasta, motivo)` → folios anulados en la llamada (`security definer`; `authenticated` y `service_role`, no `anon`; service_role o administrador de la organización del CAF, `42501` si es miembro sin serlo y `P0002` si el CAF no existe o es de otra organización). Bloquea el CAF como `asignar_folio`; bajo `siguiente_folio` solo inserta en `folios_anulados` (`on conflict do nothing`, repetir da 0); la cola completa (desde `siguiente_folio` o antes hasta `folio_hasta`) además deja el CAF `anulado` con `siguiente_folio = folio_hasta + 1`; cola parcial, rango fuera del CAF o motivo vacío/>500 → `22023`; folio con documento no anulado → `23503`. Trigger `trg_20_caf_sin_traslape` en `cafs` (`23P01` si el rango se cruza con otro CAF de la misma empresa, ambiente y tipo; `registrar_caf` sigue idempotente). Quita la política `alta` de `folios_anulados` (0001) y revoca a `authenticated` insert, update, delete y truncate: solo se escribe con `anular_folios` o service_role (el set de pruebas, `envio-set.ts`, ya usa service_role). Agrega `cafs` y `folios_anulados` a `supabase_realtime` (idempotente, como la 0006; RLS de lectura `es_miembro`; `cafs` solo trae `caf_secret_id`, el XML está en Vault). Verificación: `supabase/verificaciones/0011_folios.sql` (18); simulación: `rls-fase6-folios.sql` (27, con `rollback`) |
| `0012_folio_anulado` | 7 (riesgo de la Fase 6) | **Aplicada** (2026-11-15; en producción verificación 7/7 y simulación 9/9 con limpieza en 0, `0011_folios.sql` sigue 18/18 y el CAF real de certificación 41–45 intacto; antes de migrar daba 5/7 y la función era idéntica a la de la 0001 por md5. PGlite: 7/7 y 9/9; sin la 0012, 5/7 y 5/9; regresiones de las Fases 3–6 y 0008 en verde): `create or replace` de `tg_validar_documento()` con el cuerpo de la 0001 más (1) la lectura del CAF con `for key share`, que se serializa con el `for update` de `anular_folios`, y (2) después, si el documento fija su folio (INSERT con folio o UPDATE que cambia `folio`/`caf_id`), `23514` si `(caf_id, folio)` está en `folios_anulados`. Cierra el riesgo de un folio asignado y anulado antes de que exista su documento. Un UPDATE que no cambia folio ni CAF (el `estado = 'anulado'` de `envio-set.ts`) no se revisa. Sin cambios en el trigger ni en privilegios. Verificación: `supabase/verificaciones/0012_folio_anulado.sql` (7); simulación: `rls-fase7-folio-anulado.sql` (9, con `rollback`) |
| `0013_notificaciones` | 8 | **Aplicada** (2026-11-17, antes del deploy de la Fase 8; el `--dry-run` listó solo la 0013, con la 0014 sacada de `supabase/migrations/` durante el push; en producción verificación 18/18 y simulación 26/26 con limpieza en 0, `vault.secrets` igual (4) y `notificaciones` sin filas; `pnpm db:tipos` difiere en 7 líneas de lo agregado a mano, porque el generador marca no nulas columnas de los retornos de `alertas_*` y `reclamar_notificacion`; se versionó lo generado. PGlite: verificación 18/18, 0/18 sin ella; simulación 26/26, 1/26 sin ella): tabla `notificaciones`, una fila por aviso por correo con `clave` única de deduplicación (`documento.rechazado:<documento>`, `envio.incierto:<envío>`, `certificado.por_vencer:<certificado>:<30\|15\|7\|1>`), `tipo` con formato de evento (texto, no enum), `estado` `pendiente`/`enviada`/`fallida`, `intentos`, `grupo` (= `Idempotency-Key` del correo; los rechazos de una organización, empresa y ambiente van en un correo, cada documento con su fila), `datos`, `destinatarios`, `resend_id`, `error` acotado; FK a `organizaciones` en cascada, índice por organización y `trg_90_actualizado_en`. RPC `reclamar_notificacion(org, tipo, clave, referencia, datos) → (id, intentos, grupo)` (`security definer`; `insert … on conflict do update … where` atómico: nueva, o `fallida`/`pendiente` de más de 15 min con menos de 5 intentos y de la misma organización; `22004`/`23514`/`23503`), `notificacion_cerrada(clave)` (su negación) y los candidatos `alertas_documentos_rechazados(desde, limite)`, `alertas_envios_inciertos(desde, limite)` y `alertas_certificados_por_vencer(limite)` (`stable`, invoker; sin lo ya avisado y por turnos entre organizaciones con `row_number() over (partition by organizacion_id …)`; rechazos sin el set, inciertos de `emision`, certificados con su umbral). Las cinco solo `service_role`. RLS `lectura` (`es_miembro`); `authenticated` solo `select`, `anon` nada; sin Realtime. Verificación: `supabase/verificaciones/0013_notificaciones.sql` (18); simulación: `rls-fase8-notificaciones.sql` (26, con `rollback`) |
| `0014_cron` | 8 | **Escrita, pendiente de aplicar** (se aplica **después** del deploy de la Fase 8; PGlite: verificación 11/12, la 1, extensiones, no aplica en PGlite): 4 jobs de `pg_cron` (UTC), idempotente (desagenda y vuelve a agendar): `seguimiento-envios` `*/5 * * * *` (`net.http_post` a `https://boleteame.dev/api/cron/seguimiento`, timeout 300 s), `alertas` `*/10 * * * *` (`/api/cron/alertas`, 60 s), `limpiar-tokens-sii` `17 * * * *` (tokens vencidos hace más de un día) y `limpiar-historial-cron` `23 3 * * *` (`cron.job_run_details` de más de 7 días). Bearer leído de `vault.decrypted_secrets` (`cron_token`) en cada corrida, nunca en `cron.job.command`; se niega a correr (`55000`) sin `cron_token`. Verificación: `supabase/verificaciones/0014_cron.sql` (12, sin mostrar el secreto) |
| `0015_planes_comerciales` | 10 | **Aplicada** (2026-11-18, antes del deploy; en producción verificación 10/10, 1/10 antes de migrar; PGlite 10/10): columnas `planes.autoservicio` y `planes.orden`; grilla D5 idempotente (`certificacion` 0 · `pyme` 14.990 · `contador` 49.990 · `api` 39.990 · `empresa` a medida · `emprendedor` inactivo); `crear_organizacion()` sin `periodo_fin` (Certificación sin plazo) y limpieza de `periodo_fin` en las `certificacion`/`prueba`. Verificación: `supabase/verificaciones/0015_planes_comerciales.sql` (10) |
| `0016_pagos` | 10 | **Aplicada** (2026-11-18, antes del deploy, con la 0015 en el mismo `db push` y la 0017 fuera de la carpeta; en producción verificación 20/20 —0/20 antes—, simulación 30/30 y `rls-fase2-tenancy` 52/52, con la limpieza en 0 y los totales iguales antes y después; `0004` 3/3 y `0013` 18/18 siguen en verde; tipos regenerados, iguales a los agregados a mano salvo el orden de dos tablas; *Advisors* sin novedades salvo lo esperado: `eventos_pasarela` sin políticas y FK nuevas sin índice, para la `0018`. PGlite: verificación 20/20 y simulación 30/30; 0/20 y 2/30 sin ella; regresiones `rls-fase2-tenancy` 52/52 —ajustada: su sección 2 usa `empresa` porque Pyme pasó a 3 usuarios—, `rls-fase3-empresas` 43/43, `0004` 3/3, `rls-fase8-notificaciones` 26/26): tablas `clientes_pago` (cliente de Flow, tarjeta, plan pendiente), `pagos` (importes de Flow, upsert por `(proveedor, factura_externa)`) y `eventos_pasarela` (avisos de Flow, idempotencia por `(proveedor, tipo, token)`; solo service_role); `suscripciones.cancelar_al_fin_periodo`, `sincronizada_en` e índice único `(proveedor_pago, id_externo)`; RPC `activar_suscripcion(...)` (solo service_role: cancela la vigente e inserta la nueva en una transacción, o actualiza la misma; idempotente; `for no key update` sobre la organización; 22023 si el id externo ya terminó). RLS de lectura `es_admin` en `clientes_pago` y `pagos`. Verificación: `supabase/verificaciones/0016_pagos.sql` (20); simulación: `rls-fase10-pagos.sql` (30, con `rollback`) |
| `0017_cron_suscripciones` | 10 | **Aplicada** (2026-11-18, después del deploy `9d2fd8b`): job `sincronizar-suscripciones` `41 * * * *` → `POST https://boleteame.dev/api/cron/suscripciones` (timeout 120 s), Bearer de Vault en cada corrida, idempotente, `55000` sin `cron_token` |
| `0018_api_webhooks` | 11 | **Aplicada** (2026-11-19, 03:40 UTC, antes del deploy, con la 0019 fuera de la carpeta; en producción verificación 23/23 —2/23 antes—, simulación 39/39 con limpieza en 0, regresiones `rls-fase8` 26/26 y `rls-fase10` 30/30, `0013` 18/18 y `0016` 20/20; tipos regenerados, 9 líneas de nulabilidad distinta en retornos de funciones; *Advisors* solo con lo esperado. PGlite: verificación 23/23 —2/23 sin ella—, simulación `rls-fase11-api.sql` 39/39 con limpieza en 0 —3/39 sin ella—, regresiones de las Fases 2 a 10 en verde; en producción `webhooks`, `webhook_entregas` y `api_keys` están vacías): tabla `api_idempotencia` (solo service_role) con `reclamar_idempotencia` / `terminar_idempotencia` / `soltar_idempotencia`; `autenticar_api_key(hash)` (motivo `invalida`/`revocada`/`vencida`/`plan_sin_api`, `ultimo_uso_en` con *throttle* de 1 min); `reclamar_entregas_webhook` (`skip locked`, por turnos entre organizaciones, descarta inactivos, sin plan o con 8 intentos) y `cerrar_entrega_webhook(p_id, p_intento, …)` (*backoff* 1, 5, 30 min, 2, 6, 12, 24 h ±10 %; solo cierra si `intentos = p_intento`); `reenviar_entrega_webhook`, `probar_webhook` (`webhook.prueba`) y `rotar_secreto_webhook` (authenticated, administradores); `webhook_entregas.reenviada_en/por`; `encolar_evento` filtra por plan con webhooks; `tg_evento_documento` agrega `estado`, `origen` y `clave_idempotencia`; check `webhooks_url_permitida`; revocar una clave es definitivo (trigger `trg_10_api_key_sin_reactivar` y grant de columna solo a `nombre` y `revocada_en`); índices de FK y del listado. Verificación: `supabase/verificaciones/0018_api_webhooks.sql` (23); simulación: `rls-fase11-api.sql` (39, con `rollback`) |
| `0019_cron_webhooks` | 11 | **Aplicada** (2026-11-19, 03:54 UTC, después del deploy `169e2e5`; verificación 9/9, primera corrida 200 y monitor `cron-webhooks` en `ok`. PGlite 8/9, la 1 —extensiones— no aplica): jobs `entregar-webhooks` `* * * * *` (`/api/cron/webhooks`, 60 s, Bearer de Vault), `limpiar-webhook-entregas` `37 4 * * *` (entregadas o descartadas de más de 30 días) y `limpiar-api-idempotencia` `47 4 * * *`. Al aplicarla, la comprobación 10 de `0014_cron.sql` pasa a `false` (esperado). Verificación: `supabase/verificaciones/0019_cron_webhooks.sql` (9) |
| `0020_endurecimiento` | 13 | **Aplicada** (2026-11-20, 01:23 UTC, después del deploy `c619a1a`; verificación 9/9 —2/9 antes—, `unindexed_foreign_keys` resuelto, tipos sin cambios. Probada antes con `rollback`: 6/6 de comportamiento). Check `organizaciones_slug_no_reservado` con los 26 slugs de `SLUGS_RESERVADOS` (entre marcadores, comparados con `lib/rutas.ts` por `slugs-reservados-db.test.ts`); 53 índices para las 54 FK sin índice (parciales en las columnas que admiten null; sin `concurrently`, porque las tablas son diminutas); dos índices de `operaciones_sii` por `terminada_en` para `/estado`; quitar EXECUTE público de `tg_api_key_sin_reactivar`. Antes o después del deploy (la app no depende de ella). Pasos en `documentación/08-esquema-supabase/despliegue.md`, «Fase 13: migración 0020» |
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

#### Verificar autorización en el SII (hecha; pendiente validar boleta frente a factura)

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
  queda o si la consulta solo propone la resolución. **Pendiente por decisión del usuario
  (2026-11-14): no hay una empresa certificada en factura con que probar.** Mientras tanto
  queda la mitigación: el aviso del STC cuando no hay timbrajes de boleta y el rechazo del
  SII a los envíos de producción.
- [x] Librería: `ConsultaAutorizacion` y `SituacionTributaria`, CLI, MCP y pruebas con
  páginas y respuestas grabadas (también `enable: true` en `recaptcha/key` y una forma de
  respuesta desconocida). 2026-11-13: las dos clases en `packages/core/src/folios/`, error
  nuevo `ErrorVerificacion` (código 7 en la CLI), `leerAdEmpresa2` exportada; CLI
  `sii produccion autorizacion [rut]` y `sii util situacion-tributaria <rut>` (ambas con
  `--json`), herramientas MCP `produccion_autorizacion` y `util_situacion_tributaria` (solo
  lectura). Páginas de `ad_empresa` grabadas en palena (1 login, solo lectura; datos de la
  empresa reemplazados) y respuestas del STC en `paridad/autorizacion/`. La autorización
  viene en una tabla (filas «Fecha Autorización», «Fecha Resolución», «Resolución»), no en
  campos `NroResol` / `FchResol`. Core 1775 pruebas y CLI 217 en verde, Biome y typecheck
  limpios. Probado contra el SII real con el `.env` del piloto: `produccion autorizacion`
  → autorizada desde 2026-11-06, resolución 80 del 2014-08-22; `situacion-tributaria`
  20630500-2 → 39, 2026, folio 5 (`packages/certificacion/docs/validaciones.md`).
- [x] Migración `0010_verificar_autorizacion` aplicada y verificada; tipos regenerados.
  2026-11-14 (00:59 UTC), con el OK del usuario: solo el valor `verificar_autorizacion` al
  final de `operacion_sii` (lo demás ya existe: `registrar_resolucion` de la 0005 y el
  trigger de la 0009). `--dry-run` solo con la 0010; verificación
  `supabase/verificaciones/0010_verificar_autorizacion.sql` 6/6 y simulación
  `rls-fase5-verificar-autorizacion.sql` 7/7 con limpieza en 0, en PGlite y en producción
  (sin la 0010: 2/6 y 3/7); regresiones de las Fases 3–5 en verde; `pnpm db:tipos` idéntico
  a lo agregado a mano; Advisors de seguridad sin avisos nuevos. Typecheck, Biome y Vitest
  de la app (586) en verde.
- [x] App y UI con pruebas (Supabase falso y doble de la librería): los tres tipos de
  respuesta de `ad_empresa` combinados con `boleta` / `sin_boleta` / `no_disponible` del
  STC, página desconocida, RUT distinto, sin certificado, y ninguna fila con secretos ni
  correos. 2026-11-14: `server/certificacion/autorizacion.ts` (`verificarAutorizacion`,
  `apoyoStc`, `medianocheChile`), fábricas `autorizacion` / `situacionTributaria`,
  `ejecutar` y `conSesionSii` con `ambiente` (sesión y bloqueo de producción), `ErrorVerificacion`
  de la librería → `verificacion_fallida`, `ResultadoPaso` ok con `tono` y `sugerencia`.
  `leerAsistente` muestra las filas `verificar_autorizacion`. UI: cuarta acción del paso 1
  y nota que la propone, botón tras un «sin trámite», «Verificar en el SII» en la tarjeta de
  autorización externa y «Traer del SII» en Configuración → Empresas → Resoluciones (página
  con `maxDuration = 300`). Pruebas: `autorizacion.test.ts` (25), `logica.test.ts` y
  `errores.test.ts`; Vitest de la app 615, typecheck, Biome, stylelint y `pnpm build` en
  verde. Sin desplegar.
- [x] Prueba real en *Production* con la empresa del piloto. Como ya está marcada, todo
  tiene que quedar igual (misma resolución), con una fila `verificar_autorizacion` en `ok`
  y `stc = 'boleta'`. 2026-11-15 02:53 UTC (23:53 del 14 en Chile), deploy `b1deae4`
  READY, «Verificar en el SII» desde la tarjeta «Autorizada fuera de Boletéame» (Chrome,
  sesión del propietario): mensaje «El SII confirma que la empresa está autorizada desde el
  06-11-2026 (Resolución n.º 80 del 22-08-2014) y ya timbró folios de boleta electrónica. La
  resolución de producción registrada es la misma.» Antes y después iguales:
  `autorizada_en` 2026-11-06 03:00 UTC, una sola resolución (producción 80 / 2014-08-22,
  vigente). Una fila `verificar_autorizacion` (producción, `ok`, ~3 s) con `detalle`
  `respuesta: autorizada`, `nro_resol: 80`, `fch_resol`, `fecha_autorizacion`,
  `resolucion: igual`, `stc: boleta`, `stc_ultimo_anio: 2026`, sin correos, URL, software
  ni razón social. Quedó la sesión de producción guardada (1 login), ningún bloqueo tomado;
  «Últimas operaciones» la muestra primero; sin errores de consola ni de runtime en Vercel.
  «Traer del SII» se ve en Configuración → Empresas → Resoluciones (no se pulsó: es la
  misma acción).
- [x] Documentación: pasar de «prevista» a hecha (2026-11-14, con la prueba real en
  *Production* registrada en la guía)
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

**Pendientes:**

- [x] Código y pruebas (2026-11-15): `server/folios/` (`sii`, `solicitar`, `subir`, `anular`, `alertas`, `lectura`, `disponibles`, `caf`, `errores`), contrato `lib/folios.ts`, UI `app/[org]/folios/` (`maxDuration = 300`), plantilla de correo en `packages/correos`, `e2e/folios.spec.ts` (sin ejecutar). `solicitarFoliosSet` de la Fase 5 reutiliza `server/folios/sii.ts` sin cambiar su comportamiento. Todo con dobles, sin salir al SII. Typecheck, Vitest de la app 684 (+1 omitida), correos 52, Biome, stylelint y `pnpm build` en verde.
- [x] Migración `0011_folios` escrita: RPC `anular_folios` (P0002 / 42501 / 22023 / 23503; la cola exige `p_hasta = folio_hasta` y `p_desde <= siguiente_folio`) y trigger `trg_20_caf_sin_traslape` (23P01); quita la política `alta` de `folios_anulados` y revoca su escritura a `authenticated` (solo `anular_folios` o service_role); agrega `cafs` y `folios_anulados` a `supabase_realtime`. PGlite: verificación 18/18 (3/18 sin ella), simulación `rls-fase6-folios.sql` 27/27 (1/27 sin ella); regresiones de las Fases 3–5 en verde. Producción hoy: 0 CAF, 0 anulados.
- [x] `documentación/` de la fase (2026-11-15): 24 archivos; la 0011 figura como pendiente de aplicar y `08-esquema-supabase/despliegue.md` lista los 15 archivos donde cambiarlo al aplicarla.
- [x] Correcciones de lo que encontró la documentación (2026-11-15): (1) `folios_anulados` ya no acepta escrituras con sesión (política `alta` quitada en la 0011); (2) un CAF timbrado que choca por traslape queda `incierta` con mensaje propio (`detalle.incierto_motivo = 'traslape'`) y la UI no ofrece subirlo; (3) la revisión con el SII se rechaza en el servidor con un `incierto` sin revisar o una confirmada en curso (`revisarOperacionPendiente`, compartida con `ejecutarOperacion`), confirma la sesión con `getUser()` y `TransporteSinTimbrar` corta por lista permitida (solo `of_solicita_folios`, `of_solicita_folios_dcto` y `of_confirma_folio` en el portal del ambiente); (4) `subirCaf` exige empresa activa; (5) vista y servidor leen el plan con `plan_vigente()` (`server/folios/plan.ts`); (6) `EnVivo` escucha `cafs` y `folios_anulados`. Vitest de la app 697 (+1 omitida), typecheck, Biome, stylelint y build en verde.
- [x] Ajuste menor ajeno a la fase (2026-11-15): la comprobación 12 de `verificaciones/0001_esquema.sql` exigía exactamente 3 tablas en `supabase_realtime` y fallaba desde la 0006; ahora exige que estén las 3 de la 0001 (`@>`), y da `true` en producción (7 tablas).
- [x] Aplicar la 0011 en producción (2026-11-15, con el OK del usuario): `db push --remote --dry-run` mostró solo la 0011; aplicada; verificación 18/18 y simulación `rls-fase6-folios.sql` 27/27 en producción con limpieza en 0 (`vault.secrets` igual que antes); `pnpm db:tipos` idéntico a lo agregado a mano; Advisors de seguridad: el único aviso nuevo es `anular_folios` ejecutable por `authenticated` (`security definer`), intencional (la llama el administrador con su sesión y verifica `es_admin`, como `crear_invitacion`). Documentación pasada a «aplicada».
- [x] Deploy a *Production* (2026-11-15): `4f26921` READY; `/`, `/ingresar` → 200; `/servicio/folios` sin sesión → 307 a `/ingresar?siguiente=%2Fservicio%2Ffolios`; `/_ds` → 404. Con la sesión del propietario (Chrome, sin pulsar acciones), `/servicio/folios` muestra la empresa del piloto (20.630.500-2, autorizada en producción), producción y certificación con 0 folios en 39 y 41, los formularios de solicitar y subir CAF, e historiales vacíos; «El plan vigente no incluye producción» es correcto (plan `certificacion`, suscripción `prueba`, `permite_produccion = false`, comprobado con `plan_vigente()`). Sin mensajes de consola ni errores de runtime en Vercel.
- [x] **Criterio de aceptación cumplido** (2026-11-15, con el OK del usuario): desde `/servicio/folios` en *Production* (Chrome, sesión del propietario), empresa del piloto, certificación, boleta 39, 5 folios. Revisión con el SII: «asignaría los folios 41 a 45» (solicitud `simulada`, operación `ok` `nivel: revision`); timbrado: operación `ok` `nivel: timbrar`, solicitud `timbrada` con `caf_id`, CAF 41–45 IDK 100 `activo` en `cafs` con `siguiente_folio = folio_desde` (41) y el XML con `RSASK` en Vault. Sin secretos en `operaciones_sii` ni `solicitudes_folios`, sin bloqueos, sin errores de consola ni de runtime. Registrado en `documentación/02-guias/folios-caf.md`.

Decisiones tomadas en la fase: la revisión con el SII es obligatoria antes de timbrar en producción y el servidor lo exige (`revisionId`: solicitud `simulada` de la misma empresa, ambiente, tipo, cantidad y folio inicial, de menos de 30 min, un solo uso); producción exige `autorizada_produccion` y `plan_vigente().permite_produccion`; la `incierta` se resuelve subiendo el CAF que calza (va como `p_solicitud` a `registrar_caf` y se marca revisada la operación) o con «Marcar como revisada»; el 15 % se mide sobre el tamaño de los CAF activos con folios libres y la alerta salta solo al cruzar (a aviso o a cero), con `Idempotency-Key` determinista; el punto 4 opcional (STC) no se implementó. **Riesgo para la Fase 7 (cerrado el 2026-11-15):** un folio asignado cuyo documento aún no se inserta podía anularse. Migración `0012_folio_anulado` aplicada en producción (verificación 7/7, simulación 9/9, limpieza en 0, tipos sin diferencias, Advisors sin avisos nuevos): `tg_validar_documento` bloquea el CAF con `for key share` (se serializa con el `for update` de `anular_folios`) y rechaza con `23514` un documento que fija un folio anulado. La emisión de la Fase 7 tiene que tratar el `23514` pidiendo otro folio.

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

**Pendientes:**

- [x] Contrato `lib/emision.ts` (2026-11-15): borrador, `esquemaBorrador` (RUT normalizado, receptor genérico por defecto, ISO-8859-1, boleta 41 solo con líneas exentas, precio entero, cantidad hasta 3 decimales) y `calcularTotales`, con paridad probada contra `GeneradorBoleta` (casos fijos y 300 al azar en `emision.test.ts`). Dependencias nuevas con versión exacta: `zustand@5.0.16`, `pdfkit@0.20.2`, `bwip-js@4.11.4`; desarrollo: `@types/pdfkit@0.17.7`, `zxing-wasm@3.1.6` (decodifica el PDF417 en las pruebas).
- [x] Backend `server/emision/` (2026-11-15): ensayo sin folio, red ni filas; emisión dentro de `ejecutarOperacion('emitir')` con el borrador guardado por RLS, token antes de `asignar_folio`, un solo update a `firmado` (guardado con `estado = 'borrador'`), reintento ante `23514` (hasta 3 folios), cuota `P0001` y 0 filas anulan el folio, 4xx deja el documento `anulado`, duda tras salir → `envios.incierto`; después del `ok`, alerta del 15 %, PDF carta y rollo a Storage (`metadata.pdf`) y correo al receptor (fallas como avisos). Reemitir un documento `incierto` o ya emitido se rechaza en el servidor. Sin migración nueva.
- [x] `server/pdf/` y correo (2026-11-15): PDF417 nivel 5 con los bytes ISO-8859-1 exactos del TED (`binarytext`), decodificado en la prueba y con la `<FRMT>` verificada contra el CAF de prueba; plantilla `correoBoleta` y adjuntos en `server/correo/resend.ts`; `pdfkit` y `bwip-js` en `serverExternalPackages`. Los parámetros del timbre salen del instructivo del SII, que no está en el repo: contrastarlos con el documento oficial.
- [x] UI `/[org]/emitir` (2026-11-15): `maxDuration = 60`; doble envío bloqueado (instantánea del ensayo + guardia + botón ocupado); un incierto bloquea emitir hasta «Ya la revisé» (también tras recargar); un 4xx conserva el formulario y reemite sin `borradorId`; componente `Autocompletado` (combobox ARIA); `e2e/emitir.spec.ts` escrito, sin ejecutar.
- [x] Verificación local (2026-11-15): typecheck, Vitest de la app 863 (+1 omitida), correos 56, Biome, stylelint y `pnpm build` en verde.
- [x] `documentación/` de la fase (2026-11-16): guía `02-guias/emision-boletas.md` completa (flujo, tabla de estados por camino, PDF, correo, borradores) y referencias actualizadas en 20 archivos; sección «Emisión de boletas (Fase 7)» en `07-referencia/trampas-conocidas.md`; el criterio de aceptación figura como pendiente.

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`, «Fase 7»): el paso 8 del flujo se amplió. El folio se anula ante cualquier falla antes de enviar (no solo antes de firmar) y también ante un rechazo 4xx del SII, que deja el documento `anulado`. El documento queda `incierto` por el trigger de `envios`, no porque la app lo marque. El token se pide antes de asignar el folio. La emisión usa un cliente REST propio con el ambiente, porque `deps.sii.rest` fija certificación. La emisión no usa `conBloqueoCertificado`, porque REST no usa sesiones AUT2000. El correo del receptor, las rutas de los PDF y el resultado del correo van en `documentos.metadata`, porque `documentos` no tiene columnas para ellos.
- [x] Deploy a *Production* (2026-11-16): `4cb6e9f` READY; `/` y `/ingresar` → 200; `/servicio/emitir` sin sesión → 307 a `/ingresar?siguiente=%2Fservicio%2Femitir`; `/_ds` → 404. Con la sesión del propietario (Chrome, sin emitir ni guardar), `/servicio/emitir` muestra la empresa del piloto (20.630.500-2). Producción está bloqueada por el plan, como corresponde (`certificacion`, `permite_produccion = false`). Certificación está bloqueada porque falta la resolución de certificación de la empresa: es una empresa autorizada fuera de Boletéame y nunca postuló aquí. El folio previsto es el N.º 41 (CAF 41–45, 5 de 5 disponibles). Los totales en vivo cuadran: $ 2.990 da neto $ 2.513 e IVA $ 477. Sin errores de consola ni de runtime en Vercel.
- [x] **Criterio de aceptación cumplido** (2026-11-16, con el OK del usuario). Detalle en `documentación/02-guias/emision-boletas.md`.
  - **Requisito previo:** se registró la resolución de certificación de la empresa del piloto (N.º 0 del 06-11-2026, `SII_FCH_RESOL` de `certificacion-node`). Faltaba porque se autorizó fuera de Boletéame.
  - **Emisión:** desde `/servicio/emitir` en *Production*, boleta 39 de $ 1.190. Ensayo y confirmación: resultado `ok`, folio 41, Track ID 34015200. Documento `enviado`, operación `ok` sin secretos, CAF con `siguiente_folio = 42`, sin folios anulados.
  - **SII:** `sii produccion consultar 34015200 --ambiente certificacion` dio **EPR**, 1 aceptado, 0 rechazos y 0 reparos.
  - **PDF417:** el de los PDF carta y rollo guardados en Storage se decodificó a bytes idénticos a `ted_xml`, y `sii util verificar-ted` con el CAF 41–45 dio OK (1/1).
  - Sin errores de consola ni de runtime.
  - El documento sigue `enviado` en la base hasta que la Fase 8 propague el estado del envío.

### Fase 8 — Seguimiento de envíos y documentos

1. `/api/cron/seguimiento` cada 5 minutos (pg_cron): lee `v_envios_por_consultar`, agrupa por empresa y ambiente, **un token por empresa**, consulta estado (REST `EstadoEnvioRest` o SOAP `EstadoEnvio`), guarda `envios`, `envio_estadisticas`, `envio_rechazos` y `consultas_envio`; los triggers propagan a `documentos` y encolan webhooks. *Cron monitor* de Sentry.
2. Envíos `incierto`: nunca se reintentan solos; aparecen en el Tablero con una `Alerta` y la guía para revisar en el SII.
3. `/[org]/documentos` según la plantilla: filtros (período, tipo, estado, búsqueda) en la URL, `TablaDTE` paginada en el servidor, panel de detalle con acciones (descargar XML y PDF, consultar estado en el SII, reenviar al receptor). «Anular con nota de crédito» queda oculto hasta la Fase 14.
4. `/[org]/envios/[id]`: carátula, Track ID, bitácora de consultas, rechazos y reparos con sus errores (`seccion`, `linea`, `codigo`, `descripcion`), mostrando el XML solo como detalle.
5. Realtime: los badges `EstadoDTE` cambian solos.
6. Alertas por correo con `notificaciones` (migración `notificaciones`, §6): rechazo, incierto, certificado por vencer.

**Criterio:** un envío pasa de `enviado` a `aceptado` en la UI sin recargar, y un rechazo muestra el error del SII con el texto del design system.

**Pendientes:**

- [x] Código y pruebas (2026-11-17): `server/seguimiento/` (`cron`, `consultar-envio`, `consulta`, `persistencia`, `dependencias`, `tipos`), `server/sii/clientes.ts` (clientes REST y DTEWS por ambiente, compartidos con la emisión), rutas `api/cron/seguimiento` (`maxDuration = 300`) y `api/cron/alertas` (`maxDuration = 60`) con `server/cron/autorizacion.ts` (Bearer `CRON_SECRET` en tiempo constante, 503 sin secreto, *cron monitors* `cron-seguimiento` y `cron-alertas`) y `envCron()`, contrato `lib/seguimiento.ts`; `server/alertas/` y plantillas `rechazo`, `incierto` y `certificado` en `packages/correos`; UI `app/[org]/documentos/` y `app/[org]/envios/[id]/` (filtros en la URL, `TablaDTE` paginada en el servidor, panel con descargas, consulta y reenvío, carátula, estadísticas, rechazos y reparos, bitácora, «Ya lo revisé»), `server/documentos/`, alerta de inciertos en el Tablero, `stores/enVivo.ts` + `ProveedorEnVivo.tsx`, `MarcoApp.tsx` (`envios` marca «Documentos emitidos»), `e2e/documentos.spec.ts` (sin ejecutar). Todo con dobles, sin salir al SII. Typecheck, Vitest de la app 1056 (+1 omitida), correos 63, librería 1775, CLI 217, Biome, stylelint y `pnpm build` en verde.
- [x] Migraciones `0013_notificaciones` y `0014_cron` escritas y probadas en PGlite: 0013 verificación 18/18 (0/18 sin ella) y simulación `rls-fase8-notificaciones.sql` 26/26 (1/26 sin ella); 0014 verificación 11/12 (la 1, extensiones, no aplica en PGlite). Producción hoy: sin `notificaciones`, 0 jobs en `cron.job`, `cron_token` en Vault.
- [x] Revisión de código (2026-11-17): 10 hallazgos, todos corregidos; las correcciones del seguimiento tienen sus pruebas en `server/seguimiento/revision.test.ts` (tiempo de la corrida y filas abandonadas, backoff en la base, EPR con detalle incompleto, estados desconocidos y token SOAP, inconsistentes y respuestas viejas, envíos que nunca cierran).
- [x] `documentación/` de la fase (2026-11-17): guía `02-guias/seguimiento-envios.md` completa (cron, grupos y tokens, backoff, tabla de estados, rechazos, incierto, consulta del panel, alertas, pg_cron, diagnóstico con SQL) y referencias actualizadas; sección «Seguimiento de envíos (Fase 8)» en `07-referencia/trampas-conocidas.md`; 0013 y 0014 figuraban como pendientes de aplicar y el criterio como pendiente (la 0013 pasó a aplicada el 2026-11-17).
- [x] Aplicar la 0013 en producción (2026-11-17, antes del deploy, con el OK del usuario): `db push --remote=rbrntkztzijaxsnpgpqn --dry-run` listó solo la 0013 (la 0014 se sacó de `supabase/migrations/` durante el push y se devolvió después); aplicada con `db push --yes`, `schema_migrations` llega a `0013`. En producción: verificación `0013_notificaciones.sql` 18/18 (con `supabase db query --remote --read-only -f`) y simulación `rls-fase8-notificaciones.sql` 26/26, con la consulta de limpieza en 0 antes y después, `vault.secrets` igual (4 antes y después) y `notificaciones` sin filas. `pnpm db:tipos` difiere en 7 líneas de lo agregado a mano: el generador marca no nulas columnas que devuelven `alertas_*` y `reclamar_notificacion` (`cn`, `dias_restantes`, `nombre_titular`, `rut_titular`, `envio_id`, `folio`, `grupo`), porque Postgres no informa la nulabilidad de los retornos de funciones; se versionó lo generado, con typecheck, pruebas de alertas y Biome en verde (el código igual trata esos campos como posiblemente nulos). Advisors de seguridad sin avisos nuevos (la tabla tiene política de lectura y ninguna de las cinco funciones es ejecutable por `anon` ni `authenticated`; los avisos listados ya existían). Documentación pasada a «aplicada».
- [x] `CRON_SECRET` en Vercel *Production* (*Sensitive*), igual a `cron_token`, y deploy a *Production* con humo (2026-11-17): `3ade4c9` READY; `/` y `/ingresar` → 200; `/servicio/documentos` y `/servicio/envios/<id>` sin sesión → 307 a `/ingresar?siguiente=…`; `/_ds` → 404; `POST /api/cron/seguimiento` y `/api/cron/alertas` sin Bearer o con uno inválido → 401 (no 503: `CRON_SECRET` configurado). Con la sesión del propietario (Chrome, sin pulsar acciones): `/servicio/documentos` en certificación lista la boleta 41 (`Enviado`, $ 1.190) y el panel muestra Track ID 34015200, `REC · Recibido`, totales, líneas, descargas, «Consultar estado en el SII» y el reenvío deshabilitado con su motivo (sin correo del receptor); `/servicio/envios/<id>` muestra carátula (resolución N.º 0 del 06-11-2026, REST, emisión), estadísticas vacías, el documento y la bitácora vacía con su texto. Sin errores de consola ni de runtime en Vercel. Candidatos de alertas en producción: 0 rechazos, 0 inciertos y 0 certificados por vencer (el más próximo vence en 555 días), así que la primera corrida de `/api/cron/alertas` no envía correos.
- [x] Aplicar la 0014 en producción (2026-11-17, 18:31 UTC, con el OK del usuario): el `--dry-run` listó solo la 0014; aplicada con `db push --yes`. Verificación `0014_cron.sql` 12/12 con el MCP `execute_sql` como `postgres` (con `supabase db query --read-only` falla: la comprobación 9 descifra `cron_token` y ese rol no puede, `42501` en `_crypto_aead_det_decrypt`).
- [x] Verificar el cron en producción (2026-11-17): `seguimiento-envios` corrió 3 veces y `alertas` 1, todas `succeeded`; `net._http_response` con 200 en las dos rutas. La primera corrida de seguimiento (18:35) consultó el envío 34015200: `{"envios":1,"consultados":1,"cambiados":1,"errores":0}`, el SII respondió **EPR** (1 informado, 1 aceptado), el documento pasó a `aceptado` y la operación `seguimiento` quedó `ok`. Alertas: `correo: "configurado"`, 0 correos, `notificaciones` vacía. Monitores de Sentry `cron-seguimiento` y `cron-alertas` en `ok` (*Production*).
- [x] **Bug de Realtime encontrado al probar el criterio y corregido en el código** (2026-11-17, sin desplegar): con la página del envío abierta, el cambio de las 18:35 no llegó. En una carga completa, el canal se unía antes de que el cliente leyera la sesión de las cookies: el `phx_join` salía sin `access_token`, Realtime lo trataba como `anon` (sin SELECT sobre `envios`) y `realtime.subscription_check_filters` rechazaba la suscripción completa («invalid column for filter id»), sin reintentar al llegar el JWT; el error llegaba como mensaje `system` que nadie escuchaba, así que la UI no avisaba. Navegando dentro de la app sí funcionaba (la sesión ya estaba cargada). Afectaba a los tres `EnVivo` (Certificación, Folios y Documentos/Envíos). Arreglo: `lib/supabase/realtime.ts` (`suscribirEnVivo`) espera `realtime.setAuth()` antes de crear el canal y trata un `system` con `status: 'error'` como desconexión; los tres componentes lo usan. 7 pruebas nuevas; Vitest de la app 1064 (+1 omitida), typecheck, Biome, stylelint y build en verde. Para reproducir el fallo se hizo, con el OK del usuario, un `update envios set actualizado_en = now()` sobre el envío 34015200 (sin cambiar estado; no hay webhooks configurados). **Arreglo desplegado** (`b84a5b2`, deploy `326be87` READY) **y verificado en *Production*** (2026-11-17): con `/servicio/envios/<id>` en carga completa, `realtime.subscription` registra las dos suscripciones como `authenticated` a los 3 s; el mismo `update` (18:58:27) llegó como `postgres_changes` `envios UPDATE` en 0,33 s y la página pidió el refresco al servidor (`router.refresh()`) sin recargar.
- [x] **Criterio de aceptación cumplido** (2026-11-17, con el OK del usuario): desde `/servicio/emitir` en *Production*, boleta 39 de $ 1.190 en certificación, folio 42, Track ID 34017110 (operación `emitir` `ok`). Con `/servicio/envios/<id>` abierta desde una carga completa (suscripciones `authenticated` registradas a las 19:03:39 UTC), el cron de las 19:05 consultó el envío (operación `seguimiento` `ok`): EPR, 1 informado y 1 aceptado; el documento quedó `aceptado` y la página pasó, sin recargar, de «Enviado» / «REC · Recibido» / 0 consultas a «Aceptado» / «EPR · Envío procesado» / 1 consulta, con «Consultar estado en el SII» deshabilitado y su motivo. Sin errores de consola ni de runtime en Vercel, y sin patrones de secretos en `operaciones_sii` ni `consultas_envio`. Quedan 3 folios de certificación (43–45). El rechazo con el texto del design system queda cubierto por pruebas hasta que haya uno real.

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`, «Seguimiento de envíos (Fase 8)»): una operación `seguimiento` por grupo (empresa + ambiente + canal, porque los tokens REST y DTEWS son distintos) en vez de una por consulta, y `consultar_envio` desde el panel; un token por grupo con una sola renovación; lotes de 100 y un presupuesto de tiempo que no empieza nada cuyo peor caso pase del segundo 280; *backoff* sin migración por tramos de `envios.consultas` (4, 15 y 60 min, 6 h, y 24 h para los envíos de más de 7 días, con aviso `envio_sin_cerrar` a Sentry) como un `or()` de PostgREST, para que los envíos nuevos no queden con hambre; `inconsistente` se sigue consultando; lista blanca de los 10 estados de `estados_sii` (un código desconocido es una falla y no toca `estado_sii`); un EPR con rechazos o reparos sin detalle suficiente no se guarda (SOAP nunca trae detalle); nunca se pisa un estado final; orden de escritura estadísticas → rechazos → envío → bitácora (el inverso encola webhooks `documento.aceptado` falsos, probado en PGlite); `cerrarAbandonadas` cierra las filas en curso de más de 15 min; saneo del token en todo lo guardado. «Ya lo revisé» sin migración, con `marcarInciertaRevisada` sobre las operaciones del envío. Alertas deduplicadas en dos capas (`notificaciones` + `Idempotency-Key` estable guardada en `grupo`), con candidatos en la base por turnos entre organizaciones, ventana de 48 h, hasta 40 correos por corrida y solo `rechazado` (no reparos). Los jobs de `pg_cron` leen el Bearer de Vault en cada corrida. **Hallazgo de la documentación, sin corregir:** el aviso `envio_sin_cerrar` no sale en producción, porque `avisarSinCerrar` usa `deps.operacion.registrar`, que `resolverDependenciasSeguimiento` no define.

### Fase 9 — Tablero y reportes

1. Tablero como la plantilla: cifras del período (ventas netas, IVA débito, documentos emitidos por estado, esperando al SII) desde `v_ventas_diarias` y `documentos`; medidores de folios; últimos documentos; alertas de certificado y folios.
2. Exportación CSV/Excel de documentos del período y resumen diario por tipo.
3. Selector de período tributario y de ambiente.

**Criterio:** las cifras del tablero cuadran con una consulta SQL de control sobre `documentos` aceptados.

**Pendientes:**

- [x] Código y pruebas (2026-11-17): Tablero `app/[org]/tablero/` (selectores de empresa, ambiente y período en la URL con formulario GET; cifras, folios, últimos documentos, descargas; alertas de inciertos, certificados y folios; `EnVivo` con el canal `tablero`; `seguro` por sección), `server/tablero/` (`cifras.ts` puro y `lectura.ts` con `leerCifras`), `armarResumen` y `leerResumenFolios` en `server/folios/lectura.ts` (la página de Folios usa el mismo `armarResumen`), contrato `lib/reportes.ts`, ruta `app/[org]/reportes/exportar/route.ts` (`maxDuration = 60`) y `server/reportes/` (`filas`, `lectura`, `tabla`, `csv`, `xlsx`, `zip`), botones «Exportar CSV» y «Exportar Excel» en Documentos emitidos. Todo con la sesión (RLS), sin `service_role` ni escrituras. Sin migraciones nuevas. Typecheck, Vitest de la app 1149 (+1 omitida), Biome, stylelint y `pnpm build` en verde (después de las correcciones de la revisión).
- [x] Revisión de código: 5 hallazgos, todos corregidos (resumen diario de producción directo de `v_ventas_diarias` y de certificación boleta por boleta sin el set; medidor del Tablero con los mismos números que la alerta (`medidorFoliosTablero`: con un CAF, su rango real; con varios, un rango desde el primer folio del CAF en uso con el largo del total y la nota «Suma los folios de todos los CAF activos de este tipo»; la página de Folios no cambió); lectura de la exportación por *keyset* sobre `(fecha_emision, tipo_dte, folio, id)`, con 413 si el tope se supera durante la lectura y un solo `or()` anidado con la búsqueda (`condicionCursor`); `?empresa=` ajena → 404 «No encontramos esa empresa en esta organización…»; «Documentos emitidos» sin anulados, que la lista de Documentos sí muestra).
- [x] Consulta SQL de control `supabase/verificaciones/fase9-tablero-control.sql` (2026-11-17), corrida en producción en solo lectura para la organización `servicio`, empresa 20.630.500-2, certificación, noviembre de 2026: ventas netas $ 2.000, IVA $ 380, exento $ 0, total $ 2.380, 2 boletas aceptadas, 0 esperando al SII (las boletas 41 y 42 de las Fases 7 y 8).
- [x] `documentación/` de la fase (2026-11-17): guía `02-guias/tablero-y-reportes.md` (de dónde sale cada cifra, selectores, Realtime, alertas, fallas por sección, exportación con parámetros, formatos y códigos HTTP, consulta de control) en el índice; sección «Tablero y reportes (Fase 9)» en `07-referencia/trampas-conocidas.md`; referencias actualizadas en `README.md`, `seguimiento-envios.md`, `folios-caf.md`, `onboarding-organizacion.md`, `objetos-documentos.md`, `acceso-por-tabla.md`, `indice-operaciones.md`, `realtime-y-storage.md`, `design-system.md` y `probar-el-esquema.md` (§12). El criterio figura como pendiente.
- [x] Deploy a *Production* con humo (2026-11-17): `f5f8927` READY; `/` y `/ingresar` → 200; `/servicio/tablero` y `/servicio/reportes/exportar` sin sesión → 307 a `/ingresar?siguiente=…` conservando la ruta y la consulta; `/_ds` → 404. Con la sesión del propietario (Chrome), el Tablero en certificación y en producción (todo en 0, medidores sin folios, tabla vacía con su texto) sin errores de consola ni de runtime en Vercel.
- [x] **Criterio de aceptación cumplido** (2026-11-17): `/servicio/tablero` en *Production*, empresa 20.630.500-2, certificación, noviembre de 2026, muestra ventas netas $ 2.000, IVA débito $ 380, Documentos emitidos 2 («2 aceptados · 0 con reparos · 0 rechazados») y Esperando al SII 0; la consulta de control corrida en ese momento dio 2000 / 380 / exento 0 / total 2380 / 2 aceptadas / 2 emitidas (2 aceptadas, 0 con reparos, 0 rechazadas, 0 anuladas) / 0 enviadas. Medidor de la 39: 3 de 5 (41–45, `siguiente_folio = 43`).
- [x] Prueba de las descargas con sesión (2026-11-17, con `fetch` desde la página, sin guardar archivos): las 4 del Tablero y las 2 de Documentos emitidos → 200, `attachment` con nombre `boletas-20630500-2-certificacion-2026-11.csv|xlsx` y `resumen-diario-…`, `no-store`; CSV con BOM, `;` y CRLF (folios 41 y 42, Track ID 34015200 y 34017110; resumen con fila «Total;;2;;;2000;0;380;2380»); XLSX con las 6 partes, la hoja parsea y las fechas son series de Excel (46342 = 16-11-2026). En producción (sin boletas) los 4 responden 200 y el resumen sale de `v_ventas_diarias` con «Total» en 0. Errores: empresa ajena → 404, resumen con `periodo=todos` → 400, reporte o formato inválido → 400, con sus textos.
- [x] Abrir en Excel (2026-11-17, el usuario): el Excel de boletas del período se ve bien, con las 12 columnas (Tipo (código), Tipo, Folio, Fecha de emisión, RUT receptor, Razón social receptor, Neto, Exento, IVA, Total, Estado y Track ID) y sus datos. El resumen diario por tipo también se ve bien en Excel (y su CSV, revisado con `fetch`, cuadra con la consulta de control).

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`, «Tablero y reportes (Fase 9)»): sin migración. Las ventas salen de `v_ventas_diarias` menos los documentos del set de pruebas aceptados del período (solo en certificación), porque la vista no mira `origen` (el set solo existe en certificación) y cambiarla habría pedido una migración; las agregaciones de PostgREST están apagadas en el proyecto y sumar `documentos` en JS choca con el `max-rows` de 1.000. Los conteos por estado van con `count: 'exact', head: true` y los mismos filtros de Documentos emitidos (sin el set, sin documentos sin folio), para que «Ver todos» cuadre; «Documentos emitidos» no suma los anulados y los dice aparte. Folios con `armarResumen`, compartido con la página de Folios; el Tablero lee solo `cafs` y su medidor dibuja los mismos números que la alerta (rango sintético con varios CAF activos; exacto si son consecutivos). El período del Tablero es siempre un mes (sin «Todos los períodos»). Cada sección falla sola (`seguro`). La exportación es una ruta GET con `<a download>` y la sesión del usuario (cualquier miembro); CSV para Excel es-CL (UTF-8 con BOM, `;`, CRLF, fechas `DD-MM-AAAA`) con neutralización de fórmulas en las celdas de texto; XLSX propio sin dependencias (`inlineStr`, fechas reales, ZIP sobre `node:zlib`); tope de 50.000 filas con 413, lectura por *keyset*; el resumen diario sale de la vista en producción y de `documentos` sin el set en certificación (restar el set no corrige el rango de folios); una `empresa` ajena en la URL da 404.

### Fase 10 — Planes, suscripciones y cuotas

1. Grilla definitiva (D5) en `planes` con `0015_planes_comerciales`: `pyme`, `contador`, `api` y `empresa`; `emprendedor` con `activo = false`; Certificación sin plazo (sin `periodo_fin` al crear la organización); tabla `pagos` y `clientes_pago` (el `customerId` de Flow) en `0016_pagos`. Página de plan en Configuración con uso del mes (`uso_mensual`) y límites (empresas, usuarios, boletas, producción, API, webhooks).
2. Adaptador de pasarela (`server/pagos/`) con Flow (D4): planes de Flow con `planId = boleteame-<codigo>`, registro de tarjeta del cliente, alta y cambio de suscripción, callback (`token` → `getStatus`, idempotente) → `suscripciones` (`activa`, `morosa`, `cancelada`) y `pagos`. Gracia: `morosa` solo al agotarse los reintentos de Flow.
3. Comportamiento al exceder cuota o quedar `morosa`: los triggers ya lo aplican (bloqueo duro, D5); la UI avisa al 80 % y al 100 % del cupo de boletas y ofrece subir de plan antes de que el usuario choque con el error.

**Criterio:** cambiar de plan en *sandbox* de la pasarela actualiza `suscripciones` y los límites se aplican en la siguiente emisión.

Avance:

- [x] Decisiones D4 (Flow) y D5 (grilla y precios) (2026-11-17, §9).
- [x] Migraciones `0015_planes_comerciales`, `0016_pagos` y `0017_cron_suscripciones` escritas; verificaciones `0015_planes_comerciales.sql` (10), `0016_pagos.sql` (20) y `rls-fase10-pagos.sql` (30) en verde en PGlite, con las regresiones de las Fases 2 a 8 (`rls-fase2` 52/52, `rls-fase3` 43/43, `rls-fase4` 21/21, `rls-fase5-certificacion` 16/16, `rls-fase5-autorizacion-externa` 12/12, `rls-fase6` 27/27, `rls-fase7` 9/9, `rls-fase8` 26/26, `0004` 3/3) y la limpieza en 0 (§6). En PGlite no se puede probar que el `for no key update` no frene inserts concurrentes (una sola conexión). Al aplicar la 0017, la comprobación 10 de `0014_cron.sql` («ningún otro job llama a /api/cron») pasa a dar `false`: es lo esperado.
- [x] `server/pagos/`: cliente firmado de Flow (`flow.ts`), interfaz `Pasarela` (`pasarela.ts`) e implementación con Flow (`flow-pasarela.ts`: planes `boleteame-<codigo>` creados bajo demanda con `days_until_due = 7` y 3 reintentos, cliente, registro de tarjeta, suscripción, cambio de plan con prorrateo, cancelación al fin del período, estado de pagos), dominio (`suscripciones.ts`: contratar, retorno del registro, sincronizar, cambiar, cancelar, aviso de pago; idempotencia con `eventos_pasarela`), uso y lectura con RLS, mensajes de error y correo de mora (`avisos.ts`, plantilla `@sii/correos` `correoSuscripcionMorosa`).
- [x] Rutas: `/api/pagos/flow/registro` (retorno del navegador sin cookies → 303 a la página de plan), `/api/pagos/flow/confirmacion` (callback de los planes, 200 en < 15 s) y `/api/cron/suscripciones` (cada hora: mora, vuelta a Certificación tras cancelar, pagos y correo de mora).
- [x] `/[org]/configuracion/plan`: plan vigente, uso del mes con aviso al 80 % y 100 %, grilla con contratar (Flow), cambiar (prorrateo de Flow en `Dialogo`) y cancelar; tarjeta e historial de pagos para administradores. Enlace en Configuración.
- [x] Avisos antes del error: Emitir bloquea producción con el cupo lleno y avisa al 80 %; «plan sin producción» explica el pago vencido y enlaza al plan; Equipo avisa si no hay plan vigente (Empresas ya lo hacía).
- [x] Sentry: la firma `s` de las URL GET de Flow se filtra (la `apiKey` ya se filtraba).
- [x] El `urlCallback` de los planes de Flow es siempre la URL pública https (`https://boleteame.dev` si la app corre en local): Flow lo fija al crear el plan y no deja cambiarlo con suscriptores; `asegurarPlan` intenta corregir uno sin suscriptores.
- [x] Pruebas (2026-11-17): Vitest de la app 1321 (+1 omitida, previa) con `flow`, `flow-pasarela`, `suscripciones` (base en memoria con los únicos y `activar_suscripcion` de la 0016), `avisos`, `lib/planes`, `token` y las tres rutas; correos 67; typecheck, Biome, stylelint y build en verde. La revisión encontró y se corrigió un caso: si Flow ya cambió el plan y solo falla la lectura posterior, ya no se informa como falla (se evitaba un segundo `changePlan` con su cobro).
- [x] `documentación/` de la fase (2026-11-17): guía nueva `02-guias/planes-y-pagos.md` (grilla, contratación, cambio y cancelación, mora, callback, cron, cuotas, variables y prueba en sandbox) en el índice; sección «Pagos y suscripciones (Fase 10)» en `07-referencia/trampas-conocidas.md`; referencias actualizadas en `tenancy-y-roles.md`, `ambientes-y-credenciales.md`, `onboarding-organizacion.md`, `rpc-backend.md`, `rpc-organizacion.md`, `acceso-por-tabla.md`, `indice-operaciones.md`, `objetos-tenancy.md`, `codigos-y-enumeraciones.md`, `probar-el-esquema.md` (§13), `checklist-produccion.md`, `despliegue.md`, `rls-y-privilegios.md` y `arquitectura.md`; `apps/web/.env.example` con `FLOW_*`. Lo de producción figura como pendiente.
- [x] Credenciales de Flow **sandbox** en `.env.local` y en Vercel *Production* (2026-11-18, el usuario; `FLOW_API_KEY` y `FLOW_SECRET_KEY` *sensitive*, `FLOW_API_URL=https://sandbox.flow.cl/api`).
- [x] `0015` y `0016` aplicadas en producción (2026-11-18, 17:02 UTC; antes del deploy): verificaciones 10/10 y 20/20, simulación `rls-fase10-pagos` 30/30 y `rls-fase2-tenancy` 52/52 con limpieza en 0; tipos regenerados con `pnpm db:tipos` (sin diferencias de contenido); *Advisors* revisados (§6). La suscripción de `servicio` quedó en Certificación sin `periodo_fin`.
- [x] Deploy a *Production* (2026-11-18): `9d2fd8b` READY, creado después de las variables `FLOW_*`; humo sin sesión: `/` 200, `/servicio/configuracion/plan` 307 a `/ingresar?siguiente=…`, `/api/pagos/flow/registro` sin token 303 a `/bienvenida`, `/api/pagos/flow/confirmacion` sin token 400, `/api/cron/suscripciones` sin Bearer 401. Con sesión, la página de plan muestra la grilla con los botones de contratar (Flow configurado). `0017` aplicada después del deploy (dry-run solo con la 0017): job `sincronizar-suscripciones` activo, `41 * * * *`, URL de producción, Bearer leído de Vault, timeout 120 s. Corridas de las 17:41, 18:41, 19:41 y 20:41 UTC en `succeeded`; la ruta respondió 200 `{revisadas: 0, …, avisos: {candidatas: 0, correoConfigurado: true}}` (aún no hay suscripciones de Flow). Sin errores de runtime salvo el rechazo de Flow del criterio.
- [x] Cuenta de Flow: el primer intento (2026-11-18, 17:28 UTC) falló con `Commerce has not automatic charge contract` (la cuenta sandbox no tenía cargos automáticos; Flow ya había creado el plan `boleteame-pyme` —14.990, 7 días, 3 reintentos, callback `https://boleteame.dev/api/pagos/flow/confirmacion`— y el cliente; la organización siguió en Certificación). El usuario los habilitó.
- [x] **Criterio de aceptación cumplido** (2026-11-18, en *Production* con Flow sandbox, organización `servicio`): contratar Pyme desde `/servicio/configuracion/plan` llevó a Flow a registrar la tarjeta (la ingresó el usuario: tarjeta de prueba, Visa terminada en 6623) y volvió con `?pago=suscrita`: Certificación `cancelada` y Pyme `activa` con `proveedor_pago = flow`, período 18-11 al 17-12, pago de $ 14.990 `pagado`, evento `registro` `procesado` y `plan_vigente` = Pyme (1.000 boletas, producción). Cambiar a Contador desde la UI mostró el prorrateo de Flow ($ 35.000 ahora, próximo cobro 18-12-2026) y, al confirmar, la misma suscripción de Flow quedó en Contador: `plan_vigente` = Contador (10.000 boletas, 15 empresas, 10 usuarios), que es lo que leen los triggers de cupos en la siguiente emisión (comprobado con emisiones reales en `rls-fase10-pagos.sql`: con Pyme la boleta 1.001 se rechaza y con Contador entra). Segundo pago de $ 35.000 `pagado`. El callback de Flow llegó a producción (evento `pago` `procesado`, orden 11777257).
- [x] Hallazgos de la prueba, corregidos y desplegados (`a1f74eb`, 2026-11-18; verificado con una sincronización manual de `/api/cron/suscripciones`, `revisadas: 1`, `errores: 0`: los dos pagos quedaron con fecha, «Cargo automático» y su orden de Flow, 11777257 y 11777279): (1) los importes de `subscription/get` vienen sin `payment`, así que los pagos quedaban sin fecha ni medio (la tabla decía «Vence el …»): ahora `completarFacturas` los completa con `invoice/get` una sola vez y nunca borra una fecha ya guardada; (2) la orden de comercio de Flow es `sus_<id>_<importe>_<fecha hora>`, no un número: el aviso quedaba `sin_asociar` y sincronizaba todas las vigentes; ahora `suscripcionDeOrden` la lee. Antes: el mensaje del contrato faltante ya no culpa a la tarjeta y la barra de boletas no sale roja con cupo 0. Vitest de la app 1333 (+1 omitida), typecheck, Biome y stylelint en verde.
- La organización `servicio` queda **a propósito** con la suscripción de Flow sandbox `sus_l78a6791ff` (decisión del usuario, 2026-11-18; desde el 2026-11-19 en el plan **API**, cambiado para el criterio de la Fase 11, con el próximo cobro el 19-12-2026): Flow sandbox hará el cargo de prueba de la renovación y servirá para ver una renovación real por el callback y el cron. Al pasar Flow a producción hay que cancelarla (las credenciales y los planes de sandbox no existen en producción).
- Pendientes conocidos fuera del criterio: cambiar la tarjeta registrada; emitir la boleta propia de Boletéame por cada cobro (cumplimiento tributario del SaaS, antes del lanzamiento, Fase 13).

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

Avance:

- [x] Diseño (2026-11-18): decisiones en `documentación/07-referencia/trampas-conocidas.md` («API pública y webhooks (Fase 11)») y guía `documentación/02-guias/api-publica.md`. Idempotencia en una tabla propia (`api_idempotencia`) y no en `documentos.metadata`, que la emisión reescribe; la API reutiliza `emitirDocumento` con `usuarioId: null` + `apiKeyId` (sin `getUser()`; la autoridad es la clave); `crear_api_key` y `crear_webhook` siguen con la sesión, tras `confirmarSesion()`; `certificacion:gestionar` queda reservado (sin rutas ni UI); sin autodesactivación de webhooks; *rate limiting* solo con el Firewall de Vercel.
- [x] Contrato `lib/api-publica.ts` (alcances, eventos, códigos y mensajes de error, formas de respuesta, `validarUrlWebhook`, espejo del check de la 0018) y tipos de la 0018 agregados a mano en `server/supabase/tipos.ts`.
- [x] Migraciones `0018_api_webhooks` y `0019_cron_webhooks` con verificaciones y simulación `rls-fase11-api.sql`, probadas en PGlite (§6).
- [x] API `/api/v1` (`server/api-publica/`, 9 rutas): `POST /documentos` (`Idempotency-Key` obligatoria; 201 / 202 incierto / 422 `rechazado_por_sii`; repetición con `Idempotent-Replayed: true`; `?ensayo=1`), `POST /documentos/lote` (hasta 25, emisiones independientes, no empieza una boleta después de 200 s), `GET /documentos` (cursor), `GET /documentos/{id}`, `/xml`, `/pdf` (stream), `GET /folios`, `POST /folios/solicitudes` (producción con revisión obligatoria), `GET /envios/{id}`. Cambios mínimos en `server/emision` (origen `api`, borrador con service_role filtrado por organización, `clave_idempotencia`) y `server/folios` (`ContextoFoliosApi`); Sentry filtra `sk_…` y `whsec_…`.
- [x] Entrega de webhooks (`server/webhooks/`, `/api/cron/webhooks`, monitor `cron-webhooks`): 32 por corrida, 8 en paralelo, 10 s por entrega, presupuesto de 45 s; `Boleteame-Firma: t=<unix>,v1=<hex HMAC-SHA256("t.cuerpo")>`; SSRF con `node:https` y `lookup` que fija la IP validada (rangos privados IPv4, IPv6 y mapeadas), sin redirecciones; respuesta guardada truncada y depurada.
- [x] UI: `/[org]/configuracion/api` (crear con la clave visible una vez, revocar) y `/[org]/configuracion/webhooks` (+ `[id]`: editar, pausar, borrar, enviar prueba, rotar secreto, historial con reenvío), solo administradores, con aviso si el plan no incluye API o webhooks.
- [x] OpenAPI 3.1 (`lib/openapi-v1.ts`, `/api/v1/openapi.json`), página pública `/docs/api`, cliente de ejemplo `scripts/ejemplo-api/` (`emitir.mjs`, `receptor.mjs`, `verificar-firma.mjs`, comparado con `server/webhooks/firma.ts` en pruebas), `e2e/api-publica.spec.ts` (solo lectura, sin ejecutar).
- [x] `documentación/` de la fase: guía nueva `02-guias/api-publica.md`; `06-integraciones/overview.md`, `api-keys.md` y `webhooks.md`; referencias de RPC, objetos, RLS, Vault, despliegue, pruebas, códigos, límites, ejemplos, checklist y trampas.
- [x] Verificación local (2026-11-19): typecheck, Vitest de la app 1597 (+1 omitida), correos 67, Biome, stylelint y `pnpm build` en verde.
- [x] Revisión de código: sin hallazgos críticos ni altos; 8 medios o bajos, todos corregidos (mensaje único del 422 `rechazado_por_sii`; revocar una clave es irreversible; `cerrar_entrega_webhook` con `p_intento` para que un reenvío no quede pisado; `Content-Length` no se reenvía con `content-encoding`; el timbraje de folios no se repite si falla el guardado de la respuesta; motivos de negocio de la emisión en 409/403 y no 500, con los `error_interno` a Sentry; limpieza de `api_idempotencia`; OpenAPI y guía alineados con el comportamiento: 429 del Firewall sin JSON, 200 s del lote, códigos faltantes, detalle sin el set de pruebas).
- [x] Aplicar la 0018 en producción (2026-11-19, 03:40 UTC, con el OK del usuario): verificación previa 2/23; con la 0019 fuera de la carpeta, el `--dry-run` listó solo la 0018 (los dos primeros intentos fallaron por red del CLI); `db push --yes`. Verificación 23/23, simulación `rls-fase11-api.sql` 39/39 con la limpieza en 0 antes y después, regresiones `rls-fase8-notificaciones` 26/26 y `rls-fase10-pagos` 30/30, verificaciones `0013` 18/18 y `0016` 20/20. `pnpm db:tipos` difiere en 9 líneas de nulabilidad (retornos de `autenticar_api_key` y `reclamar_idempotencia`, como en la Fase 8); se versionó lo generado, con typecheck y Vitest (1597) en verde. *Advisors*: solo lo esperado (`api_idempotencia` sin políticas; `probar_webhook`, `reenviar_entrega_webhook` y `rotar_secreto_webhook` ejecutables por `authenticated`, que revisan `es_admin`).
- [x] Deploy a *Production* (2026-11-19): `169e2e5` READY; humo: `/api/v1/documentos` sin clave → 401 `no_autenticado` y con una clave bien formada inexistente → 401 `clave_invalida` (la RPC `autenticar_api_key` responde); `/api/v1/openapi.json` y `/docs/api` → 200; `POST /api/cron/webhooks` sin Bearer → 401; `/servicio/configuracion/api` y `/webhooks` sin sesión → 307 a `/ingresar?siguiente=…`. Sin errores de runtime en Vercel.
- [x] Aplicar la 0019 después del deploy (2026-11-19, 03:54 UTC, con el OK del usuario): el `--dry-run` listó solo la 0019; `db push --yes`. Verificación `0019_cron_webhooks.sql` 9/9 con el MCP `execute_sql` como `postgres`. Primera corrida de `entregar-webhooks` (03:55) `succeeded`, `net._http_response` 200 `{reclamadas: 0, entregadas: 0, fallidas: 0, descartadas: 0, postergadas: 0, errores: 0}`; monitor `cron-webhooks` de Sentry en `ok` (*Production*).
- [x] Regla del Firewall de Vercel para `/api/v1/*` (2026-11-19, con el OK del usuario): el proyecto no tenía configuración de Firewall (el MCP responde 404 `Seawall Config not found` y no puede crear la primera regla), así que se creó con el CLI (`vercel firewall rules add` + `publish --confirm-name sii`): regla «API pública: límite por IP», ruta que empieza con `/api/v1/`, *rate limit* de ventana fija de 60 s, 120 peticiones por IP, 429 al excederlo. Firewall `Enabled`, 1 regla activa; la API sigue respondiendo (401 sin clave, OpenAPI 200).
- [x] **Criterio de aceptación cumplido** (2026-11-19, en *Production*, con el OK del usuario en cada paso que deja huella). Decidido por el usuario: `servicio` pasa a API por la UI con Flow sandbox y el receptor se expone con un túnel rápido de `cloudflared` desde su equipo.
  - **Plan:** desde `/servicio/configuracion/plan`, cambio de Contador a API con el prorrateo de Flow (saldo a favor de $ 8.334, próximo cobro 19-12-2026): API `activa`, período 19-11 al 18-12-2026, cupos de 20.000 boletas, 3 empresas y 5 usuarios. `servicio` queda en API (la suscripción de Flow sandbox `sus_l78a6791ff` es la misma).
  - **Preparación:** clave `sk_test_fba8…` «Prueba criterio Fase 11» desde Configuración → API (empresa 20.630.500-2, `documentos:leer`, `documentos:emitir`, `envios:leer`, 30 días); túnel `https://…trycloudflare.com` al puerto 3000 con `receptor.mjs`; webhook con los cuatro `documento.*` y `envio.actualizado`. La clave y el secreto se copiaron del portapapeles a archivos temporales sin mostrarse y se borraron al terminar. «Enviar prueba»: `webhook.prueba` entregado a las 04:07:01 UTC con **firma válida** (entrega 17, 200).
  - **Emisión e idempotencia:** `emitir.mjs --clave=criterio-fase11-20261119-01`: 201, documento `75fa0e6a-…`, boleta 39 folio 43, Track ID 34120364; la repetición con la misma clave dio 201 con el mismo documento y folio e `Idempotent-Replayed: true`. En la base: un solo documento con esa clave, `origen = api`; `siguiente_folio = 44`; una sola operación `emitir` `ok` con `api_key_id` y `usuario_id` nulo; `api_idempotencia` `terminada`/201; ningún folio anulado.
  - **Webhook firmado:** el seguimiento dejó el envío en **EPR** (1 aceptado, 0 rechazos, 0 reparos) y la boleta `aceptada`; el receptor recibió `documento.aceptado` del folio 43 a las 04:11:01 UTC con **firma válida** (entrega 19, intento 1, 200), además de dos `envio.actualizado` (entregas 18 y 20), todas `entregado` al primer intento.
  - **Limpieza:** webhook pausado (sin entregas en cola), clave revocada (la API responde 401 `clave_revocada`), túnel y receptor detenidos. Quedan 2 folios de certificación (44–45).
- Pendientes conocidos fuera del criterio: agrupar varias boletas en un solo EnvioBOLETA en el lote (decisión pendiente); encolar `certificado.por_vencer` (necesita deduplicación propia); `/xml` y `/pdf` todavía sirven boletas del set de pruebas (el detalle ya no).

### Fase 12 — Sitio público

1. Landing según la plantilla «Landing» (hero, ciclo del documento, certificación paso a paso, API, precios con la grilla de D5, llamado a empezar por la certificación). Textos ajustados a boleta mientras no exista la Fase 14 (sin prometer factura ni Libro de Compras y Ventas).
2. Términos, privacidad (tratamiento de certificados y datos tributarios), página de estado/soporte.
3. SEO: metadatos, `sitemap.ts`, `robots.ts`, imágenes OG.
4. Formulario de contacto con Turnstile verificado en el servidor y correo por Resend.

**Criterio:** el sitio público pasa axe en claro, oscuro y móvil en *Production*, los precios coinciden con `planes`, y un mensaje del formulario de contacto llega a `CORREO_CONTACTO` con Turnstile verificado en el servidor. (Agregado el 2026-11-19: la fase no traía criterio.)

Avance:

- [x] Landing y layout (2026-11-19): grupo `app/(publico)/` con cabecera (menú móvil con `aria-expanded` y Escape), pie con la leyenda de independencia del SII y «Saltar al contenido»; landing sobre la plantilla «Landing», estática con `revalidate = 3600`, con los precios leídos de `planes` como `anon` sin cookies (`clientePublico()`) y un respaldo comparado en pruebas con la `0015`; pasos de certificación y ejemplo de la API atados al código por pruebas; solo boletas 39 y 41. `app/page.tsx` reemplazado por `(publico)/page.tsx`.
- [x] Legal, ayuda y estado: `/legal`, `/legal/terminos` y `/legal/privacidad` (Ley 19.628 y 21.719, con los encargados reales) con los datos del responsable en `lib/legal.ts` y texto neutro mientras falten; `/ayuda` con preguntas frecuentes en `<details>` nativos (un componente cliente abre la del hash, p. ej. `#por-verificar`); `/estado` (`revalidate = 60`) con niveles por componente a partir de agregados de `service_role` (conteos `head` y una fecha, nunca filas), que muestra solo niveles (sin horas de actividad), mide el seguimiento por la última corrida `ok` del cron y no da «Todo funciona» sin medir la base; sin migraciones.
- [x] Contacto: `/contacto` con `?motivo=`, honeypot, zod, Turnstile verificado en el servidor con la IP, que falla cerrado en producción y exige `action` y (en producción) `hostname`, un solo correo por Resend a `CORREO_CONTACTO` con `reply_to` (sin acuse a la persona), `Idempotency-Key` por destinatario y contenido con el correo normalizado, y sin datos de la persona en logs ni Sentry; plantilla `correoContacto` en `@sii/correos`; `CORREO_CONTACTO` en `env.ts` y `.env.example`.
- [x] SEO: `metadataBase` desde `NEXT_PUBLIC_APP_URL` (`lib/sitio.ts`), plantilla `%s · Boletéame` (se quitó la marca de los títulos existentes), canónica `./`, `noindex` en la app, el onboarding, las invitaciones y recuperar/restablecer; `robots.ts`, `sitemap.ts`, `manifest.ts`, imágenes OG y Twitter, `icon.svg` y `apple-icon` con los colores de `tokens.json`; JSON-LD en la landing. Rutas públicas y de metadatos en `lib/rutas.ts`, con sus slugs reservados.
- [x] `documentación/` de la fase: guía nueva `02-guias/sitio-publico.md` en el índice; sección «Sitio público (Fase 12)» en `07-referencia/trampas-conocidas.md` y en `checklist-produccion.md`; referencias en `design-system.md`, `despliegue.md`, `ambientes-y-credenciales.md`, `vision-general.md` y `rls-y-privilegios.md`.
- [x] Revisión de código: sin críticos ni altos; 4 medios y 7 bajos; corregidos todos menos los datos de `RESPONSABLE` (los entrega el usuario) y los slugs en la base (Fase 13).
- [x] Verificación local (2026-11-19, después de las correcciones de la revisión): typecheck, Vitest de la app 1767 (+1 omitida) en 133 archivos, correos 77 en 9 archivos, Biome, stylelint y `pnpm build` en verde; `e2e/sitio-publico.spec.ts` ampliado a contacto, ayuda, estado y legales, corrido contra un `next dev` propio: 71 pasan y 19 se omiten por proyecto. El primer intento falló contra un `next dev` que otro agente dejó abierto (recargas en bucle); con un servidor limpio, `/contacto` no llegaba a `networkidle` por las conexiones del widget de Turnstile, así que la prueba espera `load` y el `main`, y axe excluye el iframe de Cloudflare.
- [x] Deploy a *Production* con humo (2026-11-19): `fb0f6cf` READY, creado después de `CORREO_CONTACTO`. Sin sesión, `/`, `/ayuda`, `/estado`, `/contacto` (también con `?motivo=ventas`), `/legal`, `/legal/terminos`, `/legal/privacidad`, `/docs/api`, `/ingresar`, `/crear-cuenta`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/opengraph-image`, `/twitter-image`, `/apple-icon` e `/icon.svg` → 200; `/servicio/tablero`, `/acme/legal` y `/acme/opengraph-image` → 307 a `/ingresar?siguiente=…`; `/api/v1/documentos` sin clave → 401; `/favicon.ico` → 404 (esperado, no hay). Sitemap, `robots.txt`, canónica y `og:url` con `https://boleteame.dev`; JSON-LD presente; precios de la landing $ 14.990, $ 49.990 y $ 39.990, iguales a `planes`; `/estado` con la base «Operativo» y el SII «Sin datos» (sin operaciones en la última hora), sin horas de actividad. `E2E_URL=https://boleteame.dev` (`despliegue.spec.ts`): 10 pasan, 2 omitidas. `e2e/sitio-publico.spec.ts` contra *Production* (configuración temporal, solo lectura, sin enviar el formulario): 71 pasan, 19 omitidas por proyecto (axe en claro, oscuro y móvil en las 6 páginas). Sin errores de runtime en Vercel.
- [x] `CORREO_CONTACTO` en Vercel *Production* (2026-11-19, el usuario; el buzón personal del usuario, sin recepción de correo en `boleteame.dev`; un `contacto@boleteame.dev` público queda para después: Resend Inbound con reenvío propio o una casilla real).
- [x] (2026-11-19, con el OK del usuario: regla «Server Actions: límite por IP» creada con `vercel firewall rules add` y publicada con `publish --confirm-name sii --effects-digest …`; condiciones método `POST` **y** cabecera `next-action` presente, *rate limit* de ventana fija de 60 s, 60 peticiones por IP, 429 al excederlo; queda `live` junto a la de `/api/v1/*`; el sitio y la API siguen respondiendo 200/401. No se probó el límite con una ráfaga para no generar ruido en producción) Regla de *rate limit* del Firewall de Vercel, por IP, para los POST con cabecera `Next-Action` (o todos los POST de páginas): Next 16 ejecuta una Server Action desde cualquier ruta, así que «POST a `/contacto`» no basta.
- [x] Datos de `RESPONSABLE` en `lib/legal.ts` (2026-11-19, entregados por el usuario): titular persona natural, con nombre, RUT y domicilio. Los dos correos quedan en `null` a propósito (`boleteame.dev` no recibe correo y `CORREO_CONTACTO` es personal y no se publica): las páginas llevan al formulario, y el canal de privacidad a `/contacto?motivo=privacidad`. `legal.test.ts` exige nombre, RUT válido y domicilio, y que el motivo exista en el formulario. Desplegado (`0dd46a3`) y verificado en *Production*: términos y privacidad identifican al titular, los 3 enlaces de privacidad van a `/contacto?motivo=privacidad` y el formulario abre con ese motivo elegido.
- [ ] Revisión legal de términos y privacidad por un abogado, antes del lanzamiento. Puntos preparados en `documentación/07-referencia/revision-legal.md`.
- [x] **Criterio de aceptación cumplido** (2026-11-19, en *Production*): axe sin violaciones en claro, oscuro y móvil en `/`, `/contacto`, `/ayuda`, `/estado`, `/legal/terminos` y `/legal/privacidad` (`e2e/sitio-publico.spec.ts` contra `https://boleteame.dev`, 71 pasan); precios de la landing ($ 14.990, $ 49.990 y $ 39.990) iguales a `planes`; el usuario envió un mensaje real desde `/contacto` (Turnstile resuelto en el navegador y verificado en el servidor, que en producción exige `action` y `hostname`) y lo recibió en el buzón de `CORREO_CONTACTO`. Sin errores de runtime en Vercel ni *issues* nuevos en Sentry; la acción no dejó logs (no registra nada cuando el envío sale bien). La clave de Resend de `.env.local` es de solo envío (`restricted_api_key`), así que el registro del envío no se revisó por la API.

Decisiones tomadas en la fase (detalle en `documentación/07-referencia/trampas-conocidas.md`, «Sitio público (Fase 12)»): sin migraciones. La landing es estática y lee `planes` con un cliente anónimo sin cookies (con el de sesión sería dinámica), con precios de respaldo y aviso a Sentry si la lectura falla. `/estado` usa `service_role` porque las tablas tienen RLS por organización, pero devuelve solo niveles (sin conteos ni horas de actividad) y nunca lanza; el seguimiento se mide por la última corrida `ok` del cron (el atrasado de un cliente puntual no marca demora global) y el resumen no cuenta la fila Plataforma; `operaciones_sii` no tiene índice por fecha, aceptable con 7 lecturas por minuto (índice para la Fase 13). El contacto no manda acuse a la persona (para no ser *relay* de spam con el remitente de Auth), Turnstile falla cerrado en producción, el honeypot responde éxito y el mensaje no se guarda ni se registra. Textos legales con texto neutro mientras falten los datos del responsable. Canónica `./` (con `/` todas apuntarían a la landing) y plantilla de título, que obligó a quitar « · Boletéame» de los títulos. Las imágenes generadas se sirven sin extensión y van en `PUBLICAS_EXACTAS`; toda ruta pública de primer nivel tiene su slug reservado (una prueba lee las carpetas reales de `src/app`), pero solo en la app: `crear_organizacion` no los conoce (migración pendiente para la Fase 13). Imágenes OG con la fuente por defecto de `next/og` (IBM Plex no cabe en el límite del paquete). Los términos prometen una boleta por cada cobro, que queda para la Fase 13.

### Fase 13 — Endurecimiento y lanzamiento

1. Revisión de seguridad: RLS (simulación de roles por tabla según `acceso-por-tabla`, en transacciones con `rollback`), que ninguna ruta use `service_role` sin filtrar por organización, cabeceras (CSP con Turnstile y Sentry, HSTS), `server-only` en todo `server/`. Además, que toda operación ⚠️ (y la creación de API keys y webhooks) confirme la sesión con `getUser()` antes de ejecutar.
   - Retiro definitivo de las claves legadas: con las legadas desactivadas desde el 2026-11-13 y sin incidentes, revocar la clave HS256 *Previously used* en *Settings → JWT Keys* (antes, confirmar en `edge_logs` que nadie usa claves sin prefijo `sb_`).
2. Pruebas e2e con Playwright de los flujos críticos: registro → organización → empresa → certificado → certificación (con SII falso) → folios → emisión → seguimiento.
3. Respaldo: PITR de Supabase; procedimiento de restauración probado; rotación de `SII_TOKENS_KEY` documentada.
4. Observabilidad: tableros y alertas de Sentry de §4.8; *runbook* para `incierto`, caída del SII y CAF agotado.
5. `documentación/07-referencia/checklist-produccion.md` completo y ejecutado.
   - Slugs reservados también en la base (pendiente de la Fase 12): `crear_organizacion` no conoce `SLUGS_RESERVADOS` de `lib/rutas.ts`; una migración debe validar la misma lista (y revisar antes que ninguna organización existente use uno).
6. **Piloto:** primero la empresa ya autorizada del piloto de `certificacion-node` (CAF de producción, tipo 39), después 3–5 clientes en producción durante dos semanas con seguimiento diario, igual que la Fase 8 del plan de la librería.

**Criterio:** dos semanas de piloto sin incidentes de seguridad y con todas las boletas EPR o explicadas.

Avance:

- [x] Revisión de seguridad del código (2026-11-19). `import 'server-only'` en todo `src/server/` (faltaba en 30 archivos), con la prueba `server/server-only.test.ts`. Hubo que mover a `src/lib/` cuatro módulos que importan componentes cliente: `equipo-errores`, `documentos-presentacion`, `integraciones-presentacion` y `certificados-estado`. `confirmarSesion` (`getUser()`) quedó también en las acciones de equipo (invitar, reenviar, cambiar rol, quitar), en el plan (antes iba a mano y sin try/catch) y en «marcar como revisada» una operación incierta, de certificación, folios y documentos, porque desbloquea un reintento. Las demás operaciones ⚠️ ya la tenían, y se agregó la prueba que faltaba de anular. `service_role` auditado en los 10 módulos que lo crean, sin fallas: `/api/v1` filtra por la organización de la clave, ambiente y empresa; crons, `/estado` y webhooks son globales por diseño. Lo vigilan `supabase/service.test.ts` (lista cerrada de módulos) y `api-publica/repositorio.test.ts`. Cabeceras en `lib/cabeceras-seguridad.ts`: HSTS de 2 años con `includeSubDomains` y sin `preload` (`.dev` ya está precargado), `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`. La CSP va en **Report-Only**, con reportes a Sentry. Lleva `'unsafe-inline'` en `script-src` sin nonce, porque un nonce dejaría dinámicas la landing, los textos legales y las imágenes OG; Turnstile, Supabase y el túnel de Sentry están permitidos y `frame-ancestors 'none'`. zod va con `jitless: true` para no necesitar `eval`. Sin violaciones en 9 páginas públicas con `next start`.
- [x] Umbrales de los *cron monitors* en el código (`conMonitorCron`): issue a la 3.ª falla seguida en webhooks, a la 2.ª en seguimiento y a la 1.ª en alertas y suscripciones; recuperación a la 1.ª. Van en el código porque el SDK reescribe en cada check-in lo que se configure en la UI.
- [x] Simulación RLS por tabla y rol (2026-11-19): `supabase/verificaciones/rls-fase13-acceso-por-tabla.sql` cubre 39 tablas y 4 vistas con 7 roles y da **52/52** en producción, con limpieza en 0. Las 3 discrepancias estaban en el documento, no en las políticas, y se corrigieron en `acceso-por-tabla.md`: eran 39 tablas con RLS y no 37, `api_keys.expira_en` no se puede editar desde la 0018, y faltaba el párrafo de privilegios.
- [x] Migración `0020_endurecimiento` escrita y probada con `rollback` (ver §6). Cubre los slugs reservados en la base (ninguna organización existente usa uno), los índices de FK, los índices de `operaciones_sii` y el EXECUTE de `tg_api_key_sin_reactivar`.
- [x] `0020` aplicada (2026-11-20, 01:23 UTC). Respaldo diario previo del 19-11 a las 10:11 UTC; `--dry-run` con solo la 0020; verificación 9/9 (2/9 antes); en los *advisors* desapareció `unindexed_foreign_keys` y los índices nuevos salen como `unused_index`, lo esperado; `pnpm db:tipos` sin cambios; la app sigue respondiendo 200.
- [x] Claves legadas (2026-11-19, `edge_logs` del 13 al 19-11): ningún cliente usa claves sin prefijo `sb_`. Los únicos JWT HS256 son llamadas internas de Supabase (`/admin/v1/*`, `@supabase-infra/mgmt-api`).
- [x] Clave HS256 legada revocada (2026-11-20, ~01:47 UTC, por el usuario en *Settings → JWT Keys*, sin borrarla).
  - Antes: `edge_logs` de 24 h sin clientes con claves legadas; los jobs de pg_cron no llaman a Supabase con un JWT; no hay Edge Functions; las URL firmadas de Storage ya salían con ES256.
  - Después: Storage firma con ES256 y descarga el PDF de la boleta 43; PostgREST responde con la clave secreta; el JWKS publica solo la ES256; el panel con sesión funciona (tablero, documentos, folios, equipo y envío) y Realtime conecta (101).
  - En `edge_logs` desde las 01:44, todo 200 o 101 y 0 respuestas 401. Las llamadas `/admin/v1` de la plataforma con HS256 respondieron 200.
  - Si algo falla, la clave revocada se puede volver a *standby* y rotar; solo borrarla es irreversible.
- [x] e2e del flujo crítico (2026-11-19): `e2e/flujo-critico.spec.ts`, que corre con `E2E_FLUJO=1` y su propio `next dev`, pasó 3 de 3 veces. Recorre registro, organización, empresa, `.pfx` de prueba, los 5 pasos de certificación, folios, emisión y seguimiento hasta «Aceptado», contra un simulador del SII que se activa con `E2E_SII_FALSO_URL` (`server/sii/sii-falso.ts`). El simulador se ignora en Vercel, lanza error con `NODE_ENV=production` y solo acepta loopback. Ninguna petición salió al SII real. Los datos de prueba (`e2e-flujo-…`) se limpian antes y después, y quedaron en 0. Guía en `documentación/05-pruebas/e2e-flujo-critico.md`. Rechazos, reparos e `incierto` siguen cubiertos solo por Vitest.
- [x] Bug destapado por la e2e: `descargarSet` (`server/certificacion/set.ts`) devolvía `conSesionSii(…)` sin `await` dentro de `await using transporte`. El transporte se cerraba antes de las peticiones y «Descargar el set» fallaba con «El transporte HTTP ya se cerró». Se arregló con `return await`, y no hay otro caso igual en `server/`.
- [x] Respaldo documentado en `documentación/07-referencia/respaldo-y-restauracion.md`: **PITR está apagado** (`pitr_enabled: false`); solo hay respaldos diarios de 7 días y Storage no entra en ellos. También documenta los peligros de restaurar en el mismo proyecto (`siguiente_folio` retrocede, se pierde `api_idempotencia`), el simulacro a un proyecto nuevo (que obliga a desactivar pg_cron) y la rotación de `SII_TOKENS_KEY`, que no causa caída pero exige cambiar Vercel y `.env.local` a la vez.
- [ ] Activar PITR, probar una restauración a un proyecto nuevo y decidir cómo respaldar Storage (`documentos-xml`). Lo hace el usuario.
- [x] Observabilidad: inventario de Sentry en `documentación/07-referencia/observabilidad-sentry.md`. Están los 4 *cron monitors*, pero sin ninguna alerta conectada; no hay reglas propias, alertas de métricas ni tableros. La especificación de A1–A4 (cron, `incierto`, `verificacion_fallida`, 5xx de la API), de M1 (`transporte` por host) y del tablero «Boletéame — operación» queda lista para crearla. Runbooks en `07-referencia/runbooks.md`: incierto, caída del SII, CAF agotado, verificación fallida, cron caído, Flow, Resend, certificado vencido y secreto expuesto.
- [ ] Crear en Sentry las alertas y el tablero, desde la UI o con un token con `alerts:write`, que hoy no existe, y probar que llegue el correo.
- [x] `checklist-produccion.md`: el TODO se reemplazó por «Habilitar una empresa en producción» y «Lanzamiento (Fase 13)», con una plantilla de registro diario del piloto.
- [x] Deploy a *Production* con humo sin sesión (2026-11-19, `c619a1a` READY). Salen las 6 cabeceras de seguridad: CSP *Report-Only* con `report-uri` a Sentry, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
  - Páginas públicas, `/docs/api`, `openapi.json`, sitemap, `robots.txt` y OG → 200; `/servicio/tablero` → 307; `/api/v1/documentos` y `/api/cron/seguimiento` sin credenciales → 401.
  - `despliegue.spec.ts` contra `https://boleteame.dev`: 10 pasan, 2 omitidas.
  - Con Chromium, 0 eventos `securitypolicyviolation` en 10 páginas públicas. Los avisos de consola en las páginas con Turnstile vienen de la CSP propia del iframe de Cloudflare, no de la nuestra.
  - Sin errores de runtime en Vercel.
- [x] Navegación con sesión en *Production* (2026-11-20, organización `servicio`, solo lectura).
  - Navegando dentro de la app (el listener de `securitypolicyviolation` sigue vivo entre páginas): 0 violaciones en las 12 páginas del panel (tablero, documentos, emitir, certificación, folios y configuración con empresas, certificados, equipo, plan, API y webhooks), en el panel de la boleta folio 43 y en el detalle de su envío, que usa Realtime.
  - Recargando por completo tablero, documentos, emitir, certificación, folios y plan: ningún recurso cargado desde otro origen.
  - Las descargas de PDF/XML y la ida a Flow son navegaciones (`window.open` y `location`), que la CSP no controla.
  - Hallazgo: los reportes CSP de un navegador con bloqueador nunca llegaban a Sentry, porque `ingest.sentry.io` estaba bloqueado. Se comprobó con una violación provocada que no llegó y con un reporte sintético enviado por curl que sí llegó. Por eso nunca había reportes.
- [x] CSP en `enforce` (2026-11-20, código; falta el deploy). `MODO_CSP = 'enforce'`, con `upgrade-insecure-requests`. `report-uri` apunta ahora a la ruta propia `/api/csp`, que valida el reporte y lo sanea antes de reenviarlo a Sentry desde el servidor:
  - solo acepta reportes del propio origen, de hasta 16 KB, y responde 413 o 415 a lo demás;
  - reenvía únicamente los campos conocidos, sin query, sin fragmento y sin el token de `/invitacion/…`;
  - no reenvía cookies ni la IP de la persona.
  Pruebas en `reporte-csp.test.ts` y `api/csp/route.test.ts` (1862 en total). Probado en local con `next start`: 0 violaciones en 8 páginas públicas, Turnstile carga, y `/api/csp` responde 204, 415 y 405.
- [x] CSP en `enforce` desplegada y verificada (2026-11-20, `ed5df22`).
  - `curl -sI` muestra `Content-Security-Policy`, sin *Report-Only*, con `upgrade-insecure-requests` y `report-uri /api/csp`. `/api/csp` responde 415 al texto plano y 405 a GET.
  - Con sesión: carga completa del tablero hidratada y 13 páginas del panel con contenido (incluido el envío con Realtime) al navegar dentro de la app, con 0 violaciones.
  - En `/contacto`, Turnstile carga y resuelve («¡Operación exitosa!»).
  - Prueba del canal de reportes: una imagen de `example.com` provocada a propósito quedó bloqueada (`enforce`), y su reporte llegó a Sentry en 1 s por `/api/csp`, aunque el navegador bloquea `ingest.sentry.io` (navegador real e IP del servidor).
  - Sin errores de runtime en Vercel. No hizo falta volver a *Report-Only*.
- [ ] Lanzamiento: Flow a producción (y cancelar la suscripción sandbox de `servicio`), boleta propia por cada cobro, cambio de tarjeta, revisión legal y piloto (empresa de `certificacion-node` con CAF de producción tipo 39 y luego 3–5 clientes durante dos semanas).

### Fase 14 — Facturas y demás DTE (posterior al lanzamiento)

Lo que las plantillas muestran y la librería todavía no hace (H1–H3). Requiere un plan
propio en `certificacion-node` con la misma disciplina de paridad y validación en
certificación. **Ese plan es `certificacion-node/PLAN-FACTURAS.md`** (2026-11-19, fases F0–F11):

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
| D4 | Pasarela de pagos | **Decidido el 2026-11-17: Flow.** Motivo: suscripciones nativas en CLP (planes, cliente con tarjeta registrada, cobro recurrente, reintentos, cambio de plan con prorrateo) y callback servidor a servidor (solo trae `token`; el estado sale de `getStatus`); Transbank no tiene webhooks y con Oneclick el cobro recurrente y la mora serían código propio. Oneclick queda como posible segunda implementación del adaptador `server/pagos/`. Consecuencias: el `planId` de Flow es `boleteame-<codigo>` (sin columna de mapeo; el `urlCallback` de los planes siempre es la URL pública https, porque Flow no deja cambiarlo con suscriptores); el `customerId` de Flow necesita una columna que escriba solo el backend; la tabla `pagos` no existe y va en la migración de la fase; período de gracia (la suscripción sigue `activa` mientras Flow reintenta y pasa a `morosa` al agotarse los reintentos, porque `plan_vigente()` excluye `morosa` y eso corta la emisión); las `FLOW_*` de *Production* apuntan al sandbox durante la fase y se cambian a producción en el lanzamiento |
| D5 | Grilla de planes y precios | **Decidido el 2026-11-17** (estructura y precios, confirmados por el usuario; en `0015_planes_comerciales`). Grilla propuesta: `certificacion` $0 · 1 empresa · 2 usuarios · 0 boletas · sin producción · **sin plazo** (se quita el `now() + 30 days` de la creación de la organización; hoy `plan_vigente()` tampoco mira `periodo_fin`); `pyme` $14.990 · 1 · 3 · 1.000; `contador` $49.990 · 15 · 10 · 10.000 compartidas; `api` $39.990 · 3 · 5 · 20.000 · API y webhooks; `empresa` a medida (sin límites, sin precio público, la asigna `service_role`, «Hablar con ventas»). `emprendedor` se fusiona con `pyme` (`activo = false`). Al 2026-11-17 la única suscripción es `certificacion`/`prueba` de `servicio`, así que no hay clientes que migrar. **Cuota:** se mantiene el bloqueo duro del trigger; la UI avisa al 80 % y al 100 % y ofrece subir de plan; el cobro por excedente queda para después. **Plan API:** mensual con volumen incluido (no por documento); la landing dice «al mes». La landing no promete factura, notas de crédito ni Libro de Compras y Ventas hasta la Fase 14 |
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
