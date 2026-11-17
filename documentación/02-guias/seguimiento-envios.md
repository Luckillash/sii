---
title: "Seguimiento de envíos y estados del SII"
description: "Fase 8: cron /api/cron/seguimiento (grupos empresa+ambiente+canal, un token por grupo con una renovación, lotes de 100, backoff por consultas, presupuesto de tiempo), qué se escribe por consulta y en qué orden, tabla de estados SII → clasificación → documentos, rechazos y reparos, envíos inciertos y «Ya lo revisé», «Consultar estado en el SII», Documentos emitidos y detalle del envío con Realtime, alertas por correo (notificaciones, migración 0013), pg_cron (migración 0014), monitores de Sentry y diagnóstico con SQL."
keywords: [seguimiento, Fase 8, /api/cron/seguimiento, ejecutarSeguimiento, consultarEnvio, consultar_envio, seguimiento, operaciones_sii, v_envios_por_consultar, inconsistente, filtroPorConsultar, ESCALONES_BACKOFF, backoff, intervaloMinutos, debeConsultar, DIAS_SIN_CERRAR, envio_sin_cerrar, TOPE_ENVIOS, LIMITE_MS, MS_EMPEZAR_GRUPO, MS_RENOVAR, maxDuration, cerrarAbandonadas, agrupar, clienteEstado, consultarConRenovacion, tokenRechazado, ErrorTokenSoap, ErrorEstadoDesconocido, ESTADOS_CONOCIDOS, lista blanca, -11, RPR, QueryEstUp, ClienteDtews, ClienteBoletaRest, consultarEnvio, server/sii/clientes.ts, clienteBoletaRest, clienteDtews, guardarRespuesta, registrarFalla, detalleIncompleto, sin_detalle, ya_final, CLASIFICACIONES_FINALES, tipoObservacion, jsonSeguro, textoSeguro, envio_estadisticas, envio_rechazos, consultas_envio, sincronizar_documentos_envio, trg_50_envio_actualizado, trg_50_envio_rechazo_sincronizar, documento.aceptado, envio.actualizado, SEGUNDOS_ENTRE_CONSULTAS, ResultadoConsultaEnvio, ResumenSeguimiento, HORARIO_SEGUIMIENTO, MONITOR_SEGUIMIENTO, cron-seguimiento, cron-alertas, autorizarCron, conMonitorCron, CRON_SECRET, cron_token, envCron, Documentos emitidos, /documentos, /envios/[id], Ya lo revisé, marcarEnvioRevisado, marcarInciertaRevisada, revisada_en, enviosInciertos, Tablero, useEnVivoStore, ProveedorEnVivo, EnVivo, router.refresh, actualizado_en, Reenviar al receptor, notificaciones, reclamar_notificacion, notificacion_cerrada, alertas_documentos_rechazados, alertas_envios_inciertos, alertas_certificados_por_vencer, grupo, Idempotency-Key, ejecutarAlertas, /api/cron/alertas, correoDocumentosRechazados, correoEnvioIncierto, correoCertificadoPorVencer, migración 0013, migración 0014, pg_cron, pg_net, net.http_post, net._http_response, cron.job_run_details, limpiar-tokens-sii, limpiar-historial-cron, Track ID 34015200, Track ID 34017110, suscribirEnVivo, criterio de aceptación]
related: ["02-guias/emision-boletas.md", "04-objetos/objetos-envios-y-rcof.md", "04-objetos/objetos-documentos.md", "08-esquema-supabase/triggers-y-logica.md", "08-esquema-supabase/despliegue.md", "03-api-reference/servicios-sii.md", "03-api-reference/indice-operaciones.md", "03-api-reference/rpc-backend.md", "06-integraciones/realtime-y-storage.md", "06-integraciones/webhooks.md", "07-referencia/trampas-conocidas.md", "02-guias/tablero-y-reportes.md"]
source: ["supabase_saas_sii.sql §9 §15 §16", "supabase/migrations/0001_esquema_inicial.sql", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql", "supabase/verificaciones/0013_notificaciones.sql", "supabase/verificaciones/0014_cron.sql", "supabase/verificaciones/rls-fase8-notificaciones.sql", "certificacion-node/docs/canales.md", "PLAN-SAAS.md Fase 8", "apps/web/src/lib/seguimiento.ts", "apps/web/src/server/seguimiento/", "apps/web/src/server/sii/clientes.ts", "apps/web/src/server/cron/autorizacion.ts", "apps/web/src/app/api/cron/seguimiento/route.ts", "apps/web/src/app/api/cron/alertas/route.ts", "apps/web/src/server/alertas/", "apps/web/src/server/documentos/", "apps/web/src/app/[org]/documentos/", "apps/web/src/app/[org]/envios/", "apps/web/src/app/[org]/tablero/page.tsx", "apps/web/src/stores/enVivo.ts", "apps/web/src/stores/ProveedorEnVivo.tsx", "packages/correos/src/rechazo.ts", "packages/correos/src/incierto.ts", "packages/correos/src/certificado.ts", "apps/web/e2e/documentos.spec.ts"]
---

# Seguimiento de envíos y estados del SII

> **Úsalo cuando:** tocas el cron de seguimiento, «Consultar estado en el SII», las páginas
> Documentos emitidos y Envío, las alertas por correo, o necesitas saber por qué una boleta
> sigue `enviado`.

**Estado (2026-11-17).** La **Fase 8** está desplegada en *Production* (`3ade4c9`, READY,
con humo y pantallas con sesión verificados). Trae dos migraciones, las dos **aplicadas en
producción el 2026-11-17**: `0013_notificaciones` (tabla de deduplicación de alertas y sus
funciones; verificación 18/18 y simulación 26/26 con limpieza en 0), antes del deploy, y
`0014_cron` (los jobs de `pg_cron`; verificación 12/12), después del deploy, a las 18:31
UTC ([orden de despliegue](#orden-de-despliegue)). El cron ya corre: la primera corrida de
seguimiento (18:35 UTC) dejó el único envío real (Track ID 34015200, de la Fase 7) en EPR y
su documento `aceptado`. Al probar el criterio apareció un bug de Realtime en las cargas
completas de página, corregido (`suscribirEnVivo`), **desplegado** (`b84a5b2`, deploy
`326be87`) y verificado en *Production*. El
[criterio de aceptación](#criterio-de-aceptación-cumplido-el-2026-11-17) quedó **cumplido**
el 2026-11-17 con la boleta folio 42 (Track ID 34017110); el rechazo real sigue cubierto
solo por pruebas.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Contrato con la UI (puro) | `apps/web/src/lib/seguimiento.ts`: `ResultadoConsultaEnvio`, `ResumenSeguimiento`, `HORARIO_SEGUIMIENTO` (`*/5 * * * *`), `MONITOR_SEGUIMIENTO` (`cron-seguimiento`) |
| Seguimiento (`server-only`) | `apps/web/src/server/seguimiento/` (API en `index.ts`): `cron.ts` (`ejecutarSeguimiento`: corrida, backoff, grupos, tiempo, `cerrarAbandonadas`), `consultar-envio.ts` (`consultarEnvio`, a pedido), `consulta.ts` (cliente de estado por canal, lista blanca, renovación del token), `persistencia.ts` (qué se escribe y en qué orden), `dependencias.ts`, `tipos.ts` |
| Clientes del SII por ambiente | `apps/web/src/server/sii/clientes.ts`: `clienteBoletaRest` y `clienteDtews` (los comparte la emisión) |
| Rutas del cron | `apps/web/src/app/api/cron/seguimiento/route.ts` (`maxDuration = 300`) y `apps/web/src/app/api/cron/alertas/route.ts` (`maxDuration = 60`); base común `apps/web/src/server/cron/autorizacion.ts` (Bearer y *cron monitor*); `envCron()` en `server/env.ts` |
| Alertas por correo | `apps/web/src/server/alertas/`: `index.ts` (`ejecutarAlertas`), `datos.ts` (repositorio), `constantes.ts`; plantillas `packages/correos/src/{rechazo,incierto,certificado,alertas-comun}.ts` |
| Lectura y acciones del panel | `apps/web/src/server/documentos/`: `lectura.ts` (lista, detalle, envío, inciertos; con la sesión), `filtros.ts`, `presentacion.ts` (textos), `revisar.ts` + `revision.ts` («Ya lo revisé»), `reenviar.ts` |
| Páginas | `apps/web/src/app/[org]/documentos/` (lista, panel, `acciones.ts`, `EnVivo.tsx`), `apps/web/src/app/[org]/envios/[id]/` (detalle y `MarcarRevisado.tsx`), `apps/web/src/app/[org]/tablero/page.tsx` (alerta de inciertos; el resto del Tablero es de la Fase 9, [guía](tablero-y-reportes.md)) |
| Realtime | `apps/web/src/stores/enVivo.ts` (`useEnVivoStore`) y `ProveedorEnVivo.tsx`; la suscripción, con `suscribirEnVivo` de `apps/web/src/lib/supabase/realtime.ts` (arreglo desplegado en `326be87`) |
| Base | `supabase/migrations/0013_notificaciones.sql`, `0014_cron.sql`; verificaciones `supabase/verificaciones/0013_notificaciones.sql`, `0014_cron.sql`, `rls-fase8-notificaciones.sql` |
| Pruebas | `*.test.ts` junto a cada módulo (el escenario con dobles es `server/seguimiento/escenario-prueba.ts`), `packages/correos/src/alertas-fase8.test.ts`, `apps/web/e2e/documentos.spec.ts` |

Lo que hacen los triggers de la `0001` al escribir un envío (`clasificar_envio`,
`sincronizar_documentos_envio`, `trg_50_envio_actualizado`, `trg_50_envio_rechazo_sincronizar`)
no cambia en esta fase: el seguimiento escribe en un orden que los aprovecha
([orden](#qué-se-escribe-por-consulta-y-en-qué-orden)).

## El cron de seguimiento

### La ruta

`POST /api/cron/seguimiento` (también `GET`, para probarla a mano con el mismo Bearer).
`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300`.

1. **Autorización** (`autorizarCron`): compara `Authorization: Bearer <valor>` con
   `CRON_SECRET` en tiempo constante (hash SHA-256 de los dos lados y `timingSafeEqual`).
   Sin `CRON_SECRET` (`envCron()` da `null`; exige 16 caracteres o más) responde **503**
   `{ error: 'cron_sin_configurar' }` y no hace nada; con un Bearer distinto, **401**
   `{ error: 'no_autorizado' }`. `/api/*` es público para el proxy: la única autorización
   es el Bearer.
2. **Cron monitor de Sentry** (`conMonitorCron`): `Sentry.withMonitor('cron-seguimiento',
   …)` con horario `*/5 * * * *` (UTC), margen de 2 minutos y duración máxima de 5. Avisa
   si el cron deja de correr o falla.
3. `ejecutarSeguimiento()` y responde el `ResumenSeguimiento` con `Cache-Control:
   no-store`. Si lanza (solo pasa cuando no puede leer los envíos), el monitor queda en
   error, la excepción va a Sentry y la ruta responde **500** `{ error:
   'seguimiento_fallido' }`.

La respuesta son solo conteos: nunca tokens, RUT, Track ID ni mensajes de error. El
detalle queda en `operaciones_sii` y `consultas_envio`.

```json
{ "envios": 3, "consultados": 3, "cambiados": 1, "errores": 0, "gruposOmitidos": 0, "postergados": 0 }
```

| Campo | Qué cuenta |
|---|---|
| `envios` | envíos elegidos en esta corrida (hasta 100) |
| `consultados` | consultas que el SII respondió y se guardaron (aunque el estado no cambiara) |
| `cambiados` | de esas, las que cambiaron estado o conteos |
| `errores` | consultas que fallaron (red, HTTP, respuesta ilegible, estado desconocido, EPR sin detalle suficiente, falla al guardar) |
| `gruposOmitidos` | grupos que no consultaron nada porque falló el certificado, el token o la fila de `operaciones_sii` (se reintentan en la próxima corrida) |
| `postergados` | envíos elegidos que no se alcanzaron a consultar (tiempo, o el SII siguió rechazando el token renovado) |

### Flujo de una corrida (`ejecutarSeguimiento`)

Solo lectura en el SII: aquí no se envía ni se firma nada.

0. **`cerrarAbandonadas`**: cierra las operaciones `seguimiento` y `consultar_envio` que
   quedaron `en_curso` hace más de 15 minutos (`MINUTOS_EN_CURSO_ABANDONADA`), porque Vercel
   cortó la función antes de cerrarlas. Quedan `resultado = 'error'`, `detalle = {
   abandonada: true }` y el mensaje «La consulta de estado se cortó antes de terminar
   (límite de tiempo de la función). Es de solo lectura: no quedó nada pendiente en el
   SII.». De mejor esfuerzo: nunca lanza.
1. **Elegir los envíos** (`leerPorConsultar`), con el *backoff* aplicado **en la base**
   (`filtroPorConsultar`, un `or()` de PostgREST):
   - `v_envios_por_consultar` (`clasificacion = 'en_proceso'`, o `pendiente` con
     `track_id`);
   - más los `envios` con `clasificacion = 'inconsistente'` y `incierto = false` (la vista
     no los trae y el panel no tiene otra forma de cerrarlos);
   - los `incierto` **nunca**: no tienen Track ID y no se reintentan solos (principio 3).
2. **Priorizar**: `ultima_consulta_en` ascendente con los nunca consultados primero; se toma
   hasta `TOPE_ENVIOS` = **100** (cada lectura trae hasta 100 y se juntan sin repetir).
3. **Agrupar** por organización + empresa + ambiente + **canal** (`agrupar`). Un grupo usa
   un certificado, un transporte y **un token**: los tokens REST y DTEWS son distintos, por
   eso el canal también separa.
4. **Una operación `seguimiento` por grupo** en `operaciones_sii` (`ejecutarOperacion`,
   `usuarioId = null`, `confirmada = true`, `ambiente` y `canal` del grupo).
5. **Por cada envío del grupo**: consulta con el token del grupo
   (`consultarConRenovacion`) y `guardarRespuesta`. Una falla (red, HTTP, respuesta
   ilegible, estado desconocido) deja su fila en `consultas_envio` con el `error`
   (`registrarFalla`) y sigue con el resto.
6. **Tiempo**: antes de cada paso que sale al SII se mira si cabe su peor caso
   ([abajo](#presupuesto-de-tiempo)); lo que no cabe queda para la próxima corrida.

### Qué envíos toca consultar: el backoff

Sin migración: el intervalo depende de `envios.consultas`, que cuenta **también** los
intentos fallidos (`registrarFalla` y el EPR sin detalle suben `consultas` y
`ultima_consulta_en`). El cron corre cada 5 minutos.

| `consultas` | Se consulta si la última fue hace al menos | Aproximadamente |
|---|---|---|
| 0–11 | 4 minutos | en cada corrida, la primera hora (~12 consultas) |
| 12–23 | 15 minutos | ~3 horas más |
| 24–47 | 60 minutos | ~1 día más |
| 48 o más | 6 horas | de ahí en adelante |
| cualquiera, con `enviado_en` de hace más de 7 días (`DIAS_SIN_CERRAR`) | 24 horas | una vez al día, con aviso a Sentry |

Un envío sin `ultima_consulta_en` siempre entra. `filtroPorConsultar(ahora)` arma esos
tramos como `and(...)` dentro de un `or()`: `ultima_consulta_en.is.null`, un tramo por
escalón (con `enviado_en` nulo o de los últimos 7 días) y el tramo de los antiguos. Las
fechas van entre comillas (llevan `:` y `.`). `debeConsultar` es la misma regla en JS (la
usan las pruebas).

**Por qué en la base y no filtrando en JS:** con `.limit(100)` primero y el filtro después,
cientos de envíos en *backoff* largo con `ultima_consulta_en` más antigua ocupaban la
ventana y un envío nuevo no entraba nunca (cola con hambre).

**Envíos que no cierran.** Cuando un envío lleva más de 7 días desde `enviado_en` sin
estado final, cada consulta (una al día) intenta registrar un aviso `warning` «Envío sin
estado final después de 7 días» con `resultado: 'envio_sin_cerrar'` y el id del envío, los
días, el `estado_sii` y las consultas (sin Track ID ni RUT). **Ojo:** en producción ese
aviso hoy no sale ([trampa](../07-referencia/trampas-conocidas.md#seguimiento-de-envíos-fase-8)).

### Grupos, operación y token

Dentro de la operación del grupo, en este orden:

1. RUT de la empresa (`rutDeEmpresa`, `service_role` filtrando por organización) y
   certificado predeterminado (`certificadoDeEmpresa`). Si fallan, la operación queda con
   ese resultado (`config` para el certificado) y el grupo se omite.
2. `await using transporte` (uno por grupo) y el cliente de estado del canal
   (`clienteEstado`):
   - `rest`: `ClienteBoletaRest` del **ambiente del envío** (`clienteBoletaRest` de
     `server/sii/clientes.ts`): token en `apicert.sii.cl` / `api.sii.cl` y `consultarEnvio`
     (`GET …/boleta.electronica.envio/{rut}-{dv}-{trackId}`) en el mismo host;
   - `soap`: `ClienteDtews` (`clienteDtews`): token DTEWS y `estadoEnvio` (QueryEstUp) en
     `maullin.sii.cl` / `palena.sii.cl`.
   Nunca `FABRICAS_SII.rest` de la certificación, que fija `certificacion`.
3. **Un token** (`obtenerToken(rut)`), que sale del `TokenStoreSupabase` (`tokens_sii`,
   cifrado): entre corridas se reutiliza mientras esté vigente.
4. **Una renovación como mucho** (`consultarConRenovacion`): si el SII rechaza el token (REST
   responde **401**; QueryEstUp responde HTTP 200 con un `ESTADO` de token, `ErrorTokenSoap`),
   olvida el token, pide uno nuevo **una vez** y repite la consulta. El estado del token se
   comparte en el grupo: después de una renovación, otro rechazo ya no renueva y el resto
   del grupo se posterga (sería el certificado o el SII, no el token). Si no queda tiempo
   para renovar, también se posterga.
5. `agregarDetalle({ envios, consultados, cambiados, errores, postergados, sinCerrar })`.
6. **Resultado del grupo**: `ok` si al menos una consulta respondió; si fallaron todas, el
   error de la última (p. ej. `transporte`, que va a Sentry con su host).

**Por qué una operación por grupo y no por consulta:** con 100 consultas cada 5 minutos
serían hasta 28.800 filas al día en `operaciones_sii`, repitiendo lo que `consultas_envio`
ya guarda envío por envío. Una por grupo deja auditada cada salida al SII (token incluido),
con los conteos en `detalle`.

`QueryEstUp` no tiene un código documentado para el token vencido; `ErrorTokenSoap` se
reconoce por un `ESTADO` `001`, `002` o `003`, o por una glosa que diga «token». Es una
heurística sin contrastar con el SII: si se equivoca, el costo es pedir un token de más.

### Presupuesto de tiempo

La ruta tiene `maxDuration = 300` y el trabajo se planifica para terminar antes del segundo
**280** (`LIMITE_MS`), dejando 20 s para cerrar la operación, el *check-in* de Sentry y la
respuesta. Cada petición al SII puede tardar hasta 45 s (`TransporteUndici`):

| Paso | Peor caso que tiene que caber | Constante |
|---|---|---|
| empezar un grupo | preparar (15 s) + semilla y token (2 × 45 s) + la primera consulta (45 s) = 150 s: ningún grupo empieza después del segundo 130 | `MS_EMPEZAR_GRUPO` |
| pedir el token (si preparar tardó) | 2 × 45 s + una consulta | — |
| otra consulta del grupo | 45 s | `MS_CONSULTA` |
| renovar el token | semilla + token + repetir la consulta = 135 s | `MS_RENOVAR` |

Si aun así Vercel corta la función (p. ej. la base se cuelga), la fila de
`operaciones_sii` queda `en_curso` y la cierra `cerrarAbandonadas` en una corrida
posterior.

## Qué se escribe por consulta y en qué orden

`guardarRespuesta` (`persistencia.ts`), con `service_role` y filtrando por organización. Lo
usan el cron y la consulta del panel.

### Antes de escribir: las guardas

| Guarda | Qué pasa |
|---|---|
| **Lista blanca de estados** (`validarEstado`, en `consulta.ts`) | solo se guardan los 10 códigos de `estados_sii`: `REC`, `SOK`, `CRT`, `FOK`, `PRD`, `EPR`, `RSC`, `RFR`, `RCT`, `RCH`. Cualquier otro (`-11` de QueryEstUp a un envío que aún no registra, `RPR` de un RCOF, códigos de error con HTTP 200) es `ErrorEstadoDesconocido` (código 5): la consulta cuenta como falla, queda en `consultas_envio.error` y el envío **no se toca** (`estado_sii` sigue igual) y se vuelve a consultar con el *backoff*. Sin esto, `clasificar_envio` daría `rechazado` |
| **EPR con detalle incompleto** (`detalleIncompleto`) | un `EPR` (que no sea RCOF) con rechazos o reparos en los contadores y **menos** documentos en `detalle_rep_rech` que esos contadores **no se guarda**: `sincronizar_documentos_envio` solo mira `envio_rechazos` y dejaría `aceptado` a documentos que el SII rechazó. Pasa siempre con SOAP (QueryEstUp no trae detalle) y podría pasar con REST. Se anota la consulta con el error y la respuesta, se suben `consultas` y `ultima_consulta_en` y el envío queda como estaba (`sin_detalle`) |
| **No pisar estados finales** | si el envío ya está `aceptado`, `aceptado_con_reparos` o `rechazado` (otra consulta lo cerró en paralelo), solo se anota la bitácora (`ya_final`). `inconsistente` **no** es final: se sigue consultando |

### Las escrituras

1. **`envio_estadisticas`**: upsert por `(envio_id, tipo_dte)`. No tiene triggers.
2. **`envio_rechazos`** (solo con detalle, es decir REST): upsert por `(envio_id, tipo_dte,
   folio)` del detalle sin repetidos, con `tipo_observacion` y los errores saneados. Con
   `EPR`, además borra los rechazos guardados que el SII ya no informa (solo un `EPR` tiene
   autoridad para eso: una respuesta en proceso que llegue tarde nunca borra el detalle de
   un `EPR`). `trg_10_envio_rechazo` enlaza el documento y
   `trg_50_envio_rechazo_sincronizar` llama a `sincronizar_documentos_envio` con el envío
   **todavía en su estado anterior** (en proceso o pendiente): los documentos quedan
   `enviado` o sin cambio, nunca en un estado final.
3. **`envios`**: `estado_sii`, `glosa_sii`, conteos, `respuesta_estado`,
   `ultima_consulta_en` y `consultas + 1`, con el filtro `clasificacion not in (aceptado,
   aceptado_con_reparos, rechazado)` **en el mismo `update`** (la garantía contra pisar un
   final); devuelve la `clasificacion` (columna generada). Si cambian estado o conteos,
   `trg_50_envio_actualizado` sincroniza los documentos, ahora con los rechazos ya
   guardados, y encola `envio.actualizado`; `trg_50_evento_documento` encola
   `documento.<estado>` por cada documento que cambia. Si el `update` no devuelve fila,
   otra consulta lo cerró entremedio: `ya_final`.
4. **`consultas_envio`**: la bitácora (estado, glosa, conteos, `respuesta` saneada). De
   mejor esfuerzo: si falla, solo un aviso en consola.

**Por qué este orden.** Al revés (envío antes que rechazos), un `EPR` con rechazos dejaría
primero **todos** los documentos `aceptado` (todavía no hay rechazos que mirar) y
`tg_evento_documento` encolaría un webhook `documento.aceptado` **falso**, antes de que el
rechazo los pasara a `rechazado`. El estado final sería el mismo; los webhooks, no. Se
comprobó en PGlite: con el orden inverso aparecen esos `documento.aceptado` en
`webhook_entregas`.

Una falla en 1–3 lanza `ErrorPersistencia` («No se pudo guardar … (código …)», sin datos de
la fila): la consulta cuenta como error y se vuelve a consultar.

`consultas + 1` se calcula con el valor leído: dos consultas simultáneas del mismo envío
(cron y panel) pueden contar una sola. Se acepta (es un contador para el *backoff*; la
auditoría es `consultas_envio`); un incremento atómico pediría una RPC nueva.

### Saneo

El token del grupo nunca entra en lo que se guarda:

- `jsonSeguro` copia la respuesta sin claves sensibles (`token`, `cookie`, `clave`,
  `password`, `secret`, `authorization`, `bearer`, `rsask`, `pfx`, `session`…), con
  profundidad máxima 8 y hasta 2.000 elementos por arreglo, y cada texto pasa por
  `textoSeguro`: reemplaza el token literal por `[FILTRADO]` y aplica `sanearTexto`.
- De un error (`textoDeError`) se guarda solo el texto de los errores de la librería
  (`SiiError`), el título de un error con `MensajeError` propio o el de `ErrorPersistencia`;
  de uno desconocido, solo su nombre («… (sin detalle)»).

## Estados: del SII a los documentos

`clasificar_envio` (columna generada de `envios`) y `sincronizar_documentos_envio` son de la
`0001`. La UI usa las palabras de `EstadoDTE` (`presentacion.ts`).

| Respuesta del SII | `envios.clasificacion` | Documentos del envío (no `anulado`) | Envío en la UI | ¿Se sigue consultando? |
|---|---|---|---|---|
| (sin respuesta, con Track ID) | `pendiente` | sin cambio (quedan `enviado`) | «Pendiente de consulta» · `enviado` | sí |
| `REC`, `SOK`, `CRT`, `FOK`, `PRD` | `en_proceso` | `enviado` | «En revisión del SII» · `enviado` | sí |
| `EPR`, todos aceptados, sin reparos | `aceptado` | `aceptado` | «Aceptado» | no |
| `EPR`, sin rechazos, con reparos | `aceptado_con_reparos` | `aceptado_con_reparos` los que están en `envio_rechazos` como reparo; `aceptado` el resto | «Aceptado con reparos» · `reparos` | no |
| `EPR` con rechazos | `rechazado` | `rechazado` los del detalle como rechazo, `aceptado_con_reparos` los de reparo, `aceptado` el resto | «Rechazado» | no |
| `EPR` cuyos conteos no cuadran | `inconsistente` | `enviado` | «Respuesta que no cuadra» · `enviado` | sí |
| `RSC`, `RFR`, `RCT`, `RCH` (rechazo del sobre) | `rechazado` | todos `rechazado` | «Rechazado» + «El SII rechazó el envío completo» | no |
| otro código (`-11`, `RPR`…) | **no se guarda** (lista blanca) | sin cambio | sin cambio; la bitácora muestra la falla | sí |
| `EPR` con rechazos o reparos sin detalle suficiente | **no se guarda** | sin cambio | sin cambio; la bitácora anota la respuesta con la nota | sí |
| (envío sin Track ID tras salir) | `incierto` | `incierto` | «Por verificar» | **nunca** |

Un envío `pendiente` **sin** Track ID es uno que no salió (falló antes de enviarse): la UI lo
muestra `firmado` y «El envío no llegó al SII».

## Rechazos y reparos

- **Rechazo o reparo** (`tipoObservacion`, mismo criterio que el set de la Fase 5): un
  `estado` del detalle `RPR`, `REP` o `RLV` es reparo; si el envío no tiene rechazos pero sí
  reparos, todo su detalle es de reparos; lo demás, rechazo.
- Cada fila de `envio_rechazos` guarda `estado` tal como lo da el SII, `descripcion` y
  `errores` (`{ seccion, linea, nivel, codigo, descripcion, detalle }`), saneados.
- **En la página del envío** («Rechazos y reparos») y en el panel del documento cada error
  se muestra con su ubicación («Sección Encabezado, línea 3»), su código y su texto
  (`leerErroresSii`, `ubicacionError`, `textoError`), y qué hacer (`guiaObservacion`):
  rechazo, «La boleta no es válida para el SII. Corrige lo que indica y emite una boleta
  nueva: el folio rechazado no se vuelve a usar.»; reparo, «La boleta es válida. Corrige lo
  que indica el SII en las próximas emisiones.». El JSON crudo va solo en `<details>`.
- **Rechazo del sobre completo** (`mensajeRechazoEnvio`): «El SII rechazó el envío
  completo» con el código y una guía por caso (`RCT`: revisa el RUT de quien envía y la
  resolución; `RFR`: revisa el certificado; `RSC`: el XML no cumple el esquema, escríbenos
  con el Track ID). Un `EPR` rechazado sin detalle: «El SII rechazó boletas de este envío…
  Revisa en el sitio del SII cuáles rechazó y por qué».

## Envíos inciertos y «Ya lo revisé»

Un envío `incierto` (subida sin Track ID: no se sabe si llegó) **nunca** se consulta ni se
reintenta solo (principio 3). Lo que cambia en esta fase es que se ve y se avisa:

- **Tablero**: una `Alerta` de aviso «Hay un envío por verificar en el SII» (o «Hay N
  envíos…») con los de la **empresa elegida en el Tablero** en los dos ambientes, sin los del set de
  pruebas, sin los ya revisados, hasta 10 (los más recientes) con sus folios y un enlace a
  cada envío; si hay más, enlaces a Documentos emitidos filtrados por «Por verificar» de
  esa empresa y ambiente (`hrefInciertos`). Explica que hay que revisar en el sitio del SII
  (Boleta electrónica, consulta de boletas emitidas) si cada folio quedó recibido antes de
  volver a emitirlo. Desde la Fase 9 el Tablero tiene selectores de empresa, ambiente y
  período: la alerta sigue mostrando los inciertos de los dos ambientes aunque el selector
  mire uno ([Tablero](tablero-y-reportes.md#alertas)). Si la lectura falla, el Tablero se
  muestra igual.
- **Página del envío**: la guía (`guiaIncierto`) y, para propietario, administrador o
  emisor (`puedeEmitir`), el botón **«Ya lo revisé»**, con un `Dialogo` de confirmación
  («Sí, ya lo revisé»): si los folios llegaron, no hay que hacer nada; si no, se emiten de
  nuevo desde Emitir. Marcarlo no reenvía nada.
- **Correo** a propietarios y administradores ([alertas](#alertas-por-correo)).

**Cómo se marca, sin migración** (`marcarEnvioRevisado`): lee el envío con la **sesión**
(RLS) y exige que sea `incierto`; busca con `service_role` las operaciones enlazadas
(`operaciones_sii.envio_id`, que la emisión fija con `enlazarOperacion`) con resultado
`incierto` o `en_curso`, y marca las que falten con `marcarInciertaRevisada` (el mismo
mecanismo de Certificación y Folios: `detalle.revisada_en` y `revisada_por`). Un envío está
revisado cuando **todas** esas operaciones lo están (`revisionEnvio`). No cambia el envío ni
sus documentos: siguen `incierto`. Si no hay ninguna operación enlazada: «No encontramos la
operación con el SII que lo dejó por verificar. Escríbenos a soporte…». Después revalida
Documentos, el envío y el Tablero.

## Consulta desde el panel

«Consultar estado en el SII» en el panel del documento y en la página del envío. Server
Action `consultarEstado(slug, envioId)` (`documentos/acciones.ts`): membresía (cualquier
miembro, también un lector: consultar no cambia la boleta), envío de la organización leído
con la sesión, y `consultarEnvio` (`server/seguimiento/consultar-envio.ts`):

| Caso | Resultado | Sale al SII |
|---|---|---|
| envío `incierto` | `sin_track_id` con la guía del incierto | no |
| sin Track ID (no salió) | `sin_track_id`: «Este envío no llegó al SII» | no |
| ya final (`aceptado`, `aceptado_con_reparos`, `rechazado`) | `final` | no |
| consultado hace menos de 30 s (`SEGUNDOS_ENTRE_CONSULTAS`) | lo guardado (`consultado`, sin cambio) o, si esa consulta falló, `error` «Consultamos hace unos segundos y el SII no respondió» | no |
| el resto (`pendiente`, `en_proceso`, **`inconsistente`**) | operación `consultar_envio` con `envio_id` y el `usuario_id`; token y consulta por el canal del envío, con una renovación, y `guardarRespuesta` igual que el cron | sí |

Toda falla queda en la bitácora del envío (`registrarFalla`). Los mensajes:
`transporte` → «No pudimos consultar el estado en el SII… el seguimiento automático también
lo consulta cada 5 minutos»; `rechazo_sii` → «El SII no entregó el estado del envío»; EPR
sin detalle → «El SII procesó el envío con rechazos o reparos… no cambiamos el estado de
ninguno»; otro cierre en paralelo → `final`. La pantalla lo muestra con `avisoConsulta`
(tono `exito`, `aviso`, `error` o `info`) y refresca. El botón se deshabilita con su motivo
(`motivoSinConsulta`) si es incierto, final, sin envío o sin Track ID; el servidor vuelve a
decidir. Las páginas tienen `maxDuration = 300`: en Next 16 aplica a sus Server Actions.

## La UI

### Documentos emitidos (`/[org]/documentos`)

- **Filtros en la URL** (`leerFiltros`, nunca lanza; un formulario GET que funciona sin
  JavaScript): `empresa`, `ambiente` (por defecto el del último documento de la empresa;
  sin documentos, producción si está autorizada), `periodo` (`AAAA-MM`, por defecto el mes
  actual en Chile, o `todos`), `tipo` (39/41), `estado` (`enviado`, `aceptado`, `reparos`,
  `rechazado`, `incierto`, `firmado`, `anulado`), `q` (folio exacto, RUT o razón social por
  `ilike` saneado, hasta 60 caracteres), `pagina` y `doc` (panel abierto).
- **Tabla** paginada en el servidor (20 por página, `range` + `count: 'exact'`; una página
  que ya no existe muestra la última). Sin borradores (están en Emitir), sin el set de
  pruebas y sin documentos sin folio.
- **Panel de detalle** (`?doc=<id>`): receptor, emisión, ambiente, Track ID (enlace a la
  página del envío), estado en el SII, última consulta, líneas, rechazos o reparos con sus
  errores y las acciones: descargar XML, PDF carta y PDF rollo (URL firmada de la Fase 7),
  «Consultar estado en el SII» y «Reenviar al receptor». «Anular con nota de crédito» no
  aparece (Fase 14).
- **Reenviar al receptor** (`puedeEmitir`): solo en `enviado`, `aceptado` o
  `aceptado_con_reparos` y con `metadata.receptor_correo`; manda el PDF carta por Resend con
  la `Idempotency-Key` `reenvio-<documento>-<ventana de 60 s>` (dos clics seguidos no mandan
  dos correos) y guarda el resultado en `metadata.correo` con `service_role`.

### Envío (`/[org]/envios/[id]`)

Carátula (RUT emisor y de quien envía, resolución, firma, certificado, canal, ambiente,
propósito, archivo), estado en el SII (Track ID, clasificación, respuesta, enviado,
recibido, última consulta, consultas) con «Consultar estado en el SII», estadísticas por
tipo, rechazos y reparos, documentos del envío, bitácora de las últimas 50 consultas (una
falla sin respuesta se muestra «No respondió: …»; una nota sobre una respuesta que sí
llegó, debajo del estado) y las respuestas crudas del SII en `<details>`. `notFound()` si no
es de la organización. Se abre desde el Track ID; en el menú marca «Documentos emitidos»
(`SECCION_PADRE` de `MarcoApp.tsx`).

### En vivo (Realtime)

`EnVivo.tsx` escucha `documentos` y `envios` (las dos publicadas desde la `0001`): en la
lista, por `organizacion_id`; en la página del envío, solo ese envío (`id=eq.`) y sus
documentos (`envio_id=eq.`). Cada evento hace dos cosas:

1. guarda el estado nuevo en `useEnVivoStore` con su `actualizado_en`: el badge cambia en
   cuanto llega;
2. pide un `router.refresh()` (400 ms de espera, para juntar el envío y sus documentos) que
   relee la página con RLS y trae lo demás (glosa, rechazos, bitácora).

Los componentes muestran el más nuevo entre lo del servidor y lo recibido (`estadoVigente`,
`envioVigente`, comparando `actualizado_en`): un evento viejo no pisa un refresh más nuevo,
y si el refresh falla el badge igual cambió. El store es uno por montaje
(`ProveedorEnVivo`, `useState`); fuera del proveedor, `useEnVivoStore` usa uno vacío. Al
reconectar refresca una vez; con `CHANNEL_ERROR` o `TIMED_OUT`, «No pudimos conectar la
actualización en vivo…». Así «un envío pasa de `enviado` a `aceptado` sin recargar» aunque
uno de los dos caminos falle.

La suscripción va por `suscribirEnVivo` (`lib/supabase/realtime.ts`, desplegado el
2026-11-17 en `326be87`): espera `supabase.realtime.setAuth()` antes de crear el canal, para que el
`phx_join` salga con el JWT de la sesión, y trata un mensaje `system` con `status: 'error'`
como desconexión (muestra el mismo aviso). Sin eso, en una carga completa el canal se unía
como `anon`, Realtime rechazaba el filtro y la página no recibía nada ni avisaba (visto en
*Production* con el envío 34015200; detalle en
[trampas](../07-referencia/trampas-conocidas.md#realtime-en-una-carga-completa-bug-visto-en-production-2026-11-17)).
Los `EnVivo` de Certificación y Folios usan la misma función.

## Alertas por correo

`/api/cron/alertas` (`maxDuration = 60`, monitor `cron-alertas`, horario `*/10 * * * *`,
duración máxima 2 minutos). Misma autorización que el seguimiento. Responde el
`ResumenAlertas` (conteos por categoría y si el correo está configurado: `configurado`,
`sin_configurar` o `sin_url`); si alguna categoría tuvo error, además un
`Sentry.captureMessage('alertas: corrida con errores')` (si no, el monitor seguiría en
verde con la base fallando). `ejecutarAlertas` nunca lanza: cada categoría y cada correo se
aíslan.

| Alerta | Candidatos (función de la 0013) | Un correo por | Clave de deduplicación | `Idempotency-Key` |
|---|---|---|---|---|
| Envío incierto | `alertas_envios_inciertos`: `envios` `incierto`, `proposito = 'emision'`, `actualizado_en` en las últimas 48 h | envío | `envio.incierto:<envio>` | `envio.incierto/<envio>` |
| Documento rechazado | `alertas_documentos_rechazados`: `documentos` `rechazado`, sin el set de pruebas, `actualizado_en` en las últimas 48 h | organización + empresa + ambiente (cada documento con su fila) | `documento.rechazado:<documento>` | `documento.rechazado/<org>/<huella de las claves>`, guardada en `notificaciones.grupo` |
| Certificado por vencer | `alertas_certificados_por_vencer`: `v_certificados_estado` `por_vencer`, con el umbral 1, 7, 15 o 30 (el más chico que cubre `dias_restantes`) | certificado y umbral | `certificado.por_vencer:<certificado>:<umbral>` | `certificado.por_vencer/<certificado>/<umbral>` |

- **Orden**: inciertos, rechazos, certificados (de más a menos urgente).
- **Destinatarios**: propietarios y administradores con correo en `perfiles` (como la alerta
  de folios). Sin destinatarios no se reclama nada.
- **Rechazos**: solo `rechazado`; un `aceptado_con_reparos` es válido y sería ruido. El
  motivo es el primer error de `envio_rechazos` (rechazo) o, para un rechazo del sobre, la
  glosa del envío, en una línea de hasta 200 caracteres. El enlace lleva a la página del
  envío o a Documentos filtrado por empresa, ambiente y «Rechazado».
- **Inciertos**: explica cómo revisar en el SII y pide marcarlo con «Ya lo revisé».
- **Certificados**: solo el umbral vigente (a uno que le quedan 10 días le llega el de 15, no
  también el de 30). No avisa si el certificado ya fue reemplazado: otro del mismo titular
  en la organización, no revocado y vigente por más de 30 días, y el que vence ya no es el
  predeterminado de ninguna empresa.
- **Volumen**: hasta 40 correos por corrida, 600 ms entre uno y otro (Resend admite 2 por
  segundo) y ninguno nuevo después de 40 s. Se mira **antes** de reclamar: lo que no
  alcanza queda libre y sale en la siguiente (`postergados`).
- **Sin Resend o sin `NEXT_PUBLIC_APP_URL`**: detecta y cuenta, pero no reclama ni envía;
  cuando se configure, sale lo que siga en la ventana.

### Deduplicación (migración 0013)

Dos capas:

1. **`notificaciones`**: los candidatos ya vienen sin lo cerrado (`notificacion_cerrada`) y
   repartidos **por turnos entre organizaciones** (`row_number() over (partition by
   organizacion_id …)`: primero el evento más antiguo de cada una), así una organización con
   muchos eventos no tapa a las demás. Antes de enviar se **reclama** la fila por su clave
   (`reclamar_notificacion`, un `insert … on conflict do update … where` atómico): sin
   fila, ya salió o está saliendo en otra corrida. Después queda `enviada` (con
   `enviado_en`, `resend_id` y `destinatarios`) o `fallida` (con `error`, hasta 500
   caracteres). Una `fallida`, o una `pendiente` de más de 15 minutos (la función murió entre
   reclamar y cerrar), se vuelve a tomar hasta **5 intentos**.
2. **`Idempotency-Key` estable** entre reintentos: si el primer intento sí salió, Resend no lo
   duplica (recuerda la clave 24 h). En los rechazos agrupados, la clave se guarda en
   `notificaciones.grupo` **antes** de enviar; un reintento reagrupa por ese `grupo` y reusa
   la clave, sin mezclarse con documentos nuevos (que van en su propio correo). Si no se
   puede guardar el grupo, no se envía.

Contratos de la tabla y las funciones en [RPC del backend](../03-api-reference/rpc-backend.md#notificaciones-migración-0013).

### Plantillas

`@sii/correos`: `correoDocumentosRechazados` (`rechazo.ts`), `correoEnvioIncierto`
(`incierto.ts`) y `correoCertificadoPorVencer` (`certificado.ts`), con las piezas comunes de
`alertas-comun.ts` (lista de filas con estilos en línea y el pie). Español de Chile con tú,
sin exclamaciones ni emoji; qué pasó y qué hacer; sin secretos.

## pg_cron y monitores (migración 0014)

`0014_cron.sql` (**aplicada el 2026-11-17**, 18:31 UTC) agenda 4 jobs (UTC):

| Job | Horario | Qué hace |
|---|---|---|
| `seguimiento-envios` | `*/5 * * * *` | `net.http_post` a `https://boleteame.dev/api/cron/seguimiento`, `timeout_milliseconds` 300.000 |
| `alertas` | `*/10 * * * *` | `net.http_post` a `https://boleteame.dev/api/cron/alertas`, `timeout_milliseconds` 60.000 |
| `limpiar-tokens-sii` | `17 * * * *` | borra de `tokens_sii` los tokens vencidos hace más de un día (SQL directo) |
| `limpiar-historial-cron` | `23 3 * * *` | borra de `cron.job_run_details` las corridas de más de 7 días |

- **El Bearer se lee de Vault en cada corrida**: `'Bearer ' || (select decrypted_secret from
  vault.decrypted_secrets where name = 'cron_token')` dentro del comando. El secreto nunca
  queda en la migración, en `cron.job.command` ni en el historial; rotarlo es cambiar
  `cron_token` en Vault y `CRON_SECRET` en Vercel, sin migración. La 0014 se niega a correr
  (`55000`) si `cron_token` no existe (con `'Bearer ' || null` cada llamada fallaría en
  silencio). Hoy `cron_token` **existe** en Vault.
- **Idempotente**: desagenda cada job si existe y lo vuelve a agendar.
- `pg_net` es asíncrono: el job solo encola la petición. `net._http_response` guarda las
  respuestas 6 horas (`pg_net.ttl`) y no necesita limpieza.
- `HORARIO_SEGUIMIENTO` (`lib/seguimiento.ts`) y `HORARIO_ALERTAS`
  (`server/alertas/constantes.ts`) van sincronizados a mano con los jobs y con los *cron
  monitors* de Sentry (`cron-seguimiento`, `cron-alertas`).
- Pausar uno sin migración: `select cron.alter_job((select jobid from cron.job where jobname
  = 'alertas'), active := false);`.

### Orden de despliegue

1. **Aplicar la 0013** (antes del deploy). **Hecho el 2026-11-17**: el `--dry-run` listó
   solo la 0013 (la 0014 se sacó de `supabase/migrations/` durante el push y se devolvió
   después); en producción, verificación 18/18 y `rls-fase8-notificaciones.sql` 26/26 con la
   limpieza en 0 antes y después; `pnpm db:tipos` difiere solo en la nulabilidad de los
   retornos de funciones (ver
   [trampas](../07-referencia/trampas-conocidas.md#seguimiento-de-envíos-fase-8)). Si la ruta
   de alertas corriera sin ella, no enviaría nada (no puede leer candidatos ni reclamar) y la
   corrida quedaría con error en el resumen y en Sentry.
2. **`CRON_SECRET`** en Vercel (*Production*, *Sensitive*), con el mismo valor que
   `cron_token` en Vault. Sin él, las rutas responden 503. **Hecho el 2026-11-17.**
3. **Deploy** de la app. **Hecho el 2026-11-17**: `3ade4c9` READY, con humo (rutas del cron
   sin Bearer o con uno inválido → 401) y pantallas con sesión.
4. **Aplicar la 0014** (después del deploy): desde ese momento `pg_cron` llama a las rutas.
   Antes del deploy responderían 404 cada 5 minutos (sin daño, pero ruido). **Hecho el
   2026-11-17, 18:31 UTC**: el `--dry-run` listó solo la 0014; `db push --yes`.
5. Verificar: `0014_cron.sql`, `net._http_response` con 200 y los monitores de Sentry en
   verde. **Hecho el 2026-11-17**: `0014_cron.sql` 12/12 (con el MCP `execute_sql` como
   `postgres`; con `supabase db query --read-only` falla la 9, ver
   [despliegue](../08-esquema-supabase/despliegue.md#fase-8-migraciones-0013-y-0014));
   `seguimiento-envios` 3 corridas y `alertas` 1, todas `succeeded`; `net._http_response`
   200 en las dos rutas; monitores `cron-seguimiento` y `cron-alertas` en `ok`.

## Permisos

| Acción | Quién |
|---|---|
| Ver Documentos emitidos, el envío, la bitácora y los rechazos | cualquier miembro (RLS `es_miembro`) |
| Descargar XML y PDF | cualquier miembro |
| «Consultar estado en el SII» | cualquier miembro |
| «Reenviar al receptor» y «Ya lo revisé» | propietario, administrador o emisor (`puedeEmitir`) |
| Leer `notificaciones` | cualquier miembro de la organización; nadie escribe con su sesión |
| Cron (`/api/cron/*`) | solo con el Bearer de `CRON_SECRET` |

Todo lo que escribe el seguimiento (`envios`, `envio_estadisticas`, `envio_rechazos`,
`consultas_envio`, `operaciones_sii`, `notificaciones`) va con `service_role`, filtrando por
organización ([acceso por tabla](../03-api-reference/acceso-por-tabla.md)).

## Cómo diagnosticar

Consultas de **solo lectura** (SQL Editor o MCP `execute_sql`).

**¿Qué consultará el próximo cron y cuándo?**

```sql
select e.id, e.track_id, e.ambiente, e.canal, e.clasificacion, e.estado_sii, e.consultas,
       e.ultima_consulta_en, e.enviado_en
from public.envios e
where (e.clasificacion = 'en_proceso'
       or (e.clasificacion = 'pendiente' and e.track_id is not null)
       or (e.clasificacion = 'inconsistente' and not e.incierto))
order by e.ultima_consulta_en nulls first;
```

Con la tabla del [backoff](#qué-envíos-toca-consultar-el-backoff) se ve si a cada uno le
toca.

**Bitácora de un envío** (la más reciente primero):

```sql
select consultado_en, estado_sii, glosa_sii, informados, aceptados, rechazados, reparos, error
from public.consultas_envio
where envio_id = (select id from public.envios where track_id = '34015200')
order by consultado_en desc
limit 20;
```

Un `error` sin `estado_sii` es una consulta que no respondió; con `estado_sii`, una nota
sobre una respuesta que sí llegó (p. ej. EPR sin detalle).

**Operaciones del seguimiento** (una por grupo y corrida, más las del panel):

```sql
select operacion, ambiente, canal, resultado, mensaje, detalle, iniciada_en, terminada_en
from public.operaciones_sii
where operacion in ('seguimiento', 'consultar_envio')
order by iniciada_en desc
limit 20;
```

`detalle` trae `envios`, `consultados`, `cambiados`, `errores`, `postergados` y `sinCerrar`
(o `abandonada: true` si la cerró `cerrarAbandonadas`).

**¿Corre pg_cron y responden las rutas?**

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
order by d.start_time desc
limit 20;

select id, status_code, timed_out, error_msg, created, left(content, 200) as respuesta
from net._http_response
order by created desc
limit 20;
```

`status_code` 200 con el resumen en `content` es lo esperado; 401 es un Bearer distinto
(`cron_token` ≠ `CRON_SECRET`); 503, falta `CRON_SECRET` en Vercel; 404, la ruta no está
desplegada. En Sentry, los monitores `cron-seguimiento` y `cron-alertas`.

**Documentos de un envío y sus rechazos:**

```sql
select d.tipo_dte, d.folio, d.estado, r.tipo_observacion, r.estado as estado_sii, r.errores
from public.documentos d
left join public.envio_rechazos r on r.documento_id = d.id
where d.envio_id = (select id from public.envios where track_id = '34015200');
```

**Inciertos sin revisar** (lo que muestra el Tablero):

```sql
select e.id, e.empresa_id, e.ambiente, e.creado_en, o.resultado, o.detalle->>'revisada_en' as revisada_en
from public.envios e
left join public.operaciones_sii o on o.envio_id = e.id and o.resultado in ('incierto', 'en_curso')
where e.incierto and e.proposito <> 'set_pruebas'
order by e.creado_en desc;
```

**Alertas** (con la 0013 aplicada):

```sql
select tipo, clave, estado, intentos, error, enviado_en, actualizado_en
from public.notificaciones
order by actualizado_en desc
limit 20;
```

Una `fallida` con 5 intentos ya no se reintenta; una `pendiente` de más de 15 minutos se
vuelve a tomar en la próxima corrida.

**Webhooks encolados por el seguimiento** (solo si la organización tiene webhooks):

```sql
select evento, estado, creado_en, payload->'datos'
from public.webhook_entregas
where evento in ('envio.actualizado', 'documento.aceptado', 'documento.aceptado_con_reparos', 'documento.rechazado')
order by creado_en desc
limit 20;
```

## Cómo se probó

Sin red ni base: Vitest con dobles. El escenario `server/seguimiento/escenario-prueba.ts`
usa el `ClienteBoletaRest` **real** de la librería sobre un `TransporteFalso` (semilla,
token y estado por Track ID), un doble del `ClienteDtews`, la vista sobre el Supabase falso y
un historial de los estados por los que pasa cada documento (para probar que nunca hay un
estado final intermedio). Corrida local del 2026-11-17, todo en verde: typecheck; Vitest de
la app **1056** (+1 omitida); `@sii/correos` **63**; librería **1775**; CLI **217**; Biome,
stylelint y `pnpm build`. Una revisión de código encontró 10 hallazgos, todos corregidos
(las correcciones del seguimiento tienen sus pruebas en `server/seguimiento/revision.test.ts`).

| Archivo | Qué cubre |
|---|---|
| `server/seguimiento/cron.test.ts` | grupos y un token por grupo con una renovación (y postergar tras otro 401); grupo con token o certificado que falla; EPR aceptado, EPR con rechazos y reparos (el detalle **antes** del estado, ningún documento pasa por `aceptado`), rechazo del sobre, en proceso, pendiente con Track ID; fallas por consulta; backoff, tope y prioridad; SOAP (QueryEstUp, EPR con rechazos sin detalle); secretos |
| `server/seguimiento/consultar-envio.test.ts` | consultado, 30 s, incierto, sin Track ID, `inconsistente` consultable, cierre en paralelo, EPR sin detalle, red, token, configuración, otra organización, secretos |
| `server/seguimiento/persistencia.test.ts` | `jsonSeguro`, `textoDeError`, `tipoObservacion`, normalización REST y SOAP |
| `server/seguimiento/revision.test.ts` (los hallazgos de la revisión) | presupuesto de tiempo y `cerrarAbandonadas`; filtro del backoff en la base (cola sin hambre, igual a `debeConsultar`); EPR con detalle incompleto; lista blanca y token SOAP; inconsistentes y respuestas viejas que no pisan finales ni borran rechazos; envíos de más de 7 días |
| `app/api/cron/*/route.test.ts` | Bearer (401, 503), monitor y respuesta sin detalle |
| `server/alertas/alertas.test.ts`, `datos.test.ts`, `packages/correos/src/alertas-fase8.test.ts` | reclamo, reintentos con el mismo grupo, tope de correos y tiempo, sin destinatarios, sin Resend, umbrales y reemplazo de certificados; plantillas |
| `server/documentos/*.test.ts`, `app/[org]/documentos/acciones.test.ts`, `stores/enVivo.test.ts` | filtros y consulta, textos, «Ya lo revisé», reenvío, permisos de las Server Actions, store en vivo |

**En PGlite** (el esquema con stubs de `auth`, `vault`, `supabase_migrations` y lo demás,
como en las fases anteriores; nada toca la base real):
`0013_notificaciones.sql` **18/18** (0/18 sin la 0013) y `rls-fase8-notificaciones.sql`
**26/26** (1/26 sin ella); `0014_cron.sql` **11/12** (la 1, extensiones `pg_cron` y
`pg_net`, no aplica en PGlite). **En producción** (2026-11-17): `0013_notificaciones.sql`
**18/18** y `rls-fase8-notificaciones.sql` **26/26**; `0014_cron.sql` **12/12** (con
`execute_sql` como `postgres`). Además el orden
de escritura: con el orden inverso se
encolan webhooks `documento.aceptado` falsos.

`e2e/documentos.spec.ts` (Playwright, **sin ejecutar**) prueba solo lo que no escribe ni sale
al SII: sin sesión, la redirección a `/ingresar`; con una sesión guardada (`E2E_SESION`,
`E2E_ORG`), la lista, los filtros en la URL, el panel y axe, sin pulsar «Consultar estado en
el SII», «Reenviar al receptor» ni las descargas.

## Criterio de aceptación (cumplido el 2026-11-17)

El criterio (PLAN-SAAS Fase 8):

> Un envío pasa de `enviado` a `aceptado` en la UI sin recargar, y un rechazo muestra el
> error del SII con el texto del design system.

Se hace en *Production* con el envío real de la Fase 7: boleta 39 folio 41, **Track ID
34015200**, certificación.

**Estado al 2026-11-17:**

- **Cron verificado.** La primera corrida de seguimiento (18:35 UTC) consultó el envío:
  `{"envios":1,"consultados":1,"cambiados":1,"errores":0}`, el SII respondió **EPR**
  (1 informado, 1 aceptado), el documento pasó a `aceptado` y la operación `seguimiento`
  quedó `ok`. Alertas: `correo: "configurado"`, 0 correos, `notificaciones` vacía.
- **El badge no cambió.** Con la página del envío abierta desde una carga completa, el cambio
  de las 18:35 no llegó por Realtime: el canal se había unido como `anon` y la suscripción
  quedó rechazada sin aviso
  ([trampa](../07-referencia/trampas-conocidas.md#realtime-en-una-carga-completa-bug-visto-en-production-2026-11-17)).
  Para reproducirlo se hizo, con el OK del usuario, un `update envios set actualizado_en =
  now()` sobre el envío 34015200, sin cambiar el estado.
- **Arreglo desplegado** (`b84a5b2`, deploy `326be87`): `suscribirEnVivo`
  (`lib/supabase/realtime.ts`), usado por los `EnVivo` de Certificación, Folios y
  Documentos/Envíos; 7 pruebas nuevas. Con la página en carga completa, las suscripciones
  quedan `authenticated` y el mismo `update` llegó como `postgres_changes` en 0,33 s.
- **Criterio cumplido** (con el OK del usuario): boleta 39 de $ 1.190 emitida desde la UI en
  certificación, folio 42, **Track ID 34017110**. Con `/servicio/envios/<id>` abierta desde
  una carga completa, el cron de las 19:05 UTC la consultó (EPR, 1 informado y 1 aceptado) y
  la página pasó, sin recargar, de «Enviado» / «REC · Recibido» / 0 consultas a «Aceptado» /
  «EPR · Envío procesado» / 1 consulta. Documento `aceptado`, operaciones `emitir` y
  `seguimiento` `ok`, sin secretos en `operaciones_sii` ni `consultas_envio`, sin errores de
  consola ni de runtime.

Pasos del criterio:

1. Abrir Documentos emitidos (certificación) o la página del envío con la sesión del
   propietario (carga completa, que es el caso que fallaba), sin recargar después.
2. Esperar la primera corrida del cron (o pulsar «Consultar estado en el SII»): el badge
   tiene que pasar de `enviado` a `aceptado` por Realtime.
3. Comprobar en la base: envío `aceptado` con `EPR` 1/1/0/0, `envio_estadisticas` del tipo
   39, una fila en `consultas_envio`, operación `seguimiento` (o `consultar_envio`) `ok` sin
   secretos, documento `aceptado`.
4. El rechazo con el texto del design system no se puede provocar con ese envío: queda
   cubierto por las pruebas (`presentacion.test.ts`, `persistencia.test.ts`) hasta que haya
   un rechazo real.
