---
title: "Sitio público"
description: "Fase 12: landing estática con los precios de planes (cliente anónimo sin cookies y respaldo), layout (publico), estado del servicio con agregados de service_role, formulario de contacto con honeypot, Turnstile en el servidor y Resend, páginas legales con lib/legal.ts, ayuda, SEO (metadataBase, plantilla de título, canónica, noindex, robots, sitemap, OG, íconos, manifest, JSON-LD), rutas públicas y slugs reservados, y cómo probarlo."
keywords: [Fase 12, sitio público, landing, (publico), revalidate, ISR, estática, clientePublico, anon, clave publicable, leerGrillaPublica, PLANES_RESPALDO, armarGrilla, grillaPublica, precios de respaldo, PASOS_PUBLICOS, contenido.ts, textos honestos, factura, Fase 14, /estado, leerEstadoServicio, lib/estado.ts, operaciones_sii, v_envios_por_consultar, service_role, agregados, head true, Sin datos, Con demoras, Con problemas, /contacto, enviarContacto, esquemaContacto, motivo, ?motivo=, honeypot, sitio_web, Turnstile, siteverify, CORREO_CONTACTO, reply_to, sin acuse, correoContacto, Idempotency-Key, relay de spam, falla cerrado, action, hostname, Next-Action, AbrirPreguntaDelHash, nivelResumen, /legal, lib/legal.ts, RESPONSABLE, camposPendientes, VIGENCIA_TERMINOS, Ley 19.628, Ley 21.719, /ayuda, SEO, metadataBase, NEXT_PUBLIC_APP_URL, urlSitio, PLANTILLA_TITULO, title.absolute, canonical, noindex, robots.txt, sitemap.xml, opengraph-image, twitter-image, ImageResponse, icon.svg, apple-icon, manifest.webmanifest, JSON-LD, SoftwareApplication, Offer, PUBLICAS_EXACTAS, PREFIJOS_PUBLICOS, SLUGS_RESERVADOS, e2e/sitio-publico.spec.ts, Firewall de Vercel]
related: ["02-guias/planes-y-pagos.md", "02-guias/api-publica.md", "01-fundamentos/ambientes-y-credenciales.md", "07-referencia/design-system.md", "07-referencia/trampas-conocidas.md", "07-referencia/checklist-produccion.md", "08-esquema-supabase/rls-y-privilegios.md", "02-guias/seguimiento-envios.md"]
source: ["PLAN-SAAS.md Fase 12", "apps/web/src/app/(publico)/", "apps/web/src/app/_seo/", "apps/web/src/app/layout.tsx", "apps/web/src/app/sitemap.ts", "apps/web/src/app/robots.ts", "apps/web/src/app/manifest.ts", "apps/web/src/app/opengraph-image.tsx", "apps/web/src/app/twitter-image.tsx", "apps/web/src/app/apple-icon.tsx", "apps/web/src/app/icon.svg", "apps/web/src/lib/sitio.ts", "apps/web/src/lib/planes-publicos.ts", "apps/web/src/lib/estado.ts", "apps/web/src/lib/legal.ts", "apps/web/src/lib/rutas.ts", "apps/web/src/server/planes-publicos.ts", "apps/web/src/server/supabase/publico.ts", "apps/web/src/server/estado/", "apps/web/src/server/correo/contacto.ts", "packages/correos/src/contacto.ts", "apps/web/e2e/sitio-publico.spec.ts"]
---

# Sitio público

> **Úsalo cuando:** tocas la landing, la cabecera o el pie públicos, `/estado`, `/contacto`,
> `/ayuda`, `/legal/*`, los metadatos (títulos, canónica, `robots`, sitemap, imágenes OG,
> íconos, manifest, JSON-LD) o agregas una ruta pública nueva.

**Estado (2026-11-19).** Código de la Fase 12 listo, revisado (sin críticos ni altos; 4
medios y 7 bajos, corregidos todos menos los datos de `RESPONSABLE` y los slugs en la base,
que quedan para la Fase 13) y verificado en local: typecheck, Vitest de la app
1767 (+1 omitida) en 133 archivos, correos 77 en 9 archivos, Biome, stylelint y `pnpm build` en verde;
`e2e/sitio-publico.spec.ts` ampliado a contacto, ayuda, estado y legales, corrido en verde contra un `next dev` propio (71 pasan, 19 omitidas por proyecto). En `/contacto` no se espera `networkidle`: el widget de Turnstile mantiene conexiones abiertas; la prueba espera `load` y el `main`, y axe excluye el iframe de Cloudflare. **Sin commit ni deploy.** Sin migraciones. Falta el
deploy a *Production* con humo, cargar `CORREO_CONTACTO` en Vercel (la carga el usuario), la
regla del Firewall de Vercel para los POST con `Next-Action` (ver
[contacto](#qué-no-se-registra)), los datos de `RESPONSABLE` en `lib/legal.ts` y el
[criterio de aceptación](#criterio-de-aceptación).

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Layout público | `app/(publico)/layout.tsx` + `_compartido/` (`Cabecera`, `MenuPublico`, `Pie`, `enlaces.ts`, `publico.module.css`) | «Saltar al contenido», cabecera con navegación y menú móvil, pie con la leyenda del SII y los enlaces |
| Landing | `app/(publico)/page.tsx`, `contenido.ts`, `inicio.module.css` | Hero, ciclo del documento, certificación, API, precios y llamado final. Estática, `revalidate = 3600` |
| Precios | `server/planes-publicos.ts`, `server/supabase/publico.ts`, `lib/planes-publicos.ts` | Lee `planes` como `anon` sin cookies y arma la grilla; respaldo si falla |
| Estado del servicio | `app/(publico)/estado/`, `server/estado/index.ts`, `lib/estado.ts` | Niveles por componente a partir de agregados; `revalidate = 60` |
| Contacto | `app/(publico)/contacto/` (`page.tsx`, `FormularioContacto.tsx`, `acciones.ts`, `esquema.ts`), `server/correo/contacto.ts`, `@sii/correos` (`contacto.ts`) | Formulario, Server Action con honeypot, zod, Turnstile y Resend |
| Legal | `app/(publico)/legal/` (`page.tsx`, `terminos/`, `privacidad/`, `DocumentoLegal.tsx`), `lib/legal.ts` | Términos y privacidad; datos del responsable en `RESPONSABLE` |
| Ayuda | `app/(publico)/ayuda/page.tsx`, `AbrirPreguntaDelHash.tsx` | Preguntas frecuentes con `<details>` nativos; un componente cliente abre la pregunta del hash |
| Identidad del sitio | `lib/sitio.ts` | `urlSitio()`, `urlAbsoluta()`, nombre, título, plantilla y descripción |
| SEO | `app/layout.tsx` (metadatos base y `viewport`), `app/_seo/` (`metadatos.ts`, `json-ld.ts`, `JsonLd.tsx`, `ImagenSocial.tsx`, `marca.ts`), `app/{sitemap,robots,manifest}.ts`, `app/{opengraph-image,twitter-image,apple-icon}.tsx`, `app/icon.svg` | Metadatos, rutas de metadatos e imágenes |
| Rutas | `lib/rutas.ts` | Rutas públicas exactas, prefijos públicos y slugs reservados |

`(publico)` es un grupo de rutas: no agrega segmento a la URL. La portada antigua
(`app/page.tsx` y `page.module.css`) se borró; `/` es `(publico)/page.tsx`. `/docs/api`
(Fase 11) sigue en `app/docs/api/`, fuera del grupo, con su propio diseño.

## Rutas y cómo se generan

| Ruta | Render | Notas |
|---|---|---|
| `/` | Estática, `revalidate = 3600` | Precios de `planes`; JSON-LD |
| `/ayuda` | Estática | Anclas estables (`/ayuda#por-verificar` lo usa `/estado`) |
| `/estado` | Estática, `revalidate = 60` | Agregados con `service_role`; muestra solo niveles |
| `/contacto` | Dinámica (lee `searchParams`) | Server Action `enviarContacto` |
| `/legal`, `/legal/terminos`, `/legal/privacidad` | Estáticas | Leen `lib/legal.ts` |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | Estáticas, en el build | Con `NEXT_PUBLIC_APP_URL` |
| `/opengraph-image`, `/twitter-image`, `/apple-icon` | Estáticas, en el build | PNG de `ImageResponse`; se piden con un hash en la query |
| `/icon.svg` | Archivo | La estampilla, con tema oscuro por `prefers-color-scheme` |

Las estáticas con `revalidate` se generan en el build y después se regeneran en segundo
plano, como mucho una vez por período, al recibir visitas.

## Layout `(publico)`

- **Contrato con las páginas:** el layout **no** pone `<main>`. Cada página renderiza su
  propio `<main id="contenido" tabIndex={-1}>` (`ID_CONTENIDO`), que es el destino del enlace
  «Saltar al contenido», el primer elemento enfocable. Una página nueva del grupo que no lo
  haga deja el enlace sin destino.
- **Cabecera** (`Cabecera.tsx`): «Boletéame» enlaza a `/`; `MenuPublico` (cliente) lleva la
  navegación `aria-label="Principal"` (Producto, Certificación, Desarrolladores → `/docs/api`,
  Precios; anclas `/#…` de la landing) e Ingresar (`discreto`) y Crear cuenta (`secundario`).
  En pantallas anchas se ve todo y el botón «Menú» no aparece; en móvil el botón
  (`aria-expanded`, `aria-controls`) abre y cierra el menú, que se cierra al elegir un enlace
  o con Escape (el foco vuelve al botón).
- **Pie** (`Pie.tsx`): leyenda «Boletéame es un servicio independiente y no está afiliado al
  Servicio de Impuestos Internos.» y la navegación `aria-label="Pie de página"` en tres grupos
  (Producto, Soporte, Legal).
- Los enlaces están en `_compartido/enlaces.ts` (`NAV_PRINCIPAL`, `GRUPOS_PIE`,
  `RUTA_CREAR_CUENTA`): agregar una página pública al pie es agregarla ahí.

## Landing

Sobre la plantilla «Landing» del design system (`Main.dc.html`). Secciones con ancla:
`#producto` (ciclo `EstadoDTE` borrador → firmado → enviado → aceptado, reparos o rechazado,
y cuatro funciones), `#certificacion`, `#api` y `#precios`, más el hero y el llamado final.
El hero muestra un panel de ejemplo con `TablaDTE` y `MedidorFolios` con datos ficticios
(«Ejemplo con datos ficticios.»). La única acción `primario` es «Crear cuenta» del hero.

### Precios desde `planes`

- `leerGrillaPublica()` lee `planes` (`COLUMNAS_PLAN`, por `orden`) con `clientePublico()`:
  clave publicable, rol `anon`, **sin cookies** (`persistSession: false`). Por eso la página
  puede ser estática: `clienteServidor()` lee las cookies de la sesión y la volvería dinámica.
  RLS deja ver a `anon` solo los planes activos (política `lectura` de `planes`).
- `armarGrilla` reparte lo leído: **certificación** (código `certificacion`, o gratis y sin
  producción), **tarjetas** (autoservicio, con producción y precio mayor que 0; ordenadas por
  `orden`, precio y código) y **a medida** (sin autoservicio y con producción: Empresa, con
  «Hablar con ventas» → `/contacto?motivo=ventas`). Contador va destacado («Varias
  empresas»). Las características de cada tarjeta salen de `caracteristicasPlan`
  (`lib/planes.ts`, la misma función de Configuración → Plan) más «Certificación guiada ante
  el SII».
- **Respaldo:** si la lectura da error, lanza (configuración incompleta, red) o no trae
  ningún plan con precio, se usa `PLANES_RESPALDO` y se avisa con `console.error` y un
  `Sentry.captureMessage('landing: precios de respaldo')` de nivel `warning`, etiqueta
  `seccion: precios`. La página nunca se rompe por los precios.
- Un cambio de precio en `planes` llega a la landing en una hora como mucho (o en el
  siguiente deploy). Si cambia la grilla con una migración nueva, hay que actualizar también
  `PLANES_RESPALDO` y `PLANES_JSON_LD` (`_seo/json-ld.ts`): la prueba de
  `lib/planes-publicos.test.ts` compara el respaldo con `0015_planes_comerciales.sql` y no
  sabe de migraciones posteriores. Los planes de Flow tienen que cobrar lo mismo
  ([planes y pagos](planes-y-pagos.md)).

## Textos honestos

Lo que dice el sitio tiene que existir hoy. Reglas y lo que las ata:

- **Solo boleta electrónica (39) y boleta exenta (41)** hasta la Fase 14: nada de factura,
  Libro de Compras y Ventas, nota de crédito, guía de despacho ni documentos recibidos. La
  prueba e2e «no promete documentos que todavía no existen» busca esas palabras en el
  `<main>` de la landing. `/ayuda` y las páginas legales siguen la misma regla, sin prueba
  automática.
- **Datos ficticios del hero** (`DOCUMENTOS_EJEMPLO` en `contenido.ts`): solo tipos 39 y 41,
  RUT con dígito verificador válido, montos positivos y fechas `DD-MM-AAAA`
  (`contenido.test.ts`).
- **Pasos de la certificación:** `PASOS_PUBLICOS` toma número y título de `PASOS`
  (`lib/certificacion.ts`, los mismos 5 pasos del asistente de `/[org]/certificacion`) y solo
  agrega una descripción propia. `contenido.test.ts` compara número y título con `PASOS` y la
  e2e cuenta 5 pasos en `#certificacion`. Si el asistente cambia, la landing cambia sola o la
  prueba falla.
- **Ejemplo de la API:** la URL sale de `URL_API` y la cabecera de `CABECERA_IDEMPOTENCIA`
  (`lib/api-publica.ts`); el cuerpo pasa `esquemaEmisionApi` (el mismo esquema de
  `POST /api/v1/documentos`) y los totales de la respuesta los calcula `calcularTotales` de la
  emisión (2 × $ 2.490 = $ 4.980). Si el contrato de la API cambia, la prueba falla.
- **Precios:** salen de `planes` (o del respaldo atado a la migración por la prueba). El
  JSON-LD usa las mismas tarjetas leídas.
- **Certificación:** «Lo que emitas mientras te certificas no tiene validez tributaria»; la
  empresa ya autorizada fuera de Boletéame no se certifica de nuevo (como en la
  [guía](certificacion-empresa.md)).

## Estado del servicio (`/estado`)

`leerEstadoServicio()` (`server/estado/index.ts`) mide; `lib/estado.ts` (puro) decide el
nivel y el texto de cada fila. Niveles: «Operativo», «Con demoras», «Con problemas» y «Sin
datos». El resumen de arriba (`nivelResumen`) es el peor nivel medido **sin la fila
Plataforma** (siempre operativa, no mide nada). Si no se pudo medir la base de datos, el
resumen nunca es «Todo funciona con normalidad»: queda en «Sin datos: no pudimos medir el
estado del servicio en este momento.», salvo que otra fila muestre demoras o problemas.

| Fila | Fuente | Regla |
|---|---|---|
| Plataforma | — | Siempre «Operativo»: si la página se generó, el sitio responde |
| Base de datos | Lectura `head` de `planes` (sin filas) | Error → con problemas; 1.500 ms o más → con demoras |
| Conexión con el SII · Producción y · Certificación | `operaciones_sii` del ambiente terminadas en los últimos 60 min | Respondidas = `ok` y `rechazo_sii` (0 y 5); fallas = `transporte` e `incierto` (4 y 6). 1, 2, 3 y 7 no cuentan. Sin operaciones o lectura fallida → sin datos («Sin mediciones recientes.»); sin fallas → operativo; 3 fallas o más y la mitad o más → con problemas; 10 % o más → con demoras; menos, operativo. Muestra solo el nivel, con una frase fija por nivel |
| Seguimiento automático de envíos | `v_envios_por_consultar` y la última `operaciones_sii` con `operacion = 'seguimiento'` y `resultado = 'ok'` | Atrasados = sin `ultima_consulta_en`, no inciertos, enviados entre hace 24 h y hace 15 min. Sin atrasados → operativo; con atrasados y alguna corrida `ok` en los últimos 60 min → operativo (el cron funciona: los atrasados son de clientes puntuales, por ejemplo con el certificado vencido, que deja la corrida de su empresa en `config`); con atrasados y ninguna corrida `ok` en 60 min → con problemas. Nunca «Con demoras» |

Producción se lista antes que certificación. La página explica cómo se mide y enlaza a
`/ayuda#por-verificar` y a `/contacto`.

- **Por qué `service_role` y solo agregados.** `operaciones_sii` y `envios` tienen RLS por
  organización y la página no tiene sesión. El módulo lee **solo** conteos con
  `count: 'exact', head: true` (sin filas) y una fecha `terminada_en` suelta, y devuelve
  **solo niveles y frases fijas**: nunca ids, organizaciones, empresas, mensajes, detalles,
  errores crudos, conteos ni horas. A los logs va solo el código del error
  (`estado: lectura fallida (<consulta>, <código>)`).
- **No revela actividad.** La página no muestra la hora de la última respuesta del SII ni la
  de la última consulta automática, ni frases como «No hubo operaciones en la última hora»:
  con pocos clientes, eso diría cuándo emite alguien. La única hora es la de la generación de
  la página.
- **Nunca lanza.** Cada lectura tiene un tope de 5 s (`AbortSignal.timeout`); una que falla
  deja su fila en «Sin datos» (la base de datos, en «Con problemas»). Sin configuración de
  `service_role`, todo lo que depende de la base queda en «Sin datos».
- **Carga:** 7 lecturas por regeneración (1 de la base, 2 por ambiente del SII, 2 del
  seguimiento) y, con `revalidate = 60`, 7 por minuto como mucho, sin importar las visitas.
- **Sin migraciones.** Todo sale de columnas existentes. `operaciones_sii` no tiene índice
  por fecha sin organización, así que los conteos recorren la tabla (ver
  [trampas](../07-referencia/trampas-conocidas.md#sitio-público-fase-12)).
- «Sin datos» en la conexión con el SII significa que no hay mediciones recientes, no que haya
  una falla; la página lo dice sin distinguir una hora sin actividad de una lectura fallida.

## Formulario de contacto (`/contacto`)

### Campos y motivos

| Campo | Regla (`esquema.ts`, zod) |
|---|---|
| Nombre | Obligatorio, hasta 100 caracteres |
| Correo electrónico | Obligatorio, hasta 254, formato de correo |
| Empresa | Opcional, hasta 100 |
| RUT de la empresa | Opcional; solo dígitos, K, puntos, guion y espacios; dígito verificador válido; llega formateado (`76.354.771-K`) |
| Motivo | `ventas` («Ventas / plan Empresa»), `soporte`, `certificacion`, `privacidad` («Privacidad y datos personales») u `otro` |
| Mensaje | Obligatorio, de 10 a 5.000 caracteres |

`?motivo=<valor>` deja el motivo elegido si está en la lista (sin distinguir mayúsculas; un
valor desconocido o repetido no elige nada). La landing enlaza `/contacto?motivo=ventas`. La
canónica de la página no lleva la query.

El formulario (cliente) usa campos controlados para que lo escrito no se pierda tras un error
de servidor, muestra el contador de caracteres del mensaje, envía el RUT por un input oculto
(`CampoRut` no tiene `name`) y deshabilita «Enviar mensaje» hasta tener el token de
Turnstile (si está configurado). El widget se dibuja con `action="contacto"`
(`ACCION_TURNSTILE_CONTACTO` de `esquema.ts`). Tras un error reinicia el widget: cada token
sirve una vez. Al terminar muestra «Recibimos tu mensaje» y «Escribir otro mensaje» lo vuelve
a montar vacío.

### Server Action `enviarContacto`

Pública, sin sesión. En este orden:

1. **Honeypot:** si el campo oculto `sitio_web` (`CAMPO_TRAMPA`, fuera de la vista y del
   orden de tabulación) llega con algo, responde éxito sin verificar Turnstile, sin enviar y
   sin registrar nada. El bot no aprende que lo detectaron.
2. **Validación** con `validarContacto` (el primer error de cada campo). El correo se
   normaliza aquí una sola vez (sin espacios y en minúsculas).
3. **Turnstile en el servidor**, que **falla cerrado en producción**: si `envTurnstile()` es
   `null` y `VERCEL_ENV === 'production'`, responde «No pudimos enviar tu mensaje» con
   `MOTIVOS_TURNSTILE.noDisponible` y avisa a Sentry (`error`, solo
   `faltan: ['TURNSTILE_SECRET_KEY']`), sin enviar. En local y desarrollo, sin clave, la
   verificación se omite como antes (las invitaciones no cambian). Con clave:
   `verificarTurnstile(token, ipCliente(headers), esperado)` contra `siteverify` (5 s de
   tope), con `esperado = { accion: 'contacto' }` y, solo en producción, además `hostname` =
   el de `urlSitio()` (`boleteame.dev`). Si `action` o `hostname` de la respuesta no calzan,
   se rechaza como `MOTIVOS_TURNSTILE.invalido` (un token resuelto en otro formulario o en
   otro sitio con la misma clave de sitio). Si falla, responde el motivo redactado para la
   persona y no envía.
4. **Configuración:** `envCorreo()` (Resend y remitente) y `envContacto()`
   (`CORREO_CONTACTO`). Si falta algo: «No pudimos enviar tu mensaje» y un aviso a Sentry de
   nivel `error` con **solo los nombres** de las variables que faltan.
5. **Envío** (`enviarMensajeContacto`): **un solo correo**, a `CORREO_CONTACTO`, desde
   `CORREO_REMITENTE`, con `reply_to` de la persona y asunto `[Contacto · <Motivo>] <Nombre>`.
   Si falla, la persona ve el error (lo escrito sigue en el formulario) y Sentry recibe el
   motivo de la falla y el estado HTTP.

### Sin acuse a la persona

No se manda ningún correo a la dirección que escribió la persona. Esa dirección la escribe
cualquiera en un formulario público: un acuse automático, aunque no copie texto libre, nos
haría *relay* de spam hacia terceros con el mismo remitente de Auth (y gastaría su
reputación, de la que dependen la confirmación de cuentas y la recuperación de contraseñas).
La página de éxito no promete un correo de confirmación: dice que responderemos al correo que
dejó la persona.

La plantilla `correoContacto` de `@sii/correos` limpia lo que escribe la persona también para el texto
plano (`limpiarLinea`, `limpiarTextoLibre`: sin caracteres de control ni de dirección bidi,
saltos normalizados, asunto en una línea) y lo escapan en el HTML.

### Idempotencia

`Idempotency-Key` de Resend = `contacto/<sha256>` del destinatario (`CORREO_CONTACTO`) y
del contenido (motivo, nombre, correo, empresa, RUT y mensaje). El correo de la persona es el
valor ya normalizado por el esquema: el mismo que va en `reply_to`. El destinatario entra en
el hash para que, si cambia `CORREO_CONTACTO`, la clave cambie con él. Un doble clic, o reenviar lo mismo tras un error de red con un token de Turnstile nuevo, no llega dos
veces (Resend guarda la clave 24 h). El cuerpo del correo no lleva la hora: la misma clave
tiene que llevar siempre el mismo contenido, porque Resend rechaza una clave repetida con
otro cuerpo.

### Qué no se registra

El mensaje no se guarda en la base: solo queda en el buzón de `CORREO_CONTACTO`. Ni el
nombre, el correo, la empresa, el RUT ni el mensaje van a logs ni a Sentry; tampoco el
detalle del error de Resend (podría citar una dirección). Los campos del formulario ya los
filtra `lib/sentry/depurar.ts` (`server_action_form_data.*`).

**Pendiente fuera del código:** una regla de *rate limit* por IP del Firewall de Vercel,
además de Turnstile. **No puede ser «POST a `/contacto`»:** Next 16 ejecuta una Server
Action desde cualquier ruta si el POST trae la cabecera `Next-Action` con su id, así que un
bot puede mandar el formulario a `/` o a `/ayuda` y saltarse esa regla. La regla tiene que
cubrir los POST con cabecera `Next-Action` (o todos los POST de páginas, fuera de `/api/`)
([checklist](../07-referencia/checklist-produccion.md#sitio-público-fase-12),
[trampas](../07-referencia/trampas-conocidas.md#sitio-público-fase-12)).

## Páginas legales

`/legal` es el índice; `/legal/terminos` y `/legal/privacidad` usan `DocumentoLegal`
(cabecera con la vigencia, índice «En esta página» con anclas, secciones numeradas con `id`
estable) y `TablaLegal` (tabla en una región desplazable y enfocable). La privacidad sigue la
Ley 19.628 y su reforma por la Ley 21.719 y describe lo que el sistema hace de verdad:
certificados y CAF en Vault, tokens del SII con AES-256-GCM, RLS por organización, Storage
privado, Sentry depurado, solo las cookies de sesión de Supabase y los encargados reales
(Supabase, Vercel, Resend, Cloudflare Turnstile, Sentry y Flow). **Si se agrega un proveedor,
una cookie o un dato nuevo, hay que actualizar la política y su vigencia.**

### `lib/legal.ts` y los datos del responsable

`RESPONSABLE` tiene cinco campos, **todos pendientes (`null`)**: razón social, RUT, domicilio,
correo de contacto y correo de privacidad. El usuario los entregará después. Mientras falten,
las páginas muestran un texto neutro y nunca un marcador entre corchetes:

- `nombreTitular()` → «el titular de Boletéame» (con mayúscula al inicio de frase).
- `identificacionTitular()` agrega solo lo que existe («…, RUT 76.354.771-K, con domicilio
  en …»).
- `canalContacto()` → «escríbenos a <correo>» (`mailto:`) o, sin correo, «escríbenos desde la
  página de contacto». Para privacidad usa `correoPrivacidad`, luego `correoContacto`, luego
  el formulario.
- `camposPendientes()` lista lo que falta: revisarlo antes de publicar.
- `legal.test.ts` comprueba que ningún texto de respaldo muestre corchetes, llaves, «TU»,
  `null` ni `undefined`.

Para completarlos basta con llenar `RESPONSABLE`: las páginas leen de ahí. Si cambia el texto
de un documento, se actualiza `VIGENCIA_TERMINOS` o `VIGENCIA_PRIVACIDAD` (hoy `2026-11-19`) y
la fecha `modificada` de esa página en `PAGINAS_SITEMAP`. **Recomendación:** que un abogado
revise términos y privacidad antes del lanzamiento; el texto es un borrador fiel al sistema,
no una revisión legal.

Los términos prometen, entre otras cosas, avisar con 30 días un cambio de precio y emitir
**el documento tributario que corresponda por cada cobro**; esto último todavía no existe
(Fase 13, [checklist](../07-referencia/checklist-produccion.md#al-lanzar-pasar-flow-a-producción-fase-13)).

## Ayuda (`/ayuda`)

Preguntas frecuentes en grupos (`empezar`, `emitir`, `folios`, `planes`, `equipo-api`) con
`<details>`/`<summary>` nativos sobre lo que existe hoy. Cada pregunta tiene un `id` estable
que sirve de ancla (`/estado` enlaza `/ayuda#por-verificar`); no cambiarlos sin buscar quién
los enlaza. El navegador no abre un `<details>` al saltar a su `id`: lo hace
`AbrirPreguntaDelHash` (componente cliente que no dibuja nada), al cargar la página y en cada
`hashchange`, para cualquier pregunta con `id`. Sin JavaScript el enlace igual lleva a la
pregunta, cerrada.

## SEO

### Metadatos base (`app/layout.tsx`)

- **`metadataBase`** = `urlSitio()` (`lib/sitio.ts`): `NEXT_PUBLIC_APP_URL` sin barra final; si
  falta o no es una URL http(s), `https://boleteame.dev`, para que el build no se caiga. Es una
  variable `NEXT_PUBLIC_`: se fija en el build. De ella salen las URL absolutas de la
  canónica, Open Graph, el sitemap, `robots.txt` y el JSON-LD.
- **Título:** `default` = `TITULO_SITIO` («Boletéame · Boletas electrónicas ante el SII») y
  `template` = `'%s · Boletéame'`. Cada página pone solo su nombre (`title: 'Ingresar'` →
  «Ingresar · Boletéame»); la landing usa `title.absolute`. Por eso se quitó « · Boletéame» de
  los títulos de las páginas existentes; `/docs/api` pasó a «Documentación de la API».
- **Canónica** `alternates.canonical: './'`: se resuelve contra la ruta de cada página, así
  que cada una hereda una canónica a sí misma, sin la query. Con `'/'` todas las que no
  definieran la suya apuntarían a la landing.
- `description`, `applicationName`, Open Graph (`website`, `es_CL`, `siteName`, `url: './'`),
  Twitter `summary_large_image` y `formatDetection.telephone: false`.
- `viewport.themeColor` por tema con el `surface` de cada uno (de `_seo/marca.ts`); sin
  `colorScheme`, que lo pone `tokens.css` respetando `data-theme`.

### Fuera de los buscadores

`robots: { index: false }` en `[org]/layout.tsx` (toda la app de cada organización; las
páginas de abajo no deben redefinir `robots`), `bienvenida`, `invitacion/[token]`,
`restablecer` y `/_ds` (`follow: false`) y `recuperar` (`follow: true`). Ingresar y crear
cuenta sí se indexan.

### Rutas de metadatos

- **`/robots.txt`** (`construirRobots`): permite `/` y excluye `/api/`, `/auth/`,
  `/bienvenida`, `/invitacion/`, `/_ds` y `/monitoring`; apunta al sitemap absoluto. Las
  páginas de organizaciones no se listan: enumerar los slugs los publicaría y no comparten un
  prefijo. Las protegen el proxy (sin sesión redirige a `/ingresar`) y el `noindex`.
- **`/sitemap.xml`** (`construirSitemap`, `PAGINAS_SITEMAP`): `/`, `/docs/api`, `/ayuda`,
  `/crear-cuenta`, `/contacto`, `/estado`, `/ingresar`, `/legal/terminos` y
  `/legal/privacidad`, con fecha **fija** por página (cámbiala cuando cambie el contenido; con
  `new Date()` los buscadores volverían a rastrear todo en cada deploy), frecuencia y
  prioridad.
- **`/manifest.webmanifest`** (`construirManifest`): nombre, `short_name`, `es-CL`,
  `standalone`, colores del tema claro (`surface` y `sello`) e íconos `/icon.svg` y
  `/apple-icon`.
- **Imágenes OG y Twitter** (`opengraph-image.tsx`, `twitter-image.tsx` → `imagenSocial()`):
  PNG de 1200 × 630 generado en el build con la composición del hero (fondo `surface`, bloque
  `sello` perforado, cuadro `ocre` y una boleta). Colores de `_seo/marca.ts` (Satori no lee
  custom properties); `marca.test.ts` los compara con `tokens.json`. Fuente: la que trae
  `next/og`, no IBM Plex (ver [trampas](../07-referencia/trampas-conocidas.md#sitio-público-fase-12)).
- **Íconos:** `icon.svg` es exactamente `svgEstampilla({ temaOscuro: true })` (lo verifica
  `marca.test.ts`): bloque `sello` con borde perforado, cuadro `ocre` y la «B», con colores del
  tema oscuro por `prefers-color-scheme`. `apple-icon.tsx`: 180 × 180, opaco sobre `surface`
  (iOS rellena de negro lo transparente). Es un monograma, no un logotipo: el design system
  todavía no tiene marca gráfica.

### JSON-LD

Solo en la landing (`<JsonLd planes={grilla.tarjetas} />`): `Organization` y
`SoftwareApplication` enlazados, con un `Offer` en CLP por cada plan con precio
(`UnitPriceSpecification`, `billingDuration: P1M`); Certificación y Empresa no llevan
oferta. `serializarJsonLd` escapa `<`, `>`, `&`, U+2028 y U+2029 para que ningún texto cierre
el `<script>`.

## Rutas públicas y slugs reservados (`lib/rutas.ts`)

- **`PUBLICAS_EXACTAS`** suma las rutas de metadatos de la raíz: `/sitemap.xml`,
  `/robots.txt` y `/manifest.webmanifest` (también calzan con el regex `ESTATICO`, pero se
  listan para no depender de él) y `/opengraph-image`, `/twitter-image`, `/icon` y
  `/apple-icon`, que se sirven **sin extensión** y no calzan con `ESTATICO`. Solo en la raíz:
  `/acme/opengraph-image` sigue protegida.
- **`PREFIJOS_PUBLICOS`** suma `/contacto`, `/ayuda`, `/estado` y `/legal`: la ruta o lo que
  cuelga de ella es público (`/legales` o `/contactos`, no). Es seguro porque sus slugs están
  reservados: nada bajo ellos puede ser una organización.
- **`SLUGS_RESERVADOS`** suma `estado`, `terminos`, `privacidad`, `soporte`,
  `opengraph-image`, `twitter-image`, `icon` y `apple-icon` (`legal`, `ayuda`, `contacto`,
  `precios` y `docs` ya estaban). Las rutas con punto no hace falta reservarlas: `PATRON_SLUG`
  no admite puntos.
- `rutas.test.ts` exige que cada ruta pública de primer nivel sin punto esté reservada y, además,
  lee las carpetas reales de `src/app` (con `node:fs`; ignora archivos, carpetas privadas
  `_…`, segmentos dinámicos como `[org]` y `%5Fds`, y entra en los grupos `(…)`, cuyas
  carpetas hijas son rutas de primer nivel): una carpeta nueva sin su slug reservado rompe la
  prueba.
- **Pendiente (Fase 13):** la reserva vive solo en la app. La función de la base
  `crear_organizacion` no conoce `SLUGS_RESERVADOS`: quien la llame directo (con la clave
  publicable y una sesión) podría crear una organización con un slug reservado. Requiere una
  migración que valide la misma lista en la base.

**Agregar una página pública nueva:** crearla en `(publico)/` con su `<main id="contenido">`;
agregar el prefijo a `PREFIJOS_PUBLICOS`, el slug a `SLUGS_RESERVADOS` y ambos a la lista de
`rutas.test.ts`; comprobar antes que ninguna organización existente use ese slug (la reserva
solo frena las nuevas); sumarla a `PAGINAS_SITEMAP` si se indexa y a `GRUPOS_PIE` si va en el
pie.

## Cómo probar

- **Vitest** (`pnpm --filter web test`): `(publico)/contenido.test.ts`,
  `contacto/esquema.test.ts` y `acciones.test.ts` (honeypot, validación, Turnstile con token e
  IP y `action`, `hostname` solo en producción, falla cerrado sin clave en producción y
  abierto fuera de ella, sin configuración, un solo correo con `reply_to`, correo normalizado
  en `reply_to` y en la clave, destinatario en la `Idempotency-Key`, misma clave en el doble
  clic, fallas de Resend sin datos en Sentry), `server/turnstile.test.ts` (`action` y
  `hostname` esperados, compatible sin ellos), `lib/planes-publicos.test.ts` (grilla, respaldo y
  comparación con la `0015`), `lib/estado.test.ts` y `server/estado/index.test.ts` (umbrales,
  seguimiento por la última corrida `ok`, resumen sin Plataforma y en «Sin datos» si no se
  midió la base, frases sin conteos ni horas, conteos con `head`, ventana, nunca lanza), `lib/legal.test.ts`, `lib/sitio.test.ts`,
  `_seo/metadatos.test.ts`, `json-ld.test.ts` y `marca.test.ts`, `lib/rutas.test.ts` (incluidas las carpetas reales de `src/app`) y
  `bienvenida/slug.test.ts`. Correos: `pnpm --filter @sii/correos test` (`contacto.test.ts`:
  limpieza, escape, tono).
- **e2e local** (`pnpm --filter web exec playwright test e2e/sitio-publico.spec.ts`, levanta
  `next dev`; proyectos claro, oscuro y móvil): título y `<h1>` de la landing sin errores de
  consola, sin promesas de documentos que no existen, anclas y 5 pasos, enlaces de la
  cabecera y del pie, menú móvil con Escape, precios de la grilla, ejemplo de la API, «Saltar
  al contenido», `/ayuda#por-verificar` abre la pregunta, axe (también con el menú abierto) y
  sin desborde horizontal (también a 320 px). **axe** (claro, oscuro, móvil y con
  `data-theme`) y la revisión de palabras prohibidas corren en `/`, `/contacto`, `/ayuda`,
  `/estado`, `/legal/terminos` y `/legal/privacidad`; la revisión quita antes el descargo de
  los términos («Hoy Boletéame no emite facturas…») y permite «facturación» (el cobro del
  plan). Solo lectura: no inicia sesión, no envía el formulario, no escribe en la base ni toca
  el SII; `/estado` lee la base de producción en solo lectura desde `next dev`. No correrlo
  contra producción.
- **Contra un deploy** (`E2E_URL=https://<deploy> pnpm --filter web test:e2e`): corre solo
  `e2e/despliegue.spec.ts`, que ahora espera el `<h1>` de la landing en la portada, además de
  axe, tokens, fuentes, `/_ds` en 404 y sin desborde en móvil.
- **Humo a mano después del deploy:** `/`, `/ayuda`, `/estado`, `/contacto`,
  `/legal/terminos`, `/legal/privacidad`, `/sitemap.xml`, `/robots.txt`,
  `/manifest.webmanifest`, `/opengraph-image` y `/apple-icon` responden 200 sin sesión (sin
  307 a `/ingresar`); el sitemap y `og:url` llevan `https://boleteame.dev`;
  `/<org>/tablero` sin sesión sigue en 307.

## Criterio de aceptación

Propuesto (la Fase 12 no traía uno): el sitio público pasa axe en claro, oscuro y móvil en
*Production*, los precios coinciden con `planes`, y un mensaje del formulario de contacto
llega a `CORREO_CONTACTO` con Turnstile verificado en el servidor. Pendiente.
